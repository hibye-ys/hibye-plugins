---
paths:
  - "backend/data/**"
---

> App backend rules — Data Layer invariants, extension guide, impact map.
> **정본:** `_shared/single-writer.md` (3 자원 단일 작성자 / atomic write / per-resource lock / WriteCoordinator 싱글턴 / `data` vs `db` 분리 — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `architecture.md` (§단일 작성자), `config-management.md` (파일 경로),
>       `database-patterns.md` (§StoragePort — SessionPort / SessionHistoryPort / MediaJobPort),
>       `media-pipeline-patterns.md` (§WriteCoordinator 바이너리 출력)

> **Scope 경계:** 본 rule 은 **미디어 파이프라인 파일 쓰기** (`WriteCoordinator.write_media_job` / `write_media_output`) 의 단일 작성자 규율을 담당한다. 도메인 entity ground truth 는 iyaki 웹서비스의 `public.*` 스키마 소유 (iyaki 도메인 경계 — 접근은 `backend/tools/_iyaki_db.py` 전용 pool + `iyaki_*` 도구 + `ai_backend.iyaki_mutations` 감사 테이블 경유, `database-patterns.md` 참조). Session/history 저장은 `state/session.py` + `database-patterns.md` 참조.

# data-layer-patterns — 데이터 레이어 (media writes)

## 불변식 (Invariants)

**`backend/data/` 가 담당하는 것:**

| 대상 | 경로 | 쓰기 주체 |
|------|------|----------|
| Media job state | `data/media/jobs/<id>.json` | `WriteCoordinator.write_media_job` (single writer) |
| Media output 바이너리 | `data/media/<id>/<file>` | `WriteCoordinator.write_media_output` (media 파이프라인) |

- **우회 금지**: 위 경로에 `Path.write_bytes` / `write_text` 직접 호출 절대 금지. grep 으로 정기 검증
- 모든 쓰기는 **temp + fsync + rename** (`_atomic_write`) — crash-safe 불변
- Per-job `asyncio.Lock` (`__media_job:<id>`) — 같은 job 의 state 업데이트 + output 저장이 interleave 되지 않도록 serialize
- 싱글 프로세스 (uvicorn worker=1) 가정. 멀티 워커 전환 시 fcntl.flock 으로 교체 필요

**`backend/data/` 가 담당하지 않는 것:**

- 도메인 entity ground truth → iyaki 웹서비스의 `public.*` 스키마 (iyaki 도메인 경계). 접근은 `backend/tools/_iyaki_db.py` pool + `iyaki_*` 도구군, 쓰기는 `ai_backend.iyaki_mutations` 감사 필수. LSP adapter (`services/lsp_entities.py`) 는 같은 pool 을 read-only 로 경유하도록 교체 예정
- Session/turn 이력 → `state/session.py` + `SessionHistoryPort`
- Media job CRUD → `services/media/{file,db}_store.py` + `MediaJobPort` (state 만; 바이너리는 writer 경유)

**읽기 경로:**

- Media job state 조회는 `MediaJobPort.get` / `try_get` (StoragePort abstraction). 파일 직접 `json.load` 금지
- Media 바이너리는 response path (signed URL 또는 file://) 로 반환. backend 가 inline 로드 금지

**모듈 구조:**

```
ports.py  (Protocol 선언)
   ↓
writer.py (미디어 단일 writer)
   ↓
media/    (런타임 데이터 위치 — 파일/디렉토리)

(LRU 유틸은 backend/utils/lru.py::LRUDict — FileMediaJob._lru 가 직접 소비)
```

- `ports.py` — `SessionPort` / `SessionHistoryPort` / `MediaJobPort` Protocol 선언. **Protocol 만** — 구체 구현체는 `state/` (Session*) 또는 `services/media/` (MediaJob) 에 분산
- `writer.py` — `WriteCoordinator` + `get_coordinator(data_dir)` 싱글턴 (per data_dir). 실제로는 **미디어 파이프라인 전용** (`write_media_job` / `write_media_output`) — 이름이 범용처럼 보여도 범위는 media 로 제한
- LRU 유틸은 `backend/utils/lru.py::LRUDict` 가 정본. 현재 `FileMediaJob._lru` (hot read 캐시, `capacity=1024`) 가 유일한 미디어 소비자 — DB 모드에서는 사용 안 함 (DB 자체가 캐시 역할). 2026-04-29 minor-cleanups cycle (commit a1c9b6a) 에서 `data/cache.py::DataCache` thin wrapper 삭제 후 직접 의존으로 통합
- **(파일 없음)** — `types.py` 등 placeholder 모듈은 만들지 않음. 공유 타입은 해당 소비자 측 (e.g. `services/media/types.py`) 또는 `engine/types.py` 에 배치

## 새 미디어 출력 유형 추가하기

1. `services/media/<op>.py` 의 handler 에서 `get_coordinator(data_dir).write_media_output(job_id, filename, bytes)` 호출
2. 파일 확장자 / MIME 타입은 `services/media/schemas.py` 의 `<Op>Result` 에 명시
3. 테스트: crash 중간 재실행 시 이전 tmp 파일이 남지 않는지 (`_atomic_write` 의 unlink 경로) 확인

## 새 Port 추가하기

1. `backend/data/ports.py` 에 `@runtime_checkable Protocol` 선언
2. In-memory (또는 파일) 구현체 + DB 구현체 2개 제공 (StoragePort — DB 전환 시 호출자 0 수정)
3. FastAPI dependency 또는 엔진 `LoopDeps` 에 타입 힌트로 노출
4. 호출자는 **구체 구현체 import 금지**. 오직 Protocol 만 참조
5. `__all__` 에 Port 이름 추가

## iyaki 웹서비스 연동 체크리스트

1. `backend/tools/_iyaki_db.py` — 전용 asyncpg pool + `lock_project(project_id)` advisory lock + `resolve_active_project_id()` 헬퍼. `IYAKI_DATABASE_URL` env (기본은 `APP_DATABASE_URL` 공유)
2. 도구는 `backend/tools/iyaki_query.py` (read) + `backend/tools/iyaki_mutate.py` (write). 쓰기는 반드시 advisory lock 내부 + 트랜잭션 내 `ai_backend.iyaki_mutations` append
3. Alembic autogenerate 가 `public.*` 를 건드리지 않도록 env.py 의 `include_object` 필터로 `schema='ai_backend'` 만 허용
4. LSP adapter 도 같은 pool 을 read-only 로 경유 — 자체 TTL 캐시 + 쓰기 도구 성공 후 invalidation 신호 (`ToolResult.metadata["resource_updated"]` 관찰)

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| WriteCoordinator 싱글턴 해제 | single writer 불변식 위반, race condition 즉시 재현 |
| Per-job Lock → 글로벌 Lock | 서로 다른 job 병렬 실행 불가 — 처리량 하락 |
| `data/media/` 파일 레이아웃 변경 | `.env`, 배포 스크립트, 백업 경로, docker volume 마운트, 기존 완료 job 의 result_path 호환성 |
| `_atomic_write` 방식 변경 | crash-safety 보장 재검증 필요 |
| 싱글 → 멀티 워커 전환 (asyncio.Lock → fcntl.flock) | 락 의미 변화 (프로세스 내 vs 프로세스 간), 성능 특성, 디버깅 난이도 |

## 금지 사항

- `data/media/**` 에 WriteCoordinator 우회 직접 write
- `data/extracted/**` 디렉토리를 만들어 ground-truth 자체 보관 (iyaki 도메인 경계 위반 — 외부 웹서비스 소유)
- user-state overlay 인프라 (`append_op` / `PatchOperation` / `UserStatePort` / `read_merged`) 재도입 — 별도 설계 승인 전 금지
- `WriteCoordinator` 인스턴스 여러 개 생성 (싱글턴 위반)
- `data/media/**` 파일을 `json.load` / `open(...).read()` 로 직접 조회 (`MediaJobPort` 경유)
