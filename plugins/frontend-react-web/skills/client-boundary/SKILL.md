---
name: client-boundary
description: Next App Router 의 "use client" directive 경계 + server-only / client-only marker 사용 검증. server-only 모듈을 client 컴포넌트에서 import 또는 client hook (useState/useEffect) 을 server 컴포넌트에서 사용하는 4개 위반 검출. vercel:nextjs chainTo 보완.
metadata:
  priority: 5
  docs:
    - "https://nextjs.org/docs/app/getting-started/server-and-client-components"
    - "https://react.dev/reference/rsc/use-client"
    - "https://nextjs.org/docs/app/getting-started/server-and-client-components#the-server-only-package"
  pathPatterns:
    - 'app/**/*.tsx'
    - 'app/**/*.jsx'
    - 'app/**/*.ts'
    - 'src/app/**/*.tsx'
    - 'src/app/**/*.jsx'
    - 'src/app/**/*.ts'
    - 'components/**/*.{tsx,jsx}'
    - 'src/components/**/*.{tsx,jsx}'
  bashPatterns: []
  importPatterns:
    - 'next/headers'
    - 'next/cookies'
    - 'next/cache'
    - 'server-only'
    - 'client-only'
    - 'react'
validate:
  - pattern: '^["'']use client["''];?[\s\S]*?\bimport\b[^;]*\bfrom\s+["''](next/headers|next/cookies|next/cache)["'']'
    message: '"use client" 파일이 server-only 모듈 (next/headers / cookies / cache) import — server module 은 client component 에서 ✕. server component 로 이동 또는 props 통해 전달.'
    severity: error
  - pattern: '^import.*from\s+["'']server-only["'']'
    message: 'server-only marker import — 본 파일은 server-only. "use client" 와 함께 있으면 빌드 실패 (의도된 가드).'
    severity: warn
  - pattern: '^import.*from\s+["'']client-only["'']'
    message: 'client-only marker import — 본 파일은 client-only. server 환경에서 import 되면 빌드 실패 (의도된 가드).'
    severity: warn
  - pattern: '(?!.*["'']use client["''])[\s\S]*\b(useState|useEffect|useRef|useLayoutEffect|useReducer|useContext|useMemo|useCallback|useTransition|useDeferredValue|useSyncExternalStore|useId|useImperativeHandle|useInsertionEffect)\s*\('
    message: 'React client hook 사용 (useState / useEffect 등) — "use client" directive 없는 server component 에서. 파일 상단에 "use client" 추가 또는 해당 로직을 client component 로 분리.'
    severity: error
retrieval:
  aliases:
    - use client
    - server component
    - client component
    - RSC boundary
    - App Router boundary
  intents:
    - decide server or client component
    - add use client directive
    - server-only module
    - RSC boundary fix
  entities:
    - "use client"
    - server-only
    - client-only
    - Server Component
    - Client Component
chainTo:
  - pattern: 'next/headers|next/cookies|next/cache|cookies\(\)|headers\(\)'
    targetSkill: nextjs
    message: 'Next.js server-side API (headers / cookies / cache) 감지 — vercel:nextjs skill 로 chain (App Router 깊은 가이드).'
---

# client-boundary

**App Router 의 server / client 경계 = 정합성 + 성능의 출발점.** server-only 모듈을 client 에서 import 또는 client hook 을 server 에서 사용 = 빌드 실패 또는 hydration 오류. 본 skill 은 *경계 위반 검출 + 권장 boundary 결정* . 깊은 App Router 가이드는 `vercel:nextjs` chainTo 위임.

## When to apply

- App Router 의 새 컴포넌트 작성
- 기존 server / client component 리팩토링
- 데이터 fetching 위치 결정 (server vs client)
- "use client" directive 추가 / 제거 판단
- props 직렬화 (Server → Client) 문제 디버깅

## 핵심 원칙

### 1. "use client" = leaf only, 가능한 깊게

- 컴포넌트 트리 루트에 "use client" 박으면 *그 아래 전부* client = bundle size + RSC 이점 X
- interactivity 필요한 작은 leaf 만 "use client" — 부모는 server component
- "use client" = *경계* 의미 — directive 있는 파일 자체 + 그 안 import 된 컴포넌트 모두 client bundle

### 2. server-only / client-only marker 사용

- `import 'server-only'` — 본 파일 client import 시 빌드 실패 (DB / secret 보호)
- `import 'client-only'` — 본 파일 server import 시 빌드 실패 (browser API 보호)
- secret 가진 함수 / 모듈은 `server-only` 의무

### 3. data fetching = Server Component 기본

- Server Component 안 `async function Component() { const data = await fetch(...) }` 직접
- Client Component 안 fetch 는 `useEffect` + TanStack Query / SWR 위임
- *결과 차이*: server fetch = render 전 완료 (SEO + LCP), client fetch = render 후 (skeleton + waterfall)

