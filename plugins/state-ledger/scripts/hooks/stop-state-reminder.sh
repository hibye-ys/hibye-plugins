#!/bin/bash
# Stop hook — 작업 파일을 바꾸고도 메시지에 유효 STATE [id=<id>]가 없는 커밋을 debt로 알림.
# 작업 기록은 커밋 메시지가 맡고 STATE는 공유 상태판이다. STATE 수정은 debt를 해제하지 않는다.
# 미커밋 작업은 커밋될 때 판정한다. detail 본문 덧붙이기와 §1 밖 id로 한 작업도 알린다.
# 전부 warn-only(block ✕)다.
#
# 툴 중립: Claude Code / Codex 모두 stdin→stdout JSON 프로토콜로 동일 동작.
# 비차단 알림은 두 툴이 공통 지원하는 top-level systemMessage 로 반환한다. Claude Code의 Stop
# systemMessage는 사용자에게만 보이므로, 이월 debt는 turn-start-state-snapshot.sh가 다음 턴에
# additionalContext로 에이전트에게 알린다.
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
# 엔진 stdout(JSON)과 stderr(오류)는 섞지 않는다. 기준점 부재·저장 실패는 정상으로 숨기지 않고 경고한다.
delta=""
baseline_engine_error=""
if command -v node >/dev/null 2>&1; then
  engine_err_file=$(mktemp "${TMPDIR:-/tmp}/state-ledger-stop.XXXXXX" 2>/dev/null) || engine_err_file=""
  if ! delta=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-turn-baseline.mjs" evaluate 2>"${engine_err_file:-/dev/null}"); then
    engine_err=""
    [ -n "$engine_err_file" ] && engine_err=$(cat "$engine_err_file" 2>/dev/null)
    baseline_engine_error="STATE 기준점 평가 실패: ${engine_err:0:400}"
    delta=""
  fi
  [ -n "$engine_err_file" ] && rm -f "$engine_err_file"
else
  baseline_engine_error="node가 PATH에 없어 STATE 기준점 평가를 실행하지 못했습니다."
fi

msg=""
if [ -n "$baseline_engine_error" ]; then
  msg="$baseline_engine_error"
fi
# 이번 턴에 새로 생겨 에이전트가 지금 처리할 항목이 있는가 (Antigravity 강제 continue 판단용).
attention=false

# debt 목록은 원 커밋(sha) 단위로 6개까지 보이고 넘치면 개수를 붙인다.
debt_list='map(.label) | if length > 6 then (.[0:6] | join(", ")) + " 외 \(length - 6)개 커밋" else join(", ") end'
if [ -n "$delta" ] && printf '%s' "$delta" | jq -e '
  (.stateChanged | type == "array") and (.concurrentSessions | type == "array") and
  (.debt | type == "array") and (.freshDebt | type == "array") and (.debtCommits | type == "array") and
  (.appendedDetails | type == "array") and (.unclaimedTaggedIds | type == "array")
