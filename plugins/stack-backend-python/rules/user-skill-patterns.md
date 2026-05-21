---
paths:
  - "backend/routes/skills.py"
  - "backend/services/skills/**"
  - "backend/state/user_skill.py"
  - "backend/state/db_user_skill.py"
  - "backend/db/models/user_skill.py"
---

> App backend rules — User Skill invariants, extension guide, impact map.
> 관련: `data-layer-patterns.md` (WriteCoordinator 단일 작성자), `database-patterns.md` (StoragePort),
>       `context-assembly-patterns.md` (AttachmentType.SKILLS = 9), `api-routing-patterns.md` (/skills),
>       `error-handling.md` (§4 예외 계층 — `ResourceError` / `ValidationError` 기반)

# user-skill-patterns — 유저 커스텀 Skill 시스템

> **Scope:** `backend/routes/skills.py`, `backend/services/skills/`, `backend/state/user_skill.py`,
> `backend/state/db_user_skill.py`, `backend/db/models/user_skill.py`,
> `backend/data/writer.py::write_user_skill`/`read_user_skill`/`user_skill_relpath`/`user_skill_path` 확장분.
> 정적 system skill (이 프로젝트 소유) 은 Skill 시스템 밖 — 파일 + `@lru_cache` 전용.

## 불변식 (Invariants)

### Storage 분리 (hybrid)

| 대상 | 저장소 | 구현 |
|------|--------|------|
| 메타데이터 | Postgres `user_skills` (또는 SQLite fallback) | `UserSkillRow` ORM |
| 본문 (`.md`) | `data/skills/user/<user_id>/<skill_id>.md` | `WriteCoordinator.write_user_skill` (단일 작성자) |

- **본문 파일 쓰기는 `WriteCoordinator` 싱글턴 단일 경로** 만 허용. `Path.write_text` 직접 호출 금지 (media 규약과 정합)
- **경로 레이아웃 단일 source**: `WriteCoordinator.user_skill_relpath(user_id, skill_id)` (staticmethod) 가 `data/skills/user/<user_id>/<skill_id>.md` 를 반환. DB store 는 이 값을 `body_path` 에 persist, InMemory store 는 동일 helper 로 동기화된 shape 을 합성. 디스크 layout 변경 시 `user_skill_relpath` + `user_skill_path` 두 메서드만 동시에 수정
- 메타와 본문은 **한 트랜잭션에 atomic 하지 않다** — 본문 write 먼저, DB INSERT 나중. INSERT 가 `IntegrityError` raise 시 `_compensate_body` 가 방금 쓴 본문을 best-effort unlink (OSError 는 WARNING 로그만, primary 에러 mask 금지)
- Per-(user_id, skill_id) `asyncio.Lock` (`__user_skill:<user_id>:<skill_id>`) — media job 과 동일 패턴

### 예외 계층 (error-handling.md §4 편입)

| 예외 | 베이스 | 용도 |
|------|--------|------|
| `SkillNotFoundError` | `ResourceError` (재시도 가능) | `get` / `update` 시 `(user_id, name)` 미존재 |
| `SkillAlreadyExistsError` | `ValidationError` (클라이언트 수정 후 재시도) | `create` 시 `(user_id, name)` 충돌 |

- 두 예외 모두 `AppError` 루트 — `main.py` 글로벌 핸들러가 route-level catch 가 빠져도 404/422 로 안전 변환
- `DbUserSkillStore.create` 의 `IntegrityError` narrowing 은 `_is_user_name_duplicate` 가 담당. 3단계 체크: (1) asyncpg `sqlstate=="23505"`, (2) 제약명 `uq_user_skills_user_name`, (3) SQLite 컬럼 리스트 fallback. FK / NOT NULL / CHECK 등 다른 무결성 위반은 원본 re-raise

### `UserSkillPort` Protocol

`backend/data/ports.py` 에 선언. 메타 CRUD 만 담당. 본문 I/O 는 Port 가 아니라 `WriteCoordinator` 경유 — `MediaJobPort` 와 동일 분리.

시그니처 스냅샷 (코드가 정본):

```python
@runtime_checkable
class UserSkillPort(Protocol):
    async def list_for_user(
        self, user_id: str, *, limit: int = 100
    ) -> list[UserSkillRecord]: ...
    async def get(self, user_id: str, name: str) -> UserSkillRecord | None: ...
    async def create(
        self, user_id: str, name: str, body: str,
        *, description: str | None = None, is_public: bool = False,
        metadata: Mapping[str, object] | None = None,
    ) -> UserSkillRecord: ...
    async def update(
        self, user_id: str, name: str, *,
        body: str | None = None, description: str | None = None,
        is_public: bool | None = None, metadata: Mapping[str, object] | None = None,
    ) -> UserSkillRecord: ...
    async def delete(self, user_id: str, name: str) -> bool: ...
    async def read_body(self, user_id: str, name: str) -> str | None: ...
```

Error contract: `create` raises `SkillAlreadyExistsError` on `(user_id, name)` collision; `update` raises `SkillNotFoundError` when the row is absent. Both implementations must share the same error types — route handlers depend on it.

### Naming / Uniqueness

- `name: str` — pattern `^[a-z0-9_-]+$`, 1~64자. system skill 과 충돌 시 user > system 우선 (resolver 에서 결정)
- `(user_id, name)` UniqueConstraint — 같은 유저 내 이름 중복 금지

### Versioning

