---
name: spec-plan
description: Create and maintain a short spec (what will be true and why, for the person who decides) and a separate implementation plan (how the work is divided, who does it, in what order, for the agents who execute), with cost-aware agent assignments and resumable task handoffs. Use for planning multi-step work, assigning models/providers, or updating/resuming an existing spec or plan. Planning alone does not dispatch workers or implement changes.
metadata:
  version: "2.0.1"
---

# Spec Plan

Produce just enough shared context to agree on a result, then divide, implement,
and verify the work. Two documents, two readers:

- **Spec** — what will be true when the work is done, and why. Its reader is the
  person who decides. They may not read code.
- **Plan** — how the work is divided, who does each part, and in what order. Its
  readers are the agents who execute.

Keep roles independent of models and hosts. Write new artifacts in the user's
language, including template headings; English template labels are not output
instructions. Announce use briefly. Follow existing project rules and
authorization boundaries.

## Choose the action

- **Spec:** the work is new, or the intended result changed. Write or revise
  `spec.md` and give it to the user to confirm.
- **Plan / revise:** the spec is settled and the work needs dividing, or only the
  method changed. Write or revise `plan.md`; leave the spec alone.
- When the user asks for both at once, write both. The spec stays `draft` until
  they confirm it, and a plan built on a draft spec is also a draft.
- **Dispatch / checkpoint / resume:** go to [execution.md](references/execution.md);
  consult planning sections only for missing intent or changes, not a full replan.
  Dispatch requires implementation authority already present in the request.
  Do not ask again for authority the user has already given.
- A clear single-step change needs at most a short plan in chat when requested.
  Do not create a planning project for an ordinary edit.

## Ground and clarify

Find the existing spec and plan before creating one. Read the applicable project
guidance, current state index, relevant implementation/tests, and Git
ownership/dirty state. Use bounded searches; do not inventory the whole
repository. Reuse confirmed findings rather than repeat another worker's
exploration.

Discover repo facts yourself. Ask only for consequential unknown intent, scope,
cost, or tradeoffs that inspection cannot resolve. Preserve settled decisions.
Mark assumptions and unknowns; never invent approvals, evidence, or measurements.
Use the host's available question mechanism. Respect native plan-mode restrictions;
if it cannot save files, present the documents and say they have not been saved.

## Where the files live

Keep the project's existing plan root, otherwise use `docs/plans/`. Name each new
folder `YYYY-MM-DD-HHmmss-<slug>` using its actual creation time and a short
lowercase kebab-case topic, e.g. `2026-09-24-091530-profile-visibility/`.
Use one timezone per plan root: its existing convention, otherwise the user's
timezone (UTC if unknown). If the full folder name exists for different work,
append `-02`, `-03`, etc.; never overwrite it. Keep the folder, creation
timestamp, and IDs stable when revising or resuming.

Inside the folder: `spec.md`, `plan.md`, and only when needed `design.md`.
`status.md` and `tasks/` appear beside them when execution starts; reused project
ledgers stay in place. An existing single-file plan stays as it is; split it only
when the user asks or its intent is being rewritten. Do not rename existing
folders to adopt this convention.

## Write the spec

The [spec template](assets/spec-template.md) is a guide, not mandatory empty
sections. Give the spec a stable ID, a revision, and a state: `confirmed` once
the user has confirmed its current scope and acceptance (in this conversation or
earlier), otherwise `draft`. Then include only what applies:

1. **Goal:** one or two sentences — the observable result and who it is for.
2. **Scope:** what is in, and the exclusions someone would otherwise assume.
3. **Behavior and acceptance:** what a person can observe when it works, one line
   each with a pass/fail condition and a stable ID (A1, A2 …). These are the
   completion criteria the plan must cover.
4. **Planned tests:** only when the project has a test-authoring rule; see below.
5. **Constraints:** only those that shape this work. Say in a few plain words
   what the rule requires here, then point to it. A bare rule number tells the
   reader nothing; the rule's full text is too much.
6. **Decisions:** choices the reader owns — product behavior, cost, risk, what is
   dropped. Three lines at most each: the choice, the reason, and a rejected
   alternative only if someone is likely to raise it again. Mark each `settled`
   or `proposed`; a proposed one states the recommendation and the one
   alternative worth asking about.
7. **Limits and stop conditions:** the time or cost ceiling, and what makes the
   work stop and report instead of continuing.
8. **Open questions:** only what changes scope or acceptance and cannot yet be
   given even a recommendation. A spec with one, or with a proposed decision,
   stays `draft`.

Two optional additions: a short glossary when the spec needs several terms the
reader does not know, and a section of your own when something the reader must
decide fits none of the above (for example a table of which check runs when).

