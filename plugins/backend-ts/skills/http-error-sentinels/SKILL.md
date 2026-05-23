---
name: http-error-sentinels
description: HTTP 에러 코드 sentinel 매핑, 에러 응답 envelope shape, leak-safe 404, scrub_text invariant. Shape 변경 시 클라이언트 파서 계약 깨짐.
metadata:
  role: invariant
  scope: project
---

> Language-neutral invariants — HTTP error code sentinels, error envelope shape, leak-safe 404, scrub_text.
> 정본 (single source of truth) — 프레임워크 무관.

# HTTP Error Sentinels — 언어 무관 불변식

## 에러 응답 envelope (고정 shape)

```json
{
  "error": {
    "code": "<sentinel>",
    "message": "<scrubbed>",
    "details": { ... }    // optional
  }
}
```

- 클라이언트 파서 계약 — shape 변경 금지
- `errorBody(code, message, details?)` helper 가 단일 source. 라우트 코드는 이 helper 만 사용 (framework-neutral pseudo-signature)

## 에러 발신 / 전역 핸들러 원칙 (프레임워크 무관)

- **Route-edge 발신**: 라우트는 sentinel `code` + HTTP `status` + scrubbed `message` 를 envelope 로 wrap 하여 반환. 직접 status code + body 를 구성하든, 프레임워크 예외 객체로 throw 하든, 결과는 envelope shape 와 동일해야 함.
- **전역 핸들러**: 알 수 없는 에러는 `internal_error` / 500 / `"internal server error"` 로 통일. 내부 메시지 / 스택 트레이스 노출 금지.
- **단일 source**: envelope 생성은 `errorBody()` helper 만 사용 — route 별로 인라인 JSON 작성 금지.

## 내부 예외 → HTTP 매핑 (글로벌 exception handlers)

| 내부 예외 | HTTP code | `error.code` (sentinel) | 메시지 처리 |
|-----------|-----------|------------------------|-------------|
| `ValidationError` | 422 | `validation_error` | `scrubText(String(err))` |
| `ResourceError(user_data_pending_deletion)` | **410** | `user_data_pending_deletion` | `"your account data is queued for deletion"` (탐스톤 사용자 7-day grace 동안 모든 write 차단) |
| `ResourceError` (default) | 404 | `resource_error` | `scrubText(String(err))` |
| `ConfigurationError` | 500 | `configuration_error` | `"service misconfigured"` (상세 숨김) |
| `InternalError` | 500 | `internal_error` | `"internal server error"` (상세 숨김) |
| `AppError` (fallback) | 500 | `app_error` | `scrubText(String(err))` |

## Route-edge sentinel (route 가 직접 raise)

| 시나리오 | HTTP code | `error.code` | 메시지 / details |
|----------|-----------|--------------|-----------------|
| 입력 content moderation 거부 | 422 | `content_moderation_blocked` | `"this input violates content policy"` + `details.categories=[...]` (입력측 분류 결과) |
| 입력 jailbreak 거부 | 422 | `jailbreak_blocked` | `"this input was flagged as a system-instruction-bypass attempt"` — **NO `details` body** (R1-S8: attacker info-disclosure protection — pattern 시그너처 노출 시 evasion 학습 가능) |
| RunPolicy 위반 (예: `sse=true` + `response_schema`) | 422 | `invalid_policy` | request-time 거부 |
| `payload_too_large` | 413 | `payload_too_large` | `Content-Length` 가 path 별 cap 초과 |
| `length_required` | 411 | `length_required` | `Transfer-Encoding: chunked` 인데 `Content-Length` 없음 |
| Rate limit | 429 | `rate_limited` | `Retry-After` 헤더 + `retry_after_ms` body (middleware 직접 발신, [[rate-limit-policy]] invariant) |
| Idempotency conflict | 409 | `idempotency_conflict` | 같은 `Idempotency-Key` + 다른 body hash 재시도 — `Idempotency-Key` 요청 헤더 값 echo. [[idempotency-key]] workflow 참조 |

## Leak-safe 404 원칙

리소스 소유권 불일치 시 **403 금지** — 존재/미존재/권한없음 을 **모두 동일한 404** 로 응답.

- 이유: 존재 여부를 권한으로 추론 불가하게 (enumeration 공격 차단)
- 적용 예: sessions getter, media owner assertion
- 패턴: `if (obj.userId !== caller && !hasScope(scopes, "*")) return notFound()`

## Tombstone (user_data_pending_deletion) 410 처리

- 사용자가 deletion 신청 후 7-day grace 동안 모든 write 가 차단됨
- `assertUserActive(userId)` 함수가 라우트 진입 시 검사
- 차단 시 `ResourceError(code="user_data_pending_deletion")` throw → 410 응답
- 사용자가 cancel 안 하면 7일 후 영구 삭제 (데이터 거버넌스 영역 — instance 측 project-local skill 참조)

## scrubText — secrets + PII 제거

응답 body 와 로그 양쪽에 적용:

- `scrubText = scrubPii(scrubSecrets(text))`
- 7 secret 패턴 + 5 PII 패턴 (RRN/모바일/유선/이메일/카드/운전면허)
- 스택 트레이스 / 내부 경로 / API key / token 모두 제거
- **Migration note (PII Phase 1)**: 이전 버전은 `scrubSecrets` 만 사용. 현재 `scrubText` 로 통합

## CORS expose_headers 7종 (FE contract)

브라우저 JS 가 response.headers 로 읽어야 하는 헤더 — 누락 시 FE breaking:

| 헤더 | 용도 |
|------|------|
| `X-App-Session-Id` | FE 의 session id 추출 |
| `X-App-Agent` | 현재 dispatch 된 run 이름 |
| `X-App-Model` | 해석된 모델 (fallback chain 소비 후) |
| `X-App-Run-Id` | run-scoped uuid (`sse=true` 응답에만, SSE Resilience Phase 1) |
| `X-App-Moderation-Status` | content moderation 결과 (`ok` / `failed_open` / `skipped_short` / `disabled`. `blocked` 은 422 envelope 분기) |
| `X-App-Jailbreak-Status` | jailbreak 결과 6값 (`ok` / `flagged` / `blocked` / `failed_open` / `disabled` / `skipped_short`) |
| `X-Request-Id` | 디버깅 / 서버 로그 correlation |

`expose_headers` 변경은 FE contract breaking. 헤더 상수는 stream 모듈의 `*_HEADER` 변수가 단일 source — 라우트는 re-export 만 사용.

## 공통 금지 사항 (언어 무관)

- 응답에 시크릿/PII/스택트레이스 포함 (반드시 `scrubText`)
- 403 으로 권한 거부 (반드시 leak-safe 404 — 단, 인증 자체 실패는 401 OK)
- 같은 sentinel 을 다른 의미로 재사용
- error envelope shape 임의 변경 (`{"error": {...}}` 고정)
- HTTP code 와 sentinel 의 1:1 mapping 깨기 (예: 같은 sentinel 이 여러 status code 로 나가면 클라이언트 분기 깨짐)
- 라우트 외부 (engine / services) 에서 HTTP-specific exception raise (내부는 AppError, 변환은 routes 경계에서만)
