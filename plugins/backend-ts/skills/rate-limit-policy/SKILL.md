---
name: rate-limit-policy
description: TS 백엔드 rate limit invariant — per-user / per-IP / per-endpoint 3-axis 기본, 429 응답 envelope, Retry-After 헤더 필수, rate limit 키 충돌 / bypass 방지. 알고리즘 선택 (token bucket / sliding window 등) 은 운영 결정.
metadata:
  role: invariant
  scope: project
---

# Rate Limit Policy — 언어 무관 불변식

## 3-axis 기본

| Axis | 키 | 한계 예시 | 용도 |
|------|----|---------|------|
| per-user | userId | 60 req/min | 사용자 abuse 방지 |
| per-IP | client ip | 30 req/min | 비인증 endpoint 보호 |
| per-endpoint | path | 1000 req/min | 비싼 endpoint 보호 |

세 axis 모두 OR 결합 — 하나라도 초과 시 reject.

## 429 응답 envelope ([[http-error-sentinels]] 일관)

- HTTP `429 Too Many Requests`
- 헤더 `Retry-After: <seconds>` **필수** + `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` (선택)
- body `{ "error": { "code": "rate_limited", "retry_after_ms": <ms> } }`

## 알고리즘 / storage — 운영 결정

알고리즘 (token bucket / fixed window / sliding log / sliding window counter) 은 native 지식. storage backend (메모리 / Redis / KV / DB) 도 운영 결정. 본 invariant 는 *선택 결과의 일관성* 만 요구:

- 멀티 인스턴스 환경에서 in-memory backend ✕ (인스턴스 별 카운터 분리 → 실효 제한 N배)
- backend 선택은 deployment 단위로 통일

## 공통 금지

- rate limit 키에 raw secret 포함 (해시 또는 user id 만)
- 429 응답에 `Retry-After` 누락 (클라이언트 backoff 불가)
- bypass 로직을 user-controllable header 로 (예: `X-Skip-Ratelimit`)
- rate limit 카운터를 응답 body 에 상세 노출 (enumeration 위험)
- 인증 전 라우트 (login / register / password reset) 에 IP 축 누락 (무인증 DDoS)

## audit / 검증

grep 패턴 + 3-axis 적용 검증은 [[rate-limit-policy-audit]] 정본.
