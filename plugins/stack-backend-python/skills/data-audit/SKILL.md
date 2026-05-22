---
name: data-audit
description: Consolidated checklist for auditing `backend/data/` (media single-writer) + `backend/state/` (SessionPort family) + `backend/db/` (SQLAlchemy async + external domain boundary). Covers StoragePort Protocol conformance, WriteCoordinator media scope, cache invalidation (FileMediaJob LRU), 5-state media job lifecycle, and `lock_project` + `<domain>_mutations` audit coverage. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/data-layer-patterns.md` and `database-patterns.md`. Absorbs the former `data-layer` skill (deleted 2026-04-24 after the user-state overlay concept was retired).
allowed-tools: Read, Bash, Grep, Glob
---

# data-audit — 데이터 계층 감사 가이드

## 이 skill 은 언제 로드되는가

- `data-state-manager` sub-agent 호출 시 (data-audit / cache 모드)
- `backend/data/` / `backend/state/` / `backend/db/` 파일 변경 후 정합성 점검
- Single writer / StoragePort 준수 여부 확인 시
- Media job lifecycle drift 의심 시 (stale status, canceled jobs 중복 pickup 등)

## 이 skill 은 언제 로드되지 않는가

- 세션 관리 전용 감사 (→ `session-audit` skill — SessionPort 메서드 커버리지, LRU, user_id 전파)
- Media pipeline 구현 (→ `tools-manager` agent `media-audit` 모드가 본 skill + `media-pipeline-patterns.md` rule 동시 참조)
- 외부 도메인 쓰기 도구 구현 (→ `database-patterns.md` rule 직접 참조)

## 원칙은 Rule 에 있다

- `.agents/rules/python_agent_rules/data-layer-patterns.md` — 미디어 single writer, `data/` vs `db/` 분리
- `.agents/rules/python_agent_rules/database-patterns.md` — SQLAlchemy 2.0 async, StoragePort (3종), 외부 도메인 경계, Alembic

본 skill 은 grep/ls 레시피만 제공. 불변식 해석이 필요하면 위 rule 을 먼저 읽는다.

## 1. 모듈 레이아웃 — 현재 ground truth

```
backend/data/
├── ports.py     # SessionPort, SessionHistoryPort, MediaJobPort Protocol
├── writer.py    # WriteCoordinator (media 전용) — write_media_job / write_media_output
├── cache.py     # DataCache LRU — FileMediaJob 만 사용
└── media/       # 런타임 바이너리 + job state JSON (APP_DB_ENABLED=false 시)

backend/state/
├── session.py      # InMemorySessionStore / InMemorySessionHistory
└── db_session.py   # DbSessionStore / DbSessionHistory (Postgres primary)

backend/db/
├── base.py         # DeclarativeBase
├── config.py       # DatabaseSettings (db_enabled default True)
├── engine.py       # session_scope() async context manager
├── lifespan.py     # startup/shutdown hooks
├── upsert.py       # dialect-aware UPSERT
├── models/         # SessionORM / SessionMessageORM / MediaJobORM
├── migrations/     # Alembic revisions (<domain>_mutations 포함)
└── alembic.ini
```

**없는 것** (유의): `reader.py`, `types.py` 는 더 이상 존재하지 않음. 구 `ExtractedRecord` /
`PatchOperation` / `MergedView` / `user-state patch` 개념 전부 폐기 — 참조 발견 시
`data-layer-patterns.md:86` 의 금지 조항에 따라 제거 대상.

```bash
# 구 개념 잔존 탐지 (VIOLATION — 전부 코드베이스에서 사라져야 함)
rg -n "PatchOperation\|ExtractedRecord\|MergedView\|append_op\|UserStatePort" backend/
rg -n "data/user-state\|data/extracted" backend/
```

## 2. WriteCoordinator 단일 경로 (media 전용)

```bash
# data/media/** 에 WriteCoordinator 우회 직접 write (VIOLATION)
rg -n '\.write_text|\.write_bytes|open\([^)]*["\x27]w' backend/ \
  -g '!backend/data/writer.py' -g '!backend/tests/*' | rg "data/media"

