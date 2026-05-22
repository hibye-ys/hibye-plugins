---
name: media-pipeline-patterns
description: 미디어 (이미지 / 오디오 / 비디오) 파이프라인 추가 / 수정 시 invoke. /media/<category>/<op> 라우트, object storage 바이너리 출력, ML-worker enqueue / SSE polling, 런타임별 본문 크기 제한 → presigned URL 패턴 안내. Job lifecycle 정본은 media-job-lifecycle invariant.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/rules/media-pipeline-patterns.md
---

> **Runtime/Storage 추상화 (이 skill 의 핵심 용어)**
> - **object storage**: 바이너리를 보관하는 외부 객체 저장소. 예: Cloudflare R2, AWS S3, GCS. Instance 측에서 구체 binding/SDK 선택.
> - **key-value cache**: 작고 빠른 KV 저장소. 예: Workers KV, Redis, Upstash. Instance 측에서 구체 binding/SDK 선택.
> - **런타임 특화**: `waitUntil`, fetch handler body 한도, Cron Trigger, presigned URL API 등은 런타임 (Node / Workers / Bun) 별로 다르며 **instance 측에서 정의**. 본 workflow 는 추상 패턴만 명시.

**적용된 §4.4 매트릭스 행**:
- 파일 I/O: 동기 fs → **object storage** (`storage.put(key, blob)` / `storage.get(key)` — 런타임별 binding wrap)
- 이미지 / 비디오 처리: in-process CPU heavy lib → **외부 ML-worker** 또는 브라우저 측 `OffscreenCanvas`
- 스트리밍 응답: 프레임워크 streaming response → **`streamSSE`** (hono/streaming) 또는 `c.body(readableStream)`
- 큐 / async: 인메모리 큐 → **외부 큐** (Workers Queues / Postgres `LISTEN` / Redis Streams — instance 선택)
- DB: ORM session 추상 → **Drizzle `db.transaction(async (tx) => ...)`**
- env: 글로벌 env helper → **`c.env.<NAME>`** (Hono context)
- 로깅: 구조화 로거 → **pino** (Node) / **`console.log(JSON.stringify({...}))`** (Workers)

> source: `stack-backend-python/rules/media-pipeline-patterns.md`
> **정본 invariant**: `media-job-lifecycle` skill (6-state / stale-lease reaper / IDOR fix / backpressure / retry classification — 언어 무관). 본 skill 은 TS / Hono 적용 지점만.
> 관련: `single-writer` (바이너리 WriteCoordinator), `error-handling` (4 패턴), `api-routing` (routes/media.ts)

# media-pipeline-patterns — 미디어 파이프라인 (TS / Hono)

## 이 skill은 언제 invoke 되는가

- `src/routes/media.ts` 또는 `src/media/**` 추가 / 수정
- 새 미디어 op (`image.generate`, `audio.transcribe` 등) 추가
- object storage 바이너리 출력 경로 / signed URL 정책 변경
- "fetch handler 본문 크기 초과", "ML-worker 호출 패턴", "Job 폴링이 안 됨" 디버깅

## 경계: /run vs /media

`/run` vs `/media` 분리 원칙에 따라 **외부 SDK 중심 작업** (이미지 생성 / 분석, 음성 전사, 비디오 처리 등) 만 `/media/*` 로 분리. LLM 루프가 주도하는 건 전부 `/run/<name>`.

## 엔드포인트 패턴

```
POST /media/<category>/<op>   → 202 + { jobId, pollUrl }
GET  /media/jobs/<jobId>      → MediaJob (전체 필드)
DELETE /media/jobs/<jobId>    → 204 (best-effort cancel)
```

- `<category>` ∈ `{ image, audio, video }` (`routes/media.ts::ALLOWED_CATEGORIES` 하드코드 `as const` set) — 알 수 없는 category 는 400 reject
- `<op>` 예: `generate`, `analyze`, `transcribe` — 점 구분 qualified name (`image.generate`, `audio.transcribe`) 로 schemas registry 에 등록
- 현재는 모든 op 가 async 202 + poll 패턴. 짧은 동기 op 는 아직 없음

