---
name: sse-streaming
description: "REQUIRED for backend/engine/stream.py and backend/routes/run.py — without this skill you WILL miss scrub_secrets() with _SECRET_PATTERNS (sk-, AKIA, ghp_, PEM, Google, Slack, JWT), serialize_sse() wire format, _scrub_dict() recursive scanning, EventSourceResponse(ping=15) keepalive, X-App-* headers, and done_seen termination flag. Load BEFORE writing any SSE handler."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (non-negotiable — baseline misses ALL of these)
1. MUST implement `scrub_secrets()` delegating to `_SECRET_PATTERNS` in
   `backend/observability/secrets.py` (stream.py re-exports, canonical source = observability)
2. MUST implement `serialize_sse()` for `event: <name>\ndata: <json>\n\n` wire format
3. MUST implement `_scrub_dict()` for recursive dict scanning
4. MUST use `EventSourceResponse(ping=15)` for keepalive
5. MUST set `X-App-*` HTTP headers for session-wide meta (NOT in SSE payload)
6. MUST guarantee `done_seen` termination flag in finally block (run_loop_stream)

**정본 소스 (본 skill 은 구현 청사진 — 불변식 원본은 rule 파일)**:
- `.agents/rules/python_agent_rules/sse-streaming-patterns.md` — wire format / 보안 / 안정성 / 종료 보장
- `.agents/rules/python_agent_rules/core-infrastructure.md` §SSE Lifecycle — 12 이벤트 집합 + 순서
- `backend/engine/stream.py::SSEEventType` — 12 이벤트 Literal (런타임 정본)
- `backend/engine/stream.py::_SCAN_EVENTS` — scrub 대상 7 이벤트 frozenset
- `backend/observability/secrets.py::_SECRET_PATTERNS` — 시크릿 정규식 정본 (현재 7종)

# sse-streaming — SSE 응답 청사진

## 이 skill은 언제 로드되는가

- `backend/engine/stream.py` 최초 작성 / 이벤트 타입 추가 / scrub 패턴 튜닝
- `backend/routes/run.py` 의 `POST /run/<name>` 엔드포인트 작성 (policy.sse=true 인 run 대상)
- "SSE stream 이 중간에 끊어진다" 증상
- "클라이언트가 `done` 이벤트를 못 받는다" 증상
- "`text` 이벤트에 시크릿이 노출됐다" 사고
- "tool_use 가 SSE forward 는 되는데 tool executor 에서 empty"

## SSE Streaming 의 정체성

`/run/<name>` 엔드포인트 중 `policy.sse=true` 인 run 은 Agent Loop 의 진행 상황을
SSE 로 전송한다 (`policy.sse=false` 인 run 은 같은 이벤트를 내부 버퍼에 모아 JSON
응답으로 변환). 이 계층의 4가지 책임:

1. **이벤트 변환** — Agent Loop 가 yield 하는 내부 Event 객체를 SSE 텍스트
   (`event: <name>\ndata: <json>\n\n`) 로 직렬화 (`serialize_sse()` 단일 함수)
2. **flush 타이밍** — backpressure 없이 클라이언트로 전송. 느린 클라이언트는
   `sse_starlette` 이 `ClientDisconnect` 로 자동 감지 후 조용히 종료
3. **secret scanning** — `_SCAN_EVENTS` (7 이벤트) 발신 전 `_scrub_dict()` 통과 의무
4. **종료 보장** — `done` 또는 `error` 이벤트가 반드시 마지막에 단 한 번 전송됨
   (`run_loop_stream` 의 `done_seen` 플래그 + finally 안전망)

책임 분리: `backend/engine/stream.py` (이벤트 타입 enum + serialize + scrub) +
`backend/routes/run.py` (FastAPI route + `EventSourceResponse` + `X-App-*` 헤더).

## 12 SSE 이벤트 집합 (stream.py::SSEEventType 정본)