# WriteCoordinator 싱글턴 확인 (per data_dir)
rg -n "class WriteCoordinator|def get_coordinator" backend/data/writer.py

# Atomic write 패턴 (temp + fsync + rename)
rg -n "_atomic_write|os\.fsync|os\.replace" backend/data/writer.py
```

단일 작성자는 **미디어 scope 한정** — user-state 등 다른 경로 잔존 시 VIOLATION.

## 3. StoragePort Protocol (3종)

```bash
# Protocol 정의 존재 + @runtime_checkable
rg -n "class (SessionPort|SessionHistoryPort|MediaJobPort)|@runtime_checkable" backend/data/ports.py

# 호출자가 concrete 구현체 import (VIOLATION — main.py lifespan 만 예외)
rg -n "(InMemorySessionStore|InMemorySessionHistory|DbSessionStore|DbSessionHistory|FileMediaJob|DbMediaJob)" \
  backend/ -g '!backend/main.py' -g '!backend/tests/*' \
  -g '!backend/state/*' -g '!backend/services/media/*'

# 호출자는 Protocol 로만 참조
rg -n "SessionPort|SessionHistoryPort|MediaJobPort" backend/engine/ backend/routes/
```

concrete 이름이 state/ 와 services/media/ 밖에서 나오면 drift.

## 4. Media Job 5-state Lifecycle

```bash
# JobStatus Literal (5 값)
rg -n "JobStatus|TERMINAL_JOB_STATUSES" backend/services/media/types.py

# Terminal set 사용 — cancel 멱등성 + worker pickup skip
rg -n "TERMINAL_JOB_STATUSES" backend/services/media/

# Handler exception → scrub_secrets 필수
rg -n "scrub_secrets" backend/services/media/worker.py
```

5 상태: `queued / running / completed / failed / canceled`. Terminal 3: completed/failed/canceled.

## 5. Cache Invalidation (FileMediaJob 전용)

```bash
# FileMediaJob 에서 _cache 사용 확인
rg -n "_cache|DataCache" backend/services/media/file_store.py

# write 후 invalidate 호출
rg -n "def update_status|def create" backend/services/media/file_store.py -A 20 | rg "invalidate\|_cache"
```

DB 모드 (DbMediaJob) 는 cache 미사용 — DB 자체가 캐시 역할.

## 6. 파일 vs DB 분리

```bash
# data/ 가 db/ 를 import (VIOLATION)
rg -n "^from backend\.db|^import backend\.db" backend/data/

# db/ 가 data/ 를 import (VIOLATION)
rg -n "^from backend\.data|^import backend\.data" backend/db/
```

두 계층은 완전 독립. 호출자 (state/, services/media/) 가 Port Protocol 경유로 선택.

## 7. Session 트랜잭션 경계

```bash
# 모든 DB 쓰기가 session_scope() 안에 있는지
rg -n "session_scope|AsyncSession" backend/

# 호출자가 AsyncSession.execute 직접 호출 (Port 우회 VIOLATION)
rg -n "AsyncSession.*execute|session\.execute" backend/ -g '!backend/db/*' -g '!backend/tests/*'
```

DB 쓰기는 Port 경유 → Port 구현 내부에서만 session_scope.

## 8. 외부 도메인 경계 (이 instance = `<domain>`)

```bash
# public.* UPDATE/INSERT 시 lock_project 감쌌는지
rg -n "UPDATE public\.|INSERT INTO public\." backend/tools/<domain>_mutate.py -C 5 | rg lock_project

# ai_backend.<domain>_mutations 감사 append 동반 여부
rg -n "<domain>_mutations" backend/tools/<domain>_mutate.py

