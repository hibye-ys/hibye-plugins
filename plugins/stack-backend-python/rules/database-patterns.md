---
paths:
  - "backend/db/**"
  - "backend/tools/_<domain>_db.py"
  - "backend/tools/<domain>_*.py"
  - "backend/state/db_*.py"
---

> App backend rules — Database + StoragePort patterns (SQLAlchemy 2.0 async + Postgres primary, SQLite fallback for isolated smoke tests).
> 관련: `architecture.md` (단일 작성자, StoragePort, 외부 도메인 경계), `data-layer-patterns.md` (파일 기반 writer),
>       `config-management.md` (DATABASE_URL), `error-handling.md` (4 패턴)

# database-patterns — DB + StoragePort 규약

## 현재 상태

저장소 구성:

| 대상 | 위치 | 방식 |
|------|------|------|
| 도메인 엔티티 (entity/block/note/episode/…) | **외부 application 웹서비스 (예: `<domain>`) 의 `public.*` 스키마** (동일 Postgres 인스턴스) | AI 백엔드가 소유 안 함 (외부 도메인 경계). 접근은 `backend/tools/_<domain>_db.py` 전용 pool + `<domain>_*` 도구. 쓰기 시 `ai_backend.<domain>_mutations` 감사 append 필수 |
| 도메인 쓰기 감사 | `ai_backend.<domain>_mutations` (AI 소유 스키마) | `<domain>_mutate.py` 의 도구들이 raw SQL (`INSERT INTO ai_backend.<domain>_mutations`) 로 트랜잭션 내부 append. ORM 모델 **없음** — 테이블 스키마는 Alembic migration 에서 직접 관리 |
| 세션 identity/counters | 인메모리 OrderedDict 또는 DB | `SessionPort` (InMemory or Db) |
| 세션 메시지 이력 | 인메모리 deque 또는 DB | `SessionHistoryPort` (InMemory or Db) |
| Media jobs (state) | `backend/data/media/jobs/<id>.json` 또는 DB | `MediaJobPort` (File or Db) |
| Media 바이너리 | `backend/data/media/<id>/<file>` | 항상 파일 (`WriteCoordinator.write_media_output`). 삭제 → `WriteCoordinator.delete_media_artifacts` (governance hard delete) |
| User custom skill 본문 | `backend/data/skills/user/<user_id>/<skill_id>.md` | `WriteCoordinator.write_user_skill` / `delete_user_skill` (단일 writer) |
| 감사 로그 (governance + future auth/admin) | `ai_backend.audit_log` (`AuditLogRow` ORM) | append-only (Postgres trigger + 앱 규율). 7년 보존. `services/audit/log.py::emit_audit_event` 단일 진입점. 6 governance event taxonomy 고정 |
| Governance jobs (export + delete) | `ai_backend.governance_jobs` (`GovernanceJobRow` ORM) | `DbGovernanceJob` Port — DB only (audit-grade). media job pattern (capacity cap, SKIP LOCKED dequeue, claim-guarded writers). 부분 unique index on `(user_id, op) WHERE status IN (queued, running)` 으로 idempotency |
| Run registry | `backend/engine/run_registry.py` | 부팅 시 YAML 로드 → 인메모리 |

**구현체 선택은 부팅 시 config (`APP_DB_ENABLED`) 기준.** **기본값 `True`** — Postgres primary. `False` 는 DB 인프라 없이 부팅해야 하는 isolated smoke 테스트 전용 (파일/인메모리 구현체로 fallback). 호출자는 Port 타입만 참조 (StoragePort 추상화).

---

## 스택 (current)

| 레이어 | 선택 | 메모 |
|--------|------|------|
| DB 엔진 | **PostgreSQL 17+ (primary)** / SQLite (aiosqlite, fallback) | `resolved_url()` 이 `APP_DATABASE_URL` 있으면 Postgres, 없으면 `sqlite+aiosqlite:///<data_dir>/app.db` |
| 드라이버 | **asyncpg** (Postgres) 또는 aiosqlite (SQLite fallback) | 모두 async |
| ORM | **SQLAlchemy 2.0 async** | `backend/db/base.py` 의 `Base = DeclarativeBase` |
| 마이그레이션 | **Alembic** | `backend/db/migrations/` (+ `backend/db/alembic.ini`) |
| 세션/연결 | `session_scope()` async context manager per operation. uvicorn worker 당 1 engine + `async_sessionmaker` 싱글턴 | `backend/db/engine.py`, `backend/db/lifespan.py` |
| UPSERT | `backend/db/upsert.py` — SQLite/Postgres 방언 분기 | `INSERT ... ON CONFLICT` |
| 세션 캐시 | DB 테이블 1순위. Redis 는 병목 확인 후 추가 | 단일 엔진 원칙 |

