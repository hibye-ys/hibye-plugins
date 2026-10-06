#!/usr/bin/env bash
# Regression tests for muse-run.sh / muse-settle.sh against a fake orca (no Orca app needed).
# The fake reads per-subcommand fixtures from $FAKE_DIR/<subcommand>.{out,err,rc}
# and logs every call to $FAKE_DIR/calls.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPTS="$HERE/../skills/muse-delegate/scripts"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
pass=0 fail=0

cat >"$WORK/orca" <<'SH'
#!/usr/bin/env bash
sub=$2; key=$sub
[[ $sub == check && " $* " == *" --ack "* ]] && key=check-ack
echo "$*" >>"$FAKE_DIR/calls"
[[ -f $FAKE_DIR/$key.err ]] && cat "$FAKE_DIR/$key.err" >&2
[[ -f $FAKE_DIR/$key.out ]] && cat "$FAKE_DIR/$key.out"
exit "$(cat "$FAKE_DIR/$key.rc" 2>/dev/null || echo 0)"
SH
chmod +x "$WORK/orca"
export ORCA_BIN="$WORK/orca"

fresh() { export FAKE_DIR="$WORK/case$RANDOM"; mkdir -p "$FAKE_DIR"; : >"$FAKE_DIR/calls"; }
fix() { printf '%s' "$2" >"$FAKE_DIR/$1"; }
check() { # name expected_rc actual_rc output must_contain [must_not_contain]
  local ok=1
  [[ $3 == "$2" ]] || ok=0
  [[ $4 == *"$5"* ]] || ok=0
  [[ -z ${6:-} || $4 != *"$6"* ]] || ok=0
  if (( ok )); then pass=$((pass+1)); echo "PASS $1"
  else fail=$((fail+1)); echo "FAIL $1 (rc=$3 want $2)"; echo "$4" | sed 's/^/    /'; fi
}

READY='{"ok":true,"result":{"dispatchId":"ctx_1","taskId":"task_1","state":"ready","stage":"started"}}'
DONE='{"ok":true,"result":{"dispatch":{"status":"completed"},"projection":{"outcome":"succeeded"}}}'
RUN=("$SCRIPTS/muse-run.sh" --coord H --run R --worktree W --spec s --poll 0 --max-wait 1)

# muse-run: stderr diagnostics must not break a valid receipt
fresh; fix worker-start.out "$READY"; fix worker-start.err "[electron] GPU process warning"; fix worker-show.out "$DONE"
out=$("${RUN[@]}"); check "run: stderr diagnostics ignored" 0 $? "$out" '"dispatchId": "ctx_1"'

# muse-run: unreadable start response is unknown (3), not failed
fresh; fix worker-start.out "garbage"; fix worker-start.rc 1
out=$("${RUN[@]}"); check "run: unreadable start -> unknown" 3 $? "$out" '"status": "unknown"'

# muse-run: an explicit rejection with no effects is a plain failure
fresh; fix worker-start.out '{"ok":false,"error":{"code":"stable_pane_required","data":{"effectsApplied":false}}}'; fix worker-start.rc 1
out=$("${RUN[@]}"); check "run: rejected start -> failed" 1 $? "$out" "stable_pane_required"

# settle: a check error shows Orca's code
fresh; fix check.out '{"ok":false,"error":{"code":"stable_pane_required","message":"no live pane"}}'; fix check.rc 1
out=$("$SCRIPTS/muse-settle.sh" --coord H); check "settle: check error surfaced" 1 $? "$out" "stable_pane_required: no live pane"

# muse-run: rejected start is a failure with the dispatch id kept
fresh; fix worker-start.out '{"ok":true,"result":{"dispatchId":"ctx_2","taskId":"task_2","state":"failed","stage":"agent_readiness"}}'
out=$("${RUN[@]}"); check "run: readiness failure keeps id" 1 $? "$out" '"dispatchId": "ctx_2"'

# muse-run: completed without success is not success
fresh; fix worker-start.out "$READY"; fix worker-show.out '{"ok":true,"result":{"dispatch":{"status":"completed"},"projection":{}}}'
out=$("${RUN[@]}"); check "run: missing outcome -> failure" 1 $? "$out" '"status": "completed"'

# muse-run: --terminal is forwarded for follow-ups
fresh; fix worker-start.out "$READY"; fix worker-show.out "$DONE"
"$SCRIPTS/muse-run.sh" --coord H --run R --worktree W --task t --terminal term_9 --poll 0 --max-wait 1 >/dev/null
out=$(cat "$FAKE_DIR/calls"); check "run: --terminal forwarded without --agent" 0 0 "$out" "--terminal term_9" "--agent"

