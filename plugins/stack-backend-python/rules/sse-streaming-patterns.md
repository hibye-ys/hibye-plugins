---
paths:
  - "backend/engine/stream.py"
  - "backend/routes/run.py"
---

> App backend rules — SSE Streaming invariants, extension guide, impact map.
> 관련: `core-infrastructure.md` (§SSE Lifecycle 12 이벤트 정의 원본),
>       `error-handling.md` (SSE error 이벤트 패턴), `provider-layer` skill (stream tee)

# sse-streaming-patterns — SSE 스트리밍

## 불변식 (Invariants)

**12 이벤트 집합 (고정):**

이벤트 타입 목록 / lifecycle 순서 / 종료 보장 4 제약은 `_shared/sse-lifecycle.md` 가 정본 (언어 무관). 본 rule 은 **Python 측 wire format / 보안 / 안정성 / 종료 보장** 을 추가 규율한다.

**Wire Format:**

```
id: <int>\n         ← W3C SSE spec — monotonic counter, run-scoped
event: <name>\n
data: <json>\n
\n                ← 빈 줄 필수 (SSE spec)
```

- 1 이벤트 = 1 JSON 라인 + 종단 빈 줄
- `json.dumps(data, ensure_ascii=False)` — 불필요 escape 방지 (성능)
- UTF-8 인코딩 고정
- serialize 로직은 `serialize_sse()` 단일 함수로 중앙화 (engine layer)
- `id:` 필드는 **routes layer** 의 `_to_sent_events()` (`backend/routes/run.py`) 에서 주입 — engine 의 `serialize_sse()` 는 기존대로 `event:`/`data:` 만 emit. 이유: id 는 run-scoped 단조증가 counter 라 HTTP 경계 (route + replay registry) 와 결합되며, engine 는 stream content 만 책임

**HTTP 헤더 분리 원칙 (payload 오염 금지):**

세션 수명 동안 **불변** 인 메타 정보는 HTTP response 헤더로만 전달. SSE payload 에 섞지 않음.

| 헤더 | 값 | 시점 | 상태 |
|------|-----|------|------|
| `X-App-Session-Id` | req.session_id | 스트림 시작 | ✅ 구현 (`stream.py::SESSION_HEADER`) |
| `X-App-Model` | resolved model | 스트림 시작 | ✅ 구현 (`MODEL_HEADER`) |
| `X-App-Agent` | agent_spec.name | 스트림 시작 | ✅ 구현 (`AGENT_HEADER`) |
| `X-App-Run-Id` | run-scoped uuid (sse=True only) | 스트림 시작 | ✅ 구현 (`RUN_ID_HEADER`, SSE Resilience Phase 1) |
| `X-App-Moderation-Status` | `ok` / `failed_open` / `skipped_short` / `disabled` (blocked 은 422 envelope 으로 분기) | 스트림 시작 | ✅ 구현 (`MODERATION_STATUS_HEADER`, Content Moderation Phase 1) |
| `X-App-Jailbreak-Status` | `ok` / `flagged` / `blocked` / `failed_open` / `skipped_short` / `disabled` (6값 — `flagged` = 매치 + log_only enforcement → 200 통과; `blocked` = 매치 + block enforcement → 422 envelope. `blocked` 도 헤더에 set 됨, 단 422 분기는 별도 envelope) | 스트림 시작 | ✅ 구현 (`JAILBREAK_STATUS_HEADER`, Jailbreak Detection Phase 1) |
| `X-App-Usage` | input=<N>,output=<M> | `done` 직후 trailer 또는 별도 GET | 📋 future — 현재 미구현. 사용량은 `usage` SSE 이벤트로만 전달 |

- payload 에 넣으면 모든 이벤트 파싱 후에야 세션 정보 취득 → preflight 불가
- 세션/모델/에이전트 **정본은 헤더**, SSE payload 에는 중복 삽입 금지

**Keepalive + Disconnect 처리:**

- **`ping=15` 필수** — load balancer / reverse proxy(nginx/cloudflare) 의 60초 무활동 drop 방지
- `sse_starlette.EventSourceResponse` 기본 채택 — ping 자동화 + ClientDisconnect 자동 감지
- `StreamingResponse` 직접 사용 시: 15초 keepalive 루프 + `X-Accel-Buffering: no` + `is_disconnected()` 폴링 수동 구현 필수
- ClientDisconnect 시 조용히 종료 — error 이벤트 발송 금지 (받을 클라이언트 없음)

