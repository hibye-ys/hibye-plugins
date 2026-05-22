#!/usr/bin/env bash
# audit-all.sh — apps/api/ 에 audit 24 일괄 실행. pre-deploy-check 의 Step 3.
# 각 audit 의 grep 패턴 = 해당 SKILL.md 본문 발췌.
#
# NOTE: 이 batch script 는 *문턱 검사* 만 — 빠른 fail-fast. 각 audit 의 *전체* 패턴 (block-level, multi-pattern)
# 검증은 해당 SKILL.md 의 ## 실행 섹션 참조. CI 의 pre-deploy 단계는 *문턱 검사* 통과 + 수동 audit *전체 패턴* 모두.
#
# Usage: ./audit-all.sh [api-dir]
#   api-dir 미지정 시 = cwd. 일반적으로 apps/api/ 안에서 실행.
#
# 24 audit:
#   기존 13 — provider-retry / sse-lifecycle / single-writer / token-budget /
#            tool-sort-order / input-safety / mcp-namespace / compaction-thresholds /
#            http-error-sentinels / run-policy-presets / spawn-limits /
#            app-domain-boundary / d1-forbidden
#   신규 11 (Task 9e.1–9e.11) — agent-verify-def / api-audit / data-audit /
#            full-architecture / infra / loop / session / security-audit-check /
#            rule-linting / dependency-scanning / runtime-verify

set -uo pipefail

# API_DIR 인자 또는 cwd. grep 경로는 API_DIR 기준 *상대*
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

# ─────────────────────────── 기존 13 audit ───────────────────────────

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

# 12. app-domain-boundary-audit (envvar 기반, instance 측 정의)
# DOMAIN_VOCAB envvar 는 instance 측에서 export (pipe-separated alternation):
#   - iyaki 예: export DOMAIN_VOCAB='writer|author|scenario|novel|character|persona'
#   - blog 예:  export DOMAIN_VOCAB='post|comment|tag|category'
# 미정의 시 SKIP (audit fail 아님 — instance-specific 어휘이므로).
if [[ -n "${DOMAIN_VOCAB:-}" ]]; then
  for dir in src/ai src/sse src/storage src/middleware; do
    [[ -d "$dir" ]] && run_audit "app-domain-boundary-$dir" "\\b(${DOMAIN_VOCAB})\\b" "$dir"
  done
else
  echo "SKIP [app-domain-boundary]: DOMAIN_VOCAB envvar 미정의 — instance 측에서 export 필요"
fi

# 13. d1-forbidden-audit (spec §1.2 enforce)
if [[ -f wrangler.toml ]]; then
  run_audit "d1-forbidden-wrangler" 'd1_databases|D1Database' wrangler.toml
fi
if [[ -f wrangler.jsonc ]]; then
  run_audit "d1-forbidden-wrangler-jsonc" 'd1_databases|D1Database' wrangler.jsonc
fi
run_audit "d1-forbidden-code" '\bD1Database\b' src/

# ─────────────────────────── 신규 11 audit (Task 9e.1–9e.11) ───────────────────────────

# 14. agent-verify-def — agent default export 필수 필드 + name 중복
agent_verify_def_check() {
  [[ ! -d src/agents ]] && { echo "SKIP [agent-verify-def]: src/agents/ 없음"; return; }
  local count=0
  for f in src/agents/*.ts; do
    [[ -f "$f" ]] || continue
    for field in name version step modelMix; do
      grep -q "$field" "$f" || { echo "VIOLATION [agent-verify-def]: $f missing $field"; count=$((count+1)); }
    done
  done
  # name 중복
  local dups
  dups=$(grep -hE "^\s*name:\s*['\"]" src/agents/*.ts 2>/dev/null \
    | sed -E "s/.*name:\s*['\"]([^'\"]+)['\"].*/\1/" \
    | sort | uniq -d | wc -l | tr -d ' ')
  if [[ $dups -gt 0 ]]; then
    echo "VIOLATION [agent-verify-def]: $dups 개 name 중복"
    count=$((count+dups))
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [agent-verify-def]"
}
agent_verify_def_check

