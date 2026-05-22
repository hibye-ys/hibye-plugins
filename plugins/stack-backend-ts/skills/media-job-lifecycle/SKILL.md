---
name: media-job-lifecycle
description: Media job 상태 전이 monotone 보장 (pending → processing → succeeded|failed|canceled|dlq), jobId = idempotency key, terminal 후 result immutable, canceled = soft signal. MediaJobStatus 정본 + TERMINAL_JOB_STATUSES (언어 무관). 위반 = 즉시 차단.
metadata:
  role: invariant
  scope: apps/api
  source: stack-backend-python/rules/_shared/media-job-lifecycle.md
---

> Language-neutral invariants — Media job lifecycle, retry classification, stale-lease reaper, tenant ownership.
> 정본 (single source of truth) for Python harness, TS / Hono harness, 그리고 미래 Rust harness.
> Cited from: `stack-backend-python/rules/_shared/media-job-lifecycle.md`, `stack-backend-python/rules/media-pipeline-patterns.md`, `stack-backend-ts/skills/media-pipeline-patterns/SKILL.md`.

# Media Job Lifecycle — 언어 무관 불변식

(slug: `media-job-lifecycle` — workflow 의 `media-pipeline-patterns` 와 구분)

> **Storage 추상화 용어**
> - **object storage**: 바이너리를 보관하는 외부 객체 저장소. 예: Cloudflare R2, AWS S3, GCS. Instance 측에서 구체 binding/SDK 선택.
> - **key-value cache**: 작고 빠른 KV 저장소. 예: Workers KV, Redis, Upstash.

## 검증 대상 invariant 4건

### Invariant 1: 상태 전이 monotone — 역행 금지

```
pending (= queued) → processing (= running) → succeeded (= completed) | failed | canceled | dlq
```

- **역행 금지**: terminal → pending, processing → pending (단, stale-lease reaper 예외 — 아래 참조), succeeded → processing 등 일체 금지
- **점프 금지**: pending → succeeded 직접 전이 ✕ (반드시 processing 거침)
- 단, **`STALE_SEC` 초과한 running lease 의 reaper 복원** (`running` → `queued`, `attemptCount` 보존) 은 의도된 예외 — orphan 복구이지 정상 흐름의 역행이 아님

### Invariant 2: `jobId` = idempotency key — 재시도 멱등

- 동일 `jobId` 로 enqueue 호출 = noop (기존 job 반환). 새 job 생성 ✕
- 동일 `jobId` 로 worker 가 다시 pickup 해도 result 가 달라지면 안 됨 (handler idempotent 의무)
- 클라이언트 retry 시 새 `jobId` 발급하지 말고 기존 `jobId` 로 polling

### Invariant 3: terminal 후 result immutable

- `status ∈ TERMINAL_JOB_STATUSES` 이면 `result` / `resultPath` / `resultMetadata` / `error` 필드 **변경 ✕**
- 변경이 필요한 경우 = **새 job 생성** (새 `jobId`)
- DB 모드: terminal row 에 UPDATE 시 `WHERE status IN (terminal)` 조건 + check constraint 또는 `RETURNING` 검증으로 차단
- KV 모드: WriteCoordinator 가 terminal guard 검증 후 stale write drop (`media.stale_terminal_write` 경고)

### Invariant 4: canceled = soft signal

- `DELETE /media/jobs/<id>` 호출은 **즉시 종료 보장 ✕**. `canceled` 상태 set + worker 의 **다음 checkpoint** 에서 종료
- worker 는 pickup 시 / checkpoint 마다 status 확인 — `canceled` 면 handler skip 또는 cooperative cancel
- 강제 종료 = `AbortController.abort()` cascade 도 가능하지만 **외부 SDK 호출 중간에는 강제 중단 불가** — best-effort 정책
- terminal set 에 포함됨 (`TERMINAL_JOB_STATUSES`) — 일단 `canceled` 면 추가 전이 ✕

## TypeScript 표현 (src/media)

```typescript
// src/media/types.ts
export type MediaJobStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'dlq';

export interface MediaResult {
  resultPath?: string;                                  // object storage key
  resultMetadata?: Record<string, unknown>;
}

export interface MediaJob {
  jobId: string;                                        // crypto.randomUUID() 기반 + 'job_' prefix
  userId: string | null;
  category: 'image' | 'audio' | 'video';
  op: string;                                           // qualified name (e.g. 'image.generate')
  status: MediaJobStatus;
  attemptCount: number;
  nextRetryAt: string | null;                           // ISO 8601
  request: Record<string, unknown>;                     // op-specific params
  result?: MediaResult;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export const TERMINAL_JOB_STATUSES: ReadonlyArray<MediaJobStatus> = [
  'succeeded',
  'failed',
  'canceled',
  'dlq',
] as const;

export function isTerminal(status: MediaJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}
```

### 6-state ↔ 본 invariant 의 매핑

