---
name: sse-streaming
description: TS 백엔드 SSE 응답 핸들러 추가 / 기존 SSE 핸들러 수정 시 invoke. 12 이벤트 직렬화 + heartbeat + secret scrub + done/error 종료 보장 가이드. SSE stream 끊김, done 이벤트 누락, 시크릿 노출 증상 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/sse-streaming + rules/sse-streaming-patterns.md
---

# sse-streaming — SSE 응답 청사진

## 이 skill은 언제 invoke 되는가

- TS 백엔드 SSE 핸들러 최초 작성 / 이벤트 타입 추가 / scrub 패턴 튜닝
- "SSE stream 이 중간에 끊어진다" 증상
- "클라이언트가 `done` 이벤트를 못 받는다" 증상
- "text 이벤트에 시크릿이 노출됐다" 사고
- "tool_use 가 SSE forward 는 되는데 tool executor 에서 empty"

## SSE Streaming 의 정체성

`/run/:name` 엔드포인트 중 `policy.sse=true` 인 run 은 Agent Loop 의 진행 상황을 SSE 로 전송한다. 이 계층의 4가지 책임:

1. **이벤트 변환** — Agent Loop 가 yield 하는 내부 Event 를 SSE wire format (`event: <name>\ndata: <json>\n\n`) 으로 직렬화
2. **flush 타이밍** — 이벤트 write 는 즉시 flush. 느린 클라이언트는 disconnect 시그널 (abort) 로 감지
3. **secret scanning** — `SCAN_EVENTS` (7 이벤트) 발신 전 `scrubDict()` 통과 의무
4. **종료 보장** — `done` 또는 `error` 이벤트가 반드시 마지막에 단 한 번 전송

## 12 SSE 이벤트 집합

`sse-lifecycle` skill 의 정본 12 이벤트 집합을 참조한다. 본 skill 은 SCAN 대상 분류만 정의한다.

| event | 시점 | 주요 payload 필드 | scrub 대상? |
|---|---|---|---|
| `session` | 스트림 시작 첫 이벤트 | `session_id: string` | ✗ |
| `agent` | resolved agent/model 메타 | `agent: string, model: string` | ✗ |
| `text` | LLM text delta | `text: string` | ✅ |
| `thinking` | extended-thinking block | `text: string` | ✅ |
| `tool_call` | tool_use block (이름 + 최종 input) | `name: string, final_input: object` | ✅ (dict 재귀) |
| `tool_result` | 도구 실행 완료 | `tool_name, result, is_error` | ✅ (dict 재귀) |
| `action` | 구조화된 action 요약 | `result_summary: string` | ✅ |
| `notification` | background spawn 완료 등 | free-form object | ✅ (dict 재귀) |
| `suggestions` | 후속 제안 | `prompts: string[]` | ✗ |
| `usage` | 토큰 / 비용 — `done` 직전 | `input_tokens, output_tokens, cost_usd` | ✗ |
| `done` | 정상 종료 (error 와 배타) | `turn_count` 등 | ✗ |
| `error` | 비정상 종료 (done 과 배타) | `code: string, message: string` | ✅ (message only) |

`SSEEventType` union 과 `SCAN_EVENTS` 집합 (정확히 7개: `text`, `thinking`, `tool_call`, `tool_result`, `action`, `error`, `notification`) 은 SSE 직렬화 모듈에서 단일 source 로 export 한다.

## SSE 응답 구현 원칙

프레임워크/런타임 독립적인 SSE 핸들러는 다음 4 단계를 따른다:

1. **헤더 분리** — `session_id`, `model`, `agent` 등 session-wide 메타는 HTTP response 헤더 (`X-App-*`) 로 emit. SSE payload 와 혼합 금지.
2. **abort 감지** — 클라이언트 disconnect 시그널을 구독하여 종료 플래그를 세팅. 이후 write 시도는 silent swallow.
3. **이벤트 루프** — Agent Loop generator 를 순회하며 각 이벤트마다 `SCAN_EVENTS` 멤버이면 `scrubEventPayload` 통과 후 wire format 으로 write.
4. **종료 안전망** — `try / catch / finally` 로 감싸고, `doneSeen` 플래그가 false 인 채 빠져나오면 `error` 이벤트를 합성한다 (`done` 합성 금지).

## Heartbeat 원칙

장기 streaming 에서 producer 가 일시 정지하면 중간 프록시가 idle timeout 으로 연결을 끊을 수 있다. 이를 방지하는 heartbeat 원칙:

- **간격**: 15s (일반값). 환경 별 프록시 timeout 보다 짧게 설정.
- **payload**: 비어 있어도 무방 (`event: heartbeat` 이름만 emit). 클라이언트 상태머신은 본 12 이벤트 외 모두 무시.
- **타이밍**: 이벤트 흐름이 heartbeat 간격보다 빠르면 생략 가능. producer 중단 가능성이 있을 때만 race 패턴으로 삽입.
- **구현 위치**: SSE 핸들러 내부 inline (별도 generator wrapper 없이). passthrough 만 하는 stub 은 동작 보장 ✕.

