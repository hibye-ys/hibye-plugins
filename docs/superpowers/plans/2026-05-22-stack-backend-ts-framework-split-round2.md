# stack-backend-ts Framework Split (Round 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stack-backend-ts plugin 의 78 SKILL.md 를 framework/runtime/도메인 완전 중립으로 변환하고, AGENTS.md 를 가이드/index (200줄 이하) 로 축소하며, Codex 라운드 1 즉시 수정 5건 + 신규 6 invariant 심화 + 운영 템플릿을 모두 반영한다.

**Architecture:** 본문 텍스트는 `<framework>`, `<api-app>`, `<runtime>`, `<domain>`, `<DOMAIN_VOCAB>` placeholder 어휘로 일관 표기. AGENTS.md generator 는 inline → link-list 모드 전환. instance 측 CLAUDE.md 가 placeholder → 실제 값 매핑 담당. acceptance-check + forbidden-scan 이 framework 어휘 재유입을 차단.

**Tech Stack:** Bash (scripts), Markdown (SKILL.md), 검증은 plugin 자체 scripts/ + grep/awk.

**Round 1 (`2026-05-22-stack-backend-ts-generalization.md`) 후속.** Codex 리뷰가 발견한 5건 즉시 수정 + 영역별 우려 + 사용자 결정 (AGENTS.md = 가이드/index) 반영.

---

## 사전 사실

| 항목 | 값 |
|------|----|
| Total skills | 78 (18 invariant + 39 workflow + 21 audit) |
| framework 어휘 보유 (Hono/Workers/wrangler/c.env/Cloudflare/HTTPException/streamSSE) | 51 skills |
| `apps/api` 어휘 보유 | 48 skills |
| 깨진 cross-link 보유 (verify-workers-compat / workers-compat / pre-deploy-check / runtime-verify / d1-forbidden-audit / data-governance 참조) | 20 skills + 2 scripts |
| 현재 AGENTS.md | 1998 줄, 18 invariant 본문 inline |
| 목표 AGENTS.md | ≤200 줄, link-list only |
| Baseline 검증 | `acceptance-check.sh` 78/78 pass, `forbidden-scan.sh` 0 match |

---

## Placeholder 어휘 사양

본 plan 전체에서 일관 사용. instance 측 CLAUDE.md 에서 실제 값으로 매핑.

| Placeholder | 의미 | instance 예시 (iyaki-rebuild) |
|-------------|------|--------------------------------|
| `<framework>` | HTTP framework | Hono |
| `<framework env binding>` | request handler context object 의 env 접근 | `c.env` |
| `<framework HTTP error class>` | framework 의 HTTP 에러 throwable | `HTTPException` |
| `<framework SSE helper>` | SSE 응답 헬퍼 | `streamSSE` |
| `<runtime>` | JS 런타임 | Cloudflare Workers |
| `<api-app>` | API 어플리케이션 경로 | `apps/api` |
| `<domain>` | 비즈니스 도메인 명 | `iyaki` |
| `<DOMAIN_VOCAB>` | 도메인 어휘 집합 (forbidden-scan 환경변수) | `writer\|author\|scenario\|novel\|...` |

---

## File Structure

**새로 생성:**
- `plugins/stack-backend-ts/docs/placeholder-vocabulary.md` — placeholder 어휘 사양 (위 표) + instance 측 매핑 가이드
- `plugins/stack-backend-ts/docs/instance-claude-md-template.md` — instance 측 CLAUDE.md 작성 템플릿 (DOMAIN_VOCAB env 포함)
- `plugins/stack-backend-ts/scripts/check-framework-vocab.sh` — framework 어휘 재유입 차단 검증

**대규모 수정:**
- 51 skill SKILL.md 의 framework 어휘 → placeholder 치환
- 48 skill SKILL.md 의 `apps/api` → `<api-app>` 치환
- 22 파일의 깨진 cross-link 제거
- `plugins/stack-backend-ts/scripts/generate-agents-md.sh` — link-list 모드 + import-missing fatal
- `plugins/stack-backend-ts/CLAUDE.md` — invariant 본문 imports 제거, 가이드 형태로 재구성
- `plugins/stack-backend-ts/AGENTS.md` — generator 재실행으로 200줄 이하

**심화:**
- `plugins/stack-backend-ts/skills/rate-limit-policy/SKILL.md`
- `plugins/stack-backend-ts/skills/structured-log-schema/SKILL.md`
- `plugins/stack-backend-ts/skills/cors-policy/SKILL.md`
- `plugins/stack-backend-ts/skills/idempotency-key/SKILL.md`
- `plugins/stack-backend-ts/skills/secret-rotation/SKILL.md`
- `plugins/stack-backend-ts/skills/migration-rollback/SKILL.md`
- `plugins/stack-backend-ts/skills/dependency-scanning/SKILL.md`

**검증/스크립트:**
- `plugins/stack-backend-ts/scripts/acceptance-check.sh` — AGENTS.md drift 체크 갱신, framework vocab 체크 통합
- `plugins/stack-backend-ts/scripts/forbidden-scan.sh` — framework 어휘 패턴 등록

---

## Phase 0 — Baseline 고정

### Task 0.1: Baseline 확인 + 작업 브랜치 점검

**Files:**
- 변경 없음 (검증만)

- [ ] **Step 1: 현재 브랜치 + 작업 상태 확인**

Run:
```bash
cd /Users/youngseoklee/Desktop/workplace/hibye-plugins
git branch --show-current
git status --short
```

Expected:
```
feat/m2.5-stack-backend-ts-hono
(empty status)
```

- [ ] **Step 2: acceptance-check baseline**

Run:
```bash
cd plugins/stack-backend-ts
bash scripts/acceptance-check.sh 2>&1 | tail -5
```

Expected: `acceptance-check: 78 skills checked, 0 failures` (또는 동일 동등)

- [ ] **Step 3: forbidden-scan baseline**

Run:
```bash
bash scripts/forbidden-scan.sh 2>&1 | tail -3
```

Expected: `✓ forbidden-scan: 0 matches`

- [ ] **Step 4: AGENTS.md baseline 줄 수 기록**

Run:
```bash
wc -l AGENTS.md
```

Expected: `1998 AGENTS.md` (정확치 변동 OK, 1500+ 면 baseline)

- [ ] **Step 5: framework 어휘 보유 skill 카운트 기록**

Run:
```bash
grep -rEl '\b(Hono|Workers|wrangler|c\.env|c\.json|c\.req|c\.set|Cloudflare|streamSSE|HTTPException|app\.use|app\.get|app\.post)\b' skills/ | wc -l
```

Expected: `51`

---

## Phase 1 — AGENTS.md 가이드/index 모드 전환

### Task 1.1: Generator 를 link-list 모드로 재작성

**Files:**
- Modify: `plugins/stack-backend-ts/scripts/generate-agents-md.sh` (전면 재작성)

- [ ] **Step 1: 새 generator 작성**

Replace `plugins/stack-backend-ts/scripts/generate-agents-md.sh` 전체를 다음으로:

```bash
#!/usr/bin/env bash
# generate-agents-md.sh — Codex 용 AGENTS.md 가이드/index 생성
# SoT = CLAUDE.md. invariant/workflow/audit 카탈로그 변경 시 CLAUDE.md 만 갱신.
#
# 출력 형식:
#   - plugin 헤더 + 사용법 안내
#   - CLAUDE.md @import 줄을 path 만 추출, 카테고리 별 link 표
#   - 본문 inline 없음 (Codex CLI 는 .agents/skills/ 직접 스캔)
#
# Usage:
#   generate-agents-md.sh           # AGENTS.md in-place 갱신
#   generate-agents-md.sh --check   # stdout 출력 (CI drift 검증용)
set -euo pipefail

MODE="write"
[ "${1:-}" = "--check" ] && MODE="check"

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_MD="$PLUGIN_DIR/CLAUDE.md"
OUT="$PLUGIN_DIR/AGENTS.md"
PLUGIN_NAME="$(basename "$PLUGIN_DIR")"

[ -f "$CLAUDE_MD" ] || { echo "error: $CLAUDE_MD not found" >&2; exit 2; }

# 각 SKILL.md frontmatter 에서 description 추출
extract_desc() {
  local abs="$1"
  awk '
    BEGIN { in_fm = 0; found = 0 }
    NR == 1 && /^---[[:space:]]*$/ { in_fm = 1; next }
    in_fm && /^---[[:space:]]*$/ { exit }
    in_fm && /^description:[[:space:]]/ {
      sub(/^description:[[:space:]]*/, "")
      print
      found = 1
      exit
    }
    END { if (!found) print "(no description)" }
  ' "$abs"
}

# CLAUDE.md 에서 @import 줄만 추출 → path 리스트
collect_imports() {
  grep -E '^@\.?/' "$CLAUDE_MD" | sed -E 's|^@\.?/||' || true
}

declare -a SEEN=()
DUP_FOUND=0
MISSING_FOUND=0

render_link_table() {
  local heading="$1"
  shift
  local imports=("$@")
  [ ${#imports[@]} -eq 0 ] && return

  echo ""
  echo "## $heading"
  echo ""
  echo "| Skill | Description |"
  echo "|-------|-------------|"
  for rel in "${imports[@]}"; do
    local abs="$PLUGIN_DIR/$rel"
    if [ ! -f "$abs" ]; then
      echo "| ~~\`$rel\`~~ | **ERROR: import not found** |"
      echo "error: import not found: $rel" >&2
      MISSING_FOUND=1
      continue
    fi
    local skill_dir
    skill_dir="$(dirname "$rel" | sed 's|^skills/||')"
    local desc
    desc="$(extract_desc "$abs")"
    echo "| [\`$skill_dir\`]($rel) | $desc |"
  done
}

render() {
  echo "# $PLUGIN_NAME — Codex AGENTS.md (가이드/index)"
  echo ""
  echo "> Generated by scripts/generate-agents-md.sh from CLAUDE.md @import directives."
  echo "> Do NOT edit manually — changes will be overwritten on next regenerate."
  echo ""
  echo "## 본 plugin 사용 방법"
  echo ""
  echo "1. **본문 적용 규율**: 아래 카탈로그의 각 skill SKILL.md 를 작업 직전에 직접 읽고 적용한다."
  echo "2. **Placeholder 매핑**: 본 plugin 의 SKILL.md 본문은 \`<framework>\`, \`<api-app>\`, \`<runtime>\`, \`<domain>\`, \`<DOMAIN_VOCAB>\` 등 placeholder 로 작성됨. instance 측 CLAUDE.md 의 매핑 표를 참조해 해석한다 (\`docs/instance-claude-md-template.md\` 참고)."
  echo "3. **검증**: \`scripts/acceptance-check.sh\` + \`scripts/forbidden-scan.sh\` + \`scripts/audit-all.sh\` 가 모든 invariant / 어휘 / 도메인 누수를 차단."

  # CLAUDE.md @import 줄 수집 + 카테고리 분류 (path 기반은 불가하므로 CLAUDE.md 의 카테고리 헤더 구조 활용)
  local current_section="기타"
  declare -A SECTION_IMPORTS

  while IFS= read -r line; do
    if [[ "$line" =~ ^##[[:space:]]+(.*)$ ]]; then
      current_section="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^@\.?/(.*)$ ]]; then
      local rel="${BASH_REMATCH[1]}"
      # 중복 detect
      local already=0
      for s in "${SEEN[@]}"; do
        if [ "$s" = "$rel" ]; then already=1; break; fi
      done
      if [ $already -eq 1 ]; then
        echo "warn: duplicate import: $rel" >&2
        DUP_FOUND=1
        continue
      fi
      SEEN+=("$rel")
      SECTION_IMPORTS["$current_section"]+="$rel"$'\n'
    fi
  done < "$CLAUDE_MD"

  for section in "${!SECTION_IMPORTS[@]}"; do
    local arr=()
    while IFS= read -r p; do
      [ -n "$p" ] && arr+=("$p")
    done <<< "${SECTION_IMPORTS[$section]}"
    render_link_table "$section" "${arr[@]}"
  done

  echo ""
  echo "## 검증 명령 요약"
  echo ""
  echo "- \`bash scripts/acceptance-check.sh\` — 78 skill frontmatter / scope / link 검증"
  echo "- \`bash scripts/forbidden-scan.sh\` — 도메인 / framework 어휘 누수 검출"
  echo "- \`bash scripts/audit-all.sh\` — 21 audit skill 일괄 실행"
}

if [ "$MODE" = "check" ]; then
  render
else
  render > "$OUT"
  echo "Generated: $OUT ($(wc -l < "$OUT" | tr -d ' ') lines, ${#SEEN[@]} imports)" >&2
fi

if [ $MISSING_FOUND -ne 0 ]; then
  echo "FAIL: missing imports detected" >&2
  exit 1
fi
if [ $DUP_FOUND -ne 0 ]; then
  echo "FAIL: duplicate imports detected" >&2
  exit 1
fi
```

