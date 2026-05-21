# stack-backend-ts-hono

`apps/api` 같은 *Hono + TypeScript* 백엔드 작업 시 적용. Cloudflare Workers 호환 룰 처음부터 강제.

## 백엔드 영역 룰
@./rules/hono-workers-compat.md

## on-demand 체크리스트

- `verify-workers-compat` — Node-only API (`fs`, `Buffer`, `path`, `process.env` direct read 등) 사용 검출. backend 작업 마무리 단계에 실행.

## 관련 spec

- `docs/superpowers/specs/2026-05-21-shared-agent-marketplace-design.md` §3.2 (L2 backend stack), §5.3 (상시 룰 vs on-demand 분리), §10.M1

---

## 상시 적용 invariant 14개

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

---

## 사용 가능한 workflow 스킬 14개 (on-demand, description trigger)

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

## 사용 가능한 audit 스킬 12 (on-demand)

> 배포 전 / provider 추가 후 / route 추가 후 등 *변화 후 검증* 시 trigger.

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
