#!/bin/bash
# UserPromptSubmit/chat.message hook — 이번 턴의 커밋 [id=] 판정·STATE 차분 기준점을 세션별로 저장한다.
# 저장 위치는 repo 밖 임시 디렉터리이며 경로·status·content hash·mtime·STATE semantic digest·HEAD를 기록한다.

set -u

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"systemMessage":"jq가 PATH에 없어 STATE 턴 기준점을 저장하지 못했습니다."}'
  exit 0
fi

input=$(cat)
root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

error=""
result=""
if ! command -v node >/dev/null 2>&1; then
  error="node가 PATH에 없어 STATE 턴 기준점을 저장하지 못했습니다."
elif ! result=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-turn-baseline.mjs" snapshot 2>&1); then
  error="STATE 턴 기준점 저장 실패: ${result:0:400}"
fi

concurrent_count=$(printf '%s' "$result" | jq -r '.concurrentSessions | length // 0' 2>/dev/null || echo 0)
if [ "${concurrent_count:-0}" -gt 0 ]; then
  error="${error}${error:+
}같은 worktree에서 최근 30분 내 다른 활성 세션 ${concurrent_count}개가 감지됐습니다. 변경 귀속이 불명확하므로 Stop의 커밋 [id=] 판정은 보류됩니다."
fi

if [ -n "$error" ]; then
  jq -n --arg msg "$error" '{systemMessage: $msg}'
fi

exit 0
