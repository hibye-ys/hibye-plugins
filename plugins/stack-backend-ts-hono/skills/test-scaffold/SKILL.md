---
name: test-scaffold
description: Template-driven test file generation for `apps/api/src/`. Creates unit + integration skeletons following the project's Vitest + Hono app.request patterns (FACTORY mocks, async generator streams). Load this skill when a new module needs tests or test-cleanup identifies coverage gaps.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/skills/test-scaffold
allowed-tools: Read, Write, Edit, Bash
---

**적용된 §4.4 매트릭스 행**: pytest fixture (conftest.py) → Vitest setup.ts, async test (pytest-asyncio) → it(..., async () => ...), HTTP 클라이언트 (TestClient → app.request)

# test-scaffold — 테스트 스캐폴딩 가이드

## 이 skill은 언제 로드되는가

- 새 모듈 생성 후 대응 테스트 필요 시
- `test-cleanup` 이 coverage gap 을 보고한 후
- route / service / provider 추가 시 기본 테스트 파일 골격 생성

## 이 skill은 언제 로드되지 않는가

- 기존 테스트 정리 (→ `test-cleanup` skill)
- Vitest 설정 / mock 패턴 이해 (→ `testing-infra` skill)
- 버그 수정용 테스트 (→ `red-green-fix` skill)

## 원칙은 Rule 에 있다

`testing-infra` skill 의 setup.ts / `makeMockProvider` 규약,
`red-green-fix` skill 의 5-step 워크플로우 참조.

## 테스트 파일 기본 템플릿

```ts
// apps/api/src/<module>/__tests__/<module>.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Vitest setup.ts 의 afterEach(vi.restoreAllMocks) 가 자동 적용된다 ---
// testing-infra SKILL.md 의 setup.ts 참조

describe('<ModuleName>', () => {
  beforeEach(() => {
    // 모듈 레벨 singleton 리셋 필요 시 여기에
  })

  // === 성공 시나리오 ===

  it('happy path — 정상 입력 → 기대 출력', async () => {
    // Arrange
    const input = { ... }
    // Act
    const result = await <functionUnderTest>(input)
    // Assert
    expect(result).toEqual(expected)
  })

  // === 실패 시나리오 ===

  it('invalid input — throws validation error', async () => {
    await expect(<functionUnderTest>({})).rejects.toThrow(...)
  })

  // === 권한/경계 시나리오 ===

  it('unauthorized — returns 401', async () => {
    ...
  })
})
```

## 생성 절차

### Step 1: 대상 모듈 파악

```bash
# 테스트할 모듈의 public export 확인
grep -n "^export " apps/api/src/<module>.ts | grep -v "^_"
```

### Step 2: 기존 test helper 확인

```bash
# 사용 가능한 helper / mock factory
ls apps/api/src/test/
# makeMockProvider, createTestDb, makeTestEnv, apiRequest 등
```

### Step 3: Mock 패턴 결정

```bash
# FACTORY 패턴 사용 예시
grep -n "makeMockProvider\|vi.spyOn" apps/api/src/**/*.test.ts | head -10

# async generator 패턴 확인
grep -n "async \*" apps/api/src/test/ | head -10
```

### Step 4: 파일 생성

- 경로: `apps/api/src/<module>/__tests__/<module>.test.ts`
- 최소 3 시나리오: happy_path + invalid_input + permission/boundary
- provider 모듈이면: streaming + 4 error types + circuit breaker
- tool 모듈이면: validate + permissions + call 성공/실패

### Step 5: 실행 검증

```bash
npx vitest run apps/api/src/<module>/__tests__/<module>.test.ts --reporter=verbose
```

## 모듈 타입별 최소 시나리오

| 모듈 타입 | 최소 테스트 |
|-----------|-----------|
| Provider | normal_call, streaming, rate_limit_retry, auth_error, circuit_breaker |
| Tool | validate_ok, validate_fail, permissions_deny, call_success, call_error |
| Engine/Service | stage_입력→출력, error_recovery, state_transition |
| Route | 200_ok, 401_unauth, 422_validation, 404_not_found |
| Data/DB | write_ok, cache_invalidation, port_protocol_usage |

