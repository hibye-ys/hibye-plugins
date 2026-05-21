> App backend rules — Architecture invariants, extension guide, impact map.
> **정본:** `_shared/iyaki-domain-boundary.md` (스키마 분리 + 3 쓰기 조건 — 언어 무관),
>           `_shared/input-safety-gate-ordering.md` (V3 ordering / two-port jailbreak / orthogonal moderation — 언어 무관). 본 파일은 Python 측 import 방향 적용만.
> 관련: `design-principles.md` (전체), `core-infrastructure.md` (타입 경계),
>       `data-layer-patterns.md` (단일 작성자 상세), `database-patterns.md` (StoragePort + iyaki 경계)

# architecture — 계층 구조 + import 방향

## 불변식 (Invariants)

**계층 단방향 import:**

```
routes/run   → engine (loop) → services → providers / tools / state / data / db
                    ↘              ↗
                      runs/*.yaml (RunPolicy + prompts)

routes/media  → services/media  → providers (미디어 SDK) / tools(선택) / data / db
routes/skills → services/skills → state/user_skill (InMemory) or state/db_user_skill (DB) → data/writer (본문 파일)
routes/run    → services/moderation (Port 호출, 게이트만)  → 외부 OpenAI moderation SDK
routes/run    → services/jailbreak (TWO Port 호출 — heuristic + classifier) → in-process regex / PromptGuard 2 (lazy transformers)

lsp → engine / tools (역방향 금지)
middleware → routes._common / observability (HTTP 외곽)
tests → (모든 계층)
```

| 허용 | 금지 |
|------|------|
| routes → engine / services | routes → providers / tools / data writer 직접 |
| engine → services / providers / tools / state / data / db | providers → engine / routes (역방향) |
| services/media → providers / tools / data / db | services/media → engine/loop (원칙적 금지: LLM 필요 시 `/run/<name>`) |
| tools → data / db / observability / utils | tools → engine / routes (역방향) |
| lsp → engine / tools | engine → lsp (역방향) |
| middleware → routes._common / observability | middleware → engine / services / tools |
| mcp_server → tools / db / observability / utils | mcp_server → engine / routes (edge adapter cross-import 금지) |

- 순환 import 가 필요해 보이면 구조가 잘못된 신호 → 리팩터
- 계층 간 공유 타입은 낮은 쪽에 배치 (`engine/types.py`)

**Cross-cutting concerns (예외: 모든 계층에서 import 허용):**

| 모듈 | 역할 | 허용 이유 |
|------|------|-----------|
| `backend/observability/` | structlog 설정, ContextVar 필드, scrub, sinks | 로깅은 모든 계층에서 필요. 다만 `observability/errors.py` 만 `exceptions` 을 import (단방향) |
| `backend/exceptions.py` | AppError 계층 루트 | 예외 타입은 어디서나 raise/catch |
| `backend/constants.py` | `ANONYMOUS_USER_ID` 등 상수 | 순수 상수, 의존 없음 |
| `backend/utils/` | `env.py`, `ids.py`, `time.py` | 순수 유틸, backend 의존 없음 |
| `backend/settings_base.py` | pydantic BaseSettings 베이스 | 설정 공통 |

**Leaf modules (의존 없음, 자유롭게 import):**

위의 cross-cutting 모듈들은 backend 의 다른 어떤 모듈도 import 하지 않는다.
이 규칙이 깨지면 순환 의존 가능성 발생.

**단일 작성자 패턴 (Single Writer):**

- 동일 자원의 쓰기 경로는 1개로 제한 — `data/writer.py` 만 `data/media/**` 쓰기 + `data/skills/user/**` 쓰기
- 세션 쓰기는 `state/session.py` (InMemory) 또는 `state/db_session.py` (DB) — 호출자는 `SessionPort` Protocol 만 참조
- 유저 custom skill 본문 쓰기는 `WriteCoordinator.write_user_skill` / `delete_user_skill` 단일 경로. 경로 레이아웃은 `WriteCoordinator.user_skill_relpath` staticmethod 단일 source — DB / InMemory store 양쪽이 같은 helper 참조 (`user-skill-patterns.md`)
- 읽기 경로는 복수 허용
- 이유: 경쟁 조건 단일 지점 처리, audit trail 집중, 저장 백엔드 교체 용이
- 상세: `data-layer-patterns.md`, `user-skill-patterns.md`

**iyaki 도메인 경계:**

> **정본:** `_shared/iyaki-domain-boundary.md` (스키마 분리 / 3 쓰기 조건 / project lifecycle 예외 /
> 마이그레이션 격리 / DSN 분리 — 언어 무관). 본 섹션은 Python 측 적용 지점만.

- 접근 pool 위치: `backend/tools/_iyaki_db.py` (전용 asyncpg pool)
- project lifecycle 예외 시 audit 로깅: `structlog.info("<tool_name>", ...)` (Python)
- 마이그레이션 격리: Alembic `env.py` 의 `include_object` 필터로 `schema='ai_backend'` 만 허용
- 상세: `database-patterns.md`

**StoragePort Protocol 추상화:**

