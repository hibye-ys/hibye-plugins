---
name: hydration-determinism
description: SSR / RSC / SSG 환경의 server render = client first paint 일치 보장. typeof window 환경 분기 / Math.random / Date.now / Intl 같은 non-deterministic 값을 JSX 직접 사용 검출. suppressHydrationWarning 의 정당한 사용 안내.
metadata:
  priority: 5
  docs:
    - "https://react.dev/reference/react-dom/client/hydrateRoot"
    - "https://react.dev/reference/react-dom/components/common#common-props"
    - "https://nextjs.org/docs/messages/react-hydration-error"
    - "https://react.dev/reference/react/useId"
  pathPatterns:
    - 'app/**/*.{tsx,jsx}'
    - 'src/app/**/*.{tsx,jsx}'
    - 'pages/**/*.{tsx,jsx}'
    - 'src/**/*.{tsx,jsx}'
    - 'components/**/*.{tsx,jsx}'
    - 'src/components/**/*.{tsx,jsx}'
  bashPatterns: []
  importPatterns:
    - 'react'
    - 'react-dom'
    - 'next'
    - '@remix-run/react'
    - 'remix'
validate:
  - pattern: '\btypeof\s+window\s*[!=]==\s*[''"]undefined[''"]'
    message: 'render body 안 `typeof window === "undefined"` 분기 — server / client divergence. useEffect 안에서 결정 또는 dynamic import + ssr:false.'
    severity: error
  - pattern: '\{[^}]*\bMath\.random\s*\(\s*\)[^}]*\}'
    message: 'JSX expression 안 Math.random() 직접 — SSR / hydration mismatch. useId / useState initializer / useEffect 안에서 결정.'
    severity: error
  - pattern: '\{[^}]*\b(Date\.now\s*\(\s*\)|new\s+Date\s*\(\s*\))[^}]*\.toLocaleString\s*\('
    message: 'JSX 안 `Date.now().toLocaleString()` 또는 `new Date().toLocaleString()` — SSR / client locale 차이로 mismatch. server 측 ISO string + client formatRelative.'
    severity: error
  - pattern: '\{[^}]*\bnew\s+Intl\.\w+\s*\([^)]*\)\.format\s*\('
    message: 'JSX 안 Intl.* 직접 사용 — SSR locale 과 client locale 차이로 hydration mismatch 위험. server 측 fixed locale 또는 useEffect 안에서.'
    severity: warn
retrieval:
  aliases:
    - hydration error
    - hydration mismatch
    - SSR error
    - "use server"
    - "use client"
  intents:
    - fix hydration error
    - SSR safe component
    - avoid hydration mismatch
    - useId for stable id
  entities:
    - hydration
    - SSR
    - RSC
    - useId
    - suppressHydrationWarning
chainTo:
  - pattern: '\btypeof\s+window\s*[!=]==\s*[''"]undefined[''"]'
    targetSkill: client-boundary
    message: 'typeof window 환경 분기 감지 — server / client component 경계로 분리 (client-boundary skill).'
---

# hydration-determinism

**SSR / RSC / SSG 환경의 핵심 invariant** = server-side render 결과 === client first paint markup. 일치 안 하면 React error overlay + 시각 jump (FCP / CLS 악화). 본 skill 은 *render body 안 non-deterministic 값 검출 + 안전한 패턴* . 깊은 React 19 hydration error 분석은 React DevTools 위임.

## When to apply

- SSR / RSC / SSG / streaming render 환경 컴포넌트 작성
- "Hydration failed because the server rendered HTML didn't match the client" 에러
- locale / timezone / random 사용 케이스
- third-party widget (Twitter / Disqus / Adsense 등) 통합
- React 19 으로 마이그레이션 (error overlay 변화)

## 핵심 원칙

### 1. server render === client first paint

- server 가 생성한 HTML 과 client 가 first render 한 JSX 가 동일해야 함
- diff 가 있으면 React 가 *전체 trim + 재 mount* (React 18+) — 비싸고 broken UX
- React 19 = single error overlay 로 한 화면에 전체 mismatch 표시

### 2. 시간 / 랜덤 / 환경 차이는 useEffect 안에서만

- `Math.random()` / `Date.now()` / `new Date()` / `Intl.*` = render 안 직접 ✕
- *useState initializer* (mount 1회) 도 SSR 시 server 측에서 한번 실행 → client 와 diff
- 안전 = useEffect (`useEffect(() => setX(Math.random()), [])`) — client only
- 또는 `useSyncExternalStore` (`getServerSnapshot` 다르게 설정)

### 3. `suppressHydrationWarning` 의 *허용된* 사용

- 본질적으로 server / client 차이가 *불가피* 한 element 만
- 대표 케이스 = `<time dateTime={iso}>` 의 사람이 읽는 텍스트 (server 측 fallback + client 측 formatRelative)
- *전체 컴포넌트* 에 suppress 사용 ✕ — root cause hide
- React 19 documentation: `suppressHydrationWarning` 는 element 한정

### 4. Dynamic import + ssr: false (Next.js)

