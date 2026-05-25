---
source_url: https://code.claude.com/docs/en/sub-agents
fetched_at: 2026-05-24
title: Create custom subagents
fetcher: claude-code WebFetch
notes: Original URL https://docs.claude.com/en/docs/claude-code/sub-agents redirected (301) to code.claude.com.
---

# Create custom subagents

> Create and use specialized AI subagents in Claude Code for task-specific workflows and improved context management.

Subagents are specialized AI assistants that handle specific types of tasks. Use one when a side task would flood your main conversation with search results, logs, or file contents you won't reference again: the subagent does that work in its own context and returns only the summary. Define a custom subagent when you keep spawning the same kind of worker with the same instructions.

Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions. When Claude encounters a task that matches a subagent's description, it delegates to that subagent, which works independently and returns results.

> Subagents work within a single session. To run many independent sessions in parallel, see background agents. For sessions that communicate with each other, see agent teams.

Subagents help you:

* **Preserve context** by keeping exploration and implementation out of your main conversation
* **Enforce constraints** by limiting which tools a subagent can use
* **Reuse configurations** across projects with user-level subagents
* **Specialize behavior** with focused system prompts for specific domains
* **Control costs** by routing tasks to faster, cheaper models like Haiku

Claude uses each subagent's description to decide when to delegate tasks.

## Built-in subagents

Claude Code includes built-in subagents that Claude automatically uses when appropriate. Each inherits the parent conversation's permissions with additional tool restrictions.

**Explore and Plan skip your CLAUDE.md files and the parent session's git status** to keep research fast and inexpensive. Every other built-in and custom subagent loads both.

### Explore

A fast, read-only agent optimized for searching and analyzing codebases.

* **Model**: Haiku (fast, low-latency)
* **Tools**: Read-only tools (denied access to Write and Edit tools)
* **Purpose**: File discovery, code search, codebase exploration

When invoking Explore, Claude specifies a thoroughness level: **quick** for targeted lookups, **medium** for balanced exploration, or **very thorough** for comprehensive analysis.

### Plan

A research agent used during plan mode to gather context before presenting a plan.

* **Model**: Inherits from main conversation
* **Tools**: Read-only tools
* **Purpose**: Codebase research for planning

This prevents infinite nesting (subagents cannot spawn other subagents) while still gathering necessary context.

### General-purpose

A capable agent for complex, multi-step tasks that require both exploration and action.

* **Model**: Inherits from main conversation
* **Tools**: All tools
* **Purpose**: Complex research, multi-step operations, code modifications

### Other

| Agent             | Model  | When Claude uses it                                      |
| :---------------- | :----- | :------------------------------------------------------- |
| statusline-setup  | Sonnet | When you run `/statusline` to configure your status line |
| claude-code-guide | Haiku  | When you ask questions about Claude Code features        |

## Configure subagents

### Use the /agents command

The `/agents` command opens a tabbed interface for managing subagents. The **Running** tab shows live subagents. The **Library** tab lets you create, edit, and delete subagents.

### Choose the subagent scope

| Location                     | Scope                   | Priority    | How to create                                 |
| :--------------------------- | :---------------------- | :---------- | :-------------------------------------------- |
| Managed settings             | Organization-wide       | 1 (highest) | Deployed via managed settings                 |
| `--agents` CLI flag          | Current session         | 2           | Pass JSON when launching Claude Code          |
| `.claude/agents/`            | Current project         | 3           | Interactive or manual                         |
| `~/.claude/agents/`          | All your projects       | 4           | Interactive or manual                         |
| Plugin's `agents/` directory | Where plugin is enabled | 5 (lowest)  | Installed with plugins                        |

**Project subagents** (`.claude/agents/`) are ideal for subagents specific to a codebase. Check them into version control.

Claude Code scans `.claude/agents/` and `~/.claude/agents/` **recursively**. Identity comes only from the `name` frontmatter field. Keep `name` values unique across the whole tree.

