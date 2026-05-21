---
description: Pre-deploy composite gate — Tier 1 static + optional --integration (iyaki Postgres smoke) + --live-openai (OpenAI provider smoke) + --live-anthropic (Anthropic prompt-cache smoke). Tier 1 covers uv sync/pip-audit/ruff/ty, dev-server boot, /health polling, /runs validation, alembic current check, conditional MCP probe. Does NOT wrap /audit-all (run that separately in CI).
argument-hint: [--integration] [--live-openai] [--live-anthropic]
---

Pre-deploy composite gate for the App AI backend. Run before releasing.

## Usage

`/pre-deploy`                              — Tier 1 static only (cheap, deterministic, no infra)
`/pre-deploy --integration`                — Tier 1 + Tier 2 (iyaki Postgres + integration-smoke.sh)
`/pre-deploy --live-openai`                — Tier 1 + Tier 3 (OpenAI real-provider smoke)
`/pre-deploy --live-anthropic`             — Tier 1 + Tier 3b (Anthropic prompt-cache smoke)
`/pre-deploy --integration --live-openai`  — All three tiers
`/pre-deploy --integration --live-openai --live-anthropic`  — All four tiers

## Dispatch rule

1. **Load `pre-deploy-check` skill** — `.agents/skills/pre-deploy-check/SKILL.md`
   defines the 3-tier pass/fail semantics, exit codes, and output format.

2. **Parse flags** — `--integration`, `--live-openai`, and `--live-anthropic` are
   independent opt-ins. All default to `off`. Tier 1 always runs.

3. **Refuse if dev port 8001 is occupied** — `/pre-deploy` boots its own uvicorn
   on 8001 (same port as `/agent-verify`) so an in-progress dev session on 8000
   is not clobbered. Abort if 8001 is busy:

```bash
if lsof -i :8001 > /dev/null 2>&1; then
    echo "ERROR: port 8001 already in use. Free it before running /pre-deploy."
    lsof -i :8001
    exit 1
fi
```

4. **Run the tiers in order** (Tier 1 → Tier 2 → Tier 3 if opted-in):

