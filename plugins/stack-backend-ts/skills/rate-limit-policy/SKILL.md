---
name: rate-limit-policy
description: TS 백엔드 rate limit invariant — per-user / per-IP / per-endpoint 3-axis 기본, 429 응답 envelope, Retry-After 헤더 필수, token bucket / sliding window 알고리즘 선택, rate limit 키 충돌 / bypass 방지.
metadata:
  role: invariant
  scope: project
  source: stack-backend-ts/skills/rate-limit-policy
---

# Rate Limit Policy — 언어 무관 불변식

## 3-axis 기본

| Axis | 키 | 한계 예시 | 용도 |
|------|----|---------|------|
| per-user | userId | 60 req/min | 사용자 abuse 방지 |
| per-IP | client ip | 30 req/min | 비인증 endpoint 보호 |
| per-endpoint | path | 1000 req/min | 비싼 endpoint 보호 |

세 axis 모두 OR 결합 — 하나라도 초과 시 reject.

## 429 응답 envelope (HTTP 표준)

- HTTP `429 Too Many Requests`
- 헤더: `Retry-After: <seconds>` (필수), `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (선택)
- body: `{ "error": { "code": "rate_limited", "retry_after_ms": <ms> } }` ([[http-error-sentinels]] envelope 와 일관)

## 알고리즘 선택

| 알고리즘 | 장점 | 단점 |
|---|---|---|
| token bucket | burst 허용, refill rate 일정 | 메모리 per-key |
| fixed window | 단순 | 윈도우 경계에서 spike |
| sliding log | 가장 정확 | 메모리 비용 ↑ |
| sliding window counter | 절충 | 약간 부정확 |

storage 선택: 메모리 (단일 인스턴스) / Redis / KV / DB row (멀티 인스턴스 공유)

## 공통 금지

- rate limit 키에 raw secret 포함 (해시 또는 user id 만)
- 429 응답에 `Retry-After` 누락 (클라이언트 backoff 불가)
- bypass 로직을 user-controllable header 로 (예: `X-Skip-Ratelimit`)
- rate limit 카운터를 응답 body 에 상세 노출 (enumeration 위험)
- 멀티 인스턴스 환경에서 in-memory rate limit (인스턴스 별 카운터 분리 — 우회 가능)
