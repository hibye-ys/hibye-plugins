---
name: auth
description: apps/api 인증·세션·시크릿 추가 또는 수정 시 invoke. JWT 인증 / 세션 스토어 / API key / rate limit 패턴, scope 검증, 시크릿 누락 에러 처리. 인증 실패 401 디버깅, 시크릿 누락 에러 시에도 invoke.
metadata:
  role: workflow
  scope: apps/api
  source: (신규 — Python 인증 분산 부분 통합)
---

# auth — 인증·세션·시크릿 패턴

## 이 skill은 언제 invoke 되는가

- `src/middleware/auth.ts` 최초 작성 또는 수정
- 새 시크릿 바인딩 추가
- JWT 발급/검증 로직 변경
- API key 인증 추가
- rate limit 정책 변경
- "AUTH_SECRET 누락", "401 unauthorized" 디버깅

## JWT 인증 원칙

- **Signing**: 대칭 키 (HS256) 또는 비대칭 키 (RS256/EdDSA). 대칭은 단일 서비스, 비대칭은 발급/검증 분리 시.
- **Verify**: 모든 보호 경로에서 매 요청 검증. 캐시 금지 (revocation 즉시성 우선).
- **Expiry**: `exp` claim 필수. 짧은 access token (15분~1시간) + refresh token 패턴 권장.
- **Claims**: 최소 `sub` (userId), `exp`, `iat`. 권한은 `scopes: string[]` 로 표현 — `["*"]` 은 super.
- **Algorithm pinning**: verify 시 허용 algorithm 명시 — `none` 또는 algorithm confusion 공격 차단.

인증 middleware 책임:
1. `Authorization` 헤더 파싱 — `Bearer <jwt>` 또는 `ApiKey <key>` scheme 분기.
2. 검증 성공 → request context 에 `auth: { userId, scopes, method }` 주입.
3. 검증 실패 → `HTTPException(401)` throw (메시지는 일반화 — leak 방지).
4. anonymous fallback 은 환경 플래그 (`APP_AUTH_REQUIRED=false`) 가 명시적으로 false 일 때만 허용.

## API Key 인증 원칙

- Format: `<prefix>_<kid>_<secret>` — kid 는 O(1) lookup key.
- 저장: secret 의 **hash** 만 저장 (argon2 / bcrypt). 평문 저장 금지.
- 검증: kid 로 hash 조회 → 입력 secret 을 동일 알고리즘으로 hash → 비교.
- 회전: kid 단위로 revoke 가능. [[secret-rotation]] workflow 참조.

## 시크릿 접근 원칙

- 시크릿은 **런타임 환경** 에서 주입받음 — 코드 / 설정 파일에 평문 금지.
- 시크릿 접근은 runtime context 의 환경 객체를 통해서만 (process env 또는 framework binding — 런타임에 맞게 선택). [[verify-workers-compat]] 참조.
- 시작 시점 (혹은 첫 요청 시점) 에 **필수 시크릿 누락 검증**:
  - 누락된 시크릿 발견 → `ConfigurationError` throw → 500 응답 (`code: "configuration_error"`).
  - 로그에 누락된 key 이름은 기록하되, 응답에는 일반화된 메시지만.
- 로컬 개발용 시크릿 파일 (`.env`, `.dev.vars` 등) 은 반드시 `.gitignore` 에 포함.
- 시크릿 회전 / 신규 등록 / 폐기는 [[secret-rotation]] workflow 를 따른다.

## 세션 스토어 원칙

세션 스토어는 다음 interface 를 만족해야 한다 (storage backend 는 KV / Redis / DB 등 교체 가능):

```
SessionPort {
  get(sessionId)        → SessionData | null
  set(sessionId, data, ttlSeconds?)
  delete(sessionId)
}
```

- **TTL**: 기본 86400s (24h). 갱신 시 sliding (마지막 활동 기준) 또는 absolute (발급 기준) 정책 결정.
- **Rotation**: 권한 상승 / 인증 재확인 시점에 sessionId rotation — 기존 session 즉시 invalidate.
- **Key 패턴**: `session:<sessionId>`, `rate_limit:<scope>:<key>`, `api_key:<kid>` — prefix 충돌 방지.
- **Backend 선택**: 단일 region edge → KV 류; multi-region 동시 일관성 필요 → Redis 또는 DB; 영속 필요 → DB.
- storage 구현은 `src/storage/session.ts` 에 격리 — route / middleware 에서 직접 KV/DB API 호출 금지.

## Rate Limit 원칙

- IP-based, anonymous DDoS 보호 목적의 rate limit 은 **auth middleware 앞** 에 등록 ([[api-routing]] middleware 순서 참조).
- 인증 후 per-user 제한은 route handler 또는 별도 middleware 에서 처리.
- 파라미터 (window, max requests, backend) 는 [[rate-limit-policy]] invariant 참조 — 본 skill 은 상수 정의하지 않음.
- 초과 시: HTTP 429 + `Retry-After` 헤더 + `{ error: { code: "rate_limit_exceeded", message, retry_after_ms } }` envelope.
- 정책 변경은 [[run-policy-presets]] invariant 와 충돌하지 않는지 확인.

## Scope 검증 원칙

- 요청 context 의 `auth.scopes` 와 route 가 요구하는 scope 비교.
- `"*"` scope 는 super — 모든 scope 통과.
- scope 불일치 → **leak-safe 404** (`HTTPException(404, "resource not found")`). 403 금지 ([[api-routing]] Leak-safe 404 참조).
- scope 검증은 별도 middleware factory 또는 route-level guard 로 분리 — auth middleware 본체에서 직접 검사 금지.

## 시크릿 누락 에러 처리 원칙

- 시작 시점 (혹은 첫 요청 시점) 에 `assertRequiredSecrets()` 호출 — 누락 시 즉시 throw.
- middleware 안에서 시크릿 누락 catch → `ConfigurationError` 로 표준화 → 500 + `{ error: { code: "configuration_error", message: "service misconfigured" } }`.
- 누락된 시크릿 key 이름은 **로그에만** 기록 — 응답에는 노출 금지.
- `.gitignore` 에 로컬 시크릿 파일 포함 여부, 운영 시크릿 등록 절차는 [[secret-rotation]] workflow 참조.

## 검증 체크리스트

- [ ] `authMiddleware` 가 JWT + API key 두 경로 처리
- [ ] 모든 시크릿이 runtime env 객체 경유 접근 (직접 글로벌 접근 금지 — [[verify-workers-compat]] 참조)
- [ ] `assertRequiredSecrets()` 로 시작 시점 누락 시크릿 검출
- [ ] rate limit middleware 가 [[rate-limit-policy]] invariant 상수 참조
- [ ] 세션 스토어가 `SessionPort` interface 구현 (backend 교체 가능)
- [ ] scope 불일치 → leak-safe 404 (403 아님)
- [ ] 로컬 시크릿 파일 (`.env` / `.dev.vars`) 이 `.gitignore` 에 포함됨
- [ ] 운영 시크릿 등록 / 회전 절차가 [[secret-rotation]] workflow 따름
- [ ] JWT verify 시 algorithm 명시적 지정 (algorithm confusion 차단)
