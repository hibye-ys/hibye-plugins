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

# ---- muse-exec.sh against a fake muse (headless path; no real muse needed) ----
cat >"$WORK/muse" <<'SH'
#!/usr/bin/env bash
echo "$*" >>"$FAKE_DIR/calls"
echo "$PWD" >"$FAKE_DIR/cwd"
while [[ $# -gt 0 ]]; do [[ $1 == --prompt-file ]] && cp "$2" "$FAKE_DIR/prompt"; shift; done
echo $$ >"$FAKE_DIR/pid"
# optional stdin read (muse-exec must give muse /dev/null, never the caller's stdin)
[[ -f $FAKE_DIR/exec.stdin ]] && cat >"$FAKE_DIR/stdin_seen"
# optional grandchild that ignores TERM (only KILL on the process group removes it)
[[ -f $FAKE_DIR/exec.grandchild ]] && ( trap '' TERM; sleep 30 & echo $! >"$FAKE_DIR/spid"; echo $BASHPID >"$FAKE_DIR/gpid"; wait ) >/dev/null 2>&1 &
[[ -f $FAKE_DIR/exec.err ]] && cat "$FAKE_DIR/exec.err" >&2
[[ -f $FAKE_DIR/exec.out ]] && cat "$FAKE_DIR/exec.out"
[[ -f $FAKE_DIR/exec.sleep ]] && sleep "$(cat "$FAKE_DIR/exec.sleep")"
exit "$(cat "$FAKE_DIR/exec.rc" 2>/dev/null || echo 0)"
SH
chmod +x "$WORK/muse"
export MUSE_BIN="$WORK/muse" MUSE_EXEC_LOCK_DIR="$WORK/locks" MUSE_EXEC_LOG_DIR="$WORK/logs"
GITENV=(-c user.name=t -c user.email=t@t)
REPO="$WORK/repo"; git init -q "$REPO" 2>/dev/null; git -C "$REPO" "${GITENV[@]}" commit -q --allow-empty -m init
WTREE="$WORK/wt"; mkdir -p "$WTREE"; git -C "$WTREE" init -q -b muse/session-x 2>/dev/null || { git -C "$WTREE" init -q; git -C "$WTREE" checkout -q -b muse/session-x; }
EXEC=("$SCRIPTS/muse-exec.sh" --repo "$REPO")
SID=11111111-2222-3333-4444-555555555555
SID_UNK=99999999-2222-3333-4444-555555555555
git -C "$REPO" worktree add -q -b "muse/session-$SID" "$WORK/wt-sid" 2>/dev/null
SIDWT=$(cd "$WORK/wt-sid" && pwd -P)
TERM_LINE='{"payload_type":"run.terminal.completed","payload":{"kind":"run_terminal","terminal":"completed","text":"all done","reason":"stop"}}'
DONE_OUT=$(printf '%s\n' \
  "{\"payload_type\":\"session.workspace_branch.observed\",\"payload\":{\"record\":{\"workspace_root\":\"$WTREE\"}}}" \
  '{"payload_type":"run.usage","payload":{"models":[{"model":"muse-1","input_tokens":10,"cached_tokens":3,"output_tokens":4}]}}' \
  "$TERM_LINE")
gone() { [[ -s $1 ]] && ! kill -0 "$(cat "$1")" 2>/dev/null && echo gone || echo "alive-or-missing"; }
nocalls() { [[ ! -s $FAKE_DIR/calls ]] && echo none || echo called; }

# exec: a new task runs in its own worktree with the spec in a prompt file
fresh; fix exec.out "$DONE_OUT"
out=$("${EXEC[@]}" --spec "do the thing"); rc=$?
calls=$(cat "$FAKE_DIR/calls")
check "exec: new task completed" 0 $rc "$out" '"status": "completed"'
check "exec: result carries worktree" 0 $rc "$out" "$WTREE"
check "exec: final text reported" 0 $rc "$out" '"text": "all done"'
check "exec: branch reported" 0 $rc "$out" '"branch": "muse/session-x"'
check "exec: usage listed" 0 $rc "$out" '"input_tokens": 10'
check "exec: new task args" 0 $rc "$calls" "exec --json --session-id"
check "exec: new task uses -w create" 0 $rc "$calls" " -w create"
check "exec: spec reaches the prompt file" 0 $rc "$(cat "$FAKE_DIR/prompt")" "do the thing"
check "exec: spec is never a positional arg" 0 $rc "$calls" "--prompt-file" "do the thing"
check "exec: output is one line" 0 $rc "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" "1"

# exec: --spec-file is read into the prompt file
fresh; fix exec.out "$DONE_OUT"; printf 'spec from file\nline2' >"$WORK/spec.txt"
out=$("${EXEC[@]}" --spec-file "$WORK/spec.txt"); rc=$?
check "exec: --spec-file completes" 0 $rc "$out" '"status": "completed"'
check "exec: --spec-file content forwarded" 0 $rc "$(cat "$FAKE_DIR/prompt")" "line2"

# exec: a follow-up forwards the session, runs from the repo, never passes -w, reports the session worktree
fresh; fix exec.out "$TERM_LINE"
out=$("${EXEC[@]}" --spec "more" --session "$SID"); rc=$?
check "exec: follow-up forwards session, no -w" 0 $rc "$(cat "$FAKE_DIR/calls")" "--session-id $SID" " -w create"
check "exec: follow-up reports its worktree" 0 $rc "$out" "\"worktree\": \"$SIDWT\""
check "exec: follow-up reports its branch" 0 $rc "$out" "\"branch\": \"muse/session-$SID\""
check "exec: follow-up runs with cwd = repo" 0 $rc "$(cat "$FAKE_DIR/cwd")" "$(cd "$REPO" && pwd)"

# exec: this run's own workspace record wins over the git lookup
fresh; fix exec.out "$DONE_OUT"
out=$("${EXEC[@]}" --spec "more" --session "$SID"); check "exec: JSONL worktree preferred" 0 $? "$out" "\"worktree\": \"$WTREE\""

# exec: an unknown --session never reaches muse
fresh
out=$("${EXEC[@]}" --spec s --session "$SID_UNK" 2>&1); check "exec: unknown session -> 64" 64 $? "$out" "no worktree on branch muse/session-$SID_UNK"
check "exec: unknown session never starts muse" 0 0 "$(nocalls)" "none"

# exec: --session + --no-worktree runs in the repo without -w
fresh; fix exec.out "$TERM_LINE"
out=$("${EXEC[@]}" --spec s --session "$SID_UNK" --no-worktree); rc=$?
check "exec: --session + --no-worktree runs" 0 $rc "$out" '"status": "completed"'
check "exec: --session + --no-worktree has no -w" 0 $rc "$(cat "$FAKE_DIR/calls")" "--session-id $SID_UNK" " -w create"
check "exec: --session + --no-worktree has no worktree" 0 $rc "$out" '"worktree": null'

# exec: a terminal that is not completed fails
fresh; fix exec.out '{"payload_type":"run.terminal.failed","payload":{"kind":"run_terminal","terminal":"failed","text":"","reason":"boom"}}'
out=$("${EXEC[@]}" --spec s); check "exec: terminal not completed -> failed" 1 $? "$out" '"status": "failed"'

# exec: nonzero muse exit fails even with a completed terminal
fresh; fix exec.out "$DONE_OUT"; fix exec.rc 7
out=$("${EXEC[@]}" --spec s); check "exec: muse rc!=0 -> failed" 1 $? "$out" '"status": "failed"'

# exec: no terminal record is unknown
fresh; fix exec.out 'garbage not json'
out=$("${EXEC[@]}" --spec s); check "exec: no terminal -> unknown" 3 $? "$out" '"status": "unknown"'

# exec: stderr noise does not affect parsing
fresh; fix exec.out "$DONE_OUT"; fix exec.err 'muse: session worktree retained at /x (dirty worktree retained)'
out=$("${EXEC[@]}" --spec s); check "exec: stderr ignored" 0 $? "$out" '"status": "completed"'

# exec: timeout kills the whole process group (including a TERM-ignoring grandchild) and exits 2
fresh; fix exec.sleep 30; : >"$FAKE_DIR/exec.grandchild"
start=$SECONDS
out=$(MUSE_EXEC_KILL_GRACE=1 "${EXEC[@]}" --spec s --max-wait 1); rc=$?
elapsed=$((SECONDS - start))
check "exec: timeout -> exit 2" 2 $rc "$out" '"status": "timeout"'
check "exec: timeout is prompt" 0 $(( elapsed <= 8 ? 0 : 1 )) "x" "x"
check "exec: timed-out process is gone" 0 0 "$(gone "$FAKE_DIR/pid")" "gone"
check "exec: TERM-ignoring grandchild is gone" 0 0 "$(gone "$FAKE_DIR/gpid")" "gone"
check "exec: grandchild's sleep is gone" 0 0 "$(gone "$FAKE_DIR/spid")" "gone"

# exec: a terminal record beats the timeout flag
fresh; fix exec.out "$DONE_OUT"; fix exec.sleep 30
out=$(MUSE_EXEC_KILL_GRACE=1 "${EXEC[@]}" --spec s --max-wait 1); check "exec: terminal beats timeout" 0 $? "$out" '"status": "completed"'

# exec: SIGTERM / SIGHUP to the script release the lock and leave no fake processes
for SIG in TERM HUP; do
  fresh; fix exec.sleep 30; : >"$FAKE_DIR/exec.grandchild"
  MUSE_EXEC_KILL_GRACE=1 "${EXEC[@]}" --spec s --session "$SID" --no-worktree >"$FAKE_DIR/sig.out" 2>/dev/null & SPID=$!
  for _ in $(seq 1 50); do [[ -s $FAKE_DIR/gpid && -s $FAKE_DIR/spid ]] && break; sleep 0.1; done
  [[ -d $WORK/locks/$SID ]] && held=held || held=missing
  kill "-$SIG" "$SPID"; wait "$SPID" 2>/dev/null; rc=$?
  [[ -e $WORK/locks/$SID ]] && lock_state=left || lock_state=released
  check "exec: $SIG while running held the lock" 0 0 "$held" "held"
  check "exec: $SIG releases the lock" 0 0 "$lock_state" "released"
  check "exec: $SIG leaves no fake muse" 0 0 "$(gone "$FAKE_DIR/pid")" "gone"
  check "exec: $SIG leaves no grandchild" 0 0 "$(gone "$FAKE_DIR/gpid")$(gone "$FAKE_DIR/spid")" "gonegone"
  check "exec: $SIG exit code" 0 0 "$rc" "$([[ $SIG == TERM ]] && echo 143 || echo 129)"
  check "exec: $SIG prints an interrupted line" 0 0 "$(cat "$FAKE_DIR/sig.out")" '"status": "interrupted"'
done

# exec: muse never inherits the caller's stdin
fresh; fix exec.out "$DONE_OUT"; : >"$FAKE_DIR/exec.stdin"
out=$(printf SECRET | "${EXEC[@]}" --spec s); rc=$?
check "exec: completes with piped stdin" 0 $rc "$out" '"status": "completed"'
check "exec: caller stdin not passed to muse" 0 0 "[$(cat "$FAKE_DIR/stdin_seen" 2>/dev/null)]" "[]"

# exec: group members muse leaves behind die after a normal exit
fresh; fix exec.out "$DONE_OUT"; : >"$FAKE_DIR/exec.grandchild"
out=$(MUSE_EXEC_KILL_GRACE=1 "${EXEC[@]}" --spec s); rc=$?
check "exec: normal exit with leftover child completes" 0 $rc "$out" '"status": "completed"'
check "exec: leftover group members are gone" 0 0 "$(gone "$FAKE_DIR/gpid")$(gone "$FAKE_DIR/spid")" "gonegone"

# exec: a session whose worktree directory was deleted is refused (prunable worktree)
SID_GONE=22222222-2222-3333-4444-555555555555
git -C "$REPO" worktree add -q -b "muse/session-$SID_GONE" "$WORK/wt-gone" 2>/dev/null; rm -rf "$WORK/wt-gone"
fresh
out=$("${EXEC[@]}" --spec s --session "$SID_GONE" 2>&1); rc=$?
check "exec: deleted worktree -> 64" 64 $rc "$out" "is gone"
check "exec: deleted worktree never calls muse" 0 0 "$(nocalls)" "none"

# exec: shell metacharacters in --session are rejected before anything runs
fresh
out=$("${EXEC[@]}" --spec s --session 's1; printf PWNED' 2>&1); check "exec: injection rejected" 64 $? "$out" "invalid --session"
check "exec: muse not called on bad session" 0 0 "$(nocalls)" "none"

# exec: --no-worktree on a new task drops -w
fresh; fix exec.out "$DONE_OUT"
"${EXEC[@]}" --spec s --no-worktree >/dev/null
check "exec: --no-worktree omits -w" 0 0 "$(cat "$FAKE_DIR/calls")" "exec --json --session-id" " -w create"

# exec: missing spec / non-git repo -> 64
fresh
out=$("${EXEC[@]}" 2>&1); check "exec: missing spec -> 64" 64 $? "$out" "need a non-empty"
out=$("$SCRIPTS/muse-exec.sh" --repo "$WORK" --spec s 2>&1); check "exec: non-git repo -> 64" 64 $? "$out" "not a git work tree"
out=$("${EXEC[@]}" --spec-file "$WORK/nope" 2>&1); check "exec: unreadable spec file -> 64" 64 $? "$out" "unreadable"

# exec: a live lock makes the session busy and muse is not started
fresh; fix exec.out "$DONE_OUT"
mkdir -p "$WORK/locks/$SID"; sleep 30 & LIVE=$!; echo $LIVE >"$WORK/locks/$SID/pid"
out=$("${EXEC[@]}" --spec s --session "$SID"); rc=$?
check "exec: live lock -> busy" 1 $rc "$out" '"status": "busy"'
check "exec: busy never starts muse" 0 0 "$(nocalls)" "none"
[[ -d $WORK/locks/$SID ]] && lock_kept=kept || lock_kept=lost
check "exec: busy leaves the other run's lock" 0 0 "$lock_kept" "kept"
# a lock whose script died but whose muse (child) still lives is also busy
echo 999999 >"$WORK/locks/$SID/pid"; echo $LIVE >"$WORK/locks/$SID/child"
out=$("${EXEC[@]}" --spec s --session "$SID"); check "exec: live muse child keeps the lock busy" 1 $? "$out" '"status": "busy"'
kill "$LIVE" 2>/dev/null; wait "$LIVE" 2>/dev/null; rm -rf "$WORK/locks/$SID"

# exec: a lock dir without a pid file yet is busy, not reclaimed
fresh; fix exec.out "$DONE_OUT"
mkdir -p "$WORK/locks/$SID"
out=$("${EXEC[@]}" --spec s --session "$SID"); check "exec: pid-less lock -> busy" 1 $? "$out" '"status": "busy"'
check "exec: pid-less lock never starts muse" 0 0 "$(nocalls)" "none"
rmdir "$WORK/locks/$SID"

# exec: a stale lock (pid of a reaped process) is reclaimed, and the lock is released afterwards
fresh; fix exec.out "$DONE_OUT"
true & DEAD=$!; wait "$DEAD"
mkdir -p "$WORK/locks/$SID"; echo "$DEAD" >"$WORK/locks/$SID/pid"
out=$("${EXEC[@]}" --spec s --session "$SID"); rc=$?
check "exec: stale lock reclaimed" 0 $rc "$out" '"status": "completed"'
[[ -e $WORK/locks/$SID ]] && lock_state=left || lock_state=released
check "exec: lock released after run" 0 0 "$lock_state" "released"
check "exec: no stale lock debris" 0 0 "$(ls "$WORK/locks" | wc -l | tr -d ' ')" "0"

# exec: two runs in the same second get distinct log files
fresh; fix exec.out "$DONE_OUT"
o1=$("${EXEC[@]}" --spec s --session "$SID" --no-worktree); o2=$("${EXEC[@]}" --spec s --session "$SID" --no-worktree)
l1=$(python3 -I -c 'import sys,json;print(json.loads(sys.argv[1])["log"])' "$o1"); l2=$(python3 -I -c 'import sys,json;print(json.loads(sys.argv[1])["log"])' "$o2")
[[ $l1 != "$l2" ]] && distinct=distinct || distinct=same
check "exec: log names are unique per run" 0 0 "$distinct" "distinct"

# exec: unwritable lock/log dirs -> failed (1) with one JSON line
fresh
out=$(MUSE_EXEC_LOCK_DIR=/dev/null/x "${EXEC[@]}" --spec s); check "exec: lock dir failure -> failed" 1 $? "$out" '"status": "failed"'
check "exec: lock dir failure never starts muse" 0 0 "$(nocalls)" "none"

# exec: --trust, extra args after --, and a spec that looks like a flag
fresh; fix exec.out "$DONE_OUT"
"${EXEC[@]}" --spec "--not-a-flag" --trust -- --approval-mode never >/dev/null
calls=$(cat "$FAKE_DIR/calls")
check "exec: --trust adds --trust-workspace" 0 0 "$calls" "--trust-workspace"
check "exec: extra args forwarded" 0 0 "$calls" "--approval-mode never --prompt-file"
check "exec: flag-like spec goes via prompt file" 0 0 "$(cat "$FAKE_DIR/prompt")" "--not-a-flag"
check "exec: flag-like spec not in argv" 0 0 "$calls" "--prompt-file" "--not-a-flag"

echo "---"; echo "passed $pass, failed $fail"
(( fail == 0 ))
