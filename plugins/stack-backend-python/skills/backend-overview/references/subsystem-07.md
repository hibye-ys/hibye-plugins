> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/sse-streaming-patterns.md` + `core-infrastructure.md` §SSE Lifecycle + live implementation at `backend/engine/stream.py` + `backend/routes/run.py`.

# Subsystem 07 — SSE Streaming

## 목적 (1줄)

`POST /run/<name>` 응답 중 `policy.sse=true` 인 run 을 SSE (Server-Sent Events) 로
스트리밍하여 프론트가 실시간으로 text / tool_call / action / usage 이벤트를 받도록
한다. `sse=false` 인 run 은 같은 이벤트를 내부 버퍼에 모아 단일 JSON 응답으로 반환.

## 파일 / 모듈

- `backend/engine/stream.py` — `SSEEventType` Literal (12종), `_SCAN_EVENTS` (7 scrub 대상),
  `serialize_sse()`, `scrub_secrets()`/`_scrub_dict()` re-export, `X-App-*` 헤더 상수
- `backend/routes/run.py` — `POST /run/<name>` 라우트, `EventSourceResponse(ping=15)`,
  헤더 주입, `_stream_agent` HTTP wrapper
- `backend/engine/loop.py::run_loop_stream` — 엔진 측 종료 보장 (`done_seen` + finally 안전망)
- `backend/observability/secrets.py` — `_SECRET_PATTERNS` (7종) + `_FAST_CHECK_ANCHORS` (정본 위치)

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `SSEEventType` | 12 이벤트 Literal |
| `_SCAN_EVENTS` | scrub 필수 7 이벤트 frozenset |
| `serialize_sse(event_type, data)` | wire format 직렬화 (`event: ... / data: <json> / 빈 줄`) |
| `scrub_secrets(text)` | 7 패턴 + anchor fast-path |
| `_scrub_dict(obj)` | dict/list leaf 재귀 스캔 |
| `run_loop_stream(...)` | 엔진 제너레이터, `done_seen` 기반 종료 보장 |
| `_stream_agent(policy, req, auth)` | `routes/run.py` 의 HTTP wrapper — engine yield 를 SSE 로 릴레이 |

## SSE 12 이벤트 (stream.py::SSEEventType 정본)

```
event: session       — {"session_id": "..."}
event: agent         — {"agent": "...", "model": "..."}
event: text          — {"text": "..."}
event: thinking      — {"text": "..."} (extended-thinking)
event: tool_call     — {"name": "...", "final_input": {...}}
event: tool_result   — {"tool_name": "...", "result": "...", "is_error": bool}
event: action        — {"result_summary": "..."}
event: notification  — free-form dict (background spawn 수확 등)
event: suggestions   — {"prompts": [...]}
event: usage         — {"input_tokens": N, "output_tokens": N, "cost_usd": N, ...}
event: done          — {"turn_count": N, ...} (정상 종료, error 와 배타)
event: error         — {"code": "...", "message": "..."} (비정상 종료, done 과 배타)
```

## 이벤트 플로우

```
1. session 이벤트 (session_id 발급/재사용)
2. agent 이벤트 (선택된 agent + resolved model)
3. 루프 반복:
   - text / thinking 이벤트 (LLM 스트림 중)
   - tool_call 이벤트 (tool_use 블록 수신 시)
   - tool_result / action 이벤트 (도구 실행 완료 시)
   - notification 이벤트 (background spawn 결과 등)
4. usage 이벤트 (토큰/비용 누적 — `done` 직전)
5. suggestions 이벤트 (옵션)
6. done 이벤트 (정상 종료)
```

에러 발생 시: `usage` (가능하면) + `error` 이벤트. `done` 은 발송되지 않음 (배타).
`run_loop_stream` 의 finally 안전망이 비정상 종료를 `error("InternalError")` 로
합성한다 — `done` 합성 아님 (실패를 성공으로 포장 금지).

## HTTP 헤더 (payload 대신)

| 헤더 | 값 | 상태 |
|---|---|---|
| `X-App-Session-Id` | session_id | ✅ |
| `X-App-Model` | resolved model | ✅ |
| `X-App-Agent` | agent/run name | ✅ |
| `X-App-Usage` | `input=N,output=M` | 📋 future (현재는 `usage` 이벤트로만) |

CORS `expose_headers` 에 4종 포함 (`X-Request-Id` 추가) — `main.py` 의 `add_middleware(CORSMiddleware, expose_headers=[...])`.

## 담당 skill

- `sse-streaming` — 구현 청사진 (wire format, scrub, keepalive, 종료 보장)
- `stream-audit` — 감사 grep 체크리스트 (scrub 커버리지, 헤더 분리, done/error 배타)

## 범위

- 12 이벤트 전체 스키마 정의 + stream.py Literal 과 1:1 매칭
- 종료 보장 (`done_seen` + finally 안전망 — `error` 합성, `done` 합성 아님)
- `_SCAN_EVENTS` 7종 scrub 의무 + dict 재귀 (`_scrub_dict`)
- `ping=15` keepalive, `X-Accel-Buffering: no` (직접 `StreamingResponse` 쓸 때)
- `action` / `notification` / `suggestions` 는 현재 payload 스키마만 준비 (케이스별 실데이터 유입)

## Gotchas

- **event name 과 data 는 엄격**: 프론트가 switch(event) 로 분기. 이름 추가는
  `SSEEventType` Literal + `sse-streaming-patterns.md` 표 + `core-infrastructure.md` §SSE Lifecycle + 클라이언트 파서 동시 업데이트
- **heartbeat 필수**: LB/proxy 가 무활동 60초 후 silent disconnect. `EventSourceResponse(ping=15)` 반드시 사용
- **secret scanner drift guard**: `_SECRET_PATTERNS` 추가 시 `_FAST_CHECK_ANCHORS` 도 함께 늘려야 함 — 길이 불일치 시 import-time `ImportError` 로 부팅 실패
- **종료 경로 중복 금지**: `run_loop_stream` 이 이미 finally 안전망을 가지므로, `routes/run.py::_stream_agent` 는 wrapper 만. terminal 이벤트 이중 합성 금지

## 관련 rule

- `sse-streaming-patterns.md` — 불변식 원본 (wire format / 보안 / 안정성 / 종료 보장)
- `core-infrastructure.md` §SSE Lifecycle — 12 이벤트 순서 정본
