---
name: semantic-a11y
description: React Web 컴포넌트 작성/리뷰 시 native HTML 우선 (First Rule of ARIA) + ARIA 최소화 + keyboard 접근 + visible focus 강제. interactive element (button / dialog / form / link) 추가 또는 a11y 관련 prop (role / aria-*) 작성 시 자동 트리거.
metadata:
  priority: 5
  docs:
    - "https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles"
    - "https://www.w3.org/WAI/ARIA/apg/patterns/button/"
    - "https://www.w3.org/WAI/standards-guidelines/wcag/"
    - "https://react.dev/learn/accessibility"
  pathPatterns:
    - 'src/components/**/*.tsx'
    - 'src/components/**/*.jsx'
    - 'app/components/**/*.tsx'
    - 'app/components/**/*.jsx'
    - 'components/**/*.tsx'
    - 'components/**/*.jsx'
    - 'src/ui/**/*.tsx'
    - 'src/**/*.css'
    - 'src/**/*.scss'
    - 'src/**/*.sass'
    - 'src/**/*.module.css'
    - 'src/**/*.module.scss'
    - 'app/**/*.css'
    - 'app/**/*.scss'
    - 'styles/**/*.css'
    - 'styles/**/*.scss'
  bashPatterns: []
  importPatterns:
    - 'react'
    - 'react-dom'
    - '@radix-ui/react-dialog'
    - '@radix-ui/react-*'
    - 'react-aria'
    - 'react-aria-components'
    - '@headlessui/react'
validate:
  - pattern: '<a\b[^>]*role=["'']button["'']|role=["'']button["''][^>]*<a\b'
    message: 'role="button" on <a> — semantic 모순. action 이면 <button>, navigation 이면 role 제거. (jsx-a11y/anchor-is-valid 와 부분 중첩, IDE 즉시 표시 가치로 유지)'
    severity: error
  - pattern: '\*\s*:\s*focus\s*\{[^}]*outline\s*:\s*(none|0)\s*[;}]'
    message: 'CSS 전역 *:focus { outline: none } — focus visibility 파괴. :focus-visible 만 강조하거나 대체 ring 명시. (jsx-a11y 가 미커버하는 CSS 사이드 — 본 plugin 유일 영역)'
    severity: error
  - pattern: '\.focus-?(?:none|hidden)\s*\{[^}]*outline\s*:\s*(none|0)'
    message: 'CSS class .focus-none / .focus-hidden 으로 outline 제거 — :focus-visible 사용. (CSS 사이드)'
    severity: warn
retrieval:
  aliases:
    - a11y
    - accessibility
    - ARIA
    - screen reader
    - keyboard navigation
  intents:
    - make component accessible
    - keyboard navigation
    - screen reader support
    - ARIA pattern
    - fix focus issues
  entities:
    - button
    - dialog
    - input
    - label
    - focus
    - ARIA role
    - tabindex
chainTo:
  - pattern: '<dialog\b|role=["'']dialog["'']|aria-modal|@radix-ui/react-dialog'
    targetSkill: a11y-dialog-pattern
    message: 'Dialog 패턴 감지 — focus trap / ESC / return focus 룰 (a11y-dialog-pattern skill).'
---

# semantic-a11y

**First Rule of ARIA — native HTML 우선.** ARIA 는 native 가 표현 못 하는 경우의 escape hatch. 본 skill 은 *원칙 + 자동 트리거 + 즉시 lint + 기성품 진입점* 이며, 깊은 검증은 `eslint-plugin-jsx-a11y` (35 룰) + `@axe-core/playwright` 위임.

## When to apply

- 새 React 컴포넌트 추가 (interactive element 포함)
- a11y 관련 prop (`role`, `aria-*`, `tabIndex`, `alt`) 작성
- `<dialog>`, `<form>`, `<button>`, `<a>`, `<img>`, focusable element 작성
- CSS 안 `:focus` / `outline` / `tabindex` 관련 룰 작성
- screen reader / keyboard navigation 관련 리뷰 요청

## 핵심 원칙

### 1. Interactive = native semantic + keyboard

- `<button type="button">` for action — `<form>` 안이면 type 명시 (기본 submit 함정)
- `<a href>` for navigation — `href` 없으면 keyboard tab 안 됨
- custom interactive 시 *role* + *tabIndex={0}* + *onKeyDown* 3종 모두 필수 (아래 패턴 참고)
- div + onClick — *jsx-a11y/click-events-have-key-events* 가 자동 검출

### 2. Form field = label 연결

- `<label htmlFor="id">` + `<input id="id">` (1순위)
- 또는 `<label>` 안 wrap (`<label><span>Email</span><input/></label>`)
- 또는 `aria-labelledby` / `aria-label`
- placeholder *만* 으로 label ✕ — focus 후 사라짐, screen reader 일관성 ✕ (jsx-a11y/label-has-associated-control)

### 3. Focus visibility = `:focus-visible` only

- 전역 `*:focus { outline: none }` ✕ — keyboard 사용자 차단 (**본 plugin validate 가 CSS 사이드 검출 — jsx-a11y JSX only**)
- `*:focus-visible { outline: 2px solid var(--focus-ring) }` 같이 키보드 trigger 만
- 디자인 시스템 차원에서 `--focus-ring` 토큰 고정 (token-only-styling skill 참고)

### 4. Dialog / Popover = 검증 라이브러리 위임

