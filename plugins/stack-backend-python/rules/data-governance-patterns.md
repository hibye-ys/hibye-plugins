---
paths:
  - "backend/services/governance/**"
  - "backend/services/audit/**"
  - "backend/routes/governance.py"
  - "backend/cli/governance_hard_delete.py"
---

> App backend rules — Data Governance (right-to-erasure + export + audit) Phase 1 invariants.
> 관련: `database-patterns.md` (StoragePort + iyaki 경계), `data-layer-patterns.md` (single writer),
>       `media-pipeline-patterns.md` (job queue 패턴 재사용), `api-routing-patterns.md` (auth + 410 envelope),
>       `error-handling.md` (`user_data_pending_deletion` → HTTP 410)

# data-governance-patterns — GDPR/PIPA Right-to-Erasure + Export + Audit

## 불변식 (Invariants)

**6 audit event taxonomy (Phase 1 — 고정):**

`backend/services/audit/log.py::AuditEventName` Literal — 6개:
- `data.export_requested` — POST /users/me/data/export 진입 시 (route handler)
- `data.exported` — export 작업 완료 (worker)
- `data.delete_requested` — POST /users/me/data/delete 진입 시
- `data.delete_soft_executed` — soft delete 트랜잭션 내부 (worker)
- `data.delete_cancelled` — DELETE /users/me/data/jobs/{id} 취소
- `data.delete_hard_executed` — 하드 삭제 CLI 실행 (`backend/cli/governance_hard_delete.py`)

추가 운영 이벤트 (`governance.hard_delete_oversized`, `governance.stream_aborted`, `governance.delete_lock_contended`) 은 **structlog 만** — `audit_log` 테이블 대상 아님 (taxonomy 고정 보호).

**Append-only audit_log (`ai_backend.audit_log`):**

- Postgres: `BEFORE UPDATE OR DELETE` trigger 가 `RAISE EXCEPTION` (마이그레이션 0012)
- SQLite fallback: 앱 레이어 규율 — `services/audit/log.py` 는 INSERT 와 SELECT 만 발행, UPDATE/DELETE 코드 없음
- `emit_audit_event` 가 유일한 INSERT 진입점. `request_id` 는 structlog contextvars 에서 자동 읽음
- 보존 기간: 7년 (한국 PIPA archive 의무). Phase 2 retention scheduler 가 audit_log 는 건드리지 않음
- 사용자 erasure 요청에도 audit_log 는 보존 — GDPR Art. 17(3)(e) / PIPA 21조 1항 (preservation > erasure for legal compliance)

**User-facing read API (`GET /users/me/data/audit-log`, Phase 1 add-on 2026-04-26):**

- `services/audit/log.py::query_user_audit_log(s, *, user_id, limit, before_id)` — 단일 read 진입점. `WHERE user_id = ? ORDER BY id DESC LIMIT N` (cursor: `WHERE id < before_id`)
- `routes/governance.py::list_audit_log` — owner-scoped (user_id 는 `caller_identity(auth)` 에서만 binding, query parameter override 없음). 응답 `AuditLogPage{entries, next_before_id}` — full page 시 cursor set, 짧은 page 면 `None`
- 사용자 노출 fields: `id / event / resource_type / resource_id / metadata / created_at`. 의도적 제외: `actor_user_id`, `request_id` (operator-only)
- Anonymous: `require_auth` 가 거부 (audit log 는 per-identity, ANONYMOUS_USER_ID 공유 → 다른 anon 트래픽과 conflate 위험)
- Admin overload (`GET /admin/audit-log?user=...`) 미구현 — 별도 ACL surface 필요 (별도 cycle)
- 인덱스: 현재 `(user_id, created_at)` + `(event, created_at)`. 실제 query 는 `id DESC` 정렬이라 sort 발생 — per-user 데이터 누적 시 `(user_id, id)` composite index 추가 후속 cycle 후보

**Soft delete + 7-day grace + Hard delete:**

- soft delete 후 7일 (`DEFAULT_GRACE_DAYS = 7`, `services/governance/types.py`) 간 사용자가 cancel 가능 (`DELETE /users/me/data/jobs/{id}`)
- 7일 경과 후 hard delete CLI (`python -m backend.cli.governance_hard_delete --user-id <id>`) 가 실행. Phase 2 에서 scheduler 로 대체
- `--force` 플래그 — 7일 cutoff + 50k threshold 우회 (ops 비상용)
- `--dry-run` — 실제 쓰기 없이 plan 출력
- 50k message threshold (`HARD_DELETE_MESSAGE_LIMIT = 50_000`) 초과 시 CLI 거부 + `governance.hard_delete_oversized` structlog 이벤트

**Tombstone semantics:**

