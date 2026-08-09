#!/bin/bash
# SessionStart hook — STATE 인덱스 주입 + 정합·예산 warn.
# 상세는 docs/state/<area>/<id>.md — 에이전트가 작업을 잡을 때 해당 파일만 읽는다 (lazy loading).
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

# .staterc — KEY="value" 고정 형식만 읽는다 (source ✕: set -u 중단·변수 오염·임의 실행 방지)
read_staterc() {
  [ -f "$root/.staterc" ] || return 0
  sed -nE "s/^$1=\"([^\"]*)\"[[:space:]]*\$/\1/p" "$root/.staterc" | head -1
}
v=$(read_staterc STATE_INDEXES); STATE_INDEXES="${v:-STATE.md}"

out=""

# 첫 사용자 프롬프트 전에도 기준점이 존재하게 하되 compact/resume가 진행 중인
# 턴의 기존 기준점을 덮어쓰지 않도록 없을 때만 생성한다.
baseline_error=""
baseline_result=""
if ! command -v node >/dev/null 2>&1; then
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

for f in $STATE_INDEXES; do
  [ -f "$root/$f" ] || continue
  out="${out}${out:+

}=== $f ===
$(cat "$root/$f")"
done

# STATE↔git 브랜치 정합 + 크기·라우팅 예산 warn (warn-only)
sync=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-branch-sync.sh" 2>/dev/null || true)
budget=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-wip-cap.sh" 2>&1 || true)
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
