#!/bin/bash
# Plugin lifecycle dispatcher. Runtime code is owned by the globally installed
# plugin; repositories own only STATE.md, docs/state/**, and optional .staterc.

set -u

# 독립 검증 세션(state-verify.mjs 가 띄운 중첩 claude/codex) 안에서는 어떤 STATE 훅도 돌지 않는다 —
# 주입·기준점·Stop 판정도, 검사의 재귀적 시작도 없다.
[ -n "${STATE_LEDGER_VERIFY_CHILD:-}" ] && exit 0

mode="${1:-}"
case "$mode" in
  session-start) hook_script="session-start-state-inject.sh" ;;
  turn-start) hook_script="turn-start-state-snapshot.sh" ;;
  stamp) hook_script="post-edit-state-stamp.sh" ;;
  stop) hook_script="stop-state-reminder.sh" ;;
  *) exit 0 ;;
esac

command -v git >/dev/null 2>&1 || exit 0

input=""
if [ ! -t 0 ]; then
  input=$(cat 2>/dev/null || true)
fi

# 세션 자기 checkout 을 고른다. Claude 데스크톱 앱은 git worktree 세션에도 CLAUDE_PROJECT_DIR 을
# primary checkout 으로 넘기므로, 그것을 먼저 쓰면 다른 브랜치(main)의 STATE 를 주입·스탬프·판정한다.
# 반대로 hook 입력의 cwd 는 에이전트가 추가 작업 디렉터리(다른 저장소)로 cd 하면 따라 움직이므로,
# cwd 만 믿으면 엉뚱한 저장소를 건드리거나 원장이 없다며 조용히 멈춘다.
# 규칙: HOOK_PROJECT_DIR(adapter 명시)이 있으면 그대로. 아니면
#   here    = hook 입력 cwd → $PWD 순서로 첫 git toplevel
#   project = CLAUDE_PROJECT_DIR 의 git toplevel
#   pinned  = 이 세션이 앞서 고정해 둔 root (아직 존재하고 git toplevel 이 자기 자신일 때만)
#   anchor  = project, 없으면 pinned
# here 가 있고 anchor 가 없거나 here 와 같은 저장소(git common dir 동일, worktree 는 달라도 됨)이면 here 를 쓰고 고정한다.
# 그렇지 않으면 pinned → project → here 순서 — cwd 가 다른 저장소로 나가도 세션의 checkout 에 머문다.
toplevel_of() {
  [ -n "$1" ] && [ -d "$1" ] || return 1
  git -C "$1" rev-parse --show-toplevel 2>/dev/null
}
# 같은 저장소 판정: git common dir 을 절대·물리 경로로 풀어 비교한다 (상대 경로로 나올 수 있다).
common_dir_of() {
  local dir
  dir=$(git -C "$1" rev-parse --git-common-dir 2>/dev/null) || return 1
  case "$dir" in /*) ;; *) dir="$1/$dir" ;; esac
  (CDPATH= cd -- "$dir" 2>/dev/null && pwd -P)
}
same_repository() {
  local a b
  a=$(common_dir_of "$1") && b=$(common_dir_of "$2") && [ -n "$a" ] && [ "$a" = "$b" ]
}
root=""
if [ -n "${HOOK_PROJECT_DIR:-}" ]; then
  root=$(toplevel_of "$HOOK_PROJECT_DIR" || true)
else
  input_cwd=""
  session_id=""
  if [ -n "$input" ] && command -v jq >/dev/null 2>&1; then
    input_cwd=$(printf '%s' "$input" | jq -r 'if type == "object" and (.cwd | type) == "string" then .cwd else empty end' 2>/dev/null || true)
    session_id=$(printf '%s' "$input" | jq -r 'if type == "object" then (.session_id // .sessionID // .sessionId) else empty end | if type == "string" then . else empty end' 2>/dev/null || true)
  fi
  here=""
  for candidate in "$input_cwd" "$PWD"; do
    here=$(toplevel_of "$candidate" || true)
    [ -n "$here" ] && break
  done
  project=$(toplevel_of "${CLAUDE_PROJECT_DIR:-}" || true)

  # 세션 고정: 세션 id 해시로 root 를 임시 데이터 디렉터리에 적어 둔다. jq·세션 id 가 없으면 고정 없이 동작한다.
  pin_dir="${STATE_HOOK_DATA_DIR:-${TMPDIR:-/tmp}/state-ledger-hooks}"
  pin_file=""
  pinned=""
  if [ -n "$session_id" ] && command -v jq >/dev/null 2>&1; then
    pin_hash=$(printf '%s' "$session_id" | git hash-object --stdin 2>/dev/null || true)
    [ -n "$pin_hash" ] && pin_file="$pin_dir/root-$pin_hash.json"
  fi
  if [ -n "$pin_file" ] && [ -f "$pin_file" ]; then
    pin_candidate=$(jq -r 'if type == "object" and (.root | type) == "string" then .root else empty end' "$pin_file" 2>/dev/null || true)
    if [ -n "$pin_candidate" ] && [ "$(toplevel_of "$pin_candidate" || true)" = "$pin_candidate" ]; then
      pinned="$pin_candidate"
    fi
  fi
  anchor="${project:-$pinned}"

  if [ -n "$here" ] && { [ -z "$anchor" ] || same_repository "$here" "$anchor"; }; then
    root="$here"
    if [ -n "$pin_file" ] && [ "$pinned" != "$here" ]; then
      # 임시 파일 + mv 로 원자 교체. 실패는 조용히 넘긴다.
      if (umask 077; mkdir -p "$pin_dir" 2>/dev/null) && pin_tmp=$(umask 077; mktemp "$pin_dir/.root-pin.XXXXXX" 2>/dev/null); then
        if jq -n --arg root "$here" '{root: $root}' >"$pin_tmp" 2>/dev/null; then
          mv -f "$pin_tmp" "$pin_file" 2>/dev/null || rm -f "$pin_tmp"
        else
          rm -f "$pin_tmp"
        fi
      fi
    fi
  elif [ -n "$pinned" ]; then
    root="$pinned"
  elif [ -n "$project" ]; then
    root="$project"
  else
    root="$here"
  fi
fi
[ -n "$root" ] || exit 0

# Global install is inert until a repository declares the ledger with STATE.md
# or .staterc. A .staterc without STATE.md intentionally surfaces a missing-index warning.
[ -f "$root/.staterc" ] || [ -f "$root/STATE.md" ] || exit 0

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
host="${STATE_LEDGER_HOST:-}"
if [ -z "$host" ]; then
  if [ -n "${PLUGIN_ROOT:-}" ]; then host=codex; else host=claude; fi
fi

# During migration, let a real project-local STATE hook own the event. Parse
# JSON/TOML commands; comments and unrelated text must never disable the global hook.
if command -v node >/dev/null 2>&1 && \
  node "$script_dir/detect-local-state-hook.mjs" "$root" "$host" "$hook_script" >/dev/null 2>&1; then
  exit 0
fi

printf '%s' "$input" | HOOK_PROJECT_DIR="$root" bash "$script_dir/$hook_script"
status=$?
# frontmatter 원천이면 detail 편집·턴 종료 뒤 로컬 생성 인덱스(git 미추적)를 갱신한다. 출력·실패는 훅 결과에 섞지 않는다.
render=0
case "$mode" in
  stop) render=1 ;;
  stamp) case "$input" in *docs/state/*) render=1 ;; esac ;;
esac
if [ "$render" -eq 1 ]; then
    command -v node >/dev/null 2>&1 && HOOK_PROJECT_DIR="$root" node "$script_dir/state-index.mjs" render --write >/dev/null 2>&1
fi
exit "$status"
