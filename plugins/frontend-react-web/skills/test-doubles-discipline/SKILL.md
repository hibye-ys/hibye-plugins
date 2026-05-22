---
name: test-doubles-discipline
description: vitest / jest mock 규율 — boundary 만 mock (network → MSW, time → fake timers, random → spy). 내부 모듈 mock ✕ + Math.random / Date.now 글로벌 재할당 ✕ + mock reset 의무. vitest config / test 파일 작성·리뷰 시 자동 트리거.
metadata:
  priority: 3
  docs:
    - "https://vitest.dev/api/mock.html"
    - "https://vitest.dev/api/vi.html"
    - "https://vitest.dev/guide/mocking.html"
    - "https://kentcdodds.com/blog/the-merits-of-mocking"
  pathPatterns:
    - '**/*.test.ts'
    - '**/*.test.tsx'
    - '**/*.test.js'
    - '**/*.test.jsx'
    - '**/*.spec.ts'
    - '**/*.spec.tsx'
    - '**/*.spec.js'
    - '**/*.spec.jsx'
    - 'vitest.config.ts'
    - 'vitest.config.js'
    - 'vitest.config.mjs'
    - 'vitest.setup.ts'
    - 'vitest.setup.js'
  bashPatterns: []
  importPatterns:
    - 'vitest'
    - 'jest'
    - 'sinon'
    - '@vitest/spy'
    - 'msw'
validate:
  - pattern: 'vi\.mock\s*\(\s*[`''"](?!(?:node:|fs|path|crypto|child_process|http|https|net|os|util|stream|events|dns|tls|cluster|worker_threads|fs/promises|next/|@sentry/|@tanstack/|swr|electron)).+[`''"]'
    message: 'vi.mock 으로 내부 모듈 mock — 의존성 주입 / re-export 패턴 권장. 외부 boundary (node:* / next/ / @sentry/ / 네트워크 라이브러리) 또는 framework module 만 mock. 내부 함수 mock 은 implementation 검증으로 빠지기 쉬움.'
    severity: warn
  - pattern: 'jest\.(?:mock|spyOn|fn|clearAllMocks|resetAllMocks|restoreAllMocks)\s*\('
    message: 'jest API 사용 — vitest 환경이면 vi.* 로 통일. jest 환경이면 본 skill 미적용 (path 패턴 vitest 중심).'
    severity: warn
  - pattern: '(?:Math\.random|Date\.now|performance\.now)\s*=\s*'
    message: '글로벌 함수 직접 재할당 — type-safe ✕ + restore 불가능. vi.useFakeTimers() + vi.setSystemTime() (Date) / vi.spyOn(Math, "random") (random) 사용.'
    severity: error
retrieval:
  aliases:
    - mock
    - spy
    - stub
    - vitest mock
    - fake timers
    - test isolation
    - test double
  intents:
    - mock module
    - fake date
    - mock fetch
    - reset mocks
    - spy function
    - test in isolation
  entities:
    - vi.mock
    - vi.spyOn
    - vi.fn
    - vi.useFakeTimers
    - vi.setSystemTime
    - server.use
chainTo: []
---

# test-doubles-discipline

**Testing trophy 의 unit 층 핵심 규율** — mock 은 *boundary 만* (network / time / random / storage / framework module). 내부 비즈니스 로직 mock ✕ — implementation 검증으로 빠짐. 시간 / 랜덤 = `vi.useFakeTimers()` / `vi.spyOn(Math, 'random')` (글로벌 함수 재할당 ✕). 본 skill 은 *3 패턴 즉시 검출 + 7 원칙 + 안티패턴 표* . 깊은 정적 검증은 `eslint-plugin-vitest` (recommended preset, 17+ 룰) 위임.

## When to apply

- 새 unit test 작성 (`*.test.ts` / `*.spec.tsx`) 안 mock 도입 결정
- `vitest.setup.ts` / `vitest.config.ts` 작성 — global mock / restore policy 설정
- fetch mock 결정 — `vi.spyOn(global, 'fetch')` vs MSW handler
- `Date.now()` / `Math.random()` 고정 필요 — fake timers / spy 선택
- 기존 test 의 mock cleanup 패턴 검토 (`clearAllMocks` / `resetAllMocks` / `restoreAllMocks`)
- snapshot test 작성 시 결정성 (Date / uuid / Math) 확보
- jest → vitest 마이그레이션 — `jest.*` API 잔재 검출

## 핵심 원칙

### 1. Mock = boundary 만 (내부 모듈 mock ✕)

- *boundary* = network / time / random / storage / framework module / OS API
- 내부 비즈니스 로직 mock 시 → implementation 검증으로 빠짐 (refactor 시 test 깨짐, behavior 검증 ✕)
- 내부 의존성이 무거우면 = **의존성 주입** 또는 **re-export 분리** 가 정답
- 본 plugin validate 가 *내부 path mock* (`./api/userService` 등) warn 으로 즉시 표시

