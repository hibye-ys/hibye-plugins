---
name: data-governance
description: 데이터 거버넌스 정책 (retention / PII 분리 / export portability) 결정 시 invoke. CCv3 / SillyTavern Lorebook / MCP 호환 + 구독 해지 시 read-only 락인 ✕ 룰 적용.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/rules/data-governance-patterns.md
---

# data-governance — GDPR/PIPA Right-to-Erasure + Export + Audit (Workers/Hono)

**적용된 §4.4 매트릭스 행**:
- 스키마: pydantic → **zod**
- 파일 I/O: aiofiles / WriteCoordinator → **R2 어댑터** (`env.STORAGE` binding)
- 환경변수: os.getenv → **`c.env.<VAR>`** (Hono context)

> source: `stack-backend-python/rules/data-governance-patterns.md`
> Python ORM · asyncpg → Drizzle ORM + Neon serverless (`@neondatabase/serverless`)
> **도메인 어휘 (식별자) 사용 금지** — 이 파일 내 레거시 참조는 설명 목적 OK

---

## 불변식 (Invariants)

### 6 audit event taxonomy (고정)

`src/services/audit/log.ts` 의 `AuditEventName` union — 6개:

```typescript
export type AuditEventName =
  | 'data.export_requested'    // POST /users/me/data/export 진입 시
  | 'data.exported'            // export 작업 완료 (worker)
  | 'data.delete_requested'    // POST /users/me/data/delete 진입 시
  | 'data.delete_soft_executed'// soft delete 트랜잭션 내부 (worker)
  | 'data.delete_cancelled'    // DELETE /users/me/data/jobs/{id} 취소
  | 'data.delete_hard_executed'// 하드 삭제 CLI / scheduled task 실행
```

추가 운영 이벤트 (`governance.hard_delete_oversized`, `governance.stream_aborted`, `governance.delete_lock_contended`) 는 **구조적 로그(structuredLog)만** — `audit_log` 테이블 대상 아님 (taxonomy 고정 보호).

### Append-only audit_log

- Postgres(Neon): `BEFORE UPDATE OR DELETE` trigger 가 `RAISE EXCEPTION` (Drizzle Kit migration에서 raw SQL 추가)
- `emitAuditEvent()` 가 유일한 INSERT 진입점. `requestId` 는 Hono middleware contextvars 에서 자동 읽음
- 보존 기간: **7년** (한국 PIPA archive 의무)
- 사용자 erasure 요청에도 audit_log 는 보존 — GDPR Art. 17(3)(e) / PIPA 21조 1항

#### zod 스키마 예시 (pydantic → zod 치환)

```typescript
// src/services/audit/schemas.ts
import { z } from 'zod'

export const AuditEventNameSchema = z.enum([
  'data.export_requested',
  'data.exported',
  'data.delete_requested',
  'data.delete_soft_executed',
  'data.delete_cancelled',
  'data.delete_hard_executed',
])

export const AuditEventRowSchema = z.object({
  id: z.number().int(),
  event: AuditEventNameSchema,
  userId: z.string(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  requestId: z.string().optional(),
  createdAt: z.date(),
})

export type AuditEventRow = z.infer<typeof AuditEventRowSchema>
```

### Soft delete + 7-day grace + Hard delete

- soft delete 후 **7일** (`DEFAULT_GRACE_DAYS = 7`) 간 사용자가 cancel 가능
- 7일 경과 후 hard delete scheduled task / CLI 가 실행
- `--force` 플래그 — 7일 cutoff + 50k threshold 우회 (ops 비상용)
- `--dry-run` — 실제 쓰기 없이 plan 출력
- 50k message threshold (`HARD_DELETE_MESSAGE_LIMIT = 50_000`) 초과 시 거부 + `governance.hard_delete_oversized` 구조적 로그

### Tombstone semantics

- `tombstonedAt: datetime | null` 컬럼: sessions / userSkills / mediaJobs / mutations 테이블
- 모든 read 경로는 `WHERE tombstoned_at IS NULL` 필터 — Drizzle ORM 에서:
  ```typescript
  // 모든 read 쿼리에 적용
  .where(isNull(table.tombstonedAt))
  ```
- 변형(mutation) 메서드는 tombstoned 행에 대해 `ResourceError('session_tombstoned')` throw → 호출자가 410 응답으로 변환
- `delete` 메서드는 SKIP 필터 (idempotent)

### R2 어댑터 단일 writer (파일 I/O aiofiles → R2)

Python `WriteCoordinator` (로컬 파일) → **R2 어댑터** (`c.env.STORAGE`):

```typescript
// src/storage/r2-writer.ts
export interface StorageWriter {
  writeUserSkill(userId: string, skillId: string, content: string): Promise<void>
  deleteUserSkill(userId: string, skillId: string): Promise<void>
  writeMediaOutput(jobId: string, filename: string, data: ArrayBuffer): Promise<void>
  deleteMediaArtifacts(jobId: string): Promise<void>
}

export class R2StorageWriter implements StorageWriter {
  constructor(private bucket: R2Bucket) {}

  async writeUserSkill(userId: string, skillId: string, content: string) {
    await this.bucket.put(`skills/user/${userId}/${skillId}.md`, content)
  }

  async deleteUserSkill(userId: string, skillId: string) {
    await this.bucket.delete(`skills/user/${userId}/${skillId}.md`)
  }

  async writeMediaOutput(jobId: string, filename: string, data: ArrayBuffer) {
    await this.bucket.put(`media/${jobId}/${filename}`, data)
  }

  async deleteMediaArtifacts(jobId: string) {
    const listed = await this.bucket.list({ prefix: `media/${jobId}/` })
    await Promise.all(listed.objects.map(o => this.bucket.delete(o.key)))
  }
}
```

