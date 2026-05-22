---
name: suspense-error-locality
description: Suspense fallback + ErrorBoundary 페어가 *동일 component tree level* 에 있어야 — 같은 의미 단위 안 fallback 처리. Suspense 단독 (fallback 없음 / error 처리 없음) 검출. Next.js error.tsx + loading.tsx 통합 안내.
metadata:
  priority: 4
  docs:
    - "https://react.dev/reference/react/Suspense"
    - "https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary"
    - "https://nextjs.org/docs/app/getting-started/error-handling"
    - "https://www.npmjs.com/package/react-error-boundary"
  pathPatterns:
    - 'src/**/*.{tsx,jsx}'
    - 'app/**/*.{tsx,jsx}'
    - 'components/**/*.{tsx,jsx}'
    - 'src/components/**/*.{tsx,jsx}'
  bashPatterns: []
  importPatterns:
    - 'react'
    - 'react-error-boundary'
    - 'next'
validate:
  - pattern: '<Suspense\b(?![^>]*\bfallback\s*=)'
    message: 'Suspense fallback 누락 — `<Suspense>` 만 있고 `fallback={...}` 없음. fallback 명시 (skeleton / spinner).'
    severity: error
  - pattern: '<Suspense\b[^>]*\bfallback\s*=[\s\S]{0,600}(?<!ErrorBoundary)(?<!error\.tsx)(?<!react-error-boundary)'
    message: 'Suspense 사용처 인근에 ErrorBoundary / error.tsx 같은 error 처리 패턴 부재 (heuristic, 600자 window). 같은 boundary level 에 error fallback 페어.'
    severity: warn
retrieval:
  aliases:
    - Suspense
    - ErrorBoundary
    - error.tsx
    - loading.tsx
    - streaming SSR
  intents:
    - add Suspense fallback
    - add error boundary
    - granular loading state
    - Next.js error handling
  entities:
    - Suspense
    - ErrorBoundary
    - error.tsx
    - loading.tsx
    - fallback
chainTo: []
---

# suspense-error-locality

**Suspense 와 ErrorBoundary = 페어** — *같은 component tree level* 에서 fallback + error 둘 다 처리. 그렇지 않으면 한 컴포넌트 실패가 전체 page fallback 또는 위로 propagate. 본 skill 은 *Suspense / ErrorBoundary 페어 패턴 + Next.js error.tsx + loading.tsx 통합*. 깊은 async-suspense 가이드는 `vercel:react-best-practices` 의 `async-suspense-boundaries` 룰 위임 (chainTo 가능하지만 본 plugin 은 보완).

## When to apply

- async data fetching (use() / TanStack Query / SWR / Server Component)
- React.lazy 동적 import
- streaming SSR / RSC
- "Cannot read properties of undefined" 같은 에러 처리
- Next.js App Router 의 error.tsx / loading.tsx / not-found.tsx 설정

## 핵심 원칙

### 1. Suspense fallback 명시

- `<Suspense fallback={<Skeleton />}>` — fallback 없으면 React warning + 전체 tree 위 fallback 사용
- fallback = *의미 있는* loading UI (skeleton > spinner > 빈 div)
- visually-stable skeleton (실제 content size 와 유사) — CLS 방지

### 2. ErrorBoundary 와 페어 = 같은 boundary level

- Suspense 만 있고 ErrorBoundary 없으면 — fetch 실패 시 위로 propagate (전체 page 깨짐)
- `<ErrorBoundary fallback={<ErrorMessage />}><Suspense fallback={<Skeleton />}><AsyncContent /></Suspense></ErrorBoundary>`
- 또는 다른 wrap 순서: `<Suspense><ErrorBoundary>...</ErrorBoundary></Suspense>` — 둘 다 valid

### 3. Next.js App Router 의 error.tsx + loading.tsx

- `app/posts/loading.tsx` — auto-wrap Suspense fallback for `app/posts/page.tsx`
- `app/posts/error.tsx` — auto-wrap ErrorBoundary for the page (`'use client'` 필수)
- `app/posts/not-found.tsx` — `notFound()` 호출 시 fallback
- 페이지 단위 자동, 단 컴포넌트 단위는 명시적 Suspense / ErrorBoundary

### 4. Granularity = 의미 있는 UI 단위

- 전체 page = Suspense 위치 ✕ — UX skeleton flash
- 의미 있는 section (sidebar / main / comments) 단위로 Suspense 분할
- streaming SSR 의 *순차 reveal* 효과

### 5. Skeleton vs Spinner 선택

- 페이지 layout 미리 알 수 있음 → Skeleton (CLS ✕)
- 컴포넌트 / 데이터 size 모름 → Spinner
- 너무 빠른 fetch (< 200ms) → 아무것도 표시 ✕ (flicker 방지 — `<Suspense fallback={null}>` + suspenseConfig)

### 6. react-error-boundary 의 `resetKeys`

- 사용자 retry 또는 dep change 시 ErrorBoundary 자동 reset
- `<ErrorBoundary resetKeys={[userId]} fallbackRender={({ resetErrorBoundary }) => <button onClick={resetErrorBoundary}>다시</button>}>`
- React Class component ErrorBoundary 자체 구현 ✕ — 라이브러리 위임

