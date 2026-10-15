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
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"=== STATE hook 경고 ===\\njq가 PATH에 없어 STATE 주입과 기준점 저장을 실행하지 못했습니다."}}'
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

# 첫 사용자 프롬프트 전에도 기준점이 존재하게 하되 compact/resume가 진행 중인
# 턴의 기존 기준점을 덮어쓰지 않도록 없을 때만 생성한다.
baseline_error=""
baseline_result=""
if [ -n "$config_error" ]; then
  baseline_error=""
elif ! command -v node >/dev/null 2>&1; then
  baseline_error="node가 PATH에 없어 STATE 턴 기준점을 저장하지 못했습니다."
elif ! baseline_result=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-turn-baseline.mjs" snapshot-if-absent 2>&1); then
  baseline_error="STATE 턴 기준점 저장 실패: ${baseline_result:0:400}"
fi
if [ -n "$baseline_error" ]; then
  out="=== STATE hook 경고 ===
$baseline_error"
fi
concurrent_count=$(printf '%s' "$baseline_result" | jq -r '.concurrentSessions | length // 0' 2>/dev/null || echo 0)
if [ "${concurrent_count:-0}" -gt 0 ]; then
  out="${out}${out:+

}=== STATE hook 경고 ===
같은 worktree에서 최근 30분 내 다른 활성 세션 ${concurrent_count}개가 감지됐습니다. 변경 귀속이 불명확하므로 Stop의 code↔STATE 판정은 보류됩니다."
fi

STATE_PRINCIPLE='STATE = 공유 상태판. 남은 일·소유·결정이 바뀌면 그 줄을 바꿔 쓴다. 작업 기록은 커밋 메시지 [id=<id>].'
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

# STATE↔git 브랜치 정합 + 크기·라우팅 예산 warn (warn-only)
sync=""
budget=""
if [ -z "$config_error" ]; then
  sync=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-branch-sync.sh" 2>/dev/null || true)
  budget=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-wip-cap.sh" 2>&1 || true)
fi
warns="${sync}${sync:+${budget:+
}}${budget}"
if [ -n "$warns" ]; then
  out="${out}${out:+

}=== STATE 정합·예산 (warn-only) ===
$warns"
fi

[ -z "$out" ] && exit 0

jq -n --arg ctx "$out" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'

exit 0
