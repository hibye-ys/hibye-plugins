---
source_url: https://dev.to/muhammad_moeed/claude-code-skills-a-practical-guide-for-2026-3f6p
fetched_at: 2026-05-24
title: Claude Code Skills — A Practical Guide for 2026
fetcher: claude-code WebFetch
author: Muhammad Moeed (dev.to)
notes: Hands-on practitioner guide with concrete skill examples and common mistakes.
---

# Claude Code Skills: A Practical Guide for 2026

## What a Claude Code Skill Actually Is

A skill is a directory containing a single `SKILL.md` file with two components:

1. **YAML frontmatter** with `name` and `description` fields
2. **Markdown instructions** that Claude follows when the skill activates

The minimal valid skill structure:

```
.claude/skills/run-tests/
└── SKILL.md
```

Example content:

```yaml
---
name: run-tests
description: "Run the project's test suite using the Makefile target. Use this whenever the user asks to run tests, check tests, or verify the test suite is passing."
---

Run `make test` from the repo root. If the command fails, read the failing test
output, point out the specific assertion that broke, and ask before changing
anything in the source files.
```

## How Claude Picks Up a Skill

Skills operate through auto-discovery:

1. Claude reads descriptions of all available skills
2. It compares your message against those descriptions
3. If a match occurs, the full skill content loads into conversation
4. No match = default behavior with no skill loaded

**The description is critical.** It's Claude's only reference point for deciding when to activate a skill. Vague descriptions ("Helps with tests") rarely trigger. Specific ones ("Runs the project's pytest suite when the user asks to run, check, or verify tests") fire reliably.

> Test your description by reading it aloud — it should begin with a clear action verb and end with explicit triggers.

## Where Skills Live

| Location | Scope | Use Case |
|----------|-------|----------|
| `.claude/skills/<name>/` in repo | Project | Workflows specific to one codebase |
| `~/.claude/skills/<name>/` in home | Personal | Workflows needed everywhere |
| Plugin/package locations | Team | Skills distributed to others |

Project skills override personal ones when conflicts exist. Skills in repositories are committed to git by default, which is appropriate since they're usually brief and benefit all collaborators.

## Building a Skill From Scratch

### Step 1: Create the Directory

```bash
mkdir -p .claude/skills/conventional-commit
```

### Step 2: Write SKILL.md

```yaml
---
name: conventional-commit
description: Use this skill any time the user asks for a git commit, to commit changes, or to write a commit message. It writes the message in Conventional Commit format.
---

When you create a git commit, follow these rules.

1. Start the subject line with one of: feat, fix, chore, docs, refactor, test, perf.
2. Add a colon and a space, then a short imperative summary, no period.
3. Keep the subject under 70 characters.
4. If the change touches more than two files, add a one-line body that says why.

Example:

  feat: add IndexNow ping to publish workflow

  Auto-pings Bing on every push to main so new posts get indexed faster.
```

### Step 3: Test the Skill

Restart Claude Code and request a commit. Claude should pull in the skill and follow the specified format.

If it doesn't activate, revise the description to match your actual language when requesting commits.

## Skills vs. Slash Commands vs. Subagents

### Skills
- Auto-discovered based on message content
- Work within the main conversation for visibility
- Best for: repeated workflows (commit formatting, test running, PR conventions)

### Slash Commands
- Manually invoked with `/command-name`
- A single skill file provides both auto-discovery AND slash command functionality
- Best for: explicit control over when something executes

### Subagents
- Run in isolated, fresh contexts separate from main conversation
- Receive a brief from Claude and report results back
- Best for: heavy tasks you want offloaded (repository searches, lengthy evaluations, large diff summaries)

**Practical rule:** Use skills for small work that should remain visible. Use subagents for substantial work that should run separately. Use slash commands when you need manual entry points.

## Three Practical Skills Worth Implementing

### 1. lint-after-edit