### 7. async function 에서 thrown error 와 Promise rejection 모두 catch

- Server Component / Client Component 의 async 함수 throw
- TanStack Query / SWR 의 error 도 ErrorBoundary 가 catch (config: `useErrorBoundary: true`)

## 도구 위임 (이 skill 의 진입점 역할)

- **vercel:react-best-practices** `async-suspense-boundaries` 룰 — chainTo 가능. *단 본 plugin 은 즉시 검출 + Next.js 통합 안내 보완*.
- **라이브러리 본문**: `react-error-boundary` README — 모든 fallback 패턴
- **Next.js**: `error.tsx` / `loading.tsx` / `not-found.tsx` template
- **dev runtime**: React DevTools — Suspense 트리 시각화

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `<Suspense>` (no fallback) | `<Suspense fallback={<Skeleton />}>` | **validate (error)** |
| `<Suspense>` 인근에 ErrorBoundary 없음 (600자 window) | ErrorBoundary 페어 | **validate (warn, heuristic)** |
| `<Suspense fallback={<Spinner />}>` (root level) | 작은 section 으로 분할 | 수동 |
| 전체 page 한 Suspense 로 wrap | meaningful section 단위 분할 | 수동 |
| 자체 구현 ErrorBoundary class | `react-error-boundary` 사용 | 수동 |
| TanStack Query 의 error 가 ErrorBoundary 안 잡힘 | `useQuery({ ..., throwOnError: true })` config | 수동 |
| Next.js error.tsx 에 `'use client'` 누락 | client 강제 | 수동 (Next.js build warn) |
| Skeleton 이 실제 content size 와 다름 (CLS) | width/height 명시 | 수동 |
| 너무 짧은 fetch 에 fallback flash | suspenseConfig / startTransition | 수동 |
| ErrorBoundary 가 reset 안 됨 → 영구 에러 | `resetKeys` 또는 `resetErrorBoundary` | 수동 |

## 기본 Suspense + ErrorBoundary 페어 패턴

```tsx
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

function PostsSection({ userId }: Props) {
  return (
    <section>
      <h2>Posts</h2>
      <ErrorBoundary
        fallbackRender={({ resetErrorBoundary }) => (
          <div>
            <p>posts 를 불러올 수 없어요.</p>
            <button onClick={resetErrorBoundary}>다시</button>
          </div>
        )}
        resetKeys={[userId]}
      >
        <Suspense fallback={<PostsSkeleton />}>
          <Posts userId={userId} />
        </Suspense>
      </ErrorBoundary>
    </section>
  )
}
```

## Next.js App Router 패턴 — error.tsx + loading.tsx

```tsx
// app/posts/loading.tsx (자동 Suspense fallback)
export default function Loading() {
  return <PostsSkeleton />
}
```

```tsx
// app/posts/error.tsx (자동 ErrorBoundary — 'use client' 필수)
'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <h2>posts 페이지 에러</h2>
      <p>{error.message}</p>
      <button onClick={reset}>다시</button>
    </div>
  )
}
```

```tsx
// app/posts/page.tsx
import { getPosts } from '@/lib/db'

export default async function PostsPage() {
  const posts = await getPosts()  // throws → error.tsx fallback
  // loading 동안 → loading.tsx fallback
  return <PostList posts={posts} />
}
```

`loading.tsx` + `error.tsx` 자동 wrap = 위 React 패턴과 동등.

## Granular Suspense (의미 단위) 패턴

```tsx
// 한 page 안 여러 의미 section
export default function DashboardPage() {
  return (
    <main className="grid grid-cols-3 gap-4">
      <ErrorBoundary fallback={<SidebarError />}>
        <Suspense fallback={<SidebarSkeleton />}>
          <Sidebar />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<MainError />}>
        <Suspense fallback={<MainSkeleton />}>
          <MainContent />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<CommentsError />}>
        <Suspense fallback={<CommentsSkeleton />}>
          <Comments />
        </Suspense>
      </ErrorBoundary>
    </main>
  )
}
```

streaming SSR = 각 section 이 fetch 완료 순서대로 reveal. UX 빠름.

## TanStack Query + Suspense + ErrorBoundary 통합

```tsx
import { useSuspenseQuery } from '@tanstack/react-query'

function Posts({ userId }: Props) {
  const { data: posts } = useSuspenseQuery({
    queryKey: ['posts', userId],
    queryFn: () => fetch(`/api/users/${userId}/posts`).then(r => r.json()),
  })
  return <PostList posts={posts} />
}
```

`useSuspenseQuery` = 자동으로 Suspense fallback 사용 + error 는 ErrorBoundary 로 throw. 부모 wrap 만 있으면 됨.

## 참조

- [React docs — `<Suspense>`](https://react.dev/reference/react/Suspense)
- [React docs — Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
- [Next.js — Error Handling](https://nextjs.org/docs/app/getting-started/error-handling) · [loading.tsx](https://nextjs.org/docs/app/api-reference/file-conventions/loading)
- [react-error-boundary](https://www.npmjs.com/package/react-error-boundary)
- [TanStack Query — Suspense](https://tanstack.com/query/latest/docs/framework/react/guides/suspense)
- [vercel:react-best-practices — async-suspense-boundaries](~/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/react-best-practices/SKILL.md)
