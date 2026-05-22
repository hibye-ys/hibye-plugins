---
name: input-state-contract
description: Form input 의 controlled / uncontrolled / form-action 셋 중 하나만 선택 강제. value+defaultValue 혼합 / value+onChange 누락 / form 안 input name 누락 검출. RHF / Conform 위임 안내.
metadata:
  priority: 5
  docs:
    - "https://react.dev/reference/react-dom/components/input"
    - "https://react.dev/reference/react-dom/components/form"
    - "https://conform.guide/"
    - "https://react-hook-form.com/"
  pathPatterns:
    - 'src/**/*.{tsx,jsx}'
    - 'app/**/*.{tsx,jsx}'
    - 'components/**/*.{tsx,jsx}'
    - 'src/components/**/*.{tsx,jsx}'
  bashPatterns: []
  importPatterns:
    - 'react'
    - 'react-hook-form'
    - '@conform-to/react'
    - '@conform-to/zod'
    - 'zod'
    - 'valibot'
validate:
  - pattern: '<input\b(?=[^>]*\bvalue\s*=)(?=[^>]*\bdefaultValue\s*=)'
    message: 'input value + defaultValue 동시 사용 — controlled 와 uncontrolled 혼합. 한 input = 한 방식. React warn 발생.'
    severity: error
  - pattern: '<input\b(?=[^>]*\bvalue\s*=\s*\{)(?![^>]*\b(onChange|readOnly|disabled)\s*=)'
    message: 'input value (controlled) 인데 onChange 없음 — read-only 가 됨. onChange / readOnly / disabled 중 하나 명시.'
    severity: error
  - pattern: '<input\b(?![^>]*\bname\s*=)(?=[^>]*\btype\s*=\s*["''](text|email|password|number|tel|url|search|date|datetime-local|month|week|time|checkbox|radio|file|hidden)["''])'
    message: 'form-relevant input 에 name attribute 누락 — form action / FormData 안 잡힘. name="..." 추가 또는 form 외부면 무시.'
    severity: warn
retrieval:
  aliases:
    - controlled
    - uncontrolled
    - defaultValue
    - form action
    - RHF
    - Conform
  intents:
    - form input pattern
    - controlled vs uncontrolled
    - form action setup
    - prevent cursor jump
  entities:
    - input
    - value
    - defaultValue
    - onChange
    - useForm
    - useFormState
chainTo: []
---

# input-state-contract

**Form input = controlled / uncontrolled / form-action 셋 중 하나 선택.** 혼합 ✕ — cursor jump / state desync / read-only 함정 발생. 본 skill 은 *세 방식 명확 안내 + 혼합 검출 + RHF/Conform 위임* . 깊은 form 검증 (zod schema 등) 은 RHF / Conform 의 자체 패턴 위임.

## When to apply

- 새 form / input element 작성
- 기존 form 의 controlled / uncontrolled 결정
- form submission (server action / fetch) 통합
- RHF / Conform / 자체 form library 도입
- "Warning: A component is changing an uncontrolled input to be controlled" React warn

## 핵심 원칙

### 1. controlled = `value` + `onChange` 짝

- `<input value={state} onChange={e => setState(e.target.value)} />`
- 매 keypress 마다 re-render — 큰 form 은 RHF 권장 (uncontrolled 기반 성능)
- React state 가 single source of truth

### 2. uncontrolled = `defaultValue` + `ref` (또는 `name` + FormData)

- `<input defaultValue="..." ref={inputRef} name="email" />`
- DOM 이 state 보유 — submit 시점에 ref / FormData 로 read
- React 19 `useFormState` 의 기본 작동 방식

### 3. form action = `<form action={fn}>` + `name=` 의무

```tsx
<form action={async (formData: FormData) => { await save(formData) }}>
  <input name="email" type="email" required />
  <button type="submit">Save</button>
</form>
```

- React 19 server actions 또는 client function. `name` 없으면 FormData 안 안 잡힘.
- Server Component 안 form action = server action (`'use server'`)
- progressive enhancement (JS 없어도 동작)

### 4. 혼합 금지 — 한 input = 한 방식

- `value` + `defaultValue` 동시 ✕ — React warning + 둘 중 하나 무시
- `value` 만 있고 `onChange` 없음 ✕ — read-only 가 됨 (의도면 `readOnly` 명시)
- 일관성 = component 단위 / form 단위

