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

## 차단 가능 audit 체크리스트

- [ ] **3-axis 적용 검증**: route group 별 `(window, max, key)` 튜플 정의 — IP / API key / user 3 축 중 ≥ 1 축 활성
- [ ] **anonymous DDoS 가드**: 인증 전 라우트 (login, register, password reset) 에 IP 축 rate limit 필수 — middleware 등록 순서에서 auth 앞 위치
- [ ] **bypass 시그널 부재**: env / config 에 "rate limit 전체 비활성" flag 없음 (development env 한정 허용 시 명시적 warning log)
- [ ] **storage backend 일관성**: Redis / in-memory / DB 선택이 deployment 단위로 통일 — 멀티 인스턴스에서 in-memory 사용 금지
- [ ] **429 envelope 일관성**: 모든 위반 응답이 `{ error: { code: "rate_limited", retry_after_ms } }` + `Retry-After` 헤더

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| anonymous endpoint 에 user 축만 적용 | 무인증 DDoS 가능 | IP 축 추가 검증 |
| `retry_after_ms` 누락 | client backoff 불가 → spam retry | envelope schema 검증 |
| 멀티 인스턴스 in-memory backend | 인스턴스 별 카운트 분리 → 실효 제한 N배 | Redis 등 외부 backend 강제 |
| 라우트 그룹 별이 아닌 글로벌 quota | endpoint 별 차등 불가 → 비싼 endpoint 보호 실패 | 라우트 그룹 단위 정의 강제 |