Write for the reader: plain words, behavior rather than mechanism. Use the
product's own words for what the reader sees, and give a technical term they
cannot avoid a few words of explanation the first time. Name a file, table,
function, or command only when the reader must recognize it or approve a change
to it (a rule file, a gate, a command); otherwise say what kind of thing it is
and leave the name to the plan or the design note. The spec may list phases and
their order as scope — what is delivered when. It holds no tasks, task order,
assignments, model names, or progress.

## Write the plan

The [plan template](assets/plan-template.md) is a guide too. Give the plan a
stable ID, a revision, and a state (`draft` or `ready`), then include:

1. **Spec pointer:** the spec's path and the revision this plan was built from.
   Do not repeat the goal, scope, or acceptance; link them.
2. **Approach:** technical choices that affect task boundaries, shared interfaces,
   risk, or validation. Three lines at most each, with a short reason.
3. **Task table:** stable ID, result (one line), dependency IDs, proposed
   role + execution route + model + supported effort, and "done when" (one line:
   the observable result and its check, citing the acceptance IDs it covers).
   Owned paths, inputs, and validation detail go on the task card at dispatch.
   Name a path in the table only when two tasks could collide on it. When one
   task bundles several required parts that are easy to forget, list them under
   its ID in `design.md`; the card copies them at dispatch.
4. **Order:** one line, e.g. `T01 → (T02 ∥ T03) → T04`. Add "sequential" with a
   short reason only where dependencies alone do not explain it.
5. **Shared validation:** a few lines — what is checked once for the whole plan,
   where, and at which stage. Tasks record only their differences.