### 런타임 본문 크기 제한 — Presigned URL 패턴

일부 런타임 (예: Cloudflare Workers fetch handler) 은 request body 에 hard limit 이 있음. 정확한 한도는 **런타임 특화 — instance 측에서 확인**. 큰 입력 (e.g. 비디오 업로드) 은 직접 받지 말고 presigned URL 패턴 사용:

```
1. POST /media/<category>/<op>/init  → { uploadUrl, jobId }   # 클라이언트가 직접 object storage 에 PUT
2. (client) PUT <uploadUrl>  with binary body                   # 서버 fetch handler 우회
3. POST /media/jobs/<jobId>/start    → 202 (enqueue 처리)
```

- 작은 입력 (텍스트 prompt, 작은 프로필 이미지) 은 직접 POST 허용 — 한도는 런타임별 다름
- presigned URL 발급은 object storage SDK 사용 (예: R2 `createPresignedUrl()`, S3-호환 SDK, GCS signed URL API)

## Job 라이프사이클 (6-state internal ↔ 5-state external)

**정본 type** (`MediaJobStatus`) 은 `media-job-lifecycle` invariant skill 이 소유. 본 workflow 는 그것을 **import** 만 한다 — 자체 union 재선언 ✕.

```typescript
// ✅ external API type 은 invariant 가 정본 — workflow 는 import 만, 재선언 ✕
import type { MediaJobStatus } from '../media-job-lifecycle';
// MediaJobStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'dlq'

// 본 workflow 본문이 다루는 internal stage 명칭 (Python source 어휘 유지)
// — DB column / worker queue 의 implementation detail. External API 응답은 toExternalStatus() 경유.
export type InternalJobStage =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'dlq';

// internal → external 매핑 (응답 직전 호출)
export function toExternalStatus(stage: InternalJobStage): MediaJobStatus {
  switch (stage) {
    case 'queued':    return 'pending';
    case 'running':   return 'processing';
    case 'completed': return 'succeeded';
    case 'failed':    return 'failed';
    case 'canceled':  return 'canceled';
    case 'dlq':       return 'dlq';
  }
}

// 내부 terminal set (queue worker 가 사용)
export const TERMINAL_INTERNAL_STAGES = ['completed', 'failed', 'canceled', 'dlq'] as const satisfies readonly InternalJobStage[];

export function isTerminalStage(stage: InternalJobStage): boolean {
  return (TERMINAL_INTERNAL_STAGES as readonly string[]).includes(stage);
}
```

- `MediaJobStatus` (invariant 정본) — **외부 API contract**. 본 workflow 는 절대 재선언 ✕
- `InternalJobStage` (본 workflow 정의, 6 stage) — **내부 queue / worker / DB column** 의 implementation detail. Python source (`queued` / `running` / `completed`) 어휘 유지
- 매 `GET /media/jobs/<id>` 응답 직전에 `toExternalStatus(internalStage)` 로 변환 후 `c.json({ status: external, ... })` 직렬화
- `dlq` 는 양쪽에 공통 (invariant 의 `MediaJobStatus` 에 포함) — retry 예산 소진 또는 permanent error 분류 시
- `running` 진입 시 worker 가 lease (`workerId`, `claimedAt`) 기록. **DB 모드에서는 transactional commit** — split-brain 방지

> 매핑 표 정본 = invariant skill `media-job-lifecycle` §"6-state ↔ 본 invariant 4 의 매핑". 본 workflow 의 본문 (이하 절들) 은 `InternalJobStage` 어휘 (`queued` / `running` / `completed`) 로 작성 — DB / worker 가 다루는 stage.

## Storage — `MediaJobPort` (DB primary, key-value cache fallback for smoke test)

| 구현 | 위치 | 조건 | 비고 |
|------|------|------|------|
| `DbMediaJob` | `src/media/db-store.ts` | `APP_DB_ENABLED=true` (기본값) | **primary** — Drizzle + relational DB. `mediaJobs` 테이블 |
| `KvMediaJob` | `src/media/kv-store.ts` | `APP_DB_ENABLED=false` | **fallback** — key-value cache `media:job:<id>`. DB 없이 부팅해야 하는 isolated smoke test 전용 (런타임에 따라 파일 시스템 사용 ✕ 일 때 KV 로 대체) |