Plugin `agents/` directories are also scanned recursively. Unlike project and user scopes, a subfolder inside a plugin's `agents/` becomes part of the scoped identifier: a file at `agents/review/security.md` in plugin `my-plugin` registers as `my-plugin:review:security`.

**CLI-defined subagents** via `--agents` JSON exist only for that session.

> For security reasons, plugin subagents do not support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields.

### Write subagent files

> Subagents are loaded at session start. If you add or edit a subagent file directly on disk, restart your session. Subagents created through `/agents` take effect immediately.

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

Subagents receive **only this system prompt** (plus basic environment details like working directory), not the full Claude Code system prompt.

A subagent starts in the main conversation's current working directory. Within a subagent, `cd` commands do not persist between Bash tool calls. To give the subagent an isolated copy of the repository, set `isolation: worktree`.

#### Supported frontmatter fields

| Field             | Required | Description                                                                                                                                                                                                                                                                                                                              |
| :---------------- | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | Yes      | Unique identifier using lowercase letters and hyphens. Hooks receive this as `agent_type`.                                                                                                                                                                                                                                              |
| `description`     | Yes      | When Claude should delegate to this subagent.                                                                                                                                                                                                                                                                                            |
| `tools`           | No       | Tools the subagent can use. Inherits all tools if omitted. To preload Skills, use `skills` field rather than listing `Skill` here.                                                                                                                                                                                                       |
| `disallowedTools` | No       | Tools to deny, removed from inherited or specified list.                                                                                                                                                                                                                                                                                 |
| `model`           | No       | Model to use: `sonnet`, `opus`, `haiku`, full model ID, or `inherit`. Defaults to `inherit`.                                                                                                                                                                                                                                            |
| `permissionMode`  | No       | Permission mode: `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`. Ignored for plugin subagents.                                                                                                                                                                                                                |
| `maxTurns`        | No       | Maximum agentic turns before the subagent stops.                                                                                                                                                                                                                                                                                          |
| `skills`          | No       | Skills to preload into the subagent's context at startup. The **full skill content is injected**, not just the description.                                                                                                                                                                                                              |
| `mcpServers`      | No       | MCP servers available to this subagent. String reference or inline definition. Ignored for plugin subagents.                                                                                                                                                                                                                              |
| `hooks`           | No       | Lifecycle hooks scoped to this subagent. Ignored for plugin subagents.                                                                                                                                                                                                                                                                    |
| `memory`          | No       | Persistent memory scope: `user`, `project`, or `local`.                                                                                                                                                                                                                                                                                  |
| `background`      | No       | `true` to always run this subagent as a background task. Default: `false`.                                                                                                                                                                                                                                                                |
| `effort`          | No       | Effort level when active: `low`, `medium`, `high`, `xhigh`, `max`.                                                                                                                                                                                                                                                                        |
| `isolation`       | No       | Set to `worktree` to run the subagent in a temporary git worktree.                                                                                                                                                                                                                                                                       |
| `color`           | No       | Display color: `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`.                                                                                                                                                                                                                                                     |
| `initialPrompt`   | No       | Auto-submitted as the first user turn when this agent runs as the main session agent.                                                                                                                                                                                                                                                    |

### Choose a model

* **Model alias**: `sonnet`, `opus`, `haiku`
* **Full model ID**: `claude-opus-4-7`, `claude-sonnet-4-6`
* **inherit**: Use the same model as the main conversation
* **Omitted**: defaults to `inherit`

Resolution order:
1. `CLAUDE_CODE_SUBAGENT_MODEL` env var
2. Per-invocation `model` parameter
3. Subagent definition's `model` frontmatter
4. Main conversation's model

### Control subagent capabilities

#### Available tools

Subagents inherit all tools from the main conversation by default, including MCP tools.

