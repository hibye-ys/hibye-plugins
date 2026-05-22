---
name: render-purity
description: React render = 순수 함수 원칙 강제. render body 안 setState 호출 / localStorage/sessionStorage/document 접근 / Math.random / Date.now / new Date 같은 non-deterministic 패턴 검출. side-effect 는 useEffect / event handler 만.
metadata:
  priority: 5
  docs:
    - "https://react.dev/learn/keeping-components-pure"
    - "https://react.dev/reference/react/useEffect"
    - "https://react.dev/reference/react/useSyncExternalStore"
    - "https://react.dev/learn/you-might-not-need-an-effect"
  pathPatterns:
    - 'src/**/*.tsx'
    - 'src/**/*.jsx'
    - 'app/**/*.tsx'
    - 'app/**/*.jsx'
    - 'components/**/*.{tsx,jsx}'
    - 'src/components/**/*.{tsx,jsx}'
  bashPatterns: []
  importPatterns:
    - 'react'
    - 'react-dom'
validate:
  - pattern: '\bfunction\s+[A-Z]\w*\s*\([^)]*\)\s*\{[^}]*\bset[A-Z]\w*\s*\([^)]*\)[^}]*\breturn\b'
    message: 'render body 안 직접 setState 호출 (return 전) — 무한 루프 위험. useEffect 또는 event handler 안에서. derive 가능하면 derived state 로.'
    severity: warn
  - pattern: '\bfunction\s+[A-Z]\w*\s*\([^)]*\)\s*\{[^}]*\b(localStorage|sessionStorage|document\.|window\.)\b[^}]*\breturn\b'
    message: 'render body 안 browser API (localStorage / sessionStorage / document / window) 접근 — SSR 시 ReferenceError + non-pure. useEffect 안에서 / useSyncExternalStore 사용.'
    severity: warn
  - pattern: '\bfunction\s+[A-Z]\w*\s*\([^)]*\)\s*\{[^}]*\b(Math\.random\s*\(|Date\.now\s*\(|new\s+Date\s*\([^)]*\))[^}]*\breturn\b'
    message: 'render body 안 non-deterministic 값 (Math.random / Date.now / new Date) — SSR / hydration mismatch 위험. useState initializer 또는 useEffect 안에서 (hydration-determinism skill 참고).'
    severity: warn
retrieval:
  aliases:
    - pure render
    - keeping components pure
    - side effect
    - useEffect
    - useSyncExternalStore
  intents:
    - keep render pure
    - move side effects to effect
    - fix infinite loop
    - prevent SSR mismatch
  entities:
    - render
    - useEffect
    - useState
    - useSyncExternalStore
    - pure function
chainTo:
  - pattern: 'Math\.random\s*\(|Date\.now\s*\(|new\s+Date\s*\('
    targetSkill: hydration-determinism
    message: 'Non-deterministic 값 사용 — hydration-determinism skill 로 chain (SSR / RSC 시 mismatch 위험).'
---

# render-purity

**React render = 순수 함수 (props → JSX).** side-effect 는 useEffect / event handler / `useSyncExternalStore`. render 안 setState / fetch / dispatch / localStorage / Math.random = 무한 루프 + SSR mismatch + 예측 불가 bug. 본 skill 은 *비순수 render heuristic 검출 + 교정 패턴* . 깊은 분석은 `react-hooks/exhaustive-deps` + React Compiler 위임.

## When to apply

- 새 컴포넌트 작성 / 기존 리팩토링
- 무한 렌더 / "Too many re-renders" 에러
- SSR / RSC + hydration mismatch
- third-party store (browser storage, websocket, mutable ref) 통합
- React Compiler 도입 시점 (순수 보존 의무 더 엄격)

## 핵심 원칙

### 1. render = 순수 함수

- input = props + context + state → output = JSX
- 같은 input → 같은 output 보장
- mutate props / state / context object 직접 ✕

### 2. side-effect 는 useEffect 안에서

- DOM 직접 조작 / API 호출 / subscription = useEffect
- mount / unmount lifecycle 관리는 useEffect cleanup
- *React 19 의 use()* 는 effect 아니지만 Suspense boundary 안에서만

### 3. read 도 순수 보존

- `localStorage.getItem(...)` 같은 *read* 도 SSR 시 ReferenceError — render 안 ✕
- 대신 `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` — SSR safe
- 또는 useEffect 안 read + useState 저장

### 4. random / Date 는 effect 또는 initializer

- 절대 render body 직접: `<p>{Math.random()}</p>` ✕
- `useState(() => Math.random())` initializer (mount 시 1회) — SSR mismatch 가능
- `useEffect(() => setRandomValue(Math.random()), [])` — client only
- ID 는 `useId()` 사용 (SSR safe)

### 5. external store = useSyncExternalStore

