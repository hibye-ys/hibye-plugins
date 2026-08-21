---
name: agent-loop-runtime
description: EUNHA agent loop, stop decisions, tool rounds, overflow recovery, loop state. `apps/api/src/agent-loop` and its foreground/headless adapters.
---

# Agent Loop Runtime

Treat the implementation and tests as the contract. Read `apps/api/AGENTS.md`, then inspect:

- `src/agent-loop/loop.ts`
- `src/agent-loop/state.ts`
- `src/agent-loop/stop.ts`
- `src/agent-loop/compaction.ts`
- the foreground or headless adapter being changed

Preserve these boundaries:

1. Keep mutable loop accounting in `LoopState`, outside the message history.
2. Keep the six stages in their implemented order. Do not introduce a separate transition enum or policy layer unless the codebase adopts one.
3. Let the call-model adapter classify provider failures into the structured error channel. Reserve throws for aborts and programming failures.
4. Execute tools only through the injected executor and the canonical `dispatchTool` path.
5. Bound every run with the agent round cap and composed stop predicates. Surface guardrail or resource-cap stops as abnormal outcomes.
6. Retry prompt overflow only through the implemented forced-compaction path and never after a foreground byte reached the client.

Before editing, trace both foreground and headless consumers. After editing, run the loop tests plus the affected adapter tests, then use `backend-audit`.