**state 쓰기 경로 차이** (single writer 패턴 동일, 메커니즘만 다름):

- DB 모드: `db.transaction(async (tx) => { ... })` 트랜잭션이 직렬화 역할 — commit 순서 = 단일 writer
- KV 모드: `WriteCoordinator.writeMediaJob(jobId, ...)` 싱글턴 + per-job mutex (`single-writer` skill 참조)

## 바이너리 출력 — object storage (두 모드 모두)

```
media/<jobId>/<filename>   # 예: media/job_abc123/output.png  (object storage key)
```

- 바이너리는 DB blob 으로 안 담음 (크기 + 스트리밍 이유). 항상 `WriteCoordinator.writeMediaOutput(jobId, filename, bytes)` 경유 — 내부에서 object storage `put(...)` 호출
- `MediaJob.resultPath` 에 storage key 문자열 저장 (`media/<id>/<filename>`). scheme prefix 없음
- 클라이언트가 직접 storage 에서 fetch 하려면 **presigned GET URL** 발급 — `GET /media/jobs/<id>/result-url` 같은 보조 엔드포인트 또는 응답에 inline

### ML-worker 위임 (CPU bound escape)

런타임에 따라 fetch handler CPU 한도가 짧을 수 있음 (예: Workers default 50ms). 이런 경우 무거운 in-process 변환 (이미지 리사이즈, 오디오 인코딩, 비디오 트랜스코드 등) 은 ✕. 모든 무거운 변환은 ML-worker 프로세스로 위임 — 일반 패턴:

```
1. routes/media.ts        → enqueue 작업 (DB / KV write)
2. ml-worker subscribe    → 외부 큐 consume (Postgres LISTEN / Workers Queue / Redis Streams — instance 선택)
3. ml-worker process      → storage.get(input) → 변환 → storage.put(output) → DB update (status)
4. 클라이언트 polling     → GET /media/jobs/<id> → completed 응답 받음
```

> ML-worker 의 런타임 (Node / Rust / Bun) 과 큐 메커니즘은 **instance 선택**. 본 workflow 는 enqueue ↔ subscribe ↔ process ↔ polling 의 4-step 패턴만 강제.

## Stale-lease reaper (lease-based orphan 복구)

- 모든 claim 은 `workerId` + `claimedAt` 을 row 에 기록 (dequeue SQL 이 atomic 하게 증가)
- 부팅 시 (런타임 특화 — 일부 런타임 (예: Workers) 은 fetch handler 에 부팅 개념이 없으므로 scheduled trigger / ml-worker startup 에서 호출) + 주기적 (스케줄러 — 예: cron `*/15 * * * *`) 으로 `resetStaleLeases(cutoff=now-STALE_MS)` 실행 — `claimedAt < cutoff` 인 `running` row 를 `queued` 로 복원 (attemptCount 보존, workerId / claimedAt 초기화)
- `STALE_MS = 1_800_000` (30분). handler 가 이 시간 넘으면 double-processing 위험 — 향후 heartbeat 도입 예정
- Peer worker 의 live work 는 `claimedAt > cutoff` 이라 untouched — multi-worker safe
- Handler 는 idempotent 해야 함 (재시작 시 max 1회 추가 실행)

## 테넌트 소유권 (IDOR fix)

- `MediaJob.userId: string | null` — 신규 job 은 `enqueueJob` 라우트가 auth context (`c.get('user').id`) 에서 채움. nullable 은 pre-fix 데이터 호환용 — 신규 생성 시 `null` 금지
- `GET` / `DELETE /media/jobs/{id}`: 소유자 불일치 + wildcard scope 없으면 **leak-safe 404** (`api-routing` skill §인증)
- 구현: `routes/media.ts::assertOwnerOrWildcard` (`job.userId !== caller && !hasScope(scopes, '*')` → `throw new HTTPException(404, { message: 'job not found' })`)

## Job Queue — 외부 큐 메커니즘 (instance 선택)

