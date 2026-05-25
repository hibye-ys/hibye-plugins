---
name: structured-log-schema
description: 구조화 로그 invariant — 10 trace 필드 (request_id / trace_id / span_id / parent_span_id / session_id / user_id / run_name / agent / model / turn_count / spawn_depth), scrub 의무, log injection 방어. log level matrix / 메시지 명명 규약 / JSON line-delimited 형식은 native 지식 — 본 invariant 는 *프로젝트 고유 필드 + scrub* 만 강제.
metadata:
  role: invariant
  scope: project
---

# Structured Log Schema — 언어 무관 불변식

## 필드 분류

**필수 (3개)** — 누락 시 로그 reject:

| 필드 | 타입 | 의미 |
|------|------|------|
| `timestamp` | ISO 8601 string (UTC) | 이벤트 발생 시각 |
| `level` | `z.enum(['debug','info','warn','error','fatal'])` | 5-level — [[coding-standards]] 와 정본 일치 |
| `event` | string (snake_case) | 이벤트 명 (`<subsystem>.<event>` 권장) |

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

## scrub 적용 의무

모든 log payload 는 scrub 통과 후 emit. 스택 트레이스도 동일. `scrubText` 정본은 [[http-error-sentinels]] (알려진 secret / API key / PII 패턴 fail-safe).

## 공통 금지

- raw secret / API key / PII 를 log 에 그대로 (반드시 scrub)
- log 메시지에 사용자 입력 newline 없이 그대로 inject (log injection — `\r\n` 으로 fake log entry 주입 가능)
- 10 trace 필드 외 ad-hoc context 키 (확장 시 본 invariant 갱신 — 정본 sync 의무)
- log level 을 error 이상에 throttle 없이 emit (alerting 노이즈)
- 동일 event 의 로그를 여러 level 로 중복 emit (관측성 혼란)
- 자유 형식 message 안에 user_id 포함 (구조화 context 필드 사용 — message 는 사람 가독용)

## audit / 검증

grep 패턴 + 필수 필드 차단 + JSON line-delimited 검증 + level enum 일치 검증은 [[structured-log-schema-audit]] 정본.
