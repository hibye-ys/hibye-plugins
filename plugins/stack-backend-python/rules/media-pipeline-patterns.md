---
paths:
  - "backend/routes/media.py"
  - "backend/services/media/**"
---

> App backend rules — Media pipeline invariants, extension guide, impact map.
> **정본:** `_shared/media-job-lifecycle.md` (6-state lifecycle / stale-lease reaper / IDOR fix / backpressure / retry classification — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `architecture.md` (단일 작성자), `database-patterns.md` (MediaJobPort DB),
>       `data-layer-patterns.md` (바이너리 WriteCoordinator),
>       `error-handling.md` (4 패턴), `api-routing-patterns.md` (routes/media.py)

# media-pipeline-patterns — 미디어 파이프라인

## 불변식 (Invariants)

**경계:** `/run` vs `/media` 분리 원칙에 따라 **외부 SDK 중심 작업** (이미지 생성/분석, 음성 전사, 비디오 처리 등) 만 `/media/*` 로 분리. LLM 루프가 주도하는 건 전부 `/run/<name>`.

**엔드포인트 패턴:**

```
POST /media/<category>/<op>   → 202 + {job_id, poll_url}
GET  /media/jobs/<job_id>     → MediaJob (전체 필드)
DELETE /media/jobs/<job_id>   → 204 (best-effort cancel)
```

- `<category>` ∈ `{image, audio, video}` (`routes/media.py::_ALLOWED_CATEGORIES` 하드코드 frozenset) — 알 수 없는 category 는 400 reject
- `<op>` 예: `generate`, `analyze`, `transcribe` — 점 구분 qualified name (`image.generate`, `audio.transcribe`) 로 schemas registry 에 등록
- 현재는 모든 op 가 async 202 + poll 패턴. 짧은 동기 op 는 아직 없음

**Job 라이프사이클 (6-state):**

```
queued → running → completed | failed | canceled | dlq
```

- `JobStatus = Literal["queued", "running", "completed", "failed", "canceled", "dlq"]` (`types.py:12`)
- **Terminal set**: `TERMINAL_JOB_STATUSES = frozenset({"completed", "failed", "canceled", "dlq"})` (`types.py:17`) — cancel no-op 판정 + worker pickup skip 의 single source
- `dlq` is terminal — set by the worker when retry budget is exhausted or the error is classified as permanent. Distinct from `failed` (legacy; retained for existing-row compat, no new writes)
- `queued`: `JobQueue.enqueue()` 호출 직후. port 가 persist + asyncio.Queue 에 id 넣음
- `running`: worker 가 pickup + handler 호출 직전. **파일 모드에서는 disk 에 persist 안 함** (`file_store.py:146` — crash-restart 시 handler 가 idempotent 해야 한다는 전제로 fsync 1회 절감). **DB 모드는 모든 상태를 transactional commit**
- `completed`: handler 성공 반환 + result_metadata 저장
- `failed`: handler 예외 → `error={code, message}` 기록. **message 는 `scrub_secrets` 경유** (worker.py 의 SDK 예외에 API key 포함 가능성)
- `canceled`: `DELETE /media/jobs/<id>` 로 전이. worker 가 pickup 시 canceled 면 handler skip

**Storage — `MediaJobPort` (Postgres primary, File fallback):**

`backend/data/ports.py::MediaJobPort` Protocol 뒤에 두 구현 공존. 부팅 시 `APP_DB_ENABLED` 로 선택.

| 구현 | 위치 | 조건 | 비고 |
|------|------|------|------|
| `DbMediaJob` | `backend/services/media/db_store.py` | `APP_DB_ENABLED=true` (프로젝트 기본값) | **primary** — `media_jobs` 테이블 (SQLAlchemy 2.0 async). Postgres (dev + prod) 또는 SQLite fallback (CI) |
| `FileMediaJob` | `backend/services/media/file_store.py` | `APP_DB_ENABLED=false` | **fallback** — `data/media/jobs/<id>.json` + LRU cache. DB 없이 부팅해야 하는 isolated smoke test 전용 |

**state 쓰기 경로 차이** (single writer 패턴 동일, 메커니즘만 다름):

- DB 모드: `async with session_scope() as s:` 트랜잭션이 직렬화 역할 — commit 순서 = 단일 writer
- File 모드: `WriteCoordinator.write_media_job(job_id, ...)` 싱글턴 + per-job `asyncio.Lock` — `data-layer-patterns.md` §단일 작성자 준수

**바이너리 출력은 두 모드 모두 파일**:

```
data/media/<job_id>/<filename>   # 예: data/media/job_abc123/output.png
```

- 바이너리는 DB blob 으로 안 담음 (크기 + 스트리밍 이유). 항상 `WriteCoordinator.write_media_output(job_id, filename, bytes)` 경유
- `MediaJob.result_path` 에 상대 경로 문자열 저장 (`data/media/<id>/<filename>`). scheme prefix (`file://`) 없음. 미래 signed URL 도입 시 scheme 추가

**Stale-lease reaper (lease-based orphan 복구):**

- 모든 claim 은 `worker_id` + `claimed_at` 을 row 에 기록 (dequeue SQL 이 atomic 하게 증가)
- 부팅 시 (`main.py` lifespan) + 주기적 (`STALE_SEC/2` = 15분) 으로 `reset_stale_leases(cutoff=now-STALE_SEC)` 실행 — `claimed_at < cutoff` 인 `running` row 를 `queued` 로 복원 (attempt_count 보존, worker_id / claimed_at 초기화)
- `STALE_SEC = 1800` (30분). handler 가 이 시간 넘으면 double-processing 위험 — 향후 heartbeat 도입 예정
- Peer pod 의 live work 는 `claimed_at > cutoff` 이라 untouched — multi-pod safe
- Handler 는 idempotent 해야 함 (재시작 시 max 1회 추가 실행)

**테넌트 소유권 (IDOR fix):**

- `MediaJob.user_id: str | None` — 신규 job 은 `enqueue_job` 라우트가 `caller_identity(auth)` 에서 채움. nullable 은 pre-fix 데이터 호환용 — 신규 생성 시 None 금지
- `GET`/`DELETE /media/jobs/{id}`: 소유자 불일치 + wildcard scope 없으면 **leak-safe 404** (api-routing-patterns.md §인증)
- 구현: `routes/media.py::_assert_owner_or_wildcard` (`job.user_id != caller and not has_scope(scopes, "*")` → `not_found("job", job_id)`)

**Job Queue (Postgres-backed):**

- `JobQueue` (`services/media/job_queue.py`) — thin `MediaJobPort` wrapper. `subscribe(category)` async iterator (Postgres `LISTEN` / polling fallback) + 모든 transition 메서드 delegate
- `asyncio.Queue` **제거됨** — Postgres `media_jobs` 테이블이 source of truth. 재시작 시 작업 손실 없음
- 싱글턴: lifespan 이 하나 만들어 `app.state.media_queue` 에 저장 — routes + workers 공유. split-brain 방지
- **worker 동시성**: per-category 분리 — `CATEGORY_CONCURRENCY = {"image": 2, "audio": 3, "video": 1}` (`worker.py` 모듈 상수). 각 category 가 독립 worker pool 을 가져 rate-limit 프로파일이 다른 SDK 들이 서로 막지 않음. lifespan `start_workers(queue, data_dir)` 이 map 을 소비 (concurrency kwarg 없음)

**에러 처리 (boundary: handler exception → failed job):**

- Worker 는 `except asyncio.CancelledError: raise` 후 `except Exception` — shutdown / timeout 시 CancelledError 전파, handler 실패는 분류 후 전이
- **분류 기반 자동 retry** — worker 가 handler 예외를 `classify_error` 로 분류. retryable (429 / 5xx / timeout / connection) → `schedule_retry` + exponential backoff (10s → 40s → 160s → 640s → 2560s) ± 25% jitter + `Retry-After` 헤더 floor. permanent (4xx / validation) → 즉시 `mark_dlq`. retry 예산 소진 (`MAX_ATTEMPTS=5`, `MAX_UNKNOWN_ATTEMPTS=3`) 도 DLQ. 구현: `backend/services/media/retry.py` + `errors.py`
- LLM 도구 에러 정책 (모델 반환) 은 적용 안 됨 — 미디어는 모델이 호출자가 아님

**응답 전송:**

- `GET /media/jobs/<id>` 는 `response_model=MediaJob` 으로 전체 pydantic 반환 (status, result_path, result_metadata, error, progress 포함)
- `MediaJob` 필드: id, user_id, op, **category** (required), status, progress, request, result_path, result_metadata, error, **attempt_count** (retry 진행 상황), **next_retry_at** (retry schedule), created_at, updated_at. `worker_id` / `claimed_at` 는 internal lease 메타데이터 — 응답에 노출 안 됨
- `result_path` 는 상대 경로 문자열. 외부 노출 환경에서는 signed URL (S3 presigned) 로 교체 권장 — 현재는 dev / single-worker 전제
- `result_metadata` 스키마는 handler 자유 (`dict[str, object]`). 현재 stub 은 `{content_type, size_bytes, filename}` 반환. 이미지/오디오 handler 추가 시 `{width, height, duration_sec, ...}` 확장
- 큰 파일 inline 금지 — 항상 path/URL 만 반환

**인증 / rate limit:**

- `/media/*` 는 `/run/*` 과 동일한 `Depends(require_auth)` — JWT + API 키 이중 인증
- rate limit 은 현재 **전역 `RateLimitMiddleware` 만** (media 전용 정책 없음). 실 SDK handler 가 붙어 비용 프로파일이 명확해지면 category/op 별 분리 검토
- quota 초과 → 429 + `retry_after_ms` (middleware 가 직접 변환)

**Backpressure (category-별 큐 깊이 상한):**

- `_CAT_CAPS = {"image": 100, "audio": 200, "video": 50}` (`routes/media.py`) — queued 상태 row 개수 상한. 초과 시 `POST /media/<cat>/<op>` 가 429 + `Retry-After: 60`
- cap 체크 + insert 는 atomic — Postgres `pg_advisory_xact_lock(hashtext('media_jobs_cap:<cat>'))` 로 category 별 직렬화. TOCTOU 레이스 방지. SQLite 는 엔진 레벨 write serialization 으로 자동 처리
- `media_workers_enabled=false` + 라우트 활성 상태면 503 `workers_disabled` (P0 gate — lifespan 이 `app.state.media_workers_enabled` 설정)

**프로바이더 통합 (미래):**

- 이미지 SDK (DALL-E, Stable Diffusion, Imagen 등) 는 `services/media/<op>.py` 의 handler 내부에서 래핑. `providers/media/` 디렉토리는 현재 없음 — handler 당 self-contained
- provider 선택 로직은 LLM `providers/` 의 fallback chain 과 **별도 구조** — 미디어는 모델이 다르고 capabilities 도 다름
- API key 는 `config-management.md` 의 `${VAR}` 패턴 그대로 재사용 (MCP/providers YAML 과 동일)

**관측성 (실제 로그 네이밍):**

- dot-notation 사용: `media.worker.start`, `media.worker.stop`, `media.worker.handler_failed`, `media.worker.skip_canceled`, `media.worker.missing_job`, `media.worker.unexpected_error`, `media.stub.image_generate`
- `media.worker.handler_failed` 는 `logger.exception` 으로 stack trace 포함 (내부 debug 용, 클라이언트 응답의 `error.message` 와는 별개)
- `media.startup_stale_reset_count` (INFO, boot 시)
- `media.stale_leases_reaped` (WARNING, 주기적 reaper 가 row 복원 시)
- `media.stale_reaper_error` (ERROR, reaper 예외)
- `media.job.retry_scheduled` (INFO, schedule_retry 성공 시)
- `media.job.dlq` (WARNING, mark_dlq 시 — `reason: permanent | exhausted | crash_loop`)
- `media.queue.full` (WARNING, 429 응답 시)
- `media.stale_terminal_write` (WARNING, claim guard fail → stale worker 의 결과 drop 시)
- structlog ContextVar (`request_id` / `user_id` 등 `core-infrastructure.md` §ContextVar 10 필드) 가 자동 주입
- SSE 가 없으므로 진행률은 `MediaJob.progress: float (0.0~1.0)` 필드로 노출 — polling 시 확인

## 새 미디어 op 추가하기

**Schema-first 원칙:** `backend/services/media/schemas.py` 에 `<Op>Params` 등록해야 enqueue 허용. 미등록 op 는 `routes/media.py::enqueue_job` 이 400 `unknown_op` 로 reject (boot-time safety).

1. `services/media/<op>.py` 에 handler `async def run(job: MediaJob, data_dir: Path) -> dict[str, object]` 구현 (result_metadata 반환, 실패는 raise)
2. 요청 `<Op>Params` / 응답 `<Op>Result` pydantic 모델 선언 (입력 검증 + 응답 스키마)
3. `services/media/schemas.py::register_default_schemas()` 에 `register_schema("<category>.<op>", <Op>Params)` 추가 — qualified name 은 **점 구분** (`image.generate`, `audio.transcribe`)
4. `services/media/handlers.py::register_default_handlers()` 에 `register_handler("<category>.<op>", <handler>)` 추가. idempotent 보장 (같은 callable 재등록 OK, 다른 callable 덮어쓰기는 `RuntimeError`)
5. 외부 SDK 호출 래핑 — 에러 message 는 worker 가 `scrub_secrets` 적용 후 job.error 에 저장
6. `routes/media.py` 는 **라우트 추가 불필요** — `POST /media/<category>/<op>` 가 qualified op 기반 dispatch
7. `services/media/worker.py` 는 **변경 불필요** — handler registry lookup 기반
8. category 별 workers concurrency 조정 필요 시 `worker.py::CATEGORY_CONCURRENCY` map 수정 (per-category 분리 기구현)
9. 바이너리 출력은 반드시 `WriteCoordinator.write_media_output(job.id, filename, bytes)` 경유
10. 테스트: 정상 job (queued→running→completed), retryable 에러 (retry→dlq 소진), permanent 에러 (즉시 dlq), 취소 (canceled), 동시성 (N 개 병렬), stale-lease reaper (running→queued 복원). DB 모드 + 파일 모드 parametrize
11. `.env.example` 에 필요한 API key 항목 추가

## Media vs `/run/<name>` 경계 판단

| 기준 | media 로 | `/run/<name>` 로 |
|------|---------|----------------|
| 출력 타입 | 바이너리 (이미지/오디오/비디오) | 텍스트/구조화 JSON |
| LLM 역할 | 없음 또는 보조 | 주도 |
| 응답 지연 | 수초~수분 | 즉시~수초 |
| 동시성 | 별도 워커풀 필요 | 루프 내 처리 |
| sub-agent 필요 | 거의 없음 | 있을 수 있음 |
| tool_use 기반 의사결정 | 없음 | 있음 |

애매하면 **`/run/<name>` 기본**. media 는 위 조건이 **명백히 충족** 될 때만 도입.

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `APP_DB_ENABLED` 기본값 변경 | 부팅 시 MediaJobPort 구현체 선택 — 기존 dev 환경 `.env` 없으면 분기 뒤바뀜 |
| `MediaJobPort` 시그니처 변경 | `DbMediaJob` + `FileMediaJob` + test fixture 동시 업데이트 |
| Job 상태 enum 추가 | `JobStatus` Literal + `TERMINAL_JOB_STATUSES` + 폴링 클라이언트 + 모니터링 |
| `data/media/<id>/<filename>` 바이너리 경로 변경 | `WriteCoordinator.write_media_output` + 기존 완료 job 의 `result_path` 호환성 |
| JobQueue 구현 변경 (Postgres → Redis 등) | Port 시그니처 유지하며 subscribe() 구현체 교체. stale-lease reaper 는 별도 재설계 필요 |
| signed URL 도입 | 클라이언트 파일 접근 방식 변경 — `result_path` scheme 추가 |
| `CATEGORY_CONCURRENCY` map 변경 | 외부 SDK rate limit 히트 빈도. 값 줄이면 처리량 감소, 늘리면 과부하 위험 |
| retry 정책 (`MAX_ATTEMPTS` / backoff 상수) 변경 | 비용 / 중복 과금 / 사용자 체감 지연. provider-patterns retry 정책과 정합 필수 |
| `scrub_secrets` 제거 | SDK exception 에 포함된 API key / 토큰 leak 재발 |
| `STALE_SEC` 변경 | 너무 짧으면 live work 를 stale 로 오판 + double-processing. 너무 길면 장애 복구 지연 |
| `_CAT_CAPS` 변경 | 큐 깊이 상한 변화 → 클라이언트 429 빈도 변화 |

## 금지 사항

- 결과물을 HTTP body 로 inline 반환 (반드시 path/URL)
- `WriteCoordinator` 우회한 직접 바이너리 파일 쓰기 (single writer 위반)
- DB 모드에서 `session_scope` 우회한 raw SQL / 직접 execute (`database-patterns.md` §StoragePort)
- 호출자가 `DbMediaJob` / `FileMediaJob` 구체 구현체 import (오직 `MediaJobPort` Protocol 만 참조. main.py lifespan 이 유일한 구체 import 지점)
- LLM 루프에서 `/media/*` 를 tool 처럼 HTTP 호출 (에이전트가 필요하면 **미디어 전용 도구** 를 `tools/` 에 추가해서 내부에서 `services/media` 직접 호출)
- SSE 이벤트 스트림으로 미디어 결과 전송 (/run vs /media 분리 원칙 위반)
- Handler exception message 를 scrub_secrets 없이 `job.error` 에 저장 (API key leak)
- Job 영속화된 `error.message` 를 scrub 없이 structlog 로도 emit (이중 leak 경로)
- `job_id` 에 개인정보 / 순차 카운터 사용 — `new_prefixed_id("job")` (UUID 기반) 강제
- `user_id` 없이 신규 job 생성 (auth context 에서 반드시 주입)
- Job 조회/취소 시 `_assert_owner_or_wildcard` 우회 (leak-safe 404 깨짐)
- 동일 op 를 `register_handler` 로 두 번 다른 callable 등록 (idempotent 는 같은 callable 만)