**종료 보장 (done / error 단일 종점):**

```
session → agent → (streaming events)* → (usage)? → done | error
```

- 마지막 이벤트는 반드시 `done` 또는 `error` 단 하나
- `done` 과 `error` 는 배타적 (둘 다 보내지 않음)
- `run_loop_stream()` (`backend/engine/loop.py:422`) 이 `done_seen` 플래그를 try/finally 로 추적 — normal path, `AppError` catch, `CancelledError` catch 모두에서 set
- **finally 안전망**: `done_seen` 이 False 로 finally 에 도달하면 `logger.warning("loop.terminal_missing")` 후 합성 **`usage` + `error`** 발송 (코드: `InternalError`, 메시지: `"loop terminated without done/error"`). `done` 합성이 아닌 **`error` 합성** — 비정상 종료를 모델/운영자에게 노출
- 클라이언트 이미 disconnect 되어 emit 실패 시 silent swallow (로그만 `loop.terminal_emit_failed`)
- `_stream_agent()` (`backend/routes/run.py:83`) 는 HTTP wrapper — 종료 보장 로직은 engine 쪽에서 담당. routes 는 단순 yield + ContextVar rebind 만

**Secret + PII Scanner Injection Point:**

발신 전 반드시 `_scrub_dict()` 통과해야 하는 7 이벤트 (`backend/engine/stream.py::_SCAN_EVENTS`). `_scrub_dict` 는 string leaf 마다 `scrub_text(text)` 를 호출하며 `scrub_text = scrub_pii(scrub_secrets(text))` 로 시크릿 + PII 양쪽을 단일 통과로 처리:

| 이벤트 | 주 스캔 필드 | 메모 |
|--------|----------|------|
| `text` | `data.text` | 모델 출력 텍스트 |
| `thinking` | `data.text` | extended-thinking 블록 |
| `tool_call` | `data.final_input` (dict 전체) | 재귀 스캔 |
| `tool_result` | `data.*` tool output payloads | 재귀 스캔 |
| `action` | `data.result_summary` | plain string |
| `error` | `data.message` | provider 예외 leak 방지 |
| `notification` | `data` free-form payload | 재귀 스캔. 알려진 `kind` 값: ① `kind="output_moderation"` (Output-side moderation hookup, ModerationPolicy.output_enabled opt-in) — payload `{kind, status: "ok"\|"flagged"\|"failed_open", provider, categories: list[str]}`, terminal `done` 직전 inject (log_only Phase 1). ② background spawn harvest (legacy free-form). 새 `kind` 추가 시 클라이언트 파서 unknown-kind 무시 보장 |

- `session` / `agent` / `suggestions` / `usage` / `done` 은 스캔 대상 아님 (regex overhead 회피)
- **Canonical sources**:
  - **Secrets** — `backend/observability/secrets.py::_SECRET_PATTERNS` (7종)
  - **PII** — `backend/observability/pii.py::_PII_UNION` (Phase 1: 5종)
  - 두 모듈 모두 로그 파이프라인 (`observability/processors.py::scrub_log_values`) 과 **동일 함수** 공유 (`scrub_text`)
- **Secret 패턴 7종**: `sk-...` (OpenAI/Anthropic), `AKIA...` (AWS), `ghp_...` (GitHub), PEM private key (RSA/DSA/EC/OPENSSH/PGP/ENCRYPTED), `AIza...` (Google API key), `xox[baprs]-...` (Slack), `eyJ...` (JWT 3-part)
- **PII 패턴 5종 (Phase 1)**: 한국 RRN (`\d{6}-\d{7}`), 한국 모바일 (`01[016789]-?\d{4}-?\d{4}`), 한국 유선전화 (02/031-033/041-044/051-055/061-064/070), 이메일 (RFC-ish), 신용카드 PAN (Luhn 검증), 한국 운전면허. **Phase 2 후보**: 한국 여권, 주소, 이름 (NER 필요)
- **Fast-path 최적화**:
  - Secrets: `_FAST_CHECK_ANCHORS` (prefix anchor regex)
  - PII: `_FAST_PII_PROBE = re.compile(r"[@0-9]")` — 숫자/`@` 미포함 string 은 union sub 전부 skip
  - 두 fast-path 모두 **identity-equal preserved** — `_scrub_dict` 의 `is`-probe 최적화 유지
