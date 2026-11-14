#!/usr/bin/env bash
# muse-exec.sh — run one muse task headless (`muse exec --json`), no Orca. Prints a one-line JSON result.
# No LLM involved: run it in the background to fan out several tasks in parallel.
#
# Usage: muse-exec.sh --repo <path> (--spec <text> | --spec-file <file>)
#                     [--session <uuid>] [--no-worktree] [--trust] [--max-wait <sec=1800>]
#                     [-- <extra muse exec args>]
#   New task (no --session): a fresh session id; runs in its own worktree (-w create) unless --no-worktree
#     (then it runs in the repo itself: read-only tasks only).
#   Follow-up (--session <lowercase uuid>): continues that conversation and reuses its worktree (found as the
#     worktree on branch muse/session-<id>; unknown session -> exit 64). Never passes -w. --no-worktree here
#     means the session was started without a worktree and runs in the repo.
#   --trust adds --trust-workspace (Muse may use its own subagents; loads the workspace's skills and rules).
#   MUSE_BIN overrides the muse binary. The spec always goes through --prompt-file.
# Muse leaves its edits uncommitted in the worktree; the caller commits or copies them.
# Exit: 0 completed, 1 failed or busy (same session already running), 2 timeout (process group killed; the
#       worktree may hold partial changes, continue with --session), 3 unknown (no parseable terminal
#       record), 64 usage; HUP/INT/TERM print status "interrupted" and exit 129/130/143.
# Only stdout JSONL is parsed; stderr is kept in a log file for diagnostics.
set -uo pipefail

MUSE=${MUSE_BIN:-muse}
LOCK_ROOT=${MUSE_EXEC_LOCK_DIR:-${TMPDIR:-/tmp}/muse-exec-locks}
LOG_DIR=${MUSE_EXEC_LOG_DIR:-${TMPDIR:-/tmp}/muse-exec}
GRACE=${MUSE_EXEC_KILL_GRACE:-5}
REPO= SPEC= HAVE_SPEC=0 SESSION= NO_WT=0 TRUST=0 MAXWAIT=1800 EXTRA=()

die64() { echo "muse-exec: $*" >&2; exit 64; }
val() { [[ $# -ge 2 ]] || die64 "missing value for $1"; }

# One-line JSON for runs that never reached muse (or whose result could not be parsed).
emit_simple() { # status note
  python3 -I -c '
import sys,json
print(json.dumps({"session":sys.argv[1],"status":sys.argv[2],"terminal":None,"text":"","worktree":None,"branch":None,
  "usage":[],"log":None,"stderr":None,"note":sys.argv[3]}))' "${SESSION:-}" "$1" "$2" 2>/dev/null && return 0
  local n=${2//[\"\\]/\'}
  printf '{"session": "%s", "status": "%s", "terminal": null, "text": "", "worktree": null, "branch": null, "usage": [], "log": null, "stderr": null, "note": "%s"}\n' "${SESSION:-}" "$1" "$n"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) val "$@"; REPO=$2; shift 2;;
    --spec) val "$@"; SPEC=$2; HAVE_SPEC=1; shift 2;;
    --spec-file) val "$@"; [[ -f $2 && -r $2 ]] || die64 "unreadable --spec-file: $2"; SPEC=$(<"$2"); HAVE_SPEC=1; shift 2;;
    --session) val "$@"; SESSION=$2; shift 2;;
    --no-worktree) NO_WT=1; shift;;
    --trust) TRUST=1; shift;;
    --max-wait) val "$@"; MAXWAIT=$2; shift 2;;
    --) shift; EXTRA=("$@"); break;;
    *) die64 "unknown arg: $1";;
  esac
done

