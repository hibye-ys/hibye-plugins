# stack-backend-ts-hono → stack-backend-ts 일반화 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 백엔드 + 일반 TS 백엔드를 결합한 framework/runtime/도메인 무관 plugin 으로 추출. **Python plugin 의 `<domain>` placeholder 일반화 패턴 적용** — 도메인 결합 skill 은 본 plugin 안에 일반화 후 유지하고, *런타임 결합* + *CCv3/SillyTavern 같은 협소 도메인* 만 iyaki-rebuild 로 이전.

**Architecture:**
- 현재 `plugins/stack-backend-ts-hono/` (80 skill) 를 `plugins/stack-backend-ts/` 로 rename
- **8 이전** (runtime: workers/wrangler/d1 + narrow domain: data-governance)
- **5 일반화** (`<domain>` / `<workspace-entity>` placeholder, plugin 안 유지)
- **8 추상화** (Hono/Workers 코드 제거, plugin 안 유지)
- **6 신규** (rate-limit-policy / structured-log-schema / cors-policy / idempotency-key / secret-rotation / migration-rollback)
- 최종 **78 skill** (18 invariant + 39 workflow + 21 audit)
- iyaki-rebuild 측: 기존 1 + 이전 8 = **9 project-local skill**

**Reference:** `plugins/stack-backend-python/` 의 generalization pattern (특히 `data-audit/SKILL.md`, `backend-overview/references/subsystem-08.md` 의 `<domain>` 사용 예시).

**Tech Stack:** Markdown SKILL.md, bash scripts (acceptance-check / forbidden-scan / audit-all / generate-agents-md / link-cache), Claude Code plugin marketplace.

---

## 작업 분류 (사전 확정)

### A. 이전 (8) — `plugins/stack-backend-ts-hono/skills/` → `iyaki-rebuild/.claude/skills/`

| # | skill | role | 이전 사유 |
|---|---|---|---|
| 1 | workers-compat | invariant | Cloudflare Workers 런타임 결합 |
| 2 | verify-workers-compat | workflow | Workers 부정합 API 검출 |
| 3 | update-config-runtime | workflow | wrangler / .dev.vars 결합 |
| 4 | infra-audit | audit | wrangler.toml 필수 키 검증 |
| 5 | pre-deploy-check | workflow | wrangler deploy 6-step 체인 |
| 6 | runtime-verify | audit | wrangler 배포 직후 health 검증 |
| 7 | d1-forbidden-audit | audit | D1 binding 검출 (특정 DB 금지) |
| 8 | data-governance | workflow | CCv3 / SillyTavern Lorebook 협소 도메인 (placeholder 일반화 어색) |

### B. 일반화 (5) — `<domain>` / `<workspace-entity>` placeholder, plugin 안 유지

Python plugin 의 패턴 따름. 각 skill 의 *iyaki-specific* 어휘를 placeholder 로 치환. 본문 안 "이 instance 의 사례 = `<domain>`" 식 표기. Instance 측 (iyaki-rebuild) CLAUDE.md 에서 placeholder 해석 룰 명시 (예: "이 프로젝트의 `<domain>` = iyaki").

| # | skill | role | 일반화 대상 (iyaki-specific → placeholder) |
|---|---|---|---|
| 1 | app-domain-boundary | invariant | `ai_backend.*` / `public.*` 스키마는 유지 (DB schema 분리는 일반 패턴), `lock_project` 도 유지. **iyaki "writer/author/scenario/novel/character/persona" 어휘** → `<domain entity>` 일반화. entity 예시는 "blog post / order / message" 등 일반 사례로 |
| 2 | app-domain-boundary-audit | audit | 동일. grep 패턴의 도메인 어휘 (`writer\|author\|scenario...`) → `<DOMAIN_VOCAB>` placeholder + audit-all.sh 실행 시 instance 측이 envvar 로 정의 |
| 3 | media-pipeline-patterns | workflow | R2 / KV 같은 Cloudflare specifics 제거 (object storage 추상). 이미지/오디오/비디오 카테고리는 일반 backend 영역 — `<category>` 일반화 유지. iyaki 의 "scenario thumbnail" / "character voice" 같은 사례 제거 |
| 4 | media-job-lifecycle | invariant | 6-state machine + idempotency + stale-lease reaper 등은 이미 일반적. iyaki-specific (CATEGORY_CAPS 의 image=100/audio=200/video=50 같은 instance 값) → 예시로 표기, instance 측 override 가능 명시 |
| 5 | lsp-server | workflow | LSP 4-class 구조 (LSPManager / LSPRegistry / LSPInstance / LSPBridge) 는 일반 LSP 영역. **iyaki "prose 에디터 entity 자동완성 `@` trigger"** → `<workspace-entity>` placeholder + "예: blog 포스트의 mention, code 의 symbol, novel 의 character" 사례 |

### C. 추상화 (8) — Hono/Workers 코드 예제 제거, 본문은 framework-neutral

| # | skill | 유지 섹션 | 제거 섹션 |
|---|---|---|---|
| 1 | sse-streaming | 12 SSE 이벤트 집합, Heartbeat 원칙, Secret Scanner, HTTP 헤더 분리 원칙, 동시성 함정, 검증 체크리스트 | "streamSSE — Hono 핸들러 패턴" 전체, "Heartbeat (Workers 환경)" Workers-specific 부분 |
| 2 | sse-lifecycle | 12 이벤트 집합, Lifecycle 순서, 종료 보장 4 제약, 이벤트 카테고리, 변경 영향, 금지 사항 | "Hono SSE 구현 패턴" 전체 (코드 블록 포함) |
| 3 | api-routing | 최상위 prefix 규약, Route 그룹화, Leak-safe 404, HTTP 에러 변환 원칙, CORS exposeHeaders 규약, middleware 순서 주의, Routes 계층 원칙 | "Hono App + Middleware 등록" 전체, "Route 구현 패턴" 의 Hono 코드 블록 |
| 4 | auth | JWT 인증 원칙, 세션 스토어 원칙, Rate Limit 원칙, Scope 검증, 시크릿 누락 에러 처리 | "Workers 환경 시크릿 원칙", "wrangler.toml + .dev.vars" 전체, "JWT 인증 Middleware" Hono 코드, "세션 스토어 (KV 기반)" KV 특화, "Rate Limit Middleware" Hono 코드, "c.env undefined 디버깅" |
| 5 | http-error-sentinels | 에러 응답 envelope shape, 내부 예외 → HTTP 매핑 매트릭스, Route-edge sentinel 매트릭스, Leak-safe 404 원칙, Tombstone 410, scrubText, CORS expose_headers 7종, 공통 금지 | "Hono 에러 핸들링 패턴" 전체 |
| 6 | error-handling | 4 표준 패턴, 예외 계층, Tool 에러 패턴, Tool result 절단 패턴, Structured Logging, SSE 에러 이벤트 원칙, 금지 사항, 검증 체크리스트 | "전역 onError 핸들러 (Pattern 1)" Hono 코드, "HTTPException throw 패턴 (라우트 내)" 전체 |
| 7 | database | "TS DB 선택 가이드" 일반화 (Postgres / MySQL / SQLite + Drizzle / Kysely / Prisma 비교), KV vs DB 분리 원칙, 트랜잭션 일관성 원칙, Port 추가 원칙, 영향도, 금지 사항 (일반화) | "현재 상태 (Workers 스택)", Neon/D1/Drizzle 구체 코드 모두 |
| 8 | dependency-scanning | 패턴 1 (npm/pnpm audit CVE), 통과 기준, 위반 시 조치, audit 이 커버하지 않는 것 | 패턴 2 (Node built-in 직접 import — Workers-incompat) |