R2 binding 은 `c.env.STORAGE` (wrangler.toml `[[r2_buckets]]`). **D1 binding ✕** (spec §1.2).

### Centralized assertUserActive gate

```typescript
// src/services/governance/check.ts
export async function assertUserActive(
  userId: string,
  db: NeonDatabase
): Promise<void> {
  if (userId === ANONYMOUS_USER_ID) return // anon 은 tombstone 대상 아님

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.tombstonedAt)))
    .limit(1)

  if (!user[0]) {
    throw new ResourceError('user_tombstoned', 410)
  }
}
```

호출 위치 (4곳): 신규 write route 추가 시 반드시 진입점에 추가.
1. `routes/run.ts::dispatchRun` (ensureSession 전)
2. `routes/skills.ts` create/update/delete
3. `routes/media.ts::createJob`
4. `routes/run.ts::resumeRunStream`

### 환경변수 (os.getenv → c.env)

```typescript
// Python: os.getenv('APP_DATABASE_URL')
// TS/Workers: c.env.DATABASE_URL  (Hono context)

// Hono Env 타입 정의
type Env = {
  Bindings: {
    DATABASE_URL: string        // Neon serverless DSN
    STORAGE: R2Bucket           // R2 blob storage
    CACHE: KVNamespace          // KV (캐시 전용)
    // D1 binding ✕ — spec §1.2 절대 금지
  }
}
```

### Export portability (CCv3 / SillyTavern / MCP 호환)

- 작가 자산은 **언제든 export 가능** — GET /users/me/data/export
- 구독 해지 시 read-only 락인 ✕ (NovelCrafter 식 회피)
- Export 포맷: CCv3 JSON + SillyTavern Lorebook JSON + MCP 호환 스키마

---

## 새 audit event 추가하기

1. `src/services/audit/schemas.ts` 의 `AuditEventNameSchema` zod union 에 새 값 추가
2. `AUDIT_EVENTS` tuple 동시 업데이트
3. `src/observability/events.ts` 에 TypedDict 스키마 + EVENT_SCHEMA 등록
4. 호출자가 `emitAuditEvent({ event: '<new>', ... })` 사용
5. 7년 보존 + append-only 불변식 유지

운영 메트릭 / 에러 카운터는 **구조적 로그로** (audit_log 테이블 X) — 6 audit event taxonomy 보호.

## 새 read 메서드 추가 시

`src/storage/ports.ts` interface 에 메서드 추가 시:
1. tombstone 적용 여부 결정 — 리소스가 사용자 데이터면 `.where(isNull(table.tombstonedAt))` 필터 필수
2. DB 구현체 + InMemory 구현체 동시 업데이트 (parity)
3. parametrized 테스트 추가
4. interface docstring 에 tombstone 의도 명시

---

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 6 audit event 추가/삭제 | `AuditEventNameSchema` zod union, observability/events.ts EVENT_SCHEMA, 호출 사이트 |
| `tombstonedAt` 필드 추가 (새 테이블) | Drizzle Kit migration + schema + DB/InMemory 구현체 + tombstone_filter 테스트 매트릭스 |
| `DEFAULT_GRACE_DAYS` 변경 (7 → N) | hard delete scheduled task cutoff + privacy policy 문서 + UI 표시 |
| `HARD_DELETE_MESSAGE_LIMIT` 변경 | task 거부 임계 + 운영 alert |
| audit_log trigger 제거 | UPDATE/DELETE 가능해짐 — compliance 위반 위험 |
| `assertUserActive` 호출 사이트 누락 | 새 write 경로가 410 gate 우회 → compliance 갭 |
| R2 StorageWriter 경로 우회 | 단일 writer 깨짐 |
| SessionAbortRegistry lifespan 누락 | 새 SSE handler 가 register/unregister 안 하면 abort signal 무효 |

## 금지 사항

- audit_log 에 UPDATE / DELETE (Postgres trigger + 앱 규율 양쪽)
- 6 audit event 외 다른 이름을 `audit_log` 테이블에 INSERT
- tombstoned 행을 read 경로에서 보이게 하기
- hard delete 시 R2 어댑터 우회한 직접 삭제
- soft delete 트랜잭션 밖에서 audit emit
- `assertUserActive` 우회 (write 경로에서 갭 = compliance 위반)
- audit_log retention 7년 미만 (한국 PIPA 위반)
- `DEFAULT_GRACE_DAYS < 7` (GDPR 산업 표준 미준수)
- ANONYMOUS_USER_ID 의 export / delete 허용 (식별 불가능 → 422 anonymous_not_allowed)
- D1 binding (`[[d1_databases]]`) — spec §1.2 절대 금지

---

*사용자 메모리 룰: 도메인 어휘(식별자) 신규 코드/스키마에 ✕. 이 파일 내 레거시 도메인 참조는 설명 목적.*
