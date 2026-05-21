> App backend rules — Python coding standards.
> 관련: `error-handling.md` (예외 처리), `config-management.md` (설정/시크릿)

# coding-standards — Python 공통 코딩 규약

## 불변식 (Invariants)

**네이밍 (PEP 8):**

| 대상 | 규칙 | 예시 |
|------|------|------|
| 모듈/패키지 | snake_case | `agent_loop.py` |
| 함수/변수 | snake_case | `run_tool` |
| 클래스/Protocol | PascalCase | `ToolProtocol` |
| 상수 | UPPER_SNAKE | `MAX_TOKENS` |
| private | prefix `_` | `_normalize` |
| 테스트 | `test_<module>.py` | `test_loop.py` |

**타입 힌트 (Python 3.14+, pydantic v2):**

- 모든 public 함수는 완전한 타입 힌트 필수. 내부 함수도 최소 반환 타입 명시
- `Any` 는 경계 포인트(외부 SDK)에서만 허용. 내부 전파 금지
- pydantic v2 `BaseModel` 내부 데이터 구조 기본. `dataclass` 는 hot-path 에만
- `typing.Protocol` + `@runtime_checkable` 로 DI (ABC 보다 우선)

**비동기 (asyncio):**

- I/O 함수는 `async def`. 순수 연산은 `def` — 불필요한 async 전염 금지
- Provider/tool 호출은 반드시 await. 병렬은 `asyncio.gather`
- blocking 함수는 `asyncio.to_thread` 로 감쌈
- 스트림은 `AsyncIterator[T]` + `yield`

**로깅 (structlog + contextvars):**

- 구조화 로깅: `logger.info("tool_ran", tool=name, ms=elapsed)` — key=value 포맷
- 민감 정보 로깅 절대 금지 (secret, API key, PII) — `scrub_log_values` processor 가 fail-safe 로 차단 (알려진 패턴만)
- ContextVar 10 필드 (`ALL_FIELDS`) 는 `core-infrastructure.md` §ContextVar 로깅 이 정본. `request_id` + `spawn_depth` 는 항상 bound, 나머지는 조건부. bind/unbind 는 `backend.observability.bind_log_context` / `clear_log_context` 경유 — 화이트리스트 외 키는 `ValueError`
- 레벨: DEBUG(개발) / INFO(정상) / WARNING(복구 가능) / ERROR(실패) / CRITICAL(프로세스 위험). `log_level` 은 `Literal` — 오타 시 startup fail

**원칙:**

- **SRP** — 한 클래스/모듈은 변경 이유 1개
- **OCP** — 확장 열림, 수정 닫힘 (새 Tool 은 Protocol 구현)
- **DRY** — 같은 로직 2회 이상 → 유틸 추출. 우연한 중복은 제외
- **KISS** — 1단계 함수 체인 > 3단계 추상화
- **YAGNI** — 지금 필요 없는 유연성 금지

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| Python 버전 변경 | 타입 힌트 문법, 사용 가능 stdlib 기능 |
| pydantic v2 → v3 | 모든 BaseModel 서브클래스 + 검증 로직 |
| structlog 설정 변경 | 모든 로그 출력 형식, contextvars 바인딩 |
| async/sync 경계 변경 | 호출자 전체의 async/await 체인 |

## 금지 사항

- `print()` 프로덕션 코드에 남기기
- `from x import *`
- global mutable state
- `except Exception:` 으로 삼키기 (HTTP 경계 외)
- blocking I/O 를 async 내부에서 await 없이 호출
- 하드코드 경로 — `pathlib.Path` + 설정 주입