### D. 신규 6 — generic invariant/workflow

1. `rate-limit-policy` (invariant)
2. `structured-log-schema` (invariant)
3. `cors-policy` (invariant)
4. `idempotency-key` (workflow)
5. `secret-rotation` (workflow)
6. `migration-rollback` (workflow)

(상세 본문은 Phase 4 참조)

### E. 그대로 유지 (59 = 80 - 8 이전 - 5 일반화 - 8 추상화)

**AI invariant (10):** provider-retry-matrix, token-budget-constants, compaction-thresholds, mcp-namespace, run-policy-presets, spawn-limits, tool-sort-order, agent-loop-invariants, input-safety-gate-ordering, single-writer

**meta invariant (1):** architecture-invariants

**AI workflow (15):** agent-loop, ai-agent-patterns, provider-layer, provider-scaffold, provider-catalog-sync, tool-system, mcp-integration, compaction, context-assembly, sub-agent, usage-tracking, new-agent, new-run, codex-commands, codex-subagents

**audit (19):** provider-retry-audit, sse-lifecycle-audit, single-writer-audit, token-budget-audit, tool-sort-order-audit, input-safety-audit, mcp-namespace-audit, compaction-thresholds-audit, http-error-sentinels-audit, run-policy-presets-audit, spawn-limits-audit, agent-verify-def, api-audit, data-audit, full-architecture-audit, loop-audit, session-audit, security-audit-check, rule-linting

**일반 TS workflow (14):** coding-standards, commit-rules, design-principles, data-layer, testing-infra, test-scaffold, test-cleanup, red-green-fix, debug-session, performance-profiling, incident-triage, security-runtime, backend-overview, ts-agent-rules

합: 10 + 1 + 15 + 19 + 14 = **59** ✓

### F. 메타 갱신
- `CLAUDE.md` invariant catalog (16 → 18, +rate-limit-policy / structured-log-schema / cors-policy 추가, workers-compat 만 제거)
- `architecture-invariants` / `ts-agent-rules` / `backend-overview` 카운트 정정 + 일반화
- `AGENTS.md` 자동 generator + 재생성
- `.codex-plugin/plugin.json` 갱신
- `scripts/forbidden-terms.txt` iyaki 도메인 어휘 제거
- `scripts/audit-all.sh` 이전된 3 audit 블록 제거 (infra-audit / runtime-verify / d1-forbidden-audit), app-domain-boundary 블록은 placeholder 일반화
- 루트 `.claude-plugin/marketplace.json` 의 plugin entry 갱신
- **iyaki-rebuild 측 CLAUDE.md 에 placeholder 해석 룰 추가** (`<domain>` = iyaki, `<workspace-entity>` = "prose-editor entity" 등)

### G. 파일/캐시 운영
- `plugins/stack-backend-ts-hono/` → `plugins/stack-backend-ts/` (git mv)
- `~/.claude/plugins/cache/hibye-plugins/stack-backend-ts-hono/` 캐시 cleanup + `link-cache.sh` 재실행

---

## 최종 카운트 (목표)

| 영역 | 현재 | 변화 | 최종 |
|---|---|---|---|
| invariant | 16 | -1 (workers-compat 이전) +3 (rate-limit/log-schema/cors) | **18** |
| workflow | 40 | -4 (verify-workers-compat, update-config-runtime, pre-deploy-check, data-governance) +3 (idempotency-key, secret-rotation, migration-rollback) | **39** |
| audit | 24 | -3 (infra-audit, runtime-verify, d1-forbidden-audit) | **21** |
| **plugin 합** | **80** | | **78** |
| iyaki project skills | 1 | +8 (이전) | **9** |

---

## Placeholder 규약

본 plan + 일반화된 SKILL.md 들이 사용하는 placeholder 표기 규약:

| placeholder | 의미 | instance 측 해석 예시 |
|---|---|---|
| `<domain>` | 외부 application 도메인 이름 (소문자, 식별자) | `iyaki`, `blog`, `ecommerce` |
| `<DOMAIN>` | env var 명에 쓰는 대문자 도메인 | `IYAKI_DATABASE_URL`, `BLOG_DATABASE_URL` |
| `<domain entity>` | 도메인 엔티티 어휘 (텍스트 예시) | "scenario / novel / character", "post / category / tag" |
| `<DOMAIN_VOCAB>` | audit grep 의 도메인 어휘 정규식 (env override 가능) | `writer\|author\|scenario\|novel\|character\|persona` |
| `<category>` | 미디어 카테고리 분류 | `image`, `audio`, `video` (각 instance 별 동일/추가 가능) |
| `<workspace-entity>` | LSP 자동완성 trigger 의 entity 종류 | "prose-editor character mention", "code symbol", "blog mention" |

Instance 측 (iyaki-rebuild) CLAUDE.md 에 해석 룰 명시. `<domain>` 같은 placeholder 가 실제 사용 시 검색/grep 으로 instance 측 정의를 찾을 수 있어야 함.

---

## Phase 0: 워크트리 격리 + 사전 점검

### Task 0.1: 격리 워크트리 생성

- [ ] **Step 1: 워크트리 생성**

```bash
cd /Users/youngseoklee/Desktop/workplace/hibye-plugins
git worktree add ../hibye-plugins-ts-rename feat/stack-backend-ts-rename
cd ../hibye-plugins-ts-rename
```

- [ ] **Step 2: baseline acceptance-check 통과 확인**

```bash
bash plugins/stack-backend-ts-hono/scripts/acceptance-check.sh
```
Expected: `=== acceptance-check: 80 skills checked, 0 failures ===`

- [ ] **Step 3: baseline forbidden-scan 통과 확인**

```bash
bash plugins/stack-backend-ts-hono/scripts/forbidden-scan.sh
```
Expected: `✓ forbidden-scan: 0 matches`

### Task 0.2: iyaki-rebuild 측 git 상태 검증

- [ ] **Step 1: `.gitignore` 가 `.claude/skills/` 를 ignore 안 하는지 확인**

```bash
grep -nE "\.claude/skills|^\.claude/?$" /Users/youngseoklee/Desktop/workplace/iyaki-rebuild/.gitignore
```
Expected: 매치 0 (또는 `.claude/plugins/` / `.claude/settings.local.json` / `.claude/worktrees/` 같은 *세부* 경로만)

- [ ] **Step 2: working tree clean 확인**

```bash
cd /Users/youngseoklee/Desktop/workplace/iyaki-rebuild && git status --short
```
Expected: 출력 없음. dirty 면 plan 중단 + 사용자 확인.

---

## Phase 1: 이전 (8 skill → iyaki-rebuild)

### Task 1.1: 8 skill 디렉토리 이동

- [ ] **Step 1: mv 실행**

