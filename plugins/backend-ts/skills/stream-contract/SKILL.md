---
name: stream-contract
description: EUNHA SSE event production, persistence, replay, terminal states, disconnect cleanup. `apps/api/src/ai/sse-emit.ts`, streaming routes.
---

# Stream Contract

Read the SSE schemas in `packages/contracts`, then `src/ai/sse-emit.ts`, `src/ai/resume.ts`, and the target streaming route.

Keep durable and transient signals separate:

- `emitSse` validates, allocates a session event ID, persists the event, updates the run, applies message mirroring, then writes the wire frame.
- `emitTransient` validates and writes a frame without an ID or durable state.
- Keepalive comments are transient and must not advance replay cursors.

Workflow:

1. Add or change an event in the shared contract first.
2. Update every producer, mirror policy, resume consumer, and web consumer together when the wire shape changes.
3. Flush buffered assistant text before non-text and terminal events.
4. Keep terminal `done`, `error`, and awaiting-input behavior aligned with persistent run status.
5. Emit deferred transient projections only after the durable transaction commits.
6. Clear timers and release stream locks, breaker probes, transactions, and abort resources on every exit path.
7. Do not preserve a historical fixed event count; the shared schema is the source of truth.

Run contract SSE tests, emitter tests, adapter tests, route streaming tests, and resume tests, then use `backend-audit`.
