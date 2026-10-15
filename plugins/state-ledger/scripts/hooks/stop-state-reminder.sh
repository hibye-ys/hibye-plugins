#!/bin/bash
# Stop hook — 이번 턴 기준점 이후 커밋 중 작업 파일을 바꾸고도 메시지에 유효 STATE
# [id=<id>]가 없는 커밋을 debt로 알림. 작업 기록은 커밋 메시지가 맡고 STATE는 공유 상태판이다.
# 미커밋 작업은 커밋될 때 판정한다. '## 현재' 덧붙이기도 알린다.
# 전부 warn-only(block ✕)이며, 이번 턴 기준점 이후의 변경만 판정한다.
#
# 툴 중립: Claude Code / Codex 모두 stdin→stdout JSON 프로토콜로 동일 동작.
# 비차단 알림은 두 툴이 공통 지원하는 top-level systemMessage 로 반환한다.
# opencode: session.idle 이벤트에서 플러그인이 호출하고 systemMessage 를 로그로 표시한다.
#
# 환경변수:
#   HOOK_PROJECT_DIR — 프로젝트 루트 (우선)
#   CLAUDE_PROJECT_DIR — Claude Code 호환 (차선)

set -u

if ! command -v git >/dev/null 2>&1; then exit 0; fi
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"systemMessage":"jq가 PATH에 없어 STATE Stop 검사를 실행하지 못했습니다."}'
  exit 0
fi

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
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# evaluate는 세션별 턴 기준점 차분과 커밋 태그를 판정하고 미해결 debt를 다음 snapshot에
# 원자적으로 보존한다. 판정·계산은 node 엔진이 하고 이 스크립트는 표시만 한다.
# 기준점 부재·저장 실패는 정상으로 숨기지 않고 경고한다.
delta=""
baseline_engine_error=""
if command -v node >/dev/null 2>&1; then
  if ! delta=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-turn-baseline.mjs" evaluate 2>&1); then
    baseline_engine_error="STATE 기준점 평가 실패: ${delta:0:400}"
    delta=""
  fi
else
  baseline_engine_error="node가 PATH에 없어 STATE 기준점 평가를 실행하지 못했습니다."
fi

msg=""
if [ -n "$baseline_engine_error" ]; then
  msg="$baseline_engine_error"
fi

if printf '%s' "$delta" | jq -e '
  (.codeChanged | type == "array") and (.stateChanged | type == "array") and
  (.validStateAreas | type == "array") and (.invalidStateAreas | type == "array") and
  (.metadataOnlyStateAreas | type == "array") and
  (.stateBeforeWorkAreas | type == "array") and (.stateChannelMismatchAreas | type == "array") and
  (.concurrentSessions | type == "array") and (.debt | type == "array") and
  ((.appendedCurrentSections // []) | type == "array")
' >/dev/null 2>&1; then
  state_diff=$(printf '%s' "$delta" | jq -r '.stateChanged[]?' || true)
  baseline_error=$(printf '%s' "$delta" | jq -r '.baselineError // empty')
  invalid_state=$(printf '%s' "$delta" | jq -r '.invalidStateAreas[]?' | paste -sd, - || true)
  metadata_only_state=$(printf '%s' "$delta" | jq -r '.metadataOnlyStateAreas[]?' | paste -sd, - || true)
  state_before_work=$(printf '%s' "$delta" | jq -r '.stateBeforeWorkAreas[]?' | paste -sd, - || true)
  state_channel_mismatch=$(printf '%s' "$delta" | jq -r '.stateChannelMismatchAreas[]?' | paste -sd, - || true)
  concurrent_count=$(printf '%s' "$delta" | jq -r '.concurrentSessions | length' || echo 0)
  debt=$(printf '%s' "$delta" | jq -r '.debt[]? | "[\(.area)] \(.path)"' | head -12 || true)
  appended=$(printf '%s' "$delta" | jq -r '(.appendedCurrentSections // [])[]? | "STATE reminder: \(.path)의 ## 현재가 \(.after - .before) B 늘었습니다 — 작업 경과를 덧붙이지 말고 남은 일·결정·WHY를 바꿔 쓰세요."' || true)
  if [ -n "$baseline_error" ]; then
    msg="${msg}${msg:+
}STATE 기준점이 정상 상태가 아닙니다: $baseline_error. 현재 worktree를 보수적으로 새 기준점으로 삼았습니다."
  fi
  if [ -n "$debt" ]; then
    files=$(echo "$debt" | tr '\n' ' ' | sed 's/ $//')
    msg="${msg}${msg:+
}STATE reminder: 커밋 메시지에 STATE id가 없는 작업 — $files. 작업 기록은 커밋 메시지의 [id=<id>]로 남기고, STATE는 남은 일·소유·결정이 바뀐 경우에만 그 줄을 바꿔 쓴다(덧붙이지 않는다). 이후 같은 경로를 바꾸는 [id=<id>] 커밋이 이 알림을 해제한다 (block ✕)."
  fi
  if [ -n "$invalid_state" ]; then
    msg="${msg}${msg:+
}STATE reminder: 변경된 STATE 영역($invalid_state)이 구조 검사를 통과하지 않아 debt 해제에 사용하지 않았습니다."
  fi
  if [ -n "$metadata_only_state" ]; then
    msg="${msg}${msg:+
}STATE reminder: STATE 영역($metadata_only_state)의 touched/hash·주석·공백만 바뀌어 의미 있는 ledger 갱신으로 인정하지 않았습니다."
  fi
  if [ -n "$state_before_work" ]; then
    msg="${msg}${msg:+
}STATE reminder: 영역($state_before_work)의 STATE 커밋이 id 없는 코드 커밋보다 앞서 그 작업을 덮지 못했습니다. 코드 커밋 메시지에 [id=<id>]를 붙이세요."
  fi
  if [ -n "$state_channel_mismatch" ]; then
    msg="${msg}${msg:+
}STATE reminder: 영역($state_channel_mismatch)의 STATE 변경이 아직 커밋되지 않아 이미 커밋된 id 없는 작업을 덮지 못했습니다. 작업 기록은 커밋 메시지의 [id=<id>]로 남기세요."
  fi
  if [ -n "$appended" ]; then
    msg="${msg}${msg:+
}$appended"
  fi
  if [ "${concurrent_count:-0}" -gt 0 ]; then
    msg="${msg}${msg:+
}STATE reminder: 같은 worktree의 다른 활성 세션 ${concurrent_count}개가 감지되어 이번 턴의 커밋↔STATE id 귀속 판정을 보류했습니다. worktree를 분리하세요."
  fi
else
  # 분류 정본은 JavaScript RegExp 한 곳뿐이다. 엔진 실패를 다른 regex dialect로
  # 추측하지 않고 위의 명시적 오류를 유지한다.
  state_diff=""
fi

# 이번 턴에 STATE가 바뀐 경우 구조/hash를 재검한다. 시작 때 발견한 기존 경고를 매
# Stop마다 반복하지 않으면서, shell 등 편집 도구 밖에서 빠진 stamp는 즉시 노출한다.
state_warnings=""
if [ -n "$state_diff" ]; then
  state_warnings=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-wip-cap.sh" 2>&1 || true)
fi
if [ -n "$state_warnings" ]; then
  msg="${msg}${msg:+
}$state_warnings"
fi

if [ -n "$msg" ]; then
  jq -n --arg msg "$msg" '{systemMessage: $msg}'
fi

exit 0
