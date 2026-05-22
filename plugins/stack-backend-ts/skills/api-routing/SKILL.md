---
name: api-routing
description: apps/api 에 새 HTTP route / middleware / 전역 에러 핸들러 추가 시 invoke. route 그룹화 + middleware 순서 + auth middleware 패턴, HTTP 에러 sentinel 변환, CORS expose_headers 규약 안내.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/rules/api-routing-patterns.md
---

# api-routing — API 라우팅 규약

## 이 skill은 언제 invoke 되는가

- `src/routes/` 에 새 HTTP route 추가
- middleware 순서 결정
- 전역 에러 핸들러 등록
- CORS `exposeHeaders` 변경
- "route 가 안 매칭된다", "middleware 가 잘못된 순서로 실행된다" 디버깅

## 최상위 prefix 규약

API 최상위 경로 (router prefix) 는 도메인 단위로 분리한다.

| prefix | 책임 | 인증 |
|---|---|---|
| `/health` | liveness/readiness 체크 | 제외 |
| `/run` | LLM 기반 실행 (POST `/run/:name`) | 필요 |
| `/sessions` | 세션 조회/취소 | 필요 |
| `/media` | 미디어 파이프라인 | 필요 |

- 중첩 prefix 금지 (`/ai/run/foo` 같은 구조 사용 안 함)
- 새 최상위 prefix 추가는 설계 문서 검토 후

## Middleware 등록 순서 원칙

Middleware 는 **요청 진입 순서 = 등록 순서** (FIFO) 로 동작하는 프레임워크를 가정한다. 등록 순서는 다음을 따른다 — 앞 → 뒤:

1. **requestId** — 모든 로그·trace 의 root. 가장 먼저 붙여야 하위 미들웨어 로그에 ID 포함.
2. **rateLimit** — *auth 전* (IP-based, anonymous DDoS 보호). auth 비용 소모 전 차단. 인증 후 per-user 제한은 route handler 또는 별도 미들웨어에서 처리.
3. **cors** — preflight 처리 (auth·parse 전). OPTIONS 요청에 auth 불필요.
4. **authMiddleware** — JWT/api-key 검증 → request context 에 `auth` 주입. 보호 경로 (`/run/*`, `/sessions/*`, `/media/*`) 에만 적용.
5. **schema validation** — route 수준 (auth 통과 후 body parse). zod 등 사용.
6. **route handler** — 도메인 로직은 직접 호출 금지 (engine 경유).

> 등록 순서 ≠ 실행 순서 인 프레임워크 (예: FastAPI `add_middleware` 의 LIFO wrap) 를 사용할 경우 본 가이드를 그대로 적용하지 말 것.

## Route 구현 원칙

- Route 는 **thin layer** — HTTP 파라미터 파싱, 스키마 검증, 응답 포맷 결정만 담당.
- 도메인 로직은 `src/engine/` 또는 `src/ai/` 경유.
- 요청 body 는 zod 등 스키마로 검증 → 검증 실패 시 422.
- run 이름 미존재 → 404 `HTTPException` 류 sentinel throw.
- SSE 응답 경로는 별도 streaming handler 위임 ([[sse-streaming]] / [[sse-lifecycle]] 참조).
- non-SSE 경로는 단일 JSON 응답.

## Route 그룹화

- 동일 prefix 의 라우트는 별도 router 로 그룹화 후 최상위 app 에 mount.
- 버전 prefix (`/api/v1`) 추가는 호환 정책에 맞춰 결정.
- 두 단계 이상 중첩 (`/api/v1/run`) 은 허용하되 세 단계 이상은 금지.

## Leak-safe 404

소유권 불일치 시 403 금지 — **존재/미존재/권한없음 을 모두 404 로 응답**. 존재 여부를 권한으로 추론 불가하도록.

- 리소스 소유자 ≠ 요청자 + scope 미포함 → 404 `resource not found`
- 인증 실패 → 401 (의도된 인증 요구)
- 권한 부족 → 404 (403 사용 금지)

## HTTP 에러 변환

전역 에러 핸들러는 다음 sentinel → HTTP 상태 매핑을 보장한다 ([[http-error-sentinels]] invariant 참조):

| 에러 종류 | HTTP | 응답 envelope |
|---|---|---|
| `HTTPException` (라이브러리 자체) | 그대로 통과 | 그대로 |
| 스키마 검증 실패 (`ZodError` 등) | 422 | `{ error: { code: "validation_error", message } }` |
| `ConfigurationError` | 500 | `{ error: { code: "configuration_error", message: "service misconfigured" } }` |
| `InternalError` / 기타 unhandled | 500 | `{ error: { code: "internal_error", message: "internal server error" } }` |

- 500 응답은 상세 메시지를 클라이언트에 노출하지 않음 (로그에만 기록).
- 에러 JSON 포맷 **고정**: `{ error: { code: string, message: string, details?: unknown } }`.

## CORS `exposeHeaders` 규약

브라우저 JS 가 읽어야 하는 헤더 — CORS expose 필수:

| 헤더 | 용도 |
|---|---|
| `X-App-Session-Id` | FE의 session id 추출 |
| `X-App-Agent` | 현재 dispatch 된 run 이름 |
| `X-App-Model` | 해석된 모델 |
| `X-Request-Id` | 디버깅 / 서버 로그 correlation |

`exposeHeaders` 목록 변경은 **FE contract breaking** — 프론트엔드 코드 동시 검토 필수.

## Routes 계층 원칙

| 책임 | 위치 |
|---|---|
| HTTP 파라미터 파싱 / 스키마 검증 | `src/routes/*.ts` |
| 인증 / request_id 주입 | `src/middleware/` |
| SSE / JSON 응답 포맷 결정 | `src/routes/*.ts` |
| 도메인 로직 | ❌ 금지 — `src/engine/` 또는 `src/ai/` 경유 |
| DB/파일 쓰기 | ❌ 금지 — `src/storage/writer.ts` 경유 |
| Provider 직접 호출 | ❌ 금지 — `src/engine/loop.ts` 경유 |

## 검증 체크리스트

- [ ] 모든 보호 엔드포인트에 `authMiddleware` 적용 (health 제외)
- [ ] 전역 에러 핸들러 등록 — sentinel → HTTP 매핑 보장
- [ ] 에러 JSON 포맷 고정 (`{ error: { code, message } }`)
- [ ] CORS `exposeHeaders` 에 X-App-* 4종 포함
- [ ] 스키마 검증으로 요청 body 검증
- [ ] 리소스 소유권 불일치 → 404 (403 아님)
- [ ] routes 에 도메인 로직 없음 (thin layer)
- [ ] [[http-error-sentinels]] invariant 의 envelope shape 준수
- [ ] middleware 등록 순서: requestId → rateLimit → cors → auth → schema → handler