**파일 레이아웃:**

```
backend/db/
  base.py                    # DeclarativeBase
  config.py                  # DatabaseSettings (db_enabled default True)
  engine.py                  # async_sessionmaker + engine factory + session_scope
  lifespan.py                # startup/shutdown hooks
  upsert.py                  # 방언별 UPSERT helper
  alembic.ini                # Alembic config (script_location = migrations/)
  models/
    session.py               # SessionORM
    session_message.py       # SessionMessageORM
    media_job.py             # MediaJobORM
  migrations/                # Alembic revisions (<domain>_mutations 테이블도 여기서 생성)
```

---

## 불변식 (Invariants)

**StoragePort 3종 (`backend/data/ports.py`):**

| Port | 역할 |
|------|------|
| `SessionPort` | identity (`ensure_session`) + counters (`record_turn`) + 메타 (display_label, usage) |
| `SessionHistoryPort` | 메시지 이력 (`get_messages` / `append_messages` / `clear`) — identity 와 분리 |
| `MediaJobPort` | job state CRUD + 큐 디스패치 (`create_if_capacity` / `dequeue` SKIP LOCKED / claim-guarded terminal writes / `reset_stale_leases`). 바이너리는 Port 비대상 (single writer 로 파일 직접). 상세 큐 패턴은 `media-pipeline-patterns.md` |

> AI 백엔드 자체 유저 데이터 (예: AI 세션 선호도, cost alerts) 가 필요해지면 **그 요구사항 전용 Port + ORM** 을 `ai_backend.*` 스키마에 새로 추가한다 (YAGNI). 외부 도메인 데이터 (character / block / note 등) 는 `public.*` 소유 — 복제 금지.

**Port 시그니처 (스냅샷 — 코드가 정본):**

```python
@runtime_checkable
class SessionPort(Protocol):
    async def get(self, session_id: str) -> SessionRecord | None: ...
    async def ensure_session(self, identity: SessionIdentity) -> SessionRecord: ...
    async def record_turn(self, session_id: str, *, user_id: str = ANONYMOUS_USER_ID) -> SessionRecord: ...
    async def list_for_user(self, user_id: str, *, limit: int = 50) -> list[SessionRecord]: ...
    async def set_display_label(self, session_id: str, label: str) -> SessionRecord | None: ...
    async def delete(self, session_id: str) -> None: ...
    async def add_usage(
        self, session_id: str, *,
        model: str, input_tokens: int, output_tokens: int,
        cache_read_input_tokens: int, cache_creation_input_tokens: int,
        web_search_requests: int, cost_usd: float,
    ) -> SessionRecord | None: ...

@runtime_checkable
class SessionHistoryPort(Protocol):
    async def get_messages(self, session_id: str, *, limit: int | None = None) -> list[Message]: ...
    async def append_messages(self, session_id: str, messages: list[Message]) -> None: ...
    async def clear(self, session_id: str) -> None: ...

@runtime_checkable
class MediaJobPort(Protocol):
    # Read
    async def get(self, job_id: str) -> MediaJob: ...
    async def try_get(self, job_id: str) -> MediaJob | None: ...
    async def count_queued(self, *, category: str) -> int: ...
    async def soonest_retry(self, *, category: str) -> datetime | None: ...

    # Atomic enqueue (cap check + insert under per-category advisory lock)
    async def create_if_capacity(
        self, op: str, request: Mapping[str, object], *,
        category: str, cap: int, user_id: str | None = None,
    ) -> MediaJob | None: ...

    # Worker claim (SKIP LOCKED + claim-time attempt_count increment)
    async def dequeue(self, *, category: str, worker_id: str) -> MediaJob | None: ...

    # Claim-guarded terminal writes (`WHERE worker_id=:w AND claim_attempt=:ca`)
    async def schedule_retry(
        self, job_id: str, *, worker_id: str, claim_attempt: int,
        next_retry_at: datetime, error: Mapping[str, object],
    ) -> bool: ...
    async def mark_dlq(
        self, job_id: str, *, worker_id: str, claim_attempt: int,
        error: Mapping[str, object],
    ) -> bool: ...
    async def mark_completed(
        self, job_id: str, *, worker_id: str, claim_attempt: int,
        result_path: str, result_metadata: Mapping[str, object],
    ) -> bool: ...
    async def update_progress(
        self, job_id: str, *, worker_id: str, claim_attempt: int, progress: float,
    ) -> bool: ...

    # Cancellation (conditional UPDATE — terminal-state safe)
    async def cancel(self, job_id: str) -> bool: ...

    # Lease reaper (claimed_at < cutoff OR NULL → queued)
    async def reset_stale_leases(self, *, cutoff: datetime) -> int: ...
```