```bash
SRC=/Users/youngseoklee/Desktop/workplace/hibye-plugins-ts-rename/plugins/stack-backend-ts-hono/skills
DST=/Users/youngseoklee/Desktop/workplace/iyaki-rebuild/.claude/skills

for skill in workers-compat verify-workers-compat update-config-runtime infra-audit pre-deploy-check runtime-verify d1-forbidden-audit data-governance; do
  mv "$SRC/$skill" "$DST/$skill"
done
ls "$DST" | wc -l
```
Expected: `9` (product-planning + 8 이전)

- [ ] **Step 2: 이전된 skill 의 plugin self-reference 정정**

```bash
cd /Users/youngseoklee/Desktop/workplace/iyaki-rebuild/.claude/skills
rg -nP "plugins/stack-backend-ts-hono|plugins/stack-backend-ts\b" workers-compat verify-workers-compat update-config-runtime infra-audit pre-deploy-check runtime-verify d1-forbidden-audit data-governance || echo "no matches"
```

출력된 매치에 변환 룰 적용:

| 원본 패턴 | 변환 |
|---|---|
| `plugins/stack-backend-ts-hono/skills/<moved-skill>` | `.claude/skills/<moved-skill>` (sibling 참조) |
| `plugins/stack-backend-ts-hono/skills/<kept-or-generalized-skill>` | `[[<skill>]]` (plugin 측 SoT cross-link) |
| `plugins/stack-backend-ts-hono/scripts/audit-all.sh` | "instance 측 audit script 로 운영" 문구로 일반화 |
| `plugins/stack-backend-ts-hono/rules/...` | 제거 (rules/ 폐지됨) |

- [ ] **Step 3: commit (양쪽 repo)**

```bash
cd /Users/youngseoklee/Desktop/workplace/iyaki-rebuild
git add .claude/skills/
git commit -m "feat: import 8 runtime/narrow-domain skills from stack-backend-ts-hono (Workers/wrangler/d1/CCv3)"

cd /Users/youngseoklee/Desktop/workplace/hibye-plugins-ts-rename
git add -u plugins/stack-backend-ts-hono/skills/
git commit -m "refactor(stack-backend-ts-hono): extract 8 coupled skills to iyaki-rebuild (Workers runtime + wrangler + d1 + data-governance)"
```

### Task 1.2: `rules/` 디렉토리 폐지

- [ ] **Step 1: rules/ 삭제 + CLAUDE.md 의 `@./rules/` 참조 제거**

```bash
cd /Users/youngseoklee/Desktop/workplace/hibye-plugins-ts-rename/plugins/stack-backend-ts-hono
git rm -r rules/
```

`CLAUDE.md` 의 다음 2줄 제거:
```
## 백엔드 영역 룰
@./rules/hono-workers-compat.md
```

- [ ] **Step 2: commit**

```bash
git add -u
git commit -m "refactor(stack-backend-ts-hono): drop rules/ (workers-compat moved to iyaki-rebuild)"
```

---

## Phase 2: 일반화 (5 skill — `<domain>` placeholder 치환)

각 task 는 iyaki-specific 어휘를 plan 의 placeholder 규약에 따라 치환. Python plugin 의 `data-audit/SKILL.md` 의 §8 "외부 도메인 경계 (이 instance = `<domain>`)" 섹션 패턴 참조.

### Task 2.1: `app-domain-boundary` invariant 일반화

**Files:** Modify `plugins/stack-backend-ts-hono/skills/app-domain-boundary/SKILL.md`

| 현재 어휘 | 일반화 |
|---|---|
| iyaki 도메인 어휘 (`writer`, `author`, `scenario`, `novel`, `character`, `persona`) | `<domain entity>` (예시 절에서 "예: blog post / order / message" 등 일반 사례 동시 표기) |
| `ai_backend.<domain>_mutations` | 유지 (Python plugin 패턴 — `<domain>` placeholder 형태로 명시) |
| `lockProject(projectId)` | 함수명 유지 (일반 advisory lock 패턴) |
| `DOMAIN_DATABASE_URL` | 유지 (Python plugin 의 `<DOMAIN>_DATABASE_URL` 과 동일 패턴 — 본 SKILL.md 안에서 `<DOMAIN>_DATABASE_URL` 표기 권장) |
| 헤더 "## 핵심 원칙" 의 "도메인 엔티티 ground truth 는 웹서비스 소유" | 그대로 (이미 일반화) |

추가 섹션:
```markdown
## Placeholder 해석

본 invariant 의 `<domain>` / `<DOMAIN>` / `<domain entity>` placeholder 는 instance 측에서 해석:
- iyaki 프로젝트: `<domain>` = `iyaki`, `<domain entity>` = "scenario / novel / character / persona" 등
- 다른 instance: 자체 CLAUDE.md 에 매핑 명시
```

- [ ] **Step 1: 본문 read**
- [ ] **Step 2: 위 표대로 치환 + Placeholder 해석 섹션 추가**
- [ ] **Step 3: description frontmatter 도 "ai_backend (`<domain>` 웹서비스)" 형태로 갱신**
- [ ] **Step 4: 검증 + commit**

```bash
bash plugins/stack-backend-ts-hono/scripts/acceptance-check.sh
bash plugins/stack-backend-ts-hono/scripts/forbidden-scan.sh
git add -u && git commit -m "refactor(app-domain-boundary): generalize iyaki-specific vocab to <domain> placeholder"
```

### Task 2.2: `app-domain-boundary-audit` 일반화

**Files:** Modify `plugins/stack-backend-ts-hono/skills/app-domain-boundary-audit/SKILL.md`

| 현재 | 일반화 |
|---|---|
| grep 패턴 `\b(writer\|author\|scenario\|novel\|character\|persona)\b` | `\b(${DOMAIN_VOCAB})\b` 환경변수 — instance 측 audit-all.sh 에서 `DOMAIN_VOCAB="writer\|author\|..."` 정의 후 호출 |
| SKILL.md 본문의 도메인 어휘 예시 | "예: iyaki = writer/author/scenario/...; blog = post/comment/tag" 식 다중 사례 |

또한 본 plugin 의 `scripts/audit-all.sh` 의 12번 블록 갱신:
```bash
# 12. app-domain-boundary-audit (envvar 기반, instance 측 정의)
if [[ -n "${DOMAIN_VOCAB:-}" ]]; then
  for dir in src/ai src/sse src/storage src/middleware; do
    [[ -d "$dir" ]] && run_audit "app-domain-boundary-$dir" "\\b(${DOMAIN_VOCAB})\\b" "$dir"
  done
else
  echo "SKIP [app-domain-boundary]: DOMAIN_VOCAB envvar 미정의 — instance 측에서 export 필요"
fi
```

- [ ] **Step 1: SKILL.md 본문 일반화**
- [ ] **Step 2: scripts/audit-all.sh 12번 블록 envvar 기반으로 수정**
- [ ] **Step 3: 검증 + commit**

```bash
git add -u && git commit -m "refactor(app-domain-boundary-audit): generalize grep pattern to \${DOMAIN_VOCAB} envvar (instance-defined)"
```

### Task 2.3: `media-pipeline-patterns` workflow 일반화

**Files:** Modify `plugins/stack-backend-ts-hono/skills/media-pipeline-patterns/SKILL.md`