To restrict tools, use `tools` (allowlist) or `disallowedTools` (denylist). If both are set, `disallowedTools` is applied first, then `tools` is resolved against the remaining pool. A tool listed in both is removed.

#### Restrict which subagents can be spawned

When an agent runs as the main thread with `claude --agent`, it can spawn subagents using the Agent tool. To restrict which subagent types it can spawn, use `Agent(agent_type)` syntax in the `tools` field.

> In version 2.1.63, the Task tool was renamed to Agent. Existing `Task(...)` references still work as aliases.

```yaml
---
name: coordinator
description: Coordinates work across specialized agents
tools: Agent(worker, researcher), Read, Bash
---
```

This is an allowlist. To allow spawning any subagent without restrictions, use `Agent` without parentheses. If `Agent` is omitted from `tools` entirely, the agent cannot spawn any subagents. Subagents cannot spawn other subagents, so `Agent(agent_type)` has no effect in subagent definitions.

#### Scope MCP servers to a subagent

```yaml
---
name: browser-tester
description: Tests features in a real browser using Playwright
mcpServers:
  # Inline definition: scoped to this subagent only
  - playwright:
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
  # Reference by name: reuses an already-configured server
  - github
---
```

To keep an MCP server out of the main conversation entirely and avoid its tool descriptions consuming context there, define it inline here rather than in `.mcp.json`.

#### Permission modes

| Mode                | Behavior                                                                                                                                    |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------ |
| `default`           | Standard permission checking with prompts                                                                                                   |
| `acceptEdits`       | Auto-accept file edits and common filesystem commands                                                                                       |
| `auto`              | Background classifier reviews commands                                                                                                      |
| `dontAsk`           | Auto-deny permission prompts                                                                                                                |
| `bypassPermissions` | Skip permission prompts                                                                                                                     |
| `plan`              | Plan mode (read-only exploration)                                                                                                           |

If the parent uses `bypassPermissions` or `acceptEdits`, this takes precedence and cannot be overridden. If the parent uses auto mode, the subagent inherits auto mode.

#### Preload skills into subagents

```yaml
---
name: api-developer
description: Implement API endpoints following team conventions
skills:
  - api-conventions
  - error-handling-patterns
---

Implement API endpoints. Follow the conventions and patterns from the preloaded skills.
```

The **full content of each listed skill is injected** into the subagent's context at startup. This is the inverse of `context: fork` in a skill.

You cannot preload skills that set `disable-model-invocation: true`.

#### Enable persistent memory

```yaml
---
name: code-reviewer
description: Reviews code for quality and best practices
memory: user
---
```

| Scope     | Location                                      | Use when                                                                                    |
| :-------- | :-------------------------------------------- | :------------------------------------------------------------------------------------------ |
| `user`    | `~/.claude/agent-memory/<name-of-agent>/`     | the subagent should remember learnings across all projects                                  |
| `project` | `.claude/agent-memory/<name-of-agent>/`       | the subagent's knowledge is project-specific and shareable via version control              |
| `local`   | `.claude/agent-memory-local/<name-of-agent>/` | the subagent's knowledge is project-specific but should not be checked into version control |

When memory is enabled, the subagent's system prompt includes:
- Instructions for reading and writing to the memory directory
- The first 200 lines or 25KB of `MEMORY.md` (whichever first), with instructions to curate `MEMORY.md` if it exceeds that limit
- Read, Write, and Edit tools auto-enabled

**Tips**:
- `project` is the recommended default scope
- Ask the subagent to consult memory before starting work and update after completing a task
- Include memory instructions directly in the subagent's markdown file

#### Conditional rules with hooks