| event | 시점 | 주요 payload 필드 | scrub 대상? |
|---|---|---|---|
| `session` | 스트림 시작 첫 이벤트 | `session_id: str` | ✗ |
| `agent` | resolved agent/model 메타 | `agent: str`, `model: str` | ✗ |
| `text` | LLM text delta | `text: str` | ✅ |
| `thinking` | extended-thinking block | `text: str` | ✅ |
| `tool_call` | tool_use block (이름 + 최종 input) | `name: str`, `final_input: dict` | ✅ (dict 재귀) |
| `tool_result` | 도구 실행 완료 (preview) | `tool_name, result, is_error` | ✅ (dict 재귀) |
| `action` | 구조화된 action 요약 | `result_summary: str` | ✅ |
| `notification` | background spawn 완료 등 자유 payload | free-form dict | ✅ (dict 재귀) |
| `suggestions` | 후속 제안 | `prompts: list[str]` | ✗ |
| `usage` | 토큰 / 비용 — `done` 직전 | `input_tokens, output_tokens, cost_usd, ...` | ✗ |
| `done` | 정상 종료 (error 와 배타) | `turn_count` 등 | ✗ |
| `error` | 비정상 종료 (done 과 배타) | `code: str`, `message: str` | ✅ (message only) |

```python
# backend/engine/stream.py (정본 snapshot)
from typing import Literal

SSEEventType = Literal[
    "session",
    "agent",
    "text",
    "thinking",
    "tool_call",
    "tool_result",
    "action",
    "notification",
    "suggestions",
    "usage",
    "done",
    "error",
]

# scrub_secrets 를 반드시 경유해야 하는 7 이벤트 (3 메타 + 2 종료 + 0 keepalive 는 제외)
_SCAN_EVENTS: frozenset[str] = frozenset({
    "text", "thinking", "tool_call", "tool_result",
    "action", "error", "notification",
})
```

**12 이벤트는 fixed set** — 새 이벤트가 필요하다고 느껴지면 대부분은 기존 이벤트의
payload 필드 확장으로 해결된다. 새 타입 추가 시 본 skill 의 표 +
`SSEEventType` Literal + `_SCAN_EVENTS` 추가 여부 + `sse-streaming-patterns.md`
표 + `core-infrastructure.md` §SSE Lifecycle + 클라이언트 파서 5곳을 동시에 갱신.

## serialize_sse — wire format

정본 구현은 `backend/engine/stream.py::serialize_sse` — 본 skill 은 그 계약만
요약한다. **본문 snippet 은 참조용 단순화본이 아니라 "실제 시그니처"**.

시그니처 (정본 그대로):

```python
# backend/engine/stream.py (actual)
def serialize_sse(event: SSEEventType, data: Mapping[str, object]) -> str:
    """Returns `"event: <name>\\ndata: <json>\\n\\n"` as a str (not bytes).

    내부 동작:
    - event 가 `_SCAN_EVENTS` (7종) 에 포함되면 `_scrub_dict(dict(data))` 로 자동 scrub.
      → 호출자가 `_scrub_dict` 를 직접 호출할 필요 없음.
    - 제외된 이벤트 (session / agent / suggestions / usage / done) 의 payload
      scrub 여부는 호출자 책임 (regex 오버헤드 회피).
    - `json.dumps(payload, ensure_ascii=False, default=str)` — UTF-8 + 비직렬화
      값 fallback.
    - 반환 타입은 **`str`** — `sse_starlette.EventSourceResponse` 가 직접 소비.
      `.encode("utf-8")` 수동 호출 금지.
    """
```

주의:
- 구현 변경이 필요하면 `backend/engine/stream.py` 를 **유일한 편집 지점** 으로.
  본 skill snippet 은 rule 표와 함께 "대외 계약" 서술일 뿐 — 내부 자동 scrub
  동작이 바뀌면 본 skill + `sse-streaming-patterns.md` 둘 다 갱신.
