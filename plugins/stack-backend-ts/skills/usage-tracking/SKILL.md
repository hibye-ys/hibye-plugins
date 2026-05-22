---
name: usage-tracking
description: apps/api 의 LLM 호출 usage 이벤트 정합성 / 토큰·비용 집계 / 일일 한도 검사 추가 수정 시 invoke. provider 응답 (OpenAI / Anthropic / OpenRouter) 정규화, Neon `llm_usage` insert, KV pre-call cache + DB post-call tx, Cron Triggers 일일 집계. "usage 이벤트 누락", "비용 폭증", "한도 검사 누락" 디버깅.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/usage-tracking
---

**적용된 §4.4 매트릭스 행**: `pydantic UsageRecord` → `zod UsageRecordSchema` (`z.object`), `asyncpg insert` → **Drizzle `db.insert(llmUsage).values(...)`**, `decimal.Decimal` (정확 금액) → **string** (Workers `BigDecimal` 미지원 — DB 측 `numeric(18,8)` 컬럼), `os.getenv` → `c.env.<NAME>`, `structlog` → `console.log(JSON.stringify(...))`, Python `tenacity` (insert retry) → `p-retry`, Python `apscheduler` 일일 집계 → **Cloudflare Cron Triggers** (`wrangler.toml [triggers] crons`), `httpx` provider 응답 파싱 → `Response.json()` + zod parse

# usage-tracking — 사용량 / 비용 추적 가이드

## 이 skill 은 언제 invoke 되는가

- `output-stream-manager` sub-agent 호출 시 (usage 모드)
- usage 이벤트 누락 / 비용 집계 불일치 의심 시
- 새 provider 추가 후 토큰 카운팅 정합성 확인 시
- 일일 한도 초과 / underflow 사고
- 사용량 정산 / billing 보고서 작성

## 이 skill 은 언제 invoke 되지 않는가

- SSE 전반 감사 → `sse-streaming` workflow
- 스트리밍 구현 작업 → `sse-streaming` workflow
- 프로바이더 자체 디버깅 → `provider-layer` workflow
- 비용 폭증 incident → `incident-triage` Class 4 (usage-tracking 은 그 안에서 호출됨)

## 원칙

- **1 LLM 호출 = 1 row** — `llm_usage` 테이블에 항상 정확히 1 row insert (정합성 = 정산의 근거)
- **provider 응답 정규화** — `UsageRecord` (내부) 는 provider 독립. provider 별 차이는 `_normalize<Provider>()` 단일 함수에서 흡수
- **금액은 string** — Workers `BigDecimal` 미지원 → JS Number 정밀도 위험. DB `numeric(18,8)` + 코드에서는 string 으로 통일 (계산 시 `decimal.js` 또는 `dinero.js`)
- **usage SSE 이벤트는 `done` 직전** — 한 번만, payload 에 동적 메타 혼합 ✕
- **header 정본** — `X-App-Usage` 헤더가 정본, SSE `usage` 이벤트는 동등 사본 (클라이언트 편의)

## UsageRecord 스키마 (내부 정본)

```typescript
// apps/api/src/usage/types.ts
import { z } from 'zod'

export const UsageRecordSchema = z.object({
  // identity
  requestId: z.string(),                  // AsyncLocalStorage 10 필드 중 1
  userId: z.string(),
  sessionId: z.string().nullable(),
  agent: z.string(),
  model: z.string(),                      // resolved model id (fallback chain 결과 반영)
  providerType: z.enum([
    'anthropic', 'openai', 'google',
    'openrouter', 'openai_compatible', 'local',
  ]),

  // tokens (provider 응답 정규화 후)
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative().default(0),
  cacheReadInputTokens: z.number().int().nonnegative().default(0),

  // cost (string — BigDecimal 정밀도)
  inputCostUsd: z.string().regex(/^\d+(\.\d{1,8})?$/),     // e.g. "0.00012500"
  outputCostUsd: z.string().regex(/^\d+(\.\d{1,8})?$/),
  cacheReadCostUsd: z.string().regex(/^\d+(\.\d{1,8})?$/).default('0'),
  cacheCreationCostUsd: z.string().regex(/^\d+(\.\d{1,8})?$/).default('0'),
  totalCostUsd: z.string().regex(/^\d+(\.\d{1,8})?$/),

  // metadata
  createdAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
})

export type UsageRecord = z.infer<typeof UsageRecordSchema>
```

