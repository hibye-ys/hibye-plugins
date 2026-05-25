#!/usr/bin/env bash
# audit-all.sh — apps/api/ 에 audit 25 일괄 실행. deploy 전 체크 (instance 측 project-local skill) 의 Step 3.
# 각 audit 의 grep 패턴 = 해당 SKILL.md 본문 발췌.
#
# NOTE: 이 batch script 는 *문턱 검사* 만 — 빠른 fail-fast. 각 audit 의 *전체* 패턴 (block-level, multi-pattern)
# 검증은 해당 SKILL.md 의 ## 실행 섹션 참조. CI 의 pre-deploy 단계는 *문턱 검사* 통과 + 수동 audit *전체 패턴* 모두.
#
# Usage: ./audit-all.sh [api-dir]
#   api-dir 미지정 시 = cwd. 일반적으로 apps/api/ 안에서 실행.
#
# 25 audit:
#   기존 12 — provider-retry / sse-lifecycle / single-writer / token-budget /
#            tool-sort-order / input-safety / mcp-namespace / compaction-thresholds /
#            http-error-sentinels / run-policy-presets / spawn-limits /
#            app-domain-boundary
#   기존 9 (Task 9e.1–9e.9 — post-eject) — agent-verify-def / api-audit / data-audit /
#            full-architecture / loop / session / security-audit-check /
#            rule-linting / dependency-scanning
#   신규 4 (invariant audit chain 메우기) — media-job-lifecycle / rate-limit-policy /
#            structured-log-schema / cors-policy
#
# Section numbering note:
#   섹션 번호 #1~#27 중 `#13` / `#18` 은 *의도적 누락* (pre-existing — 초기 audit 설계에서 빈
#   번호 두어 향후 신규 audit 추가 시 자리 비움). 단조 증가 순서 자체는 유지 (1~12 → 14~17 →
#   19~27). 새 audit 추가 시 #13 또는 #18 자리부터 채우면 번호 누락 해소.

set -uo pipefail

# Strict 정책 — 두 차원 분리:
#   --require-mount / REQUIRE_MOUNT=1
#     API_DIR/src 디렉토리 부재 시 fail (instance src 가 마운트 안 된 채 CI 가 통과하는 가짜 안전 차단)
#   --strict-audits / STRICT_AUDITS=1 (+ EXPECTED_AUDITS env)
#     EXPECTED_AUDITS 에 명시한 audit 중 하나라도 SKIP 이면 fail. 비어 있으면 no-op.
#     EXPECTED_AUDITS 미정의 시 모든 SKIP 허용 (optional subsystem 부재 = 정상).
#   --strict (deprecated alias)
#     두 flag 를 모두 활성화. 향후 제거 예정 — 새 코드는 두 flag 직접 사용 권장.
REQUIRE_MOUNT="${REQUIRE_MOUNT:-0}"
STRICT_AUDITS="${STRICT_AUDITS:-0}"
EXPECTED_AUDITS="${EXPECTED_AUDITS:-}"  # space-separated audit name list
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --require-mount) REQUIRE_MOUNT=1 ;;
    --strict-audits) STRICT_AUDITS=1 ;;
    --strict)
      # deprecated alias — 두 flag 모두 활성화 (호환성 유지)
      REQUIRE_MOUNT=1
      STRICT_AUDITS=1
      echo "WARN: --strict is deprecated alias. Use --require-mount and/or --strict-audits explicitly." >&2
      ;;
    *) ARGS+=("$arg") ;;
  esac
done
set -- "${ARGS[@]:-}"

# API_DIR 인자 또는 cwd. grep 경로는 API_DIR 기준 *상대*
API_DIR="${1:-$(pwd)}"
cd "$API_DIR" || { echo "error: API_DIR not found: $API_DIR" >&2; exit 2; }

