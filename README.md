# hibye-plugins

Shared agent assets marketplace for Claude Code + Codex.

## Status

M0 spike (2026-05-21~) — verifying spec v2.1 assumptions.

## Plugins

- `core` — Universal LLM backend principles + workflows.
- `deprecated-example` — Test fixture (M0 #10).

## Install (Claude Code)

```bash
/plugin marketplace add /Users/youngseoklee/Desktop/workplace/hibye-plugins
/plugin install core@hibye-plugins
```

## Register (Codex)

`~/.codex/config.toml`:

```toml
[marketplaces.hibye]
source_type = "local"
source = "/Users/youngseoklee/Desktop/workplace/hibye-plugins"
```

Project-side activation: `project/.codex/skills/core -> <marketplace>/plugins/core/skills/`