- [ ] **Step 2: 실행 권한 확인**

Run:
```bash
chmod +x scripts/generate-agents-md.sh
ls -l scripts/generate-agents-md.sh
```

Expected: `-rwxr-xr-x ...`

- [ ] **Step 3: Commit (generator 전환)**

```bash
cd /Users/youngseoklee/Desktop/workplace/hibye-plugins
git add plugins/stack-backend-ts/scripts/generate-agents-md.sh
git commit -m "refactor(stack-backend-ts): generate-agents-md.sh를 link-list 모드로 재작성

- 본문 inline 제거 → 카테고리별 link 표만 생성
- import-missing 시 fatal 처리 (silent skip 금지)
- duplicate detect 유지
- Codex CLI 는 .agents/skills/ 직접 스캔하므로 inline 불필요"
```

### Task 1.2: CLAUDE.md 를 카테고리 구조로 정비

**Files:**
- Modify: `plugins/stack-backend-ts/CLAUDE.md`

- [ ] **Step 1: 현재 CLAUDE.md 읽기**

Run: `cat plugins/stack-backend-ts/CLAUDE.md`

기대: 18 invariant @import + workflow/audit 카탈로그 link.

- [ ] **Step 2: CLAUDE.md 를 카테고리 헤더 + @import 형식으로 재작성**

`plugins/stack-backend-ts/CLAUDE.md` 전체를 다음으로 교체:

```markdown
# stack-backend-ts

TypeScript backend (AI agent + 일반 백엔드) 룰. Framework / runtime / domain 무관 — Hono / Express / Fastify / Node / Bun / Workers 등 어디서든 사용. 도메인 결합은 `<domain>` placeholder, framework 결합은 `<framework>` placeholder 로 표기. instance 측 CLAUDE.md 에서 매핑.

본 catalog 의 모든 skill SKILL.md 는 plugin install 시 fresh 세션에 노출. Codex CLI 는 `.agents/skills/` 디렉토리를 직접 스캔.

## Placeholder 어휘

자세한 어휘 사양: `docs/placeholder-vocabulary.md`
Instance CLAUDE.md 작성 템플릿: `docs/instance-claude-md-template.md`

## 상시 적용 invariant 18개

@./skills/single-writer/SKILL.md
@./skills/provider-retry-matrix/SKILL.md
@./skills/token-budget-constants/SKILL.md
@./skills/sse-lifecycle/SKILL.md
@./skills/compaction-thresholds/SKILL.md
@./skills/http-error-sentinels/SKILL.md
@./skills/input-safety-gate-ordering/SKILL.md
@./skills/mcp-namespace/SKILL.md
@./skills/run-policy-presets/SKILL.md
@./skills/spawn-limits/SKILL.md
@./skills/tool-sort-order/SKILL.md
@./skills/agent-loop-invariants/SKILL.md
@./skills/architecture-invariants/SKILL.md
@./skills/app-domain-boundary/SKILL.md
@./skills/media-job-lifecycle/SKILL.md
@./skills/rate-limit-policy/SKILL.md
@./skills/structured-log-schema/SKILL.md
@./skills/cors-policy/SKILL.md

## On-demand workflow skills 39개

@./skills/backend-overview/SKILL.md
@./skills/agent-loop/SKILL.md
@./skills/tool-system/SKILL.md
@./skills/provider-layer/SKILL.md
@./skills/context-assembly/SKILL.md
@./skills/sse-streaming/SKILL.md
@./skills/data-layer/SKILL.md
@./skills/compaction/SKILL.md
@./skills/sub-agent/SKILL.md
@./skills/lsp-server/SKILL.md
@./skills/mcp-integration/SKILL.md
@./skills/api-routing/SKILL.md
@./skills/auth/SKILL.md
@./skills/database/SKILL.md
@./skills/error-handling/SKILL.md
@./skills/media-pipeline-patterns/SKILL.md
@./skills/ai-agent-patterns/SKILL.md
@./skills/usage-tracking/SKILL.md
@./skills/security-runtime/SKILL.md
@./skills/dependency-scanning/SKILL.md
@./skills/incident-triage/SKILL.md
@./skills/performance-profiling/SKILL.md
@./skills/debug-session/SKILL.md
@./skills/testing-infra/SKILL.md
@./skills/test-scaffold/SKILL.md
@./skills/test-cleanup/SKILL.md
@./skills/red-green-fix/SKILL.md
@./skills/new-agent/SKILL.md
@./skills/new-run/SKILL.md
@./skills/provider-scaffold/SKILL.md
@./skills/provider-catalog-sync/SKILL.md
@./skills/agent-verify-def/SKILL.md
@./skills/coding-standards/SKILL.md
@./skills/design-principles/SKILL.md
@./skills/ts-agent-rules/SKILL.md
@./skills/commit-rules/SKILL.md
@./skills/codex-commands/SKILL.md
@./skills/codex-subagents/SKILL.md
@./skills/rule-linting/SKILL.md
@./skills/idempotency-key/SKILL.md
@./skills/secret-rotation/SKILL.md
@./skills/migration-rollback/SKILL.md

## Audit skills 21개

@./skills/single-writer-audit/SKILL.md
@./skills/provider-retry-audit/SKILL.md
@./skills/token-budget-audit/SKILL.md
@./skills/sse-lifecycle-audit/SKILL.md
@./skills/compaction-thresholds-audit/SKILL.md
@./skills/http-error-sentinels-audit/SKILL.md
@./skills/input-safety-audit/SKILL.md
@./skills/mcp-namespace-audit/SKILL.md
@./skills/run-policy-presets-audit/SKILL.md
@./skills/spawn-limits-audit/SKILL.md
@./skills/tool-sort-order-audit/SKILL.md
@./skills/app-domain-boundary-audit/SKILL.md
@./skills/api-audit/SKILL.md
@./skills/data-audit/SKILL.md
@./skills/loop-audit/SKILL.md
@./skills/session-audit/SKILL.md
@./skills/security-audit-check/SKILL.md
@./skills/full-architecture-audit/SKILL.md
```

> **주의**: 위 목록은 41 workflow + 21 audit 가 아닌 39 workflow + 21 audit 로 가야 함. 위 workflow 섹션은 41개 — `idempotency-key` / `secret-rotation` / `migration-rollback` 은 신규 6 invariant 가 아니라 신규 6 *workflow* 였음 (rate/structured-log/cors 만 invariant). Step 3 에서 정정.

- [ ] **Step 3: workflow 목록에서 idempotency-key/secret-rotation/migration-rollback 제거하지 말 것**

확인: `idempotency-key`, `secret-rotation`, `migration-rollback` 은 본 plan 정책상 workflow (39개) 에 포함. 위 markdown 의 workflow 목록 41개 카운트 검증:

```bash
grep -c '^@\./skills/' plugins/stack-backend-ts/CLAUDE.md
```

Expected: `18 + 41 + 18 = 77` (≠ 78). audit 가 21개여야 함 — Step 2 의 audit 섹션이 18개만 적혀 있음. 누락된 3개 audit 추가:

audit 섹션 끝에 다음 추가:
```markdown
@./skills/architecture-invariants/SKILL.md
@./skills/agent-loop-invariants/SKILL.md
@./skills/http-error-sentinels-audit/SKILL.md
```

> **재검증**: invariant 섹션에 이미 `architecture-invariants` 와 `agent-loop-invariants` 가 있음. 이들은 invariant 분류이지 audit 아님. 따라서 audit 카운트는 별도로 정확히 21개 매핑해야 함.

- [ ] **Step 4: 실제 78 skill 명단으로부터 정확한 카테고리 분리표 생성**

Run:
```bash
cd plugins/stack-backend-ts
for d in skills/*/; do
  name="$(basename "$d")"
  role="$(awk '/^role:/ {print $2; exit} /^metadata:/ {in_meta=1; next} in_meta && /^  role:/ {print $2; exit}' "$d/SKILL.md" 2>/dev/null)"
  echo "$role | $name"
done | sort | uniq -c | sort -k2,2
```

Expected:
- `invariant` × 18
- `workflow` × 39
- `audit` × 21

(만약 카운트가 다르면 정확한 분류 결정 후 CLAUDE.md 재구성. 본 task 의 진짜 목표 = CLAUDE.md @import 가 정확히 78 줄이고 각 줄이 role 별 섹션 안에 위치)

- [ ] **Step 5: CLAUDE.md 최종 검증**

Run:
```bash
grep -c '^@\./skills/' CLAUDE.md
```

Expected: `78`

- [ ] **Step 6: Commit (CLAUDE.md 재구성)**

```bash
git add plugins/stack-backend-ts/CLAUDE.md
git commit -m "refactor(stack-backend-ts): CLAUDE.md를 카테고리 헤더+@import 형식으로 정비

- 'Placeholder 어휘' 안내 추가
- '상시 적용 invariant 18개', 'On-demand workflow skills 39개', 'Audit skills 21개' 카테고리 헤더 명시
- generator 의 카테고리 자동 분류 기준이 됨"
```

### Task 1.3: Placeholder 어휘 사양 문서 작성

**Files:**
- Create: `plugins/stack-backend-ts/docs/placeholder-vocabulary.md`

- [ ] **Step 1: docs/ 디렉토리 생성**