- Redux / Zustand / Jotai 같은 외부 store = `useSyncExternalStore` 사용 권장 (라이브러리가 내부적으로)
- 직접 subscribe 시 SSR + concurrent rendering 안전 필요

### 6. derive 값은 render 안에서 OK

- `const isAdmin = user.role === 'admin'` 같은 *순수 derive* = render 안 OK
- 비용이 크면 `useMemo` — *성능 hint* 만 (correctness 가 아님)
- 절대 `useEffect` 안에서 derive → setState ✕ (1 render 추가)

### 7. React Compiler 호환

- React 19 + React Compiler 가 *순수* 컴포넌트를 자동 최적화
- 순수 깨지면 Compiler 가 skip — 성능 이득 못 받음
- ESLint plugin `eslint-plugin-react-compiler` 사용 권장

## 도구 위임 (이 skill 의 진입점 역할)

- **정적**: `eslint-plugin-react-hooks` `exhaustive-deps` — useEffect / useMemo dep 자동 검출
- **정적**: `eslint-plugin-react-compiler` — Compiler 호환성 검증
- **정적**: `react/no-direct-mutation-state` — state 직접 mutate 검출
- **런타임**: React Strict Mode — double-invoke 로 비순수 검출

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| render body 안 `setX(...)` (조건 무관) | useEffect 또는 event handler | **validate (warn)** |
| `<p>{Math.random()}</p>` 직접 | useState initializer 또는 useEffect | **validate (warn)** + hydration-determinism chain |
| `localStorage.getItem(...)` in render | useSyncExternalStore 또는 useEffect | **validate (warn)** |
| `props.user.name = "new"` (mutate) | `{ ...props.user, name: "new" }` | react/no-direct-mutation-state |
| `useEffect(() => setX(derive(state)))` (1 render 낭비) | render 안 derive 직접 | 수동 |
| `Date.now()` in JSX | useState initializer | **validate (warn)** |
| event listener attach in render (return 전) | useEffect + cleanup | 수동 |
| subscription 직접 (`store.subscribe(...)` in render) | useSyncExternalStore | 수동 |
| API fetch in render (no Suspense) | Server Component / use() / TanStack Query | 수동 |
| ref `.current` write in render | useEffect 안에서 | 수동 |

## 순수 render 패턴

```tsx
// ✕ Non-pure (render body 안 setState)
function Counter({ initial }: Props) {
  const [count, setCount] = useState(initial)
  if (count < 0) setCount(0)  // 무한 루프!
  return <div>{count}</div>
}

// ✓ Derive 로 변환
function Counter({ initial }: Props) {
  const [count, setCount] = useState(initial)
  const displayCount = Math.max(0, count)  // 순수 derive
  return <div>{displayCount}</div>
}
```

## localStorage read 패턴 (SSR safe)

```tsx
// ✕ render 안 localStorage read
function ThemeToggle() {
  const theme = localStorage.getItem('theme') ?? 'light'  // SSR ReferenceError
  return <div className={theme}>...</div>
}

// ✓ useSyncExternalStore (SSR safe + concurrent safe)
import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  return () => window.removeEventListener('storage', callback)
}

function getSnapshot() {
  return localStorage.getItem('theme') ?? 'light'
}

function getServerSnapshot() {
  return 'light'  // SSR default
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return <div className={theme}>...</div>
}
```

## random / ID 패턴

```tsx
// ✕ render 안 Math.random
function Tooltip({ children }: Props) {
  const id = `tip-${Math.random()}`  // SSR mismatch + render 마다 새 id
  // ...
}

// ✓ useId (SSR safe + stable across re-render)
import { useId } from 'react'

function Tooltip({ children }: Props) {
  const id = useId()
  return (
    <>
      <button aria-describedby={id}>?</button>
      <div role="tooltip" id={id}>{children}</div>
    </>
  )
}
```

## derive 값 패턴

```tsx
// ✕ useEffect 안 derive + setState (1 render 낭비)
function UserBadge({ user }: Props) {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    setIsAdmin(user.role === 'admin')  // 매 render 마다 추가 render
  }, [user.role])
  return <div className={isAdmin ? 'admin' : ''}>{user.name}</div>
}

// ✓ render 안 직접 derive (순수 함수)
function UserBadge({ user }: Props) {
  const isAdmin = user.role === 'admin'  // 순수
  return <div className={isAdmin ? 'admin' : ''}>{user.name}</div>
}
```

## 참조

- [React docs — Keeping Components Pure](https://react.dev/learn/keeping-components-pure)
- [React docs — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [useEffect](https://react.dev/reference/react/useEffect) · [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) · [useId](https://react.dev/reference/react/useId)
- [eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks)
- [eslint-plugin-react-compiler](https://www.npmjs.com/package/eslint-plugin-react-compiler)
- [React Compiler](https://react.dev/blog/2025/10/07/react-compiler-1)
