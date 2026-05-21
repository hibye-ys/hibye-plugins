> Language-neutral invariants — Media job lifecycle, retry classification, stale-lease reaper, tenant ownership.
> 정본 (single source of truth) for both Python and Rust harnesses.
> Cited from: `python_agent_rules/media-pipeline-patterns.md`, `rust_agent_rules/media-pipeline-patterns.md`.

# Media Job Lifecycle — 언어 무관 불변식

## 6-state Job Lifecycle

```
queued → running → completed | failed | canceled | dlq
```

| 상태 | 의미 | Terminal? |
|------|------|-----------|
| `queued` | enqueue 직후. port 가 persist + 큐에 id 넣음 | no |
| `running` | worker 가 pickup + handler 호출 직전 | no |
| `completed` | handler 성공 반환 + result_metadata 저장 | yes |
| `failed` | (legacy) handler 예외 — retain for compat. 신규 row 는 `dlq` 사용 | yes |
| `canceled` | DELETE /media/jobs/<id> 로 전이. worker pickup 시 handler skip | yes |
| `dlq` | retry 예산 소진 또는 permanent error | yes |

`TERMINAL_JOB_STATUSES = {completed, failed, canceled, dlq}` — cancel no-op 판정 + worker pickup skip 의 single source.

## 엔드포인트 패턴

```
POST /media/<category>/<op>   → 202 + {job_id, poll_url}
GET  /media/jobs/<job_id>     → MediaJob (전체 필드)
DELETE /media/jobs/<job_id>   → 204 (best-effort cancel)
```

- `<category>` ∈ `{image, audio, video}` (frozenset 하드코드) — 알 수 없는 category 는 400 reject
- `<op>` 예: `generate`, `analyze`, `transcribe` — 점 구분 qualified name (`image.generate`, `audio.transcribe`) 으로 schemas registry 에 등록
- 현재는 모든 op 가 async 202 + poll 패턴

## Storage (Postgres primary, File fallback)

| 구현 | 조건 | 비고 |
|------|------|------|
| DB-backed | `APP_DB_ENABLED=true` (기본값) | **primary** — `media_jobs` 테이블. 트랜잭션이 직렬화 역할 |
| File-backed | `APP_DB_ENABLED=false` | **fallback** — `data/media/jobs/<id>.json` + LRU cache. DB 없이 부팅해야 하는 isolated smoke test 전용 |

**state 쓰기 경로 차이** (single writer 패턴 동일, 메커니즘만 다름):

- DB 모드: 트랜잭션 commit 순서 = 단일 writer
- File 모드: `WriteCoordinator.write_media_job(job_id, ...)` 싱글턴 + per-job lock

## 바이너리 출력 (두 모드 모두 파일)

```
data/media/<job_id>/<filename>   # 예: data/media/job_abc123/output.png
```

- 바이너리는 DB blob 으로 안 담음 (크기 + 스트리밍 이유)
- 항상 `WriteCoordinator.write_media_output(job_id, filename, bytes)` 경유 (single writer)
- `MediaJob.result_path` 에 상대 경로 문자열 저장 (`data/media/<id>/<filename>`). scheme prefix (`file://`) 없음. 미래 signed URL 도입 시 scheme 추가

## 핵심 상수 (언어 무관)

| 상수 | 값 | 의미 |
|------|----|------|
| `STALE_SEC` | 1800 (30분) | claim 후 이 시간 지나면 stale 로 판정 |
| `MAX_ATTEMPTS` | 5 | retry 예산 (분류된 retryable 에러) |
| `MAX_UNKNOWN_ATTEMPTS` | 3 | 분류 안 된 에러의 retry 예산 |
| Backoff 시퀀스 | `10s → 40s → 160s → 640s → 2560s` | exponential ± 25% jitter |
| `_CAT_CAPS` | `{image: 100, audio: 200, video: 50}` | queued 상태 row 개수 상한. 초과 시 429 + `Retry-After: 60` |
| `CATEGORY_CONCURRENCY` | `{image: 2, audio: 3, video: 1}` | per-category worker pool 크기 |

## Stale-lease reaper (orphan 복구)

- 모든 claim 은 `worker_id` + `claimed_at` 을 row 에 기록 (dequeue SQL 이 atomic 하게 증가)
- 부팅 시 + 주기적 (`STALE_SEC/2` = 15분) 으로 `reset_stale_leases(cutoff=now-STALE_SEC)` 실행 — `claimed_at < cutoff` 인 `running` row 를 `queued` 로 복원 (attempt_count 보존, worker_id / claimed_at 초기화)
- handler 가 `STALE_SEC` 넘으면 double-processing 위험 — 향후 heartbeat 도입 예정
- Peer pod 의 live work 는 `claimed_at > cutoff` 이라 untouched — multi-pod safe
- **Handler 는 idempotent 해야 함** (재시작 시 max 1회 추가 실행)

## 테넌트 소유권 (IDOR fix)

