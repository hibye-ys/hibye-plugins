# Execution and recovery

Load for an authorized dispatch, progress update, or resumption. Use the existing
runtime for agent lifecycle; this skill does not supply one. If unavailable,
prepare the handoff and report the limitation without claiming a worker started.

## Artifacts and ownership

Keep the compact plan as the intent/task source. At first execution create:

- A short progress index using [status-template.md](../assets/status-template.md),
  normally `status.md` beside the plan. Reuse an existing project state ledger
  when it can represent this work; otherwise link the index from it instead of
  duplicating detailed progress. The coordinator owns the index.
- `tasks/<task-id>.md` only as each task is dispatched, using
  [task-template.md](../assets/task-template.md). Its assigned worker owns its
  checkpoint; the coordinator performs ownership transfers. One card persists
  across replacements. Do not overwrite another active worker's checkpoint.

The index is a summary; task checkpoints, Git, and runtime state must be reconciled
on resume. Preserve local/uncommitted work. Keep logs and large evidence outside
the cards and link them. No credentials or raw private transcripts in artifacts.
These notes guide agents, not machine execution or new approval authority. Keep
machine state in the existing runtime and honor project document boundaries.

## Before dispatch

Check authorization, dependencies, workspace, allowed execution routes, and current
model/effort support. Separate concurrent writers using the project's isolation
rules. New worktrees do not copy dirty changes; ensure the worker's starting tree
contains its required inputs. Preserve the confirmed base commit and workspace.
If uncommitted prerequisite changes are transferred, record their paths, transfer
artifact/method, and confirmation in the receiving tree; omit this for clean bases.

Select ready tasks from dependency IDs and execution modes. Dependencies must be
accepted and their required outputs present in the worker's tree before dispatch.
Run nonconflicting ready tasks concurrently when beneficial and capacity permits;
otherwise serialize with a short reason. Include shared files, generators, and
external mutable resources when checking conflicts. Re-evaluate after each result
or block; do not wait for unrelated tasks just to finish an artificial wave.

Fill only the selected task's card: plan path/revision, objective, owned paths,
dependencies/interfaces, applicable constraints, acceptance and validation scope,
and assignment. Carry the required checks and evidence environment into the brief.
Record the starting checkpoint before work begins. Capture returned session/agent
IDs and runtime route; never invent them. Relevant contract changes invalidate
the old card until reconciled; unrelated plan edits do not restart completed work.

Apply the chosen supported model/effort to the actual call and control context
inheritance explicitly; use fresh/minimal context for bounded delegated tasks.
Check the current tool schema: inherited-history modes may ignore or disallow
model overrides. Record requested settings and runtime-confirmed effective settings
when exposed; mark the latter unverified if unavailable. Do not invent controls
for fixed-model routes or treat a card's assignment as proof of the actual model.

Give the worker its card, the specific source/rule pointers it needs, and a clear
result contract: update the checkpoint, then return status, changed paths/commits,
verification summary, and unresolved issues. Do not send the entire plan or chat.
Mention it is not alone in the codebase and must preserve other owners' edits.
Before sending, check that the card carries the plan reference, workspace/base,
assignment, current/next state, and evidence/unknowns, and the message explicitly
requires updates to that card. In a prepared call, list missing inputs as unsent
prerequisites; a short verbal brief alone is not a resumable handoff.

## While working

Persist a short checkpoint after a meaningful change, validation result, or block,
and before yielding/transferring ownership. Replace stale current-state prose;
preserve decisions/evidence still needed to avoid repeated work. Do not maintain a
tool-call diary. At risky external effects, record the operation reference and
intended effect before starting, then the observed result; unknown is not failure.

Distinguish pending, active, blocked, needs-verification, and verified-done. A model
turn ending or a worker saying "done" is not acceptance evidence. Reuse valid
results, check the relevant diff, and run only missing required validation.
Tie validation evidence to its method/environment and the tested revision or
identifiable dirty input state. Compare observed results to the completion
conditions; all required checks must pass before verified-done. A failed, unrun,
or unavailable required check keeps the task in needs-verification (or blocked
when execution cannot continue). Do not weaken acceptance to close a task.
Record the reason and next action for missing evidence, and distinguish limits
outside the required scope. Local or mocked evidence supports only that scope;
operational claims require the corresponding operational readback.
When target-tree integration is part of acceptance, keep the task in
needs-verification until its changes are integrated and required affected checks
pass there. A worker-tree pass alone does not complete that acceptance.

## Resume or replace, including the coordinator

1. Read the small progress index and select relevant unfinished work, including
   pending and needs-verification as well as active/blocked. Read only its existing
   cards; for pending work without a card, use the relevant plan row at dispatch.
   Read other plan sections only to resolve missing intent, dependencies, or drift.
2. Reconcile workspace/base/dirty diff, latest checkpoint, process/session state,
   and any pending effects. A checkpoint can lag behind an abrupt termination.
3. For an existing session, use that runtime's read/resume operation and the same
   ID first. A timeout/disconnect is not proof it stopped. Do not restart unknown
   external operations; recover/read back the same operation identity.
4. Before a replacement writes, establish the prior writer is stopped or excluded
   by the runtime's ownership mechanism. If that cannot be established, keep this
   task blocked; independent nonconflicting tasks may continue.
5. Select an available allowed route/model; record the reassignment, reason, and
   new runtime ID. Preserve task identity, work, and authorization boundaries.
   Native conversation/session IDs are not portable across providers. Transfer the
   artifacts and relevant workspace, not an assumed inherited conversation.
6. Continue from the smallest outstanding action. Do not repeat completed tasks
   or proven checks unless changed inputs invalidate them. Unknown effects or
   unrun checks remain explicit.

Report verified progress and remaining work briefly. Switching hosts requires
actual access to the workspace/artifacts; an inaccessible local path is a blocker,
not a successful handoff. Automatic crash detection and restarting need a separate
runtime service and are outside this skill.
