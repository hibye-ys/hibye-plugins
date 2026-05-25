---
source_url: https://github.com/openai/codex/blob/main/README.md
fetched_at: 2026-05-24
title: Codex CLI (openai/codex) — README
fetcher: claude-code WebFetch (raw.githubusercontent.com — gh CLI returned 401)
notes: WebFetch returned a summarized extract. License: Apache-2.0.
---

# Codex CLI - OpenAI's Local Coding Agent

## Overview

> "Codex CLI is a coding agent from OpenAI that runs locally on your computer."

This tool provides developers with an offline-capable assistant for programming tasks across multiple platforms.

## Installation Options

### Mac/Linux Installation

```shell
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

### Windows Installation

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

### Package Manager Alternatives

- npm: `npm install -g @openai/codex`
- Homebrew: `brew install --cask codex`

Users can also download platform-specific binaries directly from the GitHub releases page, with options for macOS (Apple Silicon or x86_64), Linux (x86_64 or arm64).

## Getting Started

After installation, run `codex` to begin. The tool integrates with ChatGPT accounts, supporting Plus, Pro, Business, Edu, and Enterprise plans. Users can authenticate via "Sign in with ChatGPT" or use API key authentication with additional configuration.

## IDE Integration & Alternatives

For code editor integration, Codex supports VS Code, Cursor, and Windsurf. A desktop application is available via `codex app`, and "Codex Web" provides cloud-based functionality at chatgpt.com/codex.

## Resources

The project maintains comprehensive documentation, contribution guidelines, and operates under the Apache-2.0 License.

---

> **NOTE**: WebFetch summarized the README rather than copying verbatim. For full content (configuration files, AGENTS.md spec, sandboxing model, etc.), fetch the raw README directly.
