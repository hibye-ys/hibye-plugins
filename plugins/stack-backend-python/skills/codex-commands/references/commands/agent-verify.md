---
description: Run the runtime-verify 7-step checklist — Static + Boot + E2E. Loads runtime-verify skill, executes the bash, reports pass/fail. Use before claiming "done".
argument-hint: [scenario-json-string]
---

Run the runtime verification checklist for App.

## Usage

`/agent-verify`                                                # default scenario ({"message":"hello"} on /run/chat)
`/agent-verify '{"message":"analyze my latest note"}'`         # custom body JSON — matches RunRequest schema

## Dispatch rule

1. **Load `runtime-verify` skill** — read `.agents/skills/runtime-verify/SKILL.md`
   fully so the 3-tier rule, the change-impact table, and the 7-step checklist are
   in context before any bash runs.

2. **Refuse if dev port 8001 is occupied** — this command uses port 8001 (not
   8000) so it never clobbers an in-progress dev session on 8000. If 8001 is
   already taken, abort immediately:

```bash
if lsof -i :8001 > /dev/null 2>&1; then
    echo "ERROR: port 8001 already in use. Free it before running /agent-verify."
    lsof -i :8001
    exit 1
fi
```

3. **Run the 7-step bash** from the skill (copy-paste exactly, no edits):

```bash
set -euo pipefail

# Step 1: ruff
ruff check backend/ || { echo "FAIL: ruff"; exit 1; }

# Step 2: ty (type check)
ty check backend/ || { echo "FAIL: ty"; exit 1; }

# Step 3: pytest unit + integration
pytest -m "unit or integration" --tb=short || { echo "FAIL: pytest"; exit 1; }

# Step 4: dev server boot (uv run uvicorn — settings.json allow 의 Bash(uv *) 가 커버)
uv run uvicorn backend.main:app --port 8001 > /tmp/uvicorn.log 2>&1 &
UVICORN_PID=$!
trap "kill $UVICORN_PID 2>/dev/null || true" EXIT
sleep 5

# Step 5: /health
curl -fs http://localhost:8001/health > /dev/null \
  || { echo "FAIL: /health"; tail /tmp/uvicorn.log; exit 1; }

# Step 6: E2E POST /run/chat (RunRequest: {message, session_id?})
# APP_AUTH_REQUIRED=false 전제 (dev 기본). prod 는 Authorization 헤더 필요 — 범위 밖
SCENARIO="${ARGUMENTS:-{\"message\":\"hello\"}}"
curl -N -X POST http://localhost:8001/run/chat \
  -H "Content-Type: application/json" \
  -d "$SCENARIO" \
  --max-time 30 \
  | tee /tmp/sse.log \
  | grep -q "event: done" \
  || { echo "FAIL: no done event in SSE"; tail /tmp/sse.log; exit 1; }

# Step 7: ERROR/CRITICAL log scan
if grep -nE "(ERROR|CRITICAL)" /tmp/uvicorn.log; then
    echo "FAIL: errors in dev log"
    exit 1
fi

echo "OK: 7 steps passed"
```

4. **Report** — print a structured pass/fail summary per the skill's reporting
   format (one line per Tier, failing step + log tail if any).

5. **Stop.** Do NOT propose fixes. Do NOT auto-restart. The user reads the output
   and decides.

## What this command does NOT do

- It does not modify code, config, or `.env` files.
- It does not auto-restart the dev server on failure — the trap kills the test
  uvicorn instance on exit and leaves the user to diagnose.
- It does not run on port 8000 (`uvicorn backend.main:app --reload` default) —
  uses port 8001 to avoid clobbering an in-progress dev session.
- It does not implement any verification logic itself — all logic lives in the
  `runtime-verify` skill. This file is a thin entrypoint.
- It does not auto-debug failures — for that, use `/agent-debug`.

## Caveats

- Requires `ruff`, `ty`, `pytest`, `curl`, `lsof`, and `uv` (which bundles `uvicorn`) in PATH.
- Boot step uses port 8001. If 8001 is occupied (including by a previous
  `/agent-verify` run that did not fully release), the command refuses. SIGKILL
  leakage can leave port 8001 in TIME_WAIT for ~60 seconds on macOS — just wait
  and retry.
- Step 6 timeout is 30 seconds. Long agent runs may need a custom scenario JSON
  argument or a skill-body adjustment.
- `$ARGUMENTS` is interpolated raw into the curl `-d` payload. Pass a valid JSON
  string — malformed JSON will fail Step 6 with a 400/422, not a skill error.
- Trap cleanup kills the test uvicorn instance on exit. If the script is
  interrupted between Step 4 and Step 5, the trap still fires.
