---
name: async-race-avoidance
description: useEffect 안 비동기 패턴 race / unmount 후 setState / stale closure 검출. AbortController 또는 ignore flag cleanup 패턴 강제. TanStack Query / SWR 위임 권장.
metadata:
  priority: 5
  docs:
    - "https://react.dev/learn/synchronizing-with-effects"
    - "https://react.dev/learn/you-might-not-need-an-effect"
    - "https://developer.mozilla.org/en-US/docs/Web/API/AbortController"
    - "https://tanstack.com/query/latest"
  pathPatterns:
    - 'src/**/*.{tsx,jsx,ts}'
    - 'app/**/*.{tsx,jsx,ts}'
    - 'components/**/*.{tsx,jsx}'
    - 'src/components/**/*.{tsx,jsx}'
    - 'src/hooks/**/*.{ts,tsx}'
  bashPatterns: []
  importPatterns:
    - 'react'
    - '@tanstack/react-query'
    - 'swr'
    - 'axios'
validate:
  - pattern: 'useEffect\s*\(\s*async\b'
    message: 'useEffect 콜백 자체가 async — return 값이 Promise 가 됨 (cleanup 함수가 아닌). useEffect 안 *별도 async 함수* 정의 후 호출.'
    severity: error
  - pattern: 'useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]*\bfetch\s*\([^)]*\)[^}]*\}\s*,'
    message: 'useEffect 안 fetch() — AbortController / ignore flag cleanup 없으면 unmount 후 setState 위험. TanStack Query / SWR 권장.'
    severity: warn
  - pattern: 'useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]*\bawait\s+[^;]+;[^}]*\bset[A-Z]\w*\s*\('
    message: 'useEffect 안 await 후 setState — race / unmount 위험. AbortController 또는 ignore flag.'
    severity: warn
retrieval:
  aliases:
    - useEffect race
    - AbortController
    - cleanup
    - stale closure
    - TanStack Query
  intents:
    - prevent race condition
    - fix unmount setState
    - useEffect cleanup
    - cancel fetch
  entities:
    - useEffect
    - AbortController
    - signal
    - cleanup
    - useQuery
chainTo:
  - pattern: '@tanstack/react-query|useQuery\s*\(|useSWR\s*\('
    targetSkill: server-vs-client-state
    message: 'Data fetching library 감지 — server-vs-client-state skill (B5.2) 로 chain (state 종류 결정 트리).'
---

# async-race-avoidance

**useEffect 안 비동기 = 가장 흔한 React bug 출처.** unmount 후 setState / stale closure / race condition / double-invoke (Strict Mode) 모두 cleanup 패턴으로 해결. 본 skill 은 *비동기 anti-pattern 검출 + AbortController/ignore flag 패턴 + data lib 위임*. 깊은 dep array 분석은 `react-hooks/exhaustive-deps` 위임.

## When to apply

- useEffect 안 fetch / axios / 네트워크 호출
- event listener attach / WebSocket subscribe
- async function in effect
- "Can't perform a React state update on an unmounted component" 경고
- Strict Mode (React 19) 의 double-invoke 견디기

## 핵심 원칙

### 1. useEffect 콜백 자체는 async ✕

- `useEffect(async () => { ... })` ✕ — return 값이 Promise 가 됨 (React 는 cleanup function 기대)
- `useEffect(() => { async function load() { ... } load() })` ✓

### 2. AbortController 로 cleanup (권장 패턴)

- `fetch(url, { signal: controller.signal })` + `cleanup: controller.abort()`
- abort 된 fetch 는 `AbortError` 던짐 — `if (err.name === 'AbortError') return` 으로 무시
- 모던 web API 통합 (fetch / XMLHttpRequest / WebSocket 등 일관)

### 3. ignore flag 패턴 (React 공식 권장)

- `let ignore = false; ... if (!ignore) setX(...); return () => { ignore = true }`
- AbortController 못 쓰는 케이스 (Promise.all 등) 에 적합
- React 19 docs: 두 패턴 모두 cleanup 으로 권장

### 4. 가능하면 TanStack Query / SWR / use() 위임

- 캐싱 / 중복 호출 dedup / 재시도 / window-focus refetch / suspense 통합 자동
- *server state* 는 zustand / Context 안 두지 ✕ (server-vs-client-state skill 참고)
- React 19 의 `use()` hook 도 alternative (Suspense boundary 안)

