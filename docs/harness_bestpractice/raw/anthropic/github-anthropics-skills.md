---
source_url: https://github.com/anthropics/skills/blob/main/README.md
fetched_at: 2026-05-24
title: anthropics/skills — README
fetcher: claude-code WebFetch (raw.githubusercontent.com — gh CLI returned 401)
notes: WebFetch returned a summarized extract rather than verbatim copy. gh CLI was unavailable (Bad credentials).
---

# Skills Repository (anthropics/skills) - README Summary

## Overview

This repository houses Anthropic's implementation of skills for Claude.

> "Skills are folders of instructions, scripts, and resources that Claude loads dynamically to improve performance on specialized tasks."

## Key Concepts

**What Skills Do:**

Skills enable Claude to handle specialized work consistently, whether that involves applying brand guidelines to documents, executing organizational workflows for data analysis, or streamlining personal automation tasks.

## Repository Contents

| Section | Purpose |
|---------|---------|
| `./skills` | Example collections across creative, technical, enterprise, and document categories |
| `./spec` | Agent Skills specification documentation |
| `./template` | Starter template for new skill creation |

**Document Skills:** The repository includes source-available implementations for **DOCX, PDF, PPTX, and XLSX** manipulation that power Claude's document capabilities.

## Integration Methods

**Claude Code:** Install via marketplace with commands like:
```
/plugin install document-skills@anthropic-agent-skills
```

**Claude.ai:** Skills are available to paid users; custom skills can be uploaded following platform guidelines

**Claude API:** Both pre-built and custom skills integrate through the Skills API

## Creating Skills

The minimal structure requires a folder containing `SKILL.md` with YAML frontmatter specifying:
- `name` (unique identifier)
- `description` (purpose and usage context)

The markdown body contains instructions, examples, and guidelines Claude will follow when that skill activates.

## Important Disclaimer

> "These skills are provided for demonstration and educational purposes only."

Implementation details may vary from actual Claude behavior.

---

> **NOTE**: This is a summary; for verbatim content, fetch the raw README from `https://raw.githubusercontent.com/anthropics/skills/main/README.md` directly with a tool that streams the full body.
