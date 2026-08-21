---
name: mcp-runtime
description: EUNHA MCP client bridge and stdio MCP server: tool exposure, namespace, queue, shutdown. `apps/api/src/mcp`, `src/mcp-server`.
---

# MCP Runtime

Distinguish the two MCP boundaries:

- `src/mcp` bridges external MCP tools into the in-process tool registry.
- `src/mcp-server` exposes a filtered EUNHA tool surface to an external CLI.

Apply the current contracts:

1. Internal bridged names use `mcp_<server>_<tool>` with single underscores and validation from `src/mcp/namespace.ts`. A host may display its own server prefix with double underscores; do not bake that host notation into the registry name.
2. Use safe bridge defaults for unknown tools: sequential, editor-only, and not read-only unless explicitly declared.
3. Derive the stdio surface from `toolRegistry`; do not create a second tool catalog.
4. Keep app-native UI tools and raw storage stubs off the external author surface.
5. Route domain calls through `dispatchTool`. Keep project-control routing explicit and serialized on the same queue.
6. Preserve active-project ordering, transaction release, queue drain, abort, and graceful shutdown behavior.
7. Let the MCP SDK validate the canonical Zod input schema; map tool failures to `isError` results rather than crashing the protocol.

Run namespace, bridge, tool-surface, tool-run, control, server, and protocol tests that match the change.