> **드리프트 메모**: 구버전 `create()` / `update_status()` 메서드는 2026-04-25 media queue hardening 에서 제거됨. 신규 코드는 `create_if_capacity` + 4 종 claim-guarded writer 만 사용한다.

구현체 테이블:

| Port | In-Memory / File 구현체 | DB 구현체 |
|------|------------------------|-----------|
| `SessionPort` | `InMemorySessionStore` (backend/state/session.py) | `DbSessionStore` (backend/state/db_session.py) |
| `SessionHistoryPort` | `InMemorySessionHistory` (backend/state/session.py) | `DbSessionHistory` (backend/state/db_session.py) |
| `MediaJobPort` | `FileMediaJob` (backend/services/media/file_store.py) | `DbMediaJob` (backend/services/media/db_store.py) |

**트랜잭션 / 일관성:**

- 모든 DB 접근은 `session_scope()` async context manager 경유 (`backend/db/engine.py::session_scope`). 이 블록이 commit (정상) 또는 rollback (예외) 을 보장 — 호출자가 `session.commit()` 직접 호출할 필요 없음. FastAPI dependency 로 `AsyncSession` 을 주입하는 패턴은 **현재 사용 안 함** — 순수 context manager 스코프만 사용
- Write 는 반드시 `session_scope()` 블록 내부 (raw SQL 이든 ORM 이든)
- Long-running 트랜잭션 금지 — 스트리밍/loop 중 open 유지 시 DB 잠금
- UPSERT 는 `backend/db/upsert.py` 의 dialect-aware helper 경유 (SQLite vs Postgres 방언 차이)
- 타임존: UTC 고정. `datetime(tz=UTC)` 만 저장

**Postgres advisory lock 사용처 (`pg_advisory_xact_lock`):**

| 도메인 | namespace key | 목적 |
|--------|---------------|------|
| 외부 도메인 쓰기 | `lock_project(project_id)` (SHA-256("<domain>:project:<id>") 앞 8바이트, 식별자 = 이 instance 의 reference) | 프로젝트 단위 직렬화 — 외부 application 사용자 쓰기와 interleave 방지 |
| Media queue 큐 깊이 캡 | `hashtext('media_jobs_cap:<category>')` (`db_store.py::create_if_capacity`) | category 별 cap 체크 + insert TOCTOU 방지 (race-safe 429 변환) |

- SQLite fallback 환경에서는 advisory lock 미지원 — 엔진 레벨 write serialization 으로 자동 처리되므로 dialect 분기 필요
- 새 advisory lock 도입 시 **namespace 충돌 회피** 위해 위 표에 등록 후 `hashtext('<scope>:<key>')` 패턴 준수

**단일 작성자 준수:**

- DB 쓰기도 Port 경유 — 호출자가 `AsyncSession.execute` 직접 호출 금지
- 세션 identity/counter update 는 `SessionPort.*`, 메시지 이력은 `SessionHistoryPort.append_messages`, media job state 는 `MediaJobPort.*` 로만
- Media 바이너리는 여전히 `WriteCoordinator.write_media_output` (파일 경로)

**config (DatabaseSettings):**

- `APP_DB_ENABLED: bool = True` — 기본값 True (Postgres primary). False 는 smoke 테스트 opt-out 전용
- `APP_DATABASE_URL: str | None = None` — SQLAlchemy URL (예: `postgresql+asyncpg://user:pass@host:5432/db`). 미지정 시 `sqlite+aiosqlite:///<data_dir>/app.db` 로 fallback (`DatabaseSettings.resolved_url()` 참조)
- `APP_DATA_DIR: Path = ./backend/data` — 파일 기반 구현체의 루트 + SQLite fallback 파일 경로
- `APP_DB_SCHEMA: str | None = None` — Postgres 에서 스키마 네임스페이스 (예: `ai_backend`). SQLite 에서는 무시
- **prod 에서 약한 값 거부**: `auth._assert_prod_secret_strength` 와 동일 fail-fast 패턴 (향후)