- third-party widget (브라우저 전용) = `dynamic(() => import('./Widget'), { ssr: false })`
- server render 자체를 skip — server HTML 에 placeholder 만, client 측 mount
- 단점: SEO + LCP 손해

### 5. ID 생성은 useId

- `Math.random()` / counter / Date.now 로 id 생성 ✕ — SSR mismatch
- `useId()` = SSR safe + stable across re-render
- accessibility 관련 id (aria-describedby 등) 에 필수

### 6. third-party widget = client-only wrapper

- Twitter embed / Disqus / Google Maps / Adsense 등 = browser API 필수
- Server Component → Client wrapper component (`<ClientOnly><Widget /></ClientOnly>`)
- `ClientOnly` = `useEffect` + `mounted` state pattern

### 7. timezone / locale 일치 보장

- server 와 client 의 `Intl.DateTimeFormat` 결과 다를 수 있음 (TZ environment 차이)
- locale = fixed value (`'en-US'` / `'ko-KR'`) 명시 — `Intl.DateTimeFormat('ko-KR', ...)`
- timezone = ISO string 전달 + client 측 변환 (date-fns / dayjs)

## 도구 위임 (이 skill 의 진입점 역할)

- **빌드 시점**: Next.js / Remix dev mode — hydration mismatch 즉시 에러 overlay
- **React 19 error overlay**: 개선된 mismatch report — server / client diff 한 화면에
- **수동 audit**: localhost / production 양쪽에서 View Source 비교
- **정적**: vercel:nextjs (client-boundary skill 과 chain)

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `<p>{Math.random()}</p>` | useId / useEffect | **validate (error)** |
| render 안 `typeof window === 'undefined'` 분기 | useEffect 안 또는 dynamic ssr:false | **validate (error)** |
| `<span>{new Date().toLocaleString()}</span>` | server: ISO, client: formatRelative | **validate (error)** |
| JSX 안 `Intl.DateTimeFormat(...).format(...)` | fixed locale + useEffect | **validate (warn)** |
| 전체 컴포넌트 `suppressHydrationWarning` | element 한정 + 정당한 케이스만 | 수동 |
| third-party widget direct render | `dynamic(..., { ssr: false })` 또는 ClientOnly | 수동 |
| `id={Math.random()}` (label htmlFor 용) | `useId()` | 수동 |
| timezone-dependent format in JSX | server: UTC ISO + client format | 수동 |
| localStorage / cookie read in render | useEffect 또는 server cookies() | render-purity 참고 |
| Markdown / HTML formatter version 불일치 server vs client | 동일 라이브러리 + 동일 옵션 | 수동 |

## `suppressHydrationWarning` 의 허용된 사용 패턴

```tsx
// <time> 의 표시 텍스트는 server / client 다를 수 있음 (의도적)
function PostTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatRelative(new Date(iso), new Date())}
    </time>
  )
}
```

- `dateTime` attribute = stable (ISO)
- 사람이 읽는 텍스트 = server 측 "방금" / client 측 "5분 전" 같이 변할 수 있음
- `suppressHydrationWarning` 는 *이 element* 한정 — 자식 element 까지 silently 무시 ✕

## Dynamic import + ssr:false (Next.js) 패턴

```tsx
// app/embed-page.tsx
import dynamic from 'next/dynamic'

const TwitterEmbed = dynamic(() => import('@/components/TwitterEmbed'), {
  ssr: false,
  loading: () => <div className="aspect-video bg-muted animate-pulse" />,
})

export default function EmbedPage() {
  return (
    <main>
      <h1>Latest</h1>
      <TwitterEmbed tweetId="123" />
    </main>
  )
}
```

`ssr: false` 의 trade-off: SEO + LCP 손해. 단 widget 자체가 SEO 없으면 손해 없음.

## ClientOnly wrapper 패턴 (framework-neutral)

```tsx
'use client'
import { useEffect, useState, type ReactNode } from 'react'

export function ClientOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <>{fallback ?? null}</>
  return <>{children}</>
}
```

```tsx
<ClientOnly fallback={<Skeleton />}>
  <GoogleMaps />
</ClientOnly>
```

## useId 패턴 (SSR safe ID)

```tsx
// ✕ Math.random 또는 counter
function Toggle({ label }: Props) {
  const id = `toggle-${Math.random()}`  // server / client 다른 값 → mismatch
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" />
    </>
  )
}

// ✓ useId
import { useId } from 'react'

function Toggle({ label }: Props) {
  const id = useId()  // SSR safe + stable
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" />
    </>
  )
}
```

## 참조

- [React 19 — hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot) · [suppressHydrationWarning](https://react.dev/reference/react-dom/components/common#common-props)
- [React 19 release notes — improved error overlay](https://react.dev/blog/2024/12/05/react-19)
- [React docs — useId](https://react.dev/reference/react/useId)
- [Next.js — hydration error 가이드](https://nextjs.org/docs/messages/react-hydration-error)
- [Next.js — dynamic ssr:false](https://nextjs.org/docs/app/api-reference/functions/dynamic)
- [vercel:nextjs skill](~/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/nextjs/SKILL.md)
