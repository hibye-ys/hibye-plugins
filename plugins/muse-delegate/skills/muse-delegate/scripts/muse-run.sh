#!/usr/bin/env bash
# muse-run.sh — start one muse worker via Orca, poll until settled, print a one-line JSON result.
# No LLM involved: run it in the background to fan out several workers in parallel.
#
# Usage: muse-run.sh --coord <handle> --run <run_id> --worktree <selector> (--spec <text> | --spec-file <file>)
#                    [--task <task_id> --retry-of <dispatch_id>] [--terminal <worker_handle>]
#                    [--poll <sec=10>] [--max-wait <sec=900>]
#   --terminal reuses a settled worker's terminal (its context) for a follow-up task.
# Exit: 0 succeeded, 1 worker failed / start rejected, 2 timeout (worker may still be running),
#       3 unknown (start response unreadable; a worker may be running), 64 usage.
# Only stdout is parsed; Orca writes diagnostics to stderr, which is kept in a temp file on failure.
set -uo pipefail

ORCA=${ORCA_BIN:-orca}
COORD= RUN= WT= SPEC= TASK= RETRY= TERM= POLL=10 MAXWAIT=900
while [[ $# -gt 0 ]]; do
  case "$1" in
    --coord) COORD=$2; shift 2;;
    --run) RUN=$2; shift 2;;
    --worktree) WT=$2; shift 2;;
    --spec) SPEC=$2; shift 2;;
    --spec-file) SPEC=$(<"$2"); shift 2;;
    --task) TASK=$2; shift 2;;
    --retry-of) RETRY=$2; shift 2;;
    --terminal) TERM=$2; shift 2;;
    --poll) POLL=$2; shift 2;;
    --max-wait) MAXWAIT=$2; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 64;;
  esac
done
[[ -n $COORD && -n $RUN && -n $WT ]] || { echo "need --coord --run --worktree" >&2; exit 64; }
[[ -n $SPEC || -n $TASK ]] || { echo "need --spec/--spec-file or --task" >&2; exit 64; }

args=(orchestration worker-start --from "$COORD" --run "$RUN" --worktree "$WT" --json)
if [[ -n $TASK ]]; then args+=(--task "$TASK"); else args+=(--spec "$SPEC"); fi
[[ -n $RETRY ]] && args+=(--retry-of "$RETRY")
# A reused terminal already runs its agent; Orca rejects --agent together with --terminal.
if [[ -n $TERM ]]; then args+=(--terminal "$TERM"); else args+=(--agent muse); fi

errlog=$(mktemp "${TMPDIR:-/tmp}/muse-run.XXXXXX")
start_json=$("$ORCA" "${args[@]}" 2>"$errlog"); start_rc=$?
# PARSED: ok (receipt), rejected (Orca says nothing was applied; STAGE holds the error code), no (unreadable or
# outcome unknown; STAGE holds Orca's recovery query command when it gave one)
read -r PARSED DISPATCH TASK_ID STATE STAGE < <(python3 -c '
import sys,json
try:
    d=json.loads(sys.stdin.read())
except Exception:
    d=None
err=(d or {}).get("error") or {}
data=err.get("data") or {}
rec=data.get("recovery") or {}
if d and d.get("ok") and isinstance(d.get("result"),dict):
    r=d["result"]
    print("ok",r.get("dispatchId") or "-",r.get("taskId") or "-",r.get("state") or "-",r.get("stage") or "-")
elif d and d.get("ok") is False and data.get("effectsApplied") is not True and not rec and not data.get("orchestrationRequestId"):
    # A structured error is an explicit rejection unless Orca says effects were applied or the outcome is unknown.
    print("rejected - - -",err.get("code") or "-")
else:
    q=rec.get("queryCommand")
    q=" ".join(q) if isinstance(q,list) else (q or "-")
    print("no",rec.get("dispatchId") or "-","- -",q.replace(" "," "))' <<<"$start_json")
STAGE=${STAGE//$' '/ }

emit() { # status outcome note
  python3 -c '
import sys,json
k=["dispatchId","taskId","status","outcome","note"]
print(json.dumps(dict(zip(k,sys.argv[1:]))))' "$DISPATCH" "$TASK_ID" "$1" "$2" "$3"
}

if [[ $PARSED == rejected ]]; then
  emit start_failed failed "orca rejected worker-start with $STAGE (nothing started; see: $errlog)"
  exit 1
fi
if [[ $PARSED != ok ]]; then
  # Never report this as a plain failure: the worker may have started before the response was lost.
  hint="find the worker with: $ORCA orchestration worker-list --run $RUN --json"
  [[ $STAGE != - ]] && hint="Orca says the outcome is unknown; inspect with: $STAGE (retry only with Orca's --retry-request)"
  emit unknown - "start outcome unknown (rc=$start_rc, stderr: $errlog); $hint"
  exit 3
fi
if [[ $STATE == outcome_unknown ]]; then
  # Input may have reached the worker without Orca seeing the turn start; it may be running.
  emit unknown - "start outcome unknown (stage=$STAGE, stderr: $errlog); inspect: $ORCA orchestration worker-show --dispatch $DISPATCH --json before any retry"
  exit 3
fi
if [[ $start_rc -ne 0 || $STATE != ready || $DISPATCH == - ]]; then
  emit start_failed failed "rc=$start_rc state=$STATE stage=$STAGE (stderr: $errlog; inspect: $ORCA orchestration worker-show --dispatch $DISPATCH)"
  exit 1
fi
rm -f "$errlog"

waited=0
while (( waited < MAXWAIT )); do
  sleep "$POLL"; waited=$((waited + POLL))
  read -r STATUS OUTCOME < <("$ORCA" orchestration worker-show --dispatch "$DISPATCH" --json 2>/dev/null | python3 -c '
import sys,json
try:
    r=json.loads(sys.stdin.read())["result"]
    print(r["dispatch"].get("status") or "-",(r.get("projection") or {}).get("outcome") or "-")
except Exception:
    print("- -")')
  case "$STATUS" in
    completed)
      if [[ $OUTCOME == succeeded ]]; then
        emit completed "$OUTCOME" "verify acceptance, then muse-settle.sh --release $DISPATCH"; exit 0
      fi
      emit completed "$OUTCOME" "worker did not report success; inspect with worker-show"; exit 1;;
    failed|cancelled|abandoned|timed_out) emit "$STATUS" "$OUTCOME" "worker did not succeed"; exit 1;;
  esac
done
emit timeout - "still running after ${MAXWAIT}s; poll with worker-show --dispatch $DISPATCH"
exit 2
