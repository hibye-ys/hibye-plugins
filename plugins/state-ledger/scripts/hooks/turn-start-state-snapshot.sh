#!/bin/bash
# UserPromptSubmit/chat.message hook — 이번 턴의 기준점을 세션별로 저장한다.
# 저장 위치는 repo 밖 임시 디렉터리이며 HEAD·dirty STATE 파일 hash·detail 본문 크기를 기록한다.
# 이전 턴의 판정 결과는 넘기지 않는다 — Stop은 이번 턴 것만 알린다.
# 기준점 저장 뒤 현재 브랜치가 소유한 STATE 항목의 목표·단계·절차를 additionalContext 로 다시 주입한다
# (state-focus.mjs — 긴 작업이 압축 뒤 목표와 단계 순서를 잃지 않게). 소유 항목이 없으면 출력은 오류뿐이다:
# 동시 세션 보류는 실제로 보류한 Stop이 알리고, 세션 단위 경고는 SessionStart가 한 번 낸다.

set -u

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"systemMessage":"jq가 PATH에 없어 STATE 턴 기준점을 저장하지 못했습니다."}'
  exit 0
fi

input=$(cat)
root="${HOOK_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}")}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

error=""
focus_reminder=""
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

  # 현재 작업 알림 — 실패해도 기준점 저장 결과와 섞지 않고 경고만 덧붙인다.
  focus_err_file=$(mktemp "${TMPDIR:-/tmp}/state-ledger-focus.XXXXXX" 2>/dev/null) || focus_err_file=""
  if ! focus_reminder=$(HOOK_PROJECT_DIR="$root" node "$script_dir/state-focus.mjs" reminder 2>"${focus_err_file:-/dev/null}"); then
    focus_err=""
    [ -n "$focus_err_file" ] && focus_err=$(cat "$focus_err_file" 2>/dev/null)
    error="${error}${error:+
}STATE 현재 작업 알림 실패: ${focus_err:0:400}"
    focus_reminder=""
  fi
  [ -n "$focus_err_file" ] && rm -f "$focus_err_file"
fi

if [ -n "$error" ] || [ -n "$focus_reminder" ]; then
  jq -n --arg msg "$error" --arg ctx "$focus_reminder" '
    (if $ctx != "" then {hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}} else {} end)
    + (if $msg != "" then {systemMessage: $msg} else {} end)'
fi

exit 0