| 현재 | 일반화 |
|---|---|
| R2 / KV / Workers 어휘 | 추상 "object storage" / "key-value cache" / runtime-neutral (단 invariant 의 *대안 매체* 비교 표는 일반화 유지) |
| iyaki "scenario thumbnail" / "character voice" 같은 사례 | 일반 사례 ("user-uploaded image", "TTS audio", "user-uploaded video") |
| `apps/api/src/services/media/` 경로 | `src/media/` 일반화 |

미디어 카테고리 (image / audio / video) 자체는 일반 backend 영역이므로 유지.

- [ ] **Step 1-3: 본문 일반화 + 검증 + commit**

```bash
git add -u && git commit -m "refactor(media-pipeline-patterns): abstract R2/KV to object storage/cache, generalize iyaki examples"
```

### Task 2.4: `media-job-lifecycle` invariant 일반화

**Files:** Modify `plugins/stack-backend-ts-hono/skills/media-job-lifecycle/SKILL.md`

이미 거의 일반적임 — Invariant 1~4, 6-state machine, retry classification, stale-lease reaper 등 모두 일반 backend 영역.

| 현재 | 일반화 |
|---|---|
| `CATEGORY_CAPS = { image: 100, audio: 200, video: 50 }` | "예시 값. 구체 값은 instance 별로 결정 — 본 plugin 의 권장값은 image=100/audio=200/video=50" |
| `CATEGORY_CONCURRENCY = { image: 2, audio: 3, video: 1 }` | 동일하게 "예시" 마커 |
| iyaki 특화 op 이름 (`image.generate` 등) | 일반 표기 (이미 일반적) |

추가:
```markdown
## Instance 별 override

본 invariant 의 핵심 상수 (STALE_MS / MAX_ATTEMPTS / CATEGORY_CAPS / CATEGORY_CONCURRENCY) 의 *권장값* 은 본 plugin 에 명시. Instance 별로 부하 / SLA 에 따라 다른 값 사용 가능 — 변경 시 본 invariant 참조 + instance 측 코드에 *명시적 override* 표시.
```

- [ ] **Step 1-3: 본문 일반화 + 검증 + commit**

```bash
git add -u && git commit -m "refactor(media-job-lifecycle): mark CATEGORY_CAPS/CONCURRENCY as recommended-with-override, generalize examples"
```

### Task 2.5: `lsp-server` workflow 일반화

**Files:** Modify `plugins/stack-backend-ts-hono/skills/lsp-server/SKILL.md`

| 현재 | 일반화 |
|---|---|
| "prose 에디터 entity 자동완성" | `<workspace-entity>` 자동완성 (예: prose-editor mention, code symbol, blog tag) |
| `@` trigger character | "instance 별 trigger character (예: `@` for mention, `#` for tag)" |
| `invalidateEntityCache()` | 함수명 유지 (일반 LSP 패턴) |
| iyaki "character / scenario" entity 예시 | 일반 entity 사례 ("user mentions / file references / tags") |
| LSP 4-class (`LSPManager` / `LSPRegistry` / `LSPInstance` / `LSPBridge`) | 그대로 (일반 LSP 패턴) |

description frontmatter 도 갱신: "prose 에디터 언어 지능" → "workspace-entity 언어 지능 (예: prose editor / code editor / blog mention)".

- [ ] **Step 1-3: 본문 일반화 + 검증 + commit**

```bash
git add -u && git commit -m "refactor(lsp-server): generalize 'prose editor entity' to <workspace-entity> with examples"
```

---

## Phase 3: 추상화 (8 skill — Hono/Workers 코드 제거)

(전 Plan 의 Phase 2 와 동일. 8 task 의 유지/제거 표는 위 작업 분류 C 참조.)

각 task 의 step:
1. SKILL.md read
2. 유지/제거 표대로 섹션 단위 편집
3. 검증 (acceptance-check + forbidden-scan)
4. commit

### Task 3.1: `sse-streaming` 추상화

| 유지 | 제거 |
|---|---|
| 12 SSE 이벤트 집합, Heartbeat 원칙, Secret Scanner, HTTP 헤더 분리 원칙, 동시성 함정, 검증 체크리스트, 구현 중 막히면 | "streamSSE — Hono 핸들러 패턴" 섹션 전체, "Heartbeat (Workers 환경)" Workers-specific code (`waitUntil` 등), 코드 블록 전체 |

- [ ] **Step 1-3**: 편집 → 검증 → commit

```bash
git add -u && git commit -m "refactor(sse-streaming): remove Hono streamSSE code, abstract Heartbeat to framework-neutral"
```

### Task 3.2: `sse-lifecycle` 추상화

| 유지 | 제거 |
|---|---|
| 12 이벤트, Lifecycle 순서, 종료 보장 4 제약, 이벤트 카테고리, 변경 영향, 금지 사항 | "Hono SSE 구현 패턴" 전체, "subprocess 분리는 Workers 환경에서 불가" 문구, `c.executionCtx.waitUntil` 구체 표현 |

대체 문구: `"백그라운드 태스크 스케줄링은 런타임 특화 (Node setImmediate / Workers waitUntil / Bun 등)"`

```bash
git add -u && git commit -m "refactor(sse-lifecycle): drop Hono code example, keep 12-event invariant"
```

### Task 3.3: `api-routing` 추상화

| 유지 | 제거 |
|---|---|
| 최상위 prefix, Route 그룹화, Leak-safe 404, HTTP 에러 변환 원칙, CORS exposeHeaders, middleware 순서, Routes 계층 | "Hono App + Middleware 등록" 섹션 전체, Hono code 블록 |

```bash
git add -u && git commit -m "refactor(api-routing): generalize from Hono — keep routing principles, drop framework code"
```

### Task 3.4: `auth` 추상화

| 유지 | 제거 |
|---|---|
| JWT 인증 원칙, 세션 스토어 원칙 ([[secret-rotation]] cross-link), Rate Limit 원칙 ([[rate-limit-policy]] cross-link), Scope 검증, 시크릿 누락 에러 처리, 검증 체크리스트 | "Workers 환경 시크릿 원칙", "wrangler.toml + .dev.vars" 전체, JWT/세션/Rate Limit middleware 의 Hono 코드, "c.env undefined 디버깅" |

```bash
git add -u && git commit -m "refactor(auth): generalize auth middleware principles, link to rate-limit-policy + secret-rotation"
```

### Task 3.5: `http-error-sentinels` 추상화

| 유지 | 제거 |
|---|---|
| 에러 응답 envelope shape, 내부 예외 → HTTP 매핑, Route-edge sentinel, Leak-safe 404, Tombstone 410, scrubText, CORS expose_headers 7종, 금지 사항 | "Hono 에러 핸들링 패턴" 섹션 전체 (HTTPException, throwSentinelError, app.onError 코드) |

```bash
git add -u && git commit -m "refactor(http-error-sentinels): drop Hono code, keep envelope + sentinel matrix"
```

### Task 3.6: `error-handling` 추상화

