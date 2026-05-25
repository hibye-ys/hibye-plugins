---
source_url: https://generativeprogrammer.com/p/skill-authoring-patterns-from-anthropics
fetched_at: 2026-05-24
title: Skill Authoring Patterns from Anthropic's Best Practices
fetcher: claude-code WebFetch
author: Generative Programmer (Substack)
notes: Distills 14 recurring design patterns observed in the wild from Anthropic's best practices document. High signal for anti-patterns and trade-offs.
---

# Skill Authoring Patterns from Anthropic's Best Practices

A practical breakdown of recurring design patterns for effective Claude Skills, from activation metadata to executable helpers.

## Overview

Skills extend Claude's capabilities in two forms:

- **Task skills** (often `disable-model-invocation: true`): Step-by-step workflows users invoke directly via `/skill-name`
- **Reference skills** (`user-invocable: false`): Passive knowledge applied inline when requests match

The 14 patterns organize into five categories: discovery/selection, context economy, instruction calibration, workflow control, and executable code.

---

## Discovery and Selection

### 1. Activation Metadata Pattern

At session start, Claude sees only skill `name` and `description` before selecting which ones to use. Vague descriptions like "helps with documents" lead to wrong or missing skill invocations.

The pattern packs descriptions with both function and specific triggers in third person. Anthropic recommends deliberately "pushy" language: "Make sure to use this skill whenever the user mentions dashboards, data visualization, or internal metrics, even if they do not explicitly ask for a dashboard."

**Trade-off**: Budget constraints. The `description` field caps at 1024 characters in the open Agent Skills spec; Claude Code limits combined `description` and `when_to_use` text to 1536 characters. Every sentence competes for space.

**Use**: On every skill. Nothing else matters if selection fails.

### 2. Exclusion Clause Pattern

Positive triggers alone miss half the job — skills trigger on tangential requests, hijack work belonging elsewhere, or activate when bare Claude suffices.

End descriptions with explicit exclusions: "Do NOT use for blog articles, newsletters, emails, tweets, or long-form content." This is called **"the single most important line in the description"** by practitioners, as positive triggers pull skills in while exclusions push them out.

**Trade-off**: Maintenance burden. As skill libraries grow, exclusion clauses must stay synchronized across related skills.

**Use**: For any skill sharing vocabulary with other skills or base Claude.

---

## Context Economy

### 3. Context Budget Pattern

Skills that re-explain concepts Claude already knows waste tokens. Multiply such waste across 20 skills and the context window fills before users finish their request.

Demand each paragraph justify its token cost. Default assumption: Claude is competent. Remove sentences a skilled reader wouldn't miss. Pick consistent terminology ("always use 'field,' never 'field/box/element'"). Avoid time-sensitive phrasing; store legacy information in separate appendices instead.

**Trade-off**: Less capable models need more detail. Multi-model support requires aiming at the weakest target.

**Use**: Baseline discipline on every skill.

### 4. Progressive Disclosure Pattern

Stuffing every detail into SKILL.md burns context whether users need that material or not. An 800-line SKILL.md with forms, references, and examples costs the same regardless of actual task requirements.

Treat SKILL.md as a table of contents. Keep it under 500 lines and link to domain files (`FORMS.md`, `REFERENCE.md`, `reference/finance.md`). Claude loads metadata on every session, SKILL.md only when triggered, and detail files only when the current task references them. Scripts execute without loading their internal code.

Keep the reference graph shallow — every file one hop from SKILL.md. Nested chains increase odds Claude only partially reads targets. Long reference files (hundreds of lines) need a table of contents so Claude sees the full scope even from truncated reads.

**Trade-off**: Fragmentation makes it harder for authors to hold the whole skill in mind, and Claude must make correct routing decisions about which file loads next.

**Use**: For any skill pushing past ~300 lines in SKILL.md.

---

## Instruction Calibration

### 5. Control Tuning Pattern

Rigid scripts strangle Claude on tasks where context should shape approach. Loose guidance fails on fragile procedures where one wrong step breaks everything.

Match instruction freedom to task fragility:

- **High freedom** (text instructions, "use your judgment"): Open-field tasks like code review with many valid approaches
- **Medium freedom** (pseudocode, parameterized scripts): Preferred-but-flexible flows like deploy runbooks
- **Low freedom** (exact scripts, no flags, "do not modify"): Fragile operations like database migrations

Tone shapes the dial too. Opening with a persona ("You are a senior code reviewer focused on correctness") sets the judgment rubric for the entire skill, common in reference skills that shape voice.

**Trade-off**: Authors consistently over-constrain because rigid instructions feel safer. They fail differently, not better.

**Use**: By asking for each step how much variance is acceptable.

### 6. Explain-the-Why Pattern

All-caps rules (ALWAYS, NEVER, MUST) without context leave Claude following the letter while missing edge cases or over-applying rules in situations requiring judgment.

State the rule, then explain why, so Claude generalizes to unanticipated cases. **"Use constructor injection. Field injection breaks testability because we cannot mock the field without Spring context"** beats "MUST use constructor injection. NEVER use field injection." Reasoning becomes the rubric for unanticipated scenarios.

**Trade-off**: Explanations cost tokens. Reserve prose-with-reasoning for cases where Claude exercises judgment; bare imperatives work for genuinely fragile steps.

**Use**: Wherever you reach for capitalized imperatives.

### 7. Template Scaffold Pattern

When output structure matters — reports, commit messages, API payloads, release notes — Claude produces inconsistent shapes across invocations without explicit templates.

Ship a template in the skill body with placeholders Claude fills. Templates come in two strictness levels:

- **Strict**: "ALWAYS use this exact template structure" for data contracts or machine-parsed output
- **Flexible**: "A sensible default; adapt sections as needed" for documents where you trust Claude's judgment

**Trade-off**: Strict templates suppress structural variation that can make output more useful in edge cases.

**Use**: Whenever output structure has downstream readers or parsers.

### 8. In-Skill Examples Pattern

Descriptions rarely convey tone, formatting conventions, or the right detail level. Claude hits the correct shape but wrong style.

Embed concrete input/output pairs in the skill body using few-shot techniques. Two or three examples labeled `Input:` and `Output:` show desired patterns directly. Claude matches examples instead of inferring from prose. Templates define skeleton; examples calibrate style. The two compose well together.

**Trade-off**: Drift toward the examples. Subtle biases in the three examples reproduce across all invocations, so examples must span the variation the skill should support.

**Use**: For skills where output quality depends on style as much as structure: commit messages, release notes, changelog entries, review summaries.

### 9. Known Gotchas Pattern

Skills documenting only happy paths teach what to do, not what to watch for. When the skill hits real-world edge cases — form fields that don't exist, commands failing on specific platforms, libraries silently returning empty results — Claude invents fixes.

Add a dedicated section listing concrete failure modes previously seen: "Scanned PDFs return [] silently. Check page type first." "Rotated pages need `page.rotation=0` before column extraction." Practitioners call gotchas **"the most valuable content of a mature skill."**

**Trade-off**: Gotchas are a moving target. Libraries update, APIs change, and stale gotchas send Claude chasing problems that no longer exist.

**Use**: On mature skills, populated from observing real runs.

---

## Workflow Control

### 10. Execution Checklist Pattern

In long multi-step procedures Claude skips validation steps, loses track of position, or declares completion prematurely.

Provide a copyable checklist Claude pastes into responses and ticks off while working. The checklist lives in the conversation, making skipped steps visible to both Claude and the user. Unchecked items rendering each turn raises the bar for declaring completion.

**Trade-off**: Verbosity. The checklist renders in full on every turn, multiplying tokens in long sessions, and feels like overkill for short flows.

**Use**: For any workflow with more than three steps, especially where skipped validation is costly.

### 11. Self-Correcting Loop Pattern

When Claude generates code, edits XML, or drafts against style guides, a single forward pass often ships mistakes the skill could catch.

Wire in an explicit loop: produce output → run validator → if it fails, fix and revalidate. The validator can be a script (`python validate.py fields.json`) or a document (re-read STYLE_GUIDE.md and check each rule). The loop terminates only when validation passes.

**Trade-off**: Non-termination risk. A weak validator (or Claude repeatedly making the same mistake) can loop indefinitely, so the pattern needs a retry cap and user fallback.

**Use**: For quality-critical tasks where mistakes are expensive and programmatic verification is feasible.

### 12. Plan-Validate-Execute Pattern

For batch or destructive operations — updating 50 form fields, migrating rows, rewriting documents — direct "just do it" passes let errors cascade silently. By the time problems surface, changes are already applied.

Insert a verifiable intermediate artifact (typically JSON plan) between task understanding and execution. A script validates the plan **before any side effects**. This differs from Self-Correcting Loop, which iterates after work has already landed. Claude iterates on the plan freely; the real target touches only once the plan passes validation.

**Trade-off**: Ceremony. For a two-field edit the loop is more process than the task deserves, so reserve it for operations where "undo" is costly or impossible.

**Use**: For batch, destructive, or high-stakes operations.

---

## Executable Code

### 13. Utility Bundle Pattern

Asking Claude to generate validation scripts, PDF extractors, or data normalizers from scratch every invocation is slower, less reliable, and burns tokens on code users never see.

Ship purpose-built scripts in `scripts/` alongside SKILL.md. Claude invokes them via bash, so only their output consumes context. Scripts should handle common failure modes cleanly instead of dumping ambiguity back on Claude. Sometimes that means creating missing files with sensible defaults; sometimes it means failing fast with clear errors.

Constants need justifying comments ("30s timeout covers slow connections"), not magic numbers. When deciding which helpers to bundle, **run the skill on three test cases and read transcripts: if subagents all wrote the same helper independently, promote it to `scripts/`.**

**Trade-off**: Environment dependence. Scripts need a runtime, and platform-specific helpers fail differently on user machines than on author systems.

**Use**: For any operation that is deterministic, frequently repeated, and worth testing independently.

### 14. Autonomy Calibration Pattern

A skill running with the full default tool set can do anything — write files, shell out, call MCP servers — even when its task needs only read access. A security-audit skill with `Write` and `Bash` permissions is still a standing risk regardless of what SKILL.md says.

Declare an `allowed-tools` list in the skill's YAML frontmatter to pre-approve only needed capabilities. A security audit gets `Read, Grep, Glob`; documentation generators get `Read, Write`; deploy skills get `Bash` with narrow command matchers. This reduces approval friction but doesn't by itself restrict available tools. **In Claude Code, actual restrictions come from permission rules, not from `allowed-tools` alone.**

**Trade-off**: Confusion. Over-broad `allowed-tools` lists quietly grant more hands-off autonomy than intended. Mistaking pre-approval for sandboxing creates false security. Pair with permission rules for real restrictions.

**Use**: For any skill where narrow pre-approved tool sets genuinely suffice, especially security, audit, review, and analysis skills.

---

## The Takeaway

These 14 patterns address critical failure modes showing up across authors and domains. The description field determines if skills run at all; progressive disclosure determines context cost; explain-the-why and known gotchas determine edge-case handling; plan-validate-execute and autonomy calibration determine what breaks when something goes wrong.

These patterns are not product-specific tricks but cornerstones of how agents get extended.