Run: `mkdir -p plugins/stack-backend-ts/docs`

- [ ] **Step 2: 어휘 사양 문서 작성**

`plugins/stack-backend-ts/docs/placeholder-vocabulary.md`:

```markdown
# Placeholder 어휘 사양

본 plugin 의 모든 SKILL.md 본문은 framework / runtime / 도메인 중립이다. 아래 placeholder 어휘를 사용하며, instance 측 CLAUDE.md 가 실제 값으로 매핑한다.

## 기본 placeholder

| Placeholder | 의미 | 사용 예시 |
|-------------|------|-----------|
| `<framework>` | HTTP framework 명 (general) | "`<framework>` 미들웨어 등록 시 …" |
| `<framework env binding>` | request handler context 의 환경 변수 접근 | "`<framework env binding>` 으로 secret 읽기" |
| `<framework HTTP error class>` | framework 의 HTTP 에러 throwable 클래스 | "`throw new <framework HTTP error class>(401, ...)`" |
| `<framework SSE helper>` | SSE 응답 헬퍼 함수 | "`<framework SSE helper>(c, async (stream) => { ... })`" |
| `<framework json response>` | JSON 응답 헬퍼 | "`return <framework json response>({ ok: true })`" |
| `<framework route definition>` | 라우트 정의 호출 | "`<framework route definition>('/health', handler)`" |
| `<framework middleware registration>` | 미들웨어 등록 호출 | "`<framework middleware registration>('*', authMw)`" |
| `<runtime>` | JS 런타임 (Node / Bun / Workers / Deno) | "`<runtime>` 의 fetch API …" |
| `<runtime env binding>` | runtime 의 env 변수 접근 패턴 | `process.env`, `c.env`, `Deno.env` 등 instance 별 |
| `<api-app>` | API 어플리케이션 모듈 경로 | "`<api-app>/src/routes/...`" |
| `<domain>` | 비즈니스 도메인 명 (소문자) | "`<domain>` 데이터베이스 …" |
| `<DOMAIN>` | 도메인 명 (대문자) | "`<DOMAIN>` 환경변수 prefix" |
| `<domain entity>` | 도메인 엔티티 명 (e.g. user, post, order) | "`<domain entity>` 테이블 …" |
| `<DOMAIN_VOCAB>` | forbidden-scan 환경변수 — \| 구분 도메인 어휘 집합 | `writer\|author\|scenario\|...` |

## 사용 규칙

1. **본문은 placeholder 만 사용**: Hono, Workers, wrangler, apps/api, c.env 등 framework/runtime/경로 구체 명사 금지
2. **instance 측 CLAUDE.md 가 매핑 표 제공**: `<framework>` → `Hono`, `<runtime>` → `Cloudflare Workers` 등
3. **예시 코드는 추상 의사코드**: 실제 framework API 호출이 필요하면 placeholder 함수명 사용
4. **forbidden-scan 이 위반 차단**: `scripts/forbidden-scan.sh` 가 모든 SKILL.md 에 framework/runtime 어휘 등장 시 fail
5. **acceptance-check 가 alignment 검증**: scope = `project`, frontmatter 검증

## 비 placeholder (그대로 사용 가능)

다음 어휘는 framework/runtime 무관 표준이므로 placeholder 화하지 않음:

- HTTP 표준 (GET, POST, 200, 401, 429, SSE, headers 명)
- 일반 디자인 패턴 (middleware, router, handler, schema, retry, circuit breaker)
- JS/TS 언어 (async, await, Promise, Buffer, ReadableStream)
- 표준 라이브러리 (fetch API, AbortController, console)
- 일반 도구 (pnpm, npm, vitest, eslint, prettier, tsc)
- 일반 클라우드 추상 (Postgres, Redis, S3-compatible)

## Forbidden 어휘 (재유입 차단 대상)

| 어휘 | 대체 |
|------|------|
| `Hono` / `hono` | `<framework>` |
| `Workers` / `workers runtime` / `Cloudflare Workers` | `<runtime>` |
| `wrangler` / `wrangler.toml` | 제거 또는 `<runtime config>` |
| `c.env` / `c.req` / `c.json` / `c.set` | `<framework env binding>` 등 |
| `streamSSE` | `<framework SSE helper>` |
| `HTTPException` | `<framework HTTP error class>` |
| `app.use` / `app.get` / `app.post` / `app.all` | `<framework middleware registration>` / `<framework route definition>` |
| `Cloudflare` | 제거 또는 `<runtime>` |
| `apps/api` | `<api-app>` |
| `c.executionCtx` | 제거 (runtime-specific) |
```

- [ ] **Step 3: Commit**

```bash
git add plugins/stack-backend-ts/docs/placeholder-vocabulary.md
git commit -m "docs(stack-backend-ts): placeholder 어휘 사양 + forbidden 어휘 대응표 추가"
```

### Task 1.4: Instance 측 CLAUDE.md 작성 템플릿

**Files:**
- Create: `plugins/stack-backend-ts/docs/instance-claude-md-template.md`

- [ ] **Step 1: 템플릿 문서 작성**

`plugins/stack-backend-ts/docs/instance-claude-md-template.md`:

```markdown
# Instance CLAUDE.md 작성 템플릿

stack-backend-ts plugin 사용 instance (예: iyaki-rebuild) 측 프로젝트 root 의 `CLAUDE.md` 작성 가이드.

## 최소 구조

```markdown
@AGENTS.md

## stack-backend-ts plugin placeholder 매핑

| Placeholder | 이 프로젝트의 값 |
|-------------|------------------|
| `<framework>` | Hono |
| `<framework env binding>` | `c.env` |
| `<framework HTTP error class>` | `HTTPException` |
| `<framework SSE helper>` | `streamSSE` |
| `<runtime>` | Cloudflare Workers |
| `<api-app>` | `apps/api` |
| `<domain>` | `iyaki` |
| `<DOMAIN>` | `IYAKI` |
| `<DOMAIN_VOCAB>` | `writer\|author\|scenario\|novel\|character\|persona` |

## DOMAIN_VOCAB 환경변수

`scripts/audit-all.sh` 의 `app-domain-boundary` audit 가 사용:

```bash
export DOMAIN_VOCAB="writer|author|scenario|novel|character|persona"
bash plugins/stack-backend-ts/scripts/audit-all.sh
```

CI 에서는 `.github/workflows/audit.yml` 의 env 섹션에 등록:

```yaml
env:
  DOMAIN_VOCAB: "writer|author|scenario|novel|character|persona"
```

## Project-local skills

이 프로젝트만의 framework/runtime/domain-bound skill 은 `.claude/skills/` 에 둠. plugin SKILL.md 본문에서 `[[verify-workers-compat]]` 같은 project-local 참조가 등장하면, project 측 `.claude/skills/verify-workers-compat/SKILL.md` 가 응답해야 함.

예시 project-local skills (iyaki-rebuild):
- `workers-compat/` — Cloudflare Workers 호환성 가드
- `verify-workers-compat/` — Workers API 비호환 사용 검증
- `pre-deploy-check/` — wrangler deploy 전 체크리스트
- `runtime-verify/` — 실제 Workers 환경 health check
- `d1-forbidden-audit/` — D1 스키마 forbidden 패턴
- `data-governance/` — 도메인 데이터 거버넌스 (CCv3, SillyTavern 등 구체)
- `update-config-runtime/` — runtime-specific config 동기화
- `infra-audit/` — infrastructure 감사
```

- [ ] **Step 2: Commit**

```bash
git add plugins/stack-backend-ts/docs/instance-claude-md-template.md
git commit -m "docs(stack-backend-ts): instance 측 CLAUDE.md 작성 템플릿 추가"
```

### Task 1.5: AGENTS.md 재생성 + drift 검증 갱신

**Files:**
- Modify (regenerate): `plugins/stack-backend-ts/AGENTS.md`
- Modify: `plugins/stack-backend-ts/scripts/acceptance-check.sh`

- [ ] **Step 1: AGENTS.md 재생성**

Run:
```bash
cd plugins/stack-backend-ts
bash scripts/generate-agents-md.sh
wc -l AGENTS.md
```

Expected: `≤200 AGENTS.md` (link-list only)

- [ ] **Step 2: AGENTS.md 첫 30줄 확인 (가이드 헤더 검증)**

Run: `head -30 AGENTS.md`

Expected: `# stack-backend-ts — Codex AGENTS.md (가이드/index)` 헤더, "본 plugin 사용 방법" 섹션, link 표 헤더

- [ ] **Step 3: acceptance-check.sh 의 AGENTS.md drift step 갱신**

`scripts/acceptance-check.sh` 에서 AGENTS.md 비교 부분을 찾고:

Run: `grep -n "AGENTS.md" scripts/acceptance-check.sh`

해당 라인의 비교 로직이 `diff <(generate-agents-md.sh --check) AGENTS.md` 형식이면 그대로 유지 (generator 출력 = 파일 비교). 만약 더 복잡한 로직이면 단순화:

```bash
# AGENTS.md drift detection
if ! diff -u "$PLUGIN_DIR/AGENTS.md" <(bash "$PLUGIN_DIR/scripts/generate-agents-md.sh" --check) > /dev/null; then
  echo "FAIL: AGENTS.md drift — run scripts/generate-agents-md.sh" >&2
  ((FAILURES++))
fi
```

- [ ] **Step 4: acceptance-check 실행**

Run: `bash scripts/acceptance-check.sh 2>&1 | tail -10`

Expected: 78 skills, 0 failures, AGENTS.md drift 없음

- [ ] **Step 5: Commit**

```bash
git add plugins/stack-backend-ts/AGENTS.md plugins/stack-backend-ts/scripts/acceptance-check.sh
git commit -m "refactor(stack-backend-ts): AGENTS.md 가이드/index 형식으로 축소 (200줄 이하)

- generator 재실행 결과 반영
- acceptance-check 의 drift 비교 로직 단순화"
```

---

## Phase 2 — Codex 즉시 수정 5건

### Task 2.1: 깨진 cross-link 일괄 제거

**Files:**
- Modify (22 files): `plugins/stack-backend-ts/skills/agent-verify-def/SKILL.md`, `architecture-invariants/SKILL.md`, `auth/SKILL.md`, `backend-overview/SKILL.md`, `codex-commands/SKILL.md`, `context-assembly/SKILL.md`, `data-audit/SKILL.md`, `data-layer/SKILL.md`, `debug-session/SKILL.md`, `dependency-scanning/SKILL.md`, `full-architecture-audit/SKILL.md`, `http-error-sentinels/SKILL.md`, `incident-triage/SKILL.md`, `lsp-server/SKILL.md`, `performance-profiling/SKILL.md`, `provider-catalog-sync/SKILL.md`, `provider-scaffold/SKILL.md`, `security-audit-check/SKILL.md`, `security-runtime/SKILL.md`, `usage-tracking/SKILL.md`, `scripts/audit-all.sh`, `scripts/forbidden-scan.sh`

**대상 token (이전된 skill 명)**: `verify-workers-compat`, `workers-compat`, `pre-deploy-check`, `runtime-verify`, `d1-forbidden-audit`, `data-governance`

