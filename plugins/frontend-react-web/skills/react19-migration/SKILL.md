---
name: react19-migration
description: React 19 신기능 + deprecated API 마이그레이션. forwardRef → ref-as-prop / use() hook / Activity / useOptimistic / useFormStatus / useActionState / document metadata API 안내. findDOMNode / React.createFactory / React.PropTypes 같은 deprecated 검출.
metadata:
  priority: 3
  docs:
    - "https://react.dev/blog/2024/12/05/react-19"
    - "https://react.dev/reference/react/use"
    - "https://react.dev/reference/react/Activity"
    - "https://react.dev/reference/react/useOptimistic"
    - "https://react.dev/reference/react-dom/hooks/useFormStatus"
    - "https://react.dev/reference/react/useActionState"
  pathPatterns:
    - 'src/**/*.{ts,tsx,js,jsx}'
    - 'app/**/*.{ts,tsx,js,jsx}'
    - 'components/**/*.{tsx,jsx}'
    - 'src/components/**/*.{tsx,jsx}'
    - 'lib/**/*.{ts,tsx}'
  bashPatterns: []
  importPatterns:
    - 'react'
    - 'react-dom'
    - 'prop-types'
chainTo: []
validate:
  - pattern: '\bforwardRef\s*[\(<]'
    message: 'React 19 — forwardRef 신규 사용 ✕. ref 는 일반 prop 으로 받음: `function Component({ ref, ...props }) {}`. 라이브러리 통합 시에만 forwardRef 잔존 허용.'
    severity: warn
  - pattern: '\bfindDOMNode\s*\(|\bReact\.createFactory\s*\(|\bReact\.PropTypes\b|\bfrom\s+["'']prop-types["'']'
    message: 'React 19 removed API: findDOMNode / React.createFactory / PropTypes. ref + ref.current 또는 TypeScript types 사용.'
    severity: error
  - pattern: '\buseTransition\s*\(\s*\)[\s\S]{0,500}\bsetState\s*\(|\bstartTransition\s*\(\s*\(\)\s*=>'
    message: 'useTransition / startTransition 사용처 — React 19 의 use() hook 또는 Activity 가 더 적합한 케이스 가능 (data fetching / hidden tab). 본문 가이드 참고.'
    severity: warn
retrieval:
  aliases:
    - React 19
    - ref-as-prop
    - use hook
    - Activity
    - useOptimistic
    - useFormStatus
    - useActionState
  intents:
    - migrate to React 19
    - remove forwardRef
    - use Activity for hidden tabs
    - useOptimistic for UI
    - form actions
  entities:
    - React 19
    - forwardRef
    - use
    - Activity
    - useOptimistic
    - useFormStatus
    - useActionState
    - findDOMNode
---

# react19-migration

**React 19 = ref-as-prop / `use()` / Activity / useOptimistic / form hook 들** + deprecated API 제거 (findDOMNode / PropTypes / createFactory). 본 skill 은 *deprecated 검출 + 7 신기능 마이그레이션 패턴*. 깊은 release note 는 React 공식 docs 위임.

## When to apply

- React 18 → 19 마이그레이션
- 신규 컴포넌트 작성 시 신기능 활용 결정
- forwardRef / findDOMNode 사용처 발견
- form action + server action 통합
- data fetching = Suspense + use() 결정

## 핵심 원칙

### 1. ref-as-prop (forwardRef 신규 사용 ✕)

- React 19 = ref 가 일반 prop. forwardRef 자동 호출 ✕
- 신규 작성 = `function Button({ ref, ...props }: Props & { ref?: Ref<HTMLButtonElement> })`
- 기존 forwardRef = *유지* (라이브러리 호환). 단 신규 ✕
- TypeScript = `ComponentRef<typeof Element>` 자동 추론

### 2. `use()` hook = Promise / Context 동기적 unwrap

- Suspense boundary 안에서 Promise unwrap (data fetching)
- conditional 사용 가능 (`if (cond) use(...)` — 기존 hook rule 완화)
- Context 도 `use(MyContext)` (useContext 와 동등)
- *React 19 에서 가장 강력한 신기능*

```tsx
import { use } from 'react'

function Comments({ commentsPromise }: Props) {
  const comments = use(commentsPromise)
  return <ul>{comments.map(c => <li key={c.id}>{c.text}</li>)}</ul>
}
```

### 3. `<Activity>` = hidden / visible state

- 탭 전환 / 모달 collapse 시 컴포넌트 unmount ✕ → state 보존
- `<Activity mode={isActive ? 'visible' : 'hidden'}>`
- hidden = render skip + DOM 보존 + effect cleanup (off-screen)
- 무거운 컴포넌트 (chart / map) 의 keep-alive 패턴

### 4. `useOptimistic` = 즉시 UI 업데이트

- form submit 후 server 응답 전 UI 미리 update
- server 응답 후 자동 reconciliation
- TanStack Query 의 `onMutate` 와 유사

### 5. form 관련 신 hook 3종

- `useFormStatus` = 같은 `<form>` 안 submit 상태 read (pending / submitted)
- `useActionState` (이전 `useFormState`) = action state + dispatcher 반환
- `<form action={fn}>` = server action 또는 client function

### 6. Document metadata API

- `<title>` / `<meta>` 직접 JSX 안 — React 가 `<head>` 로 자동 이동
- Helmet / next/head 같은 라이브러리 의존 ✕ (Next.js metadata API 우선)

```tsx
function PostPage({ post }: Props) {
  return (
    <article>
      <title>{post.title}</title>
      <meta name="description" content={post.excerpt} />
      <h1>{post.title}</h1>
      {/* ... */}
    </article>
  )
}
```