- **Import-time drift guard**: secrets 는 `len(_FAST_CHECK_ANCHORS) != len(_SECRET_PATTERNS)` 시 `ImportError`. PII 는 `len(_PII_UNION.groupindex) != _PII_UNION_EXPECTED_GROUPS` 시 `ImportError` (`python -O` 로도 strip 불가)
- entropy 기반 heavy 검사는 별도 background task — 스트림 경로에 두면 backpressure 유발
- **fail-safe 원칙**: 알려진 패턴만 차단. unknown 은 통과 — 운영 로그/감사에서 보완
- **PII 게이팅**: tool_result 블록에 한해 `RunPolicy.pii_redaction` (default `True`) 가 false 면 `scrub_tool_result_content` 우회 (단, SSE wire scrub 은 항상 작동 — `_SCAN_EVENTS` 통과는 정책 무관)

**Backpressure + Flush:**

- `sse_starlette` 는 매 yield flush. 느린 클라이언트는 ClientDisconnect 로 감지
- 직렬화 비용 관리: `json.dumps(ensure_ascii=False, default=str)` + 스캐너는 anchor fast-path 로 일반 payload 에 대해 no-op. 현재 secrets 7 + PII 5 패턴 조합은 10KB payload 에서 < 5ms 예산 내 (테스트: `backend/tests/test_pii_perf.py`)
- `provider.call_stream` 소비 경로에 **stream tee 패턴** 필수 — forward Queue + collect Queue 분리. 누락 시 tool_use 블록 empty 버그

**1 Endpoint 책임 분리:**

| 파일 | 책임 |
|------|------|
| `backend/engine/stream.py` | 이벤트 타입 enum, serialize_sse, scrub_secrets, _scrub_dict |
| `backend/routes/run.py` | FastAPI route, EventSourceResponse, 헤더 주입, _stream_agent (policy.sse=true 인 run 대상), `_to_sent_events` (id 주입 + replay push), `resume_run_stream` (resume endpoint) |
| `backend/services/sse_replay/registry.py` | `RunReplayRegistry` — replay 버퍼 + pub/sub (single-process). `app.state.run_replay_registry` 단일 인스턴스 (lifespan 관리) |

- 순환 import 금지. routes → stream 단방향. routes → services/sse_replay 단방향

**Reconnect / Resume (Phase 1, single-worker):**

```
GET /run/<name>/resume/<run_id>
  Headers:  Last-Event-ID: <int>  (priority over query)
  Query:    ?last_event_id=<int>  (fallback)
  Returns:  EventSourceResponse (replay buffered → live-tail)
```

- **목적**: 모바일/네트워크 불안정 환경에서 SSE drop 후 재연결. `Last-Event-ID` 이후 event 만 replay → live-tail 로 자연 합류
- **Run 식별**: `dispatch_run` 가 `policy.sse=True` 일 때 `new_hex_id()` 로 발급 + `X-App-Run-Id` 응답 헤더 (CORS expose 됨). 클라이언트가 reconnect 시 동일 `<run_id>` 로 GET
- **In-process replay registry**: `RunReplayRegistry` (`backend/services/sse_replay/registry.py`) 가 run 별 ring buffer + asyncio pub/sub 보관. **Phase 1 invariant: single-worker only** — multi-worker 면 reconnect 다른 worker 로 라우팅될 때 registry miss → 404. Phase 2 에서 Redis Streams 로 교체 예정
- **Leak-safe 2-pass gate**:
  1. ContextVar bind **이전** 1st-pass: `metadata(run_id)` lookup → unknown / cross-user (without `*` scope) / path `<name>` ≠ `metadata.run_name` → 404 (`stream_not_found`). 로그에 다른 사용자 session_id/run_name 노출 방지
  2. `replay_and_subscribe` 안에서 registry lock 하에 race-safe re-check (defense in depth)