# 전용 pool — <DOMAIN>_DATABASE_URL 사용, APP_DATABASE_URL fallback 없어야 함
rg -n "<DOMAIN>_DATABASE_URL|APP_DATABASE_URL" backend/tools/_<domain>_db.py
```

3 조건: advisory lock + audit append + (성공 시 `ToolResult.metadata["resource_updated"]`).

## 9. Alembic include_object 필터

```bash
# public.* 은 autogenerate 대상에서 제외되어야 함
rg -n "include_object|schema.*ai_backend" backend/db/migrations/env.py
```

외부 도메인 테이블을 backend autogenerate 가 건드리면 안 됨.

## 10. 구개념 경고 grep (retired 2026-04)

```bash
# 이 패턴 중 하나라도 매칭되면 rule drift 잔존
rg -n "AD-01[0-9]|AD-00[0-9]" backend/ .agents/
rg -n "UserStatePort|PatchOperation|ExtractedRecord" backend/ .agents/
```

## 리포트 템플릿

```markdown
## Data Audit — <date>

### Module layout sanity
- [OK/FAIL] backend/data/ = {ports.py, writer.py, cache.py, media/} (no reader.py, no types.py)
- [OK/FAIL] No `PatchOperation / ExtractedRecord / user-state` references anywhere

### Single writer (media scope)
- [OK/FAIL] WriteCoordinator is sole writer to data/media/**
- [OK/FAIL] Atomic write (_atomic_write) preserved

### StoragePort (3 Protocols)
- [OK/FAIL] SessionPort / SessionHistoryPort / MediaJobPort declared in ports.py
- [OK/FAIL] Callers reference Protocols only (main.py lifespan is sole concrete importer)

### Media job lifecycle
- [OK/FAIL] JobStatus Literal = 5 values, TERMINAL_JOB_STATUSES used for cancel/pickup-skip
- [OK/FAIL] scrub_secrets applied to worker error.message

### Cache invalidation
- [OK/FAIL] FileMediaJob wires DataCache LRU + invalidate on state change
- [OK/FAIL] DbMediaJob does NOT use cache (DB is the cache)

### Layer separation
- [OK/FAIL] backend/data/ does not import backend/db/
- [OK/FAIL] backend/db/ does not import backend/data/

### DB transaction boundary
- [OK/FAIL] All DB writes inside session_scope() context manager
- [OK/FAIL] No direct AsyncSession.execute outside backend/db/ and backend/tests/

### external domain boundary
- [OK/FAIL] public.* mutations wrapped in lock_project
- [OK/FAIL] Every mutation appends ai_backend.<domain>_mutations in same txn
- [OK/FAIL] backend/tools/_<domain>_db.py reads <DOMAIN>_DATABASE_URL only (no APP_DATABASE_URL fallback)

### Alembic
- [OK/FAIL] include_object restricts autogenerate to schema='ai_backend'

### Retired concept drift
- [OK/FAIL] No AD-### identifiers in backend/ or .agents/
- [OK/FAIL] No UserStatePort / PatchOperation / ExtractedRecord references
```

## 검증 체크리스트

- [ ] 10 개 체크 블록 실행
- [ ] Single writer / StoragePort / external domain boundary 위반은 CRITICAL 표시
- [ ] rule 참조로 근거 제시 (`data-layer-patterns.md` 또는 `database-patterns.md` §섹션명)
- [ ] 구개념 잔존 발견 시 삭제 제안 (재도입 금지 — `data-layer-patterns.md:86`)

## 구현 중 막히면

- `backend/data/` 없음 → NOT_YET_IMPLEMENTED, repo 상태 이상 신호
- `ports.py` 없음 → StoragePort 미구현 — 전체 감사 중단 + 우선순위 높게 보고
- `writer.py` 에 `WriteCoordinator` 없음 → single writer 패턴 미구현
- `APP_DB_ENABLED` 미설정 → DatabaseSettings default (`True`) 적용됨 — 이는 정상
- <domain> 관련 파일 (`_<domain>_db.py`, `<domain>_mutate.py`) 없음 → <domain> 경계 아직 미구현, <domain> 섹션 skip 가능
