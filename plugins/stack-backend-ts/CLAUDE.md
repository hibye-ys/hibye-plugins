# stack-backend-ts

TypeScript backend (AI agent + 일반 백엔드) 룰. Framework / runtime / domain 무관 — Hono / Express / Fastify / Node / Bun / Workers 등 어디서든 사용. 도메인 결합은 `<domain>` placeholder, framework 결합은 `<framework>` placeholder 로 표기. instance 측 CLAUDE.md 에서 매핑.

본 catalog 의 모든 skill SKILL.md 는 plugin install 시 fresh 세션에 노출. Codex CLI 는 `.agents/skills/` 디렉토리를 직접 스캔.

## Placeholder 어휘

- 자세한 어휘 사양: `docs/placeholder-vocabulary.md` (Task 1.3 에서 생성)
- Instance CLAUDE.md 작성 템플릿: `docs/instance-claude-md-template.md` (Task 1.4 에서 생성)

## 상시 적용 invariant 20개

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
@./skills/config-env-validation/SKILL.md
@./skills/cancellation-propagation/SKILL.md

## On-demand workflow skills 39개

@./skills/agent-loop/SKILL.md
@./skills/ai-agent-patterns/SKILL.md
@./skills/api-routing/SKILL.md
@./skills/auth/SKILL.md
@./skills/backend-overview/SKILL.md
@./skills/codex-commands/SKILL.md
@./skills/codex-subagents/SKILL.md
@./skills/coding-standards/SKILL.md
@./skills/commit-rules/SKILL.md
@./skills/compaction/SKILL.md
@./skills/context-assembly/SKILL.md
@./skills/data-layer/SKILL.md
@./skills/database/SKILL.md
@./skills/debug-session/SKILL.md
@./skills/design-principles/SKILL.md
@./skills/error-handling/SKILL.md
@./skills/idempotency-key/SKILL.md
@./skills/incident-triage/SKILL.md
@./skills/lsp-server/SKILL.md
@./skills/mcp-integration/SKILL.md
@./skills/media-pipeline-patterns/SKILL.md
@./skills/migration-rollback/SKILL.md
@./skills/new-agent/SKILL.md
@./skills/new-run/SKILL.md
@./skills/performance-profiling/SKILL.md
@./skills/provider-catalog-sync/SKILL.md
@./skills/provider-layer/SKILL.md
@./skills/provider-scaffold/SKILL.md
@./skills/red-green-fix/SKILL.md
@./skills/secret-rotation/SKILL.md
@./skills/security-runtime/SKILL.md
@./skills/sse-streaming/SKILL.md
@./skills/sub-agent/SKILL.md
@./skills/test-cleanup/SKILL.md
@./skills/test-scaffold/SKILL.md
@./skills/testing-infra/SKILL.md
@./skills/tool-system/SKILL.md
@./skills/ts-agent-rules/SKILL.md
@./skills/usage-tracking/SKILL.md

## Audit skills 25개

@./skills/agent-verify-def/SKILL.md
@./skills/api-audit/SKILL.md
@./skills/app-domain-boundary-audit/SKILL.md
@./skills/compaction-thresholds-audit/SKILL.md
@./skills/cors-policy-audit/SKILL.md
@./skills/data-audit/SKILL.md
@./skills/dependency-scanning/SKILL.md
@./skills/full-architecture-audit/SKILL.md
@./skills/http-error-sentinels-audit/SKILL.md
@./skills/input-safety-audit/SKILL.md
@./skills/loop-audit/SKILL.md
@./skills/mcp-namespace-audit/SKILL.md
@./skills/media-job-lifecycle-audit/SKILL.md
@./skills/provider-retry-audit/SKILL.md
@./skills/rate-limit-policy-audit/SKILL.md
@./skills/rule-linting/SKILL.md
@./skills/run-policy-presets-audit/SKILL.md
@./skills/security-audit-check/SKILL.md
@./skills/session-audit/SKILL.md
@./skills/single-writer-audit/SKILL.md
@./skills/spawn-limits-audit/SKILL.md
@./skills/sse-lifecycle-audit/SKILL.md
@./skills/structured-log-schema-audit/SKILL.md
@./skills/token-budget-audit/SKILL.md
@./skills/tool-sort-order-audit/SKILL.md