### 7. deprecated API 제거

- `findDOMNode` → `ref` + `ref.current`
- `React.createFactory` → JSX 직접
- `React.PropTypes` → TypeScript types
- `prop-types` 라이브러리 deps 제거

## 도구 위임 (이 skill 의 진입점 역할)

- **자동 마이그레이션**: `npx types-react-codemod@latest preset-19` — TS types 자동 변환
- **자동 마이그레이션**: `npx codemod react/19/replace-reactdom-render` — ReactDOM.render → createRoot
- **정적**: `eslint-plugin-react` `react/forwardref-deprecated` 또는 자체 `react/no-forwardref-as-default`
- **빌드**: React 19 = React Compiler 호환 — `eslint-plugin-react-compiler` 사용 권장

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `forwardRef(...)` 신규 사용 | ref 일반 prop | **validate (warn)** |
| `findDOMNode(node)` | `ref.current` | **validate (error)** |
| `React.createFactory(Comp)` | `<Comp />` JSX | **validate (error)** |
| `React.PropTypes.string` | TypeScript types | **validate (error)** |
| `import PropTypes from 'prop-types'` | TypeScript types | **validate (error)** |
| `useState` 안 promise 보관 후 `useEffect` await | `use(promise)` (Suspense boundary 안) | 수동 |
| hidden tab unmount → state 잃음 | `<Activity mode="hidden">` | 수동 |
| optimistic update 자체 구현 (useState + setTimeout) | `useOptimistic` | 수동 |
| form submit 후 button disable + pending state 자체 | `useFormStatus` (form 안 자동) | 수동 |
| `<Helmet>` 으로 title 설정 (App Router 외) | `<title>` 직접 JSX (React 19) | 수동 |
| `useFormState` (이전 이름) | `useActionState` (React 19 명명) | 수동 / TS error |
| `useTransition` data fetching | `use()` + Suspense | **validate (warn)** |

## ref-as-prop 패턴

```tsx
// ✕ React 19 에서 신규 forwardRef
import { forwardRef } from 'react'

const Button = forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => (
  <button ref={ref} {...props} />
))

// ✓ ref 를 일반 prop
import type { Ref } from 'react'

type ButtonProps = {
  ref?: Ref<HTMLButtonElement>
  children: React.ReactNode
}

function Button({ ref, children, ...props }: ButtonProps) {
  return <button ref={ref} {...props}>{children}</button>
}
```

## `use()` + Suspense 패턴

```tsx
import { Suspense, use } from 'react'

function Comments({ commentsPromise }: { commentsPromise: Promise<Comment[]> }) {
  const comments = use(commentsPromise)
  return <ul>{comments.map(c => <li key={c.id}>{c.text}</li>)}</ul>
}

export default function Page({ postId }: Props) {
  const commentsPromise = fetch(`/api/posts/${postId}/comments`).then(r => r.json())
  return (
    <Suspense fallback={<CommentsSkeleton />}>
      <Comments commentsPromise={commentsPromise} />
    </Suspense>
  )
}
```

`use()` = Promise / Context 동기적 unwrap, Suspense / ErrorBoundary 가 처리.

## `<Activity>` keep-alive 패턴

```tsx
import { Activity } from 'react'

function TabPanel({ activeTab }: Props) {
  return (
    <>
      <Activity mode={activeTab === 'analytics' ? 'visible' : 'hidden'}>
        <AnalyticsDashboard />  {/* state + DOM 보존 */}
      </Activity>
      <Activity mode={activeTab === 'reports' ? 'visible' : 'hidden'}>
        <ReportsTable />
      </Activity>
      <Activity mode={activeTab === 'settings' ? 'visible' : 'hidden'}>
        <SettingsForm />
      </Activity>
    </>
  )
}
```

탭 전환 = unmount 안 됨, scroll position / form draft 등 보존.

## `useOptimistic` + form action 패턴

```tsx
'use client'
import { useOptimistic } from 'react'

function Likes({ postId, initialLikes }: Props) {
  const [optimisticLikes, addOptimistic] = useOptimistic(
    initialLikes,
    (state: number, increment: number) => state + increment,
  )

  async function like() {
    addOptimistic(1)  // 즉시 UI 갱신
    await fetch(`/api/posts/${postId}/like`, { method: 'POST' })
    // server 응답 후 자동 reconciliation
  }

  return <button onClick={like}>좋아요 ({optimisticLikes})</button>
}
```

## `useFormStatus` + `useActionState` 패턴

```tsx
'use client'
import { useFormStatus, useActionState } from 'react'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending}>{pending ? '저장 중...' : '저장'}</button>
}

async function saveAction(prevState: State, formData: FormData) {
  // server action 또는 client function
  return { ok: true, value: formData.get('email') }
}

function EmailForm() {
  const [state, dispatch] = useActionState(saveAction, { ok: false })
  return (
    <form action={dispatch}>
      <input name="email" type="email" required />
      <SubmitButton />
      {state.ok && <p>저장됨!</p>}
    </form>
  )
}
```

## 참조

- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19) · [Upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
- [`use()`](https://react.dev/reference/react/use) · [`<Activity>`](https://react.dev/reference/react/Activity) · [`useOptimistic`](https://react.dev/reference/react/useOptimistic) · [`useFormStatus`](https://react.dev/reference/react-dom/hooks/useFormStatus) · [`useActionState`](https://react.dev/reference/react/useActionState) · [Document metadata](https://react.dev/reference/react-dom/components/title)
- [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1) · [eslint-plugin-react-compiler](https://www.npmjs.com/package/eslint-plugin-react-compiler) · [types-react-codemod](https://github.com/eps1lon/types-react-codemod)
