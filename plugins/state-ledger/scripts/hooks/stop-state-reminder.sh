#!/bin/bash
# Stop hook — uncommitted 코드 변경 있는데 STATE 변경 없으면 알림 (전부 warn-only, block ✕).
#
# 툴 중립: Claude Code / Codex 모두 stdin→stdout JSON 프로토콜로 동일 동작.
# opencode: session.idle 이벤트에서 플러그인이 호출 — 알림만 전달.
#
# 프로젝트 설정(.staterc, KEY="value" 고정 형식): STATE_INDEXES, STATE_CODE_RE
# 환경변수: HOOK_PROJECT_DIR(우선)/CLAUDE_PROJECT_DIR

set -u

if ! command -v git >/dev/null 2>&1; then exit 0; fi
if ! command -v jq >/dev/null 2>&1; then exit 0; fi

# 이미 Stop 훅 때문에 재진입한 상태면 조용히 종료 — 알림은 1회만, 무한 재발동 차단.
# stdin 은 파이프일 때만 읽는다 — 터미널 수동 실행(stdin=TTY, EOF 없음)에서 cat 이
# 영구 블록되지 않게 (스모크 테스트: bash scripts/hooks/stop-state-reminder.sh).
input=""
if [ ! -t 0 ]; then
  input=$(cat 2>/dev/null || true)
fi
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ]; then
  exit 0
fi

root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
cd "$root" 2>/dev/null || exit 0

# .staterc — KEY="value" 고정 형식만 읽는다 (source ✕: set -u 중단·변수 오염·임의 실행 방지)
read_staterc() {
  [ -f ".staterc" ] || return 0
  sed -nE "s/^$1=\"([^\"]*)\"[[:space:]]*\$/\1/p" .staterc | head -1
}
v=$(read_staterc STATE_INDEXES); STATE_INDEXES="${v:-STATE.md}"
DEFAULT_CODE_RE='\.(ts|tsx|js|jsx|sh|py|css|ya?ml|json|sql|toml)$|(^|/)Dockerfile'
v=$(read_staterc STATE_CODE_RE); code_re="${v:-$DEFAULT_CODE_RE}"

# STATE 갱신 = 설정된 인덱스 또는 상세(docs/state/**) 어느 쪽이든 인정.
state_re='(^|/)docs/state/'
for f in $STATE_INDEXES; do
  esc=$(printf '%s' "$f" | sed 's#[][\.*^$(){}?+|/]#\\&#g')
  state_re="$state_re|^$esc\$"
done

# 변경 감지는 staged·unstaged·untracked 전부 — `git diff`만 보면 add 된 변경이 사라진다.
changed=$(git status --porcelain 2>/dev/null | cut -c4-)
state_diff=$(printf '%s\n' "$changed" | grep -E "$state_re" || true)
code_diff=$(printf '%s\n' "$changed" | grep -vE "$state_re" | grep -E "$code_re" | head -5 || true)

if [ -n "$code_diff" ] && [ -z "$state_diff" ]; then
  files=$(echo "$code_diff" | tr '\n' ' ' | sed 's/ $//')
  msg="STATE reminder: 코드 변경 있는데 STATE 미갱신 — $files. 인덱스 또는 docs/state/<area>/<id>.md 갱신/archive 검토 (block ✕)."
  jq -n --arg msg "$msg" '{
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: $msg
    }
  }'
fi

exit 0