- `JobQueue` (`src/media/job-queue.ts`) — thin `MediaJobPort` wrapper. `subscribe(category)` async iterator (Postgres `LISTEN` / Workers Queues consume / Redis Streams 등 — instance 선택) + 모든 transition 메서드 delegate
- 인메모리 큐 **사용 ✕** — DB `media_jobs` 테이블이 source of truth. 재시작 시 작업 손실 없음
- 싱글턴: ml-worker startup 이 하나 만들어 module-scoped const 에 저장 — stateless 런타임 (Workers 등) 측은 매 request 마다 신규 `MediaJobPort` instance OK
- **worker 동시성**: per-category 분리 — `CATEGORY_CONCURRENCY = { image: 2, audio: 3, video: 1 } as const` (`ml-worker/worker.ts` 모듈 상수, **권장 기본값** — instance 별 override 가능, `media-job-lifecycle` invariant 참조). 각 category 가 독립 worker pool 을 가져 rate-limit 프로파일이 다른 SDK 들이 서로 막지 않음

## 에러 처리 (boundary: handler exception → failed/dlq job)

- Worker 는 `try { ... } catch (err) { if (err.name === 'AbortError') throw err; ... }` — shutdown / timeout 시 abort 전파, handler 실패는 분류 후 전이
- **분류 기반 자동 retry** — worker 가 handler 예외를 `classifyError` 로 분류. retryable (429 / 5xx / timeout / connection) → `scheduleRetry` + exponential backoff (10s → 40s → 160s → 640s → 2560s) ± 25% jitter + `Retry-After` 헤더 floor. permanent (4xx / validation) → 즉시 `markDlq`. retry 예산 소진 (`MAX_ATTEMPTS = 5`, `MAX_UNKNOWN_ATTEMPTS = 3`) 도 DLQ. 구현: `src/media/retry.ts` + `errors.ts`
- LLM 도구 에러 정책 (모델 반환) 은 적용 안 됨 — 미디어는 모델이 호출자가 아님

## 응답 전송

- `GET /media/jobs/<id>` 는 `MediaJob` 전체 JSON 반환 (status, resultPath, resultMetadata, error, progress 포함). zod schema 로 validate 후 `c.json(parsed)`
- `MediaJob` 필드: `id`, `userId`, `op`, `category` (required), `status`, `progress`, `request`, `resultPath`, `resultMetadata`, `error`, `attemptCount`, `nextRetryAt`, `createdAt`, `updatedAt`. `workerId` / `claimedAt` 는 internal lease 메타데이터 — 응답에 노출 안 됨
- `resultPath` 는 object storage key 문자열. 외부 노출 환경에서는 presigned URL 로 교체 권장
- `resultMetadata` 스키마는 handler 자유 (`z.record(z.unknown())`). 예: 사용자 업로드 이미지 handler 는 `{ width, height }`, TTS handler 는 `{ durationSec, sampleRate }`, 처리된 비디오 handler 는 `{ width, height, durationSec, codec }` 확장
- 큰 파일 inline 금지 — 항상 path / URL 만 반환

## 인증 / rate limit

- `/media/*` 는 `/run/*` 과 동일한 `app.use('/media/*', requireAuth)` — JWT + API 키 이중 인증
- rate limit 은 현재 **전역 `rateLimitMiddleware` 만** (media 전용 정책 없음). 실 SDK handler 가 붙어 비용 프로파일이 명확해지면 category / op 별 분리 검토
- quota 초과 → 429 + `retryAfterMs` (middleware 가 직접 변환)

## Backpressure (category-별 큐 깊이 상한)

- `CATEGORY_CAPS = { image: 100, audio: 200, video: 50 } as const` (`routes/media.ts`, **권장 기본값** — instance 별 override 가능, `media-job-lifecycle` invariant 참조) — queued 상태 row 개수 상한. 초과 시 `POST /media/<cat>/<op>` 가 429 + `Retry-After: 60`
- cap 체크 + insert 는 atomic — DB 측 advisory lock (예: Postgres `pg_advisory_xact_lock(hashtext('media_jobs_cap:<cat>'))`) 으로 category 별 직렬화. TOCTOU 레이스 방지
- `mediaWorkersEnabled = false` + 라우트 활성 상태면 503 `workers_disabled` (P0 gate — ml-worker startup 이 `mediaWorkersEnabled` 설정. stateless 런타임 측은 key-value cache `media:flags:workersEnabled` 조회)