## Provider 응답 정규화

```typescript
// apps/api/src/usage/normalize.ts
import type { UsageRecord } from './types.ts'

interface ProviderUsageRaw {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

export function normalizeAnthropic(raw: {
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}): ProviderUsageRaw {
  return {
    inputTokens: raw.usage.input_tokens,
    outputTokens: raw.usage.output_tokens,
    cacheCreationInputTokens: raw.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: raw.usage.cache_read_input_tokens ?? 0,
  }
}

export function normalizeOpenAI(raw: {
  usage: { prompt_tokens: number; completion_tokens: number }
}): ProviderUsageRaw {
  return {
    inputTokens: raw.usage.prompt_tokens,
    outputTokens: raw.usage.completion_tokens,
    cacheCreationInputTokens: 0,    // OpenAI = no separate cache_creation
    cacheReadInputTokens: 0,        // OpenAI cached_tokens = 별도 필드 if available
  }
}

export function normalizeOpenRouter(raw: {
  usage: { prompt_tokens: number; completion_tokens: number }
  // OpenRouter generation/<id> 별도 호출로 비용 조회 — 별도 처리
}): ProviderUsageRaw {
  return {
    inputTokens: raw.usage.prompt_tokens,
    outputTokens: raw.usage.completion_tokens,
  }
}
```

## 비용 계산 (모델 카탈로그 기반)

```typescript
// apps/api/src/usage/cost.ts
import Decimal from 'decimal.js'  // string 입출력 = 정밀도 보존
import type { UsageRecord } from './types.ts'

interface ModelPricing {
  inputPerMillion: string         // "3.00"
  outputPerMillion: string        // "15.00"
  cacheReadPerMillion?: string    // "0.30"
  cacheCreationPerMillion?: string  // "3.75"
}

export function computeCost(
  raw: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number },
  pricing: ModelPricing,
): Pick<UsageRecord, 'inputCostUsd' | 'outputCostUsd' | 'cacheReadCostUsd' | 'cacheCreationCostUsd' | 'totalCostUsd'> {
  const m = new Decimal(1_000_000)
  const inCost = new Decimal(raw.inputTokens).div(m).mul(pricing.inputPerMillion)
  const outCost = new Decimal(raw.outputTokens).div(m).mul(pricing.outputPerMillion)
  const crCost = new Decimal(raw.cacheReadInputTokens ?? 0).div(m).mul(pricing.cacheReadPerMillion ?? '0')
  const ccCost = new Decimal(raw.cacheCreationInputTokens ?? 0).div(m).mul(pricing.cacheCreationPerMillion ?? '0')
  const total = inCost.plus(outCost).plus(crCost).plus(ccCost)
  return {
    inputCostUsd: inCost.toFixed(8),
    outputCostUsd: outCost.toFixed(8),
    cacheReadCostUsd: crCost.toFixed(8),
    cacheCreationCostUsd: ccCost.toFixed(8),
    totalCostUsd: total.toFixed(8),
  }
}
```

> `decimal.js` 가 Workers 와 호환. `dinero.js` 도 대안. **JS Number 직접 곱셈 ✕** — `0.1 + 0.2 = 0.30000000000000004` 문제.

## Drizzle insert (post-call)

```typescript
// apps/api/src/usage/repo.ts
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { pgTable, text, integer, numeric, timestamp, uuid } from 'drizzle-orm/pg-core'
import pRetry from 'p-retry'
import type { UsageRecord } from './types.ts'

export const llmUsage = pgTable('llm_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: text('request_id').notNull(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id'),
  agent: text('agent').notNull(),
  model: text('model').notNull(),
  providerType: text('provider_type').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  cacheCreationInputTokens: integer('cache_creation_input_tokens').notNull().default(0),
  cacheReadInputTokens: integer('cache_read_input_tokens').notNull().default(0),
  inputCostUsd: numeric('input_cost_usd', { precision: 18, scale: 8 }).notNull(),
  outputCostUsd: numeric('output_cost_usd', { precision: 18, scale: 8 }).notNull(),
  cacheReadCostUsd: numeric('cache_read_cost_usd', { precision: 18, scale: 8 }).notNull().default('0'),
  cacheCreationCostUsd: numeric('cache_creation_cost_usd', { precision: 18, scale: 8 }).notNull().default('0'),
  totalCostUsd: numeric('total_cost_usd', { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer('duration_ms').notNull(),
})

export async function insertUsage(
  databaseUrl: string,
  record: UsageRecord,
): Promise<void> {
  const sql = neon(databaseUrl)
  const db = drizzle(sql)
  await pRetry(
    () => db.insert(llmUsage).values({
      requestId: record.requestId,
      userId: record.userId,
      sessionId: record.sessionId,
      agent: record.agent,
      model: record.model,
      providerType: record.providerType,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cacheCreationInputTokens: record.cacheCreationInputTokens,
      cacheReadInputTokens: record.cacheReadInputTokens,
      inputCostUsd: record.inputCostUsd,
      outputCostUsd: record.outputCostUsd,
      cacheReadCostUsd: record.cacheReadCostUsd,
      cacheCreationCostUsd: record.cacheCreationCostUsd,
      totalCostUsd: record.totalCostUsd,
      durationMs: record.durationMs,
    }),
    { retries: 3, minTimeout: 200 },
  )
}
```