## Route 테스트 골격 (Hono app.request)

```ts
// apps/api/src/routes/__tests__/my-route.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { apiRequest } from '../../test/helpers'      // testing-infra SKILL.md
import { makeMockProvider } from '../../test/mock-provider'
import * as providerModule from '../../providers/index'

describe('POST /api/my-route', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('200 — happy path', async () => {
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(
      makeMockProvider([
        { type: 'text_delta', payload: { text: 'ok' } },
        { type: 'done', payload: {} },
      ]) as any,
    )

    const res = await apiRequest('/api/my-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'value' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ... })
  })

  it('401 — missing auth header', async () => {
    const res = await apiRequest('/api/my-route', {
      method: 'POST',
      body: JSON.stringify({ field: 'value' }),
      // Authorization 헤더 없음
    })
    expect(res.status).toBe(401)
  })

  it('422 — missing required field', async () => {
    const res = await apiRequest('/api/my-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),  // required field 누락
    })
    expect(res.status).toBe(422)
  })

  it('404 — resource not found', async () => {
    const res = await apiRequest('/api/my-route/nonexistent-id', {
      method: 'GET',
    })
    expect(res.status).toBe(404)
  })
})
```

## Provider Mock 테스트 골격

```ts
// apps/api/src/providers/__tests__/my-provider.test.ts
import { describe, it, expect, vi } from 'vitest'
import { makeMockProvider } from '../../test/mock-provider'

describe('MyProvider', () => {
  it('streams text events in order', async () => {
    const provider = makeMockProvider([
      { type: 'text_delta', payload: { text: 'Hello' } },
      { type: 'text_delta', payload: { text: ', world' } },
      { type: 'done', payload: {} },
    ])

    const events: { type: string }[] = []
    for await (const ev of provider.callStream({})) {
      events.push(ev)
    }

    expect(events.map(e => e.type)).toEqual([
      'text_delta', 'text_delta', 'done',
    ])
  })

  it('simulates rate limit error', async () => {
    const provider = makeMockProvider([
      { type: 'error', payload: { code: 429, message: 'rate limited' } },
    ])

    const events = []
    for await (const ev of provider.callStream({})) {
      events.push(ev)
    }

    expect(events[0]).toMatchObject({ type: 'error', payload: { code: 429 } })
  })
})
```

## SSE 스트리밍 테스트 골격

```ts
// SSE 응답: content-type 확인 + body 파싱
it('SSE — emits events as text/event-stream', async () => {
  vi.spyOn(providerModule, 'getProvider').mockReturnValue(
    makeMockProvider([
      { type: 'text_delta', payload: { text: 'hi' } },
      { type: 'done', payload: {} },
    ]) as any,
  )

  const res = await apiRequest('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hi', sessionId: 'test-sse' }),
  })

  expect(res.headers.get('content-type')).toContain('text/event-stream')

  const text = await res.text()
  const dataLines = text.split('\n').filter(l => l.startsWith('data:'))
  const parsed = dataLines.map(l => JSON.parse(l.slice(5).trim()))

  expect(parsed.some(e => e.type === 'done')).toBe(true)
  expect(parsed.some(e => e.type === 'text_delta')).toBe(true)
})
```

## 검증 체크리스트

- [ ] 파일 생성 후 `vitest run` 통과
- [ ] `testing-infra` 의 setup.ts `afterEach(vi.restoreAllMocks)` 와 충돌 없음
- [ ] async generator mock shape 이 실제 구현과 일치
- [ ] 테스트 이름이 `<behavior> — <조건>` 패턴
- [ ] 최소 3 시나리오 (happy / invalid / boundary) 포함

## 구현 중 막히면

- `src/test/` 없음 → `testing-infra` skill 로 먼저 setup.ts / helpers.ts 생성
- 모듈 구조 복잡 → 먼저 `grep "^export "` 로 public API 파악
- Mock 어떻게 → `grep "makeMockProvider\|vi.spyOn" apps/api/src/` 로 기존 패턴 참조
- SSE body 파싱 안 됨 → `res.text()` 후 `\n` split, `data:` prefix 필터링
