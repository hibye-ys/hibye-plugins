#!/bin/bash
# Stop hook — 이번 턴 것만 한 번씩 알린다 (warn-only, block ✕, 다음 턴으로 넘기지 않는다):
#   1. 이번 턴에 만든 커밋 중 작업 파일을 바꾸고도 메시지에 유효 STATE [id=<id>]가 없는 커밋
#   2. 이번 턴에 1KB 넘게 늘어난 detail 본문 (작업 경과 덧붙이기)
#   3. 이번 턴에 바뀐 STATE 경로의 구조·크기 경고
# 작업 기록은 커밋 메시지가 맡고 STATE는 공유 상태판이다.
#
# 툴 중립: Claude Code / Codex 모두 stdin→stdout JSON 프로토콜로 동일 동작.
# 비차단 알림은 두 툴이 공통 지원하는 top-level systemMessage 로 반환한다.
# opencode: session.idle 이벤트에서 플러그인이 호출하고 systemMessage 를 로그로 표시한다.
# Antigravity(STATE_LEDGER_HOST=antigravity): 1·2 또는 크기 외 구조 경고가 있으면
# stateLedgerContinue=true 를 함께 내 어댑터가 1회 continue 하게 한다.
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

# 판정·계산은 node 엔진이 하고 이 스크립트는 표시만 한다. 엔진은 Stop 시점을 새 기준점으로 저장한다.
# 엔진 stdout(JSON)과 stderr(오류)는 섞지 않는다. 기준점 부재·저장 실패는 정상으로 숨기지 않고 경고한다.
delta=""
msg=""
if command -v node >/dev/null 2>&1; then
  engine_err_file=$(mktemp "${TMPDIR:-/tmp}/state-ledger-stop.XXXXXX" 2>/dev/null) || engine_err_file=""
  if ! delta=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-turn-baseline.mjs" evaluate 2>"${engine_err_file:-/dev/null}"); then
    engine_err=""
    [ -n "$engine_err_file" ] && engine_err=$(cat "$engine_err_file" 2>/dev/null)
    msg="STATE 기준점 평가 실패: ${engine_err:0:400}"
    delta=""
  fi
  [ -n "$engine_err_file" ] && rm -f "$engine_err_file"
else
  msg="node가 PATH에 없어 STATE 기준점 평가를 실행하지 못했습니다."
fi
engine_failed="$msg"

add() {
  msg="${msg}${msg:+
}$1"
}
# 이번 턴 알림이 있는가 (Antigravity continue 판단용). 오류·보류·크기 경고만으로는 켜지 않는다.
attention=false

# 커밋 목록은 '<sha7> <제목>'으로 6개까지 보이고 넘치면 개수를 붙인다.
commit_list='map("\(.sha[0:7]) \(.subject)") | if length > 6 then (.[0:6] | join(", ")) + " 외 \(length - 6)개" else join(", ") end'
state_diff=""
if [ -n "$delta" ] && printf '%s' "$delta" | jq -e '
  (.stateChanged | type == "array") and (.untaggedCommits | type == "array") and
  (.unknownIdCommits | type == "array") and (.appendedDetails | type == "array") and
  (.concurrentSessions | type == "array")
