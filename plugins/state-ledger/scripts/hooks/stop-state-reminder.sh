#!/bin/bash
# Stop hook — 이번 턴의 작업과 대응 STATE 갱신을 비교해 미해결 debt를 알림.
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

read_staterc() {
  [ -f ".staterc" ] || return 0
  sed -nE "s/^$1=\"([^\"]*)\"[[:space:]]*\$/\1/p" .staterc | head -1
}

# 기준점 엔진 자체가 실패했을 때만 쓰는 보수적 확장자 fallback. 정상 경로의
# 단일 정본은 state-turn-baseline.mjs 의 isWorkFile 이다.
DEFAULT_CODE_RE='\.(ts|tsx|js|jsx|sh|py|css|ya?ml|json|sql|toml)$|(^|/)Dockerfile'
v=$(read_staterc STATE_CODE_RE); code_re="${v:-$DEFAULT_CODE_RE}"

# STATE 갱신 = 변경 코드의 설정된 영역에 대응하는 인덱스 또는 detail만 인정.
# evaluate는 세션별 턴 기준점 차분을 계산하고 미해결 code debt를 다음 snapshot에
# 원자적으로 보존한다. 기준점 부재·저장 실패는 정상으로 숨기지 않고 경고한다.
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
  (.concurrentSessions | type == "array") and (.debt | type == "array")
' >/dev/null 2>&1; then
  state_diff=$(printf '%s' "$delta" | jq -r '.stateChanged[]?' || true)
  baseline_error=$(printf '%s' "$delta" | jq -r '.baselineError // empty')
  invalid_state=$(printf '%s' "$delta" | jq -r '.invalidStateAreas[]?' | paste -sd, - || true)
  metadata_only_state=$(printf '%s' "$delta" | jq -r '.metadataOnlyStateAreas[]?' | paste -sd, - || true)
  state_before_work=$(printf '%s' "$delta" | jq -r '.stateBeforeWorkAreas[]?' | paste -sd, - || true)
  state_channel_mismatch=$(printf '%s' "$delta" | jq -r '.stateChannelMismatchAreas[]?' | paste -sd, - || true)
  concurrent_count=$(printf '%s' "$delta" | jq -r '.concurrentSessions | length' || echo 0)
  debt=$(printf '%s' "$delta" | jq -r '.debt[]? | "[\(.area)/\(.channel // "legacy")] \(.path)"' | head -12 || true)
  if [ -n "$baseline_error" ]; then
    msg="${msg}${msg:+
}STATE 기준점이 정상 상태가 아닙니다: $baseline_error. 현재 worktree를 보수적으로 새 기준점으로 삼았습니다."
  fi
  if [ -n "$debt" ]; then
    files=$(echo "$debt" | tr '\n' ' ' | sed 's/ $//')
    msg="${msg}${msg:+
}STATE reminder: 미해결 코드↔STATE debt — $files. 표시된 영역의 인덱스 또는 detail을 갱신해야 해제됩니다 (block ✕)."
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
}STATE reminder: STATE 영역($state_before_work)이 마지막 코드 변경보다 먼저 갱신되어 현재 작업의 반영으로 인정하지 않았습니다."
  fi
  if [ -n "$state_channel_mismatch" ]; then
    msg="${msg}${msg:+
}STATE reminder: 영역($state_channel_mismatch)의 dirty/commit 상태가 작업과 맞지 않아 반영으로 인정하지 않았습니다. committed 작업은 committed STATE, dirty 작업은 이후 dirty STATE가 필요합니다."
  fi
  if [ "${concurrent_count:-0}" -gt 0 ]; then
    msg="${msg}${msg:+
}STATE reminder: 같은 worktree의 다른 활성 세션 ${concurrent_count}개가 감지되어 이번 턴의 code↔STATE 귀속 판정을 보류했습니다. worktree를 분리하세요."
  fi
else
  # helper 자체가 실패한 경우 누락 방지를 위해 coarse 검사를 하되 강등 사실을 알린다.
  changed=$(git status --porcelain=v1 --untracked-files=all 2>/dev/null | cut -c4-)
  state_diff=$(printf '%s\n' "$changed" | grep -E '(^|/)STATE\.md$|(^|/)docs/state/' || true)
  code_diff=$(printf '%s\n' "$changed" | grep -vE '(^|/)STATE\.md$|(^|/)docs/state/' | grep -E "$code_re" | head -5 || true)
  if [ -n "$code_diff" ] && [ -z "$state_diff" ]; then
    files=$(echo "$code_diff" | tr '\n' ' ' | sed 's/ $//')
    msg="${msg}${msg:+
}STATE reminder(coarse fallback): 코드 변경 있는데 STATE 미갱신 — $files. 기준점 엔진 복구 후 해당 영역 STATE를 갱신하세요 (block ✕)."
  fi
fi

# 이번 턴에 STATE가 바뀐 경우 구조/hash를 재검한다. 시작 때 발견한 기존 경고를 매
# Stop마다 반복하지 않으면서, shell 등 편집 도구 밖에서 빠진 stamp는 즉시 노출한다.
state_warnings=""
if [ -n "$state_diff" ] && [ -f "$root/scripts/check-state-wip-cap.sh" ]; then
  state_warnings=$(bash "$root/scripts/check-state-wip-cap.sh" 2>&1 || true)
fi
if [ -n "$state_warnings" ]; then
  msg="${msg}${msg:+
}$state_warnings"
fi

if [ -n "$msg" ]; then
  jq -n --arg msg "$msg" '{systemMessage: $msg}'
fi

exit 0