### 5. async function 은 effect 안 별도 함수로

```ts
useEffect(() => {
  async function load() {
    const res = await fetch(url)
    setData(await res.json())
  }
  load()
}, [url])
```

### 6. event listener / subscription cleanup 의무

- `useEffect(() => { window.addEventListener('resize', h); return () => window.removeEventListener('resize', h) })`
- WebSocket / EventSource / Observable 도 동일
- third-party library 통합 시 *반드시* cleanup 제공 함수 확인

### 7. Strict Mode 의 double-invoke 견디기

- React 19 Strict Mode = useEffect 두 번 호출 (mount → cleanup → mount)
- cleanup 패턴 (AbortController / ignore) 사용하면 자동으로 견딤
- side-effect 가 idempotent 면 OK, 아니면 useEffect 안 ✕

## 도구 위임 (이 skill 의 진입점 역할)

- **정적**: `react-hooks/exhaustive-deps` — useEffect dep array 자동 검증
- **데이터 fetching 권장**: TanStack Query / SWR — race / cancel / dedup 자동
- **수동 audit**: React DevTools "Highlight updates when components render" — 무한 render 확인
- **타입**: `AbortSignal` 타입 forwarding 으로 cancel 전파 가능

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `useEffect(async () => ...)` | effect 안 별도 async 함수 | **validate (error)** |
| `useEffect(() => fetch(url).then(setX))` (no cleanup) | AbortController + cleanup | **validate (warn)** |
| `useEffect(() => { await ...; setX(...) })` (await + setState) | ignore flag / AbortController | **validate (warn)** |
| `useEffect(() => addEventListener(...))` (no cleanup) | cleanup return 추가 | 수동 |
| Effect 안 setState 가 dep 의존 → 무한 루프 | derive 또는 callback | render-purity 참고 |
| fetch 결과를 zustand store 에 push (server state) | TanStack Query | server-vs-client-state 참고 |
| 같은 데이터 여러 컴포넌트가 useEffect 각각 fetch | TanStack Query (자동 dedup) | 수동 |
| stale closure (useEffect 안 변수 캡처) | useRef / functional setState | 수동 |
| WebSocket subscribe + no cleanup | cleanup unsubscribe | 수동 |
| Effect 안 timer (setTimeout/setInterval) + no cleanup | cleanup clearTimeout/clearInterval | 수동 |

## AbortController 패턴 (권장)

```tsx
import { useEffect, useState } from 'react'

function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const res = await fetch(`/api/users/${userId}`, { signal: controller.signal })
        const data = await res.json()
        setUser(data)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return  // unmount / dep change — 정상
        throw err
      }
    }
    load()
    return () => controller.abort()
  }, [userId])

  if (!user) return <Skeleton />
  return <Profile user={user} />
}
```

## ignore flag 패턴 (Promise.all 등)

```tsx
import { useEffect, useState } from 'react'

function Dashboard() {
  const [data, setData] = useState<DashData | null>(null)

  useEffect(() => {
    let ignore = false
    async function loadAll() {
      const [users, posts, stats] = await Promise.all([
        fetch('/api/users').then(r => r.json()),
        fetch('/api/posts').then(r => r.json()),
        fetch('/api/stats').then(r => r.json()),
      ])
      if (!ignore) setData({ users, posts, stats })
    }
    loadAll()
    return () => { ignore = true }
  }, [])

  // ...
}
```

## TanStack Query 위임 (권장)

```tsx
import { useQuery } from '@tanstack/react-query'

function UserProfile({ userId }: { userId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: ({ signal }) => fetch(`/api/users/${userId}`, { signal }).then(r => r.json()),
  })

  if (isPending) return <Skeleton />
  if (error) return <ErrorMessage error={error} />
  return <Profile user={data} />
}
```

자동: race avoidance (signal 자동 forwarding), dedup, retry, window-focus refetch, cache.

## 참조

- [React docs — Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects)
- [React docs — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) · [AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
- [TanStack Query — Default Query Function](https://tanstack.com/query/latest/docs/framework/react/guides/default-query-function) · [Query Cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
- [SWR](https://swr.vercel.app/) · [React 19 `use()`](https://react.dev/reference/react/use)
