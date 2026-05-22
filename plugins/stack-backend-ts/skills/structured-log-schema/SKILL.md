---
name: structured-log-schema
description: 구조화 로그 invariant — 10 trace 필드 (request_id / trace_id / span_id / session_id / user_id / run_name / agent / model / turn_count / spawn_depth), log level 매트릭스, 메시지 명명 규약, scrub 의무, log injection 방어.
metadata:
  role: invariant
  scope: project
  source: stack-backend-ts/skills/structured-log-schema
---

# Structured Log Schema — 언어 무관 불변식

## 10 trace 필드 (SoT)

[[agent-loop-invariants]] 의 trace 필드와 일관:

| 필드 | 타입 | 의미 |
|------|------|------|
| request_id | uuid | HTTP 요청 단위 |
| trace_id | uuid | distributed trace |
| span_id | uuid | trace 안 sub-operation |
| session_id | uuid \| null | 사용자 세션 (해당 시) |
| user_id | string \| null | 인증된 사용자 |
| run_name | string \| null | run policy name |
| agent | string \| null | 현재 active agent |
| model | string \| null | 해석된 모델 ID |
| turn_count | number \| null | loop turn 카운트 |
| spawn_depth | number | sub-agent 깊이 (0 = root) |

10 필드 모두 옵션 (null 허용) — 컨텍스트에 따라 채움.

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