```yaml
---
name: lint-after-edit
description: Run the project's linter after any code edit. Use any time the user asks Claude to edit, refactor, fix, or modify a source file.
---

After completing any edit to a .ts, .tsx, .js, or .py file, run `npm run lint`
(or `ruff check .` for Python). If the lint fails, fix the warnings before
reporting that the edit is done.
```

### 2. pr-description

```yaml
---
name: pr-description
description: Write a pull request description from the current branch's commits. Use any time the user asks for a PR description, PR body, or pull request summary.
---

Read `git log main..HEAD` and write a PR description in this format.

## Summary
One short paragraph, no marketing language.

## Changes
- One bullet per logical change, not per commit.

## Test plan
- A checklist a reviewer can run.

Do not include emojis, do not start lines with "This PR".
```

### 3. clean-imports

```yaml
---
name: clean-imports
description: Remove unused imports and sort the rest. Use any time the user asks to clean imports, sort imports, or tidy imports in a file.
---

For each file the user asks to clean:

1. Remove imports that are not referenced anywhere in the file.
2. Sort what remains by: standard library, then third-party, then local.
3. Group each section with a blank line between them.

Do not touch import side effects (imports with no name).
```

## Best Practices That Matter

### One Skill, One Job

Avoid mega-skills attempting to handle multiple workflows. Split them into focused, single-screen skills. Mega-skills load late, fire unreliably, and confuse Claude when parts conflict.

### Write Descriptions as Triggers, Not Labels

**Poor:** "A skill for working with tests."

**Strong:** "Run the project's pytest suite when the user asks to run tests, check tests, or verify the test suite is passing."

Descriptions should name the specific verbs and phrases users actually type.

### Keep Instructions Imperative

Prefer direct action language ("Run X. Then Y. If Z, do W.") over documentation-style descriptions ("This skill is responsible for..."). Direct verbs map cleanly to executable tasks.

### Resist Over-Scripting

While you can include Python or shell scripts in skill folders, plain markdown instructions suffice for most workflows and are easier to maintain. Use scripts only for genuinely deterministic tasks.

## Common Mistakes to Avoid

- **Generic descriptions:** Descriptions starting with "A skill that helps with..." rarely activate. Lead with action verbs.
- **Wrong folder location:** `~/.claude/skills/` is for personal use across projects; `.claude/skills/` is project-specific. Mixing them causes skills to be missed.
- **Confusing with CLAUDE.md:** Skills handle triggered workflows. CLAUDE.md provides always-on project context. They're complementary, not substitutes.
- **Forgetting to restart:** Skills load at session start. Add one mid-conversation? End the session and start fresh. *(Note: contradicts official docs, which document live change detection. The author's advice is conservative and works regardless of harness version.)*
- **Storing secrets in SKILL.md:** These files are committed to git. Treat them like source code, never as configuration storage.

## Frequently Asked Questions

**Where do project skills belong?**
Inside your repo at `.claude/skills/<skill-name>/SKILL.md`. The folder commits to git unless explicitly ignored.

**How do skills differ from slash commands?**
A skill file IS a slash command. The same file provides both auto-discovery AND manual `/skill-name` invocation.

**How do skills differ from subagents?**
Subagents run isolated, fresh contexts. Skills run in your current conversation. Choose skills for visible work; subagents for offloaded tasks.

**Can skills reference external scripts?**
Yes. Include shell or Python scripts in the skill folder and reference them from SKILL.md. For most workflows, plain markdown suffices.

**Should skills go in CLAUDE.md instead?**
No. CLAUDE.md is for always-on project context. Putting every workflow there bloats the main context and slows performance.

## Why Skills Matter

Skills eliminate repeated friction — that daily repetition of telling Claude the same instructions. A well-designed skill is invisible: "the work just gets done the way you wanted" without ongoing effort.

Start small with one basic skill (commit formatting, lint rules, PR templates). Once working, add the next. Within weeks, you'll have a folder of minimal files that quietly shape Claude's behavior on your project.

Skills fit comfortably between lightweight hooks and fuller MCP servers: lighter than a server, more flexible than a hook, and easier to share than either.