- [ ] **Step 1: 위반 위치 전부 추출**

Run:
```bash
cd plugins/stack-backend-ts
for token in verify-workers-compat workers-compat pre-deploy-check runtime-verify d1-forbidden-audit data-governance; do
  echo "=== $token ==="
  grep -rn "$token" skills/ scripts/ 2>/dev/null
done > /tmp/broken-links.txt
wc -l /tmp/broken-links.txt
```

Expected: 위반 위치 약 25-40 라인 출력

- [ ] **Step 2: 파일별로 검토 + 치환**

각 위반 위치에 대해 컨텍스트를 보고 적절한 처리:
- `[[verify-workers-compat]]` 같은 link 형식 → **project-local skill 안내로 치환**: `(project-local skill — 자세한 사항은 instance 측 .claude/skills/ 참고)`
- 본문 내 단순 명사 언급 → **삭제 또는 일반화**: "Workers 호환성 검증" → "runtime 호환성 검증 (instance 측 project-local skill)"
- `scripts/audit-all.sh` 의 audit 실행 호출 → **이미 21 audit 으로 제거됨 — 잔여 흔적이면 삭제**
- `scripts/forbidden-scan.sh` 의 예외 grep → **모두 삭제** (이전된 skill 이므로 예외 불필요)

예시: `plugins/stack-backend-ts/skills/auth/SKILL.md` 에 `[[verify-workers-compat]]` 가 있다면:

Read:
```bash
grep -n "verify-workers-compat" skills/auth/SKILL.md
```

Edit:
- old: `[[verify-workers-compat]]` 가 포함된 줄 전체
- new: 해당 줄에서 cross-link 부분을 `(runtime-specific — instance 측 project-local skill 참조)` 로 치환

- [ ] **Step 3: 변경 후 재검증**

Run:
```bash
for token in verify-workers-compat workers-compat pre-deploy-check runtime-verify d1-forbidden-audit data-governance; do
  count=$(grep -rln "$token" skills/ scripts/ 2>/dev/null | wc -l)
  echo "$token: $count files"
done
```

Expected: 모두 `0 files`

- [ ] **Step 4: forbidden-scan + acceptance-check 통과 확인**

Run:
```bash
bash scripts/forbidden-scan.sh 2>&1 | tail -3
bash scripts/acceptance-check.sh 2>&1 | tail -3
```

Expected: 둘 다 통과

- [ ] **Step 5: Commit**

```bash
git add plugins/stack-backend-ts/skills/ plugins/stack-backend-ts/scripts/
git commit -m "fix(stack-backend-ts): 이전된 skill 참조 일괄 제거 (Codex round 1 fix #1)

- verify-workers-compat / workers-compat / pre-deploy-check / runtime-verify / d1-forbidden-audit / data-governance
- 22개 파일에서 모두 제거 또는 'project-local skill 참조'로 치환"
```

### Task 2.2: `rule-linting` 의 scope 자기모순 해소

**Files:**
- Modify: `plugins/stack-backend-ts/skills/rule-linting/SKILL.md`

- [ ] **Step 1: 현재 위반 확인**

Run: `grep -n "apps/api" plugins/stack-backend-ts/skills/rule-linting/SKILL.md`

Expected: `:19:`, `:38-40:` 부근 출력

- [ ] **Step 2: 본문 일반화**

해당 라인들에서 `apps/api` → `<api-app>` 치환. 만약 `apps/api/src/...` 형태면 `<api-app>/src/...` 로 치환.

- [ ] **Step 3: 확인**

Run: `grep -n "apps/api" plugins/stack-backend-ts/skills/rule-linting/SKILL.md`

Expected: 출력 없음

- [ ] **Step 4: Commit**

```bash
git add plugins/stack-backend-ts/skills/rule-linting/SKILL.md
git commit -m "fix(stack-backend-ts): rule-linting scope 자기모순 해소 (Codex round 1 fix #2)

frontmatter는 project 인데 본문이 apps/api 요구하던 모순을 <api-app> placeholder로 통일"
```

### Task 2.3: api-routing 과 api-audit 의 middleware order SoT 일원화

**Files:**
- Modify: `plugins/stack-backend-ts/skills/api-audit/SKILL.md`

- [ ] **Step 1: 양쪽 현황 확인**

Run:
```bash
grep -n -A2 "middleware" plugins/stack-backend-ts/skills/api-routing/SKILL.md | head -30
grep -n -A2 "middleware\|app\.use" plugins/stack-backend-ts/skills/api-audit/SKILL.md | head -30
```

기대: api-routing 에 `requestId → rateLimit → cors → auth → schema → handler` 명시 / api-audit 는 별도 순서 정의 또는 검증 단계

- [ ] **Step 2: api-audit 가 api-routing 의 순서를 SoT 로 참조하도록 수정**

`plugins/stack-backend-ts/skills/api-audit/SKILL.md` 본문에서 middleware 순서를 *직접 정의* 한 부분을 *참조 형태* 로 변경:

Before (예시):
```markdown
- middleware 순서: auth → schema → rate-limit
```

After:
```markdown
- middleware 순서: [[api-routing]] invariant 의 순서표 그대로 적용. 본 audit 는 정의하지 않음.
- 검증 대상: `<framework middleware registration>` 호출 순서가 [[api-routing]] 의 `requestId → rateLimit → cors → auth → schema → handler` 와 일치
```

- [ ] **Step 3: api-audit 의 코드 예시에서도 순서 정정**

`grep -n "app.use\|authMiddleware" plugins/stack-backend-ts/skills/api-audit/SKILL.md` 의 출력 위치에서, 만약 순서 예시가 `app.use('*', authMiddleware)` 만 단독으로 표시되어 있다면, 코드 예시 자체를 `<framework middleware registration>` 추상화로 변환하고 순서 검증 의도만 남김.

- [ ] **Step 4: 검증**

Run: `bash plugins/stack-backend-ts/scripts/acceptance-check.sh 2>&1 | tail -3`

Expected: pass

- [ ] **Step 5: Commit**

```bash
git add plugins/stack-backend-ts/skills/api-audit/SKILL.md
git commit -m "fix(stack-backend-ts): middleware order SoT를 api-routing으로 일원화 (Codex round 1 fix #3)

api-audit 는 더 이상 자체 순서 정의하지 않고 api-routing invariant 참조"
```

### Task 2.4: generator import-missing fatal (이미 Task 1.1 에서 반영됨 — 검증만)

**Files:**
- Verify: `plugins/stack-backend-ts/scripts/generate-agents-md.sh`

- [ ] **Step 1: 의도된 fatal 처리 확인**

Run: `grep -n "MISSING_FOUND" plugins/stack-backend-ts/scripts/generate-agents-md.sh`

Expected: 변수 정의 + check 후 `exit 1` 분기 존재

- [ ] **Step 2: 실제 fatal 동작 테스트 (임시 가짜 누락 도입)**

Run:
```bash
cd plugins/stack-backend-ts
# CLAUDE.md 에 가짜 import 추가
cp CLAUDE.md CLAUDE.md.bak
echo "@./skills/__nonexistent__/SKILL.md" >> CLAUDE.md
bash scripts/generate-agents-md.sh; echo "exit: $?"
mv CLAUDE.md.bak CLAUDE.md
```

Expected: `error: import not found: skills/__nonexistent__/SKILL.md` + `FAIL: missing imports detected` + `exit: 1`

- [ ] **Step 3: 복구 후 정상 동작 확인**

Run: `bash scripts/generate-agents-md.sh && echo "OK"`

Expected: `Generated: ... lines, 78 imports` + `OK`

- [ ] **Step 4: 별도 commit 불필요 (Task 1.1 commit 에 이미 포함). 단, 검증 완료 메모만 남김**

---

### Task 2.5: rate limit sentinel 통일

**Files:**
- Modify: `plugins/stack-backend-ts/skills/auth/SKILL.md`
- Reference: `plugins/stack-backend-ts/skills/rate-limit-policy/SKILL.md`, `skills/http-error-sentinels/SKILL.md`

- [ ] **Step 1: 현재 sentinel 어휘 분포**

Run:
```bash
cd plugins/stack-backend-ts
grep -rn -E '"(rate_limited|rate_limit_exceeded)"' skills/
```

Expected:
```
skills/auth/SKILL.md:75:... "code": "rate_limit_exceeded" ...
skills/rate-limit-policy/SKILL.md:26:... "code": "rate_limited" ...
```

- [ ] **Step 2: auth 의 sentinel 을 `rate_limited` 로 통일**

Edit `plugins/stack-backend-ts/skills/auth/SKILL.md:75`:
- old: `{ error: { code: "rate_limit_exceeded", message, retry_after_ms } }`
- new: `{ error: { code: "rate_limited", retry_after_ms } }` (rate-limit-policy invariant 의 envelope 와 일치)

- [ ] **Step 3: http-error-sentinels 에 rate_limited 추가 (만약 누락 시)**

Run: `grep -n "rate_limited\|rate_limit_exceeded\|429" plugins/stack-backend-ts/skills/http-error-sentinels/SKILL.md`

만약 `rate_limited` 가 없다면 sentinel 목록에 추가:

```markdown
| 상황 | code | HTTP | 추가 필드 |
| ... | ... | ... | ... |
| rate limit 초과 | `rate_limited` | 429 | `retry_after_ms` |
```

- [ ] **Step 4: 재검증**

Run:
```bash
grep -rn "rate_limit_exceeded" skills/
```

Expected: 출력 없음

- [ ] **Step 5: forbidden-scan + acceptance-check 통과**

Run:
```bash
bash scripts/forbidden-scan.sh 2>&1 | tail -3
bash scripts/acceptance-check.sh 2>&1 | tail -3
```

Expected: 둘 다 통과

- [ ] **Step 6: Commit**

```bash
git add plugins/stack-backend-ts/skills/auth/SKILL.md plugins/stack-backend-ts/skills/http-error-sentinels/SKILL.md
git commit -m "fix(stack-backend-ts): rate limit sentinel 통일 (Codex round 1 fix #5)

- auth: rate_limit_exceeded → rate_limited (rate-limit-policy invariant envelope 일치)
- http-error-sentinels: rate_limited 항목 등재"
```

---

## Phase 3 — 신규 6 invariant skill 심화

### Task 3.1: rate-limit-policy 심화

**Files:**
- Modify: `plugins/stack-backend-ts/skills/rate-limit-policy/SKILL.md`

- [ ] **Step 1: 현재 내용 읽기**

Run: `cat plugins/stack-backend-ts/skills/rate-limit-policy/SKILL.md`

- [ ] **Step 2: 다음 섹션 추가 (기존 본문 끝에 append)**

