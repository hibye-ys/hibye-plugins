---
source_url: https://code.claude.com/docs/en/hooks
fetched_at: 2026-05-24
title: Claude Code Hooks Reference
fetcher: claude-code WebFetch
notes: Original URL https://docs.claude.com/en/docs/claude-code/hooks redirected (301) to code.claude.com. Content is a summary extracted by WebFetch's processing model (page is long).
---

# Claude Code Hooks Reference

A comprehensive reference for Claude Code hook events, configuration, JSON I/O formats, and advanced features.

## Overview

Hooks are user-defined shell commands, HTTP endpoints, or LLM prompts that execute automatically at specific points in Claude Code's lifecycle. They enable workflow automation, security enforcement, permission management, and environment integration.

## Hook Lifecycle

Hooks fire at three cadences:
- **Once per session**: `SessionStart`, `SessionEnd`
- **Once per turn**: `UserPromptSubmit`, `Stop`, `StopFailure`
- **On every tool call**: `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PostToolUseFailure`

Plus async events like `FileChanged`, `ConfigChange`, `CwdChanged`, `WorktreeCreate`, `WorktreeRemove`, and compaction events.

## Configuration

### Hook Locations

| Location | Scope | Shareable |
|----------|-------|-----------|
| `~/.claude/settings.json` | All projects | No |
| `.claude/settings.json` | Single project | Yes |
| `.claude/settings.local.json` | Single project, gitignored | No |
| Plugin `hooks/hooks.json` | When plugin enabled | Yes |
| Skill/agent frontmatter | While component active | Yes |

### Three-Level Nesting Structure

1. **Hook Event** (e.g., `PreToolUse`, `Stop`)
2. **Matcher Group** (filter by tool name, event type, etc.)
3. **Hook Handlers** (the actual command, HTTP, MCP tool, or prompt)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/script.sh",
            "args": []
          }
        ]
      }
    ]
  }
}
```

### Matcher Patterns

| Pattern | Type | Example |
|---------|------|---------|
| `"*"`, `""`, omitted | Match all | Fires on every occurrence |
| Letters, digits, `_`, `\|` | Exact string or list | `Bash` or `Edit\|Write` |
| Other characters | Regex | `^Notebook`, `mcp__memory__.*` |

**MCP Tool Matching**: Tools follow the pattern `mcp__<server>__<tool>`. Use `mcp__memory__.*` to match all tools from the memory server.

### Hook Handler Types

#### 1. Command Hooks

```json
{
  "type": "command",
  "command": "bash /path/to/script.sh",
  "args": [],
  "async": false,
  "timeout": 600,
  "shell": "bash"
}
```

**Exec Form** (when `args` is set):
- No shell, direct executable spawn
- Each `args` element is one argument
- Path placeholders substituted as plain strings
- No special character interpretation

```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/script.js", "--fix"]
}
```

**Shell Form** (when `args` omitted):
- Passed to shell (`sh -c`, PowerShell, or Git Bash)
- Supports pipes, `&&`, globs, variable expansion
- Requires quoting for paths with spaces

#### 2. HTTP Hooks

```json
{
  "type": "http",
  "url": "http://localhost:8080/hooks/pre-tool-use",
  "headers": { "Authorization": "Bearer $MY_TOKEN" },
  "allowedEnvVars": ["MY_TOKEN"],
  "timeout": 600
}
```

POST the JSON input; 2xx responses are success. Non-2xx is non-blocking error. Return 2xx with JSON to block or deny.

#### 3. MCP Tool Hooks

```json
{
  "type": "mcp_tool",
  "server": "my_server",
  "tool": "security_scan",
  "input": { "file_path": "${tool_input.file_path}" },
  "timeout": 600
}
```

#### 4. Prompt Hooks

```json
{
  "type": "prompt",
  "prompt": "Should this be allowed? Context: $ARGUMENTS",
  "model": "claude-3-5-sonnet-20241022",
  "timeout": 30
}
```

#### 5. Agent Hooks

```json
{
  "type": "agent",
  "name": "security-reviewer",
  "timeout": 60
}
```

Experimental.

### Common Hook Fields

| Field | Required | Description |
|-------|----------|-------------|
| `type` | yes | `"command"`, `"http"`, `"mcp_tool"`, `"prompt"`, or `"agent"` |
| `if` | no | Permission rule filter: `"Bash(git *)"`, `"Edit(*.ts)"`. Tool events only |
| `timeout` | no | Seconds to cancel. Defaults: 600 for command/http/mcp_tool; 30 for prompt; 60 for agent |
| `statusMessage` | no | Custom spinner message while running |
| `once` | no | If true, runs once per session then removed (skill/agent frontmatter only) |

### Path Placeholders

- `${CLAUDE_PROJECT_DIR}`: Project root
- `${CLAUDE_PLUGIN_ROOT}`: Plugin installation directory
- `${CLAUDE_PLUGIN_DATA}`: Plugin persistent data directory

## Hook Input and Output

### Common Input Fields

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "agent_id": "optional-subagent-id",
  "agent_type": "optional-agent-name",
  "effort": { "level": "medium" }
}
```

