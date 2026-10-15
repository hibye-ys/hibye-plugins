#!/bin/bash
# Stop hook — 작업 파일을 바꾸고도 메시지에 유효 STATE [id=<id>]가 없는 커밋을 debt로 알림.
# 작업 기록은 커밋 메시지가 맡고 STATE는 공유 상태판이다. STATE 수정은 debt를 해제하지 않는다.
# 미커밋 작업은 커밋될 때 판정한다. '## 현재' 덧붙이기와 §1 밖 id로 한 작업도 알린다.
# 전부 warn-only(block ✕)다.
#
# 툴 중립: Claude Code / Codex 모두 stdin→stdout JSON 프로토콜로 동일 동작.
# 비차단 알림은 두 툴이 공통 지원하는 top-level systemMessage 로 반환한다.
# opencode: session.idle 이벤트에서 플러그인이 호출하고 systemMessage 를 로그로 표시한다.
# Antigravity(STATE_LEDGER_HOST=antigravity): 이번 턴에 새로 생긴 항목이 있는지
# stateLedgerContinue 로 함께 알려 어댑터가 강제 continue 여부를 고르게 한다.
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
# 이번 턴에 새로 생겨 에이전트가 지금 처리할 항목이 있는가 (Antigravity 강제 continue 판단용).
attention=false

# 0.3.x 필드(invalid·metadataOnly·stateBeforeWork·stateChannelMismatch)는 하위 호환을 위해
# 스키마로만 검사한다. STATE 수정이 debt를 해제하지 않으므로 엔진은 항상 빈 배열을 낸다.
if printf '%s' "$delta" | jq -e '
  (.codeChanged | type == "array") and (.stateChanged | type == "array") and
  (.validStateAreas | type == "array") and (.invalidStateAreas | type == "array") and
  (.metadataOnlyStateAreas | type == "array") and
  (.stateBeforeWorkAreas | type == "array") and (.stateChannelMismatchAreas | type == "array") and
  (.concurrentSessions | type == "array") and (.debt | type == "array") and
  ((.appendedCurrentSections // []) | type == "array") and
  ((.freshDebt // []) | type == "array") and
  ((.unclaimedTaggedIds // []) | type == "array")
' >/dev/null 2>&1; then
  state_diff=$(printf '%s' "$delta" | jq -r '.stateChanged[]?' || true)
  baseline_error=$(printf '%s' "$delta" | jq -r '.baselineError // empty')
  concurrent_count=$(printf '%s' "$delta" | jq -r '.concurrentSessions | length' || echo 0)
  untagged=$(printf '%s' "$delta" | jq -r '.debt[]? | select((.reason // "untagged") != "unknown-id") | "[\(.area)] \(.path)\(if .sha then " (\(.sha[0:7]))" else "" end)"' | head -12 || true)
  unknown=$(printf '%s' "$delta" | jq -r '.debt[]? | select(.reason == "unknown-id") | "[\(.area)] \(.path) (\(.sha[0:7]) \((.ids // []) | map("[id=\(.)]") | join(" ")))"' | head -12 || true)
  fresh_count=$(printf '%s' "$delta" | jq -r '(.freshDebt // []) | length' || echo 0)
  appended=$(printf '%s' "$delta" | jq -r '(.appendedCurrentSections // [])[]? | "STATE reminder: \(.path)의 ## 현재가 \(.after - .before) B 늘었습니다 — 작업 경과를 덧붙이지 말고 남은 일·결정·WHY를 바꿔 쓰세요."' || true)
  unclaimed=$(printf '%s' "$delta" | jq -r '(.unclaimedTaggedIds // []) | map("[id=\(.id)](§\(.section))") | join(", ")' || true)
  range_skipped=$(printf '%s' "$delta" | jq -r '.commitRangeSkipped // false' || echo false)
  if [ -n "$baseline_error" ]; then
    msg="${msg}${msg:+
}STATE 기준점이 정상 상태가 아닙니다: $baseline_error. 현재 worktree를 보수적으로 새 기준점으로 삼았습니다."
  fi
  if [ -n "$untagged" ]; then
    files=$(printf '%s\n' "$untagged" | awk 'NR > 1 { printf ", " } { printf "%s", $0 }')
    msg="${msg}${msg:+
}STATE reminder: 커밋 메시지에 STATE id가 없는 작업 — $files. 작업 기록은 커밋 메시지의 [id=<id>]로 남기고, STATE는 남은 일·소유·결정이 바뀐 경우에만 그 줄을 바꿔 쓴다(덧붙이지 않는다)."
  fi
  if [ -n "$unknown" ]; then
    files=$(printf '%s\n' "$unknown" | awk 'NR > 1 { printf ", " } { printf "%s", $0 }')
    msg="${msg}${msg:+
}STATE reminder: 커밋의 [id=]가 STATE 인덱스에 없는 작업 — $files. 새 항목이면 STATE 인덱스에 그 줄을 등재하고(미커밋 등재도 인정), archive된 항목의 후속 작업이면 살아 있는 id를 쓴다."
  fi
  if [ -n "$untagged" ] || [ -n "$unknown" ]; then
    msg="${msg}
해제: 아직 push하지 않은 HEAD 커밋이면 git commit --amend로 메시지에 [id=<id>]를 붙인다. 이미 지난 커밋이면 그 sha(7자 이상)와 [id=<id>]를 함께 적은 커밋을 남긴다(git commit --allow-empty 가능). STATE 항목과 무관한 작업은 [id=-]. STATE 수정으로는 해제되지 않는다 (block ✕)."
  fi
  if [ "${fresh_count:-0}" -gt 0 ]; then
    attention=true
  fi
  if [ -n "$appended" ]; then
    msg="${msg}${msg:+
}$appended"
    attention=true
  fi
  if [ -n "$unclaimed" ]; then
    msg="${msg}${msg:+
}STATE reminder: $unclaimed 로 작업을 커밋했지만 그 항목이 STATE §1 활성에 없습니다 — 착수했다면 그 줄을 §1로 옮기고 detail owner를 claim한다(덧붙이지 않고 바꿔 쓴다)."
  fi
  if [ "$range_skipped" = "true" ]; then
    msg="${msg}${msg:+
}STATE reminder: 기준점 이후 커밋이 판정 상한을 넘어 이번 커밋 [id=] 판정을 건너뛰었습니다(pull·브랜치 전환으로 들어온 커밋으로 봅니다)."
  fi
  if [ "${concurrent_count:-0}" -gt 0 ]; then
    msg="${msg}${msg:+
}STATE reminder: 같은 worktree의 다른 활성 세션 ${concurrent_count}개가 감지되어 이번 턴의 커밋 [id=] 귀속 판정을 보류했습니다. worktree를 분리하세요."
  fi