```markdown
## 차단 가능 audit 체크리스트

- [ ] **3-axis 적용 검증**: route group 별 `(window, max, key)` 튜플 정의 — IP / API key / user 3 축 중 ≥ 1 축 활성
- [ ] **anonymous DDoS 가드**: 인증 전 라우트 (login, register, password reset) 에 IP 축 rate limit 필수 — middleware 등록 순서에서 auth 앞 위치
- [ ] **bypass 시그널 부재**: env / config 에 "rate limit 전체 비활성" flag 없음 (development env 한정 허용 시 명시적 warning log)
- [ ] **storage backend 일관성**: Redis / in-memory / DB 선택이 deployment 단위로 통일 — 멀티 인스턴스에서 in-memory 사용 금지
- [ ] **429 envelope 일관성**: 모든 위반 응답이 `{ error: { code: "rate_limited", retry_after_ms } }` + `Retry-After` 헤더

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| anonymous endpoint 에 user 축만 적용 | 무인증 DDoS 가능 | IP 축 추가 검증 |
| `retry_after_ms` 누락 | client backoff 불가 → spam retry | envelope schema 검증 |
| 멀티 인스턴스 in-memory backend | 인스턴스 별 카운트 분리 → 실효 제한 N배 | Redis 등 외부 backend 강제 |
| 라우트 그룹 별이 아닌 글로벌 quota | endpoint 별 차등 불가 → 비싼 endpoint 보호 실패 | 라우트 그룹 단위 정의 강제 |
```

- [ ] **Step 3: 검증**

Run: `bash plugins/stack-backend-ts/scripts/acceptance-check.sh 2>&1 | tail -3`

Expected: pass

- [ ] **Step 4: Commit**

```bash
git add plugins/stack-backend-ts/skills/rate-limit-policy/SKILL.md
git commit -m "feat(stack-backend-ts): rate-limit-policy 심화 — audit 체크리스트 + failure mode"
```

### Task 3.2: structured-log-schema 심화

**Files:**
- Modify: `plugins/stack-backend-ts/skills/structured-log-schema/SKILL.md`

- [ ] **Step 1: 현재 내용 읽기**

Run: `cat plugins/stack-backend-ts/skills/structured-log-schema/SKILL.md`

- [ ] **Step 2: required vs optional 명시 + 본문 추가**

기존 10 trace field 표를 다음으로 교체 (없으면 추가):

```markdown
## 필드 분류

**필수 (3개)** — 누락 시 로그 reject:

| 필드 | 타입 | 의미 |
|------|------|------|
| `timestamp` | ISO 8601 string | 이벤트 발생 시각 (UTC) |
| `level` | enum: debug \| info \| warn \| error \| fatal | 로그 레벨 |
| `event` | string (snake_case) | 이벤트 명 (예: `request_started`, `provider_call_failed`) |

**Trace correlation (필수 분기)** — 요청 컨텍스트 내에서는 모두 채움:

| 필드 | 타입 | 의미 |
|------|------|------|
| `request_id` | string (UUID v4 또는 ULID) | 요청 단위 ID |
| `trace_id` | string | distributed tracing root ID |
| `span_id` | string | 현재 span ID |
| `parent_span_id` | string | 부모 span ID (root 면 null 허용) |

**Optional context** — 해당 시에만:

| 필드 | 타입 | 의미 |
|------|------|------|
| `user_id` | string | 인증된 사용자 ID |
| `tenant_id` | string | 멀티테넌트 식별 |
| `service` | string | 서비스 명 (멀티서비스 환경) |
| `error.type` / `error.message` / `error.stack` | error 시 |

## 차단 가능 audit 체크리스트

- [ ] **필수 3 필드 누락 차단**: logger wrapper 가 `timestamp/level/event` 미공급 시 throw
- [ ] **request_id 자동 주입**: HTTP middleware 가 incoming request 마다 `request_id` 를 ContextVar / AsyncLocalStorage 에 set
- [ ] **PII 필터링**: `email`, `password`, `token`, `secret`, `key` 패턴이 message / context 에 plain 으로 등장 시 redaction
- [ ] **JSON 단일 라인**: 모든 로그 출력은 line-delimited JSON (newline 포함 금지) — log collector parser 호환
- [ ] **level 이 enum 일치**: 자유 문자열 금지 (`"INFO"` 와 `"info"` 혼재 차단)

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| `request_id` 없는 로그 | 요청 단위 grep 불가 → 디버깅 시간 폭증 | ContextVar 자동 주입 + middleware 등록 강제 |
| timestamp 가 시스템 local TZ | 멀티 리전 로그 비교 시 시간 mismatch | UTC + ISO 8601 강제 |
| 자유 형식 message 안에 user_id 포함 | grep 으로 user 별 로그 추출 불가 | 구조화 context 필드 강제, message 는 사람 가독용만 |
| 에러 stack trace 가 message 에 squeeze | parser 가 multi-line JSON 처리 불가 | `error.stack` 필드 분리 |
```

- [ ] **Step 3: Commit**

```bash
git add plugins/stack-backend-ts/skills/structured-log-schema/SKILL.md
git commit -m "feat(stack-backend-ts): structured-log-schema 심화 — required/optional 분리 + audit 체크리스트"
```

### Task 3.3: cors-policy 심화

**Files:**
- Modify: `plugins/stack-backend-ts/skills/cors-policy/SKILL.md`

- [ ] **Step 1: 다음 섹션 append**

```markdown
## 차단 가능 audit 체크리스트

- [ ] **wildcard origin 차단**: production 환경에서 `Access-Control-Allow-Origin: *` 금지 (credentials 모드 사용 시 표준 위반)
- [ ] **credentials + wildcard 조합 차단**: `Allow-Credentials: true` 와 `Allow-Origin: *` 동시 설정 → 브라우저가 거부
- [ ] **expose_headers 명시**: 응답에서 client 가 읽어야 할 custom header (예: `X-Request-Id`, `X-Rate-Limit-*`) 는 `Access-Control-Expose-Headers` 에 등재
- [ ] **preflight cache TTL**: `Access-Control-Max-Age` 명시 (기본 300s, 환경별 결정)
- [ ] **origin allowlist 단일 SoT**: 코드 하드코딩 금지 — env / config 단일 출처

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| `Origin: null` 허용 | sandboxed iframe / file:// 우회 가능 | allowlist 검증에서 명시적 제외 |
| `Allow-Methods: *` | 의도치 않은 HTTP verb 허용 | 명시적 method 열거 강제 |
| custom header 없이 frontend 가 read 시도 | client error → silent 실패 | expose_headers 검증 |
| 동적 origin reflection without validation | open redirect 와 유사한 trust 누수 | allowlist 매치 후 echo 만 허용 |
```

- [ ] **Step 2: Commit**

```bash
git add plugins/stack-backend-ts/skills/cors-policy/SKILL.md
git commit -m "feat(stack-backend-ts): cors-policy 심화 — audit 체크리스트 + failure mode"
```

### Task 3.4: idempotency-key 심화

**Files:**
- Modify: `plugins/stack-backend-ts/skills/idempotency-key/SKILL.md`

- [ ] **Step 1: 다음 섹션 추가/교체**

```markdown
## Key 구성 (충돌 방지)

Idempotency key 의 고유 scope 는 다음 5 차원 결합:

```
key_scope = sha256(
  user_id || tenant_id || method || path || body_hash || client_provided_key
)
```

- `user_id` / `tenant_id`: 멀티테넌트 격리 — 다른 user 가 같은 client key 보내도 충돌 없음
- `method` + `path`: 같은 client key 라도 endpoint 다르면 별도 처리
- `body_hash`: 같은 client key 인데 body 다르면 → 409 Conflict (재시도 일관성 보장)
- `client_provided_key`: header `Idempotency-Key` 값

## 차단 가능 audit 체크리스트

- [ ] **Key TTL 정책**: 저장 TTL 명시 (기본 24h 권장) — 무한 보관 시 storage growth
- [ ] **In-flight lock**: 동일 key 동시 요청 시 lock 으로 직렬화 — 두 번째 요청은 첫 결과 대기 (race condition 차단)
- [ ] **body_hash 일치 검증**: 같은 key + 다른 body → 409 Conflict
- [ ] **응답 본문 + status 저장**: 재시도 시 동일 응답 반환 가능해야 함
- [ ] **safe method 면제**: GET / HEAD 는 idempotency-key 처리 불필요 (이미 idempotent)

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| user_id 없이 key 만으로 lookup | 다른 user 의 결과 leak | 5 차원 결합 강제 |
| body hash 검증 없음 | retry 시 다른 body 가 같은 응답 받음 → silent 데이터 손실 | 409 Conflict 분기 |
| In-flight lock 없음 | 동시 retry 가 두 번 처리 (예: 결제 두 번) | distributed lock (Redis SETNX / DB advisory lock) |
| TTL 무한 | 저장소 무한 증가 | 명시적 TTL + 만료 후 재처리 허용 정책 |
```

- [ ] **Step 2: Commit**

```bash
git add plugins/stack-backend-ts/skills/idempotency-key/SKILL.md
git commit -m "feat(stack-backend-ts): idempotency-key 심화 — 5차원 key + in-flight lock + audit"
```

### Task 3.5: secret-rotation 심화

**Files:**
- Modify: `plugins/stack-backend-ts/skills/secret-rotation/SKILL.md`

- [ ] **Step 1: 다음 섹션 추가**

```markdown
## 코드 레벨 검증 체크리스트

- [ ] **Secret 읽기 단일 함수**: 모든 secret 접근이 `getSecret(name, version?)` 단일 함수 경유 — direct env 접근 금지
- [ ] **Dual-key window 지원**: rotation 중 (`primary` + `previous` 둘 다 활성), `verifySecret(token)` 이 두 key 모두 시도
- [ ] **Rotation 알림 hook**: rotation 완료 시 `onRotation(name, oldVersion, newVersion)` 콜백으로 캐시 무효화 / 메트릭 발사
- [ ] **Secret 로깅 차단**: structured-log-schema 의 PII 필터가 `*_secret`, `*_key`, `*_token` 패턴 redact
- [ ] **Secret 만료 모니터링**: 각 secret 의 `expires_at` 메트릭화 — 임박 시 알람
- [ ] **Test fixture 의 secret 은 별도 namespace**: prod secret 과 같은 이름 사용 금지

## Rotation 절차 (Dual-Key Window)

```
1. 새 key 생성 → secret store 에 version N+1 으로 add (primary 는 N 유지)
2. Code deploy: verifySecret() 이 N 과 N+1 모두 시도
3. 클라이언트가 새 key 로 전환 (관찰)
4. Promote: primary 를 N+1 으로 swap (이제 verify 는 N+1 우선, N 는 fallback)
5. Grace period (24h~7d) 후 N revoke
```

각 단계에서 metrics:
- `secret_verify_total{version}` — version 별 검증 count
- `secret_verify_failed_total{version}` — 실패 count

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| Big-bang rotation (dual-key window 없이 swap) | rotation 시점에 in-flight 요청 모두 401 | dual-key window 강제 |
| Code 가 env 직접 읽기 | rotation 후 process restart 필요 | getSecret 함수 + cache invalidation hook |
| Secret 이 log 에 plain | log aggregator 가 archive 후 영구 leak | PII 필터 강제 + log 검증 audit |
| Test 가 prod secret 사용 | test 실패 시 prod secret 노출 위험 | namespace 분리 + lint rule |
```

- [ ] **Step 2: Commit**