### 5. checkbox / radio = `checked=` (`value=` 아님)

- `<input type="checkbox" checked={isOn} onChange={...} />`
- `value=` 는 form submit 시점 의 string value (controlled 아님)

### 6. RHF (react-hook-form) = uncontrolled 기반 성능

- `register('email')` = ref + name 자동 등록
- 큰 form 에서 re-render 회피
- zod / valibot schema integration

### 7. Conform = form action progressive enhancement

- `useForm()` + `getFormProps()` + `getInputProps()`
- server action 과 통합 best
- React 19 trend (form action 우선)

## 도구 위임 (이 skill 의 진입점 역할)

- **정적**: `eslint-plugin-react` `react/jsx-handler-names` — handler naming convention
- **정적**: `@typescript-eslint/no-floating-promises` — async submit handler 미 await
- **라이브러리 본문**: RHF / Conform 자체 docs (form 안 모든 패턴 깊게 다룸)
- **dev runtime**: React warn ("A component is changing an uncontrolled input...") — debug aid

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `<input value="x" defaultValue="y" />` | 한 방식 선택 | **validate (error)** |
| `<input value={state} />` (no onChange) | onChange 추가 또는 `readOnly` | **validate (error)** |
| `<input value={state} onChange={...} value={state}>` (재정의) | 단일 attribute | 수동 |
| form-relevant `<input type="text">` 에 `name=` 없음 | `name=` 추가 | **validate (warn)** |
| controlled checkbox 에 `value=` (대신 `checked`) | `checked={isOn}` | 수동 |
| `<select value={undefined}>` (uncontrolled 시작) | `defaultValue` 명시 | 수동 |
| state 변경 시 input 이 unmount → remount (key change) | uncontrolled 의도 시 OK, controlled 의도면 다른 패턴 | 수동 |
| onSubmit + state 둘 다 (form action 우회) | form action 만 또는 onSubmit + preventDefault | 수동 |
| handler 안 `e.target.value` 직접 setState (controlled) + `defaultValue` 표시 | controlled 한 방식 | 수동 |
| form 안 button type 명시 안 함 (default = submit) | `type="button"` (action button) / `type="submit"` (submit) | 수동 |

## Controlled 패턴

```tsx
import { useState } from 'react'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        login({ email, password })
      }}
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit">Log in</button>
    </form>
  )
}
```

## Uncontrolled + FormData 패턴

```tsx
function LoginForm() {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        login({
          email: formData.get('email') as string,
          password: formData.get('password') as string,
        })
      }}
    >
      <input type="email" name="email" defaultValue="" required autoComplete="email" />
      <input type="password" name="password" required />
      <button type="submit">Log in</button>
    </form>
  )
}
```

## Form action (React 19 / Next.js server action) 패턴

```tsx
// app/login/actions.ts
'use server'

export async function login(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  // ... server-side login
}
```

```tsx
// app/login/page.tsx
import { login } from './actions'

export default function LoginPage() {
  return (
    <form action={login}>
      <input type="email" name="email" required />
      <input type="password" name="password" required />
      <button type="submit">Log in</button>
    </form>
  )
}
```

장점: progressive enhancement (JS 없어도 동작) + server-side 인증 / DB 직접 사용.

## react-hook-form 위임 패턴 (큰 form)

```tsx
import { useForm } from 'react-hook-form'

type FormData = { email: string; password: string }

function LoginForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>()
  return (
    <form onSubmit={handleSubmit(login)}>
      <input type="email" {...register('email', { required: '이메일 필수' })} />
      {errors.email && <span>{errors.email.message}</span>}
      <input type="password" {...register('password', { required: '비밀번호 필수' })} />
      <button type="submit">Log in</button>
    </form>
  )
}
```

uncontrolled 기반 → re-render 최소 + zod / valibot resolver 추가 가능.

## 참조

- [React docs — `<input>`](https://react.dev/reference/react-dom/components/input) · [`<form>`](https://react.dev/reference/react-dom/components/form)
- [React 19 — form actions](https://react.dev/blog/2024/12/05/react-19#actions)
- [Conform](https://conform.guide/) — Server actions + progressive enhancement
- [react-hook-form](https://react-hook-form.com/) — Uncontrolled + Schema validation
- [valibot](https://valibot.dev/) · [zod](https://zod.dev/)