- 호출자 측에서 serialize_sse 를 bytes 라고 가정하면 `EventSourceResponse` 의
  encoding 이 중복 적용되어 wire 깨짐.

## HTTP 헤더 분리 원칙

`session_id`, `model`, `agent` 같은 **세션 수명 동안 불변인 메타 정보**는 SSE payload
에 중복 삽입하지 않고 HTTP response 헤더로 내려보낸다 (`stream.py` 상수):

| 헤더 이름 | 값 | 시점 | 상태 |
|---|---|---|---|
| `X-App-Session-Id` (`SESSION_HEADER`) | `req.session_id` | 스트림 시작 | ✅ 구현 |
| `X-App-Model` (`MODEL_HEADER`) | resolved model id | 스트림 시작 | ✅ 구현 |
| `X-App-Agent` (`AGENT_HEADER`) | `agent_spec.name` / run name | 스트림 시작 | ✅ 구현 |
| `X-App-Usage` | `input=<N>,output=<M>` | `done` 직후 trailer 또는 별도 GET | 📋 future — 현재는 `usage` SSE 이벤트로만 |

**CORS expose_headers 계약** (`backend/main.py::add_middleware(CORSMiddleware)`):
브라우저 JS 가 읽어야 하는 4종: `X-App-Session-Id`, `X-App-Agent`, `X-App-Model`,
`X-Request-Id`. 목록 변경은 FE contract breaking 이므로 프론트엔드 client 코드
동시 검토 필수.

> **왜**: SSE payload 에 넣으면 클라이언트가 **모든 이벤트를 파싱**해야 세션 기본
> 정보를 꺼낼 수 있다. 헤더면 fetch/XHR 레벨에서 즉시 접근 가능하고, 스트림
> 시작 전 preflight 판단에 쓸 수 있다.

## sse_starlette vs StreamingResponse

| 기준 | `sse_starlette.EventSourceResponse` | `fastapi.responses.StreamingResponse` |
|---|---|---|
| ping 자동화 | Yes (`ping=15`) | No — 직접 구현 |
| disconnect 감지 | 자동 (`ClientDisconnect`) | 수동 (`is_disconnected()` 폴링) |
| 헤더 주입 | `headers=` | `headers=` |
| 의존성 | `sse-starlette` 1개 | 0 (FastAPI 내장) |

**권장: `sse_starlette.EventSourceResponse`**. ping 자동화 + disconnect 감지가 가치
있다. `StreamingResponse` 로 직접 쓰면 `X-Accel-Buffering: no` 헤더 + 15초 keepalive
루프 + `is_disconnected()` 폴링을 **전부 수동** 구현해야 한다.

정본 라우트 구현: `backend/routes/run.py::dispatch_run`. 본 skill 은 계약 포인트만
나열 — **실제 코드를 복제하지 않는다** (복제본이 drift 원이 되는 걸 여러 번 겪음).