| 유지 | 제거 |
|---|---|
| 4 표준 패턴, 예외 계층, Tool 에러 패턴 (Pattern 2), Tool result 절단, Structured Logging ([[structured-log-schema]] cross-link), 금지 사항, 검증 체크리스트 | "전역 onError 핸들러 (Pattern 1)" Hono 코드, "HTTPException throw 패턴 (라우트 내)" 섹션 전체, "SSE 에러 이벤트" Hono code |

```bash
git add -u && git commit -m "refactor(error-handling): drop Hono onError/HTTPException code, link to structured-log-schema"
```

### Task 3.7: `database` 일반화

| 유지 | 제거 | 추가 |
|---|---|---|
| KV vs DB 분리 원칙, 트랜잭션 일관성, Port 추가 원칙, 영향도, 금지 사항 (일반화) | "현재 상태 (Workers 스택)", "Neon serverless 연결" Neon 코드, "Drizzle 스키마/Kit migration" 구체 코드, "환경변수 (c.env)" 전체, "금지 DB 목록 (spec §1.2)" Workers-specific | "TS DB 선택 매트릭스" (Postgres/MySQL/SQLite + Neon/Supabase/PlanetScale/RDS), "ORM 선택 매트릭스" (Drizzle/Kysely/Prisma trade-off), "Runtime 호환성 고려사항" (Node/Workers/Bun driver 선택 원칙), [[migration-rollback]] cross-link |

```bash
git add -u && git commit -m "refactor(database): generalize from Neon/D1/Drizzle specifics to TS DB+ORM selection guide"
```

### Task 3.8: `dependency-scanning` 추상화

| 유지 | 제거 |
|---|---|
| 패턴 1 (npm/pnpm audit CVE), 통과 기준, 위반 시 조치 패턴 1, audit 이 커버하지 않는 것 | 패턴 2 (Node built-in 검출 — Workers-incompat 관련 모두), description 의 "Workers 호환" 부분 |

```bash
git add -u && git commit -m "refactor(dependency-scanning): drop Workers-incompat detection, keep CVE audit"
```

---

## Phase 4: 신규 6 skill 작성

(전 plan 의 Phase 3 와 동일. SKILL.md 전체 본문은 이전 plan version 의 Task 3.1–3.6 참조.)

### Task 4.1: `rate-limit-policy` (invariant)

**Files:** Create `plugins/stack-backend-ts-hono/skills/rate-limit-policy/SKILL.md`

본문 (요약):
- frontmatter: `name`, `description` (per-user/IP/endpoint 3-axis), `metadata: { role: invariant, scope: project, source: stack-backend-ts/skills/rate-limit-policy }`
- 3-axis 기본 표 (per-user 60/min, per-IP 30/min, per-endpoint 1000/min)
- 429 envelope ([[http-error-sentinels]] 참조)
- 알고리즘 매트릭스 (token bucket / fixed window / sliding log / sliding window counter)
- 저장 옵션 (메모리 / Redis / KV / DB)
- 공통 금지 (raw secret 키 / Retry-After 누락 / user-controllable bypass / counter 노출 / single-instance memory)

```bash
git add plugins/stack-backend-ts-hono/skills/rate-limit-policy/
git commit -m "feat(stack-backend-ts): add rate-limit-policy invariant"
```

### Task 4.2: `structured-log-schema` (invariant)

본문 (요약):
- 10 trace 필드 (request_id, trace_id, span_id, session_id, user_id, run_name, agent, model, turn_count, spawn_depth) — [[agent-loop-invariants]] 와 정합
- Log level 매트릭스 (debug/info/warn/error/critical)
- 메시지 명명 규약 (`<subsystem>.<event>` snake_case)
- scrub 의무 ([[http-error-sentinels]] scrubText 참조)
- 공통 금지 (raw secret / log injection / ad-hoc field / unthrottled critical / 중복 emit)

```bash
git add plugins/stack-backend-ts-hono/skills/structured-log-schema/
git commit -m "feat(stack-backend-ts): add structured-log-schema invariant"
```

### Task 4.3: `cors-policy` (invariant)

본문 (요약):
- 5 헤더 매트릭스 (Allow-Origin / Allow-Credentials / Allow-Methods / Allow-Headers / Expose-Headers)
- Preflight 캐시 (Max-Age 24h~1d)
- `Vary: Origin` 필수
- expose_headers FE contract (본 plugin 의 [[http-error-sentinels]] 의 7종 포함)
- 공통 금지 (wildcard + credentials / Origin reflect / 무조건 credentials true / Vary 누락 / preflight body)

```bash
git add plugins/stack-backend-ts-hono/skills/cors-policy/
git commit -m "feat(stack-backend-ts): add cors-policy invariant"
```

### Task 4.4: `idempotency-key` (workflow)

본문 (요약):
- 헤더 contract (`Idempotency-Key: <uuid>`, POST/PATCH/DELETE, TTL 24h)
- 처리 절차 4 단계 (lookup → handler+save → replay → 422 conflict)
- 응답 헤더 (`Idempotency-Replayed: true`)
- 저장 schema (key/body_hash/response/expires_at)
- 공통 금지 (key 없는 POST silent / 충돌 시 silent / stale replay / user-controllable short key / single-instance memory)

```bash
git add plugins/stack-backend-ts-hono/skills/idempotency-key/
git commit -m "feat(stack-backend-ts): add idempotency-key workflow"
```

### Task 4.5: `secret-rotation` (workflow)

본문 (요약):
- 정상 회전 6단계 (key 생성 → ENV 추가 → verify dual → sign 신규 → 모니터링 → 이전 key 제거)
- dual-key window 권장 24h~7d
- 응급 회전 절차 (window skip, audit log critical level — [[structured-log-schema]] cross-link)
- 회전 대상 목록 (ENV / secret store / CI/CD / 운영 문서)
- 공통 금지 (단일 key 직 교체 / git history 잔존 / audit 누락 / window 없는 verify / silent rotation)

```bash
git add plugins/stack-backend-ts-hono/skills/secret-rotation/
git commit -m "feat(stack-backend-ts): add secret-rotation workflow"
```

### Task 4.6: `migration-rollback` (workflow)

본문 (요약):
- forward-only vs reversible 매트릭스
- Blue/Green 6단계 (add nullable → deploy → backfill → constraint → read-remove → drop)
- Rollback 절차 (사고 인지 → 백업 확인 → forward fix vs PITR 결정 → 실행)
- 공통 금지 (검토 없는 destructive / backup 미확인 / boot 시 자동 migrate / mtime 순서 / 절차 미문서화 / single-tx backfill)

```bash
git add plugins/stack-backend-ts-hono/skills/migration-rollback/
git commit -m "feat(stack-backend-ts): add migration-rollback workflow"
```

---

## Phase 5: Plugin rename + manifest 갱신

### Task 5.1: 디렉토리 rename + manifest

- [ ] **Step 1: git mv**

```bash
cd /Users/youngseoklee/Desktop/workplace/hibye-plugins-ts-rename
git mv plugins/stack-backend-ts-hono plugins/stack-backend-ts
```

- [ ] **Step 2: `.claude-plugin/plugin.json`**

```json
{
  "name": "stack-backend-ts",
  "version": "0.0.1",
  "description": "TypeScript backend rules — AI agent + general backend, framework/runtime neutral (domain-coupled via <domain> placeholder).",
  "author": { "name": "hibye-ys" },
  "license": "MIT",
  "keywords": ["typescript", "backend", "ai-agent", "agent-skills"]
}
```