## 새 미디어 op 추가하기

**Schema-first 원칙:** `src/media/schemas.ts` 에 `<Op>ParamsSchema` 등록해야 enqueue 허용. 미등록 op 는 `routes/media.ts::enqueueJob` 이 400 `unknown_op` 로 reject (boot-time safety).

1. `src/media/<op>.ts` 에 handler `async function run(job: MediaJob, env: Env): Promise<Record<string, unknown>>` 구현 (`resultMetadata` 반환, 실패는 throw)
2. 요청 `<Op>ParamsSchema` / 응답 `<Op>ResultSchema` zod 모델 선언 (입력 검증 + 응답 스키마)
3. `src/media/schemas.ts::registerDefaultSchemas()` 에 `registerSchema('<category>.<op>', <Op>ParamsSchema)` 추가 — qualified name 은 **점 구분** (`image.generate`, `audio.transcribe`)
4. `src/media/handlers.ts::registerDefaultHandlers()` 에 `registerHandler('<category>.<op>', <handler>)` 추가. idempotent 보장 (같은 callable 재등록 OK, 다른 callable 덮어쓰기는 `throw new Error('handler conflict')`)
5. 외부 SDK 호출은 ML-worker 측에서 wrap — 에러 message 는 worker 가 `scrubSecrets` 적용 후 `job.error` 에 저장
6. `routes/media.ts` 는 **라우트 추가 불필요** — `POST /media/<category>/<op>` 가 qualified op 기반 dispatch
7. ML-worker 측 `worker.ts` 는 **변경 불필요** — handler registry lookup 기반
8. category 별 workers concurrency 조정 필요 시 `worker.ts::CATEGORY_CONCURRENCY` map 수정
9. 바이너리 출력은 반드시 `WriteCoordinator.writeMediaOutput(job.id, filename, bytes)` 경유 (내부에서 object storage `put`)
10. 테스트 (vitest): 정상 job (queued → running → completed), retryable 에러 (retry → dlq 소진), permanent 에러 (즉시 dlq), 취소 (canceled), 동시성 (N 개 병렬), stale-lease reaper (running → queued 복원). DB 모드 + KV 모드 parametrize
11. 런타임 config 에 필요한 secret / binding 추가 (instance 특화 — 예: `wrangler.toml`, `.env`, k8s secrets — 그리고 provider 별 키 `OPENAI_API_KEY`, `STABILITY_API_KEY` 등)

## 런타임 호환성 주의 (런타임 특화 — instance 측에서 확인)

- **`Buffer` 사용**: 런타임 따라 ✕ (예: Workers). 호환성 위해 `Uint8Array` / `ArrayBuffer` 우선 (`new TextEncoder().encode(str)`)
- **`node:fs` 사용**: 런타임 따라 ✕ (예: Workers, edge functions). 파일 저장은 반드시 object storage 경유
- **무거운 CPU 작업**: 런타임 CPU 한도 (예: Workers default 50ms) 따라 in-process ✕ — ML-worker 로 위임
- **persistent connection**: stateless 런타임 (예: Workers fetch handler) 에서 long-lived TCP / WebSocket ✕ — ml-worker 측 long-running process 에서만 OK

## Media vs `/run/<name>` 경계 판단

| 기준 | media 로 | `/run/<name>` 로 |
|------|---------|----------------|
| 출력 타입 | 바이너리 (이미지 / 오디오 / 비디오) | 텍스트 / 구조화 JSON |
| LLM 역할 | 없음 또는 보조 | 주도 |
| 응답 지연 | 수초 ~ 수분 | 즉시 ~ 수초 |
| 동시성 | 별도 워커풀 필요 | 루프 내 처리 |
| sub-agent 필요 | 거의 없음 | 있을 수 있음 |
| tool_use 기반 의사결정 | 없음 | 있음 |

