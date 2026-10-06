#!/usr/bin/env bash
# muse-settle.sh — read the coordinator's oldest unacknowledged batch once (no wait), print every
# message, acknowledge it unless it holds an unanswered question/escalation/decision_gate/handoff,
# and release the listed dispatches whose worker reported success.
#
# Release eligibility comes from worker-show (not the inbox), so it works before or after the ack.
# Release only after acceptance passed; unlisted dispatches stay open for follow-up tasks.
#
# Usage: muse-settle.sh --coord <handle> [--release <dispatch_id>]... [--ack <delivery_id>]
#   --ack acknowledges a batch you already handled (e.g. after replying to its question).
# Exit: 0 settled, 1 a release/ack failed or output was unreadable, 2 replies needed, 64 usage.
set -uo pipefail
ORCA=${ORCA_BIN:-orca}
COORD= ACK= REL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --coord) COORD=$2; shift 2;;
    --release) REL+=("$2"); shift 2;;
    --ack) ACK=$2; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 64;;
  esac
done
[[ -n $COORD ]] || { echo "need --coord" >&2; exit 64; }

ORCA="$ORCA" python3 - "$COORD" "$ACK" "${REL[@]}" <<'PY'
import json, os, subprocess, sys

ORCA = os.environ["ORCA"]
coord, ack_id, rel = sys.argv[1], sys.argv[2], sys.argv[3:]
ACTIONABLE = {"question", "escalation", "decision_gate", "handoff"}
RELEASED = {"released", "already_released"}
failed = False

def orca(*args):
    """Run orca, parse stdout only; stderr carries diagnostics and keepalives."""
    p = subprocess.run([ORCA, "orchestration", *args, "--json"], capture_output=True, text=True)
    try:
        doc = json.loads(p.stdout)
    except ValueError:
        doc = None
    return p.returncode, doc, (p.stderr or "").strip()[:300]

def ack(delivery):
    rc, doc, err = orca("check", "--terminal", coord, "--ack", delivery, "--timeout-ms", "2000")
    if rc == 0 and doc and doc.get("ok"):
        print("acked", delivery)
        return True
    print(f"ack FAILED {delivery} rc={rc} {err}")
    return False

if ack_id and not ack(ack_id):
    failed = True

rc, doc, err = orca("check", "--terminal", coord, "--timeout-ms", "3000")
if not (doc and doc.get("ok") and "result" in doc):
    e = (doc or {}).get("error") or {}
    print(f"check failed rc={rc} {e.get('code', 'unreadable')}: {e.get('message', err)}")
    sys.exit(1)
res = doc["result"]
msgs = res.get("messages") or []
pending = []
for m in msgs:
    try:
        p = json.loads(m.get("payload") or "{}")
    except ValueError:
        p = {}
    print(f'{m.get("type")} {p.get("dispatchId", "?")} outcome={p.get("outcome", "-")} files={p.get("filesModified")}\n  {m.get("body")}')
    if m.get("type") in ACTIONABLE:
        pending.append(m)
        print(f'  !! needs a reply: {ORCA} orchestration reply --from {coord} --id {m.get("id")} --body "..."')
if not msgs:
    print("inbox empty")

for d in rel:
    rc, doc, err = orca("worker-show", "--dispatch", d)
    if rc != 0 or not (doc or {}).get("ok") or not isinstance(doc.get("result"), dict):
        failed = True
        print(f"release FAILED {d}: worker-show unreadable rc={rc} {err}; rerun this script")
        continue
    outcome = (doc["result"].get("projection") or {}).get("outcome")
    if outcome != "succeeded":
        print(f"skip release {d}: outcome={outcome}")
        continue
    rc, doc, err = orca("worker-release", "--dispatch", d)
    r = (doc or {}).get("result") or {}
    state = r.get("state")
    if state in RELEASED:
        print(state, d)
    elif state == "retained":
        why = r.get("reason")
        # A terminal the dispatch does not own (e.g. one opened by muse-resume.sh) stays open with muse running.
        hint = (f"muse still running; reuse it with --terminal, or close it: {ORCA} terminal close --terminal <handle>"
                if why == "external_terminal" else "no owned terminal to close")
        print(f"retained {d} reason={why} ({hint})")
    else:
        failed = True
        print(f"release FAILED {d} state={state} rc={rc} {err}; rerun this script or follow the receipt: {json.dumps(r)[:300]}")

delivery = res.get("deliveryId")
if delivery:
    if pending:
        print(f"NOT acked {delivery}: reply first, then rerun with --ack {delivery}")
        sys.exit(1 if failed else 2)
    if not ack(delivery):
        failed = True
sys.exit(1 if failed else 0)
PY