### 4. interactivity = Client Component

- `useState` / `useEffect` / event handler (`onClick` 등) = client only
- form submission = server action 사용하면 server component 도 가능
- DOM 직접 접근 (`document.*` / `window.*`) = client only

### 5. shared component = no hooks + no server-only imports

- 같은 컴포넌트를 server tree + client tree 둘 다에서 사용 가능 = 가장 깊은 곳에 위치
- 단 hook 사용 ✕, server-only / client-only import ✕

### 6. Props serialization (Server → Client)

- Server Component 가 Client Component 에 props 전달 = JSON 직렬화 됨
- 함수 / Date / Map / Set / Promise 전달 ✕ (단 React 19 의 Server Function 은 RPC 가능)
- Date → ISO string, Map → array, Promise → wrap in Suspense

## Boundary 결정 트리

```
새 컴포넌트 작성 시:
├─ interactivity 필요? (onClick / form / hover state)
│   └─ YES → Client Component ("use client")
├─ Browser API 필요? (window / document / localStorage)
│   └─ YES → Client Component
├─ React hook 필요? (useState / useEffect 등)
│   └─ YES → Client Component
├─ secret / DB 직접 접근? (process.env.SECRET / db query)
│   └─ YES → Server Component + 'server-only' import
└─ 그 외 (정적 표시) → Server Component (기본, RSC 이점)
```

## 도구 위임 (이 skill 의 진입점 역할)

- **빌드 시점**: Next.js compiler — 위반 시 빌드 에러 또는 hydration warning
- **정적**: `vercel:nextjs` skill (chainTo) — App Router 깊은 가이드, server actions, metadata API, middleware 등
- **타입**: TypeScript `'use client'` 인 파일에 server-only 타입 노출 시 동작 가능 (런타임 빌드만 fail)

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| "use client" 파일이 `next/headers` import | 부모 server component 에서 cookies/headers read 후 props 전달 | **validate (error)** |
| "use client" 없는 파일에 `useState` | 파일 상단에 `"use client"` 추가 | **validate (error)** |
| `server-only` import on client file | 본 모듈 server 만 사용 가능 — refactor | **validate (warn)** + 빌드 실패 |
| client component 가 secret (`process.env.OPENAI_KEY`) read | server component 에 secret-using API call 격리 | 수동 / 빌드 실패 |
| Client Component 가 root layout 으로 사용 | leaf 로 좁히기 | 수동 |
| props 로 함수 / Date / Map 전달 (Server → Client) | ISO string / array / serializable | Next dev warning |
| async Client Component (`async function ClientX() { }`) | Client component는 sync. async data 는 Server / Suspense + use() | 수동 / build error |
| `useEffect(() => fetch(...))` in Client Component | TanStack Query / SWR 위임 | 수동 (async-race-avoidance 참고) |

## Server Component 패턴

```tsx
// app/posts/page.tsx — server component (기본)
import { db } from '@/lib/db'
import 'server-only'  // client import 차단 가드

export default async function PostsPage() {
  const posts = await db.query.posts.findMany()  // server 에서 직접
  return (
    <main>
      <h1>Posts</h1>
      <ul>
        {posts.map(p => <li key={p.id}>{p.title}</li>)}
      </ul>
      <NewPostButton />  {/* client component, 아래 */}
    </main>
  )
}
```

```tsx
// app/posts/new-post-button.tsx — client component (leaf only)
'use client'

import { useState } from 'react'

export function NewPostButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>새 글</button>
      {open && <NewPostDialog onClose={() => setOpen(false)} />}
    </>
  )
}
```

## Props 직렬화 패턴

```tsx
// ✕ Server → Client 에 Date 직접 전달
<PostMeta createdAt={post.createdAt} />  // post.createdAt = Date object

// ✓ ISO string 으로 변환
<PostMeta createdAt={post.createdAt.toISOString()} />
```

```tsx
// PostMeta.tsx — client side
'use client'

import { formatRelative } from 'date-fns'

export function PostMeta({ createdAt }: { createdAt: string }) {
  return <time dateTime={createdAt}>{formatRelative(new Date(createdAt), new Date())}</time>
}
```

## 참조

- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [React — "use client" directive](https://react.dev/reference/rsc/use-client) · [Server Components RFC](https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md)
- [Next.js — server-only / client-only](https://nextjs.org/docs/app/getting-started/server-and-client-components#the-server-only-package)
- [vercel:nextjs skill](~/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/nextjs/SKILL.md) (chainTo)
- [Next.js Cache Components](https://nextjs.org/docs/app/getting-started/caching-and-revalidating)
