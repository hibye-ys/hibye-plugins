---
name: auth
description: <api-app> 인증·세션·시크릿 추가 또는 수정 시 invoke. 본 plugin 의 *프로젝트 결정* — Authorization 스키마 (Bearer/ApiKey 동시), assertRequiredSecrets startup 검증, SessionPort interface, API key kid 단위 revoke, scope `*` super + 불일치 leak-safe 404, storage 격리. JWT 일반 (algorithm pinning / exp / refresh) + API key bcrypt hash + IP-based DDoS rate limit 알고리즘은 모델 native.
metadata:
  role: workflow
  scope: project
---

# auth — 본 plugin 의 인증·세션·시크릿 결정

> 일반 인증 지식 (JWT algorithm pinning / exp claim 필수 / refresh token 패턴 / argon2/bcrypt hash 저장 / kid prefix 패턴 / rate limit 알고리즘) 은 모델 native. 본 skill 은 *디폴트와 다른 결정* + *프로젝트 고유 유틸/규약* 만 기록.

## 이 skill 은 언제 invoke 되는가

- `src/middleware/auth.ts` 최초 작성 또는 수정
- 새 시크릿 바인딩 추가 / `assertRequiredSecrets()` 정정
- API key kid 단위 revoke 정책 변경
- scope 검증 / leak-safe 404 디버깅
- "AUTH_SECRET 누락" / 401 디버깅

## 1. Authorization 스키마 — Bearer + ApiKey 동시

`Authorization` 헤더는 두 scheme 동시 지원:

- `Bearer <jwt>` → JWT 경로
- `ApiKey <key>` → API key 경로 (`<prefix>_<kid>_<secret>` format)

검증 성공 시 request context 에 통일된 `auth: { userId, scopes, method }` 주입 — route handler 는 `method` 무관하게 처리. 검증 실패 → `<framework HTTP error class>(401)` throw, 메시지 일반화 (leak ✕).

anonymous fallback: env flag `APP_AUTH_REQUIRED=false` 가 *명시적으로* false 일 때만 허용.

## 2. API Key — kid 단위 revoke

- Format `<prefix>_<kid>_<secret>` — kid 는 O(1) lookup key
- 저장: secret 의 hash 만 (알고리즘은 native — argon2 / bcrypt)
- **revoke 단위 = kid** — secret 만 회전, kid 폐기는 별도 절차 ([[secret-rotation]] 정본)

## 3. 시크릿 접근 — runtime env 단일 진입점

- 시크릿은 runtime env 객체 경유만 (직접 글로벌 ✕ — runtime-specific, instance 측 project-local skill)
- **`assertRequiredSecrets()`**: 시작 시점 (또는 첫 요청 시점) 호출 — 누락 시 `ConfigurationError` throw → 500 + `{ error: { code: "configuration_error", message: "service misconfigured" } }`
- 누락된 key 이름은 **로그에만** — 응답 노출 ✕
- 로컬 시크릿 파일 (`.env` / `.dev.vars`) `.gitignore` 강제
- 회전 / 신규 등록 / 폐기 절차는 [[secret-rotation]] 정본

## 4. SessionPort interface — backend 교체 가능

```typescript
SessionPort {
  get(sessionId)        → SessionData | null
  set(sessionId, data, ttlSeconds?)
  delete(sessionId)
}
```

- **TTL**: default 86400s (24h). sliding vs absolute 정책은 운영 결정
- **Rotation**: 권한 상승 / 인증 재확인 시점에 sessionId rotation → 기존 session 즉시 invalidate
- **Key prefix**: `session:<sessionId>` / `rate_limit:<scope>:<key>` / `api_key:<kid>` — 충돌 방지
- **Backend 선택**: 단일 region edge → KV / multi-region 일관성 → Redis 또는 DB / 영속 필요 → DB
- **storage 격리**: `src/storage/session.ts` 만 — route / middleware 에서 KV/DB API 직접 호출 ✕

## 5. Scope 검증 — `*` super + 불일치 leak-safe 404

- request context `auth.scopes` ↔ route 요구 scope 비교
- `["*"]` = super (모든 scope 통과)
- scope 불일치 → **leak-safe 404** (`"resource not found"`). 403 ✕ ([[http-error-sentinels]] / [[api-routing]] §Leak-safe 404 정본)
- scope 검증은 별도 middleware factory 또는 route-level guard — auth middleware 본체에서 직접 검사 ✕

## 6. Rate limit middleware 등록 순서

- IP-based anonymous DDoS rate limit → **auth middleware 앞** ([[api-routing]] middleware 순서 정본)
- 인증 후 per-user 제한은 route handler 또는 별도 middleware
- 파라미터 (window / max / backend) + 429 envelope 은 [[rate-limit-policy]] 정본 — 본 skill 은 *등록 순서* 만 결정

## 검증 체크리스트

- [ ] `authMiddleware` 가 `Bearer <jwt>` + `ApiKey <key>` 두 scheme 처리
- [ ] 모든 시크릿이 runtime env 객체 경유 접근 (직접 글로벌 ✕)
- [ ] `assertRequiredSecrets()` startup 호출 + 누락 시 `ConfigurationError`
- [ ] rate limit middleware 가 auth middleware 앞에 등록
- [ ] 세션 스토어가 `SessionPort` interface 구현 (backend 교체 가능)
- [ ] storage 격리 — route / middleware 에서 KV/DB 직접 호출 ✕
- [ ] scope 불일치 → leak-safe 404 (403 ✕)
- [ ] 로컬 시크릿 파일 `.gitignore` 포함
- [ ] 운영 시크릿 등록 / 회전 절차 [[secret-rotation]] 따름

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `assertRequiredSecrets()` 필수 키 추가 | runtime secret store + `Env.Bindings` 타입 + startup smoke test 동시 갱신 |
| `SessionPort` 인터페이스 변경 | 모든 storage 구현체 + 테스트 fixture + middleware injection point |
| Authorization scheme 추가 (예: `Cookie`) | request context shape 동일 유지 + route handler 코드 무변경 |
| Scope `*` 의미 변경 | 모든 route guard 재검토 |
| rate limit / auth 등록 순서 변경 | [[input-safety-gate-ordering]] V3 순서와 충돌 가능 — 유지 검증 |
