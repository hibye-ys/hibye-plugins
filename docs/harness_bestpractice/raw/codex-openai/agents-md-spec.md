---
source_url: https://agentskills.io/specification
fetched_at: 2026-05-24
title: Agent Skills — Specification
fetcher: claude-code WebFetch
notes: This is the open Agent Skills format specification (open standard maintained on agentskills.io). Note that the task brief referenced "AGENTS.md" (a separate concept from openai/codex), but openai/codex AGENTS.md is currently a `CLAUDE.md`-equivalent project-instructions file rather than a formal spec. The Agent Skills spec below is the closest cross-agent open standard with a published schema.
---

# Specification

> The complete format specification for Agent Skills.

## Directory structure

A skill is a directory containing, at minimum, a `SKILL.md` file:

```
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
├── assets/           # Optional: templates, resources
└── ...               # Any additional files or directories
```

## `SKILL.md` format

The `SKILL.md` file must contain YAML frontmatter followed by Markdown content.

### Frontmatter

| Field           | Required | Constraints                                                                                                       |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `name`          | Yes      | Max 64 characters. Lowercase letters, numbers, and hyphens only. Must not start or end with a hyphen.             |
| `description`   | Yes      | Max 1024 characters. Non-empty. Describes what the skill does and when to use it.                                 |
| `license`       | No       | License name or reference to a bundled license file.                                                              |
| `compatibility` | No       | Max 500 characters. Indicates environment requirements (intended product, system packages, network access, etc.). |
| `metadata`      | No       | Arbitrary key-value mapping for additional metadata.                                                              |
| `allowed-tools` | No       | Space-separated string of pre-approved tools the skill may use. (Experimental)                                    |

**Minimal example:**

```markdown
---
name: skill-name
description: A description of what this skill does and when to use it.
---
```

**Example with optional fields:**

```markdown
---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
license: Apache-2.0
metadata:
  author: example-org
  version: "1.0"
---
```

#### `name` field

* Must be 1-64 characters
* May only contain unicode lowercase alphanumeric characters (`a-z`, `0-9`) and hyphens (`-`)
* Must not start or end with a hyphen (`-`)
* Must not contain consecutive hyphens (`--`)
* Must match the parent directory name

**Valid examples:**
```yaml
name: pdf-processing
name: data-analysis
name: code-review
```

**Invalid examples:**
```yaml
name: PDF-Processing  # uppercase not allowed
name: -pdf  # cannot start with hyphen
name: pdf--processing  # consecutive hyphens not allowed
```

#### `description` field

* Must be 1-1024 characters
* Should describe both what the skill does and when to use it
* Should include specific keywords that help agents identify relevant tasks

**Good example:**
```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.
```

**Poor example:**
```yaml
description: Helps with PDFs.
```

#### `license` field

* Specifies the license applied to the skill
* Recommended to keep it short (either the name of a license or the name of a bundled license file)

```yaml
license: Proprietary. LICENSE.txt has complete terms
```

#### `compatibility` field

* Must be 1-500 characters if provided
* Should only be included if your skill has specific environment requirements
* Can indicate intended product, required system packages, network access needs, etc.

```yaml
compatibility: Designed for Claude Code (or similar products)
compatibility: Requires git, docker, jq, and access to the internet
compatibility: Requires Python 3.14+ and uv
```

> Most skills do not need the `compatibility` field.

#### `metadata` field

* A map from string keys to string values
* Clients can use this to store additional properties not defined by the Agent Skills spec
* Make key names reasonably unique to avoid accidental conflicts

```yaml
metadata:
  author: example-org
  version: "1.0"
```

#### `allowed-tools` field

* A space-separated string of tools that are pre-approved to run
* Experimental. Support for this field may vary between agent implementations

```yaml
allowed-tools: Bash(git:*) Bash(jq:*) Read
```

### Body content

The Markdown body after the frontmatter contains the skill instructions. There are no format restrictions.

Recommended sections:
* Step-by-step instructions
* Examples of inputs and outputs
* Common edge cases

Note that the agent will load this entire file once it's decided to activate a skill. Consider splitting longer `SKILL.md` content into referenced files.

## Optional directories

### `scripts/`

Contains executable code that agents can run. Scripts should:
* Be self-contained or clearly document dependencies
* Include helpful error messages
* Handle edge cases gracefully

Supported languages depend on the agent implementation. Common options include Python, Bash, and JavaScript.

### `references/`

Contains additional documentation that agents can read when needed:
* `REFERENCE.md` - Detailed technical reference
* `FORMS.md` - Form templates or structured data formats
* Domain-specific files (`finance.md`, `legal.md`, etc.)

Keep individual reference files focused. Agents load these on demand, so smaller files mean less use of context.

### `assets/`

Contains static resources:
* Templates (document templates, configuration templates)
* Images (diagrams, examples)
* Data files (lookup tables, schemas)

## Progressive disclosure

Agents load skills **progressively**, pulling in more detail only as a task calls for it:

1. **Metadata** (~100 tokens): The `name` and `description` fields are loaded at startup for all skills
2. **Instructions** (< 5000 tokens recommended): The full `SKILL.md` body is loaded when the skill is activated
3. **Resources** (as needed): Files (e.g. those in `scripts/`, `references/`, or `assets/`) are loaded only when required

Keep your main `SKILL.md` under 500 lines. Move detailed reference material to separate files.

## File references

When referencing other files in your skill, use relative paths from the skill root:

```markdown
See [the reference guide](references/REFERENCE.md) for details.

Run the extraction script:
scripts/extract.py
```

Keep file references one level deep from `SKILL.md`. Avoid deeply nested reference chains.

## Validation

Use the [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) reference library to validate your skills:

```bash
skills-ref validate ./my-skill
```

This checks that your `SKILL.md` frontmatter is valid and follows all naming conventions.

## Adopters / Compatible Clients (as of fetch date)

The agentskills.io homepage lists the following agent clients implementing this open standard (selected subset):

- **Anthropic**: Claude Code, claude.ai
- **OpenAI**: Codex
- **Google**: Gemini CLI
- **Microsoft**: VS Code, GitHub Copilot
- **JetBrains**: Junie
- **Cursor**, **Amp**, **Letta**, **Goose**, **OpenHands**, **OpenCode**, **Roo Code**
- **Databricks Genie Code**, **Snowflake Cortex Code**
- **Factory**, **Kiro**, **Workshop**, **Trae**, **Tabnine**
- **Laravel Boost**, **Spring AI** (framework integrations)
- **Mistral AI Vibe**, **fast-agent**, **nanobot**, **pi**, **bub**

(Full list and instruction links at https://agentskills.io)