# 15. api-audit — POST/PUT/PATCH 안 zValidator 누락 + protected path auth 누락
# BSD awk 호환: `\s` → `[[:space:]]`
api_audit_check() {
  [[ ! -d src/routes ]] && { echo "SKIP [api-audit]: src/routes/ 없음"; return; }
  local count=0
  for f in $(find src/routes -type f -name '*.ts' 2>/dev/null); do
    awk '/app\.(post|put|patch)\(/{flag=1; start=NR}
         flag && /zValidator/{flag=0}
         flag && /\)[[:space:]]*$/{print FILENAME":"start": missing zValidator"; flag=0; count++}
         END {exit count>0?1:0}' "$f" 2>/dev/null
    [[ $? -ne 0 ]] && count=$((count+1))
  done
  # protected auth
  if [[ -d src/routes/protected ]]; then
    local no_auth
    no_auth=$(grep -L "authMiddleware" src/routes/protected/*.ts 2>/dev/null | wc -l | tr -d ' ')
    if [[ $no_auth -gt 0 ]]; then
      echo "VIOLATION [api-audit]: $no_auth protected route(s) missing authMiddleware"
      count=$((count+no_auth))
    fi
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [api-audit]"
}
api_audit_check

# 16. data-audit — migration 순서 + FK 인덱스 (full check 는 SKILL.md 참조)
data_audit_check() {
  local count=0
  if [[ -d drizzle ]]; then
    ls drizzle/*.sql 2>/dev/null | sort -c 2>/dev/null \
      || { echo "VIOLATION [data-audit]: migration 순서 어긋남"; count=$((count+1)); }
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [data-audit]"
}
data_audit_check

# 17. full-architecture-audit — 디렉토리 화이트리스트 + 4-layer 역참조
full_architecture_check() {
  [[ ! -d src ]] && { echo "SKIP [full-architecture]: src/ 없음"; return; }
  local count=0
  local extra
  extra=$(ls src/ 2>/dev/null \
    | grep -vE "^(routes|agents|runs|providers|db|storage|middleware|index\.ts)$" \
    | wc -l | tr -d ' ')
  if [[ $extra -gt 0 ]]; then
    echo "VIOLATION [full-architecture]: $extra 화이트리스트 외 디렉토리"
    count=$((count+extra))
  fi
  # 4-layer 역참조 (db / providers 에서 routes import)
  local reverse
  reverse=$(grep -rE "from\s+['\"](?:\.\./)+routes" src/db/ src/providers/ 2>/dev/null | wc -l | tr -d ' ')
  if [[ $reverse -gt 0 ]]; then
    echo "VIOLATION [full-architecture]: $reverse 역참조 (db/providers → routes)"
    count=$((count+reverse))
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [full-architecture]"
}
full_architecture_check

# 18. infra-audit — wrangler 필수 키 + binding + preview env
infra_audit_check() {
  local wrangler="wrangler.toml"
  [[ ! -f "$wrangler" ]] && wrangler="wrangler.jsonc"
  [[ ! -f "$wrangler" ]] && { echo "SKIP [infra-audit]: wrangler config 없음"; return; }
  local count=0
  for key in name main compatibility_date; do
    grep -qE "^\s*\"?${key}\"?\s*[:=]" "$wrangler" \
      || { echo "VIOLATION [infra-audit]: missing $key"; count=$((count+1)); }
  done
  for binding in DATABASE_URL OPENROUTER_API_KEY; do
    grep -q "$binding" "$wrangler" \
      || { echo "VIOLATION [infra-audit]: missing $binding binding"; count=$((count+1)); }
  done
  grep -qE "\[env\.preview\]|\"preview\"\s*:" "$wrangler" \
    || { echo "VIOLATION [infra-audit]: missing preview env"; count=$((count+1)); }
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [infra-audit]"
}
infra_audit_check

# 19. loop-audit — while(true) 안 break/abort/turn 종료 조건
# BSD awk 호환: `\s` → `[[:space:]]` (macOS awk 가 PCRE 미지원)
loop_audit_check() {
  local count=0
  # 단일 패스 — 출력 캡처 후 표시 + 집계 (이중 awk 제거)
  local output
  output=$(for f in $(find src/agents src/runs -type f -name '*.ts' 2>/dev/null); do
    awk '/while[[:space:]]*\([[:space:]]*true[[:space:]]*\)/{flag=1; start=NR; brace_depth=0}
         flag && /\{/{brace_depth++}
         flag && /(break|abort|signal\.aborted|turn[[:space:]]*[>=])/{flag=0}
         flag && /\}/{
           brace_depth--
           if (brace_depth <= 0) {
             print FILENAME":"start
             flag=0
           }
         }' "$f" 2>/dev/null
  done)
  if [[ -n "$output" ]]; then
    while IFS= read -r line; do
      echo "VIOLATION [loop-audit]: $line: unsafe while(true)"
      count=$((count+1))
    done <<< "$output"
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [loop-audit]"
}
loop_audit_check

# 20. session-audit — KV.put TTL 누락 + c.env.KV 직접 접근
session_audit_check() {
  [[ ! -d src ]] && { echo "SKIP [session-audit]: src/ 없음"; return; }
  local count=0
  # TTL 누락 — pipe-subshell 회피 위해 출력 캡처 후 본 셸 loop
  local ttl_candidates
  ttl_candidates=$(rg -nP "\.put\(" src/ 2>/dev/null | grep -E "(KV|kv)" || true)
  if [[ -n "$ttl_candidates" ]]; then
    while IFS=: read -r file ln rest; do
      [[ -z "$file" ]] && continue
      awk -v ln="$ln" 'NR>=ln && NR<=ln+5 {print}' "$file" | grep -q "expirationTtl" && continue
      echo "VIOLATION [session-audit]: $file:$ln missing expirationTtl"
      count=$((count+1))
    done <<< "$ttl_candidates"
  fi
  # c.env.KV 우회
  local bypass
  bypass=$(rg -nP "c\.env\.\w*KV\w*\." src/ 2>/dev/null | grep -v "src/storage/" | wc -l | tr -d ' ')
  if [[ $bypass -gt 0 ]]; then
    echo "VIOLATION [session-audit]: $bypass storage adapter 우회"
    count=$((count+bypass))
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [session-audit]"
}
session_audit_check

# 21. security-audit-check — secret / eval / dynamic require / SQL inj / SSRF
security_audit_check() {
  [[ ! -d src ]] && { echo "SKIP [security-audit-check]: src/ 없음"; return; }
  local count=0
  local m
  m=$(rg -nP "(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]+)" src/ 2>/dev/null | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m hardcoded secret"; count=$((count+m)); }
  m=$(rg -nP "\beval\(|new\s+Function\(" src/ 2>/dev/null | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m eval/new Function"; count=$((count+m)); }
  m=$(rg -nP "require\([^'\"\\\`]+\)" src/ 2>/dev/null | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m 동적 require"; count=$((count+m)); }
  m=$(rg -nP "fetch\(\s*(req\.|body\.|c\.req\.)" src/ 2>/dev/null | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m SSRF 의심"; count=$((count+m)); }
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [security-audit-check]"
}
security_audit_check

# 22. rule-linting — 본 plugin 자체 frontmatter (apps/api 가 아니라 plugin 검증 — manual 만 표시)
echo "MANUAL [rule-linting]: 본 plugin 의 skills/*/SKILL.md frontmatter 검증은 rule-linting/SKILL.md 의 ## 실행 직접 호출"

# 23. dependency-scanning — Node built-in import (node: prefix 없는)
dependency_scanning_check() {
  [[ ! -d src ]] && { echo "SKIP [dependency-scanning]: src/ 없음"; return; }
  local m
  m=$(rg -nP "from\s+['\"](?:fs|net|tls|child_process|cluster|dgram|dns|http|https|os|path|stream|tty|vm)['\"]" \
       src/ 2>/dev/null | grep -v "node:" | grep -v "// workers-compat-ok" | wc -l | tr -d ' ')
  if [[ $m -gt 0 ]]; then
    echo "VIOLATION [dependency-scanning]: $m Node built-in import (node: prefix 누락)"
    VIOLATIONS=$((VIOLATIONS + m))
  else
    echo "PASS [dependency-scanning]"
  fi
}
dependency_scanning_check

# 24. runtime-verify — endpoint hit 은 배포 후 별도 실행 (manual)
echo "MANUAL [runtime-verify]: 배포 후 runtime-verify/SKILL.md 의 ## 실행 (BASE_URL 지정) 별도 호출"

# ─────────────────────────── 결론 ───────────────────────────
echo ""
echo "===================="
echo "Total violations: $VIOLATIONS"
echo "===================="
exit $VIOLATIONS