- `MediaJob.user_id` — 신규 job 은 `enqueue_job` 라우트가 `caller_identity(auth)` 에서 채움. nullable 은 pre-fix 데이터 호환용 — 신규 생성 시 None 금지
- `GET`/`DELETE /media/jobs/{id}`: 소유자 불일치 + wildcard scope 없으면 **leak-safe 404** (403 금지)
- 구현: `_assert_owner_or_wildcard` (`job.user_id != caller and not has_scope(scopes, "*")` → 404)

## 에러 처리 + 자동 retry

- Worker 는 cancel 시그널 전파 + 핸들러 실패는 분류 후 전이
- **분류 기반 자동 retry** — worker 가 handler 예외를 `classify_error` 로 분류:
  - retryable (429 / 5xx / timeout / connection) → `schedule_retry` + exponential backoff
  - permanent (4xx / validation) → 즉시 `mark_dlq`
  - retry 예산 소진 → DLQ
- LLM 도구 에러 정책 (모델 반환) 은 적용 안 됨 — 미디어는 모델이 호출자가 아님
- 에러 message 는 worker 가 `scrub_secrets` 적용 후 `job.error.message` 에 저장 (SDK exception 에 API key 포함 가능성)

## Job Queue (Postgres-backed)

- thin port wrapper. `subscribe(category)` async iterator (Postgres `LISTEN` / polling fallback) + 모든 transition 메서드 delegate
- 인메모리 큐 **제거됨** — Postgres `media_jobs` 테이블이 source of truth. 재시작 시 작업 손실 없음
- 싱글턴: lifespan 이 하나 만들어 app state 에 저장 — routes + workers 공유. split-brain 방지

## Backpressure (category-별 큐 깊이 상한)

- `_CAT_CAPS = {image: 100, audio: 200, video: 50}` — queued 상태 row 개수 상한. 초과 시 429 + `Retry-After: 60`
- cap 체크 + insert 는 atomic — Postgres advisory lock (`pg_advisory_xact_lock(hashtext('media_jobs_cap:<cat>'))`) 로 category 별 직렬화. TOCTOU 레이스 방지
- `media_workers_enabled=false` + 라우트 활성 상태면 503 `workers_disabled` (P0 gate)

## 응답 전송

- `GET /media/jobs/<id>` 는 `MediaJob` 전체 반환 (status, result_path, result_metadata, error, progress 포함)
- `MediaJob` 필드: id, user_id, op, **category** (required), status, progress, request, result_path, result_metadata, error, **attempt_count**, **next_retry_at**, created_at, updated_at
- `worker_id` / `claimed_at` 는 internal lease 메타데이터 — 응답에 노출 안 됨
- `result_metadata` 스키마는 handler 자유 (`dict[str, object]` / `serde_json::Value`)
- 큰 파일 inline 금지 — 항상 path/URL 만 반환
- SSE 가 없으므로 진행률은 `MediaJob.progress: float (0.0~1.0)` 필드로 노출 — polling 시 확인

## Media vs `/run/<name>` 경계

| 기준 | media 로 | `/run/<name>` 로 |
|------|---------|----------------|
| 출력 타입 | 바이너리 (이미지/오디오/비디오) | 텍스트/구조화 JSON |
| LLM 역할 | 없음 또는 보조 | 주도 |
| 응답 지연 | 수초~수분 | 즉시~수초 |
| 동시성 | 별도 워커풀 필요 | 루프 내 처리 |
| sub-agent 필요 | 거의 없음 | 있을 수 있음 |
| tool_use 기반 의사결정 | 없음 | 있음 |

애매하면 **`/run/<name>` 기본**. media 는 위 조건이 **명백히 충족** 될 때만 도입.

## 공통 금지 사항 (언어 무관)

- 결과물을 HTTP body 로 inline 반환 (반드시 path/URL)
- `WriteCoordinator` 우회한 직접 바이너리 파일 쓰기 (single writer 위반)
- DB 모드에서 transaction 우회한 raw SQL / 직접 execute
- 호출자가 concrete 구현체 import (오직 `MediaJobPort` Protocol/trait 만 참조. lifespan/main 이 유일한 구체 import 지점)
- LLM 루프에서 `/media/*` 를 tool 처럼 HTTP 호출 (필요 시 미디어 전용 도구를 `tools/` 에 추가)
- SSE 이벤트 스트림으로 미디어 결과 전송 (/run vs /media 분리 원칙 위반)
- Handler exception message 를 scrub 없이 `job.error` 에 저장 (API key leak)
- 영속화된 `error.message` 를 scrub 없이 logger 로 emit (이중 leak 경로)
- `job_id` 에 개인정보 / 순차 카운터 사용 (UUID 기반 강제)
- `user_id` 없이 신규 job 생성 (auth context 에서 반드시 주입)
- Job 조회/취소 시 `_assert_owner_or_wildcard` 우회 (leak-safe 404 깨짐)
- 동일 op 를 register_handler 로 두 번 다른 callable 등록 (idempotent 는 같은 callable 만)