```python
# backend/routes/run.py 호출 순서 (실구현 요약 — 복사 금지, 실구현을 읽어라)
# 1. policy 해석: `policy = get_registry().get(name)`  (⚠️ RunRegistry.get 아님 — get_registry() 싱글턴 경유)
#    - None 이면 `raise not_found("run", name)` (leak-safe 404)
# 2. caller_identity(auth) 로 user_id/scopes 추출
# 3. required_scope 가드 — 미충족 시 leak-safe 404 (403 아님)
# 4. session_id 확정 (req.session_id or new_hex_id())
# 5. policy.session_enabled 이면 SessionPort 로 ensure_session
# 6. 응답 분기:
#    - policy.sse=True  → **먼저** policy.response_schema is not None 이면
#                         `http_error(422, "invalid_policy", ...)` 로 request-time reject,
#                         그다음 `EventSourceResponse(_to_sent_events(event_source),
#                                                    ping=SSE_KEEPALIVE_SEC,
#                                                    headers={SESSION_HEADER, MODEL_HEADER, AGENT_HEADER})`
#                         — run_loop_stream 직접 X, _to_sent_events wrapper 필수 (아래 주의 참조).
#    - policy.sse=False → 내부 버퍼링 후 단일 JSON (`{"events": [...]}`)
```

주의:
- **`RunRegistry.get(name)` 같은 classmethod API 는 없다.** 반드시
  `from backend.engine.run_registry import get_registry` 후 `get_registry().get(name)`.
  이전 drift 사례에서 이 한 줄을 잘못 기억해 두 번 꼬였음.
- **`EventSourceResponse(run_loop_stream(...))` 처럼 직접 wrap 금지.** `run_loop_stream`
  은 `serialize_sse()` 로 pre-formatted 된 SSE wire-format **string** 을 yield 한다.
  `EventSourceResponse` 는 yielded str 을 "data 필드" 로 재래핑해서
  `data: event: X\ndata: data: {...}` 같은 **double-wrap** 이벤트를 만든다.
  HTTP 경계에서 반드시 `_to_sent_events()` (`routes/run.py::_to_sent_events`) 로 각 프레임을
  파싱해 `ServerSentEvent(event=<name>, data=<json>)` 객체로 변환한 뒤 넘겨야 한다.
  이 조합이 테스트/JSON buffer path (policy.sse=False) 와 wire format 을 공유하는 이유.
- **`sse=True` + `response_schema` 조합은 request-time 422 reject**. startup validator 가
  아님. `response_schema` 는 assistant 전체 메시지를 파싱해야 하므로 stream 과 상호
  배타 — `dispatch_run` 에서 `EventSourceResponse` 생성 **직전에** check →
  `http_error(status_code=422, code="invalid_policy", message="response_schema requires policy.sse=false ...")`.
  (run-policy.md 의 cross-field 표기는 설계 의도 기술일 뿐; 실 enforcement 는 route 지점.)

## Stream tee — provider 결과 이중 소비

`provider.call_stream()` 결과를 SSE 로 forward **만** 하고 collect 안 하면 tool_use
블록 추출에 실패한다 (SSE 는 흐르는데 Stage 4 tool executor 는 "empty tool_use" 를
본다). 반드시 **forward Queue + collect Queue 2개** 로 tee — `provider-layer` skill
의 "stream forwarding needs tee" 패턴을 `stream.py` 에서도 동일 적용.

## Secret Scanner Injection Point

`_SCAN_EVENTS` (7 이벤트) 발신 전에 `_scrub_dict()` (dict) 또는 `scrub_secrets()`
(string) 를 반드시 통과시켜야 한다. 정본 위치는 `backend/observability/secrets.py`
— `backend/engine/stream.py` 는 편의상 re-export 만 한다 (로그 파이프라인과
동일 패턴 공유).

**정본을 직접 보라 — 복사본은 만들지 않는다:**

- `backend/observability/secrets.py` — `_SECRET_PATTERNS` (현재 7 종), `_FAST_CHECK_ANCHORS`,
  `scrub_secrets(text)`, `_scrub_dict(obj)` 전체 구현
- `backend/engine/stream.py` — `scrub_secrets` / `_scrub_dict` / `_SCAN_EVENTS` re-export

계약 포인트 (본 skill 이 갱신해야 하는 지점):

| 항목 | 규약 |
|---|---|
| 패턴 수 | **7종** — 변경 시 `_SECRET_PATTERNS` + `_FAST_CHECK_ANCHORS` 길이 매칭 필수 |
| 커버 이름 | `sk-*` / `AKIA*` / `ghp_*` / PEM PRIVATE KEY / `AIza*` / `xox*` / JWT (`eyJ...`) |
| fast-path | anchor substring 검사로 일반 payload 는 **O(1) no-op** (regex 실행 전 skip) |
| drift guard | **길이 불일치 시 import-time `ImportError` raise** (silent `assert` 아님 — `python -O` 로도 strip 불가) |
| fail-safe | 알려진 패턴만 차단. unknown 은 통과 — 운영 로그/감사에서 보완 |

> **복사본 금지 원칙**: 과거 세션에서 본 skill 에 `_SECRET_PATTERNS` 스니펫을 직접
> 적어 두었다가 `{32,}` → `{28,}` 같은 threshold 가 silent 하게 drift 했음. 구현 변경은
> `observability/secrets.py` 단일 지점에서만 하고, 본 skill 은 위 계약 표만 갱신.

**Scrub 적용 7 이벤트** (`_SCAN_EVENTS`): `text`, `thinking`, `tool_call`,
`tool_result`, `action`, `error`, `notification`. `session` / `agent` /
`suggestions` / `usage` / `done` 은 제외 (regex overhead 회피). 문자열 한 번
`scrub_secrets`, dict 계층은 `_scrub_dict` 로 재귀.

## 종료 보장 — `run_loop_stream` 의 done_seen 플래그

Agent Loop 가 정상 종료하든 에러로 죽든, 마지막 이벤트는 반드시 `done` 또는
`error` 단 하나여야 한다 (배타). 그렇지 않으면 클라이언트는 스트림이 끝났는지
모른다.

정본 구현: `backend/engine/loop.py::run_loop_stream` (엔진 쪽에서 종료 보장 담당).
`backend/routes/run.py::_stream_agent` 는 HTTP wrapper — 단순 yield + ContextVar
rebind 만:

```python
# backend/engine/loop.py::run_loop_stream (요약)
async def run_loop_stream(...):
    done_seen = False
    try:
        async for event_type, payload in _execute_loop(...):
            if event_type in ("done", "error"):
                done_seen = True
            # scrub_secrets / _scrub_dict 주입 지점 — _SCAN_EVENTS 만
            if event_type in _SCAN_EVENTS:
                payload = _scrub_event_payload(event_type, payload)
            yield event_type, payload
    except AppError as e:
        done_seen = True
        yield "error", {"code": type(e).__name__, "message": scrub_secrets(str(e))}
    except asyncio.CancelledError:
        done_seen = True
        raise
    finally:
        if not done_seen:
            # 비정상 종료 — `error` 합성 (done 합성 아님; 성공으로 포장 금지)
            logger.warning("loop.terminal_missing")
            try:
                yield "usage", {...}  # 가능한 만큼의 usage 스냅샷
                yield "error", {
                    "code": "InternalError",
                    "message": "loop terminated without done/error",
                }
            except Exception:
                logger.warning("loop.terminal_emit_failed")  # 이미 disconnect
```

> **`error` 합성이 핵심**. 과거에 `done` 합성으로 두면 비정상 종료가 "성공" 으로
> 표시되어 모니터링/과금이 오염된다. finally 안전망은 **실패를 명시적으로 노출**.

## 동시성 함정 — 이 서브시스템 고유

1. **stream tee 누락** → tool_use 가 SSE 에는 흐르지만 tool executor 는 empty.
   forward Queue + collect Queue 각각 독립 drain 필요.

2. **`_scrub_dict` 없이 tool_call/tool_result payload 직접 yield** → 재귀 leaf 누락
   으로 dict 안쪽 문자열 시크릿 통과. 반드시 dict 는 `_scrub_dict` 경유.

3. **`ping=15` 미설정** → LB/proxy (nginx/cloudflare) 가 무활동 60초 후 silent disconnect.
   클라이언트 입장에서 갑자기 stream 이 멈춘 것처럼 보이고 에러도 없다.

4. **`_FAST_CHECK_ANCHORS` 와 `_SECRET_PATTERNS` 길이 불일치** → 새 패턴을
   `_SECRET_PATTERNS` 에 추가하면서 anchor 를 빠뜨리면 fast-path 가 해당 패턴을 skip.
   보호: import-time `assert` (예시 위) 가 부팅 실패로 잡아준다.

5. **종료 경로를 routes 에서도 중복 합성** → engine 쪽 `run_loop_stream` 이 이미
   finally 안전망을 가지므로, `routes/run.py::_stream_agent` 는 wrapper 만. terminal
   event 를 두 곳에서 합성하면 이중 종료.

## 검증 체크리스트

- [ ] 12 이벤트 타입 모두 `SSEEventType` Literal 에 명시 (위 표와 1:1)
- [ ] `_SCAN_EVENTS` 가 정확히 7개 (text, thinking, tool_call, tool_result, action, error, notification)
- [ ] `serialize_sse` 가 `event: ...\ndata: ...\n\n` wire format 정확히 생성 (trailing blank line + utf-8 + ensure_ascii=False)
- [ ] `EventSourceResponse(ping=15)` 사용
- [ ] `scrub_secrets` 가 7 패턴 (sk-, AKIA, ghp_, PEM, AIza, xox, JWT) 모두 커버 + `_FAST_CHECK_ANCHORS` 길이 매칭
- [ ] `_scrub_dict` 로 `tool_call.final_input` + `tool_result` + `notification` 재귀 스캔
- [ ] HTTP 헤더로 session_id / model / agent 분리 (`SESSION_HEADER` / `MODEL_HEADER` / `AGENT_HEADER` 상수 사용)
- [ ] CORS `expose_headers` 에 `X-App-Session-Id`, `X-App-Agent`, `X-App-Model`, `X-Request-Id` 4종 포함
- [ ] `run_loop_stream` 의 `done_seen` 플래그 + finally 안전망으로 **error 합성** (done 합성 금지)
- [ ] routes/run.py 는 engine 의 종료 보장을 wrap 만 — 중복 합성 없음
- [ ] stream tee 패턴이 `provider.call_stream` 소비 경로에 적용됨
- [ ] pytest — mock Agent Loop → 12 이벤트 시퀀스 검증 + disconnect 시 조용히 종료

## 구현 중 막히면

- **"stream 이 중간에 끊긴다"** → `ping=15` 설정 확인. 그래도 끊기면 reverse proxy
  타임아웃 + `X-Accel-Buffering: no` 헤더 확인.
- **"tool_use 가 SSE forward 는 되는데 executor 에서 empty"** → stream tee 패턴
  누락. `provider-layer` skill "stream forwarding needs tee" 섹션 참조.
- **"client 가 done 을 못 받는다"** → `run_loop_stream` 의 finally 가 제거됐거나
  engine 바깥에서 terminal 이벤트를 합성 중. done_seen 플래그 동작 확인.
- **"시크릿이 payload 에 노출됐다"** → `_SCAN_EVENTS` 중 하나에 누락. `_scrub_dict`
  재귀 경로 확인 + 새 패턴이라면 `observability/secrets.py::_SECRET_PATTERNS` +
  `_FAST_CHECK_ANCHORS` 동시 추가.
- **"session_id / model 을 payload 에 넣고 싶다"** → HTTP 헤더 분리 원칙 위반.
  `SESSION_HEADER` / `MODEL_HEADER` 상수 사용.
- **"done 과 error 가 모두 발송된다"** → 배타 위반. `done_seen` 플래그로 가드
  + engine ↔ routes 중 한 곳에서만 합성.
- 위 가이드로 안 풀리면: 사용자에게 직접 보고. 추측으로 전역 설정을 바꾸지 말 것.

## 관련 자산

- `sse-streaming-patterns.md` rule — 불변식 원본 (wire format / 보안 / 안정성)
- `core-infrastructure.md` §SSE Lifecycle — 12 이벤트 순서 정본
- `stream-audit` skill — 감사 grep 체크리스트
- `/sse-trace` command — 런타임 이벤트 시퀀스 관찰
- `output-stream-manager` sub-agent — stream-audit / usage 모드
- `provider-layer` skill §tee — 이중 Queue drain 패턴
