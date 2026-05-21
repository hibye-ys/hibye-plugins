---
description: Walk the App debug workflow — load debug-session skill, surface the last pytest failure, tail logs/ai_backend.log, and stop. Does NOT auto-fix.
argument-hint: [optional issue keyword]
---

Run the App debug workflow.

## Usage

`/agent-debug`                         # general "something's broken"
`/agent-debug pytest`                  # focus on pytest failures
`/agent-debug stream`                  # focus on /run/<name> SSE stream issues
`/agent-debug $KEYWORD`                # any keyword used to grep logs

## Dispatch rule

1. **Load `debug-session` skill** — read `.agents/skills/debug-session/SKILL.md`
   fully so the 5-step workflow, the symptom table, and the termination criteria
   are in context before you do anything else.

2. **Show the last pytest failure** (Step 3 of the skill):

```bash
pytest --lf -x --tb=short 2>&1 | tail -n 60
```

3. **Tail the log file** (Step 2 of the skill):

```bash
if [ -f logs/ai_backend.log ]; then
    tail -n 30 logs/ai_backend.log
    echo "---"
    grep -nE "(ERROR|WARN)" logs/ai_backend.log | tail -n 20
else
    echo "no logs/ai_backend.log yet — start the dev server first"
fi
```

4. **(Optional) keyword grep** if `$ARGUMENTS` is non-empty:

```bash
if [ -n "$ARGUMENTS" ]; then
    grep -nE "$ARGUMENTS" logs/ai_backend.log 2>/dev/null | tail -n 20
fi
```

5. **Stop.** Do NOT propose fixes. The user reads the output and decides. If
   the user wants a fix, they will ask for it in a follow-up message after
   seeing the evidence.

## What this command does NOT do

- It does not auto-fix any failing test or runtime error.
- It does not modify code, config, or `.env` files.
- It does not start or stop the dev server.
- It does not run a new pytest session — `--lf` reuses the last-failed cache.
  If that cache is empty, run `pytest` once first, then re-run `/agent-debug`.
- It does not delete or rotate log files.

## When to escalate

If after running `/agent-debug` the user is still stuck, the next step is to:

- Run `/agent-verify` to confirm the dev server is in the expected state (this
  will also re-run the 3-tier Static/Boot/E2E verification on port 8001).
- Use `agent-loop-manager` (debug mode) for deeper loop-level diagnosis, or
  load the suspect subsystem skill (e.g., `agent-loop`, `provider-layer`,
  `sse-streaming`) for design intent on what the observed behavior *should* be.
- Use the relevant coordinator for subsystem-specific debugging:
  - provider 문제 → `provider-manager` (debug mode)
  - SSE/스트림 문제 → `output-stream-manager` (stream-audit mode)
  - 도구 등록 문제 → `tools-manager` (tool-audit mode)
- Ask the user to share the exact reproduction command (pytest line, curl line,
  or 5-line Python script) so the bug is pinned down.

If the same failure repeats 3 times in a row without new evidence, stop
iterating and escalate to the user — running the same debug loop a 4th time
is not going to produce different information.
