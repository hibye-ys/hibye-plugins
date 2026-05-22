> Language-neutral invariants — Single-writer pattern, atomic write, per-resource locking.
> 정본 (single source of truth) for both Python and Rust harnesses.
> Cited from: `python_agent_rules/data-layer-patterns.md`, `rust_agent_rules/data-layer-patterns.md`,
>             `python_agent_rules/architecture.md`, `rust_agent_rules/architecture.md`.

# Single Writer — 언어 무관 불변식

## 원칙

동일 자원의 **쓰기 경로는 1개로 제한**. 읽기는 복수 허용.

이유:
- 경쟁 조건 단일 지점 처리
- audit trail 집중
- 저장 백엔드 교체 용이
- crash-safety 보장 단일화

## 단일 작성자 자원 (3가지)

| 자원 | 경로 | 단일 작성자 |
|------|------|------------|
| Media job state | `data/media/jobs/<id>.json` | `WriteCoordinator.write_media_job` |
| Media output 바이너리 | `data/media/<id>/<file>` | `WriteCoordinator.write_media_output` |
| User custom skill 본문 | `data/skills/user/<user>/<name>.md` | `WriteCoordinator.write_user_skill` / `delete_user_skill` |

세션 쓰기는 별도 — `state/session` (InMemory) 또는 `state/db_session` (DB) 가 단일 진입점, 호출자는 `SessionPort` Protocol/trait 만 참조.

## 핵심 메커니즘

### 1. Atomic Write (temp + fsync + rename)

모든 쓰기는 `_atomic_write` 패턴:

```
1. tmp 파일에 새 내용 write
2. fsync — disk flush 보장
3. rename(tmp, target) — atomic 교체
4. 실패 시 tmp unlink
```

→ crash-safe 불변. 부분 쓰기 / 손상 파일 발생 불가.

### 2. Per-resource Lock

같은 자원에 대한 동시 쓰기는 lock 으로 직렬화:

- Per-job: `__media_job:<id>` lock
- Per-skill: `__user_skill:<user>:<name>` lock
- Python: `asyncio.Lock`
- Rust: `tokio::sync::Mutex`

→ 같은 job 의 state 업데이트 + output 저장이 interleave 되지 않음.

### 3. WriteCoordinator 싱글턴

- `WriteCoordinator` 인스턴스는 **싱글턴 per data_dir**
- `get_coordinator(data_dir)` 헬퍼가 cache + 반환
- 여러 instance 생성 금지 — lock 격리 깨짐

### 4. 경로 헬퍼 단일 source

쓰기 경로 레이아웃은 **staticmethod / 정적 함수** 단일 source:

- `WriteCoordinator.user_skill_relpath(user_id, name)` — DB / InMemory store 양쪽이 같은 helper 참조
- 직접 path 조립 금지 — drift 위험

## 멀티 워커 가정

- 현재: **싱글 프로세스** (uvicorn worker=1 / 단일 axum bind) 가정
- 멀티 워커 전환 시: process-local lock (`asyncio.Lock` / `tokio::Mutex`) → 파일 시스템 lock (`fcntl.flock` / `fs2::FileExt::try_lock_exclusive`) 으로 교체 필요
- DB 모드는 transaction 자체가 직렬화 역할 — 별도 lock 불필요

## 읽기 경로 (복수 허용)

- Media job state 조회: `MediaJobPort.get` / `try_get` (StoragePort abstraction). 파일 직접 read 금지
- Media 바이너리: response path (signed URL 또는 file://) 로 반환. backend 가 inline 로드 금지
- User skill 본문: `UserSkillPort.read_body(user_id, name)` 경유

## 모듈 구조

```
ports.py / ports.rs    (Protocol / trait 선언)
   ↓
writer.py / writer.rs  (단일 writer — WriteCoordinator)
   ↓
data/                  (런타임 데이터 위치 — 파일/디렉토리)
```

- ports 모듈: `SessionPort` / `SessionHistoryPort` / `MediaJobPort` / `UserSkillPort` 만 선언. **Protocol/trait 만** — 구체 구현체는 별도 분산
- writer 모듈: `WriteCoordinator` + `get_coordinator(data_dir)` 싱글턴
- LRU 유틸은 별도 모듈 (Python: `utils/lru.py::LRUDict`, Rust: `utils::lru::LruDict`). hot read 캐시 (capacity=1024) — DB 모드에서는 사용 안 함

## `data/` vs `db/` 분리

| 계층 | 저장 매체 | 관리 대상 |
|------|-----------|-----------|
| `backend/data/` (Python) / `crates/ai-data/file/` (Rust) | 파일 시스템 | 미디어 바이너리 + job state JSON + 유저 커스텀 skill 본문 markdown |
| `backend/db/` (Python) / `crates/ai-data/db/` (Rust) | Postgres (SQLAlchemy / sqlx) | 세션, 메시지, media job state, user_skills 메타, <domain>_mutations 감사 |

- `data/` 는 `db/` 를 import 안 함 (파일 시스템은 DB 독립)
- `db/` 는 `data/` 를 import 안 함 (ORM 자체 완결)
- 호출자 (state/, services/media/) 가 둘 중 선택 or Port Protocol/trait 경유

## StoragePort Protocol 추상화

- 저장소 의존 컴포넌트는 Protocol/trait 만 참조
- 구체 클래스 (`InMemorySessionStore`, `DbSessionStore`, `FileMediaJob`, `DbMediaJob`, `InMemoryUserSkillStore`, `DbUserSkillStore`) 은 **lifespan DI wiring 에서만** import 허용
- 같은 패턴이 입력측 안전 게이트에도 적용 (`_shared/input-safety-gate-ordering.md`)
- 이유: 파일/인메모리 ↔ DB 전환 시 호출자 코드 0줄 수정

## 공통 금지 사항 (언어 무관)

- `data/media/**` / `data/skills/user/**` 에 WriteCoordinator 우회 직접 write
- `data/extracted/**` 같은 디렉토리를 만들어 ground-truth 자체 보관 (외부 도메인 경계 위반 — `_shared/external-domain-boundary.md`)
- user-state overlay 인프라 (`append_op` / `PatchOperation` / `UserStatePort` / `read_merged`) 재도입 — 별도 설계 승인 전 금지
- `WriteCoordinator` 인스턴스 여러 개 생성 (싱글턴 위반)
- 단일 writer 자원을 직접 read API (`json.load` / `serde_json::from_str` on raw file) 로 조회 (Port Protocol/trait 경유)
- 호출자 코드가 concrete 구현체 (`DbSessionStore` / `FileMediaJob` 등) import (Port 만 참조)
- 경로 조립을 직접 (helper 우회) — staticmethod / 정적 함수 단일 source 깨짐
- `data/` ↔ `db/` 상호 import (저장 매체 분리 원칙 깨짐)
