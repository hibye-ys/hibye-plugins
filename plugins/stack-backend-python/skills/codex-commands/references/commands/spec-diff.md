---
description: Audit a single backend subsystem for rule ↔ implementation drift. Loads spec-diff-auditor sub-agent which reads the subsystem's python_agent_rules/*.md rule file and greps backend/ for the corresponding implementations. Reports MISSING / EXTRA / RENAMED items.
argument-hint: <subsystem-name>
---

Audit one backend subsystem for rule↔code drift.

The authoritative spec source is the subsystem's rule file under
`.agents/rules/python_agent_rules/` — there is **no separate design
document** (`docs/design/2026-04-10-ai-agent-backend-design.md` was
retired; the 16 rule files are the single source of invariants).

## Usage

`/spec-diff agent-loop`
`/spec-diff tool-system`
`/spec-diff provider-layer`
`/spec-diff context-assembly`
`/spec-diff sse-streaming`
`/spec-diff data-layer`
`/spec-diff compaction`
`/spec-diff sub-agent-spawn`
`/spec-diff mcp-integration`
`/spec-diff run-dispatcher`
`/spec-diff media-pipeline`
`/spec-diff api-routing`

## Subsystem → rule-file mapping

The sub-agent uses this table to pick the spec source:

| Subsystem | Authoritative rule file(s) | Implementation path |
|-----------|---------------------------|---------------------|
| agent-loop | `agent-loop-patterns.md` | `backend/engine/loop.py`, `recovery.py` |
| tool-system | `tool-system-patterns.md` | `backend/tools/` (base, registry) |
| provider-layer | `ai-provider-patterns.md` | `backend/providers/`, `services/model_resolution.py` |
| context-assembly | `context-assembly-patterns.md` | `backend/engine/context.py`, `agents/prompts/` |
| sse-streaming | `sse-streaming-patterns.md` + `core-infrastructure.md` §SSE Lifecycle | `backend/engine/stream.py`, `routes/run.py` |
| data-layer | `data-layer-patterns.md` + `database-patterns.md` | `backend/data/`, `state/`, `db/` |
| compaction | `compaction-patterns.md` | `backend/engine/compaction.py` |
| sub-agent-spawn | `sub-agent-patterns.md` | `backend/tools/agents.py`, `engine/subagent.py` |
| mcp-integration | `mcp-patterns.md` | `backend/services/mcp/` |
| run-dispatcher | `run-policy.md` | `backend/routes/run.py`, `engine/policy.py`, `engine/run_registry.py`, `runs/` |
| media-pipeline | `media-pipeline-patterns.md` | `backend/routes/media.py`, `services/media/`, `data/media/` |
| api-routing | `api-routing-patterns.md` | `backend/routes/`, `main.py` middleware |
| lsp-server | (no rule yet — skill-only) | `backend/lsp/` — fall back to `lsp-server` skill capsule |
| ai-agents | `ai-agent-patterns.md` | `backend/agents/loader.py`, `discover.py` |

## Dispatch rule

1. **Validate the subsystem name** — must appear in the table above.
   - If not listed, refuse with the valid names.
   - If empty, refuse with: "Usage: /spec-diff <subsystem>".

2. **Dispatch `spec-diff-auditor` sub-agent** with the subsystem name. Pass instruction:

   > Audit the App `<$ARGUMENTS>` subsystem. Read the authoritative rule file(s) from `.agents/rules/python_agent_rules/` (see subsystem→rule table in `/spec-diff` command). Extract file/function/type/constant references from the rule's Invariants / Impact Map / Forbidden sections. Glob and read the implementation path(s). Report MISSING (rule→code), EXTRA (code→rule), RENAMED items. Do not propose fixes. Single subsystem per invocation.

3. **Surface the report** verbatim.

4. **Stop**. The user reviews and decides whether to update the rule, the code, or both.

## What this command does NOT do

- It does not audit multiple subsystems at once. One per invocation.
- It does not auto-fix.
- It does not modify the rule file.
- It does not replace `invariant-compliance-checker` which enforces cross-cutting invariants across the entire 16-rule set; this command scopes to one rule file + one path.

## When to escalate

- 여러 서브시스템을 한꺼번에 감사 → `architecture-validator` (full 모드) 또는 `/audit-all`
- 전체 rule 불변식 준수 확인 → `invariant-compliance-checker` (rule-compliance 모드)
- import 방향만 확인 → `architecture-reviewer`
- rule 파일 자체의 구조/cross-ref 검증 → `rule-consistency-auditor`

## Caveats

- Rule files evolve — make sure the target rule is read fresh.
- Some "EXTRA" items are intentional helpers (private `_`-prefixed). Read the auditor's Notes section for caveats.
- `lsp-server` subsystem has no rule file yet; audit falls back to the `lsp-server` skill capsule. When drift is found, consider promoting it to a new rule file.