' >/dev/null 2>&1; then
  state_diff=$(printf '%s' "$delta" | jq -r '.stateChanged[]')
  baseline_error=$(printf '%s' "$delta" | jq -r '.baselineError // empty')
  untagged=$(printf '%s' "$delta" | jq -r ".untaggedCommits | $commit_list")
  unknown=$(printf '%s' "$delta" | jq -r ".unknownIdCommits | $commit_list")
  unknown_ids=$(printf '%s' "$delta" | jq -r '[.unknownIdCommits[].ids[]] | unique | map("[id=\(.)]") | join(", ")')
  appended=$(printf '%s' "$delta" | jq -r '.appendedDetails[] | "STATE reminder: \(.path) 본문이 이번 턴에 \(.after - .before) B 늘었습니다 — 작업 경과를 덧붙이지 말고 남은 일·결정·WHY를 바꿔 쓰세요."')
  range_skipped=$(printf '%s' "$delta" | jq -r '.commitRangeSkipped == true')
  concurrent_count=$(printf '%s' "$delta" | jq -r '.concurrentSessions | length')
  if [ -n "$baseline_error" ]; then
    add "STATE 기준점이 정상 상태가 아닙니다: ${baseline_error}. 현재 worktree를 보수적으로 새 기준점으로 삼았습니다."
  fi
  if [ -n "$untagged" ]; then
    attention=true
    add "STATE reminder: 이번 턴 커밋 중 STATE id 태그가 없는 커밋 — ${untagged}. 작업 기록은 커밋 메시지 [id=<id>]로 남긴다(STATE 항목과 무관한 잡무는 [id=-]). 직접 만든 미push 직전 커밋이면 git commit --amend로 붙이고, 아니면 다음 커밋부터 붙인다. STATE에 경과를 적어 대신하지 않는다."
  fi
  if [ -n "$unknown" ]; then
    attention=true
    add "STATE reminder: 이번 턴 커밋의 ${unknown_ids}가 STATE 인덱스에 없다 — ${unknown}. 오타·archive된 id인지 확인하고, 새 작업이면 인덱스에 한 줄 등재한다."
  fi
  if [ -n "$appended" ]; then
    attention=true
    add "$appended"
  fi
  if [ "$range_skipped" = "true" ]; then
    add "STATE reminder: 이번 턴 커밋이 판정 상한(1000개)을 넘어 커밋 태그 판정을 건너뛰었습니다."
  fi
  if [ "${concurrent_count:-0}" -gt 0 ]; then
    add "STATE reminder: 같은 worktree의 다른 활성 세션 ${concurrent_count}개가 감지되어 이번 턴의 커밋 태그·덧붙임 판정을 보류했습니다. worktree를 분리하세요."
  fi
elif [ -z "$engine_failed" ]; then
  # 분류 정본은 JavaScript RegExp 한 곳뿐이다. 엔진 결과를 다른 regex dialect로 추측하지 않는다.
  add "STATE 기준점 평가 결과를 해석하지 못했습니다: ${delta:0:400}"
fi

# 이번 턴에 STATE가 바뀐 경우 구조·hash·크기를 재검하되, 이번 턴에 바뀐 STATE 경로를 언급하는
# 경고만 보인다. 다른 detail의 기존 경고는 SessionStart 주입이 맡으며 매 Stop마다 반복하지 않는다.
# 경고 줄은 항상 ' <경로>' 형태로 경로를 담는다(앞 공백으로 STATE.md ↔ apps/x/STATE.md 혼동 방지).
# 크기(cap) 경고만으로는 attention을 켜지 않는다 — 큰 detail에 owner만 바꾼 턴이 강제 continue되면
# STATE를 건드리지 않는 쪽이 조용해진다. 이번 턴의 증가는 덧붙임 알림이 맡는다.
if [ -n "$state_diff" ]; then
  all_warnings=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-wip-cap.sh" 2>&1 || true)
  patterns=()
  while IFS= read -r changed_path; do
    [ -n "$changed_path" ] && patterns+=(-e " $changed_path")
  done <<EOF
$state_diff
EOF
  state_warnings=""
  if [ -n "$all_warnings" ] && [ "${#patterns[@]}" -gt 0 ]; then
    state_warnings=$(printf '%s\n' "$all_warnings" | grep -F "${patterns[@]}" || true)
  fi
  if [ -n "$state_warnings" ]; then
    add "$state_warnings"
    if printf '%s\n' "$state_warnings" | grep -vqE '\(detail cap [0-9]+B 초과\)|## 현재 [0-9]+B \(cap [0-9]+B\)'; then
      attention=true
    fi
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
