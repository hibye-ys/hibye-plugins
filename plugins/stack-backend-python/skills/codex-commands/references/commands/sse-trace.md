---
description: Trace SSE events from a local /run/<name> session — colorized event-by-event view via curl + awk. Entire $ARGUMENTS is treated as the message body (quote-preserving). Run endpoint is fixed to /run/chat; override via APP_SSE_TRACE_RUN env var.
argument-hint: [message...]
---

Trace the SSE event stream from the local App backend.

## Usage

`/sse-trace`                                 — sends default "hello" to `/run/chat`
`/sse-trace analyze episode 1`               — multi-word message (no quoting needed) to `/run/chat`
`APP_SSE_TRACE_RUN=my_run /sse-trace hello`  — custom run endpoint `/run/my_run`

## What it does

1. **Check the dev server is up** on `http://localhost:8000`.
2. **POST to `/run/<name>`** with `{"message": "..."}` (RunRequest schema) and
   stream the SSE response via `curl -N`.
3. **Colorize each frame** by event type with an `awk` filter.
4. **Press Ctrl-C to stop** — the stream stays open until the agent emits
   `done` or `error`.

## Dispatch

1. Health-check the dev server:

```bash
curl -fs http://localhost:8000/health > /dev/null || {
  echo "ERROR: dev server not responding on http://localhost:8000"
  echo "Start it with: uv run uvicorn backend.main:app --reload"
  exit 1
}
```

2. POST to `/run/<name>` and colorize the SSE stream:

```bash
# $ARGUMENTS 전체를 message 로 취급 (bash word-splitting 회피).
# Run endpoint 는 APP_SSE_TRACE_RUN env 로 override (기본: chat).
MESSAGE="${ARGUMENTS:-hello}"
RUN_NAME="${APP_SSE_TRACE_RUN:-chat}"

# JSON 안전 인코딩 (jq -Rs 로 shell-quote escape) — 따옴표/개행 문자 유입 시에도 파싱 실패 없음
PAYLOAD=$(jq -cn --arg m "${MESSAGE}" '{message: $m}')

# SSE 12-event set (stream.py 정본): session, agent, text, thinking, tool_call, tool_result,
# action, notification, suggestions, usage, done, error
# 주의: URL 은 unquoted — settings.json allow pattern
# `Bash(curl -N -X POST http://localhost:*/run/*)` 와 token-level 매칭 유지.
# RUN_NAME 는 RunPolicy name 정규식 (`^[a-z0-9_]+$`) 로 제약되어 shell metachar 없음.
curl -N -X POST http://localhost:8000/run/${RUN_NAME} \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}" \
  | awk '
    /^event: session/        { printf "\033[34m"; next }
    /^event: agent/          { printf "\033[35m"; next }
    /^event: text/           { printf "\033[36m"; next }
    /^event: thinking/       { printf "\033[96m"; next }
    /^event: tool_call/      { printf "\033[33m"; next }
    /^event: tool_result/    { printf "\033[93m"; next }
    /^event: action/         { printf "\033[95m"; next }
    /^event: notification/   { printf "\033[90m"; next }
    /^event: suggestions/    { printf "\033[37m"; next }
    /^event: usage/          { printf "\033[94m"; next }
    /^event: error/          { printf "\033[31m"; next }
    /^event: done/           { printf "\033[32m"; next }
    /^data:/                 { gsub(/^data: /, ""); print; printf "\033[0m\n"; next }
    { print }
  '
```

## Color legend (12-event 정본 — `backend/engine/stream.py::SSEEventType`)

| Color         | Event          | 용도 |
|---------------|---------------|-----|
| Blue          | `session`     | 스트림 시작, session_id 메타 |
| Magenta       | `agent`       | resolved agent/model 메타 |
| Cyan          | `text`        | LLM streaming text |
| Bright Cyan   | `thinking`    | extended-thinking block |
| Yellow        | `tool_call`   | 도구 호출 (name + input) |
| Bright Yellow | `tool_result` | 도구 결과 |
| Bright Magenta| `action`      | 구조화된 action 요약 |
| Gray          | `notification`| background spawn 수확 등 |
| White         | `suggestions` | 후속 제안 |
| Bright Blue   | `usage`       | 토큰/비용 — `done` 직전 |
| Red           | `error`       | 비정상 종료 (done 과 배타) |
| Green         | `done`        | 정상 종료 (error 와 배타) |

## Caveats

- Requires the dev server on `http://localhost:8000`. This command does NOT
  start it — use `/agent-verify` or `uv run uvicorn backend.main:app --reload`.
- Targets `POST /run/<name>` (current route prefix per `api-routing-patterns.md`).
  Body schema is `routes/schemas.py::RunRequest` (`{message, session_id?}`).
  Auth: dev `APP_AUTH_REQUIRED=false` required (anonymous OK); prod needs
  `Authorization: Bearer` which this command does not inject.
- ANSI colors are stripped in non-tty pipes — use `less -R` to preserve.
- Kill with Ctrl-C if the stream hangs.

## When to escalate

- 스트림 이벤트 구조/보안 감사가 필요하면 → `output-stream-manager` (stream-audit 모드)
- 시크릿 유출 의심 시 → `output-stream-manager` (stream-audit 모드) — scrub_secrets 커버리지 확인
- 비용/usage 추적 문제 → `output-stream-manager` (usage 모드)
- 전체 감사 → `/audit-all`

## What this command does NOT do

- It does NOT trace a pre-existing session by ID. It creates a new agent run.
- It does NOT implement filtering — pipe through `jq` or `grep` downstream.
- It does NOT record to file — pipe through `tee trace.log` if needed.
