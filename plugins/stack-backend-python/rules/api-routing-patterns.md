---
paths:
  - "backend/routes/**"
  - "backend/middleware/**"
---

> App backend rules — API routing invariants, extension guide, impact map.
> **정본:** `_shared/http-error-sentinels.md` (envelope shape / 내부예외→HTTP 매핑 / leak-safe 404 / scrub_text / CORS expose_headers 7종 — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `architecture.md` (routes 계층), `run-policy.md` (/run/<name>),
>       `media-pipeline-patterns.md` (/media/*), `error-handling.md` (HTTP 경계 응답),
>       `core-infrastructure.md` (SSE lifecycle), `config-management.md` (인증 시크릿)

# api-routing-patterns — API 라우팅 규약

## 불변식 (Invariants)

**최상위 prefix 는 책임별:**

```
# 현재 구현 (main.py include_router)
/health       # health check (인증 제외)
/run          # POST /run/<name> — LLM 기반 전체 (RunPolicy)
/runs         # run 목록, hot reload (POST /runs/reload)
/sessions     # 세션 조회/취소/종료 + 사이드바 listing
/media        # POST /media/<category>/<op>, GET /media/jobs/<id> — 미디어 파이프라인
/users/me/data # POST /export, /delete | GET /jobs/{id}, /jobs/{id}/download, /audit-log | DELETE /jobs/{id} — GDPR/PIPA right-to-erasure + export + self-read audit history (data-governance-patterns.md)
/debug        # APP_DEBUG_ROUTES_ENABLED=true 시 조건부 mount (prod 는 warn)

# 계획 / 선택적 (현재 미구현)
/models       # 모델/프로바이더 목록 — future
/tools        # 도구 목록 — future
/memory       # Memory CRUD — future
/mcp          # MCP 서버 관리 — future
/admin        # 관리자 엔드포인트 — future
```

**LSP 는 FastAPI 라우트가 아님** — `LSPHost` (backend/lsp/host.py) 가 별도 daemon thread 로 동작 (main.py:342). pygls 기반 자체 WebSocket/stdio transport 사용. 라우터 include_router 경로와 분리.

- **중첩 prefix 금지**: `/ai/sessions`, `/ai/run/foo` 같은 구조 사용 안 함. 최상위 책임별 분리
- 새 최상위 prefix 추가는 **사람 승인** 필요 (설계 문서 §6 업데이트 + AD 검토)

**Routes 는 thin layer (architecture.md 단방향 import 준수):**

| 책임 | 위치 |
|------|------|
| HTTP 파라미터 파싱 / pydantic 검증 | `routes/<file>.py` |
| 인증 / request_id 주입 | `routes/_common.py` 의 의존성 |
| SSE / JSON 응답 포맷 결정 | `routes/<file>.py` (policy.sse 에 따라) |
| 도메인 로직 | ❌ 금지 — `engine/` 또는 `services/` 경유 |
| DB/파일 쓰기 | ❌ 금지 — `data/writer.py` 경유 |
| Provider 직접 호출 | ❌ 금지 — `engine/` 경유 |

**예외 — engine wiring seam:** `backend/routes/run.py` 가 `backend.tools.registry.ToolRegistry` 를 직접 import 하는 것은 허용된다. 이는 도메인 호출이 아니라 `build_default_deps(...)` 의 인자 조립 — engine 진입점 직전 1회용 wiring. routes 는 ToolRegistry 의 메서드를 호출하지 않고 객체를 그대로 forward 한다. 진정한 routes→tools 직접 호출 (read/write) 은 여전히 금지.

**요청/응답 스키마 배치:**

- `routes/schemas.py` — HTTP 경계 pydantic 모델 (RunRequest, MediaJobStatus, HealthResponse 등)
- `engine/types.py` — 내부 공유 타입 (Message, ContentBlock, RunPolicy, StreamEvent)
- 같은 타입을 양쪽에 중복 선언 금지. 외부 스키마가 내부 타입을 wrap 하는 형태

**인증 (dual auth — JWT + API key):**

- 의존성: `Depends(require_auth)` — JWT 또는 API 키 중 하나 허용. 결과는 dict (`{user_id, scopes, method}`) 로 핸들러 인자로 전달 (request.state 주입 금지 — fastapi dependency 패턴 준수)
- JWT: 프론트엔드 사용자. `sub` claim → user_id, `scopes` claim 또는 wildcard `('*',)` 로 fallback
- API 키: B2B. argon2 해시 매칭 → user_id, scopes는 `('*',)` 고정. 키 포맷 `lf_<kid>_<secret>` 사용 시 O(1) 조회 (kid 별 dict), 미태깅 키는 legacy linear scan
- 둘 다 `scopes` 모델은 **동일**. 권한 판정은 `Depends(require_scope("<name>"))` 또는 `has_scope(granted, required)` 로 (`'*'` wildcard 또는 정확 매칭)
- Anonymous 폴백: `APP_AUTH_REQUIRED=false` (or `app_env != prod`) 시 anonymous user (`scopes=('chat',)` non-dev / `('*',)` dev). 그 외 401
- health 제외 모든 엔드포인트에 인증 의무. LSP 는 FastAPI 라우트가 아니라 daemon thread 라서 이 규칙 밖 — 자체 transport 인증 구현
- **리소스 소유권 불일치 시 leak-safe 404** — 403 금지, 존재/미존재/권한없음 을 **모두 동일한 404** 로 응답. 존재 여부를 권한으로 추론하지 못하게 함. 예: `routes/sessions.py` `get_session`, `routes/media.py` `_assert_owner_or_wildcard` (모두 `job.user_id != caller and not has_scope(scopes, "*")` → 404)

**공통 미들웨어 스택 (`backend/main.py` 에서 `add_middleware` 호출 순서 = 안쪽→바깥쪽으로 감싸짐):**

바깥(외부 요청) → 안쪽(라우터) 방향으로 배치된 실제 순서:

1. `CORSMiddleware` (최외곽) — preflight OPTIONS 처리, origin 화이트리스트
2. `BodySizeLimitMiddleware` — request body 크기 상한 (DoS 방어)
3. `RateLimitMiddleware` — 토큰 버킷 기반 요청 제한
4. `TraceContextMiddleware` — W3C traceparent → `trace_id` / `span_id` ContextVar 바인딩
5. `RequestIdMiddleware` (최내곽) — `X-Request-Id` 헤더 → `request_id` ContextVar 바인딩
6. 예외 핸들러 (`app.exception_handler` — AppError → JSONResponse/SSE error)
7. 라우터 dispatch

`add_middleware` 호출은 **역순**: `app.add_middleware(RequestIdMiddleware, ...)` 가 먼저, `app.add_middleware(CORSMiddleware, ...)` 가 마지막 — starlette 이 LIFO 로 래핑해서 CORS 가 최외곽이 된다.

**CORS `expose_headers` 계약 (프론트엔드 필수)**:

브라우저 JS 가 response.headers 로 읽어야 하는 CORS-exposed 헤더 7종 (`main.py` `expose_headers=[...]`):

| 헤더 | 용도 | 누락 시 영향 |
|------|------|-------------|
| `X-App-Session-Id` | FE 의 session id 추출 | session sticky 실패 |
| `X-App-Agent` | 현재 dispatch 된 run 이름 | UI "현재 에이전트" 표시 누락 |
| `X-App-Model` | 해석된 모델 (fallback chain 소비 후) | "어느 모델이 답했는지" 추적 불가 |
| `X-App-Run-Id` | run-scoped uuid (`sse=True` 응답에만, SSE Resilience Phase 1) | reconnect 시 `Last-Event-ID` 와 결합되는 run id 못 읽음 → resume 불가 |
| `X-App-Moderation-Status` | content moderation 결과 (`ok` / `failed_open` / `skipped_short` / `disabled`. `blocked` 은 422 envelope 분기) | UI 가 moderation 상태 분간 불가 (Content Moderation Phase 1) |
| `X-App-Jailbreak-Status` | jailbreak detection 결과 6값 (`ok` / `flagged` / `blocked` / `failed_open` / `disabled` / `skipped_short`. `flagged` = 매치 + log_only enforcement → 200 통과; `blocked` = 매치 + block enforcement → 422 envelope. moderation 과 직교 — 두 헤더 모두 set 됨) | UI 가 jailbreak 상태 분간 불가, 특히 `flagged` (창작 platform 의 log-only 모드 경고) 못 surface (Jailbreak Detection Phase 1) |
| `X-Request-Id` | 디버깅 / 서버 로그 correlation | 고객 지원 티켓 연결 불가 |

expose_headers 목록 변경은 FE contract breaking — 프론트엔드 client 코드 동시 검토 필수. 헤더 상수는 `backend/engine/stream.py` 의 `*_HEADER` 모듈 변수가 단일 source — 라우트는 re-export 만 사용하고 문자열 인라인 금지.

**에러 변환 (error-handling.md 4 패턴의 HTTP 경계 패턴):**

글로벌 exception handlers 는 `backend/main.py` 의 `@app.exception_handler(*)` 데코레이터로 등록. envelope shape 는 `backend/routes/_common.py::error_body(code, message, details?)` 단일 helper 가 정본.

| 내부 예외 | HTTP 응답 code | 응답 body `error.code` | 메시지 처리 |
|-----------|---------------|----------------------|-------------|
| ValidationError | 422 | `validation_error` | `scrub_text(str(exc))` |
| ResourceError(`user_data_pending_deletion`) | 410 | `user_data_pending_deletion` | "your account data is queued for deletion" (탐스톤 사용자 7-day grace 동안 모든 write — data-governance-patterns.md `assert_user_active`) |
| ResourceError | 404 | `resource_error` | `scrub_text(str(exc))` |
| ConfigurationError | 500 | `configuration_error` | `"service misconfigured"` (상세 숨김) |
| InternalError | 500 | `internal_error` | `"internal server error"` (상세 숨김) |
| AppError (fallback) | 500 | `app_error` | `scrub_text(str(exc))` |
| HTTPException (route 발신) | 그대로 | 내부 detail 의 `error.code` 유지 | `http_error()` helper 경유 |
| HTTPException (route 발신, content moderation) | 422 | `content_moderation_blocked` | "this input violates content policy" + `details.categories=[...]` (input-side classifier rejection — Content Moderation Phase 1, `routes/run.py::_content_moderation_blocked_error`. `X-App-Moderation-Status` 헤더는 이 분기에서 set 안 됨 — 422 envelope 자체가 blocked 신호) |
| HTTPException (route 발신, jailbreak detection) | 422 | `jailbreak_blocked` | "this input was flagged as a system-instruction-bypass attempt" — **NO `details` body** (R1-S8: attacker 가 JSON 으로 직접 읽어 pattern 시그너처 학습 + evasion 가능. detailed signal 은 structlog `jailbreak.detected` (operator-only) + `X-App-Jailbreak-Status: blocked` 헤더로만. FE i18n 은 `error.code` 로만 분기). Jailbreak Detection Phase 1, `routes/run.py::_jailbreak_blocked_error` |

- **Rate limit (429)**: `RateLimitMiddleware` 가 직접 변환 — 위 핸들러 대상 아님. `Retry-After` 헤더 + `retry_after_ms` body
- **Body size (413 / 411)**: `BodySizeLimitMiddleware` (`backend/middleware/body_size.py`) 가 직접 변환 — 위 핸들러 대상 아님
  - `payload_too_large` (413) — `Content-Length` 가 path 별 cap 초과 (default vs `/media/*` 별 상한)
  - `length_required` (411) — `Transfer-Encoding: chunked` 인데 `Content-Length` 없음. 전체 body 버퍼링을 강제하면 cap enforcement 자체가 무의미해지므로 거부 (DoS 방어 핵심)
  - 두 분기 모두 `error_body()` envelope 사용. `Retry-After` 헤더 없음 (재시도 대신 클라이언트가 body 크기 / framing 수정 필요)
- 시크릿/PII/스택트레이스 응답 포함 금지 (`scrub_text` = `scrub_pii(scrub_secrets(...))` 적용 — `backend/observability/scrub.py`)
  - **Migration note (PII Phase 1)**: 이전 버전은 `scrub_secrets` 만 사용. 현재 `scrub_text` 로 통합되어 7 secret + 5 PII 패턴 모두 envelope 에서 redact
- JSON 에러 포맷 고정: `{"error": {"code": "...", "message": "...", "details"?: ...}}` — 클라이언트 파서 계약. `error_body()` helper 가 단일 shape 보장
- `http_error(status_code, code, message, details?)` helper 로 HTTPException 생성 시 envelope 자동 래핑 (routes 에서 일관성 확보)

**SSE 응답 (core-infrastructure.md lifecycle 준수):**

- `EventSourceResponse` 사용 (sse-starlette)
- 15초 ping 으로 연결 유지 (`ping=15`)
- payload 에 동적 메타데이터 (토큰 수, 비용) 혼합 금지 — 별도 `usage` 이벤트
- 연결 drop 만으로 종료 금지 — 반드시 `done` 또는 `error` emit
- `policy.sse=false` 인 run 은 내부적으로 이벤트 스트림을 버퍼링 후 단일 JSON 응답으로 변환

**JSON 응답 (policy.sse=false 인 run 또는 동기 엔드포인트):**

- pydantic 모델 반환 (FastAPI 가 직렬화)
- 응답 스키마는 OpenAPI 에 자동 노출되어야 함 (`response_model=...` 명시)
- 대용량 바이너리는 path/URL 만 반환 (`/media/*` 참조)

**Hot reload:**

- `POST /runs/reload` 만 존재 — `runs/*.yaml` 재스캔, RunRegistry 갱신
- 진행 중인 요청은 **이전 policy 로 완료**. 새 요청부터 새 policy 적용
- provider / tool registry hot reload 는 **불가능** (prompt cache 무효화 방지)

## 새 엔드포인트 추가하기

### Case A: LLM run 추가
→ **route 코드 변경 없음**. `runs/<name>.yaml` 만 작성 (run-policy.md 참조).

### Case B: 미디어 op 추가
→ `routes/media.py` 에 라우트 1줄 + `services/media/<op>.py` (media-pipeline-patterns.md 참조).

### Case C: 새 관리 엔드포인트 (models, memory 등 유사)
1. 해당 책임의 최상위 prefix 가 이미 있는지 확인. 없으면 **사람 승인 후** 추가
2. `routes/<name>.py` 생성 — APIRouter 인스턴스 export
3. `backend/main.py` 에서 `include_router` 추가
4. 요청/응답 스키마는 `routes/schemas.py` 에 pydantic 모델 추가
5. 도메인 로직은 `services/` 또는 `engine/` 에 구현, route 는 dispatch 만
6. 인증 의존성 (`Depends(require_auth)`) + `response_model` 명시
7. OpenAPI 태그 추가 (`tags=["<domain>"]`)
8. 테스트: 정상 200, 인증 실패 401, 검증 실패 422, 리소스 없음 404

### 새 최상위 prefix 추가
→ 사람 승인 필요. 설계 문서 §6.1 라우터 구조 + §6.2 엔드포인트 표 업데이트 필수.

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 최상위 prefix 추가/변경 | 모든 클라이언트 URL, OpenAPI 스키마, 문서 |
| 인증 의존성 구현 변경 | 모든 엔드포인트의 허가 판정 |
| 에러 JSON 포맷 변경 | 프론트/B2B 클라이언트 파서 전부 |
| SSE 이벤트 타입 추가 | core-infrastructure.md lifecycle 동시 업데이트 + 클라이언트 파서 |
| 미들웨어 순서 변경 | request_id 로깅 누락, CORS 동작 변경 가능 |
| `response_model` 스키마 변경 | OpenAPI 계약 변경 → 클라이언트 코드 생성기 영향 |
| routes 에 도메인 로직 누출 | 테스트성 저하, 중복 발생, 단일 작성자 경계 침식 |

## 금지 사항

- routes 에서 provider / tool / data writer 직접 호출 (반드시 engine/services 경유)
- 같은 URL path 에 여러 라우터 중복 등록 (FastAPI 가 첫 매칭만 사용 → 혼란)
- 인증 없는 엔드포인트 추가 (health 제외)
- HTTPException 을 engine 내부에서 raise (내부는 AppError, 변환은 routes/_common.py)
- 응답에 개인정보/시크릿 포함 (scrub 필수)
- `/ai/*` 처럼 도메인 없는 중첩 prefix 재도입
- runtime 에 라우트 동적 등록/제거 (부팅 시에만)
- hot reload 시 진행 중 요청 abort (graceful)