# muse-run: a structured error without effectsApplied is still a rejection
fresh; fix worker-start.out '{"ok":false,"error":{"code":"invalid_argument","data":{}}}'; fix worker-start.rc 1
out=$("${RUN[@]}"); check "run: invalid_argument -> failed" 1 $? "$out" "invalid_argument"

# muse-run: an error that reports applied effects stays unknown
fresh; fix worker-start.out '{"ok":false,"error":{"code":"partial","data":{"effectsApplied":true}}}'; fix worker-start.rc 1
out=$("${RUN[@]}"); check "run: applied effects -> unknown" 3 $? "$out" '"status": "unknown"'

SETTLE=("$SCRIPTS/muse-settle.sh" --coord H)
OKJ='{"ok":true,"result":{}}'
msg() { printf '{"id":"%s","type":"%s","body":"b","payload":"{\\"dispatchId\\":\\"%s\\",\\"outcome\\":\\"succeeded\\"}"}' "$@"; }

# settle: informational messages do not block the ack
fresh; fix check.out "{\"ok\":true,\"result\":{\"deliveryId\":\"del_1\",\"messages\":[$(msg m1 status ctx_1),$(msg m2 heartbeat ctx_1),$(msg m3 worker_done ctx_1)]}}"
fix check.err '{"_keepalive":true}'; fix check-ack.out "$OKJ"
out=$("${SETTLE[@]}"); check "settle: status/heartbeat still acked" 0 $? "$out" "acked del_1"

# settle: a question holds the ack and asks for a reply
fresh; fix check.out "{\"ok\":true,\"result\":{\"deliveryId\":\"del_2\",\"messages\":[$(msg q1 question ctx_1)]}}"
out=$("${SETTLE[@]}"); check "settle: question holds ack" 2 $? "$out" "rerun with --ack del_2"
calls=$(cat "$FAKE_DIR/calls"); check "settle: no ack call on question" 0 0 "$calls" "check" "--ack"

# settle: release_pending is a failure, not "released"
fresh; fix check.out '{"ok":true,"result":{"messages":[]}}'; fix worker-show.out "$DONE"
fix worker-release.out '{"ok":true,"result":{"dispatchId":"ctx_1","state":"release_pending"}}'
out=$("${SETTLE[@]}" --release ctx_1); check "settle: release_pending fails" 1 $? "$out" "release FAILED ctx_1"

# settle: released state is reported and exits 0
fresh; fix check.out '{"ok":true,"result":{"messages":[]}}'; fix worker-show.out "$DONE"
fix worker-release.out '{"ok":true,"result":{"dispatchId":"ctx_1","state":"released"}}'
out=$("${SETTLE[@]}" --release ctx_1); check "settle: released ok" 0 $? "$out" "released ctx_1"

# settle: an external terminal is retained with a close hint
fresh; fix check.out '{"ok":true,"result":{"messages":[]}}'; fix worker-show.out "$DONE"
fix worker-release.out '{"ok":true,"result":{"dispatchId":"ctx_1","state":"retained","reason":"external_terminal"}}'
out=$("${SETTLE[@]}" --release ctx_1); check "settle: external terminal hint" 0 $? "$out" "terminal close --terminal"

# settle: a failed worker is never released
fresh; fix check.out '{"ok":true,"result":{"messages":[]}}'
fix worker-show.out '{"ok":true,"result":{"dispatch":{"status":"completed"},"projection":{"outcome":"failed"}}}'
out=$("${SETTLE[@]}" --release ctx_1); calls=$(cat "$FAKE_DIR/calls")
check "settle: failed worker skipped" 0 $? "$out" "skip release ctx_1" ; check "settle: no release call" 0 0 "$calls" "worker-show" "worker-release"

# settle: ack failure is reported and exits 1
fresh; fix check.out "{\"ok\":true,\"result\":{\"deliveryId\":\"del_3\",\"messages\":[$(msg m1 worker_done ctx_1)]}}"
fix check-ack.out '{"ok":false,"error":{"code":"stale"}}'; fix check-ack.rc 1
out=$("${SETTLE[@]}"); check "settle: ack failure surfaces" 1 $? "$out" "ack FAILED del_3"

# settle: --ack acknowledges a handled batch first
fresh; fix check.out '{"ok":true,"result":{"messages":[]}}'; fix check-ack.out "$OKJ"
out=$("${SETTLE[@]}" --ack del_2); check "settle: explicit --ack" 0 $? "$out" "acked del_2"

