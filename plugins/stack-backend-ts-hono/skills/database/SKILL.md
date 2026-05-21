---
name: database
description: Workers 호환 DB 선택 / 연결 / 마이그레이션 결정 시 invoke. Neon Postgres + Drizzle ORM + Drizzle Kit. D1 / Durable Objects 절대 금지.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/rules/database-patterns.md
---

# database — DB + StoragePort 규약 (Workers-compat, D1 금지)

> **⛔ spec §1.2 — Cloudflare D1 절대 금지**
> D1 은 2025년 $5,000/10초 청구 사고 이후 이 프로젝트에서 **영구 금지**. `[[d1_databases]]` binding / `D1Database` import / `c.env.<NAME>.prepare()` API 사용 시 즉시 deploy 차단.
>
> **⛔ Durable Objects 절대 금지** — spec §1.2. lock-in 최고 위험.

**적용된 §4.4 매트릭스 행**:
- DB 드라이버: asyncpg → **`@neondatabase/serverless`** (HTTP/WebSocket, Workers 적합)
- 마이그레이션: Alembic → **Drizzle Kit** (`drizzle-kit generate` + `drizzle-kit migrate`)
- 환경변수: `APP_DATABASE_URL` os.getenv → **`c.env.DATABASE_URL`** (Hono context)

> source: `stack-backend-python/rules/database-patterns.md`
> **도메인 어휘 (식별자) 사용 금지** — 이 파일 내 레거시 참조는 설명 목적 OK

---

## 현재 상태 (Workers 스택)

| 대상 | 위치 | 방식 |
|------|------|------|
| 도메인 엔티티 (character / world / persona / …) | **외부 서비스 소유** (별도 Postgres 인스턴스) | AI API 가 소유 안 함. 접근은 전용 pool + 도구군. 쓰기 시 mutations 감사 append 필수 |
| 쓰기 감사 | Neon `ai_backend.mutations` 테이블 | raw SQL INSERT, ORM 모델 없음 — Drizzle Kit migration 에서 직접 관리 |
| 세션 identity/counters | Neon DB 또는 InMemory | `SessionPort` (InMemory 또는 Db 구현체) |
| 세션 메시지 이력 | Neon DB 또는 InMemory | `SessionHistoryPort` |
| Media jobs (state) | Neon DB | `MediaJobPort` (Db 구현체) |
| Media 바이너리 | R2 `media/<jobId>/<file>` | 항상 R2 (`R2StorageWriter.writeMediaOutput`). 삭제 → `deleteMediaArtifacts` |
| User custom skill 본문 | R2 `skills/user/<userId>/<skillId>.md` | `R2StorageWriter.writeUserSkill` (단일 writer) |
| 감사 로그 | Neon `ai_backend.audit_log` | append-only (Postgres trigger + 앱 규율). 7년 보존. `emitAuditEvent` 단일 진입점. 6 event taxonomy 고정 |
| Governance jobs | Neon `ai_backend.governance_jobs` | `DbGovernanceJob` Port — DB only (audit-grade) |
| KV cache | `c.env.CACHE` (Cloudflare KV) | 세션 캐시 / rate limit / 단기 상태 — **durable 상태 ✕** |

---

## KV (cache) vs DB (durable) 분리 원칙

| 용도 | 스토리지 | 이유 |
|------|----------|------|
| 단기 캐시 (세션 TTL, rate limit 카운터) | KV (`c.env.CACHE`) | eventual consistency OK, 낮은 지연, 높은 처리량 |
| Durable 상태 (세션 identity, 메시지 이력, jobs) | Neon Postgres | strong consistency, transaction, ACID |
| Blob 파일 (미디어, skill 본문) | R2 (`c.env.STORAGE`) | 대용량 바이너리, 전역 분산 |

**KV 에 durable 상태 저장 금지** — 데이터 손실 위험 (eventual consistency + TTL 만료).

---

## 스택 (Workers 호환)

| 레이어 | 선택 | 메모 |
|--------|------|------|
| DB 엔진 | **Neon Postgres (serverless)** | Workers 환경에서 HTTP/WebSocket 모드 지원 |
| 드라이버 | **`@neondatabase/serverless`** | Workers 호환 (asyncpg 대체) |
| ORM | **Drizzle ORM** | Workers 호환, type-safe, 경량 |
| 마이그레이션 | **Drizzle Kit** | `drizzle-kit generate` + `drizzle-kit migrate` |
| 연결 | HTTP 모드 (기본) / WebSocket 모드 (트랜잭션) | `c.env.DATABASE_URL` Hono context |
| UPSERT | Drizzle `onConflictDoUpdate` | Postgres 방언 (SQLite fallback 미지원) |
| 세션 캐시 | Neon DB 1순위. KV 는 단기 캐시 전용 | 단일 엔진 원칙 |

---

## 금지 DB 목록 (spec §1.2)

| DB | 이유 |
|----|------|
| **Cloudflare D1** | ⛔ $5,000/10초 청구 사고, Workers 내부 lock-in |
| **Durable Objects** | ⛔ lock-in 최고, 복잡도 최고 |
| Cloudflare Pages | ⛔ deprecated 2025-04 |

**Workers 호환 외부 DB 허용 목록**: Neon Postgres · PlanetScale · Supabase (Postgres) · Turso · Upstash Redis (KV용)

---

## Neon serverless 연결 (asyncpg → @neondatabase/serverless)

