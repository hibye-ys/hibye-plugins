---
source_url: https://code.claude.com/docs/en/plugins
fetched_at: 2026-05-24
title: Create plugins
fetcher: claude-code WebFetch
notes: Original URL https://docs.claude.com/en/docs/claude-code/plugins redirected (301) to code.claude.com.
---

# Create plugins

> Create custom plugins to extend Claude Code with skills, agents, hooks, and MCP servers.

Plugins let you extend Claude Code with custom functionality that can be shared across projects and teams.

## When to use plugins vs standalone configuration

| Approach                                                    | Skill names          | Best for                                                                                        |
| :---------------------------------------------------------- | :------------------- | :---------------------------------------------------------------------------------------------- |
| **Standalone** (`.claude/` directory)                       | `/hello`             | Personal workflows, project-specific customizations, quick experiments                          |
| **Plugins** (directories with `.claude-plugin/plugin.json`) | `/plugin-name:hello` | Sharing with teammates, distributing to community, versioned releases, reusable across projects |

**Use standalone configuration when**:
* You're customizing Claude Code for a single project
* The configuration is personal and doesn't need to be shared
* You're experimenting with skills or hooks before packaging them
* You want short skill names like `/hello` or `/deploy`

**Use plugins when**:
* You want to share functionality with your team or community
* You need the same skills/agents across multiple projects
* You want version control and easy updates for your extensions
* You're distributing through a marketplace
* You're okay with namespaced skills like `/my-plugin:hello`

## Quickstart

### Create your first plugin

1. **Create the plugin directory**:
   ```bash
   mkdir my-first-plugin
   ```

2. **Create the plugin manifest** at `my-first-plugin/.claude-plugin/plugin.json`:
   ```json
   {
     "name": "my-first-plugin",
     "description": "A greeting plugin to learn the basics",
     "version": "1.0.0",
     "author": { "name": "Your Name" }
   }
   ```

   | Field         | Purpose                                                                                                                                       |
   | :------------ | :-------------------------------------------------------------------------------------------------------------------------------------------- |
   | `name`        | Unique identifier and skill namespace. Skills are prefixed with this (e.g., `/my-first-plugin:hello`).                                       |
   | `description` | Shown in the plugin manager when browsing or installing plugins.                                                                              |
   | `version`     | Optional. If set, users only receive updates when you bump this field. If omitted and your plugin is distributed via git, the commit SHA is used. |
   | `author`      | Optional. Helpful for attribution.                                                                                                            |

3. **Add a skill** at `my-first-plugin/skills/hello/SKILL.md`:
   ```markdown
   ---
   description: Greet the user with a friendly message
   disable-model-invocation: true
   ---

   Greet the user warmly and ask how you can help them today.
   ```

4. **Test your plugin**:
   ```bash
   claude --plugin-dir ./my-first-plugin
   ```

   Then:
   ```text
   /my-first-plugin:hello
   ```

5. **Add skill arguments**:
   ```markdown
   ---
   description: Greet the user with a personalized message
   ---

   # Hello Skill

   Greet the user named "$ARGUMENTS" warmly...
   ```

   Run `/reload-plugins` to pick up changes.

## Plugin structure overview

> **Common mistake**: Don't put `commands/`, `agents/`, `skills/`, or `hooks/` inside the `.claude-plugin/` directory. Only `plugin.json` goes inside `.claude-plugin/`. All other directories must be at the plugin root level.

| Directory         | Location    | Purpose                                                                        |
| :---------------- | :---------- | :----------------------------------------------------------------------------- |
| `.claude-plugin/` | Plugin root | Contains `plugin.json` manifest (optional if components use default locations) |
| `skills/`         | Plugin root | Skills as `<name>/SKILL.md` directories                                        |
| `commands/`       | Plugin root | Skills as flat Markdown files. Use `skills/` for new plugins                   |
| `agents/`         | Plugin root | Custom agent definitions                                                       |
| `hooks/`          | Plugin root | Event handlers in `hooks.json`                                                 |
| `.mcp.json`       | Plugin root | MCP server configurations                                                      |
| `.lsp.json`       | Plugin root | LSP server configurations for code intelligence                                |
| `monitors/`       | Plugin root | Background monitor configurations in `monitors.json`                           |
| `bin/`            | Plugin root | Executables added to the Bash tool's `PATH` while the plugin is enabled        |
| `settings.json`   | Plugin root | Default settings applied when the plugin is enabled                            |

