---
name: testing-infra
description: <api-app> 테스트 인프라 셋업 시 invoke. Vitest 설정 + <framework> in-process request 패턴 + DB test branch 격리 + runtime-호환 test harness 옵션.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/testing-infra
allowed-tools: Read, Write, Edit, Bash
---

**적용된 §4.4 매트릭스 행**: pytest → vitest, Python framework in-process TestClient → framework in-process request helper, conftest.py fixtures → Vitest beforeAll/beforeEach/vi.mock, 환경변수 (os.getenv → `<framework env binding>`)

## Core Rules (CRITICAL — baseline already knows common Vitest patterns, these are the UNIQUE differentiators)
1. MUST configure Vitest for <runtime>-compatible async (no `setInterval`, `Buffer`, `fs` direct use when target runtime forbids)
2. MUST use framework in-process request helper — NOT a real HTTP server
3. Provider stream mock MUST be an async generator function, NOT `vi.fn().mockResolvedValue(...)`
4. MUST define provider mock as FACTORY (takes events list)
5. MUST define session/env factory with `<framework env binding>` simulation
6. DB isolation = managed DB test branch per CI run OR in-memory better-sqlite3

# testing-infra — Mock-based 테스트 인프라

## 이 skill은 언제 로드되는가

- `<api-app>/src/**/*.test.ts` 새 테스트 작성
- `<api-app>/src/test/setup.ts` 새 fixture/helper 추가
- "test pollution between cases" 증상
- "async mock not called" 에러
- Vitest 설정 추가/변경

## 이 skill은 언제 로드되지 않는가

- VCR cassette / record-replay 작성 (별도 scope)
- live API 호출 테스트
- 통합/E2E 테스트 (runtime-specific test harness 섹션 참조)

## Testing Infra의 정체성

테스트의 핵심 원칙:

1. **No real API calls** — 모든 LLM/외부 서비스 호출은 `vi.fn()` async generator 로 대체한다.
2. **No real file I/O** in unit tests — in-memory mock 또는 `vi.mock('node:fs', ...)`.
3. **Fast** — 전체 unit test suite < 10초 목표. 마커가 붙지 않은 테스트는 모두 100ms 이내.
4. **Isolated** — 한 테스트가 다음 테스트의 상태에 영향을 주면 안 된다. module-level singleton 은 `beforeEach` / `afterEach` 에서 리셋.
5. **Async-first** — 거의 모든 코드가 async 이므로 test fn 도 async. Vitest 는 기본적으로 async test fn 을 지원한다 (`pytest-asyncio` 별도 설치 불필요).

## Vitest 설정

```ts
// <api-app>/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',       // 단위 테스트: 'node' 충분 (런타임-격리 환경은 별도 통합)
    setupFiles: ['./src/test/setup.ts'],
    reporters: ['verbose'],
    pool: 'forks',             // runtime-호환 (threads pool 대신, runtime-specific 결정)
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/**/*.test.ts'],
    },
  },
})
```

> **runtime-격리 테스트** (예: DB binding, KV, object storage 등): runtime-specific test harness (예: in-process dev server, miniflare-류 emulator) 를 사용 — 하단 "runtime-환경 테스트" 섹션 참조 (instance 측 project-local skill 참조).

## setup.ts 공통 helper

```ts
// <api-app>/src/test/setup.ts
import { afterEach, vi } from 'vitest'

// mock reset — 전체 테스트에 적용
afterEach(() => {
  vi.restoreAllMocks()
})
```

## Mock provider 스트림 (FACTORY 패턴)

```ts
// <api-app>/src/test/mock-provider.ts
import type { ProviderEvent } from '../providers/types'

export interface MockProvider {
  name: string
  model: string
  supportsTools: boolean
  supportsStreaming: boolean
  callStream: (opts: unknown) => AsyncGenerator<ProviderEvent>
  countTokens: (msgs: unknown[]) => number
}

/**
 * Provider stream mock factory.
 *
 * IMPORTANT: callStream must return an async generator, NOT a Promise that
 * resolves to a generator. The agent loop does `for await (const ev of
 * provider.callStream(...))` — if callStream is a plain mock returning a
 * resolved value, iteration breaks silently.
 */
export function makeMockProvider(events: ProviderEvent[]): MockProvider {
  return {
    name: 'anthropic',
    model: 'claude-sonnet-4-6',
    supportsTools: true,
    supportsStreaming: true,
    async *callStream(_opts: unknown): AsyncGenerator<ProviderEvent> {
      for (const ev of events) {
        yield ev
      }
    },
    countTokens: (msgs: unknown[]) =>
      msgs.reduce((acc, m: any) =>
        acc + (m?.content ?? '').toString().length / 4, 0),
  }
}
```