```typescript
// src/db/client.ts

// HTTP 모드 (단순 쿼리 — Workers 기본)
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl)  // c.env.DATABASE_URL 에서 주입
  return drizzle(sql, { schema })
}

// WebSocket 모드 (트랜잭션 필요 시 — connection pooling)
import { Pool } from '@neondatabase/serverless'
import { drizzle as drizzlePool } from 'drizzle-orm/neon-serverless'

export function createDbWithPool(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl })
  return drizzlePool(pool, { schema })
}
```

```typescript
// Hono middleware 에서 DI
app.use('*', async (c, next) => {
  c.set('db', createDb(c.env.DATABASE_URL))
  await next()
})
```

---

## Drizzle 스키마 선언 (SQLAlchemy DeclarativeBase → pgTable)

```typescript
// src/db/schema/sessions.ts
import { pgTable, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core'

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  version: integer('version').notNull().default(0),
  displayLabel: text('display_label'),
  tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// 인덱스 (Drizzle index helper)
import { index } from 'drizzle-orm/pg-core'
export const sessionsByUserIdx = index('sessions_user_id_idx').on(sessions.userId)
```

---

## Drizzle Kit 마이그레이션 (Alembic → Drizzle Kit)

```bash
# 스키마 변경 후 migration 파일 생성
npx drizzle-kit generate

# migration 적용 (Neon DB)
npx drizzle-kit migrate

# 현재 스키마 introspect (기존 DB 에서 역방향)
npx drizzle-kit introspect
```

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema/*.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!, // CI/deploy 시 환경변수
    // drizzle.config.ts 는 *Node CLI* (drizzle-kit migrate) — process.env 정상. Workers runtime 에서는 c.env 사용.
  },
})
```

migration 파일은 `src/db/migrations/` — Drizzle Kit 생성 SQL. **Alembic revision 없음**.

---

## 트랜잭션 / 일관성

```typescript
// Python: async with session_scope() as session:
// Drizzle: db.transaction()

await db.transaction(async (tx) => {
  await tx.insert(auditLog).values({ event: 'data.delete_soft_executed', userId })
  await tx.update(sessions).set({ tombstonedAt: new Date() }).where(eq(sessions.userId, userId))
  // 예외 → 자동 rollback
})

// Long-running 트랜잭션 금지 — SSE 스트리밍 중 open 유지 시 Neon 연결 타임아웃
// UTC 고정: new Date() → always UTC in JS
```

---

## 환경변수 (c.env — Hono context)

```typescript
// wrangler.toml
// [vars]
// DATABASE_URL = "postgresql+..." ← 실제값은 Cloudflare Secret

// Hono Env 타입
type Env = {
  Bindings: {
    DATABASE_URL: string     // Neon serverless DSN (Python: APP_DATABASE_URL)
    STORAGE: R2Bucket        // R2 blob (Python: data/media/)
    CACHE: KVNamespace       // KV cache (Python: Redis — 병목 후 추가)
    // D1 binding ✕ — spec §1.2 절대 금지
  }
}
```

---

## 새 엔티티 / 테이블 추가하기

1. `src/db/schema/<name>.ts` 에 `pgTable` 선언
2. `src/db/schema/index.ts` 에 export 추가 (Drizzle Kit autogenerate 대상)
3. migration 생성: `npx drizzle-kit generate`
4. 생성된 파일 검토 + downgrade SQL 수동 작성 (Drizzle Kit 은 down migration 자동 생성 ✕)
5. 필요 시 `src/storage/ports.ts` 에 interface 추가, 구현체 2개 제공
6. Hono `c.var` 또는 엔진 `LoopDeps` 에 Port 타입 노출
7. 테스트: 두 구현체 모두에서 동일 시나리오 통과 (parametrize)

## 새 Port 추가하기

1. `src/storage/ports.ts` 에 `interface` 선언
2. InMemory 구현체 + DB 구현체 2개 제공
3. `src/storage/provider.ts` 의 `DB_ENABLED` 분기에 추가 (lifespan에서 인스턴스화)
4. 호출자는 구체 구현체 import 금지 — **interface 만 참조**

---

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| Neon DSN 변경 | `c.env.DATABASE_URL`, CI/CD secrets, `drizzle.config.ts` |
| Drizzle schema 컬럼 추가/삭제 | `npx drizzle-kit generate` 후 migration 파일 검토 필수 |
| KV → DB durable 상태 이전 | Port 구현체 교체 + 기존 KV 데이터 migration 계획 |
| HTTP → WebSocket 모드 전환 | connection pool 설정, Workers CPU limit 고려 |
| R2 bucket 이름 변경 | `wrangler.toml [[r2_buckets]]` + 기존 객체 migration |

## 금지 사항

- **Cloudflare D1** (`[[d1_databases]]` binding / `D1Database` import / `.prepare()` API) — spec §1.2 절대 금지
- **Durable Objects** — spec §1.2 절대 금지
- KV 에 durable 상태 저장 (eventual consistency + TTL = 데이터 손실 위험)
- Port 우회한 직접 `db.execute` raw SQL (single writer + StoragePort 위반)
- 트랜잭션 밖에서 write
- Long-running 트랜잭션 (SSE 스트리밍 중 open 유지)
- SQL injection: `sql\`... ${userInput}\`` — parametrized 강제
- Drizzle Kit 우회한 스키마 변경
- 외부 도메인 엔티티 테이블을 `ai_backend.*` 에 복제
- mutations 감사 없이 외부 도메인 엔티티 UPDATE/INSERT
- `DATABASE_URL` 미설정 시 D1 fallback — **fallback 없음, RuntimeError 즉시 실패**

---

*사용자 메모리 룰: 도메인 어휘(식별자) 신규 코드/스키마에 ✕. 이 파일 내 레거시 참조는 설명 목적.*