- 자체 구현 ✕ — focus trap / ESC / aria-modal / return focus 4종 모두 어려움
- Radix UI Dialog (`@radix-ui/react-dialog`) 또는 React Aria (`react-aria-components` Dialog) **권장**
- 네이티브 `<dialog>` 도 OK (Chromium 기반 환경 / Electron 확실)

### 5. 이미지 `alt` 의무

- jsx-a11y/alt-text 가 자동 검출 — 본 plugin 미터치
- 의미 — `alt="설명"`, 장식 — `alt=""`, icon button — `<button aria-label="삭제"><Icon aria-hidden /></button>`

### 6. `prefers-reduced-motion` 존중

- `useReducedMotion()` (Framer Motion) 또는 `@media (prefers-reduced-motion: reduce)`

### 7. 색만으로 상태 표현 ✕

- 빨강 = 에러, 초록 = 성공 — 색맹 차단
- 색 + icon + 텍스트 ≥ 2종

## 도구 위임 (이 skill 의 진입점 역할)

- **정적 (35 룰)**: `eslint-plugin-jsx-a11y` `recommended` 또는 `strict` — JSX 안 모든 a11y 패턴.
  - `click-events-have-key-events` → `<div onClick>` 검출 (본 plugin validate ✕)
  - `tabindex-no-positive` → `tabIndex={1+}` 검출 (본 plugin validate ✕)
  - `alt-text` → `<img>` alt 누락 검출 (본 plugin validate ✕)
  - `anchor-is-valid` → `<a>` 잘못된 사용 (본 plugin validate 는 `role="button"` 만 추가 검출)
- **본 plugin validate 가 추가하는 영역**:
  - **CSS 사이드** — `*:focus { outline: none }` 등 (jsx-a11y JSX only 라 미커버)
  - `<a role="button">` 즉시 표시 (anchor-is-valid 일부 중첩, IDE 즉시 가치)
- **동적 (WCAG 자동)**: `@axe-core/playwright` — CI 단계.
- **대비 / 디자인**: Stark (Figma plugin) / Contrast Ratio (Chrome ext)
- **screen reader 수동**: macOS VoiceOver / NVDA / JAWS

## 안티패턴 표 (검출 경로 명시)

| 안티 | 교정 | 검출 |
|---|---|---|
| `<div onClick>` | `<button>` 또는 role+tabIndex+onKeyDown | jsx-a11y/click-events-have-key-events |
| `<a href="#" onClick>` | `<button>` (URL hash 변경 / SEO 오염 방지) | jsx-a11y/anchor-is-valid + 본 plugin (role=button case) |
| `role="button"` on `<a>` | `<button>` (action) 또는 `<a>` (nav, role 제거) | **본 plugin validate (error)** |
| `*:focus { outline: none }` (CSS) | `*:focus-visible { outline: ... }` | **본 plugin validate (error, CSS)** |
| `.focus-none { outline: 0 }` (CSS) | `:focus-visible` 사용 | **본 plugin validate (warn, CSS)** |
| `tabIndex={1+}` | DOM 순서 + `tabIndex={0}` 또는 생략 | jsx-a11y/tabindex-no-positive |
| `<img>` alt 누락 | `alt="설명"` 또는 `alt=""` (장식) | jsx-a11y/alt-text |
| `aria-hidden="true"` on focusable | `aria-hidden` 제거 또는 `tabIndex={-1}` 함께 | jsx-a11y/no-aria-hidden-on-focusable |
| `placeholder` 만으로 label | `<label htmlFor>` 추가 | jsx-a11y/label-has-associated-control |
| 색만으로 상태 (빨강 = 에러) | 색 + icon + 텍스트 (≥2종) | 수동 리뷰 |
| 자체 구현 dialog | Radix / React Aria | 수동 리뷰 |

## Custom Interactive 패턴 (native 없을 때만)

```tsx
function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange(!checked)
        }
      }}
    />
  )
}
```

3종 (`role` + `tabIndex={0}` + `onKeyDown`) 중 하나라도 빠지면 keyboard 사용자 차단. **단 — 가능하면 native `<input type="checkbox">` + `role="switch"` 조합** (form 통합 / SR 표현 우수).

## Dialog 패턴 — Radix / React Aria 권장

자체 구현 ✕. 다음 라이브러리 중 하나:

```tsx
// Option A — Radix Dialog (headless)
import * as Dialog from '@radix-ui/react-dialog'
<Dialog.Root>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay />
    <Dialog.Content>
      <Dialog.Title>Title</Dialog.Title>
      <Dialog.Description>...</Dialog.Description>
      <Dialog.Close>Close</Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

// Option B — React Aria Components
import {DialogTrigger, Dialog, Modal, Heading} from 'react-aria-components'
```

둘 다 focus trap / ESC / return focus / aria-modal 자동.

> Phase 2 — 별도 `a11y-dialog-pattern` skill 신설 시 본 skill 에서 chainTo 추가 예정.

## 참조

- [MDN ARIA Roles](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles)
- [WAI-ARIA APG (button / dialog / combobox / ...)](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [React docs — Accessibility](https://react.dev/learn/accessibility)
- [eslint-plugin-jsx-a11y rule list](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/tree/main/docs/rules)
- [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright)
- [Radix Primitives](https://www.radix-ui.com/primitives) · [React Aria Components](https://react-spectrum.adobe.com/react-aria/components.html)