- [ ] **Step 3: `.codex-plugin/plugin.json`** (전체 replace)

```json
{
  "name": "stack-backend-ts",
  "version": "0.0.1",
  "description": "TypeScript backend rules — AI agent + general backend, framework/runtime neutral.",
  "skills": "./skills/",
  "interface": {
    "displayName": "Stack: Backend TS",
    "shortDescription": "AI agent + general TS backend rules — framework/runtime neutral.",
    "capabilities": ["Interactive", "Read", "Write"],
    "category": "Coding",
    "brandColor": "#FF6F00",
    "composerIcon": "./assets/icon.svg"
  }
}
```

- [ ] **Step 4: 루트 marketplace.json 의 entry**

```json
{
  "name": "stack-backend-ts",
  "description": "TypeScript backend rules — AI agent + general backend, framework/runtime neutral (domain-coupled via <domain> placeholder).",
  "category": "development",
  "source": "./plugins/stack-backend-ts",
  "version": "0.0.1"
}
```

- [ ] **Step 5: commit**

```bash
git add -u
git commit -m "refactor: rename stack-backend-ts-hono → stack-backend-ts"
```

### Task 5.2: 캐시 심볼릭 링크 갱신

- [ ] **Step 1: 기존 캐시 제거**
```bash
rm -rf ~/.claude/plugins/cache/hibye-plugins/stack-backend-ts-hono
```

- [ ] **Step 2: link-cache.sh 실행** (Phase 7 의 merge 이후 실행 권장)
```bash
bash /Users/youngseoklee/Desktop/workplace/hibye-plugins/scripts/link-cache.sh
ls -la ~/.claude/plugins/cache/hibye-plugins/
```
Expected: `stack-backend-ts/` 링크 존재, `stack-backend-ts-hono/` 없음

---

## Phase 6: 메타 갱신

### Task 6.1: `CLAUDE.md` 전면 갱신

- [ ] **Step 1: 본 plugin CLAUDE.md replace**

```markdown
# stack-backend-ts

TypeScript backend (AI agent + 일반 백엔드) 룰. Framework/runtime 무관 — Hono / Express / Fastify / Node / Workers / Bun 등 어디서든 사용. 도메인 결합은 `<domain>` placeholder 로 표기 (instance 측 CLAUDE.md 에서 해석).

## 상시 적용 invariant 18개

> Claude Code 가 plugin install 후 fresh 세션 시작 시 다음 invariant 본문이 *상시 노출*.

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

---

## workflow 39개 (on-demand, description trigger)

### AI core (15)
agent-loop, ai-agent-patterns, provider-layer, provider-scaffold, provider-catalog-sync, tool-system, mcp-integration, compaction, context-assembly, sub-agent, usage-tracking, new-agent, new-run, codex-commands, codex-subagents

### 일반 TS 백엔드 (15)
backend-overview, api-routing, sse-streaming, auth, error-handling, database, data-layer, coding-standards, commit-rules, design-principles, security-runtime, testing-infra, test-scaffold, test-cleanup, lsp-server

### 미디어 (1)
media-pipeline-patterns

### 디버깅 / 운영 (5)
debug-session, red-green-fix, performance-profiling, incident-triage, ts-agent-rules

### 신규 generic (3)
idempotency-key, secret-rotation, migration-rollback

## audit 21개 (on-demand, 변경 후 검증)

### invariant 직접 매핑 (10)
provider-retry-audit, sse-lifecycle-audit, single-writer-audit, token-budget-audit, tool-sort-order-audit, input-safety-audit, mcp-namespace-audit, compaction-thresholds-audit, http-error-sentinels-audit, run-policy-presets-audit

### M2.5 audit (11)
spawn-limits-audit, agent-verify-def, api-audit, data-audit, full-architecture-audit, loop-audit, session-audit, security-audit-check, rule-linting, dependency-scanning, app-domain-boundary-audit
```

- [ ] **Step 2: commit**

```bash
git add -u
git commit -m "docs(stack-backend-ts): rewrite CLAUDE.md catalog — 18 invariant + 39 workflow + 21 audit"
```

### Task 6.2: 메타-라우터 3종 갱신

- [ ] **Step 1: `architecture-invariants/SKILL.md`**
  - "16 invariant" → "18 invariant"
  - 표 row: workers-compat 제거, rate-limit-policy / structured-log-schema / cors-policy 추가
  - 검증 체크리스트 정규식 18개로 갱신

- [ ] **Step 2: `ts-agent-rules/SKILL.md`**
  - description: "13 audit" → "21 audit", "22+8 workflow" → "39 workflow"
  - 본문 표: "(architecture-invariants 메타 포함) 16 → 18", "audit | 13 → 21", "기타 | 1 (verify-workers-compat) 줄 제거"
  - "카탈로그 구조 (50 SKILL.md)" → "78 SKILL.md"
  - "자주 묶이는 룰 묶음" 표: "배포 전" row 의 pre-deploy-check 참조 제거, audit 카운트 13 → 21

- [ ] **Step 3: `backend-overview/SKILL.md`**
  - "apps/api" 어휘 → "TS 백엔드" 일반화
  - 디렉토리 구조 예시 일반화 (특정 framework 명시 금지)
  - 이전된 8 skill 참조 제거 (workers-compat / wrangler-related / data-governance)

- [ ] **Step 4: commit**

```bash
git add -u
git commit -m "docs(stack-backend-ts): fix count drift in 3 meta-router skills (18 inv / 39 wf / 21 audit / 78 total)"
```

### Task 6.3: `audit-all.sh` 정리

- [ ] **Step 1: 3 audit 블록 제거 (이전된 것만)**

대상:
- 13번: `d1-forbidden-audit` 블록 (이전됨)
- 18번: `infra-audit` 블록 (이전됨)
- 24번: `runtime-verify` 블록 (이전됨)

12번 (`app-domain-boundary`) 블록은 **유지하되 envvar 기반으로 수정** (Task 2.2 Step 2 에서 처리).

상단 주석의 카탈로그 갱신:
- "24 audit:" → "21 audit:"
- 기존 13 audit 리스트에서 `d1-forbidden` 제거 (남는 12)
- 신규 11 audit 리스트에서 `infra` / `runtime-verify` 제거 (남는 9)
- 합 = 12 + 9 = 21 ✓

- [ ] **Step 2: commit**

```bash
git add -u
git commit -m "refactor(scripts): drop 3 moved audits from audit-all.sh (d1-forbidden / infra / runtime-verify)"
```

### Task 6.4: `forbidden-terms.txt` 정리

- [ ] **Step 1: 본 plugin 의 forbidden-terms.txt replace**

```
# forbidden-terms.txt — stack-backend-ts 정본
#
# 위치 = plugin scripts 옆 (forbidden-scan.sh 가 자기-포함 default 로 참조).
# 갱신 시 본 파일 한 곳만 수정.
#
# rg -nP -f 로 적용. 한 줄 한 패턴. 빈 줄/`#` 시작 = 무시.