- **Tombstone gate**: `assert_user_active` 호출 — 7-day grace 사용자는 410 Gone. 4번째 call site (data-governance-patterns.md §Centralized assert_user_active gate)
- **Last-Event-ID 우선순위**: HTTP header > query param. Header parse 실패 → 422 (`ValidationError`). Query 는 `Query(ge=0)` 로 음수 거부
- **응답 헤더 (resume 응답)**: `X-App-Run-Id`, `X-App-Session-Id`, `X-App-Agent`, `X-App-Model` (4종) + `X-Accel-Buffering: no`. **`X-App-Moderation-Status` / `X-App-Jailbreak-Status` 는 resume 응답에서 set 안 됨** — 두 게이트는 dispatch 시점에 1회만 실행되므로 reconnect 응답에서는 추가 정보가 없다 (원래 dispatch 의 헤더를 클라이언트가 이미 보관하고 있다고 가정). CORS `expose_headers` 는 dispatch + resume 합쳐 총 6종 (Moderation + Jailbreak 헤더 포함) 으로 유지 — `X-Request-Id` 포함 시 7종 (`api-routing-patterns.md` §CORS 표 참조)
- **종료 시그널**: 원래 stream 의 `done`/`error` 가 replay 에 포함되며, 그 이후 push 불가 (registry 가 `mark_terminal` 후 거부)
- 상세: `docs/completed/superpowers/specs/2026-04-25-sse-resilience-design.md`

## 새 SSE 이벤트 타입 추가하기

`core-infrastructure.md` 의 "SSE 이벤트 타입 추가하기" 체크리스트를 먼저 따른 뒤, 본 rule 의 추가 요구사항:

1. lifecycle 내 위치 결정 — **`done`/`error` 이전** 배치 (종료 보장 깨지 않음)
2. 새 이벤트 payload 에 session-wide 불변 메타 금지 (HTTP 헤더로 분리)
3. payload 에 string 필드 있으면 secret scanner 경유 필요 여부 판단
4. serialize 로직은 `serialize_sse()` 가 자동 처리 — 별도 함수 작성 금지
5. 클라이언트 파서가 unknown event 무시하는지 확인 (하위 호환)
6. evals.json assertion + SSEEventType Literal + 문서 표 3곳 동시 업데이트

## 새 Secret Pattern 추가하기

1. **파일 위치**: `backend/observability/secrets.py` (canonical). `backend/engine/stream.py` 는 re-export only — 편집 불필요
2. `_SECRET_PATTERNS` 튜플에 `(re.compile(...), "[REDACTED-<KIND>]")` 추가
3. `_FAST_CHECK_ANCHORS` 에 **반드시 대응 prefix anchor 추가** — 두 튜플 길이가 같아야 함. 불일치 시 import-time `ImportError` 로 프로세스 부팅 실패 (드리프트 가드)
4. 정규식은 **정확히 매칭되는 형태** — 너무 넓으면 false positive (정상 payload 차단). anchor 는 prefix 부분만 (e.g. `"ghp_"` 가 전체 패턴 `ghp_[A-Za-z0-9]{20,}` 의 prefix)
5. replacement 는 `[REDACTED-<KIND>]` 컨벤션 준수
6. 성능 테스트: 10KB text_chunk 에 대해 추가 패턴 포함 전체 스캔 < 1ms (anchor 미포함 payload 는 no-op 이어야)
7. entropy 기반 일반 검사 원하면 별도 background task — 스트림 경로 금지
8. 테스트: pass (일반 텍스트 identity-same), block (패턴 일치 시 `[REDACTED-*]`), 페이로드 구조 보존. 로그 파이프라인 (`scrub_log_values`) 도 함께 영향 — dual test

## `EventSourceResponse` 파라미터 조정하기

