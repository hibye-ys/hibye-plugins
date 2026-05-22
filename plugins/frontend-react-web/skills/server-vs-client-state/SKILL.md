---
name: server-vs-client-state
description: server state (네트워크 fetch 캐시) vs client state (UI 상태) 분리 강제. zustand / redux 안 server state 저장 / useState 안 await fetch 같은 mixing 검출. TanStack Query / SWR 위임 권장.
metadata:
  priority: 4
  docs:
    - "https://tkdodo.eu/blog/why-you-want-react-query"
    - "https://tanstack.com/query/latest"
    - "https://swr.vercel.app/"
    - "https://zustand.docs.pmnd.rs/"
    - "https://jotai.org/"
  pathPatterns:
    - 'src/**/*.{ts,tsx}'
    - 'app/**/*.{ts,tsx}'
    - 'store/**/*.{ts,tsx}'
    - 'src/store/**/*.{ts,tsx}'
    - 'src/stores/**/*.{ts,tsx}'
    - 'lib/store/**/*.{ts,tsx}'
    - 'src/hooks/**/*.{ts,tsx}'
  bashPatterns: []
  importPatterns:
    - 'zustand'
    - 'jotai'
    - 'redux'
    - '@reduxjs/toolkit'
    - '@tanstack/react-query'
    - 'swr'
    - 'react'
validate:
  - pattern: '\bcreate\s*\(\s*\([^)]*\)\s*=>\s*\([^)]*\)\s*=>\s*\{[\s\S]{0,1500}\bawait\s+(fetch|axios)\s*\('
    message: 'Zustand create() 안 await fetch — server state 가 client store 안 저장. TanStack Query / SWR / use() 로 server state 분리.'
    severity: warn
  - pattern: 'useState\s*\([^)]*\)\s*[\s\S]{0,100}\bawait\s+(fetch|axios|api\.)'
    message: 'useState 초기값 + 같은 hook 안 await fetch — initialization 패턴이 mixing. useEffect 또는 TanStack Query useQuery 사용.'
    severity: warn
retrieval:
  aliases:
    - server state
    - client state
    - TanStack Query
    - zustand
    - URL state
    - useState
  intents:
    - separate server and client state
    - choose state library
    - fetch caching
    - URL search params state
  entities:
    - useQuery
    - zustand store
    - useState
    - useSearchParams
    - server state
    - client state
chainTo: []
---

# server-vs-client-state

**state 종류 분리 = bug 줄이는 첫 번째 결정.** server state (네트워크 fetch 결과 = 캐시) 와 client state (UI 토글 / form draft) 는 *다른 도구로* 관리. 혼동 시 stale data / over-fetching / unsynced UI. 본 skill 은 *5 종 state 결정 트리 + 라이브러리 선택 안내*. 깊은 캐싱 / 무효화는 TanStack Query / SWR 자체 docs 위임.

## When to apply

- 새 state 추가 시 (data / UI / form / URL)
- 기존 zustand / redux store 가 너무 커짐
- "왜 페이지 마다 fetch 가 또?" / stale data 문제
- form draft 와 server 저장 동기화
- 라이브러리 선택 결정 (Zustand vs TanStack Query vs Context vs useState)

## 핵심 원칙 — 5 종 state

### 1. Server state = TanStack Query / SWR / use()

- 데이터 = 네트워크 fetch 의 *cache*
- 자동 dedup / retry / window-focus refetch / stale-while-revalidate
- *어디서나 동일 데이터* — Zustand 안 보관 ✕ (캐시 중복)

```ts
import { useQuery } from '@tanstack/react-query'

function User({ id }: Props) {
  const { data, isPending } = useQuery({
    queryKey: ['user', id],
    queryFn: () => fetch(`/api/users/${id}`).then(r => r.json()),
  })
  // ...
}
```

### 2. URL state = useSearchParams / nuqs

- filter / sort / tab / pagination / search query
- *URL 이 source of truth* — 새로고침 / share link / back button 자연 작동
- React Router `useSearchParams` 또는 Next.js `useSearchParams` + `useRouter().push`
- 더 편리한 wrapper = `nuqs` (typed search params)

```ts
import { useSearchParams } from 'next/navigation'

function Filter() {
  const params = useSearchParams()
  const sort = params.get('sort') ?? 'recent'
  // ...
}
```

### 3. Form draft = useState + RHF / Conform

- 사용자가 입력 중 (아직 submit 전) 데이터
- useState (간단), react-hook-form (큰 form 성능), Conform (server action + zod)
- *server state 와 분리* — submit 시 server state 갱신

### 4. Local UI state = useState / useReducer

- 모달 open / drawer open / hover / accordion expanded
- 같은 컴포넌트 / 작은 트리 안에서만 사용
- prop drilling 가벼우면 useState, 여러 level 이면 Context (단 큰 객체 ✕)

### 5. Global app state = Zustand / Jotai

- 여러 page / 컴포넌트가 *공유* 하는 *client* state
- 사용자 preference (theme / locale / sidebar collapsed)
- 인증 토큰 (session) — *단 server 검증 동반*
- 절대 server state 보관 ✕ (server-vs-client-state 의 핵심 invariant)

### 6. cross-tab state = BroadcastChannel + storage event