' >/dev/null 2>&1; then
  state_diff=$(printf '%s' "$delta" | jq -r '.stateChanged[]?' || true)
  baseline_error=$(printf '%s' "$delta" | jq -r '.baselineError // empty')
  concurrent_count=$(printf '%s' "$delta" | jq -r '.concurrentSessions | length' || echo 0)
  untagged=$(printf '%s' "$delta" | jq -r "[.debtCommits[] | select(.reason != \"unknown-id\")] | $debt_list" || true)
  unknown=$(printf '%s' "$delta" | jq -r "[.debtCommits[] | select(.reason == \"unknown-id\")] | $debt_list" || true)
  fresh_count=$(printf '%s' "$delta" | jq -r '.freshDebt | length' || echo 0)
  appended=$(printf '%s' "$delta" | jq -r '.appendedDetails[]? | "STATE reminder: \(.path) 본문이 \(.after - .before) B 늘었습니다 — 작업 경과를 덧붙이지 말고 남은 일·결정·WHY를 바꿔 쓰세요."' || true)
  unclaimed=$(printf '%s' "$delta" | jq -r '.unclaimedTaggedIds | map("[id=\(.id)](§\(.section))") | join(", ")' || true)
  range_skipped=$(printf '%s' "$delta" | jq -r '.commitRangeSkipped // false' || echo false)
  if [ -n "$baseline_error" ]; then
    msg="${msg}${msg:+
}STATE 기준점이 정상 상태가 아닙니다: $baseline_error. 현재 worktree를 보수적으로 새 기준점으로 삼았습니다."
  fi
  if [ -n "$untagged" ]; then
    msg="${msg}${msg:+
}STATE reminder: 커밋 메시지에 STATE [id=]가 없는 커밋 — $untagged."
  fi
  if [ -n "$unknown" ]; then
    msg="${msg}${msg:+
}STATE reminder: [id=]가 STATE 인덱스에 없는 커밋 — $unknown. 오타·archive된 id면 올바른 id로 다시 기록하고, 정말 새 항목일 때만 그 줄을 STATE 인덱스에 등재한다(등재하면 풀린다)."
  fi
  # 해제 방법은 새 debt가 생긴 Stop에서만 보인다. 이월 debt는 다음 턴 UserPromptSubmit이 에이전트에게 다시 알린다.
  if [ "${fresh_count:-0}" -gt 0 ]; then
    attention=true
    msg="${msg}
해제: 다음 커밋 메시지에 그 sha와 [id=<id>]를 함께 적는다(git commit --allow-empty -m \"<sha> [id=<id>]\" 가능). 직접 만든 미push HEAD 커밋이면 git commit --amend로 고쳐도 된다. STATE 항목과 정말 무관한 작업만 [id=-]. 작업 기록은 커밋 메시지가 맡으므로 STATE 내용을 고치거나 덧붙여서는 풀리지 않는다 (block ✕)."
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
}STATE reminder: 기준점 이후 만든 커밋이 판정 상한(1000개)을 넘어 이번 커밋 [id=] 판정을 건너뛰었습니다."
  fi
  if [ "${concurrent_count:-0}" -gt 0 ]; then
    msg="${msg}${msg:+
}STATE reminder: 같은 worktree의 다른 활성 세션 ${concurrent_count}개가 감지되어 이번 턴의 새 커밋 [id=] 판정을 보류했습니다. worktree를 분리하세요."
  fi
else
  # 분류 정본은 JavaScript RegExp 한 곳뿐이다. 엔진 실패를 다른 regex dialect로
  # 추측하지 않고 명시적 오류를 보인다.
  if [ -z "$baseline_engine_error" ]; then
    msg="${msg}${msg:+
}STATE 기준점 평가 결과를 해석하지 못했습니다: ${delta:0:400}"
  fi
  state_diff=""
fi

# 이번 턴에 STATE가 바뀐 경우 구조·hash·크기를 재검하되, 이번 턴에 바뀐 STATE 경로를 언급하는
# 경고만 보인다. 다른 detail의 기존 경고는 SessionStart 주입이 맡으며 매 Stop마다 반복하지 않는다.
# 경고 줄은 항상 ' <경로>' 형태로 경로를 담는다(앞 공백으로 STATE.md ↔ apps/x/STATE.md 혼동 방지).
# 크기(cap) 경고만으로는 attention을 켜지 않는다 — 큰 detail에 owner만 바꾼 턴이 강제 continue되면
# STATE를 건드리지 않는 쪽이 조용해진다. 이번 턴의 증가는 덧붙임 알림이 맡는다.
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
  if printf '%s\n' "$state_warnings" | grep -vqE '\(detail cap [0-9]+B 초과\)|## 현재 [0-9]+B \(cap [0-9]+B\)'; then
    attention=true
  fi
fi

if [ -n "$msg" ]; then
  if [ "${STATE_LEDGER_HOST:-}" = "antigravity" ]; then
    jq -n --arg msg "$msg" --argjson attention "$attention" '{systemMessage: $msg, stateLedgerContinue: $attention}'
  else
    jq -n --arg msg "$msg" '{systemMessage: $msg}'
  fi
fi

exit 0
