---
name: muse-delegate
description: Delegate implementation work to Muse workers through the Orca CLI to save the main agent's usage. Use only when the user explicitly mentions muse (e.g. "muse로", "muse 써서", "muse한테 맡겨", "use muse"). Never use it on your own initiative or when the user rules muse out ("muse 말고", "without muse"); otherwise do the work yourself.
metadata:
  version: "0.1.4"
---

# Muse delegate

Muse is an optional helper for saving the main agent's usage. The main agent
(any host) writes specs, dispatches, and verifies; Muse implements.

## Scope

- Activate only for a user request that mentions muse. It applies to that task;
  "이번 세션은 muse" keeps it on for the rest of the session.
- Delegate clearly specified implementation: features, refactors, tests,
  bulk edits. Keep ambiguous requirements, design, security, and architecture
  decisions with the main agent; settle them into a spec first.
- If a mentioned task is too small to be worth a worker (a few lines), say so
  and do it directly.

## Setup (once per session)

`SCRIPTS` is this skill's `scripts/` directory. Check `orca status`; if Orca is
not running, tell the user and stop. Then create a fresh coordinator and Run:

```text
orca terminal create --worktree <selector> --title Coordinator --json
orca orchestration run-create --objective "<goal>" --from <coord-handle> --json
```

## Dispatch

Write each spec with Target, Change, Constraints, Ownership (paths), and
observable acceptance (tests/build). Run one script per independent task, all
started before waiting, each in the background (e.g. Claude Code
`Bash(run_in_background)`); parallel editors use separate worktrees.

```text
SCRIPTS/muse-run.sh --coord <H> --run <R> --worktree <selector> --spec "<spec>"
```

Output is one JSON line (`dispatchId`, `taskId`, `status`, `outcome`, `note`).
Exit 0 succeeded, 1 failed, 2 wait timeout (worker may still run), 3 unknown
(start response unreadable or Orca reported `outcome_unknown`; follow the
note's inspect command, and retry only through Orca's `--retry-request`, never
a fresh start), 64 usage. No `--model`; Muse has one model.

Do not relay Muse through an LLM subagent or dynamic-workflow `agent()`:
a relay costs ~40k tokens because it rereads fixed context every turn. If a
relay is unavoidable, poll with `worker-show`, never `check` (it steals other
workers' messages).

## Questions

Workers ask via `question` messages; answer with
`orca orchestration reply --from <H> --id <msg> --body "..."`. The script
cannot answer and times out (exit 2), so for specs that may raise questions use
`worker-start --agent muse` plus
`orca orchestration check --terminal <H> --wait --types worker_done,question,escalation`.
With several parallel workers, write specs complete enough to avoid questions.

## Verify, then settle

1. Verify acceptance yourself (run tests/build) for every worker that exited
   0; never trust the worker's summary alone.
2. If a worker fails acceptance, send the fix as a new worker whose spec
   names the files already changed and the failing check (see below);
   `send --to dispatch:<id>` is rejected once the dispatch has settled.
3. Settle only accepted workers:

```text
SCRIPTS/muse-settle.sh --coord <H> --release <dispatchId>...
```

It prints the inbox batch, acknowledges it unless it holds a question,
escalation, decision_gate, or handoff (exit 2: reply, then rerun with
`--ack <deliveryId>`), and releases a listed dispatch only when `worker-show`
reports `succeeded`. Exit 1 means a release or ack failed; the printed receipt
says how to recover, and rerunning is safe.

## Follow-ups

A follow-up can keep the worker's context. Pick by the worker's state:

- **Not released yet** (settled without `--release`): reuse its terminal.
  Get the handle from `worker-show --dispatch <id>`, then
  `orca orchestration task-create --from <H> --run <R> --spec "..." --json`
  (task id at `result.task.id`) and
  `SCRIPTS/muse-run.sh ... --task <id> --terminal <worker-handle>`.
- **Released**: release closes the terminal and kills its muse process, so its
  old handle never becomes ready again (`agent_readiness` timeout). Reopen the
  Muse session instead:
  `SCRIPTS/muse-resume.sh --worktree <selector> --dispatch <released-id>`.
  It finds the top-level session that ran that dispatch, reopens it with the
  permission mode the session was opened with (`--yolo` only if it had it),
  and prints `{"terminal": <handle>, "session": ..., "mode": ...}`. An
  ambiguous match is refused; pass `--session <uuid>` then. Then use
  `task-create` and `muse-run.sh --terminal <handle>` as above. Never resume a
  session that is still open in another terminal.
  The resumed terminal is not owned by a dispatch: `worker-release` reports
  `retained reason=external_terminal` and leaves muse running. Reuse that
  handle for further follow-ups, and close it yourself when done
  (`orca terminal close --terminal <handle>`).
- **Context not needed**: start a new worker with a self-contained spec
  (files already changed, the failing check, the fix wanted).

If you expect follow-ups, leave that worker out of `muse-settle.sh --release`
until you are done with it.

## Startup failures

After an auto-update Muse may wait at its login screen and the worker fails
with `agent_readiness` timeout. Inspect with `worker-show` / `terminal read`,
ask the user to log in (never log in for them), then retry with
`--task <id> --retry-of <dispatchId>`.

For Orca details beyond this recipe: `orca skills get orchestration`.