## Develop more complex plugins

### Add Skills to your plugin

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── code-review/
        └── SKILL.md
```

```yaml
---
description: Reviews code for best practices and potential issues. Use when reviewing code, checking PRs, or analyzing code quality.
---

When reviewing code, check for:
1. Code organization and structure
2. Error handling
3. Security concerns
4. Test coverage
```

After installing, run `/reload-plugins` to load the Skills.

### Add LSP servers to your plugin

For common languages, install the pre-built LSP plugins from the official marketplace. Create custom LSP plugins only when you need support for languages not already covered.

```json
{
  "go": {
    "command": "gopls",
    "args": ["serve"],
    "extensionToLanguage": { ".go": "go" }
  }
}
```

### Add background monitors to your plugin

Background monitors let your plugin watch logs, files, or external status in the background and notify Claude as events arrive.

```json
[
  {
    "name": "error-log",
    "command": "tail -F ./logs/error.log",
    "description": "Application error log"
  }
]
```

Each stdout line from `command` is delivered to Claude as a notification during the session.

### Ship default settings with your plugin

```json
{
  "agent": "security-reviewer"
}
```

This example activates the `security-reviewer` agent defined in the plugin's `agents/` directory. Settings from `settings.json` take priority over `settings` declared in `plugin.json`. Unknown keys are silently ignored.

### Test your plugins locally

```bash
claude --plugin-dir ./my-plugin
```

The flag also accepts a `.zip` archive (requires Claude Code v2.1.128+):

```bash
claude --plugin-dir ./my-plugin.zip
```

When a `--plugin-dir` plugin has the same name as an installed marketplace plugin, the local copy takes precedence for that session.

Multiple plugins:
```bash
claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two
```

To test a plugin already packaged as a `.zip` hosted at a URL:
```bash
claude --plugin-url https://example.com/my-plugin.zip
```

As you make changes, run `/reload-plugins` to pick up the updates without restarting.

### Debug plugin issues

1. **Check the structure**: Ensure your directories are at the plugin root, not inside `.claude-plugin/`
2. **Test components individually**: Check each skill, agent, and hook separately
3. **Use validation and debugging tools**

### Share your plugins

1. **Add documentation**: Include a `README.md`
2. **Choose a versioning strategy**: Decide whether to set an explicit `version` or rely on the git commit SHA
3. **Create or use a marketplace**: Distribute through plugin marketplaces
4. **Test with others**: Have team members test the plugin before wider distribution

### Submit your plugin to the community marketplace

Anthropic maintains two public marketplaces:

* **`claude-plugins-official`**: a curated set of plugins maintained by Anthropic. Available automatically in every Claude Code installation.
* **`claude-community`**: the public community marketplace where third-party submissions land after review.

To submit your plugin for community-marketplace review:
* **Claude.ai**: claude.ai/settings/plugins/submit
* **Console**: platform.claude.com/plugins/submit

Run `claude plugin validate` locally before you submit.

Approved plugins are pinned to a specific commit SHA in the `anthropics/claude-plugins-community` catalog.

The official marketplace, `claude-plugins-official`, is curated separately. Anthropic decides which plugins to include at its discretion. There is no application process.

## Convert existing configurations to plugins

### Migration steps

1. **Create the plugin structure**:
   ```bash
   mkdir -p my-plugin/.claude-plugin
   ```

   ```json
   {
     "name": "my-plugin",
     "description": "Migrated from standalone configuration",
     "version": "1.0.0"
   }
   ```

2. **Copy your existing files**:
   ```bash
   cp -r .claude/commands my-plugin/
   cp -r .claude/agents my-plugin/
   cp -r .claude/skills my-plugin/
   ```

3. **Migrate hooks** to `my-plugin/hooks/hooks.json`:
   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "Write|Edit",
           "hooks": [{ "type": "command", "command": "jq -r '.tool_input.file_path' | xargs npm run lint:fix" }]
         }
       ]
     }
   }
   ```

4. **Test your migrated plugin**:
   ```bash
   claude --plugin-dir ./my-plugin
   ```

### What changes when migrating

| Standalone (`.claude/`)       | Plugin                           |
| :---------------------------- | :------------------------------- |
| Only available in one project | Can be shared via marketplaces   |
| Files in `.claude/commands/`  | Files in `plugin-name/commands/` |
| Hooks in `settings.json`      | Hooks in `hooks/hooks.json`      |
| Must manually copy to share   | Install with `/plugin install`   |