- `tombstoned_at: datetime | None` 컬럼 4 곳: `sessions`, `user_skills`, `media_jobs`, `iyaki_mutations`
- 모든 read 경로 (`get`/`try_get`/`list_*`/`count_queued`/`soonest_retry`/`dequeue`/`record_turn`/`get_messages` 등) 는 `WHERE tombstoned_at IS NULL` 필터. **단일 source of truth**: 14+ 메서드 — 상세 enumeration 은 `data-governance-phase1-design.md` §4.3
- 변형 (mutation) 메서드는 tombstoned 행에 대해 `ResourceError("session_tombstoned")` raise — 호출자가 410 envelope 으로 변환
- `delete` 메서드는 SKIP 필터 (idempotent)
- claim-guarded writers (`schedule_retry`, `mark_dlq`, `mark_completed`, `update_progress`) + `cancel` + `reset_stale_leases` 는 SKIP — 이미 worker_id/attempt_count 로 보호되어 있고, `dequeue` 가 tombstoned 를 안 잡으므로 자연 차단

**iyaki_mutations 특수 처리 (raw SQL, no ORM):**

- `session_id` 만 가지고 `user_id` 없음 — JOIN sessions 로 사용자 추적
- soft delete 시 raw SQL 로:
  ```
  UPDATE iyaki_mutations
     SET original_session_id = session_id,
         session_id = '__TOMBSTONED__',
         tombstoned_at = now()
   WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)
     AND tombstoned_at IS NULL
  ```
- `TOMBSTONE_SESSION_SENTINEL = '__TOMBSTONED__'` constant (`backend/constants.py`) 모든 사이트 공유
- iyaki_rollback 도구는 **per-row ACL guard**: `if mutation.session_id == TOMBSTONE_SESSION_SENTINEL: skip with reason ROLLBACK_UNAVAILABLE_TOMBSTONED` — 혼합 batch 에서 honest rollback 은 영향 없음
- hard delete: `WHERE session_id = '__TOMBSTONED__' AND tombstoned_at < cutoff` (cross-user 안전 — 다른 deleted 유저의 tombstoned row 영향 없음 because cutoff 별로 분리)
- Phase 2 에서 hard-delete 후 rollback 영구 불가 (수용된 trade-off — post-erasure)

**WriteCoordinator 단일 writer (filesystem):**

- `data/skills/user/<user_id>/<skill_id>.md` 쓰기/삭제 → `WriteCoordinator.write_user_skill` / `delete_user_skill`
- `data/media/<job_id>/**` 쓰기 → 기존 미디어 라이터, 삭제 → `WriteCoordinator.delete_media_artifacts(job_id)` (T4a 추가)
- hard delete CLI 는 위 두 경로 외 `os.unlink` / `shutil.rmtree` 직접 호출 금지 — 정적 grep 테스트로 enforce (`test_hard_delete_no_direct_fs_calls`)

**SessionAbortRegistry (in-process, lifespan-scoped):**

- `app.state.session_abort_registry` 단일 인스턴스 (`backend/services/governance/abort_registry.py`)
- `_stream_agent` (`routes/run.py`) 는 stream 시작 시 `register(session_id)`, 종료 시 `unregister(session_id)`
- soft delete worker (`services/governance/delete.py::run_soft_delete`) 가 user 의 모든 session_id 에 대해 `signal_abort(session_ids)` 호출 — 트랜잭션 커밋 BEFORE (audit row 의 `streams_aborted` 카운트 메타데이터 보존)
- 활성 SSE stream 은 abort signal 받으면 `error` 이벤트 emit (`code: user_data_pending_deletion`) 후 종료
- 프로세스 재시작 시 registry 손실 OK — SSE 연결도 같이 끊어짐, abort 소비자 없음
- Abort wiring 위치: **HTTP wrapper (`_stream_agent`)** — 6-stage loop invariant 보호, abort 는 HTTP 표면 관심사

**Centralized assert_user_active gate:**

- `backend/services/governance/check.py::assert_user_active(user_id, *, db_session)` — 단일 source of truth for write-block during 7-day grace
- 호출 위치 (4 곳):
  1. `routes/run.py::dispatch_run` (ensure_session 전)
  2. `routes/skills.py` create/update/delete
  3. `routes/media.py::create_job` (workers_disabled 체크 전)
  4. `routes/run.py::resume_run_stream` (SSE Resilience Phase 1 추가) — tombstoned 사용자 410 Gone. resume 은 read-shape 이지만 활성 stream 합류는 데이터 access 면이므로 grace 동안 차단
- Anonymous user (`ANONYMOUS_USER_ID`) → skip (anon 은 tombstone 대상 아님)
- DB engine 미부팅 (lifespan 우회 테스트 경로) → defensive no-op

**Idempotency partial unique index (Postgres only):**

```
CREATE UNIQUE INDEX uq_gov_jobs_active_per_user_op
  ON governance_jobs (user_id, op)
  WHERE status IN ('queued', 'running')
```

