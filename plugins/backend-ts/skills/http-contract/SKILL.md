---
name: http-contract
description: EUNHA Hono routes, middleware, RFC 7807 errors, project authorization, CORS, idempotency. `apps/api/src/routes`, `src/middleware`.
---

# HTTP Contract

Read `apps/api/AGENTS.md`, `src/app.ts`, the target router, shared contracts, and its tests.

Preserve the request boundary:

1. Parse request input with the contract schema before domain work.
2. Apply the Supabase JWT session gate (`getSessionUser` in `src/auth/session.ts`) and `projectScopeAuth` at the existing route boundary with the minimum required role.
3. Keep route handlers thin and delegate writes to the shared service or domain-write path.
4. Throw typed domain errors and let `errorRfc7807Handler` produce `application/problem+json`. Do not reintroduce an `{ error: ... }` envelope.
5. Configure CORS once in `src/app.ts`; keep exposed headers aligned with real client consumers.
6. Use the canonical idempotency middleware for retryable mutations. Preserve fingerprint conflict, in-progress serialization, replay headers, and atomic response capture.
7. Keep resource non-disclosure and optimistic concurrency behavior consistent across REST and tool paths.

Add route-level tests for success, validation, authentication, authorization, not-found, conflict, and idempotent replay as applicable. Then use `backend-audit`.
