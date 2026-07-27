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
  exit 0
fi

root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"

# .staterc — KEY="value" 고정 형식만 읽는다 (source ✕: set -u 중단·변수 오염·임의 실행 방지)
read_staterc() {
  [ -f "$root/.staterc" ] || return 0
  sed -nE "s/^$1=\"([^\"]*)\"[[:space:]]*\$/\1/p" "$root/.staterc" | head -1
}
v=$(read_staterc STATE_INDEXES); STATE_INDEXES="${v:-STATE.md}"

out=""
for f in $STATE_INDEXES; do
  [ -f "$root/$f" ] || continue
  out="${out}${out:+

}=== $f ===
$(cat "$root/$f")"
done

# STATE↔git 브랜치 정합 + 크기·라우팅 예산 warn (warn-only)
sync=$(HOOK_PROJECT_DIR="$root" bash "$root/scripts/check-state-branch-sync.sh" 2>/dev/null || true)
budget=$( (cd "$root" && bash scripts/check-state-wip-cap.sh 2>&1) || true )
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