```bash
git add plugins/stack-backend-ts/skills/secret-rotation/SKILL.md
git commit -m "feat(stack-backend-ts): secret-rotation 심화 — dual-key window 절차 + 코드 검증 체크리스트"
```

### Task 3.6: migration-rollback 심화

**Files:**
- Modify: `plugins/stack-backend-ts/skills/migration-rollback/SKILL.md`

- [ ] **Step 1: 다음 섹션 추가**

```markdown
## Online migration 관측성

Blue/green 또는 expand-contract migration 중 다음 메트릭 / 로그 필수:

- [ ] **Lock timeout 명시**: `SET statement_timeout = '5s'`, `SET lock_timeout = '2s'` — 무한 대기 방지
- [ ] **Batched backfill 진행률**: `migration_backfill_progress{migration_id, table}` gauge — 배치 마다 increment
- [ ] **CONCURRENTLY 인덱스 사용**: Postgres 의 경우 `CREATE INDEX CONCURRENTLY` (read 차단 없음). 실패 시 INVALID 상태 cleanup 필요
- [ ] **Long-running query 알람**: `>30s` 쿼리 감지 시 즉시 알람
- [ ] **Replication lag 모니터링**: read replica lag > 임계 시 migration pause

## 6 단계 Blue/Green 절차 (expand-contract)

```
1. Expand: 신규 컬럼 추가 (NULL 허용 또는 default)
2. Backfill: 배치 UPDATE (`WHERE id BETWEEN ? AND ?`)
3. Dual-write: 코드가 old + new 둘 다 write
4. Switch read: 코드가 new 에서 read (fallback to old)
5. Stop dual-write: new 만 write
6. Contract: old 컬럼 제거 (별도 release)
```

각 단계 사이 monitoring window (최소 24h, 트래픽 보고 결정).

## Rollback 가능 조건

- [ ] **Step 1-3**: 즉시 rollback (코드 revert + 신규 컬럼 NULL 유지)
- [ ] **Step 4-5**: 데이터 일관성 확인 후 rollback (dual-write 재활성)
- [ ] **Step 6**: 불가 (column drop 후) — backup restore 만 가능

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| Lock timeout 없는 ALTER TABLE | production traffic 차단 | statement_timeout 강제 |
| 배치 없는 한 번에 UPDATE | long lock + replication lag 폭증 | LIMIT/BETWEEN 배치 강제 |
| Step 6 (drop) 를 monitoring 없이 진행 | rollback 불가 상태 진입 | step 6 별도 release + 7일 이상 monitoring |
| `CREATE INDEX` (non-concurrent) on production | read 차단 | CONCURRENTLY 강제 lint |
```

- [ ] **Step 2: Commit**

```bash
git add plugins/stack-backend-ts/skills/migration-rollback/SKILL.md
git commit -m "feat(stack-backend-ts): migration-rollback 심화 — 6단계 절차 + 관측성 + rollback 가능 조건"
```

---

## Phase 4 — 78 SKILL.md framework split

> 이 phase 는 **51개 skill 의 framework 어휘 + 48개 skill 의 `apps/api` 어휘 제거 + placeholder 치환** 이 핵심. 변환량이 크므로 5-7 skill 씩 batch 로 묶음. 각 batch 끝에 acceptance-check + forbidden-scan 통과 보장.

> **공통 치환 규칙 (모든 batch 동일 적용)**:
> 1. `Hono` / `hono` → `<framework>`
> 2. `Cloudflare Workers` / `Workers` (단독 명사로 framework 의미일 때) → `<runtime>`
> 3. `wrangler` / `wrangler.toml` → 제거 또는 instance-specific note
> 4. `c.env` → `<framework env binding>`
> 5. `c.json(...)` → `<framework json response>(...)` 또는 본문 의도가 단순 응답이면 추상 의사코드
> 6. `c.req.*` → `<framework request accessor>`
> 7. `c.set / c.get` → `<framework context store>`
> 8. `streamSSE` → `<framework SSE helper>`
> 9. `HTTPException` → `<framework HTTP error class>`
> 10. `app.use(...)` / `app.get(...)` 등 → `<framework middleware registration>` / `<framework route definition>`
> 11. `Cloudflare` → 제거 또는 `<runtime>` (단독으로 vendor 의미 시)
> 12. `apps/api` → `<api-app>` (path 본체는 `<api-app>/src/...` 형식 유지)
> 13. `c.executionCtx` → 제거 (runtime-specific, 일반 의사코드로 변경)
> 14. **유지**: Postgres, Redis, S3, Buffer, ReadableStream, fetch, Promise, async/await 등 표준 어휘

### Task 4.1: forbidden-scan.sh 의 framework 어휘 차단 규칙 추가

**Files:**
- Modify: `plugins/stack-backend-ts/scripts/forbidden-scan.sh`
- Reference: `plugins/stack-backend-ts/scripts/forbidden-terms.txt`

- [ ] **Step 1: 현재 forbidden-terms.txt 확인**

Run: `cat plugins/stack-backend-ts/scripts/forbidden-terms.txt`

- [ ] **Step 2: framework / runtime 어휘를 forbidden-terms.txt 에 추가**

`plugins/stack-backend-ts/scripts/forbidden-terms.txt` 끝에 다음 줄들을 append:

```
# Framework / runtime 어휘 (Phase 4 이후 차단)
Hono
hono
Cloudflare
Workers
wrangler
c\.env
c\.json
c\.req
c\.set
streamSSE
HTTPException
apps/api
```

> **주의**: 만약 forbidden-terms.txt 가 regex 가 아닌 plain string 매칭이면 `\.` 를 `.` 으로 변경. forbidden-scan.sh 의 구현 확인 필요.

- [ ] **Step 3: forbidden-scan.sh 가 새 어휘를 인식하는지 확인 (예상 fail 카운트)**

Run:
```bash
cd plugins/stack-backend-ts
bash scripts/forbidden-scan.sh 2>&1 | tail -5
```

Expected: 위반 51+ 보고 (Phase 4 진행 전 baseline). **이 fail 은 의도된 것** — Phase 4 batch 처리 중 점차 0 으로 수렴.

- [ ] **Step 4: 임시 우회 옵션 추가 (Phase 4 진행 중 안전 장치)**

`scripts/forbidden-scan.sh` 에 `--allow-framework-vocab` 플래그 추가 (env var `ALLOW_FRAMEWORK_VOCAB=1`):

```bash
# 옵션 파싱 부근에 추가
ALLOW_FRAMEWORK_VOCAB="${ALLOW_FRAMEWORK_VOCAB:-0}"

# 어휘 필터링 부근에 조건 추가:
if [ "$ALLOW_FRAMEWORK_VOCAB" = "1" ]; then
  # framework 어휘 라인은 제거
  PATTERNS_FILE=$(mktemp)
  grep -v -E '^(Hono|hono|Cloudflare|Workers|wrangler|c\\\.|streamSSE|HTTPException|apps/api)' "$PLUGIN_DIR/scripts/forbidden-terms.txt" > "$PATTERNS_FILE"
  # PATTERNS_FILE 사용
fi
```

- [ ] **Step 5: 임시 우회로 0 match 확인**

Run:
```bash
ALLOW_FRAMEWORK_VOCAB=1 bash scripts/forbidden-scan.sh 2>&1 | tail -3
```

Expected: 0 match

- [ ] **Step 6: Commit**

```bash
git add plugins/stack-backend-ts/scripts/forbidden-scan.sh plugins/stack-backend-ts/scripts/forbidden-terms.txt
git commit -m "feat(stack-backend-ts): forbidden-scan에 framework/runtime 어휘 등록 + 진행중 우회 옵션

- Hono/Workers/wrangler/c.env/streamSSE/HTTPException/apps/api 등록
- ALLOW_FRAMEWORK_VOCAB=1 으로 Phase 4 batch 진행 중 일시 우회 (작업 완료 후 제거)"
```

### Task 4.2: Batch A — Invariant 18개 framework split

**대상 skill** (invariant 분류 18개 중 framework 어휘 있는 것):
- `architecture-invariants`, `single-writer`, `provider-retry-matrix`, `token-budget-constants`, `sse-lifecycle`, `compaction-thresholds`, `http-error-sentinels`, `input-safety-gate-ordering`, `mcp-namespace`, `run-policy-presets`, `spawn-limits`, `tool-sort-order`, `agent-loop-invariants`, `app-domain-boundary`, `media-job-lifecycle`, `rate-limit-policy`, `structured-log-schema`, `cors-policy`

**Files:** 위 18개 SKILL.md

- [ ] **Step 1: Batch A 의 framework 어휘 위치 사전 조사**

Run:
```bash
cd plugins/stack-backend-ts
for s in architecture-invariants single-writer provider-retry-matrix token-budget-constants sse-lifecycle compaction-thresholds http-error-sentinels input-safety-gate-ordering mcp-namespace run-policy-presets spawn-limits tool-sort-order agent-loop-invariants app-domain-boundary media-job-lifecycle rate-limit-policy structured-log-schema cors-policy; do
  count=$(grep -cE '\b(Hono|Workers|wrangler|c\.env|c\.json|c\.req|c\.set|Cloudflare|streamSSE|HTTPException|app\.use|app\.get|app\.post|apps/api)\b' "skills/$s/SKILL.md" 2>/dev/null || echo 0)
  if [ "$count" != "0" ]; then
    echo "$s: $count violations"
  fi
done
```

기대: 약 10-15개 skill 에 violations (나머지는 깨끗)

- [ ] **Step 2: skill 별로 순차 처리**

각 violation 보유 skill 에 대해:

```bash
# 위치 확인
grep -nE '\b(Hono|Workers|wrangler|c\.env|...)\b' skills/<name>/SKILL.md
```

각 라인을 컨텍스트 보고 위 "공통 치환 규칙" 적용. Edit tool 사용.

**예시 — single-writer 의 Workers 캐비잇 절**:

Before:
```markdown
> ⚠️ Workers 환경 caveat: `fsync` / `rename` (Node fs API) 은 *escape hatch only* — `apps/api/src/storage/provider.ts` 의 `LocalFsProvider` 내부에서만 사용. Workers runtime 에서는 R2 / KV SDK 의 atomic put 패턴으로 대체.
```

After:
```markdown
> ⚠️ Runtime caveat: `fsync` / `rename` 류 Node fs API 는 *escape hatch only* — `<api-app>/src/storage/provider.ts` 의 local fs provider 내부에서만 사용. 외부 storage runtime (예: object storage SDK) 에서는 atomic put 패턴으로 대체 (etag-conditioned put 등).
```

- [ ] **Step 3: Batch A 검증**

Run:
```bash
for s in architecture-invariants single-writer provider-retry-matrix token-budget-constants sse-lifecycle compaction-thresholds http-error-sentinels input-safety-gate-ordering mcp-namespace run-policy-presets spawn-limits tool-sort-order agent-loop-invariants app-domain-boundary media-job-lifecycle rate-limit-policy structured-log-schema cors-policy; do
  count=$(grep -cE '\b(Hono|Workers|wrangler|c\.env|c\.json|c\.req|c\.set|Cloudflare|streamSSE|HTTPException|app\.use|app\.get|app\.post|apps/api)\b' "skills/$s/SKILL.md" 2>/dev/null || echo 0)
  if [ "$count" != "0" ]; then
    echo "FAIL $s: $count remaining"
  fi
done
```