**도메인 데이터 — 외부 application 웹서비스 (외부 도메인 경계, 이 instance 의 사례 = `<domain>`):**

> **정본:** `_shared/external-domain-boundary.md` (스키마 분리 / 3 쓰기 조건 / project lifecycle 예외 /
> 마이그레이션 격리 / DSN 분리 — 언어 무관). 본 섹션은 Python 구현 세부 (asyncpg pool / Alembic
> include_object 필터) 만 추가.

- AI 백엔드는 도메인 엔티티 테이블을 **소유하지 않는다**. ground truth 는 외부 application 웹서비스 (예: `<domain>`) 의 `public.*` 스키마. 동일 Postgres 인스턴스를 공유하되 스키마는 `ai_backend` / `public` 으로 분리 (`APP_DB_SCHEMA=ai_backend`)
- 접근 경로: `backend/tools/_<domain>_db.py` 의 전용 asyncpg pool (식별자 = 이 instance 의 reference). **DSN 은 `<DOMAIN>_DATABASE_URL` env 전용 — 누락 시 `RuntimeError("<DOMAIN>_DATABASE_URL is not set")` 로 즉시 실패** (`_<domain>_db.py:96-98`). `APP_DATABASE_URL` fallback 없음 (`.env.example` 에 별도 DSN 항목 유지). SQLAlchemy 엔진과 분리된 별도 asyncpg pool 을 사용하는 이유: (1) 외부 도메인이 SQLAlchemy ORM 이 아닌 raw SQL 중심, (2) advisory lock / jsonb codec 등 asyncpg 고유 기능 필요
- 직접 SELECT 허용, UPDATE/INSERT 허용 **단 조건** (도메인 row 변경 — entity / block / episode / category / graph_edge 등 `project_id` FK 보유 row):
  1. `lock_project(project_id)` advisory lock 내부 (`pg_advisory_xact_lock(bigint)` — lock key 는 SHA-256("<domain>:project:<id>") 앞 8바이트)
  2. 동일 트랜잭션에 `ai_backend.<domain>_mutations` prev/new append (raw SQL `INSERT`, ORM 모델 없음)
  3. `ToolResult.metadata["resource_updated"]` 로 클라이언트 캐시 무효화 신호 전달
- **예외 — project lifecycle 메타 작업** (`public.project` row 자체의 생성, `public.app_state` 의 active_project_id key UPSERT):
  위 3조건 비적용. project_id 가 아직 없거나 (create) 글로벌 key (switch) 라 `lock_project` 적용 불가능.
  audit 는 `<domain>_mutations` 가 아니라 `structlog.info("<tool_name>", ...)` 로 대체.
  적용 도구: `<domain>_create_project`, `<domain>_switch_project` (V0 신규)
- Alembic autogenerate 는 `public.*` 를 건드리면 안 됨. `env.py` 의 `include_object` 로 `schema='ai_backend'` 만 허용
- AI 백엔드 자체 확장 데이터 (AI 세션 선호도, cost alerts 등) 는 `ai_backend.*` 스키마에 새 ORM + Port 추가. 외부 도메인 테이블 복제 금지

---

## 새 엔티티 / 테이블 추가하기

1. `backend/db/models/<name>.py` 에 `Base` 상속 ORM 클래스 선언
2. `backend/db/models/__init__.py` 에 export 추가 (Alembic autogenerate 대상)
3. Alembic revision 생성: `uv run alembic revision --autogenerate -m "<msg>"`
4. 생성된 파일 검토 + downgrade 경로 확인
5. 필요 시 `backend/data/ports.py` 에 Protocol 추가, 파일/DB 구현체 2개 제공
6. DI 주입: FastAPI dependency 또는 엔진 `LoopDeps` 에 Port 타입
7. 테스트: 두 구현체 모두에서 동일 시나리오 통과 (parametrize fixture)

## 새 Port 추가하기

