> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/api-routing-patterns.md` + live implementation under `backend/routes/` + `backend/main.py` middleware.

# Subsystem 11 — Routes / API

## 목적 (1줄)

FastAPI 라우터 전체. `POST /run/<name>` 기반 SSE 진입점 + `/media/*` 비동기 job + 세션/health/debug 관리 엔드포인트.

## 현재 활성 HTTP 경로 (6 HTTP router + LSP daemon thread 별도)

- `backend/main.py::include_router` 가 mount 하는 FastAPI router: **6종** (`/health`, `/run`, `/runs`, `/sessions`, `/media`, `/debug`). `/debug` 는 `APP_DEBUG_ROUTES_ENABLED=true` 일 때만 조건부 mount.
- LSP 는 `include_router` 대상 **아님** — `backend/lsp/host.py` 가 별도 daemon thread 로 pygls transport 를 띄움.

| Prefix | 인증 | 설명 |
|--------|-----|------|
| `/health` | 없음 | 헬스체크 (유일한 no-auth 경로) |
| `/run` | `require_auth` | `POST /run/<name>` 실행 — SSE 또는 JSON 응답 (RunPolicy.sse 에 따라) |
| `/runs` (GET) | `require_auth` | `GET /runs` 등록 run 조회 (일반 auth) |
| `/runs/reload` (POST) | `require_auth` + `runs:admin` | hot reload — scope 없으면 **leak-safe 404** |
| `/sessions` | `require_auth` | 세션 CRUD / cancel / 사이드바 listing |
| `/media` | `require_auth` | `POST /media/<category>/<op>`, `GET /media/jobs/<id>`, `DELETE /media/jobs/<id>` |
| `/debug` | `require_auth` + `debug:read` + 조건부 mount (`APP_DEBUG_ROUTES_ENABLED`) | 운영 관측 (provider/mcp/tools 등) |
| LSP daemon | 자체 transport | **FastAPI 라우트 아님** — `backend/lsp/host.py` 가 별도 daemon thread (pygls WebSocket/stdio). 일반적인 `include_router` 와 분리 |

## 파일 / 모듈

- `backend/main.py` — FastAPI 앱, 라우터 등록, lifespan, 미들웨어 스택 (CORS → BodySizeLimit → RateLimit → TraceContext → RequestId)
- `backend/routes/_common.py` — `require_auth`, `caller_identity`, `http_error`, `not_found`, `error_body` 공통 helpers
- `backend/routes/schemas.py` — HTTP 경계 pydantic 모델 (`RunRequest`, `RunListResponse`, `HealthResponse` 등)
- `backend/routes/health.py` — `/health` 엔드포인트
- `backend/routes/run.py` — `APIRouter(prefix="/run")`. `POST /run/<name>` dispatch → `RunPolicy` 로드 후 6-stage loop 실행. SSE 이면 `EventSourceResponse`, 아니면 JSON.
- `backend/routes/runs.py` — `APIRouter(prefix="/runs")`. `GET /runs` (list) + `POST /runs/reload` (runs:admin scope 필수, leak-safe 404)
- `backend/routes/sessions.py` — 세션 관련 엔드포인트. 소유권 불일치 → leak-safe 404
- `backend/routes/media.py` — media 파이프라인 엔드포인트. 카테고리 frozenset (`image`, `audio`, `video`)
- `backend/routes/debug.py` — 조건부 mount. 운영/개발 관측 (예: `GET /debug/tools/mcp` 으로 MCP 서버 ConnectionState 조회)

## 주요 엔드포인트 (자주 쓰는 것)

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/health` | 기본 헬스 (200/OK) |
| `POST` | `/run/<name>` | RunPolicy 기반 실행 — body `RunRequest` (`{message, session_id?}`), SSE 또는 JSON |
| `GET` | `/runs` | 등록된 run 목록 (name, sse, max_turns, model_preference) |
| `POST` | `/runs/reload` | `runs/*.yaml` 재스캔 (runs:admin) |
| `GET` | `/sessions` | 사이드바 listing |
| `GET/DELETE` | `/sessions/{id}` | 세션 조회/종료 |
| `POST` | `/media/<category>/<op>` | 202 + `{job_id, poll_url}` |
| `GET` | `/media/jobs/<id>` | `MediaJob` 전체 상태 |
| `DELETE` | `/media/jobs/<id>` | best-effort cancel |
| `GET` | `/debug/tools/mcp` | MCP 서버별 `ConnectionState` (debug mount 활성 시) |

## 담당 skill / rule

- **rule**: `.agents/rules/python_agent_rules/api-routing-patterns.md` (thin-layer + prefix 규약 + 인증 + 에러 변환)
- **rule**: `.agents/rules/python_agent_rules/run-policy.md` (`/run/<name>` RunPolicy 스키마)
- **rule**: `.agents/rules/python_agent_rules/media-pipeline-patterns.md` (`/media/*` 엔드포인트 + job 라이프사이클)
- `api-audit` skill — thin-layer + RunPolicy + OpenAPI drift 검증

## 인증 / 에러 변환 핵심

- JWT 또는 API 키 (`lf_<kid>_<secret>`) 둘 다 `Depends(require_auth)` 단일 의존성. 결과 dict `{user_id, scopes, method}` 를 핸들러 인자로 전달
- `/health` 외 전부 인증 필수. Anonymous 폴백은 `APP_AUTH_REQUIRED=false` 또는 `app_env != prod` 에서만 허용
- 리소스 소유권 불일치 → **leak-safe 404** (403 금지) — 존재 여부 유출 방지
- `AppError` → `backend/main.py` 의 글로벌 exception handler 가 `error_body(code, message, details?)` envelope 로 변환. 시크릿은 `scrub_secrets` 경유
- Rate limit (429) 는 `RateLimitMiddleware` 가 직접 변환 — `Retry-After` 헤더 + `retry_after_ms` body

## CORS `expose_headers` (프론트엔드 계약)

`main.py:436` `expose_headers=[...]` — 4종:

- `X-App-Session-Id` — session sticky
- `X-App-Agent` — 현재 dispatch 된 run 이름
- `X-App-Model` — 해석된 모델
- `X-Request-Id` — 디버깅 correlation

## 범위

- 위 현재 활성 경로 (6 HTTP router — `/health`, `/run`, `/runs`, `/sessions`, `/media`, `/debug` 조건부 + LSP daemon thread 별도) 유지
- 새 최상위 prefix 추가는 사람 승인 필수 (api-routing-patterns.md §최상위 prefix 규약)

## Gotchas

- **라우터 등록 순서**: 구체 경로가 변수 경로보다 먼저여야 함. `/run/<name>` 은 catch-all 아님
- **`/debug/*` 조건부 mount**: `APP_DEBUG_ROUTES_ENABLED=true` 이어야 mount. 미활성 환경에서 `/debug/tools/mcp` 는 404
- **SSE**: `sse_starlette.EventSourceResponse` + `ping=15`. `StreamingResponse` 직접 사용 시 keepalive / X-Accel / disconnect 감지 수동 구현 필수
- **LSP 는 라우터가 아님**: `backend/lsp/host.py` 의 daemon thread (pygls 기반). `include_router` 호출 없음 — 별도 transport
- **구현 없는 엔드포인트**: `/ai/memory/*`, `/ai/admin/*`, `/ai/mcp/*`, `/ai/agents/*`, `/ai/models/*`, `/ai/tools/*` 같은 과거 계획 경로는 **현재 미구현**. 과거 문서에 남아있는 경우 drift 제거 대상

## 관련 rule / 계약

- `api-routing-patterns.md` — thin-layer + 인증 + 에러 변환 + CORS expose_headers
- `run-policy.md` — `/run/<name>` body/response 계약
- `media-pipeline-patterns.md` — `/media/*` job 계약
- `sse-streaming-patterns.md` — SSE wire format + keepalive + scrub_secrets