```yaml
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

The validation script reads hook input from stdin, extracts the Bash command, and exits with code 2 to block write operations.

#### Disable specific subagents

```json
{
  "permissions": {
    "deny": ["Agent(Explore)", "Agent(my-custom-agent)"]
  }
}
```

### Define hooks for subagents

Two ways:
1. **In the subagent's frontmatter** — hooks run only while that subagent is active
2. **In `settings.json`** — hooks run in the main session when subagents start or stop

Frontmatter hooks fire when the agent is spawned as a subagent or when the agent runs as the main session.

Common events for subagents:

| Event         | Matcher input | When it fires                                                       |
| :------------ | :------------ | :------------------------------------------------------------------ |
| `PreToolUse`  | Tool name     | Before the subagent uses a tool                                     |
| `PostToolUse` | Tool name     | After the subagent uses a tool                                      |
| `Stop`        | (none)        | When the subagent finishes (converted to `SubagentStop` at runtime) |

Project-level events in `settings.json`:

| Event           | Matcher input   | When it fires                    |
| :-------------- | :-------------- | :------------------------------- |
| `SubagentStart` | Agent type name | When a subagent begins execution |
| `SubagentStop`  | Agent type name | When a subagent completes        |

## Work with subagents

### Understand automatic delegation

Claude automatically delegates based on the task description in your request, the `description` field in subagent configurations, and current context. To encourage proactive delegation, include phrases like **"use proactively"** in your subagent's description.

### Invoke subagents explicitly

* **Natural language**: name the subagent in your prompt
* **@-mention**: guarantees the subagent runs for one task
* **Session-wide**: `--agent <name>` or `agent` setting

```bash
claude --agent code-reviewer
```

The subagent's system prompt replaces the default Claude Code system prompt entirely. `CLAUDE.md` files and project memory still load.

For a plugin-provided subagent: `claude --agent security-reviewer`. If multiple plugins provide same-name agents: `claude --agent my-plugin:security-reviewer`.

### Run subagents in foreground or background

* **Foreground subagents** block the main conversation. Permission prompts pass through.
* **Background subagents** run concurrently. They run with permissions already granted and **auto-deny any tool call that would otherwise prompt**.

Claude decides. You can also ask "run this in the background" or press **Ctrl+B**.

To disable background tasks: `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`.

### Common patterns

#### Isolate high-volume operations

> Use a subagent to run the test suite and report only the failing tests with their error messages

#### Run parallel research

> Research the authentication, database, and API modules in parallel using separate subagents

> When subagents complete, their results return to your main conversation. Running many subagents that each return detailed results can consume significant context.

For sustained parallelism or work exceeding your context window, use agent teams.

#### Chain subagents

> Use the code-reviewer subagent to find performance issues, then use the optimizer subagent to fix them

### Choose between subagents and main conversation

Use the **main conversation** when:
* The task needs frequent back-and-forth
* Multiple phases share significant context
* You're making a quick, targeted change
* Latency matters

Use **subagents** when:
* The task produces verbose output you don't need in main context
* You want to enforce specific tool restrictions
* The work is self-contained and can return a summary

Consider **Skills** instead when you want reusable prompts that run in the main conversation context.

For a quick question about something already in your conversation, use `/btw` instead.

> Subagents cannot spawn other subagents. If your workflow requires nested delegation, use Skills or chain subagents from the main conversation.

### Manage subagent context

#### What loads at startup

Each subagent starts with a **fresh, isolated context window**. It does not see your conversation history, the skills you've already invoked, or the files Claude has already read.

A non-fork subagent's initial context contains:
* **System prompt**: the agent's own prompt plus environment details
* **Task message**: the delegation prompt Claude writes
* **CLAUDE.md and memory**: every level of the memory hierarchy. **Explore and Plan skip this.**
* **Git status**: a snapshot taken at the start of the parent session. **Explore and Plan skip it.**
* **Preloaded skills**: full content of any skill named in the agent's `skills` field

The main conversation reads Explore and Plan results with full CLAUDE.md context, so most rules don't need to reach the subagent itself. If a rule must, restate it in the prompt you give Claude when delegating.

#### Resume subagents

Each subagent invocation creates a new instance with fresh context. To continue an existing subagent's work, ask Claude to resume it. Resumed subagents retain their full conversation history.

When a subagent completes, Claude receives its agent ID. Claude uses the `SendMessage` tool with the agent's ID. `SendMessage` is only available when agent teams are enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

Subagent transcripts persist in `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`.

#### Auto-compaction

Subagents support automatic compaction. By default, triggers at ~95% capacity. Override with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`.