```bash
set -euo pipefail

INTEGRATION=0
LIVE_OPENAI=0
LIVE_ANTHROPIC=0
FAILED=0  # NO-GO 누적 (opt-in tier precondition 미충족 포함)
for arg in $ARGUMENTS; do
    case "$arg" in
        --integration)     INTEGRATION=1 ;;
        --live-openai)     LIVE_OPENAI=1 ;;
        --live-anthropic)  LIVE_ANTHROPIC=1 ;;
        *) echo "ERROR: unknown flag: $arg"; exit 2 ;;
    esac
done

# ========== Tier 1: default/static ==========
echo "== Tier 1: static =="

# deps + type + lint
uv sync --frozen || { echo "FAIL: uv sync --frozen"; exit 1; }
uv run pip-audit || { echo "FAIL: pip-audit"; exit 1; }
ruff check . || { echo "FAIL: ruff"; exit 1; }
ty check backend/ || { echo "FAIL: ty"; exit 1; }

# NB: 본 command 는 /audit-all 을 직접 실행하지 않음 — skill 간 dispatch loop 위험.
# 운영자는 pre-deploy 전 또는 CI 에서 `/audit-all --skip=test,infra` 를 별도 실행할 것.
# 이 단계는 `pre-deploy-check` SKILL.md §Tier 1 에서 deps/type/lint/boot/health/runs/alembic/mcp 로 한정됨.

# dev boot (port 8001, cleanup on exit)
uv run uvicorn backend.main:app --port 8001 > /tmp/uvicorn-predeploy.log 2>&1 &
UVICORN_PID=$!
trap "kill $UVICORN_PID 2>/dev/null || true" EXIT
sleep 5

# /health polling (max 10s)
for i in 1 2 3 4 5; do
    if curl -fs http://localhost:8001/health > /dev/null; then
        break
    fi
    sleep 2
    if [ $i -eq 5 ]; then
        echo "FAIL: /health never became healthy"
        tail /tmp/uvicorn-predeploy.log
        exit 1
    fi
done

# /runs static validation — dev auth 전제 (APP_AUTH_REQUIRED=false). 실패 시 FAIL (gate semantics).
# 주의: `set -e` 아래에서 `$(curl -fs ...)` 는 curl 비정상 종료 시 스크립트를 즉시 abort 시키므로,
# 반드시 `if ! ...; then FAILED=1; fi` 형태로 exit code 를 포획해야 함.
RUNS_FILE_COUNT=$(ls backend/runs/*.yaml 2>/dev/null | wc -l | tr -d ' ')
if ! RUNS_API_RESP=$(curl -fs http://localhost:8001/runs 2>/dev/null); then
    echo "FAIL: GET /runs did not return 200 (auth or startup issue — check APP_AUTH_REQUIRED=false + uvicorn log)"
    FAILED=1
elif [ -z "$RUNS_API_RESP" ]; then
    echo "FAIL: GET /runs returned empty body"
    FAILED=1
else
    RUNS_API_COUNT=$(echo "$RUNS_API_RESP" | jq '.runs | length' 2>/dev/null || echo "parse_error")
    if [ "$RUNS_API_COUNT" = "parse_error" ]; then
        echo "FAIL: /runs response did not parse as JSON"
        FAILED=1
    elif [ "$RUNS_FILE_COUNT" != "$RUNS_API_COUNT" ]; then
        echo "FAIL: runs/ file count ($RUNS_FILE_COUNT) != /runs API count ($RUNS_API_COUNT) — startup validation likely failed; check uvicorn log"
        FAILED=1
    fi
fi

# DB revision — report-only gate (current vs heads)
DB_CURRENT=$(uv run alembic -c backend/db/alembic.ini current 2>/dev/null | head -1 || echo "unreachable")
DB_HEADS=$(uv run alembic -c backend/db/alembic.ini heads 2>/dev/null | head -1 || echo "unreachable")
if [ "$DB_CURRENT" = "unreachable" ] || [ "$DB_HEADS" = "unreachable" ]; then
    echo "FAIL: alembic current/heads (DB unreachable — check APP_DATABASE_URL)"
    exit 1
fi
echo "INFO: DB revision — current=$DB_CURRENT heads=$DB_HEADS"

# MCP state — optional (/debug/* mount is conditional on APP_DEBUG_ROUTES_ENABLED)
if curl -fs http://localhost:8001/debug/tools/mcp > /tmp/mcp-state.json 2>/dev/null; then
    jq '.servers[] | {name, state}' /tmp/mcp-state.json
else
    echo "SKIP: /debug/tools/mcp (APP_DEBUG_ROUTES_ENABLED=false or debug:read scope missing)"
fi

if [ $FAILED -eq 0 ]; then
    echo "== Tier 1: PASS =="
else
    echo "== Tier 1: FAIL =="
    # Tier 1 이 실패했으면 Tier 2/3 skip (noisy 이중 실패 방지). 하지만 `exit` 하지 않음 — 최종 NO-GO 리포트 내기 위해 계속 진행.
fi

# ========== Tier 2: --integration ==========
if [ $INTEGRATION -eq 1 ] && [ $FAILED -eq 0 ]; then
    echo "== Tier 2: integration (requires iyaki Postgres + APP_DATABASE_URL + IYAKI_DATABASE_URL) =="
    # Kill the Tier 1 uvicorn — integration-smoke.sh boots its own
    kill $UVICORN_PID 2>/dev/null || true
    trap - EXIT
    if bash scripts/integration-smoke.sh; then
        echo "== Tier 2: PASS =="
    else
        echo "== Tier 2: FAIL =="
        FAILED=1
    fi
elif [ $INTEGRATION -eq 1 ]; then
    echo "== Tier 2: SKIP (Tier 1 failed) =="
fi

# Run one live-provider tier. Args: <label> <flag-name> <enabled> <env-key> <script>.
# Gate semantic: flag set + precondition missing = NO-GO (explicit request must be honored).
run_live_tier() {
    local label="$1" flag="$2" enabled="$3" env_key="$4" script="$5"
    if [ "$enabled" -ne 1 ]; then
        return 0
    fi
    if [ $FAILED -ne 0 ]; then
        echo "== $label: SKIP (Tier 1 failed) =="
        return 0
    fi
    echo "== $label: $script (requires $env_key) =="
    if [ -z "${!env_key:-}" ]; then
        echo "FAIL: --$flag requested but $env_key is unset"
        echo "== $label: FAIL =="
        FAILED=1
        return 0
    fi
    if uv run python "scripts/$script"; then
        echo "== $label: PASS =="
    else
        echo "FAIL: $script"
        echo "== $label: FAIL =="
        FAILED=1
    fi
}

run_live_tier "Tier 3"  live-openai    $LIVE_OPENAI    OPENAI_API_KEY    smoke_real_provider.py
run_live_tier "Tier 3b" live-anthropic $LIVE_ANTHROPIC ANTHROPIC_API_KEY smoke_anthropic_cache.py

echo ""
if [ $FAILED -eq 0 ]; then
    echo "=== pre-deploy: GO ==="
    exit 0
else
    echo "=== pre-deploy: NO-GO ==="
    exit 1
fi
```

5. **Report** — per-tier PASS/FAIL + the final go/no-go verdict + DB revision report + which tiers were executed vs skipped.

6. **Stop.** Do NOT propose fixes. User reads the output and decides.

## What this command does NOT do

- Does not run `/runs/reload` (requires `runs:admin` scope — out of scope for a release gate; static YAML validation via `GET /runs` file-count vs API-count is enough)
- Does not hit staging/prod endpoints — this is a local boot gate. Staging smoke needs CI with `Authorization: Bearer $APP_PRE_DEPLOY_TOKEN` header (not scripted here)
- Does not run the full `/audit-all` 13 phases — user is expected to run `/audit-all` separately as part of pre-deploy prep
- Does not modify code, config, or `.env` files
- Does not auto-fix failures

## Auth story

- **Tier 1 (local smoke)**: `APP_AUTH_REQUIRED=false` (or `app_env != prod`) required — anonymous fallback is the only tested path here
- **Tier 2 (`--integration`)**: `scripts/integration-smoke.sh` manages its own auth via env
- **Tier 3 (`--live-openai`)**: `scripts/smoke_real_provider.py` reads `OPENAI_API_KEY` directly from env

## Caveats

- Requires `ruff`, `ty`, `uv`, `curl`, `lsof`, `jq` in PATH
- Port 8001 must be free. `/agent-verify` uses the same port — don't run both simultaneously
- Tier 2 full integration cycle can take 2-5 minutes
- Tier 3 costs real OpenAI tokens (~$0.001-$0.01 per run depending on scenario)
- Exit code: 0 = GO, 1 = FAIL (any tier), 2 = bad flags

## When to escalate

- Tier 1 fail 3회 연속 → `/agent-debug` 로 단일 버그 추적
- Tier 2 flaky → `infra-performance-manager` (concurrency / resource)
- Tier 3 unexpected cost → `usage-tracking` skill + `provider-manager catalog-sync`
