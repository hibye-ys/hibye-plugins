---
name: idempotency-key
description: 클라이언트 재시도 안전성 workflow. 본 plugin 의 *프로젝트 결정* — 6 요소 key 결합 (user_id / tenant_id / method / path / body_hash / client_key) 으로 멀티테넌트 격리, TTL 24h default, In-flight lock 필수, key 중복 + 같은 body → replay (`Idempotency-Replayed: true`), 다른 body → 409 conflict ([[http-error-sentinels]] envelope). RFC 7231 / Stripe Idempotency-Keys 표준 패턴은 native.
metadata:
  role: workflow
  scope: project
---

# Idempotency Key — Workflow

> 표준 패턴 (`Idempotency-Key` 헤더 / POST·PATCH·DELETE 적용 / safe method 면제) 은 RFC 7231 / Stripe API 기준 모델 native. 본 skill 은 *프로젝트 결정 5종* 만 강제.

## 1. 6 요소 key 결합 — 멀티테넌트 격리

Idempotency key 의 고유 scope:

```
key_scope = sha256(
  user_id || tenant_id || method || path || body_hash || client_provided_key
)
```

- `user_id` / `tenant_id`: 멀티테넌트 격리 — 다른 user 가 같은 client key 보내도 충돌 ✕
- `method` + `path`: 같은 client key 라도 endpoint 다르면 별도 처리
- `body_hash`: 같은 client key + 다른 body → 409 Conflict (재시도 일관성)
- `client_provided_key`: header `Idempotency-Key` 값

## 2. 저장 schema + TTL 24h

```
key: idem:<route>:<idempotency-key>
value: { status: number, body_hash: string, response_body: string, expires_at: ISO }
```

- **TTL = 24h** default (스토리지 비용 vs 재시도 윈도우)
- 멀티 인스턴스 환경 → Redis / KV / DB 강제 (in-memory ✕ — race condition)

## 3. 409 envelope — [[http-error-sentinels]] 일관

같은 key + 다른 body:
```json
{ "error": { "code": "idempotency_conflict", "message": "..." } }
```
응답 헤더 `X-App-*` sentinel + scrubText 정책은 [[http-error-sentinels]] 정본.

## 4. replay 시 `Idempotency-Replayed: true` 헤더

같은 key + 같은 body_hash → 저장된 응답 그대로 replay + 헤더 set (관측성 / debugging).

## 5. In-flight lock 필수

동일 key 동시 요청 시 distributed lock (Redis SETNX / DB advisory) 으로 직렬화 — 두 번째 요청은 첫 결과 대기. lock 없으면 동시 retry 가 두 번 처리 (예: 결제 두 번).

## 공통 금지

- key 충돌 (다른 body) 시 silent 새 호출 — 반드시 409
- 6 요소 결합 중 `user_id` / `tenant_id` 생략 → 다른 user 결과 leak
- replay body 가 stale (TTL 만료 후 같은 key 재호출 → reject)
- key 를 user-controllable 짧은 길이 허용 (충돌 / brute force)
- 단일 인스턴스 in-memory storage (race condition)
- safe method (GET / HEAD) 에 idempotency-key 처리 (이미 idempotent — overhead)

## audit 체크리스트 (본 workflow 본문 유지)

> 별도 `idempotency-key-audit` skill 부재 — audit grep 패턴은 본 workflow 안에 유지.

- [ ] Key TTL 정책 명시 (24h default) — 무한 보관 ✕
- [ ] In-flight lock 적용 — 동일 key 동시 요청 직렬화
- [ ] body_hash 일치 검증 — 다른 body → 409
- [ ] 응답 본문 + status 저장 — replay 시 동일 응답 반환 가능
- [ ] safe method (GET / HEAD) 면제 처리

## failure mode 차단

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| user_id 없이 key 만으로 lookup | 다른 user 결과 leak | 6 요소 결합 강제 |
| body hash 검증 없음 | retry 시 다른 body 가 같은 응답 받음 → silent 데이터 손실 | 409 Conflict 분기 |
| In-flight lock 없음 | 동시 retry 가 두 번 처리 (예: 결제 두 번) | distributed lock (Redis SETNX / DB advisory) |
| TTL 무한 | 저장소 무한 증가 | 명시적 TTL + 만료 후 재처리 허용 정책 |
