---
name: agent-definition
description: Add or modify an EUNHA runtime agent definition or its loader. Use for `apps/api/src/prompts/agents/*.md`, `src/agents/loader.ts`, discovery, schema, or agent prompt changes.
---

# Agent Definition

Use one Markdown file per runtime agent:

`apps/api/src/prompts/agents/<name>.md`

The YAML frontmatter is metadata and the Markdown body is the system prompt. Do not recreate the removed YAML-plus-prompt pair.

Workflow:

1. Read `AgentDefinitionSchema` in `src/agents/loader.ts`; never copy its fields into a second schema.
2. Make the filename stem equal the frontmatter `name`.
3. Keep prompt text in the same Markdown file so metadata and prompt caches are populated by one read.
4. Route runtime loading through `loadAgent`. Treat `discoverAgents` as UI-only, best-effort discovery.
5. Preserve the worker recursion guard: non-chat output agents cannot expose `spawn_agent`.
6. Add or update loader, discovery, and smoke tests for every schema or definition change.

Do not confuse runtime agents with Claude/Codex named subagents in the plugin harness.
