# stack-backend-ts-hono

`apps/api` 같은 *Hono + TypeScript* 백엔드 작업 시 적용. Cloudflare Workers 호환 룰 처음부터 강제.

## 백엔드 영역 룰
@./rules/hono-workers-compat.md

## on-demand 체크리스트

- `verify-workers-compat` — Node-only API (`fs`, `Buffer`, `path`, `process.env` direct read 등) 사용 검출. backend 작업 마무리 단계에 실행.

## 관련 spec

- `docs/superpowers/specs/2026-05-21-shared-agent-marketplace-design.md` §3.2 (L2 backend stack), §5.3 (상시 룰 vs on-demand 분리), §10.M1

---

## 상시 적용 invariant 16개

> Claude Code 가 plugin install 후 fresh 세션 시작 시 다음 invariant 본문이 *상시 노출*. Workers 호환 / SSE lifecycle / provider retry 등 *불변* 룰 자동 적용.

@./skills/workers-compat/SKILL.md
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
@./skills/app-domain-boundary/SKILL.md
@./skills/media-job-lifecycle/SKILL.md
@./skills/architecture-invariants/SKILL.md

---

## 사용 가능한 workflow 스킬 39개 (on-demand, description trigger)

- `backend-overview` — 코드베이스 진입 / 모듈 위치 결정
- `provider-layer` — 새 LLM provider 추가 / retry-timeout 수정
- `sse-streaming` — Hono SSE route 추가/수정
- `tool-system` — LLM tool calling 추가/수정
- `agent-loop` — agentic loop 구현
- `context-assembly` — 컨텍스트 조립 / token budget 적용
- `mcp-integration` — MCP 서버 연결 / 도구 prefix
- `compaction` — conversation 요약·압축
- `api-routing` — Hono route / middleware / onError
- `auth` — 인증·세션·시크릿
- `error-handling` — 에러 sentinel / onError / structured log
- `sub-agent` — sub-agent 호출 (Workers 호환)
- `debug-session` — 백엔드 debug session (Hono+Workers 특화)
- `update-config-runtime` — Workers c.env 바인딩 / .dev.vars / wrangler.toml (renamed)
- `data-governance` — 데이터 거버넌스 (retention/PII/portability) 정책 결정 시
- `data-layer` — Repository/DAO 패턴, transaction, optimistic locking 추가 시
- `database` — DB 선택·연결·마이그레이션 (Workers 호환 Neon, D1 ✕)
- `testing-infra` — Vitest+Hono 테스트 인프라 셋업 시
- `test-scaffold` — 새 route/service/provider 테스트 골격 생성 시
- `test-cleanup` — afterEach/afterAll DB/KV/mock 정리 패턴 시
- `red-green-fix` — TDD red→green→refactor 사이클 시
- `pre-deploy-check` — Workers 배포 전 6-step 체인 (type/lint/audit-all/vitest/whoami/dry-run)
- `ai-agent-patterns` — AI agent 휴리스틱 / context budgeting / safety gate
- `coding-standards` — TS 백엔드 코딩 컨벤션 (eslint/prettier/biome)
- `commit-rules` — conventional commit + scope 카탈로그
- `design-principles` — YAGNI / DRY / SoC / TS 예시
- `media-pipeline-patterns` — 미디어 R2/ML-worker 파이프라인 (Workers compat)
- `codex-commands` — Codex slash command 카탈로그 + arg 파싱
- `codex-subagents` — Codex subagent dispatch 가이드
- `ts-agent-rules` — TS 백엔드 agent 룰 카탈로그 + core-infra 흡수
- `new-agent` — 새 agent 추가 절차 (AgentDef + Codex marker)
- `new-run` — 새 run 추가 절차 (SSE + budget + abort)
- `lsp-server` — tsc/vtsls 진단 (Workers vs Node 분리)
- `performance-profiling` — 0x/clinic/node --inspect
- `incident-triage` — wrangler tail / Sentry / rollback
- `security-runtime` — zod parse / rate limit / CSRF / audit log
- `usage-tracking` — LLM 토큰 사용량 집계 + Cron Triggers
- `provider-scaffold` — 새 provider 추가 스캐폴딩
- `provider-catalog-sync` — OpenRouter 모델 카탈로그 sync (Node 전용)

## 사용 가능한 audit 스킬 24개 (on-demand)

> 13 = M2.5 Task 4.1-4.12 + d1-forbidden-audit (Task 6.4). +11 = M2.5 Task 9e.1-9e.11 (audit-port). M2.5 audit 총 24.
> 배포 전 / provider 추가 후 / route 추가 후 등 *변화 후 검증* 시 trigger.

### 기존 13 audit

- `provider-retry-audit` — retry-able vs fatal sentinel 매트릭스 (provider 추가 후)
- `sse-lifecycle-audit` — 4-state + onAbort + heartbeat (SSE route 변경 후)
- `single-writer-audit` — KV/R2/UPDATE lock 없는 다중 writer (DB 코드 변경 후)
- `token-budget-audit` — token 상수 import vs 매직 넘버 (context 변경 후)
- `tool-sort-order-audit` — tool 등록 순서 (tool 추가 후)
- `input-safety-audit` — auth → schema → rate-limit → handler 순서 (route 추가 후)
- `mcp-namespace-audit` — prefix 누락·중복 (MCP 추가 후)
- `compaction-thresholds-audit` — threshold 매직 넘버 (compaction 변경 후)
- `http-error-sentinels-audit` — throw HTTPException vs Error / c.json 직접 (error path 변경 후)
- `run-policy-presets-audit` — timeout/max-turn preset 우회 (AI run 코드 변경 후)
- `spawn-limits-audit` — parallel call limit 없음 (sub-agent 변경 후)
- `app-domain-boundary-audit` — core 디렉토리 도메인 어휘 누출 (모듈 추가/이동 후)
- `d1-forbidden-audit` — Cloudflare D1 사용 검출 (spec §1.2 enforce, 배포 전 — 06 Task 6.4 산출, Codex 4차 추가)

### 신규 11 audit (Task 9e.1–9e.11)

- `agent-verify-def` — agent def 필수 필드 / 중복 name
- `api-audit` — Hono route zValidator / auth middleware
- `data-audit` — FK 인덱스 / RLS / migration 순서
- `full-architecture-audit` — 24 audit 통합 + madge cycle + 디렉토리 정합
- `infra-audit` — wrangler.toml 필수 키 / bindings / preview env
- `loop-audit` — while(true) 안전성
- `session-audit` — KV TTL / storage adapter 우회
- `security-audit-check` — secret 하드코딩 / eval / SSRF / SQL injection
- `rule-linting` — SKILL.md frontmatter 검증
- `dependency-scanning` — npm audit CVE + Workers-incompat
- `runtime-verify` — deploy 직후 health / SSE timing
