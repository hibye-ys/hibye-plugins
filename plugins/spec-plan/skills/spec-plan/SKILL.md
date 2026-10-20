---
name: spec-plan
description: Create and maintain concise software specs and implementation plans with cost-aware agent assignments and resumable task handoffs. Use for planning multi-step work, assigning models/providers, or updating/resuming an existing plan. Planning alone does not dispatch workers or implement changes.
metadata:
  version: "1.1.2"
---

# Spec Plan

Produce just enough shared context to divide, implement, and verify work. Keep
roles independent of models and hosts. Write new artifacts in the user's language,
including template headings; English template labels are not output instructions.
Announce use briefly. Follow existing project rules and authorization boundaries.

## Choose the action

- **Plan / revise:** follow this file; read only the plan template when useful.
- **Dispatch / checkpoint / resume:** go to [execution.md](references/execution.md);
  consult planning sections only for missing intent or changes, not a full replan.
  Dispatch requires implementation authority already present in the request.
  Do not ask again for authority the user has already given.
- A clear single-step change needs at most a short plan in chat when requested.
  Do not create a planning project for an ordinary edit.

## Ground and clarify

Find the existing plan before creating one. Read the applicable project guidance,
current state index, relevant implementation/tests, and Git ownership/dirty state.
Use bounded searches; do not inventory the whole repository. Reuse confirmed
findings rather than repeat another worker's exploration.

Discover repo facts yourself. Ask only for consequential unknown intent, scope,
cost, or tradeoffs that inspection cannot resolve. Preserve settled decisions.
Mark assumptions and unknowns; never invent approvals, evidence, or measurements.
Use the host's available question mechanism. Respect native plan-mode restrictions;
if it cannot save files, present the plan and say it has not been saved.

## Write one compact plan

Keep the project's existing plan root, otherwise use `docs/plans/`. Name each new
plan folder `YYYY-MM-DD-HHmmss-<slug>` using its actual creation time and a short
lowercase kebab-case topic, e.g. `2026-09-24-091530-profile-visibility/plan.md`.
Use one timezone per plan root: its existing convention, otherwise the user's
timezone (UTC if unknown). Record the creation timestamp with its offset in the
plan. If the full folder name exists for a different plan, append `-02`, `-03`,
etc.; never overwrite it. Keep the folder, creation timestamp, and plan ID stable
when revising or resuming; do not rename existing plans to adopt this convention.
Keep any skill-created `status.md` and `tasks/` beside `plan.md`; reused project
ledgers stay in place.
Prefer updating the same plan over creating a replacement. The
[plan template](assets/plan-template.md) is a guide, not mandatory empty sections.

Give a saved plan a stable ID and revision, then include:

1. **Brief spec:** goal, scope, important constraints, observable acceptance,
   required validation scope, and material gaps.
2. **Decisions:** only choices that affect task boundaries, interfaces, risk, or
   validation; a short reason and material unresolved questions.
3. **Task table:** stable ID, deliverable/owned paths, dependency IDs, execution
   mode (parallel-eligible or sequential with a short reason), proposed role +
   execution route + model + supported effort, and completion/validation check.
   Reference shared validation rules; record only task-specific differences.
4. **Handoff:** point to an existing progress index or the intended `status.md`
   beside the plan (explicitly not created yet), plus execution prerequisites.
   The plan itself is never the destination for running progress/checkpoints.

A few paragraphs and a task table are usually enough. Do not pre-write production
code, routine function internals, exhaustive test code, or shell choreography.
Specify shared interfaces precisely only where ambiguity could break independent
work. Link to canonical rules/types rather than copy their full contents.

Each task should deliver an independently checkable result. Group tiny dependent
edits; split for useful ownership or independence, not to feed more agents. Do not
generate task cards, status files, or speculative future phases during planning.

Make order visible: `T01 → (T02 ∥ T03) → T04` is enough when a summary helps.
Parallel-eligible tasks need satisfied inputs, stable shared interfaces, and no
conflicting writes or shared mutable resources. Isolated worktrees alone do not
remove output conflicts. Put a shared prerequisite first, then parallelize its
independent consumers. Sequential constraints apply only to related tasks, not
unrelated ready work. Avoid a separate schedule document or fixed waves.

## Define completion and validation

Describe completion as an observable result with a pass/fail condition. Pair it
with the behavior to check, method/environment, required checks, and expected
evidence. A file edit or a test command alone does not describe the desired result.
Start with the smallest decisive validation for the changed behavior and material
risk; retain mandatory project checks. Expand for failures, evidence gaps, or
structural/security/data/deployment risk that the narrow checks do not cover.
Reuse evidence while its inputs remain valid, and stop when required evidence is
sufficient. Keep this in a few lines; do not enumerate speculative test cases.
Mark material unavailable checks and uncertainty. Distinguish local, integration,
and operational evidence so a planned completion claim matches what can be proved.

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

Check that every important requirement has a task/check, dependencies and shared
ownership are coherent, and blockers are visible. A plan with material unresolved
decisions remains a draft. Read-only checks may resolve feasibility within the
user's scope; distinguish planned checks from checks actually run.

Before returning, check the artifact's language and its separate progress pointer.
Give the user a short summary and the plan link. Planning does not grant execution
authority. Continue into execution only when already authorized; otherwise stop
at the requested plan. Do not dispatch merely because the table names agents.

When intent or interfaces change, update the plan with the decision and reason,
then refresh affected active cards before further dependent work. Keep significant
superseded decisions and their reasons concise. Progress belongs in execution
records, not a growing diary inside the plan. The skill is guidance, not an
automatic checkpoint hook, quota monitor, or background failover service.
