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

# Stop 훅의 시간 가드가 디스패처 시작부터의 경과를 재도록 시작 시각(epoch 초)을 넘긴다 (항상 덮어쓴다).
export STATE_LEDGER_HOOK_T0="$(date +%s)"

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
#   pinned  = 이 세션이 앞서 고정해 둔 root (아직 존재하고 git toplevel 이 자기 자신이며, project 가 있으면 같은 저장소일 때만)
#   anchor  = project, 없으면 pinned
# 턴 경계 이벤트(session-start·turn-start): here 가 있고 anchor 가 없거나 here 와 같은 저장소(git common dir 동일,
#   worktree 는 달라도 됨)이면 here 를 쓰고 고정한다. 그렇지 않으면 pinned → project → here 순서 — cwd 가 다른 저장소로
#   나가도 세션의 checkout 에 머문다.
# 그 밖의 이벤트(stamp·stop, 그리고 유효한 고정이 있을 때의 session-start source=compact): 고정이 유효하면 그 root 를 쓴다(다시 쓰지 않는다). 없으면 위 규칙을 고정 없이 적용한다.
#   → root 는 턴 경계에서 세션의 cwd 를 따라가고, 한 턴 안에서는 움직이지 않는다. Stop 이 turn-start 가 기준점을 저장한
#   checkout 을 그대로 판정하고, primary 세션이 턴 중간에 형제 worktree 로 cd 해도 기준점을 잃지 않는다. 편집 파일이 다른
#   checkout 에 있으면 스탬프가 그 checkout 기준으로 돈다(post-edit-state-stamp.sh).
# 고정을 쓰지 않는 경우: jq·세션 id 가 없을 때, CLAUDE_PROJECT_DIR 이 git 저장소가 아닐 때(저장소 밖에서 시작한 세션이 처음 들른
#   저장소에 영구 고정되지 않도록 root 는 매번 here 를 따른다), 고정 폴더가 심링크이거나 다른 사용자 소유일 때.
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
# pin 폴더 경로 — state-data-dir.mjs 의 dataDirectory() 와 같은 규칙:
#   STATE_HOOK_DATA_DIR, 없으면 <TMPDIR|TMP|TEMP|/tmp, 끝 슬래시 제거>/state-ledger-hooks-<uid>
pin_directory() {
  local dir tmp
  dir="${STATE_HOOK_DATA_DIR:-}"
  if [ -z "$dir" ]; then
    tmp="${TMPDIR:-${TMP:-${TEMP:-/tmp}}}"
    while [ "${#tmp}" -gt 1 ] && [ "${tmp%/}" != "$tmp" ]; do tmp="${tmp%/}"; done
    dir="$tmp/state-ledger-hooks-$(id -u)"
  fi
  while [ "${#dir}" -gt 1 ] && [ "${dir%/}" != "$dir" ]; do dir="${dir%/}"; done
  printf '%s' "$dir"
}
# 쓰기 전에 pin 폴더를 만들고(0700) 검사한다: 심링크가 아닌 실제 폴더 + 현재 사용자 소유. group·other 권한 비트가 있으면 0700 으로
# 좁힌다. 하나라도 실패하면 1 — 공유 /tmp 에서 다른 사용자가 미리 만든 폴더·심링크에서 root 를 읽거나 쓰지 않는다.
# (마지막 경로 성분만 본다: /tmp → /private/tmp 같은 상위 심링크는 문제 삼지 않는다.)
pin_directory_usable() {
  local perms
  [ -L "$1" ] && return 1
  [ -e "$1" ] || { (umask 077; mkdir -p -- "$1" 2>/dev/null) || return 1; }
  [ ! -L "$1" ] && [ -d "$1" ] && [ -O "$1" ] || return 1
  perms=$(ls -ld -- "$1" 2>/dev/null) || return 1
  perms=${perms%% *}
  case "${perms:4:6}" in
    ------) ;;
    *) chmod -- 700 "$1" 2>/dev/null || return 1 ;;  # BSD chmod 는 `chmod 700 -- dir` 의 `--` 를 파일로 읽는다
  esac
  return 0
}
root=""
if [ -n "${HOOK_PROJECT_DIR:-}" ]; then
  root=$(toplevel_of "$HOOK_PROJECT_DIR" || true)