1. `backend/data/ports.py` 에 `@runtime_checkable Protocol` 선언
2. File/InMemory 구현체 + DB 구현체 2개 제공 (StoragePort — 구현체 전환 시 호출자 0 수정)
3. `main.py` lifespan 이 `APP_DB_ENABLED` 기준으로 둘 중 하나 인스턴스화 → `app.state.<port_name>` 에 주입. 엔진 내부 소비는 `LoopDeps` Protocol 경유 (engine/deps.py)
4. 호출자는 **구체 구현체 import 금지**. 오직 Protocol 만 참조 (`main.py` lifespan 이 유일한 구체 import 지점)
5. Port 시그니처에 `__all__` 추가

## Postgres ↔ SQLite 전환

- **Postgres (primary, dev + prod)**: `APP_DATABASE_URL=postgresql+asyncpg://...` + `APP_DB_ENABLED=true` (default). `APP_DB_SCHEMA=ai_backend` 로 스키마 네임스페이스 분리. 외부 도메인 `public.*` 는 별도 asyncpg pool (`<DOMAIN>_DATABASE_URL`)
- **SQLite fallback (CI / isolated smoke 테스트)**: `APP_DATABASE_URL` 미설정 → `sqlite+aiosqlite:///<data_dir>/app.db` 자동 생성. `APP_DB_SCHEMA` 무시됨 (SQLite 는 스키마 개념 없음)
- **완전 DB off (드문 경우)**: `APP_DB_ENABLED=false` → Port 들이 InMemory/File 구현체로 fallback. Lifespan 이 engine 초기화 skip
- Alembic 은 같은 revision 으로 양쪽에 적용 (`backend/db/upsert.py` 의 dialect-aware helper 덕에 호출자 코드 변경 없음)
- JSON 필드: SQLite `JSON` ↔ Postgres `JSONB` — SQLAlchemy 타입 매핑 레벨에서 동일 처리
- 프로덕션 배포 시 Postgres connection pool 크기 = uvicorn worker 수 × per-worker N (부하 기준 튜닝). 현재 단일 워커 가정 유지

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| Port 시그니처 변경 | 모든 구현체 + DI 주입 + 테스트 mock 동시 수정 |
| ORM 모델 컬럼 추가/삭제 | Alembic revision 필요, 기존 데이터 migration path |
| `APP_DB_ENABLED` 기본값 변경 | 부팅 시 구현체 선택 — 기존 dev 환경의 `.env` 명시 없으면 분기 뒤바뀜. 기존 File/InMemory 상태는 migration 필요 |
| `<DOMAIN>_DATABASE_URL` → `APP_DATABASE_URL` fallback 복원 | 외부 도메인 pool 이 실수로 AI 스키마에 붙을 위험 (경계 위반). 현재 설계상 **분리 유지** 필수 |
| UPSERT 방언 변경 | SQLite/Postgres 동시 테스트 필요 |
| 트랜잭션 경계 변경 | 일관성 / 동시성 trade-off |
| 도메인 엔티티를 `ai_backend.*` 에 복제 시도 | 외부 도메인 경계 위반 — 외부 application 의 `public.*` 가 정본, 필요시 직접 조회 |
| `<domain>_mutations` 감사 생략한 `public.*` UPDATE | 외부 도메인 경계 위반 — rollback 불가 + prototype UI 캐시 invalidation 신호 누락 |
| `lock_project` 없이 `public.*` UPDATE | 외부 application 의 사용자 쓰기와 interleave → 데이터 손상 위험 |
| SessionHistoryPort 구현 추가 | 인메모리 모드에서 history 미지원 → policy.session_enabled 제약 |

## 금지 사항

- Port 우회한 직접 `AsyncSession.execute` / raw SQL / 파일 쓰기 (single writer + StoragePort 위반)
- 트랜잭션 밖에서 write (commit 누락 → 손실)
- Long-running 트랜잭션 (스트리밍 중 open 유지)
- `execute(f"... {user_input}")` — parametrized 강제 (SQL injection)
- Alembic 우회한 스키마 변경
- 외부 도메인 엔티티를 `ai_backend.*` 에 복제해 두 곳에서 관리 (외부 도메인 경계 — `public.*` 가 정본)
- `public.*` UPDATE/INSERT 시 `lock_project` + `<domain>_mutations` 감사 생략 (외부 도메인 경계)
- `<domain>_mutations` 를 `public.*` 와 같은 트랜잭션 밖에서 append (감사 누수)
- `SessionHistoryPort` 를 `SessionPort` 에 병합 — identity/counter vs history 분리 원칙 (StoragePort)
- 구체 구현체 이름 (e.g. `DbSessionStore`) 을 호출자 코드에서 import — Protocol 만 참조
