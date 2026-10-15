#!/bin/bash
# UserPromptSubmit/chat.message hook — 이번 턴의 커밋 [id=] 판정·STATE 차분 기준점을 세션별로 저장한다.
# 저장 위치는 repo 밖 임시 디렉터리이며 경로·status·content hash·mtime·detail 본문 크기·HEAD를 기록한다.
# 이전 턴에서 이월된 debt(유효 [id=]가 없는 커밋)가 있으면 additionalContext로 에이전트에게 알린다 —
# Claude Code의 Stop systemMessage는 사용자에게만 보이기 때문이다.

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
else
  # 엔진 stdout(JSON)과 stderr(오류)는 섞지 않는다.
  engine_err_file=$(mktemp "${TMPDIR:-/tmp}/state-ledger-turn.XXXXXX" 2>/dev/null) || engine_err_file=""
  if ! result=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-turn-baseline.mjs" snapshot 2>"${engine_err_file:-/dev/null}"); then
    engine_err=""
    [ -n "$engine_err_file" ] && engine_err=$(cat "$engine_err_file" 2>/dev/null)
    error="STATE 턴 기준점 저장 실패: ${engine_err:0:400}"
    result=""
  fi
  [ -n "$engine_err_file" ] && rm -f "$engine_err_file"
fi

concurrent_count=$(printf '%s' "$result" | jq -r '.concurrentSessions | length // 0' 2>/dev/null || echo 0)
if [ "${concurrent_count:-0}" -gt 0 ]; then
  error="${error}${error:+
}같은 worktree에서 최근 30분 내 다른 활성 세션 ${concurrent_count}개가 감지됐습니다. 변경 귀속이 불명확하므로 Stop의 새 커밋 [id=] 판정은 보류됩니다."
fi

context=""
debt_list=$(printf '%s' "$result" | jq -r '(.debtCommits // []) | map(.label) | if length > 6 then (.[0:6] | join(", ")) + " 외 \(length - 6)개 커밋" else join(", ") end' 2>/dev/null || true)
if [ -n "$debt_list" ]; then
  context="STATE: 커밋 메시지에 유효 [id=]가 없는 커밋이 남아 있습니다 — ${debt_list}. 다음 커밋 메시지에 그 sha와 [id=<id>]를 함께 적어 기록을 보충한다(git commit --allow-empty -m \"<sha> [id=<id>]\" 가능). 인덱스에 없는 id는 오타면 올바른 id로 다시 기록하고, 정말 새 항목일 때만 STATE 인덱스에 등재한다. STATE 항목과 정말 무관한 작업만 [id=-]. STATE 내용을 고치거나 덧붙여서는 풀리지 않는다."
fi

if [ -n "$error" ] || [ -n "$context" ]; then
  jq -n --arg msg "$error" --arg ctx "$context" '
    (if $msg != "" then {systemMessage: $msg} else {} end) +
    (if $ctx != "" then {hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}} else {} end)'
fi

exit 0