> 백그라운드 태스크 스케줄링은 런타임 특화 (runtime-specific background task helper — instance 측에서 정의)

## Secret Scanner

`SCAN_EVENTS` 멤버 이벤트는 발신 전 모든 string payload 를 패턴 매칭으로 redact 한다. 필수 패턴 집합:

| 패턴 | 대체 토큰 |
|---|---|
| `sk-[A-Za-z0-9]{20,}` | `[REDACTED-SK]` |
| `AKIA[0-9A-Z]{16}` | `[REDACTED-AKIA]` |
| `ghp_[A-Za-z0-9]{36,}` | `[REDACTED-GHP]` |
| `-----BEGIN ... PRIVATE KEY-----...END...` | `[REDACTED-PEM]` |
| `AIza[0-9A-Za-z\-_]{35}` | `[REDACTED-AIKEY]` |
| `xox[baprs]-[0-9A-Za-z\-]{10,}` | `[REDACTED-SLACK]` |
| `eyJ...\.eyJ...\....` (JWT) | `[REDACTED-JWT]` |

scrub 함수는 3 단계로 구성:

1. **`scrubSecrets(text)`** — 단일 문자열에 모든 패턴 순차 적용
2. **`scrubDict(obj)`** — 객체/배열을 재귀 순회하며 모든 string leaf 에 `scrubSecrets` 적용
3. **`scrubEventPayload(eventType, payload)`** — `error` 이벤트는 `message` 필드만, 나머지 SCAN 이벤트는 `scrubDict` 전체 적용

## HTTP 헤더 분리 원칙

세션 수명 동안 불변인 메타 정보는 HTTP response 헤더로 전달. SSE payload 혼합 금지.

| 헤더 | 값 | 시점 |
|---|---|---|
| `X-App-Session-Id` | session_id | 스트림 시작 |
| `X-App-Model` | resolved model id | 스트림 시작 |
| `X-App-Agent` | agent_spec.name | 스트림 시작 |

CORS `expose_headers` 에 위 헤더 + `X-Request-Id` 포함 필수 (프론트엔드 JS 에서 읽기 위해).

## 동시성 함정

1. **stream tee 누락** → tool_use 가 SSE 에는 흐르지만 tool executor 는 empty. `provider-layer` skill §tee 참조.
2. **`scrubDict` 없이 tool_call/tool_result payload 직접 write** → dict 안쪽 시크릿 통과.
3. **런타임 미지원 timer API 사용** → heartbeat 가 일부 런타임에서 동작 안 함. 런타임-safe sleep 패턴으로 구현 (instance 측 책임).
4. **abort 후 write** → abort 된 stream 에 쓰기 → error throw. abort 콜백에서 상태 플래그 세팅 후 guard.
5. **종료 경로 중복 합성** → engine 와 route 양쪽에서 `done`/`error` 합성 → 이중 종료.

## 검증 체크리스트

- [ ] 12 이벤트 타입 모두 `SSEEventType` union 에 명시
- [ ] `SCAN_EVENTS` 가 정확히 7개
- [ ] SSE wire format (`event: <name>\ndata: <json>\n\n`) 생성기 단일 진입점 사용
- [ ] 클라이언트 abort 시그널 구독으로 disconnect 처리 (런타임 미지원 timer 사용 안 함)
- [ ] `scrubSecrets` 가 7 패턴 커버
- [ ] `scrubDict` 로 `tool_call.final_input` + `tool_result` + `notification` 재귀 스캔
- [ ] HTTP 헤더로 session_id / model / agent 분리
- [ ] CORS `expose_headers` 에 X-App-* 헤더 포함
- [ ] `doneSeen` 플래그 + finally 안전망으로 **error 합성** (done 합성 금지)
- [ ] `sse-lifecycle` invariant 의 12 이벤트 순서 준수

## 구현 중 막히면

- "stream 이 중간에 끊긴다" → 런타임 별 CPU/wallclock 제한 확인. 백그라운드 태스크 스케줄링은 런타임 특화 (runtime-specific background task helper — instance 측에서 정의)
- "tool_use 가 SSE 에는 흐르는데 executor empty" → stream tee 패턴 누락. `provider-layer` skill §tee 참조
- "client 가 done 못 받음" → finally 안전망 확인. engine 밖에서 terminal 이벤트 합성 중인지 확인
- "시크릿이 payload 에 노출됨" → `SCAN_EVENTS` 중 하나에 누락. `scrubDict` 재귀 경로 확인
- "session_id / model 을 payload 에 넣고 싶다" → HTTP 헤더 분리 원칙 위반
