---
name: tool-runtime
description: Add or modify EUNHA model tools, registry ordering, schemas, authorization, concurrency, or dispatch. Use for `apps/api/src/tools` and `src/ai/tool-runtime.ts`.
---

# Tool Runtime

Read `src/tools/base.ts`, `registry.ts`, `all.ts`, `policy.ts`, and `src/ai/tool-runtime.ts` before editing.

Keep one tool contract and one execution gate:

1. Define input validation and runtime policy on the `ToolHandler`.
2. Register tools through the existing category registrars and `registerAllToolsValidated`.
3. Preserve the implemented manifest order: baseline, domain, MCP project, then app-native. Do not substitute a generic built-in/MCP ordering rule.
4. Derive provider schemas and externally exposed surfaces from the same registry instead of maintaining parallel catalogs.
5. Route execution through `dispatchTool` so token, role, lease, audit, persistence, and error mapping stay centralized.
6. Make read-only and concurrency decisions from the actual input where the handler contract allows it.
7. Keep app-native approval/render tools off transports that cannot render their intents.

Update the per-tool tests, registry order tests, policy tests, and tool-runtime tests. Use `backend-audit` afterward.