## 사용자 한도 검사 (pre-call KV + post-call DB tx)

```typescript
// apps/api/src/usage/quota.ts
import Decimal from 'decimal.js'

// Pre-call: KV cache 기반 빠른 검사 (분 단위 갱신)
export async function checkQuotaPreCall(
  kv: KVNamespace,
  userId: string,
  dailyLimitUsd: string,
): Promise<{ allowed: boolean; usedTodayUsd: string }> {
  const today = new Date().toISOString().slice(0, 10)
  const key = `quota:${userId}:${today}`
  const used = (await kv.get(key)) ?? '0'
  const allowed = new Decimal(used).lt(dailyLimitUsd)
  return { allowed, usedTodayUsd: used }
}

// Post-call: DB tx 기반 정확 갱신
export async function incrementQuotaPostCall(
  kv: KVNamespace,
  userId: string,
  costUsd: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const key = `quota:${userId}:${today}`
  const used = (await kv.get(key)) ?? '0'
  const next = new Decimal(used).plus(costUsd).toFixed(8)
  await kv.put(key, next, { expirationTtl: 2 * 86_400 })  // 2일 (집계 여유)
}
```

> **이중 안전망** — KV (빠름, 분 단위 정확) + DB `llm_usage` (정확, Cron 일일 reconciliation). KV 가 정전 / corrupt 되어도 DB 로 복구.

## SSE usage 이벤트 + 헤더 분리

```typescript
// apps/api/src/sse/stream.ts (발췌)
// done 직전, 한 번만
await stream.writeSSE({
  event: 'usage',
  data: JSON.stringify({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    totalCostUsd: usage.totalCostUsd,
  }),
})

// 헤더 정본 (`X-App-Usage`)
c.header('X-App-Usage', JSON.stringify({
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  totalCostUsd: usage.totalCostUsd,
}))

// 다른 SSE 이벤트 payload 에 토큰/비용 혼입 ✕ — 별도 usage 이벤트로 분리
```

## Cron Triggers — 일일 집계

```toml
# apps/api/wrangler.toml
[triggers]
crons = ["0 1 * * *"]  # 매일 01:00 UTC
```

```typescript
// apps/api/src/cron/dailyUsageAggregate.ts
import { drizzle } from 'drizzle-orm/neon-http'
import { sql as dsl } from 'drizzle-orm'
import { neon } from '@neondatabase/serverless'

export async function dailyUsageAggregate(env: { DATABASE_URL: string; CACHE: KVNamespace }): Promise<void> {
  const sql = neon(env.DATABASE_URL)
  const db = drizzle(sql)
  // 어제 날짜 집계 → 별도 `daily_usage_summary` 테이블에 upsert
  await db.execute(dsl`
    INSERT INTO daily_usage_summary (user_id, day, input_tokens, output_tokens, total_cost_usd)
    SELECT user_id,
           (created_at AT TIME ZONE 'UTC')::date AS day,
           SUM(input_tokens),
           SUM(output_tokens),
           SUM(total_cost_usd)
    FROM llm_usage
    WHERE created_at >= NOW() - INTERVAL '1 day'
    GROUP BY user_id, day
    ON CONFLICT (user_id, day) DO UPDATE SET
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      total_cost_usd = EXCLUDED.total_cost_usd
  `)
  // KV reconciliation — DB 가 정본, KV 는 reset
  // (KV 의 quota:* 키는 자연 expire — 별도 작업 불필요)
}
```

