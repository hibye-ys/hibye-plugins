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
