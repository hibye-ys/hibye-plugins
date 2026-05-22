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