```typescript
// apps/api/src/index.ts (worker entry)
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await dailyUsageAggregate(env)
  },
}
```

## 감사 체크리스트

```bash
# 1. usage 이벤트 emit 지점 (done 직전 한 번만)
rg -n "writeSSE.*event.*'usage'|writeSSE.*event:\s*\"usage\"" apps/api/src/sse/

# 2. X-App-Usage 헤더
rg -n "X-App-Usage" apps/api/src/routes/

# 3. provider 별 정규화 함수
for p in anthropic openai openrouter google; do
  rg -n "normalize${p^}" apps/api/src/usage/
done

# 4. llm_usage 테이블 insert 지점 (1 LLM 호출 = 1 insert)
rg -n "db\.insert\(llmUsage\)" apps/api/src/

# 5. usage 정보가 다른 SSE 이벤트 payload 에 혼입 (VIOLATION)
rg -n "input_tokens|output_tokens|inputTokens|outputTokens" apps/api/src/sse/ | rg -v "'usage'|\"usage\"|UsageRecord"

# 6. KV quota 키 패턴
rg -n "quota:" apps/api/src/usage/

# 7. Cron Triggers 등록 확인
grep -A 3 "\[triggers\]" apps/api/wrangler.toml
```

## 리포트 템플릿

```markdown
## Usage Tracking Audit — <date>

### Usage event
- [OK/FAIL] usage SSE event emitted before done (정확히 1회)
- [OK/FAIL] usage data schema (`UsageRecordSchema`) parse 통과
- [OK/FAIL] X-App-Usage 헤더와 동기

### Token counting
- [OK/FAIL] provider 별 normalize 함수 존재 (anthropic / openai / openrouter / google)
- [OK/FAIL] 정규화 후 `UsageRecord` 로 통합

### Cost calculation
- [OK/FAIL] `decimal.js` 사용 (Number 직접 곱셈 ✕)
- [OK/FAIL] 모델 카탈로그 pricing lookup 정합
- [OK/FAIL] `numeric(18,8)` column / string 코드 통일

### DB insert
- [OK/FAIL] 1 LLM 호출 = 1 `llm_usage` row insert
- [OK/FAIL] `p-retry` 적용 (Neon 일시 장애 대응)

### Quota
- [OK/FAIL] pre-call KV check
- [OK/FAIL] post-call KV increment
- [OK/FAIL] Cron 일일 reconciliation (DB → `daily_usage_summary`)

### Header separation
- [OK/FAIL] X-App-Usage 헤더 정본
- [OK/FAIL] 다른 SSE 이벤트에 usage 데이터 혼입 0건
```

## 의존 자산

- `sse-streaming` workflow — SSE 불변식 (done 직전, 단일 emission)
- `sse-lifecycle` invariant — done / error 종료 보장
- `provider-layer` workflow — provider 응답 구조
- `provider-catalog-sync` workflow — 모델 pricing
- `database` workflow — Drizzle / Neon HTTP / `numeric(18,8)`
- 데이터 거버넌스 invariant (instance 측 project-local skill) — append-only / retention
- `ts-agent-rules` workflow — AsyncLocalStorage `requestId` / `userId`

## 검증 체크리스트

- [ ] 7개 감사 블록 실행
- [ ] provider 별 usage 파싱 확인
- [ ] 헤더 / payload 분리 확인
- [ ] `decimal.js` 적용 검증 (Number 직접 곱셈 0건)
- [ ] Cron Triggers 등록 확인
- [ ] `llm_usage` Drizzle migration 적용 확인

## 구현 중 막히면

- usage 이벤트 자체가 없음 → 미구현으로 보고 + `sse-streaming` workflow §usage 참조
- provider 정규화 함수 없음 → `provider-scaffold` workflow §test 시나리오 추가
- 비용 계산 정밀도 어긋남 → `Decimal` 사용 / DB `numeric(18,8)` / 모든 IO string
- KV 키 충돌 (`quota:*`) → 다른 KV 키와 prefix 분리 (`quota:` 전용 namespace)
- Cron 안 돔 → `wrangler.toml [triggers]` 확인 + `wrangler tail --format pretty` 로 scheduled trigger 관찰

## Cross-ref

- `sse-streaming` (usage 이벤트 emission)
- `provider-layer` (provider 응답 구조)
- `provider-catalog-sync` (모델 pricing)
- `database` (Drizzle / Neon)
- `incident-triage` Class 4 (cost spike — 본 skill 호출됨)
