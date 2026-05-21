# stack-backend-ts-hono

`apps/api` 같은 *Hono + TypeScript* 백엔드 작업 시 적용. Cloudflare Workers 호환 룰 처음부터 강제.

본 plugin 의 상시 룰 본문:

@./rules/hono-workers-compat.md

## on-demand 체크리스트

- `verify-workers-compat` — Node-only API (`fs`, `Buffer`, `path`, `process.env` direct read 등) 사용 검출. backend 작업 마무리 단계에 실행.

## 관련 spec

- `docs/superpowers/specs/2026-05-21-shared-agent-marketplace-design.md` §3.2 (L2 backend stack), §5.3 (상시 룰 vs on-demand 분리), §10.M1
