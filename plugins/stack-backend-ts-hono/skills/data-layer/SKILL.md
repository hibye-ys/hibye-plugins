---
name: data-layer
description: 데이터 계층 추상 (Repository / Port 패턴, transaction boundary, optimistic locking) 결정 시 invoke. Drizzle ORM + Neon serverless Workers 호환 구현.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/rules/data-layer-patterns.md
---

# data-layer — 데이터 레이어 (R2 / Neon / KV) Workers/Hono

**적용된 §4.4 매트릭스 행**:
- ORM: SQLAlchemy/asyncpg → **Drizzle ORM** + `c.env.DB` (Neon binding)
- 트랜잭션: `session_scope()` async context manager → **`db.transaction(async (tx) => { ... })`** (Drizzle)
- interface 패턴: Python `@runtime_checkable Protocol` → **TS `interface`** + provider impl (`src/storage/provider.ts`)

> source: `stack-backend-python/rules/data-layer-patterns.md`
> **도메인 어휘 (식별자) 사용 금지** — 이 파일 내 레거시 참조는 설명 목적 OK

---

## 담당 범위

| 대상 | 경로 (Workers) | 쓰기 주체 |
|------|----------------|----------|
| Media job state | Neon DB `media_jobs` 테이블 | `MediaJobPort` 구현체 (DB) |
| Media output 바이너리 | R2 `media/<jobId>/<file>` | `R2StorageWriter.writeMediaOutput` (single writer) |
| User custom skill 본문 | R2 `skills/user/<userId>/<skillId>.md` | `R2StorageWriter.writeUserSkill` |

**우회 금지**: R2 bucket 직접 `put()` / `delete()` — 반드시 `StorageWriter` 인터페이스 경유. 정기 grep 검증.

---

## Port / Interface 패턴 (Protocol → TS interface)

```typescript
// src/storage/ports.ts

// Python: @runtime_checkable class SessionPort(Protocol):
// TS: export interface SessionPort { ... }

import type { PgDatabase } from 'drizzle-orm/pg-core'
import { Message, MediaJob, SessionRecord, SessionIdentity } from '../types'

export interface SessionPort {
  get(sessionId: string): Promise<SessionRecord | null>
  ensureSession(identity: SessionIdentity): Promise<SessionRecord>
  recordTurn(sessionId: string, opts?: { userId?: string }): Promise<SessionRecord>
  listForUser(userId: string, opts?: { limit?: number }): Promise<SessionRecord[]>
  setDisplayLabel(sessionId: string, label: string): Promise<SessionRecord | null>
  delete(sessionId: string): Promise<void>
  addUsage(sessionId: string, opts: {
    model: string
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    costUsd: number
  }): Promise<SessionRecord | null>
}

export interface SessionHistoryPort {
  getMessages(sessionId: string, opts?: { limit?: number }): Promise<Message[]>
  appendMessages(sessionId: string, messages: Message[]): Promise<void>
  clear(sessionId: string): Promise<void>
}

export interface MediaJobPort {
  // Read
  get(jobId: string): Promise<MediaJob>
  tryGet(jobId: string): Promise<MediaJob | null>
  countQueued(opts: { category: string }): Promise<number>
  soonestRetry(opts: { category: string }): Promise<Date | null>
  // Atomic enqueue (cap check + insert)
  createIfCapacity(
    op: string,
    request: Record<string, unknown>,
    opts: { category: string; cap: number; userId?: string }
  ): Promise<MediaJob | null>
  // Worker claim
  dequeue(opts: { category: string; workerId: string }): Promise<MediaJob | null>
  // Claim-guarded terminal writes
  scheduleRetry(jobId: string, opts: {
    workerId: string; claimAttempt: number
    nextRetryAt: Date; error: Record<string, unknown>
  }): Promise<boolean>
  markDlq(jobId: string, opts: {
    workerId: string; claimAttempt: number; error: Record<string, unknown>
  }): Promise<boolean>
  markCompleted(jobId: string, opts: {
    workerId: string; claimAttempt: number
    resultPath: string; resultMetadata: Record<string, unknown>
  }): Promise<boolean>
  updateProgress(jobId: string, opts: {
    workerId: string; claimAttempt: number; progress: number
  }): Promise<boolean>
  // Cancellation
  cancel(jobId: string): Promise<boolean>
  // Lease reaper
  resetStaleLeases(opts: { cutoff: Date }): Promise<number>
}
```

---

## 구현체 구조

| Port | InMemory 구현체 | DB 구현체 |
|------|----------------|----------|
| `SessionPort` | `InMemorySessionStore` (`src/state/session.ts`) | `DbSessionStore` (`src/state/db-session.ts`) |
| `SessionHistoryPort` | `InMemorySessionHistory` (`src/state/session.ts`) | `DbSessionHistory` (`src/state/db-session.ts`) |
| `MediaJobPort` | — (R2 기반) | `DbMediaJob` (`src/services/media/db-store.ts`) |

구현체 선택은 Hono lifespan / `c.env.DB_ENABLED` 기준. 호출자는 **Port interface 만 참조** — 구체 구현체 import 금지.

---

## 트랜잭션 (session_scope → db.transaction)