### Exit Codes

- **Exit 0**: Success. Parse stdout for JSON output. No JSON = no decision.
- **Exit 2**: Blocking error. Ignore stdout, feed stderr to Claude. Action blocked.
- **Other non-zero**: Non-blocking error. First line of stderr shown in transcript.

### JSON Output

Exit 0 with JSON on stdout gives fine-grained control:

```json
{
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "Warning text for user",
  "terminalSequence": "\033]777;notify;Title;Body\007",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Information for Claude",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Not allowed"
  }
}
```

**Universal Fields**:
- `continue` (default: true): If false, stop all processing
- `stopReason`: Message when `continue` is false
- `suppressOutput`: Hide hook stdout from transcript
- `systemMessage`: Warning for user
- `terminalSequence`: Terminal escape sequences (OSC 0/1/2/9/99/777 and BEL only)

### Emit Terminal Notifications (v2.1.141+)

Since hooks have no controlling terminal, use `terminalSequence`:

```bash
#!/bin/bash
seq=$(printf '\033]777;notify;Claude Code;Build completed\007')
jq -nc --arg seq "$seq" '{terminalSequence: $seq}'
```

Allowed sequences: OSC 0/1/2 (window/icon titles), OSC 9 (iTerm2 etc), OSC 99 (Kitty), OSC 777 (urxvt, Ghostty, Warp), bare BEL.

## Key Hook Events

### SessionStart

Runs when session begins or resumes.

**Matcher values**: `startup`, `resume`, `clear`, `compact`

**Input fields**: `source`, `model`

**Decision control**:
- `additionalContext`: Context added before first prompt
- `initialUserMessage`: First turn message for non-interactive mode
- `watchPaths`: Array of paths to watch for `FileChanged` events

Persist environment variables:

```bash
#!/bin/bash
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export NODE_ENV=production' >> "$CLAUDE_ENV_FILE"
fi
```

### Setup

Fires with `--init-only`, `--init -p`, or `--maintenance -p`. For one-time setup not per-session.

**Matcher values**: `init`, `maintenance`

**Decision control**: `additionalContext` only.

### UserPromptSubmit

Runs before Claude processes a user prompt. Validate, block, or add context.

**Input fields**: `prompt`

**Decision control**:
- `decision: "block"`: Prevent prompt processing
- `reason`: Explanation for block
- `additionalContext`: Context added alongside prompt
- `sessionTitle`: Auto-name the session
- `suppressOriginalPrompt`: Hide original prompt when blocking

### PreToolUse

Runs before a tool call executes. Match on tool name.

**Tool-specific input examples**:

Bash:
```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run tests",
    "timeout": 120000,
    "run_in_background": false
  }
}
```

Write/Edit/Read have their own `tool_input` shapes.

