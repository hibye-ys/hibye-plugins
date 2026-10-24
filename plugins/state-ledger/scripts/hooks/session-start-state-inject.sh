#!/bin/bash
# SessionStart hook — STATE 인덱스 주입 + 정합·예산 warn.
# 상세는 docs/state/<area>/<id>.md — 에이전트가 작업을 잡을 때 해당 파일만 읽는다 (lazy loading).
# 인덱스 머리에 원칙 한 줄을 붙인다: STATE는 공유 상태판이고 작업 기록은 커밋 메시지가 맡는다.
#
# 툴 중립: Claude Code / Codex 모두 stdin→stdout JSON 프로토콜로 동일 동작.
# opencode는 instructions 방식으로 STATE.md를 직접 주입하므로 이 스크립트를 호출하지 않음.
#
# 프로젝트 설정: 루트 `.staterc` (선택) — STATE_INDEXES="STATE.md apps/api/STATE.md" 식.

set -u

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"=== STATE hook 경고 ===\\njq가 PATH에 없어 STATE 주입을 실행하지 못했습니다."}}'
  exit 0
fi

input=$(cat)
root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

out=""
indexes=""
config_error=""
if ! command -v node >/dev/null 2>&1; then
  config_error="node가 PATH에 없어 STATE_INDEXES를 안전하게 검증하지 못했습니다."
elif ! indexes=$(HOOK_PROJECT_DIR="$root" node "$script_dir/state-config.mjs" indexes 2>&1); then
  config_error="STATE 설정 거부: ${indexes:0:400}"
  indexes=""
fi
if [ -n "$config_error" ]; then
  out="=== STATE hook 경고 ===
$config_error"
fi

# 같은 worktree의 동시 세션은 읽기만 한다. 턴 기준점은 UserPromptSubmit이 매 턴 저장하므로
# 여기서 만들지 않는다 — 프롬프트 없이 열린 세션이 다른 세션의 판정을 보류시키지 않게.
sessions_result=""
if [ -z "$config_error" ] && ! sessions_result=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-turn-baseline.mjs" sessions 2>&1); then
  out="=== STATE hook 경고 ===
STATE 동시 세션 확인 실패: ${sessions_result:0:400}"
  sessions_result=""
fi
concurrent_count=$(printf '%s' "$sessions_result" | jq -r '.concurrentSessions | length // 0' 2>/dev/null || echo 0)
if [ "${concurrent_count:-0}" -gt 0 ]; then
  out="${out}${out:+

}=== STATE hook 경고 ===
같은 worktree에서 최근 30분 내 다른 활성 세션 ${concurrent_count}개가 감지됐습니다. 변경 귀속이 불명확하므로 Stop의 커밋 태그·덧붙임 판정은 보류됩니다."
fi

# 정합 검사 원본은 그대로 둔다. 시작 맥락에는 종류·건수·대표와 원본 조회 경로만 넣는다.
# 초기화 오류와 전체 조회 경로는 인덱스보다 먼저 전달한다.
if [ -z "$config_error" ]; then
  sync=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-branch-sync.sh" 2>&1 || true)
  budget=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-wip-cap.sh" 2>&1 || true)
  if summary=$(printf '%s\n%s' "$sync" "$budget" | node "$script_dir/session-start-warning-summary.mjs" "$root" "$script_dir/../.." 2>&1); then
    initialization=$(printf '%s' "$summary" | jq -r '.initialization')
    warning_summary=$(printf '%s' "$summary" | jq -r '.summary')
    for section in "$initialization" "$warning_summary"; do
      [ -n "$section" ] || continue
      out="${out}${out:+

}$section"
    done
  else
    out="${out}${out:+

}=== STATE hook 경고 ===
STATE 경고 요약 실행 실패: ${summary:0:400}
전체 경고는 $script_dir/../check-state-branch-sync.sh 와 $script_dir/../check-state-wip-cap.sh 를 HOOK_PROJECT_DIR=$root 로 다시 조회하세요."
  fi
fi

STATE_PRINCIPLE='STATE = 공유 상태판. 남은 일·소유·결정이 바뀌면 그 줄을 바꿔 쓴다. 작업 기록은 커밋 메시지 [id=<id>] (STATE 항목과 무관하면 [id=-]).'
principle_added=0
total_bytes=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$root/$f" ] || continue
  bytes=$(wc -c < "$root/$f" 2>/dev/null || echo 0)
  if [ "${bytes:-0}" -gt 16384 ]; then
    out="${out}${out:+

}=== STATE hook 경고 ===
$f ${bytes}B — SessionStart 주입 cap 16384B를 초과해 생략했습니다."
    continue
  fi
  total_bytes=$((total_bytes + bytes))
  if [ "$total_bytes" -gt 65536 ]; then
    out="${out}${out:+

}=== STATE hook 경고 ===
STATE 인덱스 합계가 SessionStart 주입 cap 65536B를 초과해 $f부터 생략했습니다."
    break
  fi
  if [ "$principle_added" -eq 0 ]; then
    out="${out}${out:+

}$STATE_PRINCIPLE"
    principle_added=1
  fi
  out="${out}${out:+

}=== $f ===
$(cat "$root/$f")"
done <<EOF
$indexes
EOF

if command -v node >/dev/null 2>&1; then
  cleanup_context=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-cleanup.mjs" context 2>&1)
  cleanup_status=$?
  if [ "$cleanup_status" -ne 0 ]; then cleanup_context="STATE 정리 요청 초기화 실패: $cleanup_context"; fi
  if [ -n "$cleanup_context" ]; then out="$cleanup_context

$out"; fi
fi

[ -z "$out" ] && exit 0

jq -n --arg ctx "$out" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'

exit 0
