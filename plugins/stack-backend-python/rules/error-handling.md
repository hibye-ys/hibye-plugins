> App backend rules — Error handling invariants, extension guide, impact map.
> **정본:** `_shared/http-error-sentinels.md` (HTTP 매핑 / `error_body` envelope shape / leak-safe 404 / scrub_text — 언어 무관). 본 파일은 Python 측 4-패턴 + 4-예외 계층 적용 지점.
> 관련: `ai-provider-patterns.md` (재시도 대상 4종), `core-infrastructure.md` (SSE lifecycle),
>       `design-principles.md` (§5 에러→모델 반환)

# error-handling — 에러 처리 표준

## 불변식 (Invariants)

**4 표준 패턴 — 경계에 따라 선택, 혼합 금지:**

| 패턴 | 경계 | 동작 | 응답 |
|------|------|------|------|
| 1. 공개 API | HTTP/SSE 엔드포인트 | 내부 예외를 외부에 노출하지 않음 | SSE → error 이벤트, JSON → HTTPException |
| 2. 내부 서비스 | engine, tools, providers | typed exception raise | 호출자가 복구 판단 |
| 3. 초기화/부팅 | startup | raise + 프로세스 종료 | fail-fast |
| 4. 선택적/best-effort | 캐시, 메타데이터 | return None + WARNING 로그 | 메인 흐름 계속 |

**4 예외 유형 (모두 `backend/exceptions.py` 에 선언):**

| 예외 | 용도 | 복구 |
|------|------|------|
| `AppError` | base class | — |
| `ValidationError` | 입력/설정 형식 오류 | 클라이언트 수정 후 재시도 |
| `ConfigurationError` | 환경변수/시크릿 누락/약한 값 | 부팅/Settings 인스턴스화 시 raise (예: `AuthSettings._assert_prod_secret_strength`), 재시작 필요 |
| `ResourceError` | 리소스 미존재/접근 불가 (default HTTP 404). 특정 code `user_data_pending_deletion` 은 HTTP 410 — `data-governance-patterns.md` (7-day grace 동안 write 차단) | 재시도 가능 (일시적). `user_data_pending_deletion` 은 사용자가 cancel 안 하면 7일 후 영구 |
| `InternalError` | 내부 불변식 위반 | 재시도 무의미 (버그) |

**핵심 규칙:**
- SSE 엔드포인트 에러: `error` SSE 이벤트로 전달 (core-infrastructure.md SSE lifecycle 참조)
- 도구 에러: `ToolResult(is_error=True)` + 사람 읽기 가능 메시지 → 모델에 반환. 자동 재시도 금지 (design-principles §5)
- tool result / 에러 메시지 절단: **head-truncate** — `TOOL_PREVIEW_MAX_CHARS` (4000자, `backend/engine/stream.py`) + `[truncated, N more chars]` 마커. `summary.py`, `title.py`, `compaction.py` 도 동일 head-only 패턴
  - 한계 인식: Python traceback 의 실제 예외 메시지는 **끝줄**. head-only 로 스택 트레이스를 자르면 핵심 이유를 잃을 수 있음. 스택 트레이스 전용 head+tail 유틸은 **미래 개선** (현재 코드는 일괄 head-only)
- 예외 메시지에 시크릿/API key 포함 금지 (`observability/processors.py::scrub_log_values` 가 fail-safe)
- `except Exception:` bare catch 는 HTTP 경계에서만 허용

**Pattern 1 HTTP error code 추가 매핑 (api-routing-patterns.md 가 정본 — 여기는 sentinel 만):**
- `content_moderation_blocked` (HTTP 422) — input rejected by content moderation classifier. Route-edge `http_error()` 가 직접 raise (engine/services 가 아닌 `routes/run.py::_content_moderation_blocked_error`). 상세: `content-moderation-design.md` (= `docs/completed/superpowers/specs/2026-04-26-content-moderation-design.md`). `details.categories=[...]` 에 차단된 OpenAI omni-moderation 카테고리 명시
- `jailbreak_blocked` (HTTP 422) — input rejected by jailbreak detector (heuristic regex 또는 PromptGuard classifier). Route-edge `http_error()` 가 직접 raise (`routes/run.py::_jailbreak_blocked_error`). 상세: `jailbreak-detection-design.md` (= `docs/completed/superpowers/specs/2026-04-26-jailbreak-detection-design.md`). **NO `details` body** (R1-S8 — attacker info-disclosure protection: pattern 시그너처 또는 score 노출 시 evasion 학습 가능. detailed signal 은 structlog `jailbreak.detected` (operator-only) + `X-App-Jailbreak-Status: blocked` 헤더로만)

## 새 예외 유형 추가하기

1. `backend/exceptions.py` 에 `AppError` 를 상속하는 새 클래스 추가
2. 해당 예외가 어느 패턴(1~4)에 해당하는지 결정
3. 복구 가능성 명시 (retryable 여부)
4. 기존 코드에서 `Exception` 으로 잡고 있던 곳이 새 예외를 의도대로 처리하는지 확인
5. 테스트: raise + catch + 올바른 응답 변환

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 예외 계층 구조 변경 | 모든 catch 블록의 매칭 순서 |
| 패턴 1 응답 형식 변경 | 프론트엔드 에러 파서, SSE 클라이언트 |
| 에러 메시지 절단 크기 변경 | 모델이 받는 에러 정보량 → 복구 판단 품질 |
| 새 retryable 에러 추가 | ai-provider-patterns.md 의 재시도 로직에 분기 추가 |
| fail-fast 대상 확대 | 부팅 실패 빈도 증가 → 운영 영향 |

## 금지 사항

- `except:` (bare except — 시그널까지 먹음)
- `except Exception: pass` (HTTP 경계 외)
- 에러를 `print` 로 출력하고 버리기
- raise 없이 조용히 `return` (특히 async generator 내부)
- 예외에 사용자 시크릿 포함
