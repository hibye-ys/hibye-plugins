---
name: subagent-runtime
description: EUNHA child-agent spawning, background execution, cancellation, spawn state, depth limits. `apps/api/src/sub-agent`.
---

# Subagent Runtime

Read the canonical implementation before applying a rule:

- `src/sub-agent/child.ts`
- `src/sub-agent/spawn-store.ts`
- `src/tools/baseline/spawn-agent-call.ts`
- `src/tools/spawn-constants.ts`
- `src/ai/headless-*.ts`

Preserve these boundaries:

1. Import the shared spawn limit; do not duplicate a numeric depth constant.
2. Route child model calls through the headless provider adapter and child tool calls through `dispatchTool`.
3. Propagate the parent abort signal and release every acquired run, lease, or background record on all terminal paths.
4. Keep foreground results and persistent background results as separate primitives.
5. Treat abnormal loop stops and provider failures as failures, not successful empty summaries.
6. Keep child tool exposure constrained by the loaded agent definition and current policy code.

Run child, spawn-store, spawn-tool, and affected headless tests. Use `backend-audit` before handoff.
