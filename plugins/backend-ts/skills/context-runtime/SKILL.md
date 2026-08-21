---
name: context-runtime
description: EUNHA prompt assembly, retrieved context, token estimates, compaction, prompt cache. `apps/api/src/context`, `agent-loop/compaction.ts`.
---

# Context Runtime

Read `apps/api/AGENTS.md` and the current context tests before changing policy.

Keep the implemented composition model:

- Layer 1 is the stable base prompt.
- Layer 2 is the stable agent prompt.
- Layer 3 is volatile retrieved or active-view context.
- Mark only stable prefix layers cacheable. Keep retrieved data uncached.
- Sanitize and bound client- or model-controlled text before embedding it into a system-adjacent segment.

For compaction:

1. Preserve the leading system anchor and newest real turn when they fit.
2. Elide old turns only; use the implemented user-role placeholder so provider message order remains valid.
3. Return the original history and fail closed when anchor plus newest cannot fit.
4. Keep loop state, pinned data, and persistent memory outside the compacted message array.
5. Do not describe or implement multi-stage summarization that does not exist in the current code.

Trace cache-sensitive provider conversion when segment shape changes. Run context, compaction, and affected provider conversion tests, then use `backend-audit`.