- `ping` 간격 변경 시: load balancer 타임아웃 값과 정합. 15초 미만은 오버헤드, 60초 이상은 drop 위험
- `headers` 추가 시: `X-App-` prefix 유지 — 벤더 헤더 네임스페이스
- media_type 변경 금지 (`text/event-stream` 고정)

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 12 이벤트 집합 변경 | 클라이언트 파서 상태 머신, core-infrastructure.md §SSE Lifecycle, 디자인 §4.7 |
| Wire format 변경 (event:/data:) | 모든 기존 클라이언트와 호환 중단 |
| HTTP 헤더 prefix 변경 | 프록시 설정, 클라이언트 fetch 코드, 모니터링 대시보드 |
| `ping` 간격 변경 | keepalive 트래픽량, LB 타임아웃 상호작용 |
| `_SECRET_PATTERNS` 추가 | 스트림 + 로그 양쪽 CPU 부하 (anchor fast-path 덕에 일반 payload 영향 미미), false positive 위험, `_FAST_CHECK_ANCHORS` 동시 업데이트 필수 |
| `_SECRET_PATTERNS` 제거 | 시크릿 유출 위험 — 보안 리뷰 필수. 로그 파이프라인도 동시 영향 |
| `_FAST_CHECK_ANCHORS` 와 `_SECRET_PATTERNS` 길이 불일치 | import-time `ImportError` — 프로세스 부팅 실패 |
| Scanner injection point 추가/제거 | 시크릿이 스캔 안 된 이벤트로 유출 가능 |
| `run_loop_stream` 의 `done_seen` 플래그 제거 | finally 안전망 무력화 → 비정상 종료 시 클라이언트 무한 대기 |
| 종료 보장 로직 변경 | 클라이언트 hang (무한 대기) 또는 이중 종료 |
| Stream tee 적용 범위 변경 | tool_use empty 버그 재발 위험 |
| `X-Accel-Buffering` 헤더 제거 | nginx 앞단에서 청킹 → TTFB 악화 |
| `_to_sent_events` 의 monotonic `id` counter 변경 | 클라이언트 `Last-Event-ID` 매칭 깨짐 — replay 정확도 손상 |
| `RunReplayRegistry` 인스턴스 lifespan 누락 | resume 요청 전부 404 (registry miss) |
| Phase 1 single-worker invariant 깨고 multi-worker 배포 | resume 요청이 다른 worker 로 라우팅되면 registry miss — Phase 2 (Redis Streams) 까지 워커 1대 강제 |
| `X-App-Run-Id` CORS expose 누락 | 브라우저 JS 가 run_id 못 읽음 → reconnect 불가 |
| `X-App-Moderation-Status` CORS expose 누락 | 브라우저 JS 가 moderation 결과 못 읽음 → UI 가 `failed_open` / `skipped_short` 상태 분간 불가 |
| `MODERATION_STATUS_HEADER` 상수 직접 인라인 (`"X-App-Moderation-Status"`) | drift 위험 — 반드시 `backend/engine/stream.py::MODERATION_STATUS_HEADER` re-export 사용 |
| `X-App-Jailbreak-Status` CORS expose 누락 | 브라우저 JS 가 jailbreak 결과 못 읽음 → UI 가 `flagged` (매치 + log_only) 와 `ok` 상태 분간 불가, 또한 `failed_open` 상태 noticing 불가 |
| `JAILBREAK_STATUS_HEADER` 상수 직접 인라인 (`"X-App-Jailbreak-Status"`) | drift 위험 — 반드시 `backend/engine/stream.py::JAILBREAK_STATUS_HEADER` re-export 사용 |

## 금지 사항

- SSE payload 에 session-wide 불변 메타 (session_id, model, agent) 중복 삽입 — 헤더 전용
- `done` 과 `error` 동시 발송 (배타 위반)
- ClientDisconnect 후 error 이벤트 발송 (받을 대상 없음)
- Scanner 없이 `_SCAN_EVENTS` (7 이벤트) 발송
- `_scrub_dict` 없이 dict payload 직접 yield (재귀 누락)
- `run_loop_stream` finally 안전망 외부에서 terminal 이벤트 합성 (종료 보장 경로 중복)
- finally 안전망을 `done` 합성으로 바꾸기 (비정상 종료를 성공으로 포장 — 현재는 `error("InternalError")` 합성)
- `StreamingResponse` 직접 쓰면서 keepalive / X-Accel / disconnect 감지 누락
- entropy 검사 / heavy regex 를 스트림 경로에 삽입 (backpressure)
- wire format 에 trailing `\n\n` 누락 (SSE spec 위반)
- `serialize_sse()` (engine) 에서 `id:` 필드 emit — id 주입은 routes layer (`_to_sent_events`) 책임
- resume endpoint 에서 1st-pass leak-safe gate 누락 — ContextVar bind 후 404 가 다른 사용자 session_id 를 로그에 노출
- multi-worker 배포 (Phase 1 invariant 위반)