```ts
// ✕ 내부 모듈 mock — implementation coupling
vi.mock('./api/userService')

// ✓ 의존성 주입
function createOrderUseCase(deps: { fetchUser: typeof fetchUser }) { ... }
// test 에서 fake fetchUser 전달
```

### 2. 네트워크 = MSW (`vi.spyOn(global, 'fetch')` ✕)

- `vi.spyOn(global, 'fetch')` 또는 `vi.fn().mockResolvedValue(...)` 로 fetch mock = *URL / method / body 검증 누락*
- MSW handler = *request-response 계약* 우선 — 실제 fetch 호출은 통과, network layer 에서 가로채기
- spec 별 `server.use(http.get(...))` + `afterEach(server.resetHandlers)` 의무
- cross-reference: `playwright-msw-e2e` skill (E2E 측 MSW Browser worker)

### 3. 시간 = fake timers (`vi.useFakeTimers()` + `vi.setSystemTime()`)

- `vi.useFakeTimers()` = `setTimeout` / `setInterval` / `Date` / `performance.now` 통째로 fake
- `vi.setSystemTime(new Date('2024-01-15'))` = system time 고정 (Date.now / new Date 반환값)
- `vi.advanceTimersByTime(1000)` / `vi.runAllTimers()` 로 의도적 tick
- `afterEach(() => vi.useRealTimers())` 의무 — 다른 test 오염 방지

### 4. 랜덤 = `vi.spyOn(Math, 'random')` (글로벌 재할당 ✕)

- `Math.random = () => 0.5` ✕ — type-safe ✕ + restore 불가능 + 다른 test 영향
- `vi.spyOn(Math, 'random').mockReturnValue(0.5)` → `vi.restoreAllMocks()` 로 정상 복구
- seed 가능 PRNG 라이브러리 (`seedrandom`) 도 결정성 대안
- 본 plugin validate rule 3 (`error`) 이 즉시 표시

### 5. mock reset 의무 — 3 종 차이

| API | 무엇 | 언제 |
|---|---|---|
| `vi.clearAllMocks()` | call history (calls / instances) 만 clear | 매 test 시작 (`beforeEach`) — 호출 횟수 격리 |
| `vi.resetAllMocks()` | history + implementation 둘 다 reset | mock impl 도 새로 시작할 때 |
| `vi.restoreAllMocks()` | spy 만 원본 함수로 복원 | `vi.spyOn` 후 정리 (`afterEach`) — `vi.mock` factory 는 영향 ✕ |

- `vitest.config.ts` 에 `clearMocks: true` / `restoreMocks: true` 글로벌 설정도 가능
- 명시적 hook 사용이 의도 가시화에 더 좋음

### 6. `vi.hoisted` for factory variable (top-level)

- `vi.mock` factory 는 *파일 상단으로 hoisting* 됨 — 그 안에서 top-level 변수 참조 ✕
- 해결 = `const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }))` — hoisting 안전 변수 묶음

```ts
const { mockFetchUser } = vi.hoisted(() => ({
  mockFetchUser: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchUser: mockFetchUser,
}))
```

### 7. snapshot test 결정성 = Date / Math / uuid mock 필수

- snapshot 안 `2024-01-15T10:23:45.123Z` / `0.7384...` / `f7c8e2d4-...` 이 들어가면 — *매 실행 mismatch*
- mock 필수: `vi.setSystemTime()` (Date) + `vi.spyOn(Math, 'random')` (uuid v4 backing) + uuid 직접 mock
- 또는 — snapshot 자체 회피 (assertion 으로 변경)

## fake timers + setSystemTime 예시

```tsx
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

describe('ExpiryBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('만료 3일 전 노출', () => {
    const expiresAt = new Date('2024-01-18T00:00:00Z')
    expect(daysUntilExpiry(expiresAt)).toBe(3)  // Date.now 고정 → 결정성
  })

  test('1초 후 polling 발생', () => {
    const onTick = vi.fn()
    startPolling(onTick, 1000)
    vi.advanceTimersByTime(1000)  // setTimeout 강제 발화
    expect(onTick).toHaveBeenCalledTimes(1)
  })
})
```

`setSystemTime` = `Date.now()` / `new Date()` 반환 고정. `advanceTimersByTime` = `setTimeout` / `setInterval` 강제 발화.

## fetch mock vs MSW 비교

```ts
// ✕ vi.spyOn(global, 'fetch') — URL / method / body 검증 누락
vi.spyOn(global, 'fetch').mockResolvedValue(
  new Response(JSON.stringify({ user: { name: 'Alice' } })),
)
// 실제 어떤 URL 로 어떤 body 보냈는지 검증 안 됨 (call args 봐야 함)

// ✓ MSW handler — request-response 계약 우선
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

const server = setupServer()
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('user fetch', async () => {
  server.use(
    http.get('/api/users/:id', ({ params }) => {
      expect(params.id).toBe('u1')  // URL 매칭 자동
      return HttpResponse.json({ user: { name: 'Alice' } })
    }),
  )
  const user = await fetchUser('u1')
  expect(user.name).toBe('Alice')
})
```