else
  input_cwd=""
  session_id=""
  event_source=""
  if [ -n "$input" ] && command -v jq >/dev/null 2>&1; then
    input_cwd=$(printf '%s' "$input" | jq -r 'if type == "object" and (.cwd | type) == "string" then .cwd else empty end' 2>/dev/null || true)
    session_id=$(printf '%s' "$input" | jq -r 'if type == "object" then (.session_id // .sessionID // .sessionId) else empty end | if type == "string" then . else empty end' 2>/dev/null || true)
    event_source=$(printf '%s' "$input" | jq -r 'if type == "object" and (.source | type) == "string" then .source else empty end' 2>/dev/null || true)
  fi
  here=""
  for candidate in "$input_cwd" "$PWD"; do
    here=$(toplevel_of "$candidate" || true)
    [ -n "$here" ] && break
  done
  project=$(toplevel_of "${CLAUDE_PROJECT_DIR:-}" || true)

  # 세션 고정: 세션 id 해시로 root 를 임시 데이터 디렉터리에 적어 둔다. jq·세션 id 가 없으면 고정 없이 동작한다.
  # CLAUDE_PROJECT_DIR 이 있는데 git 저장소가 아니면 Claude 를 저장소 밖에서 시작한 세션이다 — 고정하지 않고 here 를 따른다.
  pin_dir=""
  pin_file=""
  pinned=""
  pin_enabled=1
  { [ -z "${CLAUDE_PROJECT_DIR:-}" ] || [ -n "$project" ]; } || pin_enabled=0
  [ -n "$session_id" ] && command -v jq >/dev/null 2>&1 || pin_enabled=0
  if [ "$pin_enabled" -eq 1 ]; then
    pin_dir=$(pin_directory)
    pin_hash=$(printf '%s' "$session_id" | git hash-object --stdin 2>/dev/null || true)
    if [ -n "$pin_hash" ] && pin_directory_usable "$pin_dir"; then
      pin_file="$pin_dir/root-$pin_hash.json"
    else
      pin_enabled=0
    fi
  fi
  if [ "$pin_enabled" -eq 1 ] && [ -f "$pin_file" ]; then
    pin_candidate=$(jq -r 'if type == "object" and (.root | type) == "string" then .root else empty end' "$pin_file" 2>/dev/null || true)
    if [ -n "$pin_candidate" ] && [ "$(toplevel_of "$pin_candidate" || true)" = "$pin_candidate" ] \
      && { [ -z "$project" ] || same_repository "$pin_candidate" "$project"; }; then
      pinned="$pin_candidate"
    fi
  fi

  turn_boundary=0
  case "$mode" in session-start|turn-start) turn_boundary=1 ;; esac
  # 자동 압축(SessionStart source=compact)은 턴 경계가 아니다 — 턴 중간에 형제 worktree 로 cd 한 뒤 압축되어도 고정을 옮기지 않는다.
  # (유효한 고정이 있을 때만. 없으면 평소처럼 here 로 고른다.)
  if [ "$mode" = "session-start" ] && [ "$event_source" = "compact" ] && [ -n "$pinned" ]; then turn_boundary=0; fi
  if [ "$turn_boundary" -eq 0 ] && [ -n "$pinned" ]; then
    root="$pinned"
  else
    anchor="${project:-$pinned}"
    if [ -n "$here" ] && { [ -z "$anchor" ] || same_repository "$here" "$anchor"; }; then
      root="$here"
      if [ "$turn_boundary" -eq 1 ] && [ "$pin_enabled" -eq 1 ] && [ "$pinned" != "$here" ]; then
        # 임시 파일 + mv 로 원자 교체. 실패는 조용히 넘긴다.
        if pin_tmp=$(umask 077; mktemp "$pin_dir/.root-pin.XXXXXX" 2>/dev/null); then
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