Expected: 출력 없음

- [ ] **Step 4: acceptance-check + forbidden-scan (with allow-framework-vocab 점차 제거 계획)**

Run:
```bash
bash scripts/acceptance-check.sh 2>&1 | tail -3
ALLOW_FRAMEWORK_VOCAB=1 bash scripts/forbidden-scan.sh 2>&1 | tail -3
```

Expected: 양쪽 통과

- [ ] **Step 5: Commit**

```bash
git add plugins/stack-backend-ts/skills/
git commit -m "refactor(stack-backend-ts): Batch A — invariant 18개 framework/runtime split

Hono / Workers / wrangler / c.env / streamSSE / HTTPException / apps/api 어휘를
<framework> / <runtime> / <api-app> placeholder 로 치환.
본문에서 framework-specific 코드 snippet 제거, 추상 의사코드로 변환."
```

### Task 4.3: Batch B — Workflow 첫 그룹 (10개)

**대상 skill**:
- `agent-loop`, `tool-system`, `provider-layer`, `context-assembly`, `sse-streaming`, `data-layer`, `compaction`, `sub-agent`, `lsp-server`, `mcp-integration`

**Files:** 위 10개 SKILL.md

- [ ] **Step 1: 위반 위치 사전 조사**

Run:
```bash
for s in agent-loop tool-system provider-layer context-assembly sse-streaming data-layer compaction sub-agent lsp-server mcp-integration; do
  count=$(grep -cE '\b(Hono|Workers|wrangler|c\.env|c\.json|c\.req|c\.set|Cloudflare|streamSSE|HTTPException|app\.use|app\.get|app\.post|apps/api)\b' "skills/$s/SKILL.md" 2>/dev/null || echo 0)
  [ "$count" != "0" ] && echo "$s: $count"
done
```

- [ ] **Step 2: skill 별 치환 (Batch A 와 동일 방식)**

- [ ] **Step 3: 검증 + Commit**

```bash
git add plugins/stack-backend-ts/skills/
git commit -m "refactor(stack-backend-ts): Batch B — workflow 첫 10개 framework split

agent-loop / tool-system / provider-layer / context-assembly / sse-streaming /
data-layer / compaction / sub-agent / lsp-server / mcp-integration"
```

### Task 4.4: Batch C — Workflow 둘째 그룹 (10개)

**대상 skill**:
- `api-routing`, `auth`, `database`, `error-handling`, `media-pipeline-patterns`, `ai-agent-patterns`, `usage-tracking`, `security-runtime`, `dependency-scanning`, `incident-triage`

**Files:** 위 10개 SKILL.md

- [ ] **Step 1-3: Batch B 와 동일 패턴 진행**

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(stack-backend-ts): Batch C — workflow 둘째 10개 framework split"
```

### Task 4.5: Batch D — Workflow 셋째 그룹 (10개)

**대상 skill**:
- `performance-profiling`, `debug-session`, `testing-infra`, `test-scaffold`, `test-cleanup`, `red-green-fix`, `new-agent`, `new-run`, `provider-scaffold`, `provider-catalog-sync`

**Files:** 위 10개 SKILL.md

- [ ] **Step 1-3: 동일 패턴**

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(stack-backend-ts): Batch D — workflow 셋째 10개 framework split"
```

### Task 4.6: Batch E — Workflow 넷째 + 신규 invariant (9개)

**대상 skill**:
- `agent-verify-def`, `coding-standards`, `design-principles`, `ts-agent-rules`, `commit-rules`, `codex-commands`, `codex-subagents`, `rule-linting`, `backend-overview`

**Files:** 위 9개 SKILL.md