```typescript
// Python: async with session_scope() as session:
//           session.add(row)
// Drizzle:
import { db } from '../db/client'

// 단순 쿼리
const result = await db.select().from(sessions).where(eq(sessions.id, sessionId))

// 트랜잭션 블록
await db.transaction(async (tx) => {
  await tx.insert(auditLog).values({ event: 'data.delete_soft_executed', userId })
  await tx.update(sessions).set({ tombstonedAt: new Date() }).where(eq(sessions.userId, userId))
  // tx.rollback() 이 예외 throw → 자동 rollback
})

// 주의: Long-running 트랜잭션 금지 — SSE 스트리밍 중 open 유지 시 Neon 연결 타임아웃
```

---

## Drizzle ORM + Neon serverless 연결 (asyncpg → @neondatabase/serverless)

```typescript
// src/db/client.ts
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'

// c.env.DATABASE_URL — Hono context (not process.env)
export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl)
  return drizzle(sql, { schema })
}

// Hono middleware 에서 주입
// app.use('*', async (c, next) => {
//   c.set('db', createDb(c.env.DATABASE_URL))
//   await next()
// })
```

---

## Optimistic Locking (version column)

```typescript
// Python: advisory lock (pg_advisory_xact_lock)
// TS/Workers: version column + WHERE clause (HTTP-mode Neon 에서는 advisory lock 미지원)

// schema/sessions.ts
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().default(0),
  // ...
})

// optimistic update 예시
const updated = await db
  .update(sessions)
  .set({ displayLabel: label, version: sql`version + 1` })
  .where(and(eq(sessions.id, sessionId), eq(sessions.version, expectedVersion)))
  .returning()

if (!updated[0]) throw new ConflictError('optimistic_lock_conflict')
```

WebSocket 모드 (Neon)에서는 `pg_advisory_xact_lock` 사용 가능 (migration 큐 등 직렬화 필요 시):
```typescript
// WebSocket 모드에서만 — HTTP 모드 ✕
await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media_jobs_cap:${category}`}))`)
```

---

## 모듈 구조

```
src/storage/
  ports.ts         # SessionPort / SessionHistoryPort / MediaJobPort interface
  provider.ts      # 구현체 선택 + DI 주입 (c.env.DB_ENABLED 기준)
  r2-writer.ts     # R2StorageWriter (단일 writer — data-governance.md 참조)

src/db/
  client.ts        # createDb(databaseUrl)
  schema/          # Drizzle 스키마 (pgTable 선언)
  migrations/      # Drizzle Kit 생성 SQL 파일
```

- `ports.ts` — interface 선언만. 구체 구현체는 `src/state/` 또는 `src/services/media/` 에 분산
- placeholder 모듈 (`types.ts` 등) 만들지 않음. 공유 타입은 소비자 측 또는 `src/types/index.ts` 에 배치

---

## 새 Port 추가하기

1. `src/storage/ports.ts` 에 `interface` 선언
2. InMemory 구현체 + DB 구현체 2개 제공
3. `src/storage/provider.ts` 의 `DB_ENABLED` 분기에 추가
4. Hono `c.var` 또는 엔진 `LoopDeps` 에 타입 노출
5. 호출자는 구체 구현체 import 금지 — **interface 만 참조**
6. `export` 에 Port 이름 추가

## 새 미디어 출력 유형 추가하기

1. `src/services/media/<op>.ts` handler 에서 `r2Writer.writeMediaOutput(jobId, filename, data)` 호출
2. 파일 확장자 / MIME 타입은 `src/services/media/schemas.ts` 의 `<Op>Result` zod 스키마에 명시
3. 테스트: R2 mock 으로 put() 호출 횟수 + key 검증

---

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| R2StorageWriter 싱글턴 해제 | single writer 불변식 위반, race condition |
| Per-job Lock → 글로벌 Lock | 서로 다른 job 병렬 실행 불가 — 처리량 하락 |
| `db.transaction` 제거 후 raw 쿼리 | atomicity 보장 없음, audit row rollback 불가 |
| Drizzle schema 컬럼 추가/삭제 | Drizzle Kit migration 필요, 기존 데이터 migration path |

## 금지 사항

- Port 우회한 직접 `db.execute` / `tx.execute` raw SQL / R2 직접 호출 (single writer + StoragePort 위반)
- 트랜잭션 밖에서 write (atomicity 보장 없음)
- Long-running 트랜잭션 (SSE 스트리밍 중 open 유지 — Neon 연결 타임아웃)
- `sql\`... ${userInput}\`` — parametrized 강제 (SQL injection)
- Drizzle Kit 우회한 스키마 변경
- 구체 구현체 이름 (`DbSessionStore`) 을 호출자 코드에서 import — interface 만 참조
- `SessionHistoryPort` 를 `SessionPort` 에 병합 — identity/counter vs history 분리 원칙
- D1 binding (`c.env.<NAME>.prepare`) — spec §1.2 절대 금지
- `user-state overlay` 인프라 (`appendOp` / `PatchOperation` / `readMerged`) 재도입 — 별도 설계 승인 전 금지

---

*사용자 메모리 룰: 도메인 어휘(식별자) 신규 코드/스키마에 ✕. 이 파일 내 레거시 참조는 설명 목적.*