MSW = network layer 가로채기 → 실제 fetch 코드 그대로 통과 → URL / method / body 검증이 handler 안에서 자연스럽게.

## 안티패턴 표 (검출 경로 명시)

| 안티 | 교정 | 검출 |
|---|---|---|
| `Math.random = () => 0.5` (글로벌 재할당) | `vi.spyOn(Math, 'random').mockReturnValue(0.5)` | **validate (error)** |
| `Date.now = () => 1234567890` | `vi.useFakeTimers()` + `vi.setSystemTime(...)` | **validate (error)** |
| `vi.mock('./api/userService')` (내부 모듈) | 의존성 주입 또는 re-export 분리 | **validate (warn)** |
| `vi.mock('lodash')` (소규모 utility) | 실제 사용 (mock 가치 ✕) | **validate (warn)** |
| `jest.mock('x')` (vitest 환경) | `vi.mock('x')` 로 통일 | **validate (warn)** |
| `vi.spyOn(global, 'fetch')` | MSW handler (`server.use`) | 수동 / playwright-msw-e2e cross-ref |
| `clearAllMocks` 없이 test 간 call count 누적 | `beforeEach(vi.clearAllMocks)` + `clearMocks: true` config | eslint-plugin-vitest |
| `vi.spyOn` 후 `restoreAllMocks` 누락 | `afterEach(vi.restoreAllMocks)` | 수동 |
| `vi.fn` 호출 횟수 assertion 없이 종료 | `expect(fn).toHaveBeenCalledWith(...)` | eslint-plugin-vitest/expect-expect |
| `vi.mock` factory 안 top-level 변수 import | `vi.hoisted(() => ({ ... }))` 묶음 | runtime error (hoisting) |
| overmock — 컴포넌트의 모든 의존 mock | boundary 만 mock + 나머지 실제 사용 | 수동 리뷰 |
| snapshot 안 `Date.now` / `uuid` 그대로 | `vi.setSystemTime` / uuid mock + 또는 assertion 대체 | 수동 (snapshot diff) |

## 도구 위임 (이 skill 의 진입점 역할)

- **정적 (recommended, 17+ 룰)**: `eslint-plugin-vitest` `recommended` preset:
  - `expect-expect` → test 안 assertion 없는 경우 검출
  - `no-disabled-tests` / `no-focused-tests` → `.skip` / `.only` CI commit 차단
  - `prefer-spy-on` → `obj.method = vi.fn()` 같은 monkey-patch 검출 (본 plugin Math.random 글로벌 재할당 error 과 *다른 경로* — object method 일반)
  - `consistent-test-it` → `test` / `it` 통일
  - `require-top-level-describe` → test 그룹 강제
  - `no-conditional-tests` / `no-conditional-expect` → if 안 expect 검출
- **본 plugin validate 가 *추가* 하는 영역**:
  - `vi.mock` 내부 모듈 path warn — implementation coupling 가시화 (recommended 미커버)
  - `jest.*` API 사용 warn — vitest 환경 통일 가이드
  - `Math.random` / `Date.now` / `performance.now` 글로벌 재할당 즉시 error — type-safe ✕ + restore 불가
- **MSW** (network boundary) — `playwright-msw-e2e` skill cross-ref (Browser worker 패턴), unit test = `msw/node` `setupServer`
- **결정성 데이터**: `@faker-js/faker` (seedable — `faker.seed(123)`) + `seedrandom` (PRNG)
- **Phase 1/2 cross-ref**:
  - `async-race-avoidance` — test 안 race / cleanup (AbortController / ignore flag) 적용
  - `server-vs-client-state` — server state mock 시 MSW 우선 (TanStack Query 의 fetch 자연 통과)
  - `rtl-query-priority` — RTL query + user-event 와 mock 결정 (component test 단계)

## 참조

- [Vitest — Mocking guide](https://vitest.dev/guide/mocking.html) · [vi API](https://vitest.dev/api/vi.html) · [Mock functions](https://vitest.dev/api/mock.html)
- [Vitest — Fake Timers](https://vitest.dev/api/vi.html#vi-usefaketimers) · [setSystemTime](https://vitest.dev/api/vi.html#vi-setsystemtime)
- [MSW v2 — Node integration](https://mswjs.io/docs/integrations/node) · [Mocking REST](https://mswjs.io/docs/network-behavior/rest)
- [Kent C. Dodds — The Merits of Mocking](https://kentcdodds.com/blog/the-merits-of-mocking) · [Stop mocking fetch](https://kentcdodds.com/blog/stop-mocking-fetch)
- [eslint-plugin-vitest — rules](https://github.com/vitest-dev/eslint-plugin-vitest/tree/main/docs/rules)
- [Testing Trophy — Kent C. Dodds](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)
- [seedrandom](https://github.com/davidbau/seedrandom) · [@faker-js/faker — seed](https://fakerjs.dev/api/faker.html#seed)