# === 본 plugin 자체 메타 일관성 룰만 ===
# 도메인 어휘는 <domain> placeholder 패턴 — 본문에 직접 도메인 명 사용 금지.
# (instance 측 forbidden-terms 에서 별도 어휘 강제 가능)
#
# instance-specific 도메인 명 잔존 검출:
\biyaki\b
\biyaki-zip-ai\b
\biyaki-zip-prototype\b
```

- [ ] **Step 2: forbidden-scan 통과 확인**

```bash
bash plugins/stack-backend-ts/scripts/forbidden-scan.sh
```
Expected: `✓ forbidden-scan: 0 matches`

(일반화 후 본 plugin 안 iyaki 직접 언급은 0이어야 함 — 모두 `<domain>` placeholder + "예: iyaki" 식 표기)

- [ ] **Step 3: commit**

```bash
git add -u
git commit -m "refactor(scripts): forbidden-terms enforces <domain> placeholder pattern (catch iyaki residue)"
```

### Task 6.5: `AGENTS.md` generator + 재생성

(전 plan 의 Task 5.5 와 동일 — generator 스크립트 작성, `--check` 모드, acceptance-check 통합)

- [ ] **Step 1: `scripts/generate-agents-md.sh` 작성**

```bash
#!/usr/bin/env bash
# generate-agents-md.sh — CLAUDE.md 의 @import 줄을 펼쳐서 AGENTS.md 생성
# SoT = CLAUDE.md. invariant 추가/삭제 시 CLAUDE.md 만 갱신.
#
# Usage:
#   generate-agents-md.sh           # AGENTS.md in-place 갱신
#   generate-agents-md.sh --check   # stdout 출력 (CI/drift 검증용)
set -euo pipefail

MODE="write"
[ "${1:-}" = "--check" ] && MODE="check"

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_MD="$PLUGIN_DIR/CLAUDE.md"
OUT="$PLUGIN_DIR/AGENTS.md"

[ -f "$CLAUDE_MD" ] || { echo "error: $CLAUDE_MD not found" >&2; exit 2; }

strip_frontmatter_and_meta() {
  awk '
    BEGIN { in_fm = 0; fm_done = 0; in_cited = 0 }
    NR == 1 && /^---[[:space:]]*$/ { in_fm = 1; next }
    in_fm && /^---[[:space:]]*$/ { in_fm = 0; fm_done = 1; next }
    in_fm { next }
    fm_done && /^\*\*적용된 §/ { next }
    fm_done && /^> Language-neutral invariants —/ { next }
    fm_done && /^> Cited from:/ { in_cited = 1; next }
    in_cited && /^>/ { next }
    in_cited && !/^>/ { in_cited = 0 }
    { print }
  ' "$1"
}

declare -a SEEN=()
DUP_FOUND=0

render() {
  echo "# $(basename "$PLUGIN_DIR") — Codex AGENTS.md"
  echo ""
  echo "> Generated by scripts/generate-agents-md.sh from CLAUDE.md @import directives."
  echo "> Do NOT edit manually — changes will be overwritten on next regenerate."
  echo ""

  while IFS= read -r line; do
    if [[ "$line" =~ ^@\.?/(.*)$ ]]; then
      rel="${BASH_REMATCH[1]}"
      abs="$PLUGIN_DIR/$rel"
      if [ ! -f "$abs" ]; then
        echo "<!-- ERROR: import not found: $rel -->"
        echo "error: import not found: $rel" >&2
        continue
      fi
      local already=0
      for s in "${SEEN[@]}"; do
        if [ "$s" = "$rel" ]; then already=1; break; fi
      done
      if [ $already -eq 1 ]; then
        echo "<!-- DUPLICATE import skipped: $rel -->"
        echo "warn: duplicate import: $rel" >&2
        DUP_FOUND=1
        continue
      fi
      SEEN+=("$rel")
      echo ""
      echo "<!-- ━━━ inlined from $rel ━━━ -->"
      echo ""
      strip_frontmatter_and_meta "$abs"
      echo ""
    else
      echo "$line"
    fi
  done < "$CLAUDE_MD"
}

if [ "$MODE" = "check" ]; then
  render
else
  render > "$OUT"
  echo "Generated: $OUT ($(wc -l < "$OUT" | tr -d ' ') lines, ${#SEEN[@]} imports)" >&2
fi

[ $DUP_FOUND -eq 0 ] || { echo "FAIL: duplicate imports detected" >&2; exit 1; }
```

- [ ] **Step 2: 실행 + 결과 검증**

```bash
chmod +x plugins/stack-backend-ts/scripts/generate-agents-md.sh
bash plugins/stack-backend-ts/scripts/generate-agents-md.sh
```
Expected stderr: `Generated: .../AGENTS.md (N lines, 18 imports)`

- [ ] **Step 3: `scripts/acceptance-check.sh` 의 마지막에 drift 검증 추가**

```bash
# 8. AGENTS.md drift detection (--check 모드 — AGENTS.md 수정 안 함)
GENERATED=$(bash "$(dirname "$0")/generate-agents-md.sh" --check 2>/dev/null)
CURRENT=$(cat "$(dirname "$0")/../AGENTS.md")
if [ "$GENERATED" != "$CURRENT" ]; then
  echo "FAIL: AGENTS.md out of sync with CLAUDE.md @imports — run scripts/generate-agents-md.sh"
  FAIL=$((FAIL+1))
fi
```

- [ ] **Step 4: `scripts/README.md` 작성**

```markdown
# scripts/

## generate-agents-md.sh
CLAUDE.md 의 `@./...` import 를 펼쳐서 AGENTS.md 생성.
- invariant 추가/삭제 → CLAUDE.md 수정 → `bash scripts/generate-agents-md.sh` → commit
- `--check`: stdout 출력 (CI/drift 검증)

## acceptance-check.sh
plugin 메타 검증 — frontmatter 5필드 / 캐시 링크 / forbidden-scan / AGENTS.md drift.

## audit-all.sh
사용자 프로젝트 안에서 실행 — 21 audit 일괄. `DOMAIN_VOCAB` envvar 정의 시 app-domain-boundary 활성.

## forbidden-scan.sh
SKILL.md 안 금지 어휘 (iyaki residue 등) 검출.
```

- [ ] **Step 5: commit**

```bash
git add plugins/stack-backend-ts/scripts/ plugins/stack-backend-ts/AGENTS.md
git commit -m "feat(scripts): add generate-agents-md.sh + --check + README + acceptance-check drift detection"
```

### Task 6.6: iyaki-rebuild 측 placeholder 해석 룰 추가

- [ ] **Step 1: iyaki-rebuild 의 CLAUDE.md 에 placeholder 해석 섹션 추가**

iyaki-rebuild 의 CLAUDE.md (현재 `@AGENTS.md`) 에 다음 섹션 append:

```markdown
## stack-backend-ts plugin placeholder 해석

본 프로젝트는 hibye-plugins 의 `stack-backend-ts` plugin 을 사용. plugin 의 SKILL.md 안 placeholder 는 다음으로 해석:

| placeholder | 이 프로젝트의 값 |
|---|---|
| `<domain>` | `iyaki` |
| `<DOMAIN>` (env var) | `IYAKI` (예: `IYAKI_DATABASE_URL`) |
| `<domain entity>` | scenario / novel / character / persona / writer / author |
| `<DOMAIN_VOCAB>` (audit-all.sh envvar) | `writer\|author\|scenario\|novel\|character\|persona` |
| `<category>` | `image` / `audio` / `video` |
| `<workspace-entity>` | prose-editor character/scenario mention (`@` trigger) |

