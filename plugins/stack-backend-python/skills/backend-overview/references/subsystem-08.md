> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/data-layer-patterns.md` (media single-writer) + `database-patterns.md` (StoragePort + external domain boundary).

# Subsystem 08 — Data Layer

## 목적 (1줄)

미디어 바이너리 + job state 단일 작성자 (WriteCoordinator) + StoragePort Protocol
뒤에 숨은 인메모리/파일/DB 구현체 라우팅. 도메인 엔티티는 소유하지 않음 (외부
application 웹서비스 (예: iyaki) `public.*` 스키마 소유 — `database-patterns.md` 참조).

## 파일 / 모듈

```
backend/data/
├── ports.py    # SessionPort, SessionHistoryPort, MediaJobPort Protocol (runtime_checkable)
├── writer.py   # WriteCoordinator (media 전용) — write_media_job / write_media_output
├── cache.py    # DataCache LRU — FileMediaJob 만 사용 (DB 모드는 사용 안 함)
└── media/      # 런타임 바이너리 + job state JSON (APP_DB_ENABLED=false 일 때만)
```

**없는 것** (2026-04 기준 drift 탐지용): `reader.py`, `types.py`, `extracted/`,
`user-state/`, `PatchOperation`, `ExtractedRecord`, `MergedView`, `append_op`,
`UserStatePort`. 이들은 구 개념 — `data-layer-patterns.md:86` 의 금지 조항에
따라 재도입 금지.

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `SessionPort` | identity / counters / 메타 (backend/state/ 가 구현) |
| `SessionHistoryPort` | 메시지 이력 (identity 와 분리) |
| `MediaJobPort` | job state CRUD (바이너리 비대상) |
| `WriteCoordinator.write_media_job(job_id, record)` | media job state JSON 쓰기 (single writer) |
| `WriteCoordinator.write_media_output(job_id, filename, bytes)` | media 바이너리 파일 쓰기 |
| `get_coordinator(data_dir)` | per-data_dir 싱글턴 |
| `DataCache` (cache.py) | LRU OrderedDict — `FileMediaJob._cache` 전용 (`maxsize=1024`) |

## 디렉토리 레이아웃 (런타임)

```
data/
├── media/
│   ├── jobs/<id>.json      # APP_DB_ENABLED=false 시. DB 모드에서는 DB 테이블만 사용
│   └── <job_id>/<file>     # 항상 파일 — 바이너리는 DB blob 에 안 담음
```

## StoragePort 경로 선택

부팅 시 `APP_DB_ENABLED` (기본 True) 기준:

| Port | DB 모드 (primary) | File/InMemory 모드 (smoke test fallback) |
|------|------------------|------------------------------------------|
| SessionPort | `DbSessionStore` (backend/state/db_session.py) | `InMemorySessionStore` (backend/state/session.py) |
| SessionHistoryPort | `DbSessionHistory` | `InMemorySessionHistory` |
| MediaJobPort | `DbMediaJob` (backend/services/media/db_store.py) | `FileMediaJob` (backend/services/media/file_store.py) |

호출자는 **Protocol 만 import** — concrete 구현체 import 는 `main.py` lifespan
에서만 허용 (architecture.md StoragePort 원칙).

## 쓰기 경로 (media single writer)

```
Tool / media handler
  ↓
WriteCoordinator.write_media_*(job_id, ...)  # per-job asyncio.Lock
  ↓
_atomic_write(path, bytes)                    # temp + fsync + rename
  ↓
DataCache.invalidate(key)                     # File 모드만 (DB 모드는 DB 가 캐시)
```

미디어 외 경로는 `data/` 가 관리하지 않음:
- Session identity/counter/메시지 → `backend/state/` (Port 구현체)
- 일반 DB 쓰기 → `backend/db/engine.py::session_scope()` 경유
- iyaki 도메인 쓰기 → `backend/tools/_iyaki_db.py` 전용 pool + `lock_project` + `iyaki_mutations` 감사 append (database-patterns.md)

## 담당 skill

`data-audit` (data-layer skill 은 2026-04 통합 후 삭제됨)

## 범위

- Single writer: **media scope 만** — `data/user-state/` 는 폐기됨
- StoragePort 3종 Protocol 정의
- FileMediaJob LRU 캐시 + DB 모드에서는 cache 무관
- Atomic write (`_atomic_write`) crash-safe 보장

## Gotchas

- **Protocol 위반 감지**: concrete 구현체 이름 (DbSessionStore, FileMediaJob 등) 이 호출 코드에 import 되면 StoragePort 추상화 깨짐 — `main.py` lifespan 이 유일한 예외
- **media 바이너리를 DB blob 에 시도**: 금지. 크기 + 스트리밍 이유로 항상 파일
- **data/ ↔ db/ 상호 import**: 금지 (architecture.md 계층 분리)
- **retired concept 재도입 시도**: `PatchOperation`, `user-state`, `ExtractedRecord` 등 → `data-layer-patterns.md:86` 금지 조항 citation 하며 reject
- **asyncio.Lock → fcntl 마이그레이션**: 현재 단일 uvicorn worker 전제. 멀티 워커 전환 시 per-job Lock 을 프로세스 간 락으로 교체 필요

## 관련 rule

- `data-layer-patterns.md` — 미디어 파이프라인 단일 작성자 (본 서브시스템)
- `database-patterns.md` — StoragePort 3종, SQLAlchemy 2.0 async, 외부 도메인 경계
- `media-pipeline-patterns.md` — MediaJobPort 의 소비자 측 설계 (services/media/)
- `architecture.md` — 계층 분리 (data/ vs db/), 단일 작성자 원칙 상위