애매하면 **`/run/<name>` 기본**. media 는 위 조건이 **명백히 충족** 될 때만 도입.

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `APP_DB_ENABLED` 기본값 변경 | 부팅 시 `MediaJobPort` 구현체 선택 — 기존 dev 환경 `.dev.vars` 없으면 분기 뒤바뀜 |
| `MediaJobPort` 시그니처 변경 | `DbMediaJob` + `KvMediaJob` + test fixture 동시 업데이트 |
| `MediaJobStatus` (external) 추가 | `media-job-lifecycle` invariant 우선 수정 (정본) — 본 workflow 의 `toExternalStatus` 매핑 + 폴링 클라이언트 + 모니터링 동시 업데이트 |
| `InternalJobStage` (internal) 추가 | `TERMINAL_INTERNAL_STAGES` + worker dispatch + DB column CHECK constraint. `toExternalStatus` 매핑 보존 (external 노출은 invariant 의 `MediaJobStatus` 통해서만) |
| object storage key 스키마 (`media/<id>/<filename>`) 변경 | `WriteCoordinator.writeMediaOutput` + 기존 완료 job 의 `resultPath` 호환성 |
| Queue 구현 변경 (예: Postgres LISTEN → Workers Queues / Redis Streams) | Port 시그니처 유지하며 `subscribe()` 구현체 교체. stale-lease reaper 는 별도 재설계 필요 |
| presigned URL 도입 | 클라이언트 파일 접근 방식 변경 — `resultPath` 응답 scheme 추가 |
| `CATEGORY_CONCURRENCY` map 변경 | 외부 SDK rate limit 히트 빈도. 값 줄이면 처리량 감소, 늘리면 과부하 위험 |
| retry 정책 (`MAX_ATTEMPTS` / backoff 상수) 변경 | 비용 / 중복 과금 / 사용자 체감 지연 |
| `scrubSecrets` 제거 | SDK exception 에 포함된 API key / 토큰 leak 재발 |
| `STALE_MS` 변경 | 너무 짧으면 live work 를 stale 로 오판 + double-processing. 너무 길면 장애 복구 지연 |
| `CATEGORY_CAPS` 변경 | 큐 깊이 상한 변화 → 클라이언트 429 빈도 변화 |

## 금지 사항

- 결과물을 HTTP body 로 inline 반환 (반드시 path / URL)
- `WriteCoordinator` 우회한 직접 object storage `put` (single writer 위반)
- DB 모드에서 `db.transaction` 우회한 raw SQL / 직접 execute (`data-layer` skill §port)
- 호출자가 `DbMediaJob` / `KvMediaJob` 구체 구현체 import (오직 `MediaJobPort` interface 만 참조. lifespan 이 유일한 구체 import 지점)
- LLM 루프에서 `/media/*` 를 tool 처럼 HTTP 호출 (에이전트가 필요하면 **미디어 전용 도구** 를 `tools/` 에 추가해서 내부에서 `src/media` 직접 호출)
- SSE 이벤트 스트림으로 미디어 결과 전송 (/run vs /media 분리 원칙 위반)
- Handler exception message 를 `scrubSecrets` 없이 `job.error` 에 저장 (API key leak)
- 영속화된 `error.message` 를 scrub 없이 console / pino 로 emit (이중 leak 경로)
- `jobId` 에 개인정보 / 순차 카운터 사용 — `crypto.randomUUID()` 기반 `newPrefixedId('job')` 강제
- `userId` 없이 신규 job 생성 (auth context 에서 반드시 주입)
- Job 조회 / 취소 시 `assertOwnerOrWildcard` 우회 (leak-safe 404 깨짐)
- 동일 op 를 `registerHandler` 로 두 번 다른 callable 등록 (idempotent 는 같은 callable 만)
- 런타임 CPU 한도가 짧은 fetch handler (예: Workers) 안에서 무거운 CPU 작업 (in-process 이미지 / 오디오 / 비디오 변환) — 반드시 ML-worker 위임
- 런타임 비호환 API 사용 (예: Workers 에서 `Buffer` / `node:fs`) — 런타임별 호환성은 instance 측 audit