- `version: int` — 매 update 시 `+1`. Monotonic. 롤백 경로 없음 (YAGNI — 필요 시 audit 테이블 별도 도입)
- `body_path` 는 version 정보를 **포함하지 않음** — 현재 버전만 존재. 이력 필요 시 future migration

### Prompt Cache 영향

- User skill 본문은 **변경 빈도 medium~high** — `AttachmentType.SKILLS = 9` 슬롯에 배치 (이미 `backend/engine/context.py` 에 예약됨)
- System skill 은 static prefix 영역, user skill 은 suffix 영역 — 섞으면 cache prefix 오염
- 한 유저 내에서 자주 바뀌는 skill 은 해당 유저 세션의 cache hit 을 깨뜨림 — 불가피. write-through invalidation 시 해당 유저 cache key 만 영향

### 인증 / 권한

- 모든 CRUD 에 `Depends(require_auth)` — anonymous 는 skill 생성 불가 (필요 시 별도 scope `skills:write` 도입)
- 소유권 검사: `user_id != caller and not has_scope(scopes, "*")` → **leak-safe 404** (media + session 과 동일 패턴, `api-routing-patterns.md`)
- `is_public=True` 는 공개 읽기 허용 (reserved) — 현재 phase 에서는 enforcement 없음 (future)

## 새 Skill 확장 기능 추가하기

### 공유 (other user 가 읽기)

1. `UserSkillPort` 에 `list_public() -> list[UserSkillRecord]` 추가
2. `routes/skills.py` 에 `GET /skills/public` 라우트 + `is_public=True` 필터링
3. 캐시 정책: 공개 skill 은 per-worker shared LRU (현재 per-user 기준과 분리)

### 마켓플레이스 / 검색

1. `user_skills` 에 `tags: JSONB`, `usage_count: int` 컬럼 추가 (Alembic migration)
2. `list_public(tags=?, q=?)` 필터 파라미터 추가
3. Full-text search 는 Postgres `tsvector` 컬럼 + GIN index (future)

### Activation 트리거 (어느 skill 을 context 에 주입할지)

현재는 호출자 (route / loop) 가 명시적으로 `active_skills: list[str]` 을 전달. 자동 활성화 (user query → skill 매칭) 는 future — matcher 설계 필요.

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `UserSkillPort` 시그니처 변경 | InMemory + DB 구현체 + FastAPI dependency + 테스트 mock 동시 수정 |
| `UserSkillRow` 컬럼 추가/삭제 | Alembic revision 필요, `_row_to_record` 변환 함수 업데이트 |
| `WriteCoordinator.user_skill_relpath` 포맷 변경 | `user_skill_path` 절대경로 + 기존 `body_path` 컬럼 값 + InMemory synthetic path 전부 동시 drift — migration + DB UPDATE 필요 |
| `APP_DB_ENABLED` 기본값 변경 | 부팅 시 Port 구현체 선택 — InMemory 는 restart 시 본문 소실 |
| `AttachmentType.SKILLS` ordinal 변경 | **금지** — 모든 세션 prompt cache prefix 무효화 |
| Name regex 변경 | 기존 skill 이름 재검증 필요 |
| Version 의미 변경 (monotonic 해제) | update 경로 전부 재검토 |
| System vs user 우선순위 역전 | system skill 이 유저 오버라이드 가능 → 보안/정책 영향 |
| `SkillNotFoundError` / `SkillAlreadyExistsError` 베이스 변경 | 글로벌 HTTP 응답 코드 재매핑 (현재 `ResourceError` → 404, `ValidationError` → 422 route-level override 로 409) |
| `_UNIQUE_CONSTRAINT` 이름 변경 | `_is_user_name_duplicate` 문자열 sniff fallback 동시 업데이트 + Alembic migration constraint 이름 |

## 금지 사항

- `WriteCoordinator` 우회한 본문 파일 직접 write (single writer 위반)
- 본문을 DB `TEXT` 컬럼에 저장 (row size 팽창 + 매 조회 SQL 전송 비용)
- `UserSkillPort` 에 본문 I/O 메서드 추가 후 `WriteCoordinator` 우회 (MediaJobPort 와 분리 원칙 위반)
- 호출자 코드가 `InMemoryUserSkillStore` / `DbUserSkillStore` concrete import (Protocol 만 참조, `main.py` lifespan 이 유일한 구체 import 지점)
- `body_path` 를 `WriteCoordinator.user_skill_relpath` 우회해 직접 문자열 조립 (경로 레이아웃 drift — pass 2 회귀 금지)
- `SkillNotFoundError` / `SkillAlreadyExistsError` 를 bare `Exception` 으로 되돌리기 (`AppError` 계층 이탈 시 글로벌 핸들러 catch 누락)
- `_is_user_name_duplicate` 제거하고 `except IntegrityError` 광역 catch (FK / NOT NULL 위반까지 `SkillAlreadyExistsError` 로 오분류)
- `_compensate_body` 안에서 OSError 를 re-raise (primary `IntegrityError` 를 secondary 에 덮음)
- `name` 정규식 우회한 직접 row 삽입 (pydantic + DB 검증 둘 다 경유 필수)
- Skill 소유권 불일치 시 403 반환 (반드시 leak-safe 404)
- `AttachmentType.SKILLS` ordinal 재배치 (cache prefix 무효화)
- System skill 본문을 `user_skills` 테이블에 복제 (파일 + `@lru_cache` 유지)
- Anonymous 유저 skill 생성 허용 (sentinel user_id 오염)
- Version 을 거꾸로 돌리기 / 롤백 경로 추가 (audit 테이블 없이 — 이력 감사 불가)