본 invariant 가 정의한 6 상태 (`MediaJobStatus` = pending / processing / succeeded / failed / canceled / dlq) 는 **외부 API contract**. `media-pipeline-patterns` workflow 의 6 internal stage (queued / running / completed / failed / canceled / dlq) 와 다음과 같이 매핑:

| 본 invariant `MediaJobStatus` (external) | workflow `InternalJobStage` (internal) | 비고 |
|----------------------------------------|---------------------------------------|------|
| `pending` | `queued` | enqueue 직후 |
| `processing` | `running` | worker pickup + handler 호출 직전 |
| `succeeded` | `completed` | handler 성공 |
| `failed` | `failed` | handler 예외 (legacy 경로) |
| `canceled` | `canceled` | DELETE 트리거, soft signal |
| `dlq` | `dlq` | retry 예산 소진 또는 permanent error |

> 매핑 함수 = `toExternalStatus(stage: InternalJobStage): MediaJobStatus` (workflow skill `media-pipeline-patterns` 정의). DB column / worker queue 는 `InternalJobStage` 사용, 외부 응답은 `MediaJobStatus`. 본 invariant 의 4 invariant (monotone / idempotency / immutable / soft cancel) 는 두 vocabulary 모두에 적용 — terminal set 도 6 stage 모두 포함 (`TERMINAL_JOB_STATUSES` ⊇ `succeeded` / `failed` / `canceled` / `dlq`, `TERMINAL_INTERNAL_STAGES` ⊇ `completed` / `failed` / `canceled` / `dlq`).

## 위반 = 즉시 차단

다음 코드는 **PR / CI 시 차단**:

```typescript
// ✕ pending → succeeded 직접 점프 (Invariant 1 위반)
await db.update(mediaJobs).set({ status: 'succeeded', result }).where(eq(mediaJobs.id, jobId));
// (이 row 의 status 가 'pending' 이었으면 → CHECK constraint 또는 transition guard 가 reject)

// ✕ terminal → pending 역행 (Invariant 1 위반, reaper 예외 제외)
await db.update(mediaJobs).set({ status: 'pending' }).where(eq(mediaJobs.id, jobId));

// ✕ 동일 jobId 에 다른 result write (Invariant 3 위반)
const job = await getJob(jobId);
if (job.status === 'succeeded') {
  await db.update(mediaJobs).set({ result: differentResult }).where(eq(mediaJobs.id, jobId));
}

// ✕ canceled 강제 즉시 종료 (Invariant 4 위반 — soft signal 이어야 함)
await killWorkerHandler(jobId);                       // 외부 SDK 가 중간에 cancel 안 됨
```

### 정상 코드

```typescript
// ✅ 상태 전이는 trasition function 경유 (CHECK 와 guard 둘 다)
export async function transitionJob(
  db: Database,
  jobId: string,
  from: MediaJobStatus,
  to: MediaJobStatus,
): Promise<void> {
  if (isTerminal(from)) {
    throw new Error(`cannot transition out of terminal status: ${from} → ${to}`);
  }
  const updated = await db
    .update(mediaJobs)
    .set({ status: to, updatedAt: new Date().toISOString() })
    .where(and(eq(mediaJobs.id, jobId), eq(mediaJobs.status, from)))
    .returning({ id: mediaJobs.id });
  if (updated.length === 0) {
    throw new Error(`stale transition: ${jobId} not in expected status ${from}`);
  }
}

// ✅ result write 는 transition 과 atomic
export async function completeJob(
  db: Database,
  jobId: string,
  result: MediaResult,
): Promise<void> {
  await db.transaction(async (tx) => {
    await transitionJob(tx, jobId, 'processing', 'succeeded');
    await tx.update(mediaJobs).set({ result }).where(eq(mediaJobs.id, jobId));
  });
}

// ✅ cancel 은 status set 만, handler kill 시도 ✕
export async function cancelJob(db: Database, jobId: string): Promise<void> {
  await db
    .update(mediaJobs)
    .set({ status: 'canceled', updatedAt: new Date().toISOString() })
    .where(and(eq(mediaJobs.id, jobId), notInArray(mediaJobs.status, [...TERMINAL_JOB_STATUSES])));
  // worker 가 다음 checkpoint 에서 status 확인 + skip
}
```

## 핵심 상수 (언어 무관 — 권장 기본값)

| 상수 | 권장값 | 의미 |
|------|--------|------|
| `STALE_MS` | 1_800_000 (30분) | claim 후 이 시간 지나면 stale 로 판정 + reaper 복원 |
| `MAX_ATTEMPTS` | 5 | retry 예산 (분류된 retryable 에러) |
| `MAX_UNKNOWN_ATTEMPTS` | 3 | 분류 안 된 에러의 retry 예산 |
| Backoff 시퀀스 | `10s → 40s → 160s → 640s → 2560s` | exponential ± 25% jitter |
| `CATEGORY_CAPS` | `{ image: 100, audio: 200, video: 50 }` | queued 상태 row 개수 상한. 초과 시 429 + `Retry-After: 60`. **권장 기본값** — instance 별로 부하 / SLA 에 따라 override 가능, 본 invariant 의 *권장값* 이며 절대 상한 아님 |
| `CATEGORY_CONCURRENCY` | `{ image: 2, audio: 3, video: 1 }` | per-category worker pool 크기. **권장 기본값** — instance 별로 부하 / SLA 에 따라 override 가능, 본 invariant 의 *권장값* 이며 절대 상한 아님 |

