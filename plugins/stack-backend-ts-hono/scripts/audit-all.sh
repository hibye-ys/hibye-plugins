#!/usr/bin/env bash
# audit-all.sh — apps/api/src/ 에 audit 13 일괄 실행. pre-deploy-check 의 Step 3.
# 각 audit 의 grep 패턴 = 해당 SKILL.md 본문 발췌.
#
# NOTE: 이 batch script 는 *문턱 검사* 만 — 빠른 fail-fast. 각 audit 의 *전체* 패턴 (block-level, multi-pattern)
# 검증은 해당 SKILL.md 의 ## 실행 섹션 참조. CI 의 pre-deploy 단계는 *문턱 검사* 통과 + 수동 audit *전체 패턴* 모두.
#
# Usage: ./audit-all.sh [api-dir]
#   api-dir 미지정 시 = cwd. 일반적으로 apps/api/ 안에서 실행.

set -uo pipefail

# Codex 4차 정정 — API_DIR 인자 또는 cwd. grep 경로는 API_DIR 기준 *상대*
API_DIR="${1:-$(pwd)}"
cd "$API_DIR" || { echo "error: API_DIR not found: $API_DIR" >&2; exit 2; }

VIOLATIONS=0

run_audit() {
  local name="$1"
  local pattern="$2"
  local dir="$3"
  if [[ ! -d "$dir" ]]; then
    echo "SKIP [$name]: $dir 디렉토리 없음 (apps/api/src 아직 비어 있을 수 있음)"
    return
  fi
  local matches
  matches=$(grep -rEnc "$pattern" "$dir" 2>/dev/null | awk -F: '{sum += $2} END {print sum+0}')
  if [[ $matches -gt 0 ]]; then
    echo "VIOLATION [$name]: $matches matches in $dir"
    VIOLATIONS=$((VIOLATIONS + matches))
  else
    echo "PASS [$name]"
  fi
}

# 1. provider-retry-audit
run_audit "provider-retry" 'retry.*\b(401|403|404|422)\b|\b(401|403|404|422)\b.*retry' src/ai/providers/

# 2. sse-lifecycle-audit (setInterval Workers 비호환)
run_audit "sse-lifecycle-setInterval" 'setInterval\(' src/sse/

# 3. single-writer-audit — file-level
single_writer_check() {
  [[ ! -d src ]] && { echo "SKIP [single-writer]: src/ 없음"; return; }
  local count=0
  for f in $(grep -rlE '\.(put|delete)\(' src/ 2>/dev/null); do
    grep -qE 'lock|mutex|transaction' "$f" || { echo "VIOLATION [single-writer]: no-lock in $f"; count=$((count+1)); }
  done
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [single-writer]"
}
single_writer_check

# 4. token-budget-audit
run_audit "token-budget" '\b(8000|16000|32000|128000)\b' src/context/

# 5. tool-sort-order-audit — 수동 비교 필요. registry.ts 존재 여부만 체크
if [[ -f src/tools/registry.ts ]]; then
  echo "MANUAL [tool-sort-order]: src/tools/registry.ts 등록 순서를 SKILL.md 의 invariant 와 수동 비교"
fi

# 6. input-safety-audit (zod parse 누락)
input_safety_check() {
  [[ ! -d src/routes ]] && { echo "SKIP [input-safety]: src/routes/ 없음"; return; }
  local missing
  missing=$(grep -rEn 'await\s+c\.req\.json\(\)' src/routes/ -A 5 2>/dev/null | grep -B 5 -v 'parse\|safeParse\|z\.' | grep -c 'c\.req\.json' || true)
  if [[ $missing -gt 0 ]]; then
    echo "VIOLATION [input-safety]: $missing 곳 c.req.json() 다음 5줄 안 zod parse 없음"
    VIOLATIONS=$((VIOLATIONS + missing))
  else
    echo "PASS [input-safety]"
  fi
}
input_safety_check

# 7. mcp-namespace-audit (prefix 중복)
mcp_namespace_check() {
  [[ ! -d src/mcp ]] && { echo "SKIP [mcp-namespace]: src/mcp/ 없음"; return; }
  local dups
  dups=$(grep -rE "prefix:\\s*[\"']([^\"']+)[\"']" src/mcp/ 2>/dev/null | awk -F'"' '{print $2}' | sort | uniq -d | wc -l | tr -d ' ')
  if [[ $dups -gt 0 ]]; then
    echo "VIOLATION [mcp-namespace]: $dups 개 prefix 중복"
    VIOLATIONS=$((VIOLATIONS + dups))
  else
    echo "PASS [mcp-namespace]"
  fi
}
mcp_namespace_check

# 8. compaction-thresholds-audit (매직 넘버 0.5-0.95)
run_audit "compaction-thresholds" '\b(0\.[5-9]|0\.95)\b' src/context/compaction

# 9. http-error-sentinels-audit (throw new Error in routes/)
run_audit "http-error-sentinels-route" 'throw\s+new\s+Error\(' src/routes/
run_audit "http-error-sentinels-service" 'throw\s+new\s+Error\(' src/services/

# 10. run-policy-presets-audit (timeout/max_turns 매직 넘버)
run_audit "run-policy-presets" 'timeout:\s*[0-9]+|max.turns?:\s*[0-9]+|maxTurns:\s*[0-9]+' src/ai/

# 11. spawn-limits-audit (limit 없는 Promise.all)
spawn_limits_check() {
  [[ ! -d src/ai/sub-agents ]] && { echo "SKIP [spawn-limits]: src/ai/sub-agents/ 없음"; return; }
  local missing
  missing=$(grep -rEn 'Promise\.(all|allSettled)\(' src/ai/sub-agents/ -A 3 2>/dev/null | grep -B 3 -v 'limit\|MAX_PARALLEL\|p-limit' | grep -c 'Promise\.' || true)
  if [[ $missing -gt 0 ]]; then
    echo "VIOLATION [spawn-limits]: $missing 곳 limit 없는 parallel"
    VIOLATIONS=$((VIOLATIONS + missing))
  else
    echo "PASS [spawn-limits]"
  fi
}
spawn_limits_check

# 12. app-domain-boundary-audit (core 에 도메인 어휘)
for dir in src/ai src/sse src/storage src/middleware; do
  [[ -d "$dir" ]] && run_audit "app-domain-boundary-$dir" '\b(writer|author|scenario|novel|character|persona)\b' "$dir"
done

# 13. d1-forbidden-audit (spec §1.2 enforce, Codex 4차 추가)
if [[ -f wrangler.toml ]]; then
  run_audit "d1-forbidden-wrangler" 'd1_databases|D1Database' wrangler.toml
fi
if [[ -f wrangler.jsonc ]]; then
  run_audit "d1-forbidden-wrangler-jsonc" 'd1_databases|D1Database' wrangler.jsonc
fi
run_audit "d1-forbidden-code" '\bD1Database\b' src/

# 결론
echo ""
echo "===================="
echo "Total violations: $VIOLATIONS"
echo "===================="
exit $VIOLATIONS
