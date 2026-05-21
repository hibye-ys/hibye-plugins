---
name: codex-commands
description: Use when the user invokes or asks about App slash commands in Codex, including /agent-debug, /agent-test, /agent-verify, /audit-all, /help, /incident, /new-agent, /new-run, /new-tool, /pre-deploy, /spec-diff, /sse-trace, or /test-coverage. This mirrors the Claude command definitions (`.claude/commands/`) into Codex-readable command references.
allowed-tools: Read, Bash, Grep, Glob, Write, Edit
---

# codex-commands

This skill is the Codex adapter for the App command harness. The canonical
command references live under `references/commands/`, mirrored from the
Claude command definitions in `.claude/commands/` and neutralized to `.agents` paths.

## Dispatch

1. Parse the command name from the user request. Treat `/agent-verify foo` and
   `agent-verify foo` equivalently.
2. Read `references/commands/<command>.md`.
3. Follow that command's dispatch rule, replacing `$ARGUMENTS` with the user's
   remaining text.
4. If the command names a manager or auditor, load `codex-subagents` and read
   that agent reference. Only spawn a Codex sub-agent when the user explicitly
   asked to use, delegate to, or run that sub-agent. Otherwise, apply the
   reference locally.
5. Keep `.claude` files read-only. Codex-facing edits belong in `.agents`,
   `.codex`, or normal project source files.

## Command Map

| Command | Primary Codex route |
|---|---|
| `/help` | Show this map and the command reference cheat sheet |
| `/agent-debug` | `debug-session` |
| `/agent-test` | `testing-infra` plus command reference pytest flags |
| `/agent-verify` | `runtime-verify` |
| `/audit-all` | `full-architecture-audit` plus referenced audit skills |
| `/incident` | `incident-triage` |
| `/new-agent` | `new-agent` |
| `/new-run` | `new-run` |
| `/new-tool` | command reference plus `tool-system` |
| `/pre-deploy` | `pre-deploy-check` |
| `/spec-diff` | command reference plus `spec-diff-auditor` reference |
| `/sse-trace` | command reference; runs local SSE curl trace when server is up |
| `/test-coverage` | command reference plus `test-cleanup` / `test-scaffold` |

## Argument Handling

- Preserve quoted JSON arguments exactly for `/agent-verify`.
- Preserve free-form message text for `/sse-trace` and `/incident`.
- Validate names before scaffolding commands. Do not overwrite existing files.
- For write/scaffold commands, show intended file paths before editing and keep
  changes scoped to the command reference.

## References

Open only the command file needed for the current request:

```bash
sed -n '1,220p' .agents/skills/codex-commands/references/commands/<command>.md
```
