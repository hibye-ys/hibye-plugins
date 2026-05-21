---
description: Run App tests via pytest. --replay uses cassettes; --record/--live hit real APIs (cost + cassette overwrite).
argument-hint: [--replay|--record|--live] [test-path]
---

Run App tests in the requested mode.

This is a thin pytest entrypoint. It parses flags and forwards to `pytest`.

## Usage

```
/agent-test                                  # default: --replay (cassettes + mocks)
/agent-test --replay                         # explicit replay mode
/agent-test --replay backend/tests/test_loop.py
/agent-test backend/tests/test_tool_registry.py
/agent-test --record                         # VCR cassette record (hits real APIs)
/agent-test --live                           # bypass cassettes entirely (real APIs)
```

## Dispatch rule

1. **Parse flags** from `$ARGUMENTS`. Supported: `--replay`, `--record`, `--live`. Default: `--replay`.

2. **Set VCR_RECORD_MODE**:

```bash
case "$FLAG" in
  --record)
    echo "WARN: --record mode hits real APIs (cost + cassette overwrite)."
    export VCR_RECORD_MODE=record
    ;;
  --live)
    echo "WARN: --live mode bypasses cassettes entirely. Cost + slow."
    export VCR_RECORD_MODE=live
    ;;
  *)
    export VCR_RECORD_MODE=replay
    ;;
esac
```

3. **Determine the pytest target**: strip mode flags, use remaining as test path. Default: `backend/tests/`.

4. **Run pytest**:

```bash
pytest "$TARGET" -v -m "unit or integration" --tb=short
```

5. **Surface failures verbatim**. Do NOT auto-fix; route to `/agent-debug`.

## What this command does NOT do

- It does not start the dev server. Use `/agent-verify` for that.
- It does not modify pytest configuration.
- It does not auto-fix failing tests.

## Caveats

- The `unit` and `integration` markers must be defined in `pyproject.toml`.
- Slow tests (`@pytest.mark.slow`) are excluded by default.
