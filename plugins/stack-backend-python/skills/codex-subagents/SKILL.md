---
name: codex-subagents
description: Use when the user asks Codex to use, invoke, emulate, inspect, or delegate to App sub-agents such as provider-manager, prompt-context-manager, tools-manager, output-stream-manager, agent-loop-manager, sub-agent-manager, test-manager, security-manager, architecture-validator, api-manager, data-state-manager, infra-performance-manager, spec-diff-auditor, architecture-reviewer, invariant-compliance-checker, rule-consistency-auditor, new-agent-builder, or settings-hooks-maintainer.
allowed-tools: Read, Bash, Grep, Glob
---

# codex-subagents

This skill is the Codex adapter for the App sub-agent catalog. Codex does not
automatically load Claude Code named agents, so their prompts are stored as
references under `references/agents/`.

## Dispatch

1. Identify the requested agent name or manager area.
2. Read `references/agents/<agent-name>.md`.
3. Load the skills named in that reference before doing the work.
4. If the user explicitly requested delegation, sub-agents, or parallel agent
   work, use Codex `spawn_agent` with the adapted agent prompt. Otherwise,
   emulate the agent locally by following the reference.
5. Respect the reference's read-only/write scope. Auditors stay read-only.

## Agent Catalog

| Agent | Scope |
|---|---|
| `agent-loop-manager` | loop audit, debug, compaction health |
| `api-manager` | routes, RunPolicy, schema sync |
| `architecture-reviewer` | layer/import direction and single-writer checks |
| `architecture-validator` | top-level architecture coordination |
| `data-state-manager` | data, state, DB, iyaki boundary |
| `infra-performance-manager` | benchmark, concurrency, resources |
| `invariant-compliance-checker` | cross-rule invariant compliance |
| `new-agent-builder` | runtime agent scaffold and verification |
| `output-stream-manager` | SSE, output events, usage tracking |
| `prompt-context-manager` | context assembly, token budgets, cache stability |
| `provider-manager` | providers, fallback, model catalog, provider debug |
| `rule-consistency-auditor` | rule file structural integrity |
| `security-manager` | security and dependency audit |
| `settings-hooks-maintainer` | runtime settings and hook config |
| `spec-diff-auditor` | one-subsystem rule-to-code drift |
| `sub-agent-manager` | backend sub-agent spawn health |
| `test-manager` | test review, cleanup, scaffold, verify |
| `tools-manager` | tools, MCP, media pipeline audit |

## Reference Use

Open only the requested agent reference:

```bash
sed -n '1,240p' .agents/skills/codex-subagents/references/agents/<agent-name>.md
```

When spawning a Codex sub-agent, pass the reference content plus the user's
specific task, and state that `.claude` paths are the Claude Code mirror while
`.agents` is the Codex-facing shared source.