- [ ] **Step 1-3: 동일 패턴**

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(stack-backend-ts): Batch E — workflow 넷째 9개 framework split"
```

### Task 4.7: Batch F — Audit skill 21개

**대상 skill**: audit role 가진 21개 모두

- [ ] **Step 1: audit skill 명단 추출 + framework 어휘 분포 확인**

Run:
```bash
cd plugins/stack-backend-ts
for d in skills/*-audit skills/*audit-* skills/full-architecture-audit skills/security-audit-check skills/api-audit skills/data-audit skills/session-audit skills/loop-audit; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  count=$(grep -cE '\b(Hono|Workers|wrangler|c\.env|c\.json|c\.req|c\.set|Cloudflare|streamSSE|HTTPException|app\.use|app\.get|app\.post|apps/api)\b' "$d/SKILL.md" 2>/dev/null || echo 0)
  [ "$count" != "0" ] && echo "$name: $count"
done
```

- [ ] **Step 2: 각 audit skill 별 치환**

- [ ] **Step 3: 전체 검증 (framework 어휘 0)**

Run:
```bash
grep -rcE '\b(Hono|Workers|wrangler|c\.env|c\.json|c\.req|c\.set|Cloudflare|streamSSE|HTTPException|app\.use|app\.get|app\.post|apps/api)\b' skills/ 2>/dev/null | grep -v ':0$' | grep -v '/0$' || echo "ALL CLEAN"
```

Expected: `ALL CLEAN`

- [ ] **Step 4: forbidden-scan 정식 (우회 없이) 통과**

Run: `bash scripts/forbidden-scan.sh 2>&1 | tail -3`

Expected: `✓ forbidden-scan: 0 matches`

- [ ] **Step 5: Commit**

```bash
git add plugins/stack-backend-ts/skills/
git commit -m "refactor(stack-backend-ts): Batch F — audit 21개 framework split

전체 78개 SKILL.md 의 Hono/Workers/wrangler/c.env/HTTPException/apps/api 완전 제거 완료.
이제 모든 본문은 <framework>/<runtime>/<api-app> placeholder 사용."
```

### Task 4.8: 우회 옵션 제거 + AGENTS.md 재생성

**Files:**
- Modify: `plugins/stack-backend-ts/scripts/forbidden-scan.sh`
- Regenerate: `plugins/stack-backend-ts/AGENTS.md`

- [ ] **Step 1: forbidden-scan 의 `ALLOW_FRAMEWORK_VOCAB` 우회 옵션 제거**

`scripts/forbidden-scan.sh` 에서 Task 4.1 에서 추가한 우회 분기 삭제. 다시 unconditional 차단으로.

- [ ] **Step 2: AGENTS.md 재생성**

Run: `bash plugins/stack-backend-ts/scripts/generate-agents-md.sh`

Expected: `Generated: ... lines, 78 imports` + AGENTS.md 200줄 이하

- [ ] **Step 3: 전체 검증**

Run:
```bash
cd plugins/stack-backend-ts
bash scripts/acceptance-check.sh 2>&1 | tail -3
bash scripts/forbidden-scan.sh 2>&1 | tail -3
```

Expected: 양쪽 통과 (acceptance: 78/78, forbidden: 0)

- [ ] **Step 4: Commit**

```bash
git add plugins/stack-backend-ts/scripts/forbidden-scan.sh plugins/stack-backend-ts/AGENTS.md
git commit -m "chore(stack-backend-ts): framework split 완료 후 우회 옵션 제거 + AGENTS.md 재생성"
```

---

## Phase 5 — 운영 / 확장

### Task 5.1: DOMAIN_VOCAB CI 템플릿 + audit-all wrapper

**Files:**
- Create: `plugins/stack-backend-ts/docs/ci-template.md`
- Reference: `plugins/stack-backend-ts/scripts/audit-all.sh`

- [ ] **Step 1: CI 템플릿 작성**

`plugins/stack-backend-ts/docs/ci-template.md`:

```markdown
# CI 통합 템플릿

## GitHub Actions

```yaml
# .github/workflows/audit.yml
name: stack-backend-ts audit

on:
  pull_request:
    paths:
      - '<api-app>/**'
      - '.claude/skills/**'

jobs:
  audit:
    runs-on: ubuntu-latest
    env:
      # instance 측에서 값 결정 — placeholder 어휘를 forbidden-scan / audit 에 주입
      DOMAIN_VOCAB: "writer|author|scenario|novel|character|persona"
      API_APP_PATH: "apps/api"
    steps:
      - uses: actions/checkout@v4
      - name: acceptance-check
        run: bash .claude/plugins/stack-backend-ts/scripts/acceptance-check.sh
      - name: forbidden-scan
        run: bash .claude/plugins/stack-backend-ts/scripts/forbidden-scan.sh
      - name: audit-all
        run: bash .claude/plugins/stack-backend-ts/scripts/audit-all.sh
```

## DOMAIN_VOCAB 형식

`|` 구분 정규식. 도메인 어휘를 enumeration 형식으로 나열:

```bash
export DOMAIN_VOCAB="entity1|entity2|entity3"
```

`app-domain-boundary` audit 가 본 env 를 읽어서 `<api-app>/src/` 트리에서 위 어휘 등장 시 violation 보고.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/stack-backend-ts/docs/ci-template.md
git commit -m "docs(stack-backend-ts): CI 통합 템플릿 + DOMAIN_VOCAB 사용법"
```

### Task 5.2: dependency-scanning 확장

**Files:**
- Modify: `plugins/stack-backend-ts/skills/dependency-scanning/SKILL.md`

- [ ] **Step 1: 다음 섹션 추가 (기존 본문 보완)**

```markdown
## Package manager matrix

본 skill 은 pnpm / npm / yarn / bun 모두 지원. 다음 detection 으로 활성 manager 결정:

| Lockfile | Manager | Install (CI) | Audit |
|----------|---------|--------------|-------|
| `pnpm-lock.yaml` | pnpm | `pnpm install --frozen-lockfile` | `pnpm audit --prod` |
| `package-lock.json` | npm | `npm ci` | `npm audit --omit=dev` |
| `yarn.lock` | yarn | `yarn install --frozen-lockfile` | `yarn npm audit --recursive` |
| `bun.lockb` | bun | `bun install --frozen-lockfile` | `bun audit` |

## Lockfile 정책

- [ ] **Lockfile 단일 SoT**: 위 lockfile 중 정확히 1개만 존재. 둘 이상 발견 시 fail
- [ ] **Lockfile 커밋 강제**: `.gitignore` 에 lockfile 패턴 없음 검증
- [ ] **Frozen install (CI)**: 모든 CI install 명령이 frozen / `--frozen-lockfile` flag

## Supply-chain hardening

- [ ] **`overrides` / `resolutions` 사용**: transitive 의존성 강제 버전 가능
- [ ] **CVE 차단 임계**: critical / high CVE 발견 시 CI fail. medium 이하는 warning
- [ ] **License 화이트리스트**: GPL-3.0 / AGPL-3.0 등 incompatible license 차단 (선택)
- [ ] **Postinstall script 차단**: `pnpm install --ignore-scripts` 권장. exception 은 명시적 allowlist

## Runtime smoke

설치 후 boot smoke test:

```bash
# import all entry points
node -e 'require("./<api-app>/dist/index.js")'
```

설치만 성공해도 런타임에서 module not found / native binding 실패 가능 → import 검증 필수

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| Lockfile 미커밋 | reproducible build 불가, 의존성 drift | .gitignore 검증 |
| `npm install` (non-ci) | lockfile 갱신 → 의도치 않은 버전 변경 | `npm ci` 강제 |
| postinstall script 무검증 | malicious package 코드 실행 | `--ignore-scripts` + allowlist |
| Lockfile 둘 이상 | 두 manager 동시 사용 → 상태 분리 | acceptance-check 에서 검증 |
```

- [ ] **Step 2: 검증**

Run: `bash plugins/stack-backend-ts/scripts/acceptance-check.sh 2>&1 | tail -3`

Expected: pass

- [ ] **Step 3: Commit**

```bash
git add plugins/stack-backend-ts/skills/dependency-scanning/SKILL.md
git commit -m "feat(stack-backend-ts): dependency-scanning 확장 — pm matrix / lockfile / supply-chain"
```

### Task 5.3: framework vocab 검증 wrapper 스크립트

**Files:**
- Create: `plugins/stack-backend-ts/scripts/check-framework-vocab.sh`

- [ ] **Step 1: 스크립트 작성**

`plugins/stack-backend-ts/scripts/check-framework-vocab.sh`:

```bash
#!/usr/bin/env bash
# check-framework-vocab.sh — SKILL.md 본문에 framework/runtime 어휘 재유입 차단
# forbidden-scan.sh 의 framework 어휘 패턴만 단독으로 실행. CI 에서 별도 step 으로 사용 가능.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_TARGET="${1:-$PLUGIN_DIR/skills}"

PATTERNS=(
  '\bHono\b'
  '\bhono\b'
  '\bCloudflare\b'
  '\bWorkers\b'
  '\bwrangler\b'
  '\bc\.env\b'
  '\bc\.json\b'
  '\bc\.req\b'
  '\bc\.set\b'
  '\bstreamSSE\b'
  '\bHTTPException\b'
  '\bapps/api\b'
)

FAIL=0
for p in "${PATTERNS[@]}"; do
  if matches=$(grep -rnE "$p" "$SCAN_TARGET" 2>/dev/null); then
    if [ -n "$matches" ]; then
      echo "VIOLATION: $p"
      echo "$matches" | head -5
      echo ""
      FAIL=1
    fi
  fi
done

if [ $FAIL -eq 0 ]; then
  echo "✓ framework vocab clean: $SCAN_TARGET"
else
  echo "✗ framework vocab violations found" >&2
  exit 1
fi
```

- [ ] **Step 2: 실행 권한**

Run:
```bash
chmod +x plugins/stack-backend-ts/scripts/check-framework-vocab.sh
bash plugins/stack-backend-ts/scripts/check-framework-vocab.sh
```

Expected: `✓ framework vocab clean: .../skills`

- [ ] **Step 3: acceptance-check 에 통합 (선택)**

`scripts/acceptance-check.sh` 의 검증 단계에 추가:

```bash
# framework vocab regression check
if ! bash "$PLUGIN_DIR/scripts/check-framework-vocab.sh" > /dev/null 2>&1; then
  echo "FAIL: framework vocab regression" >&2
  ((FAILURES++))
fi
```

- [ ] **Step 4: Commit**

```bash
git add plugins/stack-backend-ts/scripts/check-framework-vocab.sh plugins/stack-backend-ts/scripts/acceptance-check.sh
git commit -m "feat(stack-backend-ts): check-framework-vocab.sh — framework 어휘 회귀 차단"
```

---

## Phase 6 — 최종 검증 + 마무리

### Task 6.1: 전체 검증 스위트

**Files:** (검증만)

- [ ] **Step 1: acceptance-check**

Run: `bash plugins/stack-backend-ts/scripts/acceptance-check.sh`

Expected: `78 skills checked, 0 failures`

- [ ] **Step 2: forbidden-scan**

Run: `bash plugins/stack-backend-ts/scripts/forbidden-scan.sh`

Expected: `✓ forbidden-scan: 0 matches`

- [ ] **Step 3: check-framework-vocab**

Run: `bash plugins/stack-backend-ts/scripts/check-framework-vocab.sh`

Expected: `✓ framework vocab clean`

- [ ] **Step 4: AGENTS.md drift**

Run: `diff -u plugins/stack-backend-ts/AGENTS.md <(bash plugins/stack-backend-ts/scripts/generate-agents-md.sh --check)`

Expected: 출력 없음

- [ ] **Step 5: AGENTS.md 줄 수**

Run: `wc -l plugins/stack-backend-ts/AGENTS.md`

Expected: 200 이하

- [ ] **Step 6: audit-all 실행 (DOMAIN_VOCAB 없이도 통과해야 함 — 단 app-domain-boundary 는 env 없으면 skip 또는 warn)**

Run: `bash plugins/stack-backend-ts/scripts/audit-all.sh 2>&1 | tail -10`

Expected: 21 audit 실행, framework 어휘 관련 fail 없음

- [ ] **Step 7: cross-link 깨짐 없음**

Run:
```bash
cd plugins/stack-backend-ts
for token in verify-workers-compat workers-compat pre-deploy-check runtime-verify d1-forbidden-audit data-governance; do
  count=$(grep -rln "$token" skills/ scripts/ 2>/dev/null | wc -l)
  [ "$count" != "0" ] && echo "FAIL $token: $count files"
done && echo "all clean"
```

Expected: `all clean`

### Task 6.2: iyaki-rebuild instance CLAUDE.md placeholder 매핑 확인

**Files:**
- Verify: `iyaki-rebuild/CLAUDE.md` (별도 repo 가능성, 본 작업은 가이드 확인만)

- [ ] **Step 1: iyaki-rebuild 경로 존재 확인**

Run: `ls -la /Users/youngseoklee/Desktop/workplace/iyaki-rebuild/CLAUDE.md 2>/dev/null || echo "not at expected path"`

만약 다른 경로면, 사용자에게 확인 요청.

- [ ] **Step 2: 매핑 표 존재 확인**

Run: `grep -A20 "placeholder" /Users/youngseoklee/Desktop/workplace/iyaki-rebuild/CLAUDE.md 2>/dev/null | head -30`

Expected: `<framework>` → `Hono`, `<runtime>` → `Cloudflare Workers` 등 매핑 등재

만약 누락된 placeholder 가 있으면 instance CLAUDE.md 갱신 필요 — 사용자에게 별도 commit 권한 받고 진행.

### Task 6.3: 최종 status + 메모

**Files:**
- 없음 (보고만)

- [ ] **Step 1: 변경 통계 출력**

Run:
```bash
cd /Users/youngseoklee/Desktop/workplace/hibye-plugins
git log feat/m2.5-stack-backend-ts-hono..HEAD --oneline | wc -l
git diff --stat feat/m2.5-stack-backend-ts-hono..HEAD plugins/stack-backend-ts/ | tail -3
```

- [ ] **Step 2: PR description 초안 작성 메모**

PR description 에 포함할 항목:
- AGENTS.md 1998 → ≤200 lines (가이드/index 전환)
- 78 SKILL.md framework/runtime split 완료
- Codex round 1 즉시 수정 5건 해결
- 신규 6 invariant skill 심화 (rate / log / cors / idempotency / secret / migration)
- DOMAIN_VOCAB CI 템플릿 + check-framework-vocab.sh 추가
- forbidden-scan 에 framework 어휘 영구 등록

---

## Self-Review

### 1. Spec coverage

| 요구사항 | Task |
|----------|------|
| 78 SKILL.md framework split + `<framework>` placeholder | Task 4.1 ~ 4.8 |
| AGENTS.md 가이드/index only (≤200 줄) | Task 1.1 + 1.5 + 4.8 |
| generator 도 link-list 모드 | Task 1.1 |
| 깨진 cross-link 제거 (Codex #1) | Task 2.1 |
| scope 본문 일반화 (Codex #2 — rule-linting) | Task 2.2 |
| middleware order SoT 통일 (Codex #3) | Task 2.3 |
| generator import-missing fatal (Codex #4) | Task 1.1 + 2.4 |
| rate limit sentinel 통일 (Codex #5) | Task 2.5 |
| 신규 6 invariant skill 심화 | Task 3.1 ~ 3.6 |
| DOMAIN_VOCAB 운영 템플릿 | Task 1.4 + 5.1 |
| dependency-scanning 확장 | Task 5.2 |

모든 spec 요구사항이 task 와 매핑됨. **48개 `apps/api` 일반화** 는 Phase 4 batch 안에 포함됨 (placeholder 치환 규칙 #12).

### 2. Placeholder scan

본 plan 의 모든 task 가 구체 명령 + 정확한 파일 path + 검증 명령 포함. "TBD" / "implement later" 등 placeholder 없음. 단, Phase 4 의 batch 들은 *51개 skill 의 모든 라인을 본문에 나열* 하지 않음 — 이는 의도된 것: 공통 치환 규칙 14개를 사전에 정의 (Phase 4 도입부) + 각 batch 에 사전 조사 step 으로 위치 파악 + 예시 1개 (single-writer) 제시. 작업자가 각 위치에서 규칙 적용 가능.

### 3. Type consistency

- placeholder 어휘는 Task 1.3 에서 정의 → 이후 모든 task 에서 동일 명사 사용
- `<api-app>`, `<framework>`, `<runtime>`, `<framework env binding>`, `<framework HTTP error class>`, `<framework SSE helper>`, `<framework json response>`, `<framework route definition>`, `<framework middleware registration>`, `<framework context store>`, `<framework request accessor>`, `<domain>`, `<DOMAIN>`, `<DOMAIN_VOCAB>` — 일관 사용 검증됨
- `rate_limited` sentinel (Task 2.5) 가 rate-limit-policy invariant envelope 와 일치 (Task 3.1 에서 동일 어휘 유지)
- `getSecret(name, version?)` (Task 3.5) / `verifySecret(token)` — secret-rotation 내 일관
- `migration_backfill_progress` (Task 3.6) — 단일 메트릭 명칭

### 4. 위험 / 트레이드오프

- **Phase 4 작업량**: 51 skill 의 framework 어휘 + 48 skill 의 apps/api 합쳐서 약 70개 skill 본문 수정. 각 batch 5-10개로 묶어도 batch 당 1-2 시간 소요 예상.
- **batch 분할 기준**: skill 카테고리 (invariant/workflow/audit) + 작업량 균형. 의존 link 가 batch 경계를 넘는 경우 (예: api-routing 의 middleware 순서 참조가 api-audit 에) 는 batch 순서 보정 필요 — 본 plan 은 invariant 먼저 (정의), workflow / audit 뒤 (참조) 순서로 batch 배치
- **iyaki-rebuild 측 변경**: 본 plan 은 plugin 만 수정. instance 측 CLAUDE.md 의 placeholder 매핑 표가 새 placeholder (`<framework SSE helper>` 등) 를 모두 커버하는지는 Task 6.2 에서 확인. 누락 시 별도 commit 필요.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-22-stack-backend-ts-framework-split-round2.md`.**