## in-process request 패턴 (framework in-process)

```ts
// <api-app>/src/test/helpers.ts
import { app } from '../app'   // framework app instance
import type { Env } from '../types'

/**
 * Framework in-process request helper — no HTTP server needed.
 * env binding 시뮬레이션: runtime binding 을 test object 로 주입.
 */
export function makeTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: createTestDb(),           // drizzle better-sqlite3 in-memory
    KV: createTestKV(),           // Map-backed KV stub
    OPENROUTER_API_KEY: 'test-key',
    ...overrides,
  }
}

export async function apiRequest(
  path: string,
  init: RequestInit & { env?: Partial<Env> } = {},
) {
  const { env: envOverrides, ...fetchInit } = init
  const env = makeTestEnv(envOverrides)
  // framework in-process request helper: path + fetch init + optionally env bindings
  // 예: <framework in-process request helper>(path, fetchInit, env) — instance 측 framework 별 helper 로 치환
  return <framework in-process request helper>(path, fetchInit, env)
}
```

## 사용 예시 — route 단위 테스트

```ts
// <api-app>/src/routes/__tests__/run.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { apiRequest } from '../../test/helpers'
import { makeMockProvider } from '../../test/mock-provider'
import * as providerModule from '../../providers/index'

describe('POST /api/run', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('streams text response', async () => {
    const events = [
      { type: 'text_delta', payload: { text: 'Hello' } },
      { type: 'text_delta', payload: { text: ', world' } },
      { type: 'done', payload: {} },
    ]
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(
      makeMockProvider(events) as any,
    )

    const res = await apiRequest('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', sessionId: 'test-001' }),
    })

    expect(res.status).toBe(200)
  })

  it('returns 422 on missing sessionId', async () => {
    const res = await apiRequest('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),  // sessionId 누락
    })
    expect(res.status).toBe(422)
  })
})
```

## SSE 스트리밍 응답 테스트

```ts
it('SSE: emits done event', async () => {
  // ...provider mock...
  const res = await apiRequest('/api/run', { method: 'POST', body: ... })
  expect(res.headers.get('content-type')).toContain('text/event-stream')

  // SSE body 를 텍스트로 읽어 파싱
  const text = await res.text()
  const lines = text.split('\n').filter(l => l.startsWith('data:'))
  const parsed = lines.map(l => JSON.parse(l.slice(5).trim()))
  expect(parsed.some(e => e.type === 'done')).toBe(true)
})
```

## runtime-환경 테스트 (in-process dev server / emulator)

단위 테스트에서 framework in-process request 로 커버하기 어려운 runtime binding (DB, KV, object storage 등) 은 **별도 통합 테스트** 파일에서 runtime-specific test harness 를 사용한다 (구체 API 는 instance 측 project-local skill 참조).

```ts
// <api-app>/src/test/runtime-env.ts  (통합 테스트 전용 — 의사코드)
// import { <runtime devServer helper> } from '<runtime-test-package>'
// export async function startServer() {
//   const server = await <runtime devServer helper>('src/index.ts', {
//     vars: { OPENROUTER_API_KEY: 'test-key' },
//     bindings: { KV: 'test-kv' },
//   })
//   return server  // { fetch, stop }
// }
```

```ts
// emulator 대안 (의사코드) — runtime-specific emulator package
// import { <RuntimeEmulator> } from '<runtime-emulator-package>'
// const emu = new <RuntimeEmulator>({ script: '', bindings: ['KV'] })
// const kv = await emu.getKVNamespace('KV')
```

runtime-환경 테스트는 `*.integration.test.ts` 파일에 분리, CI 에서는 별도 단계 실행.