## Fork the current conversation

> Forked subagents are experimental and require Claude Code v2.1.117 or later. Enable with `CLAUDE_CODE_FORK_SUBAGENT=1`.

A fork is a subagent that **inherits the entire conversation so far** instead of starting fresh. It sees the same system prompt, tools, model, and message history. The fork's own tool calls stay out of your conversation and only its final result comes back.

Use a fork when a named subagent would need too much background to be useful, or when you want to try several approaches in parallel from the same starting point.

Enabling fork mode:
* Claude spawns a fork whenever it would otherwise use the general-purpose subagent
* Every subagent spawn runs in the background
* `/fork` spawns a fork instead of an alias for `/branch`

```text
/fork draft unit tests for the parser changes so far
```

### How forks differ from named subagents

|                         | Fork                             | Named subagent                                                                           |
| :---------------------- | :------------------------------- | :--------------------------------------------------------------------------------------- |
| Context                 | Full conversation history        | Fresh context with the prompt you pass                                                   |
| System prompt and tools | Same as main session             | From the subagent's definition file                                                      |
| Model                   | Same as main session             | From the subagent's `model` field                                                        |
| Permissions             | Prompts surface in your terminal | Auto-denied when running in the background                                               |
| Prompt cache            | Shared with main session         | Separate cache                                                                           |

Because a fork's system prompt and tool definitions are identical to the parent, its first request **reuses the parent's prompt cache**.

## Example subagents

> **Best practices:**
> * **Design focused subagents**: each should excel at one specific task
> * **Write detailed descriptions**: Claude uses the description to decide when to delegate
> * **Limit tool access**: grant only necessary permissions for security and focus
> * **Check into version control**: share project subagents with your team

### Code reviewer

```markdown
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation implemented
- Good test coverage
- Performance considerations addressed

Provide feedback organized by priority:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples of how to fix issues.
```

### Debugger

```markdown
---
name: debugger
description: Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues.
tools: Read, Edit, Bash, Grep, Glob
---

You are an expert debugger specializing in root cause analysis.

When invoked:
1. Capture error message and stack trace
2. Identify reproduction steps
3. Isolate the failure location
4. Implement minimal fix
5. Verify solution works

Debugging process:
- Analyze error messages and logs
- Check recent code changes
- Form and test hypotheses
- Add strategic debug logging
- Inspect variable states

For each issue, provide:
- Root cause explanation
- Evidence supporting the diagnosis
- Specific code fix
- Testing approach
- Prevention recommendations

Focus on fixing the underlying issue, not the symptoms.
```

### Data scientist

```markdown
---
name: data-scientist
description: Data analysis expert for SQL queries, BigQuery operations, and data insights. Use proactively for data analysis tasks and queries.
tools: Bash, Read, Write
model: sonnet
---

You are a data scientist specializing in SQL and BigQuery analysis.
[...]
```

### Database query validator

```markdown
---
name: db-reader
description: Execute read-only database queries. Use when analyzing data or generating reports.
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---

You are a database analyst with read-only access. Execute SELECT queries to answer questions about the data.
```

Validation script blocks SQL write operations:

```bash
#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then exit 0; fi

if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE)\b' > /dev/null; then
  echo "Blocked: Write operations not allowed. Use SELECT queries only." >&2
  exit 2
fi

exit 0
```

## Next steps

* Distribute subagents with plugins
* Run Claude Code programmatically with the Agent SDK for CI/CD
* Use MCP servers to give subagents access to external tools