- 저장소 의존 컴포넌트는 Protocol 만 참조 (`SessionPort`, `SessionHistoryPort`, `MediaJobPort`, `UserSkillPort`)
- 구체 클래스 (`InMemorySessionStore`, `DbSessionStore`, `FileMediaJob`, `DbMediaJob`, `InMemoryUserSkillStore`, `DbUserSkillStore`) 은 `main.py` lifespan DI wiring 에서만 import 허용
- 같은 패턴이 입력측 안전 게이트에도 적용: `ModerationPort` (`backend/services/moderation/port.py`) — 구현체는 `OpenAIModerationProvider` / `NoopModerationProvider`, 라우트는 Protocol 만 참조 (`run-policy.md` §ModerationPolicy)
- 입력측 jailbreak 게이트도 동일 패턴 + **two-port 분리**: `JailbreakPort` (`backend/services/jailbreak/port.py`) — `app.state.jailbreak_heuristic_port` (`HeuristicJailbreakProvider` / `NoopJailbreakProvider`) + `app.state.jailbreak_classifier_port` (`PromptGuardJailbreakProvider` / `NoopJailbreakProvider`) 두 별도 lifespan-wired port. 라우트는 Protocol 만 참조 (R1-B1 — 단일 `_MultiJailbreakProvider` wrapper 금지). `services/moderation/` 와 cross-import 금지 — 두 layer 는 직교 (`run-policy.md` §JailbreakPolicy)
- 이유: 파일/인메모리 ↔ DB 전환 시 호출자 코드 0줄 수정 (Phase 2 Llama Guard self-host 전환 시도 동일)
- 상세: `database-patterns.md`, `data-layer-patterns.md`, `user-skill-patterns.md`

**`data/` vs `db/` 분리:**

| 계층 | 저장 매체 | 관리 대상 |
|------|-----------|-----------|
| `backend/data/` | 파일 시스템 | 미디어 바이너리 + job state JSON + 유저 커스텀 skill 본문 markdown |
| `backend/db/` | Postgres (SQLAlchemy ORM) | 세션, 메시지, media job state, user_skills 메타, iyaki_mutations 감사 |

- `data/` 는 `db/` 를 import 안 함 (파일 시스템은 DB 독립)
- `db/` 는 `data/` 를 import 안 함 (ORM 자체 완결)
- 호출자 (state/, services/media/) 가 둘 중 선택 or Port Protocol 경유

**위반 안티패턴:**

- provider 가 engine 을 import (아래→위)
- routes 가 provider 직접 호출 (engine 우회)
- tool 이 `data/writer.py` 우회하여 `data/media/**` 직접 파일 쓰기
- 호출자 코드가 `DbSessionStore` / `FileMediaJob` 같은 concrete 구현체 import (Port Protocol 만 참조)
- `public.*` (iyaki) UPDATE/INSERT 시 `lock_project` 또는 `iyaki_mutations` 감사 생략
- cross-cutting 모듈 (`observability`, `utils`, `constants`) 이 backend 의 다른 모듈 import — 순환 위험

## 새 모듈 추가하기

1. **계층 결정**: 이 모듈이 routes / middleware / engine / services / providers / tools / agents / state / data / db / lsp / observability / utils 중 어디에 속하는지 결정
2. **import 방향 확인**: 그 계층에서 import 가능한 계층만 의존
3. **파일 배치**: `backend/{layer}/{module}.py`
4. **타입 위치**: 해당 모듈에서만 쓰는 타입은 같은 파일, 공유 타입은 `engine/types.py`
5. **쓰기 경로**: 파일/상태 쓰기가 필요하면 기존 writer 경유, 새 writer 필요 시 단일 작성자 원칙 적용
6. **cross-cutting 후보 판단**: 만약 여러 계층에서 참조 필요하면 leaf module (의존 0) 로 설계
7. **테스트**: `tests/test_{module}.py` 생성

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 계층 간 import 방향 변경 | 순환 의존 위험 → 전체 구조 검토 필요 |
| 새 계층 추가 | import 방향 테이블 + `cross-cutting` 규칙 업데이트 + 본 rule 의 허용/금지 표 |
| 단일 작성자 우회 | 경쟁 조건 발생, audit trail 누락, 마이그 어려움 |
| `engine/types.py` 에 타입 추가 | 해당 타입을 사용하는 모든 계층에 영향 |
| `agents/` 구조 변경 | loader.py + 모든 YAML 파일 + prompts/ |
| `observability/` 가 backend 의 다른 모듈 import | 순환 위험 — 로깅 체인 무한 루프 가능 |
| `middleware/` 가 engine/services/tools import | HTTP 외곽 경계 침식, 테스트 격리 깨짐 |
| `data/` 와 `db/` 상호 import 허용 | 저장 매체 분리 원칙 깨짐 — 하나 교체 시 다른 쪽 영향 |
| Port Protocol 시그니처 변경 | 모든 구현체 + main.py 의 DI wiring + 테스트 mock |

## 금지 사항

- 상위 계층을 하위 계층이 import (providers → engine, engine → routes, lsp → routes 등 역방향)
- 단일 작성자 우회: `data/writer.py` 없이 `data/media/**` 직접 write
- 순환 import — `TYPE_CHECKING` 뒤에 숨겨도 runtime 사용 시 위반
- routes 에서 provider / tool / data writer 직접 호출 (반드시 engine / services 경유)
- 같은 계층 내 cross-import 로 경계를 흐리기 (예: providers 내부에서 다른 provider 의 private 심볼 참조)
- `engine/types.py` 에 계층별 전용 타입 배치 (공유되지 않는 타입은 해당 계층 파일에)
- backend 외부 코드가 backend 의 private 심볼 (`_` prefix) 에 접근
- `observability`, `utils`, `constants`, `settings_base`, `exceptions` 가 backend 의 다른 모듈 import (leaf 원칙)
- `middleware` 가 engine / services / tools / data 를 import (HTTP 외곽 경계)
- `data/` 와 `db/` 의 상호 import (저장 매체 분리)
- Port Protocol 우회한 concrete 구현체 직접 참조 (main.py 의 lifespan DI 제외)
