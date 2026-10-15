#!/bin/bash
# UserPromptSubmit/chat.message hook — 이번 턴의 기준점을 세션별로 저장한다.
# 저장 위치는 repo 밖 임시 디렉터리이며 HEAD·dirty STATE 파일 hash·detail 본문 크기를 기록한다.
# 이전 턴의 판정 결과는 넘기지 않는다 — Stop은 이번 턴 것만 알린다. 출력은 오류뿐이다:
# 동시 세션 보류는 실제로 보류한 Stop이 알리고, 세션 단위 경고는 SessionStart가 한 번 낸다.

set -u

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"systemMessage":"jq가 PATH에 없어 STATE 턴 기준점을 저장하지 못했습니다."}'
  exit 0
fi

input=$(cat)
root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

error=""
if ! command -v node >/dev/null 2>&1; then
  error="node가 PATH에 없어 STATE 턴 기준점을 저장하지 못했습니다."
else
  # 엔진 stdout(JSON)과 stderr(오류)는 섞지 않는다.
  engine_err_file=$(mktemp "${TMPDIR:-/tmp}/state-ledger-turn.XXXXXX" 2>/dev/null) || engine_err_file=""
  if ! printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-turn-baseline.mjs" snapshot >/dev/null 2>"${engine_err_file:-/dev/null}"; then
    engine_err=""
    [ -n "$engine_err_file" ] && engine_err=$(cat "$engine_err_file" 2>/dev/null)
    error="STATE 턴 기준점 저장 실패: ${engine_err:0:400}"
  fi
  [ -n "$engine_err_file" ] && rm -f "$engine_err_file"
fi

if [ -n "$error" ]; then
  jq -n --arg msg "$error" '{systemMessage: $msg}'
fi

exit 0