## DB 격리 전략

| 전략 | 언제 | 설정 |
|---|---|---|
| in-memory better-sqlite3 | 단위 테스트 | `drizzle(new Database(':memory:'))` |
| managed DB branch per CI run | CI 통합 테스트 | DB provider CLI 로 branch 생성 (예: `<db CLI> branches create --parent main test-$CI_RUN_ID`) — instance 측 project-local skill 참조 |
| Transaction rollback | 각 테스트 | `await db.transaction(async tx => { ...; tx.rollback() })` |

```ts
// in-memory DB helper (단위 테스트용)
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../db/schema'

export function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './drizzle' })
  return db
}
```

> Production 코드의 DB 타입: `PgDatabase` from `drizzle-orm/pg-core`
> (managed DB driver 경유 — instance 측 project-local skill). 테스트 helper 의 in-memory DB 는 별개.

## Vitest 마커 규칙 (vitest.config.ts 대신 파일명 + `describe` 레이블)

| 분류 | 파일 패턴 | 실행 |
|---|---|---|
| unit | `*.test.ts` | `vitest run` (기본) |
| integration | `*.integration.test.ts` | `vitest run --project integration` |
| slow | `describe('[slow]', ...)` 안에 | `vitest run --reporter=verbose` |

```ts
// 실행 커맨드
// 단위:        npx vitest run
// 단위+상세:   npx vitest run --reporter=verbose
// watch:       npx vitest --watch
// bail on 1st: npx vitest run --reporter=verbose --bail=1
// 통합:        npx vitest run --project integration
```

## 동시성 함정 — 이 서브시스템 고유

1. **`async generator` 혼용**
   `vi.fn().mockResolvedValue(asyncGen())` 패턴은 `for await` 가 generator 를 한 번
   더 await 해서 원래 generator 가 나오지 않는다. 항상 `async *callStream() { yield ... }` 직접 정의.

2. **`vi.mock` 호이스팅 주의**
   `vi.mock(...)` 는 파일 최상단으로 호이스팅된다. factory 안에서 `vi.mock` 을
   동적으로 쓰려면 `vi.doMock` (호이스팅 없음) 사용.

3. **runtime 비호환 패턴**
   `setInterval`, `Buffer`, `fs` 모듈 직접 import 는 일부 runtime 에서 동작하지
   않는다. 단위 테스트에서 동작해도 deploy 후 실패할 수 있으니, node
   전용 API 사용 시 `vi.mock` 으로 격리 (runtime 호환성은 instance 측 project-local skill 참조).

## 검증 체크리스트

- [ ] `vitest.config.ts` 에 `setupFiles`, `pool: 'forks'`, `globals: true` 설정
- [ ] `src/test/setup.ts` 에 `afterEach(() => vi.restoreAllMocks())` 적용
- [ ] `makeMockProvider` 가 async generator `callStream` 포함 (FACTORY 패턴)
- [ ] framework in-process request helper 패턴 사용 (path + init + env)
- [ ] DB 격리 전략 명시 (in-memory 또는 managed DB branch)
- [ ] runtime 환경 테스트: runtime-specific test harness 언급 (instance 측 project-local skill)
- [ ] SSE 응답 테스트 예시 1개
- [ ] 동시성 함정 3개 (async generator / vi.mock hoisting / runtime 비호환)

## 구현 중 막히면

- "async mock이 안 된다" → `vi.fn()` 대신 async generator function 직접 정의
- "test 가 다른 test 에 영향 준다" → `beforeEach(() => vi.restoreAllMocks())` 또는 module-level singleton 리셋
- "runtime binding 이 필요하다" → runtime-specific test harness 통합 테스트로 분리 (instance 측 project-local skill 참조)
- "DB 테스트 격리가 필요하다" → `better-sqlite3` in-memory 또는 Drizzle transaction rollback
- 위 가이드로 안 풀리면: 사용자에게 보고.

## 관련 skill

- 새 테스트 파일 골격 → `test-scaffold`
- afterEach/afterAll 정리 패턴 → `test-cleanup`
- TDD red→green 사이클 적용 → `red-green-fix`