else
  # 분류 정본은 JavaScript RegExp 한 곳뿐이다. 엔진 실패를 다른 regex dialect로
  # 추측하지 않고 위의 명시적 오류를 유지한다.
  state_diff=""
fi

# 이번 턴에 STATE가 바뀐 경우 구조·hash·크기를 재검하되, 이번 턴에 바뀐 STATE 경로를 언급하는
# 경고만 보인다. 다른 detail의 기존 경고는 SessionStart 주입이 맡으며 매 Stop마다 반복하지 않는다.
# 경고 줄은 항상 ' <경로>' 형태로 경로를 담는다(앞 공백으로 STATE.md ↔ apps/x/STATE.md 혼동 방지).
state_warnings=""
if [ -n "$state_diff" ]; then
  all_warnings=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-wip-cap.sh" 2>&1 || true)
  patterns=()
  while IFS= read -r changed_path; do
    [ -n "$changed_path" ] && patterns+=(-e " $changed_path")
  done <<EOF
$state_diff
EOF
  if [ -n "$all_warnings" ] && [ "${#patterns[@]}" -gt 0 ]; then
    state_warnings=$(printf '%s\n' "$all_warnings" | grep -F "${patterns[@]}" || true)
  fi
fi
if [ -n "$state_warnings" ]; then
  msg="${msg}${msg:+
}$state_warnings"
  attention=true
fi

if [ -n "$msg" ]; then
  if [ "${STATE_LEDGER_HOST:-}" = "antigravity" ]; then
    jq -n --arg msg "$msg" --argjson attention "$attention" '{systemMessage: $msg, stateLedgerContinue: $attention}'
  else
    jq -n --arg msg "$msg" '{systemMessage: $msg}'
  fi
fi

exit 0