audit-all.sh 실행 시:
```bash
export DOMAIN_VOCAB="writer|author|scenario|novel|character|persona"
bash /path/to/plugin/scripts/audit-all.sh apps/api
```
```

- [ ] **Step 2: commit**

```bash
cd /Users/youngseoklee/Desktop/workplace/iyaki-rebuild
git add CLAUDE.md
git commit -m "docs: add stack-backend-ts placeholder interpretation for iyaki domain"
```

---

## Phase 7: 최종 검증 + merge

### Task 7.1: 자동 검증

- [ ] **Step 1: acceptance-check**

```bash
bash plugins/stack-backend-ts/scripts/acceptance-check.sh
```
Expected: `=== acceptance-check: 78 skills checked, 0 failures ===`

- [ ] **Step 2: forbidden-scan**

```bash
bash plugins/stack-backend-ts/scripts/forbidden-scan.sh
```
Expected: `✓ forbidden-scan: 0 matches` (일반화 후 iyaki 직접 언급 0)

- [ ] **Step 3: iyaki-rebuild skill 카운트**

```bash
ls /Users/youngseoklee/Desktop/workplace/iyaki-rebuild/.claude/skills/ | wc -l
```
Expected: `9` (product-planning + 8 이전)

- [ ] **Step 4: worktree clean**

```bash
cd /Users/youngseoklee/Desktop/workplace/hibye-plugins-ts-rename && git status --short
```
Expected: 출력 없음

### Task 7.2: 카운트 일관성 sanity check

- [ ] **Step 1: skill 카운트**

```bash
echo "plugin skills:";          ls plugins/stack-backend-ts/skills/ | wc -l
echo "CLAUDE.md invariant @:";  grep -c "^@\./skills/" plugins/stack-backend-ts/CLAUDE.md
echo "iyaki-rebuild skills:";   ls /Users/youngseoklee/Desktop/workplace/iyaki-rebuild/.claude/skills/ | wc -l
```
Expected: plugin = **78**, CLAUDE.md @ = **18**, iyaki = **9**

- [ ] **Step 2: 카운트 문구 grep — drift 0**

```bash
rg -nE "(13|16|18|21|24|37|39|40|50|59|73|78|80) (audit|invariant|workflow|skill)" \
  plugins/stack-backend-ts/CLAUDE.md \
  plugins/stack-backend-ts/skills/ts-agent-rules/ \
  plugins/stack-backend-ts/skills/architecture-invariants/ \
  plugins/stack-backend-ts/skills/backend-overview/ 2>/dev/null
```
Expected: 매치된 모든 카운트가 (18 invariant / 39 workflow / 21 audit / 78 total) 와 일치

- [ ] **Step 3: AGENTS.md generator idempotency**

```bash
bash plugins/stack-backend-ts/scripts/generate-agents-md.sh
git diff plugins/stack-backend-ts/AGENTS.md
```
Expected: diff 없음

### Task 7.3: 워크트리 merge + 캐시

- [ ] **Step 1: 변경 검토**

```bash
cd /Users/youngseoklee/Desktop/workplace/hibye-plugins-ts-rename
git log --oneline main..HEAD
```

- [ ] **Step 2: merge**

```bash
cd /Users/youngseoklee/Desktop/workplace/hibye-plugins
git merge --no-ff feat/stack-backend-ts-rename -m "feat: extract stack-backend-ts — 8 move + 5 generalize + 8 abstract + 6 new (78 skills, framework/runtime neutral)"
```

- [ ] **Step 3: 워크트리 정리**

```bash
git worktree remove ../hibye-plugins-ts-rename
git branch -d feat/stack-backend-ts-rename
```

- [ ] **Step 4: 캐시 갱신**

```bash
rm -rf ~/.claude/plugins/cache/hibye-plugins/stack-backend-ts-hono
bash /Users/youngseoklee/Desktop/workplace/hibye-plugins/scripts/link-cache.sh
ls -la ~/.claude/plugins/cache/hibye-plugins/
```
Expected: `stack-backend-ts/` 링크 → hibye-plugins/plugins/stack-backend-ts/

---

## Self-Review 체크리스트

- [x] **Spec coverage**: Python plugin 일반화 패턴 반영 — 8 이전 + 5 일반화 + 8 추상화 + 6 신규 + rename + 메타
- [x] **카운트 일관성**: 80 - 8 + 6 = **78 total** (= 18 + 39 + 21). 그대로 유지 = 59 (= 10+1+15+19+14). 모든 task / Expected / commit 정합
- [x] **Python 패턴 정합**: `<domain>` placeholder 일관, `<DOMAIN>` env var, `<DOMAIN_VOCAB>` audit envvar — Python plugin 의 data-audit/SKILL.md 패턴과 동일
- [x] **Phase 2 일반화 구체성**: 5 skill 각각의 치환 표 (현재 어휘 → placeholder)
- [x] **Phase 3 추상화 구체성**: 8 skill 각각의 유지/제거 표
- [x] **신규 6 skill**: 본문 outline + cross-link 명시
- [x] **iyaki-rebuild 측 placeholder 해석 룰**: Task 6.6 으로 명시 (Python plugin 의 CLAUDE.md 패턴 따름)
- [x] **Generator `--check` 모드**: acceptance-check 가 AGENTS.md 수정 안 함
- [x] **link-cache.sh**: 수동 ln 대신 기존 자동화
- [x] **forbidden-terms**: 일반화 검증 (iyaki residue 검출 패턴)

## 위험 + 완화

| 위험 | 완화 |
|------|------|
| Placeholder 치환 시 의미 손실 (예: lock_project 가 일반 advisory lock 인지 iyaki-specific 함수인지 불명확) | Task 2.x 의 치환 표에서 함수명 유지 vs 어휘 일반화 명시적 구분 |
| `<DOMAIN_VOCAB>` envvar 미정의 시 audit silent skip → 도메인 누출 감지 못 함 | audit-all.sh 가 SKIP 메시지 명시 emit + instance 측 CLAUDE.md 에 envvar 정의 의무 명시 |
| 이전된 skill 의 cross-reference (이전된 sibling 또는 plugin 측 SoT) 깨짐 | Task 1.1 Step 2 변환 룰 표로 일괄 정정 |
| iyaki-rebuild AGENTS.md 가 invariant 본문 inline 안 함 → Codex 측 invariant 비-노출 | iyaki-rebuild 측 별도 generator 운영 권장 (본 plan 범위 밖, 후속 작업) |
| 일반화 후 description 매칭 정확도 하락 | description 첫 문장에 핵심 trigger 어휘 유지 (Task 2.x 별 검토 step 포함) |
| `api-audit` skill 이 Hono `zValidator` 검사 (apps/api 종속 부분 잔존) | CLAUDE.md catalog 의 api-audit 행에 TBD 마커 + 후속 PR 결정 |
| `link-cache.sh` 가 다른 plugin 캐시도 재생성 | 의도된 동작 (idempotent, 다른 plugin 영향 없음) |
