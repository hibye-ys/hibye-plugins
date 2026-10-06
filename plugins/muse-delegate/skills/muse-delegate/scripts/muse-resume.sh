#!/usr/bin/env bash
# muse-resume.sh — reopen a released muse worker's session in a new Orca terminal, ready for a follow-up task.
# Finds the top-level Muse session that ran the dispatch, relaunches it with the permission mode that session
# was opened with, waits for tui-idle, and prints a one-line JSON with the new terminal handle.
#
# Usage: muse-resume.sh --worktree <selector> (--dispatch <dispatch_id> | --session <muse_session_id>)
#                       [--title <text=muse-resume>] [--timeout-ms <ms=60000>]
# Then: task-create, and muse-run.sh ... --task <id> --terminal <handle>.
# The new terminal is not owned by any dispatch: worker-release leaves it open; close it with
#   orca terminal close --terminal <handle>   when the follow-ups are done.
# Exit: 0 ready, 1 session not found / ambiguous / terminal failed, 64 usage.
set -uo pipefail

ORCA=${ORCA_BIN:-orca}
SESSIONS=${MUSE_SESSIONS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/muse/sessions}
WT= DISPATCH= SESSION= TITLE=muse-resume TIMEOUT=60000
while [[ $# -gt 0 ]]; do
  case "$1" in
    --worktree) WT=$2; shift 2;;
    --dispatch) DISPATCH=$2; shift 2;;
    --session) SESSION=$2; shift 2;;
    --title) TITLE=$2; shift 2;;
    --timeout-ms) TIMEOUT=$2; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 64;;
  esac
done
[[ -n $WT && ( -n $DISPATCH || -n $SESSION ) ]] || { echo "need --worktree and --dispatch or --session" >&2; exit 64; }
# Both values end up in a shell command line, so accept identifier characters only.
[[ -z $DISPATCH || $DISPATCH =~ ^ctx_[A-Za-z0-9]+$ ]] || { echo "invalid --dispatch: $DISPATCH" >&2; exit 64; }
[[ -z $SESSION || $SESSION =~ ^[0-9A-Fa-f-]{8,64}$ ]] || { echo "invalid --session (expect a session UUID): $SESSION" >&2; exit 64; }

fail() { python3 -c 'import sys,json;print(json.dumps({"status":"failed","note":sys.argv[1]}))' "$1"; exit 1; }

# Prints "<session-id> <security-mode>" or "error <message>".
found=$(python3 - "$SESSIONS" "$DISPATCH" "$SESSION" "$WT" <<'PY'
import json, os, sys
root, dispatch, session, wt = sys.argv[1:5]
want_root = os.path.realpath(wt[5:]) if wt.startswith("path:") else None

def records(line):
    try:
        e = json.loads(line)
    except Exception:
        return
    for c in e.get("children") or []:
        try:
            yield json.loads(c.get("record_json") or "")
        except Exception:
            pass
    if "payload" in e:
        yield e

def meta(path):
    """Header facts of a session log: id, top-level flag, workspace, permission mode."""
    sid = mode = ws = top = None
    with open(path, errors="ignore") as f:
        for i, line in enumerate(f):
            if i > 200 or (sid and top is not None):
                break
            for r in records(line):
                p = r.get("payload") or {}
                rec = p.get("record") or {}
                kind = p.get("kind")
                if kind == "metadata":
                    ws = rec.get("workspace_root")
                elif kind == "session_opened":
                    sid, mode = rec.get("session_id"), rec.get("security_mode")
                elif kind == "agent_tree_initialized":
                    top = rec.get("root_session_id") == rec.get("root_agent_id")
    return sid, mode, ws, top

cands = []
for d, dirs, files in os.walk(root):
    if "subagent" in dirs:
        dirs.remove("subagent")  # subagent logs repeat the parent's dispatch id
    if "session.jsonl" not in files:
        continue
    name = os.path.basename(d)
    path = os.path.join(d, "session.jsonl")
    if session:
        if name != session:
            continue
    else:
        with open(path, errors="ignore") as f:
            if dispatch not in f.read():
                continue
    sid, mode, ws, top = meta(path)
    if sid != name or top is False:
        continue  # subagent logs repeat the parent's dispatch id
    if want_root and ws and os.path.realpath(ws) != want_root:
        continue
    cands.append((name, mode or "-"))

if len(cands) == 1:
    print(*cands[0])
elif not cands:
    print("error no top-level muse session under", root, "matches", dispatch or session)
else:
    print("error ambiguous sessions:", ", ".join(c[0] for c in cands), "- pass --session")
PY
)
read -r SESSION MODE <<<"$found"
[[ $SESSION == error ]] && fail "${found#error }"
[[ -n $SESSION ]] || fail "session lookup failed"

# Reopen with the original session's permission mode; only a yolo session gets --yolo back.
flags=(--trust-workspace)
[[ $MODE == yolo ]] && flags+=(--yolo)
handle=$("$ORCA" terminal create --worktree "$WT" --title "$TITLE" \
  --command "muse ${flags[*]} resume $SESSION" --json 2>/dev/null | python3 -c '
import sys,json
try: print(json.load(sys.stdin)["result"]["terminal"]["handle"])
except Exception: pass')
[[ -n $handle ]] || fail "terminal create failed for session $SESSION"

ready=$("$ORCA" terminal wait --terminal "$handle" --for tui-idle --timeout-ms "$TIMEOUT" --json 2>/dev/null | python3 -c '
import sys,json
try: print("yes" if json.load(sys.stdin)["result"]["wait"]["satisfied"] else "no")
except Exception: print("no")')
[[ $ready == yes ]] || fail "terminal $handle (session $SESSION) not idle; inspect: $ORCA terminal read --terminal $handle (login or trust prompt?); discard: $ORCA terminal close --terminal $handle"

python3 -c 'import sys,json;print(json.dumps({"status":"ready","terminal":sys.argv[1],"session":sys.argv[2],"mode":sys.argv[3]}))' "$handle" "$SESSION" "$MODE"
