---
source_url: https://github.com/obra/superpowers/blob/main/README.md
fetched_at: 2026-05-24
title: Superpowers (obra/superpowers) — README
fetcher: claude-code WebFetch (raw.githubusercontent.com — gh CLI returned 401)
notes: WebFetch returned a summarized extract. License: MIT. Built by Jesse Vincent and Prime Radiant.
---

# Superpowers: Software Development Methodology for Coding Agents

## Overview

Superpowers represents a structured approach to agent-driven development.

> "A complete software development methodology for your coding agents, built on top of composable skills."

The system operates through a deliberate workflow that prioritizes planning before implementation. Rather than immediately writing code, the methodology first seeks clarity on objectives through conversation, then presents designs for validation before moving to execution.

## Core Workflow Stages

The development process unfolds across six major phases:

### 1. Design Phase

Conversation-driven refinement explores alternatives and presents designs in digestible sections for stakeholder approval, with documentation saved for reference.

### 2. Environment Setup

Git worktrees create isolated workspaces on dedicated branches, with project initialization and baseline verification.

### 3. Task Planning

Work breaks into focused **2-5 minute tasks** with exact specifications, file paths, and verification criteria.

### 4. Implementation

Either parallel subagent dispatch with two-stage review or sequential batch execution with human checkpoints.

### 5. Code Quality

Test-driven development enforces the **RED-GREEN-REFACTOR** pattern, requiring tests before implementation and deleting prematurely written code.

### 6. Review and Completion

Code review against specifications precedes merge decisions and cleanup.

## Skills Architecture

The system includes organized skill categories:

- **Testing**: Test-driven development cycles with anti-pattern documentation
- **Debugging**: Systematic root-cause investigation with defensive techniques
- **Collaboration**: Design refinement, planning, parallel workflows, and code review processes
- **Meta**: Skill creation and system introduction

## Installation Across Platforms

Setup instructions vary by coding agent environment:

- **Claude Code**: Official marketplace or Superpowers marketplace
- **Codex (CLI/App)**: Official plugin marketplace
- **Factory Droid, Gemini CLI, OpenCode, Cursor**: Platform-specific commands
- **GitHub Copilot CLI**: Marketplace registration required

## Design Principles

The methodology emphasizes:

1. **Test-first development** — tests precede implementation
2. **Systematic processes over reactive problem-solving** — don't just fix; understand why first
3. **Simplicity as a primary objective** — small, focused units
4. **Verification of results before completion claims** — evidence before assertions

## Notable Skills (selected, observed in the wild)

The repository implements ~30+ skills across these categories. Some observed names:

- `using-superpowers` — establishes how to find and use skills
- `verification-before-completion` — requires running verification commands before claiming completion
- `systematic-debugging` — use before proposing fixes for any bug/test failure
- `test-driven-development` — required before writing implementation code
- `writing-skills` — for creating/editing/verifying skills
- `using-git-worktrees` — for feature work needing isolation
- `requesting-code-review` — verify work meets requirements
- `receiving-code-review` — process review feedback
- `writing-plans` — for multi-step tasks before touching code
- `brainstorming` — required before any creative work
- `finishing-a-development-branch` — guide completion of dev work
- `executing-plans` — execute a written plan in a separate session with checkpoints
- `dispatching-parallel-agents` — for 2+ independent tasks without shared state
- `subagent-driven-development` — execute implementation plans with independent tasks

## Community and Contribution

Built by Jesse Vincent and Prime Radiant. Community participates through Discord, GitHub issues, and the contribution process outlined in the `writing-skills` documentation. MIT License.

---

> **NOTE**: WebFetch summarized rather than copied verbatim. For the actual README text (including install one-liners, marketplace IDs, and per-platform commands), visit the source URL directly.