- 중복 POST → `IntegrityError` → port 가 catch + 기존 row 반환 (200, not 201)
- SQLite path: 부분 unique index 미지원 — 앱 레이어 가드 + 테스트로 enforce

**Lock_project advisory lock (iyaki domain integration):**

- soft delete 가 user 의 각 project 에 대해 `pg_try_advisory_xact_lock` (5s timeout × 3 retry)
- 충돌 시 `governance.delete_lock_contended` structlog 이벤트 + 다음 worker iteration 으로 미루기
- iyaki 쓰기와 같은 lock namespace (SHA-256("iyaki:project:<id>") 앞 8바이트)

## 새 audit event 추가하기

1. `services/audit/log.py::AuditEventName` Literal 에 새 값 추가
2. `AUDIT_EVENTS` tuple 동시 업데이트
3. `observability/events.py` 에 TypedDict 스키마 + EVENT_SCHEMA 등록
4. 호출자가 `emit_audit_event(event="<new>", ...)` 사용
5. 7년 보존 + append-only 불변식 유지

운영 메트릭 / 에러 카운터는 **structlog 이벤트로** (audit_log 테이블 X) — 6 audit event taxonomy 보호.

## 새 read 메서드 추가 시

`backend/data/ports.py` Protocol 에 메서드 추가 시:
1. tombstone 적용 여부 결정 — 리소스가 사용자 데이터면 필터 필수
2. DB 구현체 + InMemory 구현체 동시 업데이트 (parity)
3. parametrized 테스트 추가 — `tests/test_tombstone_filter.py` 매트릭스에 합류
4. Protocol docstring 에 tombstone 의도 명시

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 6 audit event 추가/삭제 | `AuditEventName` Literal, observability/events.py EVENT_SCHEMA, 호출 사이트 (routes/governance.py + worker.py + cli/) |
| `tombstoned_at` 필드 추가 (새 테이블) | Alembic migration + ORM model + DB/InMemory 구현체 + tombstone_filter 테스트 매트릭스 |
| `DEFAULT_GRACE_DAYS` 변경 (7 → N) | hard delete CLI cutoff + Phase 2 scheduler + privacy policy 문서 + UI 표시 |
| `HARD_DELETE_MESSAGE_LIMIT` 변경 | CLI 거부 임계 + 운영 alert (Phase 2) |
| audit_log 트리거 제거 | UPDATE/DELETE 가능해짐 — 데이터 무결성 손실 위험 (compliance 위반) |
| `TOMBSTONE_SESSION_SENTINEL` 값 변경 | iyaki_mutations 의 모든 hard-delete WHERE 절 + iyaki_rollback ACL guard 동시 변경 |
| `assert_user_active` 호출 사이트 누락 | 새 write 경로가 410 gate 우회 → 사용자가 grace 중 데이터 생성 가능 (compliance 갭) |
| WriteCoordinator filesystem 경로 우회 | 단일 writer 깨짐 — 정적 grep 테스트가 차단 |
| SessionAbortRegistry lifespan 누락 | 새 SSE handler 가 register/unregister 안 하면 abort signal 무효 |
| iyaki_rollback ACL guard 제거 | tombstoned 사용자의 audit row 가 다른 사용자에 의해 rollback 가능 (cross-user ACL 위반) |

## 금지 사항

- audit_log 에 UPDATE / DELETE (Postgres trigger + 앱 규율 양쪽으로 보호)
- 6 audit event 외 다른 이름을 `audit_log` 테이블에 INSERT — 운영 이벤트는 structlog 으로
- tombstoned 행을 read 경로에서 보이게 하기 (read 메서드 누락 = compliance 갭)
- hard delete 시 `os.unlink` / `shutil.rmtree` 직접 호출 — 반드시 `WriteCoordinator` 경유
- iyaki_mutations 의 sentinel `__TOMBSTONED__` 외 다른 값으로 tombstone 표시 (iyaki_rollback ACL 깨짐)
- soft delete 트랜잭션 밖에서 audit emit (rollback 시 audit row 보존 → 일관성 깨짐)
- assert_user_active 우회 (write 경로에서 갭 = compliance 위반)
- `governance_jobs` 의 status='hard_deleted' 인 row 를 다시 INSERT/UPDATE — terminal state
- audit_log retention 7년 미만 (한국 PIPA 위반)
- DEFAULT_GRACE_DAYS < 7 (GDPR 산업 표준 미준수)
- ANONYMOUS_USER_ID 의 export / delete 허용 (식별 불가능 → 422 anonymous_not_allowed)
- abort registry 를 module-level global 로 (lifespan 우회 — 테스트 격리 깨짐)
- abort registry signal_abort 를 트랜잭션 커밋 후로 미루기 (audit row 의 streams_aborted 카운트 누락)