[[ -n $REPO ]] || die64 "need --repo"
(( HAVE_SPEC )) && [[ -n $SPEC ]] || die64 "need a non-empty --spec/--spec-file"
[[ $MAXWAIT =~ ^[0-9]+$ && $MAXWAIT -ge 1 ]] || die64 "invalid --max-wait: $MAXWAIT"
[[ $GRACE =~ ^[0-9]+$ ]] || die64 "invalid MUSE_EXEC_KILL_GRACE: $GRACE"
if [[ -n $SESSION ]]; then
  [[ $SESSION =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || die64 "invalid --session (need a lowercase uuid): $SESSION"
fi
[[ $(git -C "$REPO" rev-parse --is-inside-work-tree 2>/dev/null) == true ]] || die64 "--repo is not a git work tree: $REPO"
REPO=$(cd "$REPO" && pwd)

NEW=0 EXPECT_WT=
if [[ -z $SESSION ]]; then
  NEW=1
  SESSION=$(python3 -I -c 'import uuid; print(uuid.uuid4())') || { emit_simple failed "cannot generate a session id (python3 missing?)"; exit 1; }
elif (( ! NO_WT )); then
  # A follow-up must land in its own worktree; a mistyped id would otherwise run muse in the main checkout.
  EXPECT_WT=$(git -C "$REPO" worktree list --porcelain 2>/dev/null | awk -v b="refs/heads/muse/session-$SESSION" '
    /^worktree /{p=substr($0,10)} $0=="branch " b {print p; exit}')
  [[ -n $EXPECT_WT ]] || die64 "no worktree on branch muse/session-$SESSION in $REPO: mistyped session? (a session started without a worktree needs --no-worktree)"
  [[ -d $EXPECT_WT ]] || die64 "worktree for muse/session-$SESSION is gone ($EXPECT_WT); run git worktree prune or start a new task"
fi

LOCK=$LOCK_ROOT/$SESSION
OWN_LOCK=0 PROMPT= CHILD=
CHILD_RC=0

stop_group() { # TERM the muse process group, wait out the grace period, then KILL it unconditionally
  [[ -n $CHILD ]] || return 0
  local g=0
  kill -TERM -- "-$CHILD" 2>/dev/null
  while (( g < GRACE )) && kill -0 -- "-$CHILD" 2>/dev/null; do sleep 1; g=$((g + 1)); done
  kill -KILL -- "-$CHILD" 2>/dev/null
  return 0
}
cleanup() {
  [[ -n $PROMPT ]] && rm -f "$PROMPT"
  (( OWN_LOCK )) && rm -rf "$LOCK"
}
on_signal() { # exit code
  stop_group
  emit_simple interrupted "interrupted by a signal; muse process group stopped. The worktree may hold partial changes; continue with --session $SESSION"
  exit "$1"
}
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

mkdir -p "$LOCK_ROOT" "$LOG_DIR" 2>/dev/null || { emit_simple failed "cannot create lock/log dirs: $LOCK_ROOT $LOG_DIR"; exit 1; }
EPOCH=$(date +%s)
LOG=$LOG_DIR/$SESSION-$EPOCH-$$.jsonl
ERR=$LOG_DIR/$SESSION-$EPOCH-$$.err

# A lock is live while the script, muse, or anything left in muse's process group is alive. A lock dir whose
# pid file is not written yet counts as live (its owner is mid-startup) unless it is over a minute old.
lock_live() { # dir
  local d=$1 p c
  if [[ ! -f $d/pid ]]; then
    [[ -n $(find "$d" -maxdepth 0 -mmin +1 2>/dev/null) ]] && return 1
    return 0
  fi
  p=$(cat "$d/pid" 2>/dev/null); c=$(cat "$d/child" 2>/dev/null)
  [[ $p =~ ^[0-9]+$ ]] && kill -0 "$p" 2>/dev/null && return 0
  [[ $c =~ ^[0-9]+$ ]] && { kill -0 "$c" 2>/dev/null || kill -0 -- "-$c" 2>/dev/null; } && return 0
  return 1
}
busy() { emit_simple busy "session already running (lock $LOCK); wait for it, never run one session twice at once"; exit 1; }

if ! mkdir "$LOCK" 2>/dev/null; then
  lock_live "$LOCK" && busy
  # Stale: move it aside (only one reclaimer wins the mv), then take the lock afresh.
  judged=$(cat "$LOCK/pid" 2>/dev/null)
  aside="$LOCK.stale.$$.$RANDOM"
  mv "$LOCK" "$aside" 2>/dev/null || busy
  if [[ $(cat "$aside/pid" 2>/dev/null) != "$judged" ]]; then
    mv "$aside" "$LOCK" 2>/dev/null || true   # we moved a lock that was re-taken meanwhile; put it back
    busy
  fi
  rm -rf "$aside"
  mkdir "$LOCK" 2>/dev/null || busy
fi
OWN_LOCK=1
echo $$ >"$LOCK/pid"

PROMPT=$(mktemp "${TMPDIR:-/tmp}/muse-exec-prompt.XXXXXX") || { emit_simple failed "mktemp failed"; exit 1; }
printf '%s' "$SPEC" >"$PROMPT"

cmd=("$MUSE" exec --json --session-id "$SESSION")
(( NEW && ! NO_WT )) && cmd+=(-w create)
(( TRUST )) && cmd+=(--trust-workspace)
cmd+=("${EXTRA[@]+"${EXTRA[@]}"}" --prompt-file "$PROMPT")

# Monitor mode puts the background job in its own process group (pgid == pid), so the whole tree can be signalled.
set -m
# stdin is /dev/null: monitor mode would otherwise hand muse the caller's stdin (hang, or SIGTTIN on a tty).
( cd "$REPO" && exec "${cmd[@]}" ) </dev/null >"$LOG" 2>"$ERR" &
CHILD=$!
set +m
echo "$CHILD" >"$LOCK/child"

TIMEDOUT=0
SECONDS=0
while kill -0 "$CHILD" 2>/dev/null; do
  if (( SECONDS >= MAXWAIT )); then
    TIMEDOUT=1
    stop_group
    break
  fi
  sleep 0.2
done
wait "$CHILD" 2>/dev/null; CHILD_RC=$?
stop_group  # anything muse left behind in its group dies before the lock is released
CHILD=

read -r -d '' PY <<'EOF'
import sys, json, os, subprocess
session, log, err, rc, timedout, maxwait, expect_wt = sys.argv[1:8]
rc = int(rc); timedout = timedout == "1"

def records(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if isinstance(d, dict) and isinstance(d.get("payload"), dict):
                    yield d.get("payload_type"), d["payload"]
    except OSError:
        return

terminal = None
usage = {}
worktree = None
for pt, p in records(log):
    if p.get("kind") == "run_terminal":
        terminal = p
    elif pt == "run.usage":
        for m in p.get("models") or []:
            if isinstance(m, dict) and m.get("model"):
                u = usage.setdefault(m["model"], [0, 0])
                u[0] += int(m.get("input_tokens") or 0)
                u[1] += int(m.get("output_tokens") or 0)
    elif pt == "session.workspace_branch.observed":
        r = (p.get("record") or {}).get("workspace_root")
        if r:
            worktree = r
worktree = worktree or expect_wt or None
branch = None
if worktree and os.path.isdir(worktree):
    try:
        b = subprocess.run(["git", "-C", worktree, "branch", "--show-current"], capture_output=True, text=True, timeout=20).stdout.strip()
        branch = b or None
    except Exception:
        pass

tname = terminal.get("terminal") if terminal else None
text = (terminal.get("text") or "") if terminal else ""
if terminal is not None and timedout:
    rc = 0  # the run finished its own way; the nonzero rc is only our kill
if terminal is None and timedout:
    status, code = "timeout", 2
    note = ("killed after %ss; the worktree may hold partial changes. Inspect it, then continue with --session %s" % (maxwait, session))
elif terminal is None and rc == 0:
    status, code = "unknown", 3
    note = "muse exited 0 without a terminal record; inspect the log and stderr before any retry"
elif terminal is None:
    status, code = "failed", 1
    note = "muse exited %d without a terminal record; see stderr" % rc
elif tname == "completed" and rc == 0:
    status, code = "completed", 0
    note = "muse leaves edits uncommitted: verify acceptance in the worktree, commit there, integrate the branch, then remove the worktree"
elif tname == "completed":
    status, code = "failed", 1
    note = "terminal record says completed but muse exited %d; see stderr" % rc
else:
    status, code = "failed", 1
    note = "terminal=%s reason=%s; see log/stderr" % (tname, terminal.get("reason"))
print(json.dumps({"session": session, "status": status, "terminal": tname, "text": text, "worktree": worktree,
                  "branch": branch, "usage": [{"model": k, "input_tokens": v[0], "output_tokens": v[1]} for k, v in usage.items()],
                  "log": log, "stderr": err, "note": note}, ensure_ascii=False))
sys.exit(code)
EOF
result=$(python3 -I -c "$PY" "$SESSION" "$LOG" "$ERR" "$CHILD_RC" "$TIMEDOUT" "$MAXWAIT" "$EXPECT_WT" 2>/dev/null)
rc=$?
if [[ -z $result ]]; then
  emit_simple unknown "could not parse muse output (muse rc=$CHILD_RC, log: $LOG, stderr: $ERR)"
  rc=3
else
  printf '%s\n' "$result"
fi
trap - EXIT
cleanup
exit "$rc"