**Decision control** (`hookSpecificOutput`):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask|defer",
    "permissionDecisionReason": "Why this decision",
    "additionalContext": "Context for Claude",
    "updatedInput": { "command": "modified command" }
  }
}
```

### PostToolUse / PostToolUseFailure

Run after tool succeeds or fails. **Cannot block** (tool already ran).

**Decision control**:
- `decision: "block"`: Block next model call (stops agentic loop)
- `additionalContext`: Add context from tool results
- `reason`: Why blocking

### PermissionRequest

Fires when permission dialog appears. Auto-approve or deny on behalf of user.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow|deny",
      "updatedInput": { "command": "safe version" },
      "applyRule": "Bash(safe *)"
    }
  }
}
```

### Stop / SubagentStop

Runs when Claude finishes responding or subagent completes.

**Decision control**:
- `decision: "block"`: Prevent stopping, continue conversation
- `reason`: Why blocking

### FileChanged

Async event when watched files change. Matcher specifies filenames.

```json
{ "matcher": ".envrc|.env", "hooks": [...] }
```

**Input**: `file_path`, `change_type` (created|modified|deleted). Has access to `CLAUDE_ENV_FILE`.

### ConfigChange

Fires when config files change during session.

**Matcher values**: `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills`

Can block (except policy_settings).

### CwdChanged

Async. Input: `old_cwd`, `new_cwd`. Has access to `CLAUDE_ENV_FILE`.

### InstructionsLoaded

Fires when `CLAUDE.md` or `.claude/rules/*.md` loaded.

**Matcher values**: `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact`

**No blocking**: Used for audit, compliance, observability only.

### Elicitation / ElicitationResult

Handle MCP server user input requests.

### SessionEnd

Runs when session terminates. No blocking. Use for cleanup.

## Example Hooks

### Block Destructive Bash Commands

```bash
#!/bin/bash
COMMAND=$(jq -r '.tool_input.command')
if echo "$COMMAND" | grep -q 'rm -rf'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Destructive rm -rf blocked"
    }
  }'
else
  exit 0
fi
```

### Lint After File Writes

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "/path/to/lint-check.sh", "timeout": 30 }
        ]
      }
    ]
  }
}
```

### Inject Environment Context (SessionStart)

```bash
#!/bin/bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
CHANGES=$(git diff --name-only 2>/dev/null | wc -l)
jq -n --arg branch "$BRANCH" --arg changes "$CHANGES" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: "Current branch: \($branch)\nUncommitted files: \($changes)"
  }
}'
```

## Advanced Features

### Async Hooks

```json
{ "type": "command", "command": "npm run build", "async": true }
```

Use `asyncRewake` to wake Claude on exit code 2.

### Hooks in Skills and Agents

```yaml
---
name: secure-operations
description: Security-checked operations
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
---
```

The `once: true` flag runs the hook once per session then removes it.

### The `/hooks` Menu

Type `/hooks` to browse configured hooks. Read-only browser (edit via JSON).

### Disable Hooks

```json
{ "disableAllHooks": true }
```

Managed settings hierarchy respected: user/project settings cannot override managed hooks.

## Context Management

`additionalContext` injects facts into context as system reminders. Context exceeding 10,000 characters is saved to a file with preview shown to Claude.

## Troubleshooting

### Hook Timeout

Increase `timeout` field. UserPromptSubmit default: 30s. Others: 600s.

### Debugging

Run with `--debug` to see full hook output in debug log.

### JSON Validation Failed

Ensure hook stdout contains only JSON on exit 0. Profile startup text interferes — redirect to `/dev/null`.

## Best Practices

1. **Keep hooks fast**: SessionStart and UserPromptSubmit have tight time windows
2. **Use `if` field for tool filtering**: Narrower than matchers, avoid process spawn overhead
3. **Exit 0 without output for "no decision"**: Allows normal flow to continue
4. **Use `additionalContext` for facts**: Not system commands; avoid prompt injection
5. **Reference scripts by path placeholders**: Works regardless of `cwd`
6. **Use exec form with `args`** for path placeholders: No quoting needed
7. **Environment variables**: Explicitly list in `allowedEnvVars` for HTTP hooks
8. **For CI/setup**: Use `Setup` event with `--init-only`, not SessionStart
9. **Test with `/hooks` menu**: Verify configuration and source before deployment