# Framework-specific audit patterns — framework-neutral 의무 (default 없음).
#
# 본 plugin (backend-ts) 은 framework-neutral 이므로 framework / runtime 특화
# 패턴을 default 로 두지 않는다 (Codex round 6 review — Defect 3). instance 측은
# 다음 중 하나로 7개 env var 를 모두 주입해야 한다:
#
#   (1) Preset 파일 source:
#         source scripts/presets/hono-workers.env
#         bash scripts/audit-all.sh apps/api
#
#   (2) BACKEND_TS_PRESET env 자동 로드:
#         BACKEND_TS_PRESET=hono-workers bash scripts/audit-all.sh apps/api
#
#   (3) CI env block 에 직접 명시 (docs/ci-template.md 참조)
#
# Preset 추가: scripts/presets/<name>.env 작성 (기존 hono-workers.env 참고).

# Optional: BACKEND_TS_PRESET 자동 로드
if [ -n "${BACKEND_TS_PRESET:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  PRESET_FILE="$SCRIPT_DIR/presets/${BACKEND_TS_PRESET}.env"
  if [ -f "$PRESET_FILE" ]; then
    # shellcheck disable=SC1090
    source "$PRESET_FILE"
  else
    echo "error: BACKEND_TS_PRESET=$BACKEND_TS_PRESET but $PRESET_FILE not found" >&2
    exit 2
  fi
fi

# 7개 required env var 검증 — 누락 시 helpful message 와 함께 즉시 exit 1
REQUIRED_ENV_VARS=(
  REQUEST_BODY_PATTERN
  KV_BINDING_PATTERN
  ZOD_VALIDATOR_PATTERN
  ROUTE_MUTATION_PATTERN
  KV_STORE_PATTERN
  TTL_FIELD_PATTERN
  AUTH_MIDDLEWARE_NAME
)
MISSING_VARS=()
for var in "${REQUIRED_ENV_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING_VARS+=("$var")
  fi
done
if [ "${#MISSING_VARS[@]}" -gt 0 ]; then
  cat >&2 <<EOF
error: required framework-specific env vars missing:
  ${MISSING_VARS[*]}

본 plugin (backend-ts) 은 framework-neutral 이므로 framework / runtime 특화
패턴을 default 로 두지 않는다. 다음 중 하나로 주입:

  (1) Preset 파일 source (Hono + Workers instance):
        source scripts/presets/hono-workers.env
        bash scripts/audit-all.sh "$@"

  (2) BACKEND_TS_PRESET 자동 로드:
        BACKEND_TS_PRESET=hono-workers bash scripts/audit-all.sh "$@"

  (3) CI env block 에 직접 명시 (docs/ci-template.md 참조).

Preset 추가: scripts/presets/<name>.env 작성 (기존 hono-workers.env 참고).
EOF
  exit 1
fi

VIOLATIONS=0
SKIP_COUNT=0
declare -a EXPECTED_SKIPPED=()

# audit 이름이 EXPECTED_AUDITS 목록에 포함되어 있으면 EXPECTED_SKIPPED 에 기록
record_skip() {
  local name="$1"
  SKIP_COUNT=$((SKIP_COUNT + 1))
  if [ -n "$EXPECTED_AUDITS" ]; then
    for expected in $EXPECTED_AUDITS; do
      if [ "$expected" = "$name" ]; then
        EXPECTED_SKIPPED+=("$name")
        return
      fi
    done
  fi
}

run_audit() {
  local name="$1"
  local pattern="$2"
  local dir="$3"
  if [[ ! -d "$dir" ]]; then
    echo "SKIP [$name]: $dir 디렉토리 없음 (apps/api/src 아직 비어 있을 수 있음)"
    record_skip "$name"
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

# ─────────────────────────── 기존 12 audit ───────────────────────────

# 1. provider-retry-audit
run_audit "provider-retry" 'retry.*\b(401|403|404|422)\b|\b(401|403|404|422)\b.*retry' src/ai/providers/

# 2. sse-lifecycle-audit (setInterval — serverless/edge runtime 비호환)
run_audit "sse-lifecycle-setInterval" 'setInterval\(' src/sse/

# 3. single-writer-audit — file-level
single_writer_check() {
  [[ ! -d src ]] && { echo "SKIP [single-writer]: src/ 없음"; record_skip "single-writer"; return; }
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
  [[ ! -d src/routes ]] && { echo "SKIP [input-safety]: src/routes/ 없음"; record_skip "input-safety"; return; }
  local missing
  missing=$(grep -rEn "await\s+${REQUEST_BODY_PATTERN}\(\)" src/routes/ -A 5 2>/dev/null | grep -B 5 -v 'parse\|safeParse\|z\.' | grep -cE "${REQUEST_BODY_PATTERN}" || true)
  if [[ $missing -gt 0 ]]; then
    echo "VIOLATION [input-safety]: $missing 곳 request body accessor 다음 5줄 안 zod parse 없음 (REQUEST_BODY_PATTERN=$REQUEST_BODY_PATTERN)"
    VIOLATIONS=$((VIOLATIONS + missing))
  else
    echo "PASS [input-safety]"
  fi
}
input_safety_check

# 7. mcp-namespace-audit (prefix 중복)
mcp_namespace_check() {
  [[ ! -d src/mcp ]] && { echo "SKIP [mcp-namespace]: src/mcp/ 없음"; record_skip "mcp-namespace"; return; }
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
  [[ ! -d src/ai/sub-agents ]] && { echo "SKIP [spawn-limits]: src/ai/sub-agents/ 없음"; record_skip "spawn-limits"; return; }
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
  # 스캔 디렉토리 = [[backend-overview]] §"디렉토리 구조" 정본 + §"Sub-area 변형" 화이트리스트
  for dir in src/routes src/ai src/sse src/storage src/middleware src/providers src/db src/engine src/tools src/context src/mcp src/utils src/agents src/runs src/types; do
    [[ -d "$dir" ]] && run_audit "app-domain-boundary-$dir" "\\b(${DOMAIN_VOCAB})\\b" "$dir"
  done
else
  echo "SKIP [app-domain-boundary]: DOMAIN_VOCAB envvar 미정의 — instance 측에서 export 필요"
  record_skip "app-domain-boundary"
fi

# ─────────────────────────── 신규 9 audit (Task 9e.1–9e.9 — post-eject) ───────────────────────────

# 14. agent-verify-def — ai-agent-patterns AgentDefinitionSchema 정합성 (YAML)
#
# 정본: [[ai-agent-patterns]] §"AgentDefinition 스키마". backend-ts 의 agent 정의는
# YAML + markdown prompt 분리이므로 *.yaml 스캔. 필수 필드 (name / systemPromptFile)
# + name regex (^[a-z0-9_]{1,64}$) + name == 파일 stem + name 중복 검증.
#
# SKILL.md (plugins/backend-ts/skills/agent-verify-def/SKILL.md) §실행 과 패턴 sync 의무.
agent_verify_def_check() {
  [[ ! -d src/agents ]] && { echo "SKIP [agent-verify-def]: src/agents/ 없음"; record_skip "agent-verify-def"; return; }
  local count=0
  # nullglob: empty glob 시 literal pattern 회피. 호출자 nullglob 상태 보존 (v3.1 Codex LOW#1).
  local nullglob_state
  nullglob_state=$(shopt -p nullglob)
  shopt -s nullglob
  # NOTE (v3.1 Codex LOW#2): 본 grep 은 *top-level unindented* `name:` 만 처리.
  # tab/space 들여쓰기, `# name:` 주석, multi-doc YAML (`---` 구분) 의 nested name 은 검출 ✕.
  # 정확한 YAML parse 가 필요하면 별도 yamllint / yq 의무 — 본 grep 은 fast-fail 만 보장.
  for f in src/agents/*.yaml; do
    # 필수 필드
    for field in name systemPromptFile; do
      grep -q "^${field}:" "$f" || { echo "VIOLATION [agent-verify-def]: $f missing $field"; count=$((count+1)); }
    done
    # name 추출 — 한 번만 (정규식 + stem 비교에 재사용)
    local name
    name=$(grep -hE "^name:" "$f" | head -1 \
      | sed -E "s/^name:[[:space:]]*['\"]?([^'\"[:space:]]+)['\"]?.*/\1/")
    if [[ -n "$name" ]]; then
      # name regex 검증
      if ! [[ "$name" =~ ^[a-z0-9_]{1,64}$ ]]; then
        echo "VIOLATION [agent-verify-def]: $f name '$name' violates regex ^[a-z0-9_]{1,64}\$"
        count=$((count+1))
      fi
      # name == 파일 stem 일치
      local stem
      stem=$(basename "$f" .yaml)
      if [[ "$stem" != "$name" ]]; then
        echo "VIOLATION [agent-verify-def]: $f name '$name' != file stem '$stem'"
        count=$((count+1))
      fi
    fi
  done
  # nullglob 상태 복원 (호출자의 shopt 보존)
  eval "$nullglob_state"
  # name 중복
  local dups
  dups=$(grep -hE "^name:" src/agents/*.yaml 2>/dev/null \
    | sed -E "s/^name:[[:space:]]*['\"]?([^'\"[:space:]]+)['\"]?.*/\1/" \
    | sort | uniq -d | wc -l | tr -d ' ')
  if [[ $dups -gt 0 ]]; then
    echo "VIOLATION [agent-verify-def]: $dups 개 name 중복"
    count=$((count+dups))
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [agent-verify-def]"
}
agent_verify_def_check

# 15. api-audit — POST/PUT/PATCH 안 schema validator 누락 + protected path auth 누락
#     (ZOD_VALIDATOR_PATTERN / ROUTE_MUTATION_PATTERN env 주입 필수 — default 없음)
# BSD awk 호환: `\s` → `[[:space:]]`
api_audit_check() {
  [[ ! -d src/routes ]] && { echo "SKIP [api-audit]: src/routes/ 없음"; record_skip "api-audit"; return; }
  local count=0
  for f in $(find src/routes -type f -name '*.ts' 2>/dev/null); do
    awk -v mutation_re="$ROUTE_MUTATION_PATTERN" -v validator_re="$ZOD_VALIDATOR_PATTERN" '
         $0 ~ mutation_re {flag=1; start=NR}
         flag && $0 ~ validator_re {flag=0}
         flag && /\)[[:space:]]*$/{print FILENAME":"start": missing schema validator (ZOD_VALIDATOR_PATTERN="validator_re")"; flag=0; count++}
         END {exit count>0?1:0}' "$f" 2>/dev/null
    [[ $? -ne 0 ]] && count=$((count+1))
  done
  # protected auth
  if [[ -d src/routes/protected ]]; then
    local no_auth
    no_auth=$(grep -L "$AUTH_MIDDLEWARE_NAME" src/routes/protected/*.ts 2>/dev/null | wc -l | tr -d ' ')
    if [[ $no_auth -gt 0 ]]; then
      echo "VIOLATION [api-audit]: $no_auth protected route(s) missing $AUTH_MIDDLEWARE_NAME (AUTH_MIDDLEWARE_NAME=$AUTH_MIDDLEWARE_NAME)"
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
  [[ ! -d src ]] && { echo "SKIP [full-architecture]: src/ 없음"; record_skip "full-architecture"; return; }
  local count=0
  local extra
  # 화이트리스트 — [[backend-overview]] §"디렉토리 구조" 정본과 동기. agents/runs/providers/db 는 sub-area 변형 (instance 별 선택).
  extra=$(ls src/ 2>/dev/null \
    | grep -vE "^(routes|ai|sse|tools|context|engine|mcp|middleware|storage|types|utils|agents|runs|providers|db|index\.ts)$" \
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
  [[ ! -d src ]] && { echo "SKIP [session-audit]: src/ 없음"; record_skip "session-audit"; return; }
  local count=0
  # TTL 누락 — pipe-subshell 회피 위해 출력 캡처 후 본 셸 loop
  local ttl_candidates
  ttl_candidates=$(rg -nP "\.put\(" src/ 2>/dev/null | grep -E "$KV_STORE_PATTERN" || true)
  if [[ -n "$ttl_candidates" ]]; then
    while IFS=: read -r file ln rest; do
      [[ -z "$file" ]] && continue
      awk -v ln="$ln" 'NR>=ln && NR<=ln+5 {print}' "$file" | grep -qE "$TTL_FIELD_PATTERN" && continue
      echo "VIOLATION [session-audit]: $file:$ln missing TTL field (KV_STORE_PATTERN=$KV_STORE_PATTERN TTL_FIELD_PATTERN=$TTL_FIELD_PATTERN)"
      count=$((count+1))
    done <<< "$ttl_candidates"
  fi
  # KV binding 직접 접근 우회 (default: c.env.KV*, override via KV_BINDING_PATTERN)
  local bypass
  bypass=$(rg -nP "${KV_BINDING_PATTERN}" src/ 2>/dev/null | grep -v "src/storage/" | wc -l | tr -d ' ')
  if [[ $bypass -gt 0 ]]; then
    echo "VIOLATION [session-audit]: $bypass storage adapter 우회 (KV_BINDING_PATTERN=$KV_BINDING_PATTERN)"
    count=$((count+bypass))
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [session-audit]"
}
session_audit_check

# 21. security-audit-check — secret / 동적평가 / 동적 require / SQL injection / SSRF (5 패턴)
#
# 본 함수의 5 패턴은 SKILL.md (plugins/backend-ts/skills/security-audit-check/SKILL.md)
# §실행 의 5 rg 명령과 *문자열 그대로 sync* 의무. 패턴 변경 시 양쪽 동시 갱신.
# (v3: SQL injection 패턴 추가 — body L36-37 mirror)
security_audit_check() {
  [[ ! -d src ]] && { echo "SKIP [security-audit-check]: src/ 없음"; record_skip "security-audit-check"; return; }
  local count=0
  local m
  # 1. secret 하드코딩
  m=$(rg -nP "(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]+)" src/ 2>/dev/null | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m hardcoded secret"; count=$((count+m)); }
  # 2. 동적 평가 (eval / new Function)
  m=$(rg -nP "\beval\(|new\s+Function\(" src/ 2>/dev/null | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m eval/new Function"; count=$((count+m)); }
  # 3. 동적 require
  m=$(rg -nP "require\([^'\"\\\`]+\)" src/ 2>/dev/null | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m 동적 require"; count=$((count+m)); }
  # 4a. SQL injection — sql tagged template 안 ${...} 보간 (sql.identifier / sql.placeholder 안전 케이스 제외)
  m=$(rg -nP 'sql\s*`[^`]*\$\{[^}]+\}' src/ 2>/dev/null \
    | grep -v "sql\.identifier\|sql\.placeholder" \
    | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m SQL injection 의심 (sql tagged template)"; count=$((count+m)); }
  # 4b. SQL injection — raw query method (query/execute/raw/executeRaw/$queryRawUnsafe) 의 backtick interpolation
  # v3.1 (Codex review HIGH#2): untagged raw query 미탐지 결함 — body L36-37 mirror 의무
  m=$(rg -nP '\.(query|execute|raw|executeRaw|\$queryRawUnsafe)\s*\(\s*`[^`]*\$\{' src/ 2>/dev/null \
    | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m SQL injection 의심 (raw query backtick interpolation)"; count=$((count+m)); }
  # 5. SSRF — 사용자 입력 URL fetch
  m=$(rg -nP "fetch\(\s*(req\.|body\.|${REQUEST_BODY_PATTERN})" src/ 2>/dev/null | wc -l | tr -d ' ')
  [[ $m -gt 0 ]] && { echo "VIOLATION [security-audit-check]: $m SSRF 의심"; count=$((count+m)); }
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [security-audit-check]"
}
security_audit_check

# 22. rule-linting — 본 plugin 자체 frontmatter (apps/api 가 아니라 plugin 검증 — manual 만 표시)
echo "MANUAL [rule-linting]: 본 plugin 의 skills/*/SKILL.md frontmatter 검증은 rule-linting/SKILL.md 의 ## 실행 직접 호출"

# 23. media-job-lifecycle-audit — terminal status 직접 set / handler 강제 kill
media_job_lifecycle_check() {
  [[ ! -d src/media ]] && [[ ! -d src/services/media ]] && { echo "SKIP [media-job-lifecycle]: src/media/ + src/services/media/ 없음"; record_skip "media-job-lifecycle"; return; }
  local count=0
  # terminal status 직접 set (transition 우회)
  local direct_set
  direct_set=$(grep -rEn "\.set\(\{[^}]*status:\s*['\"](succeeded|failed|canceled|dlq)" \
    src/media/ src/services/media/ 2>/dev/null \
    | grep -v "transitionJob\|markCompleted\|markFailed\|markDlq\|markCanceled" \
    | wc -l | tr -d ' ')
  if [[ $direct_set -gt 0 ]]; then
    echo "VIOLATION [media-job-lifecycle]: $direct_set terminal status direct set (use transitionJob)"
    count=$((count+direct_set))
  fi
  # handler 강제 kill
  local force_kill
  force_kill=$(grep -rEn "killWorkerHandler|forceKill|process\.kill" \
    src/media/ src/services/media/ 2>/dev/null | wc -l | tr -d ' ')
  if [[ $force_kill -gt 0 ]]; then
    echo "VIOLATION [media-job-lifecycle]: $force_kill handler 강제 kill (canceled = soft signal)"
    count=$((count+force_kill))
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [media-job-lifecycle]"
}
media_job_lifecycle_check

# 24. rate-limit-policy-audit — Retry-After 누락 / user-controllable bypass
rate_limit_policy_check() {
  [[ ! -d src ]] && { echo "SKIP [rate-limit-policy]: src/ 없음"; record_skip "rate-limit-policy"; return; }
  local count=0
  # user-controllable bypass header
  local bypass
  bypass=$(grep -rEn "X-Skip-Ratelimit|X-Bypass-Rate" src/ 2>/dev/null | wc -l | tr -d ' ')
  if [[ $bypass -gt 0 ]]; then
    echo "VIOLATION [rate-limit-policy]: $bypass user-controllable bypass header"
    count=$((count+bypass))
  fi
  # 429 응답인데 Retry-After 누락 (파일 단위)
  if [[ -d src/middleware ]] || [[ -d src/routes ]]; then
    local no_retry_after
    no_retry_after=0
    for f in $(grep -rlE "(status\(429\)|rate_limited)" src/middleware/ src/routes/ 2>/dev/null); do
      grep -qiE "retry.?after" "$f" || no_retry_after=$((no_retry_after+1))
    done
    if [[ $no_retry_after -gt 0 ]]; then
      echo "VIOLATION [rate-limit-policy]: $no_retry_after files emit 429 without Retry-After"
      count=$((count+no_retry_after))
    fi
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [rate-limit-policy]"
}
rate_limit_policy_check

# 25. structured-log-schema-audit — console.log 디버그 잔여 / level 대소문자 혼재
structured_log_schema_check() {
  [[ ! -d src ]] && { echo "SKIP [structured-log-schema]: src/ 없음"; record_skip "structured-log-schema"; return; }
  local count=0
  # console.log/error/warn 직접 사용 (JSON.stringify 또는 test 제외)
  local raw_console
  raw_console=$(grep -rEn "console\.(log|error|warn|info|debug)\(" src/ 2>/dev/null \
    | grep -v "test\|fixture\|JSON\.stringify" | wc -l | tr -d ' ')
  if [[ $raw_console -gt 0 ]]; then
    echo "VIOLATION [structured-log-schema]: $raw_console raw console.* (use structured logger)"
    count=$((count+raw_console))
  fi
  # level 자유 문자열 (대문자 / 카멜케이스)
  local bad_level
  bad_level=$(grep -rEn "level:\s*['\"]([A-Z][A-Z]*|[A-Z][a-z]+)['\"]" src/ 2>/dev/null | wc -l | tr -d ' ')
  if [[ $bad_level -gt 0 ]]; then
    echo "VIOLATION [structured-log-schema]: $bad_level invalid level case (must be lowercase 5-enum)"
    count=$((count+bad_level))
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [structured-log-schema]"
}
structured_log_schema_check

# 26. cors-policy-audit — wildcard origin + credentials 조합 / Allow-Methods *
cors_policy_check() {
  [[ ! -d src/middleware ]] && { echo "SKIP [cors-policy]: src/middleware/ 없음"; record_skip "cors-policy"; return; }
  local count=0
  # wildcard origin + credentials true 조합 (같은 파일)
  local bad_combo
  bad_combo=0
  for f in $(grep -rlE "cors|Cors" src/middleware/ src/index.ts 2>/dev/null); do
    [[ -f "$f" ]] || continue
    if grep -qE "credentials:\s*true" "$f" && grep -qE "origin:\s*['\"]?\*" "$f"; then
      echo "VIOLATION [cors-policy]: $f has credentials:true + origin:*"
      bad_combo=$((bad_combo+1))
    fi
  done
  count=$((count+bad_combo))
  # Allow-Methods wildcard
  local methods_star
  methods_star=$(grep -rEn "allowMethods:\s*['\"]?\*|Allow-Methods:\s*['\"]?\*" src/middleware/ 2>/dev/null | wc -l | tr -d ' ')
  if [[ $methods_star -gt 0 ]]; then
    echo "VIOLATION [cors-policy]: $methods_star wildcard Allow-Methods"
    count=$((count+methods_star))
  fi
  VIOLATIONS=$((VIOLATIONS + count))
  [[ $count -eq 0 ]] && echo "PASS [cors-policy]"
}
cors_policy_check

# 27. dependency-scanning — Node built-in import (node: prefix 없는)
dependency_scanning_check() {
  [[ ! -d src ]] && { echo "SKIP [dependency-scanning]: src/ 없음"; record_skip "dependency-scanning"; return; }
  local m
  m=$(rg -nP "from\s+['\"](?:fs|net|tls|child_process|cluster|dgram|dns|http|https|os|path|stream|tty|vm)['\"]" \
       src/ 2>/dev/null | grep -v "node:" | grep -v "// runtime-compat-ok" | wc -l | tr -d ' ')
  if [[ $m -gt 0 ]]; then
    echo "VIOLATION [dependency-scanning]: $m Node built-in import (node: prefix 누락)"
    VIOLATIONS=$((VIOLATIONS + m))
  else
    echo "PASS [dependency-scanning]"
  fi
}
dependency_scanning_check

# ─────────────────────────── 결론 ───────────────────────────
echo ""
echo "===================="
echo "Total violations: $VIOLATIONS"
echo "Total skips: $SKIP_COUNT"
echo "===================="

# Gate 1: REQUIRE_MOUNT — API_DIR/src 부재 시 fail
if [[ "$REQUIRE_MOUNT" = "1" && ! -d "$API_DIR/src" ]]; then
  echo "REQUIRE_MOUNT: $API_DIR/src not found (instance src 가 마운트되지 않음)" >&2
  exit 1
fi

# Gate 2: STRICT_AUDITS — EXPECTED_AUDITS 중 SKIP 된 것 있으면 fail
if [[ "$STRICT_AUDITS" = "1" && "${#EXPECTED_SKIPPED[@]}" -gt 0 ]]; then
  echo "STRICT_AUDITS: expected audits skipped: ${EXPECTED_SKIPPED[*]} (EXPECTED_AUDITS=$EXPECTED_AUDITS)" >&2
  exit 1
fi

# STRICT_AUDITS=1 인데 EXPECTED_AUDITS 비어있으면 informational warning (강제 audit 목록 미지정)
if [[ "$STRICT_AUDITS" = "1" && -z "$EXPECTED_AUDITS" ]]; then
  echo "WARN: STRICT_AUDITS=1 but EXPECTED_AUDITS is empty — no audits enforced." >&2
fi

# bash exit code 는 0~255 범위 — VIOLATIONS=256 일 때 wrap 되어 0 (silent pass) 방지
# CI gate 는 violation 개수가 아니라 violation 존재 여부 (0/non-zero) 만 본다
[ "$VIOLATIONS" -gt 0 ] && exit 1 || exit 0
