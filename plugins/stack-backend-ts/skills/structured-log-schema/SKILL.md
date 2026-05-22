---
name: structured-log-schema
description: 구조화 로그 invariant — 10 trace 필드 (request_id / trace_id / span_id / session_id / user_id / run_name / agent / model / turn_count / spawn_depth), log level 매트릭스, 메시지 명명 규약, scrub 의무, log injection 방어.
metadata:
  role: invariant
  scope: project
  source: stack-backend-ts/skills/structured-log-schema
---

# Structured Log Schema — 언어 무관 불변식

## 필드 분류

**필수 (3개)** — 누락 시 로그 reject:

| 필드 | 타입 | 의미 |
|------|------|------|
| `timestamp` | ISO 8601 string | 이벤트 발생 시각 (UTC) |
| `level` | enum: debug \| info \| warn \| error \| fatal | 로그 레벨 |
| `event` | string (snake_case) | 이벤트 명 (예: `request_started`, `provider_call_failed`) |

**Trace correlation (필수 분기)** — 요청 컨텍스트 내에서는 모두 채움:

| 필드 | 타입 | 의미 |
|------|------|------|
| `request_id` | string (UUID v4 또는 ULID) | 요청 단위 ID |
| `trace_id` | string | distributed tracing root ID |
| `span_id` | string | 현재 span ID |
| `parent_span_id` | string | 부모 span ID (root 면 null 허용) |

**Optional context** — 해당 시에만:

| 필드 | 타입 | 의미 |
|------|------|------|
| `user_id` | string | 인증된 사용자 ID |
| `tenant_id` | string | 멀티테넌트 식별 |
| `service` | string | 서비스 명 (멀티서비스 환경) |
| `error.type` / `error.message` / `error.stack` | string | error 시 |

> [[agent-loop-invariants]] 의 trace 필드 (`session_id` / `run_name` / `agent` / `model` / `turn_count` / `spawn_depth`) 는 agent loop 컨텍스트에 한해 optional context 로 추가 채움.

## Log level 매트릭스

| level | 사용처 |
|-------|--------|
| debug | 개발용 trace |
| info | 정상 lifecycle 이벤트 (request start/end, agent dispatch) |
| warn | 복구 가능 이상 (provider fallback, compaction failure 1회) |
| error | 사용자 영향 + 복구 실패 (provider chain 소진, DB 타임아웃) |
| critical | 시스템 영향 (startup fail, secret 누설 시도) |

## 메시지 명명 — `<subsystem>.<event>` snake_case

예: `provider.request_start`, `compaction.triggered`, `tool.call_succeeded`, `agent.spawn`, `rate_limit.exceeded`

## scrub 적용 의무

모든 log payload 는 scrub 통과 후 emit. 스택 트레이스도 동일. (scrubText 정본 = [[http-error-sentinels]])

## 공통 금지

- raw secret / API key / PII 를 log 에 그대로 (반드시 scrub)
- log 메시지에 사용자 입력 newline 없이 그대로 inject (log injection — `\r\n` 으로 fake log entry 주입 가능)
- 10 trace 필드 외 ad-hoc context 키 (확장 시 본 invariant 갱신)
- log level 을 error 이상에 throttle 없이 emit (alerting 노이즈)
- 동일 event 의 로그를 여러 level 로 중복 emit (관측성 혼란)

## 차단 가능 audit 체크리스트

- [ ] **필수 3 필드 누락 차단**: logger wrapper 가 `timestamp/level/event` 미공급 시 throw
- [ ] **request_id 자동 주입**: HTTP middleware 가 incoming request 마다 `request_id` 를 ContextVar / AsyncLocalStorage 에 set
- [ ] **PII 필터링**: `email`, `password`, `token`, `secret`, `key` 패턴이 message / context 에 plain 으로 등장 시 redaction
- [ ] **JSON 단일 라인**: 모든 로그 출력은 line-delimited JSON (newline 포함 금지) — log collector parser 호환
- [ ] **level 이 enum 일치**: 자유 문자열 금지 (`"INFO"` 와 `"info"` 혼재 차단)

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| `request_id` 없는 로그 | 요청 단위 grep 불가 → 디버깅 시간 폭증 | ContextVar 자동 주입 + middleware 등록 강제 |
| timestamp 가 시스템 local TZ | 멀티 리전 로그 비교 시 시간 mismatch | UTC + ISO 8601 강제 |
| 자유 형식 message 안에 user_id 포함 | grep 으로 user 별 로그 추출 불가 | 구조화 context 필드 강제, message 는 사람 가독용만 |
| 에러 stack trace 가 message 에 squeeze | parser 가 multi-line JSON 처리 불가 | `error.stack` 필드 분리 |