## Instance 별 override

본 invariant 의 핵심 상수 (`STALE_MS` / `MAX_ATTEMPTS` / `CATEGORY_CAPS` / `CATEGORY_CONCURRENCY`) 의 *권장값* 은 본 plugin 에 명시. Instance 별로 부하 / SLA 에 따라 다른 값 사용 가능 — 변경 시 본 invariant 참조 + instance 측 코드에 *명시적 override* 표시 (commit 메시지 + 상수 정의 옆 주석).

단, 다음은 **override 금지** — invariant 의 구조적 보장:
- 6-state 자체 (pending/processing/succeeded/failed/canceled/dlq) — 상태 추가 / 제거 ✕
- 4 Invariants (monotone / idempotency / terminal immutable / soft cancel) — 의미 약화 ✕
- terminal set (`TERMINAL_JOB_STATUSES`) 멤버 변경 ✕

## Stale-lease reaper (Invariant 1 예외)

- 모든 claim 은 `workerId` + `claimedAt` 을 row 에 기록 (dequeue SQL 이 atomic 하게 증가)
- 부팅 시 + 주기적 (스케줄러 — 예: cron `*/15 * * * *`) 으로 `resetStaleLeases(cutoff = now - STALE_MS)` 실행 — `claimedAt < cutoff` 인 `running` (= `processing`) row 를 `queued` (= `pending`) 로 복원 (`attemptCount` 보존, `workerId` / `claimedAt` 초기화)
- 본 invariant 1 의 monotone 규칙의 **유일한 예외** — orphan 복구이지 정상 흐름의 역행이 아님
- Handler 는 idempotent 해야 함 (재시작 시 max 1회 추가 실행) — Invariant 2 의 idempotency key 와 일관

## 테넌트 소유권 (IDOR fix)

- `MediaJob.userId: string | null` — 신규 job 은 enqueue 라우트가 auth context 에서 채움. nullable 은 pre-fix 데이터 호환용 — 신규 생성 시 `null` 금지
- `GET` / `DELETE /media/jobs/{id}`: 소유자 불일치 + wildcard scope 없으면 **leak-safe 404** (403 금지 — 존재 자체를 leak 하지 않음)
- 구현: `assertOwnerOrWildcard` (`job.userId !== caller && !hasScope(scopes, '*')` → 404)

## 에러 처리 + 자동 retry

- Worker 는 cancel 시그널 전파 (`AbortSignal`) + 핸들러 실패는 분류 후 전이
- **분류 기반 자동 retry** — worker 가 handler 예외를 `classifyError` 로 분류:
  - retryable (429 / 5xx / timeout / connection) → `scheduleRetry` + exponential backoff
  - permanent (4xx / validation) → 즉시 `markDlq`
  - retry 예산 소진 → DLQ
- LLM 도구 에러 정책 (모델 반환) 은 적용 안 됨 — 미디어는 모델이 호출자가 아님
- 에러 message 는 worker 가 `scrubSecrets` 적용 후 `job.error.message` 에 저장 (SDK exception 에 API key 포함 가능성)

## 공통 금지 사항 (언어 무관)

- 상태 전이 monotone 위반 (역행 / 점프) — Invariant 1
- 동일 `jobId` 로 신규 row 중복 생성 — Invariant 2
- terminal 후 `result` / `error` mutate — Invariant 3
- `canceled` 강제 즉시 종료 (`AbortController.abort()` 외 — 외부 SDK 중간에는 ✕) — Invariant 4
- 결과물을 HTTP body 로 inline 반환 (반드시 object storage key / signed URL)
- `WriteCoordinator` 우회한 직접 바이너리 쓰기 (single writer 위반)
- DB 모드에서 transaction 우회한 raw SQL / 직접 execute
- 호출자가 concrete 구현체 import (오직 `MediaJobPort` interface 만 참조)
- LLM 루프에서 `/media/*` 를 tool 처럼 HTTP 호출 (필요 시 미디어 전용 도구를 `tools/` 에 추가)
- SSE 이벤트 스트림으로 미디어 결과 전송 (/run vs /media 분리 원칙 위반)
- Handler exception message 를 scrub 없이 `job.error` 에 저장 (API key leak)
- 영속화된 `error.message` 를 scrub 없이 logger 로 emit (이중 leak 경로)
- `jobId` 에 개인정보 / 순차 카운터 사용 (UUID 기반 강제)
- `userId` 없이 신규 job 생성 (auth context 에서 반드시 주입)
- Job 조회 / 취소 시 `assertOwnerOrWildcard` 우회 (leak-safe 404 깨짐)
- 동일 op 를 `registerHandler` 로 두 번 다른 callable 등록 (idempotent 는 같은 callable 만)