# muse-run: Orca's outcome_unknown recovery is unknown (3), never a safe failure
fresh; fix worker-start.out '{"ok":false,"error":{"code":"runtime_timeout","data":{"orchestrationRequestId":"req_1","recovery":{"disposition":"outcome_unknown","queryCommand":["orca","orchestration","request-show","--request","req_1"]}}}}'; fix worker-start.rc 1
out=$("${RUN[@]}"); check "run: outcome_unknown -> unknown" 3 $? "$out" "request-show --request req_1"

# muse-run: a receipt with state=outcome_unknown is unknown (3), not a plain failure
fresh; fix worker-start.out '{"ok":true,"result":{"dispatchId":"ctx_5","taskId":"t","state":"outcome_unknown","stage":"turn_start"}}'; fix worker-start.rc 1
out=$("${RUN[@]}"); check "run: result outcome_unknown -> unknown" 3 $? "$out" "worker-show --dispatch ctx_5"

# settle: an unreadable worker-show is a failure, not a quiet skip
fresh; fix check.out '{"ok":true,"result":{"messages":[]}}'; fix worker-show.out 'timeout'; fix worker-show.rc 1
out=$("${SETTLE[@]}" --release ctx_1); check "settle: worker-show failure surfaces" 1 $? "$out" "worker-show unreadable"

RESUME=("$SCRIPTS/muse-resume.sh" --worktree W)
export MUSE_SESSIONS_DIR="$WORK/sessions"
D="$MUSE_SESSIONS_DIR/2026/10/06"
session() { # id mode body [dir]
  local dir=${4:-$D/$1}; mkdir -p "$dir"
  printf '%s\n' "{\"payload\":{\"kind\":\"session_opened\",\"record\":{\"session_id\":\"$1\",\"security_mode\":\"$2\"}}}" \
    "{\"payload\":{\"kind\":\"agent_tree_initialized\",\"record\":{\"root_session_id\":\"$1\",\"root_agent_id\":\"$1\"}}}" "$3" >"$dir/session.jsonl"
}
session aaaaaaaa-0001 yolo 'other ctx_0'
session bbbbbbbb-0002 yolo 'x --dispatch-id ctx_7 y'
session cccccccc-0003 default 'x --dispatch-id ctx_8 y'
session dddddddd-0004 yolo 'child repeats ctx_7' "$D/bbbbbbbb-0002/subagent/dddddddd-0004"
session eeeeeeee-0005 yolo 'x ctx_9'; session ffffffff-0006 yolo 'y ctx_9'
TERMJ='{"ok":true,"result":{"terminal":{"handle":"term_r"}}}'
IDLE='{"ok":true,"result":{"wait":{"satisfied":true}}}'

# resume: finds the top-level session by dispatch id, ignoring subagent logs, keeping yolo
fresh; fix create.out "$TERMJ"; fix wait.out "$IDLE"
out=$("${RESUME[@]}" --dispatch ctx_7); rc=$?
check "resume: session found by dispatch" 0 $rc "$(cat "$FAKE_DIR/calls")" "muse --trust-workspace --yolo resume bbbbbbbb-0002"
check "resume: prints handle" 0 $rc "$out" '"terminal": "term_r"'

# resume: a non-yolo session is not given --yolo
fresh; fix create.out "$TERMJ"; fix wait.out "$IDLE"
"${RESUME[@]}" --dispatch ctx_8 >/dev/null
check "resume: keeps original permission mode" 0 0 "$(cat "$FAKE_DIR/calls")" "muse --trust-workspace resume cccccccc-0003" "--yolo"

# resume: ambiguous matches are refused
fresh
out=$("${RESUME[@]}" --dispatch ctx_9); check "resume: ambiguous refused" 1 $? "$out$(cat "$FAKE_DIR/calls")" "ambiguous" "terminal create"

# resume: shell metacharacters in ids are rejected before anything runs
fresh
out=$("${RESUME[@]}" --session 's1; printf PWNED' 2>&1); check "resume: injection rejected" 64 $? "$out$(cat "$FAKE_DIR/calls")" "invalid --session" "create"

# resume: a terminal that never goes idle is a failure with a cleanup hint
fresh; fix create.out "$TERMJ"; fix wait.out '{"ok":true,"result":{"wait":{"satisfied":false}}}'
out=$("${RESUME[@]}" --session aaaaaaaa-0001); check "resume: not idle fails" 1 $? "$out" "terminal close --terminal term_r"

# resume: unknown dispatch fails without creating a terminal
fresh
out=$("${RESUME[@]}" --dispatch ctx_missing); rc=$?
check "resume: unknown dispatch fails" 1 $rc "$out$(cat "$FAKE_DIR/calls")" "no top-level muse session" "terminal create"

echo "---"; echo "passed $pass, failed $fail"
(( fail == 0 ))
