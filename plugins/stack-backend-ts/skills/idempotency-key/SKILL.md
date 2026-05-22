---
name: idempotency-key
description: 클라이언트 재시도 안전성 workflow — POST/PATCH/DELETE 의 Idempotency-Key 헤더 처리, 응답 캐싱 TTL 24h, key 중복 + 같은 body → replay, 다른 body → 422 conflict.
metadata:
  role: workflow
  scope: project
  source: stack-backend-ts/skills/idempotency-key
---

# Idempotency Key — Workflow

## 헤더 contract

- 요청: `Idempotency-Key: <uuid>` (클라이언트가 발급, 권장 UUID v4)
- 적용 endpoint: 부수효과 있는 POST / PATCH / DELETE
- TTL: 24h 권장 (스토리지 비용 vs 재시도 윈도우)

## 처리 절차

1. key 수신 → storage lookup (Redis / KV / DB)
2. 없으면: handler 실행 → 응답 + body 해시 + 응답 전체 저장 (key → {status, body_hash, response_body, expires_at})
3. 있으면 (같은 body 해시): 저장된 응답 그대로 replay, `Idempotency-Replayed: true` 헤더 set
4. 있으면 (다른 body 해시): `422 idempotency_conflict` ([[http-error-sentinels]] envelope) — same key, different payload

## 응답 헤더

- `Idempotency-Replayed: true` — replay 인지 알림 (관측성)

## 저장 schema

```
key: idem:<route>:<idempotency-key>
value: { status: number, body_hash: string, response_body: string, expires_at: ISO }
```

## 공통 금지

- key 없는 POST 도 무조건 처리 (legacy 호환 외 — 권장 endpoint 는 강제)
- key 충돌 (다른 body) 시 silent 새 호출 (반드시 422)
- replay body 가 stale (TTL 만료 후 같은 key 재호출 시 reject)
- key 를 user-controllable + 짧은 길이 허용 (충돌 / brute force 위험)
- idempotency storage 가 단일 인스턴스 메모리 (멀티 인스턴스에서 race condition)

## Key 구성 (충돌 방지)

Idempotency key 의 고유 scope 는 다음 5 차원 결합:

```
key_scope = sha256(
  user_id || tenant_id || method || path || body_hash || client_provided_key
)
```

- `user_id` / `tenant_id`: 멀티테넌트 격리 — 다른 user 가 같은 client key 보내도 충돌 없음
- `method` + `path`: 같은 client key 라도 endpoint 다르면 별도 처리
- `body_hash`: 같은 client key 인데 body 다르면 → 409 Conflict (재시도 일관성 보장)
- `client_provided_key`: header `Idempotency-Key` 값

## 차단 가능 audit 체크리스트

- [ ] **Key TTL 정책**: 저장 TTL 명시 (기본 24h 권장) — 무한 보관 시 storage growth
- [ ] **In-flight lock**: 동일 key 동시 요청 시 lock 으로 직렬화 — 두 번째 요청은 첫 결과 대기 (race condition 차단)
- [ ] **body_hash 일치 검증**: 같은 key + 다른 body → 409 Conflict
- [ ] **응답 본문 + status 저장**: 재시도 시 동일 응답 반환 가능해야 함
- [ ] **safe method 면제**: GET / HEAD 는 idempotency-key 처리 불필요 (이미 idempotent)

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| user_id 없이 key 만으로 lookup | 다른 user 의 결과 leak | 5 차원 결합 강제 |
| body hash 검증 없음 | retry 시 다른 body 가 같은 응답 받음 → silent 데이터 손실 | 409 Conflict 분기 |
| In-flight lock 없음 | 동시 retry 가 두 번 처리 (예: 결제 두 번) | distributed lock (Redis SETNX / DB advisory lock) |
| TTL 무한 | 저장소 무한 증가 | 명시적 TTL + 만료 후 재처리 허용 정책 |