6. **Handoff:** execution prerequisites, and a pointer to an existing progress
   index (this plan's rows are added to it at execution, not a second index) or
   the intended `status.md` (explicitly not created yet).

Each task should deliver an independently checkable result. Group tiny dependent
edits; split for useful ownership or independence, not to feed more agents. Do not
generate task cards or status files during planning. Do not pre-write production
code, routine function internals, test code, or shell choreography. Specify shared
interfaces precisely only where ambiguity could break independent work.

Parallel-eligible tasks need satisfied inputs, stable shared interfaces, and no
conflicting writes or shared mutable resources. Isolated worktrees alone do not
remove output conflicts. Put a shared prerequisite first, then parallelize its
independent consumers. Sequential constraints apply only to related tasks, not
unrelated ready work. Avoid a separate schedule document or fixed waves.

End every plan with one **closing task**: integrate the results, run the shared
validation once, perform the independent review when one is warranted, and update
the project's shared records. Only the closing task edits shared bookkeeping
files, so parallel tasks do not collide on them.

## Keep both documents short

Do not measure these documents by length. A long document is a symptom; the
causes are content that belongs elsewhere and items that say more than one
thing. Control those:

- **One item, one thing.** An acceptance line is one observable result. A
  decision is the choice and its reason, three lines at most. A table cell is
  one or two short sentences. An item that needs more is two items, or its
  detail belongs in one of the places below.
- **Every line changes what the reader decides or does.** Before returning, read
  each line and delete the ones that do not: background the reader already has,
  a rule restated, how a decision was reached, hedging, a second way of saying
  the same thing.
- **Say it once.** What the spec says, the plan links.
- **Count items, not lines, to see that the work is too big.** More than about
  ten acceptance lines or eight tasks means the work should be phased (below),
  not that the sentences should be squeezed. Count per phase: once the work is
  phased, the numbers apply to one phase's acceptance lines and tasks.

Content that does not fit has a place:

- Design detail (schemas, interface definitions, long comparisons of
  alternatives, per-task lists of required parts, source locations) →
  `design.md` beside the plan, written only when tasks would otherwise diverge
  or drop something. The plan links it in one line.
- Evidence, measurements, review findings, pilot results → their own file or the
  project's existing place for them. The spec or plan carries the conclusion in
  one line with a link.
- Project rules → a pointer.
- Discussion history → not saved. Keep the decision and its reason.
- Progress → `status.md` and task cards, never the spec or plan. State lines say
  `draft`, `confirmed`, or `ready`, nothing about how far the work has got.

Revise by replacing. Each document describes the current intent only; Git keeps
the history. Do not add dated or numbered revision sections. "Changed in this
revision" is at most three lines and is replaced each time. Keep a superseded
decision as one line only while someone could still act on the old one.

When a plan is revised mid-execution, a finished task collapses to one row: ID,
result, where the evidence is. A partly finished task keeps its ID and its row,
rewritten to what remains, with the finished part noted in a few words. Neither
change may drop a dependency that still holds. How far the work has got goes in
the summary to the user and the progress index, not in the spec.

Plan large work in phases: when it needs more than about eight tasks, or when
later tasks cannot be specified until earlier ones finish. The spec covers the
whole; the plan details only the current phase — the earliest one with unfinished
tasks — and lists later phases in one line each (the result and what must be
true to start). Detail the next phase when it starts, using what the previous
one taught. Do not write tasks for phases that have not started.

## Define completion and validation

Describe completion as an observable result with a pass/fail condition. Pair it
with the behavior to check, method/environment, required checks, and expected
evidence. A file edit or a test command alone does not describe the desired result.
Start with the smallest decisive validation for the changed behavior and material
risk; retain mandatory project checks. Expand for failures, evidence gaps, or
structural/security/data/deployment risk that the narrow checks do not cover.
Reuse evidence while its inputs remain valid, and stop when required evidence is
sufficient.

Place heavy checks at stages, not on every task. While a task is being edited,
run only the narrow check for what changed. The full run of the affected scope,
any independent review, and shared bookkeeping happen once, in the closing task,
before the work is uploaded.

Mark material unavailable checks and uncertainty. Distinguish local, integration,
and operational evidence so a planned completion claim matches what can be proved.

## When the project has a test-authoring rule

Some projects have a rule or skill that decides which behaviors get tests and how
many (for example a budget per entry point and a map that links tests to them).
Read it before writing the spec and follow it; where it differs from this file,
it wins.

- **Spec — Planned tests:** list the entry points this work touches, in the
  rule's own vocabulary (its grades or classes), and each planned test as one
  sentence, within the rule's budget. These lines are completion criteria the
  plan must cover, not a step where the user signs off; what the user checks in
  person is set by the project's test rule or a decision in the spec, and where
  neither says so, add no approval step. Write no test beyond the budget and no
  test code.
  When the entry points cannot be listed up front (the first tests for an area,
  a restructuring of the whole suite), give the rule's budget and a count per
  module instead, marking each count as estimated or measured; write the list
  when each phase starts and link it. Acceptance is then what the rule itself
  reports: the map matches the tests and the budget holds.
- **Plan — tasks:** a behavior's test and its implementation are one task, test
  first; never split them into parallel tasks. Split tasks along the project's
  isolation boundaries (such as separately deployed units). A test that needs two
  units connected is its own task after both sides are done.
- **Plan — closing task:** whatever the rule requires once per unit of work —
  updating the test map and running its consistency check, the one independent
  review, the run of the touched areas' tests before upload.

Without such a rule, keep validation to the few lines described above and do not
enumerate speculative test cases.

## Assign for total cost, not a fixed model ladder

Use the user's allowed candidates/preferences and currently exposed tool/model
schemas. Keep **role**, **host/route**, **model**, and **effort** distinct. The
coordinator is a replaceable role too. A host is not itself a model/provider.

- Choose proportionately to ambiguity, failure impact, task size, and demonstrated
  capability. Consider planning, context, implementation, retries, and review cost.
- Assign concrete supported models when known. Unknown availability is
  `unverified`; if no route is available, record the role/capability needed and
  `unassigned` rather than fabricate a callable agent. Planning may still finish.
- State a short reason only when the choice is not obvious. Use the current
  session for small work when dispatch overhead outweighs its benefit.
  Retain its actual model/effort unless the runtime supports switching them;
  a different proposed model otherwise needs a callable worker route.
- Effort values are host/model-specific. Omit unsupported controls; do not silently
  map effort names across providers. Fixed-model routes stay fixed.
- Execute ready independent tasks concurrently when worthwhile and supported;
  bound concurrency by runtime capacity, quota, and coordination cost. Otherwise
  keep the same dependencies and execute sequentially, noting the constraint.
  Choose independent review for material risk, not every task by default.
- Recheck availability at dispatch. A quota block may affect an account/shared
  pool; switching a model label is not proof of capacity. Select a viable allowed
  replacement, preserving the task ID, scope, and acceptance conditions.

No permanent ranking, provider quota, pricing claim, or model-to-role mapping is
embedded here. Record actual usage only when the runtime reports it; do not claim
measured savings from estimates. Use installed execution integrations when needed
and available; do not install/configure providers as a side effect of planning.

## Check and hand off

Check that every acceptance line in the spec is cited by a task's "done when",
that dependencies and shared ownership are coherent, and that blockers are
visible. A spec or plan with material unresolved decisions remains a draft.
Read-only checks may resolve feasibility within the user's scope; distinguish
planned checks from checks actually run.

Before returning, check each artifact's language, the plan's separate progress
pointer, and each line against "Keep both documents short". Give the user a short summary and the links; for
a spec, name the decisions they need to confirm; for a mid-execution revision,
say what is done and what remains. Planning does not
grant execution authority. Continue into execution only when already authorized;
otherwise stop at the requested documents. Do not dispatch merely because the
table names agents.

When the intended result changes, revise the spec first and have the user confirm
a change to scope or acceptance, then revise the plan and refresh affected active
cards before further dependent work. When only the method changes, revise the
plan alone. The skill is guidance, not an automatic checkpoint hook, quota
monitor, or background failover service.

## When the skill itself is the problem

If this skill blocks you, is wrong, is ambiguous, misses something, or asks for too much while you work, do not edit the skill. Record it the way the project's `skill-feedback` skill says and continue the work. If the project has no such skill, tell the user in one line.