- 같은 origin 의 다른 탭 간 sync (logout / theme change 등)
- `BroadcastChannel('app').postMessage({...})` + listener
- Zustand 의 `subscribe` + `persist` middleware 활용 가능

### 7. derived state = useMemo / 그냥 derive

- 다른 state 에서 *유도* 가능한 값 = 별도 state ✕
- `const isAdmin = user.role === 'admin'` — render 안 직접 (render-purity 참고)
- 비싸면 `useMemo` — *성능 hint* 만

## 결정 트리

```
새 state 추가:
├─ 네트워크 fetch 결과인가?
│   └─ YES → server state → TanStack Query / SWR
├─ URL 에 반영 (share link / back button 자연 작동) 필요?
│   └─ YES → URL state → useSearchParams + nuqs
├─ 입력 중 form 값?
│   └─ YES → form state → useState / RHF / Conform
├─ 한 컴포넌트 안에서만?
│   └─ YES → local UI state → useState / useReducer
├─ 여러 컴포넌트 공유 (client only)?
│   └─ YES → global state → Zustand / Jotai
└─ 다른 state 에서 derive 가능?
    └─ YES → derive (별도 state ✕)
```

## 도구 위임 (이 skill 의 진입점 역할)

- **server state**: TanStack Query / SWR / `use()` — 자체 docs
- **form state**: react-hook-form / Conform — input-state-contract skill 참고
- **dev**: TanStack Query devtools / Redux DevTools / Zustand devtools middleware
- **수동 audit**: "이 state 가 *서버에서 온 값*인가?" 자문 — YES 면 TanStack Query 로 옮김

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| Zustand 안 `await fetch` (server state 저장) | TanStack Query | **validate (warn)** |
| `useState(() => fetch(...))` (init async) | useEffect 또는 TanStack Query | **validate (warn)** |
| 같은 fetch 결과를 여러 컴포넌트가 각자 useEffect | 한 곳에서 useQuery (dedup 자동) | 수동 |
| filter state 가 useState (URL 미반영) | useSearchParams + nuqs | 수동 |
| 거대한 Context 로 전체 앱 state | 작은 단위 + Zustand atom | 수동 |
| Redux + RTK Query 안 server state 분리 ✕ | RTK Query slice 별도 | 수동 |
| derived 값을 useState + useEffect | render 안 derive 직접 (render-purity) | 수동 |
| URL state 를 router push 후 즉시 read | useSearchParams 직접 | 수동 |
| `localStorage.setItem(JSON.stringify(state))` 자체 구현 | Zustand `persist` middleware | 수동 |
| optimistic update 자체 구현 | `useOptimistic` (React 19) / TanStack mutate.onMutate | 수동 |

## TanStack Query + Zustand 결합 패턴

```tsx
// stores/uiStore.ts — client only
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type UIStore = {
  theme: 'light' | 'dark'
  sidebarCollapsed: boolean
  setTheme: (t: UIStore['theme']) => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      theme: 'light',
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'ui-store' },
  ),
)
```

```tsx
// hooks/useUser.ts — server state
import { useQuery } from '@tanstack/react-query'

export function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: ({ signal }) => fetch(`/api/users/${id}`, { signal }).then(r => r.json()),
    staleTime: 60_000,
  })
}
```

```tsx
// app/profile/page.tsx
'use client'

export default function ProfilePage({ userId }: Props) {
  const { data: user, isPending } = useUser(userId)  // server state
  const theme = useUIStore(s => s.theme)             // client state
  const sidebar = useUIStore(s => s.sidebarCollapsed)
  // ...
}
```

## URL state (nuqs) 패턴

```tsx
import { useQueryState } from 'nuqs'

function PostList() {
  const [sort, setSort] = useQueryState('sort', { defaultValue: 'recent' })
  const [page, setPage] = useQueryState('page', { defaultValue: '1' })
  // URL: /posts?sort=popular&page=2 자동 sync
}
```

share link / 새로고침 / back button 자연 작동.

## Optimistic update 패턴 (React 19)

```tsx
'use client'
import { useOptimistic } from 'react'

function Likes({ postId, initialLikes }: Props) {
  const [optimisticLikes, addOptimisticLike] = useOptimistic(
    initialLikes,
    (prev: number, increment: number) => prev + increment,
  )

  async function like() {
    addOptimisticLike(1)  // 즉시 UI 갱신
    await fetch(`/api/posts/${postId}/like`, { method: 'POST' })
    // server 응답 후 자동 reconciliation
  }

  return <button onClick={like}>좋아요 ({optimisticLikes})</button>
}
```

## 참조

- [TkDodo — Why React Query?](https://tkdodo.eu/blog/why-you-want-react-query) · [Practical React Query 시리즈](https://tkdodo.eu/blog/practical-react-query)
- [TanStack Query](https://tanstack.com/query/latest) · [SWR](https://swr.vercel.app/)
- [Zustand](https://zustand.docs.pmnd.rs/) · [Jotai](https://jotai.org/) · [nuqs](https://nuqs.47ng.com/)
- [React 19 — useOptimistic](https://react.dev/reference/react/useOptimistic)
- [RTK Query](https://redux-toolkit.js.org/rtk-query/overview)
