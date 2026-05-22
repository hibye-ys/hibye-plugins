---
name: focus-navigation
description: route 변경 / modal 열고닫기 / list update 등 navigation 동작 후 focus 관리 강제. Skip Navigation link / route announcer (live region) / page-title focus 패턴. 자체 검출 heuristic + 라이브러리 위임.
metadata:
  priority: 4
  docs:
    - "https://www.a11yproject.com/posts/skip-nav-links/"
    - "https://reactrouter.com/start/framework/route-navigation"
    - "https://nextjs.org/docs/app/api-reference/functions/use-router"
    - "https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/"
  pathPatterns:
    - 'src/**/*.{tsx,jsx}'
    - 'app/**/*.{tsx,jsx}'
    - 'components/**/*.{tsx,jsx}'
    - 'src/components/**/*.{tsx,jsx}'
  bashPatterns: []
  importPatterns:
    - 'react'
    - 'react-router-dom'
    - '@tanstack/react-router'
    - 'next/link'
    - 'next/navigation'
    - '@reach/skip-nav'
validate:
  - pattern: '\buseNavigate\s*\(\s*\)|\buseRouter\s*\(\s*\)[\s\S]{0,500}\.push\s*\('
    message: 'route 전환 호출 (useNavigate / router.push) 가 사용되는 파일 안 focus 관리 호출 (focus / live region announcement) 부재 가능성 (heuristic). 페이지 변경 후 main / H1 focus 또는 SR announce 권장.'
    severity: warn
  - pattern: '<(header|nav)\b[\s\S]{0,2000}<main\b(?![\s\S]{0,2000}skip-(nav|link))'
    message: '<header>/<nav> 와 <main> 사이 Skip Navigation link 부재 (heuristic, 2000자 window). `<a href="#main" className="sr-only focus:not-sr-only">본문 바로가기</a>` 추가.'
    severity: warn
retrieval:
  aliases:
    - skip link
    - skip navigation
    - focus management
    - route announcer
    - live region
  intents:
    - manage focus on route change
    - add skip navigation link
    - SR announcement
    - keyboard navigation
  entities:
    - useNavigate
    - useRouter
    - focus
    - live region
    - skip link
chainTo: []
---

# focus-navigation

**Navigation 동작 후 focus 관리** = route change / modal close / list re-order 후 *명시적 focus 이동*. 그렇지 않으면 keyboard / screen reader 사용자가 *어디로 갔는지 모름* (disorient). 본 skill 은 *명시적 focus + Skip Nav + live region 패턴*. 깊은 검증은 `axe-core` runtime 위임.

## When to apply

- 새 route / page 추가 (SPA / Next.js / Remix)
- modal / drawer / popover open-close
- list re-order / pagination / filter 적용
- toast / notification 표시
- 무한 스크롤 / load more 후 새 콘텐츠 추가

## 핵심 원칙

### 1. Page 변경 후 H1 / `<main>` 에 focus

- SPA navigation = HTML 전체 reload 안 됨 → 자동 focus 이동 ✕
- 사용자가 link click 시 focus = link 에 남음 → page change 인지 못 함
- 명시적 = `useEffect(() => mainRef.current?.focus(), [pathname])`
- `<main tabIndex={-1} ref={mainRef}>` 로 programmatic focus 가능
- 또는 H1 에 focus — page topic 즉시 SR 읽음

### 2. Modal close 후 trigger 복귀

- focus trap 안에서 ESC / Close → 원래 trigger button 으로 복귀
- Radix Dialog / React Aria 자동 (a11y-dialog-pattern skill 참고)
- 자체 구현 시 `useRef` 로 trigger 보관 후 useEffect cleanup 으로 복귀

### 3. Skip Navigation link

- 첫 focusable element = "본문으로 가기" link
- `<a href="#main" className="sr-only focus:not-sr-only">본문 바로가기</a>`
- keyboard 사용자가 매 page 마다 nav 통째로 통과 안 하도록

### 4. Route announcer (live region)

- SPA route change 시 SR 에 "X 페이지로 이동" announce
- `<div aria-live="polite" aria-atomic="true" className="sr-only">{pageTitle}</div>` + state 갱신
- React Router framework / Next.js App Router 는 *자동 announcer 내장* — 직접 구현보다 활용

### 5. Keyboard trap 회피

- 컴포넌트 자체가 focus trap 만들면 (custom dropdown 등) → ESC / Tab 으로 빠져나갈 수 있어야 함
- 명시적 escape — `onKeyDown={e => e.key === 'Escape' && close()}`

### 6. tabindex 관리

- `tabIndex={-1}` = programmatic focus 가능 + Tab 순서 ✕
- 비 interactive element (`<main>` / `<section>`) 에 programmatic focus 필요 시 `tabIndex={-1}`
- `tabIndex={0}` = 자연 Tab 순서 포함
- `tabIndex={1+}` ✕ (semantic-a11y 의 jsx-a11y/tabindex-no-positive)

### 7. focus indicator 보존

- `*:focus-visible { outline: ... }` (token-only-styling + semantic-a11y 참고)
- programmatic focus 후에도 visible — keyboard 사용자가 위치 확인

## 도구 위임 (이 skill 의 진입점 역할)

- **정적**: `eslint-plugin-jsx-a11y` `anchor-is-valid` — skip link 의 href="#main" 같은 anchor 검증
- **동적**: `@axe-core/playwright` — live region / skip link / focus order 자동 검증
- **수동 (keyboard)**: Tab 만으로 page navigate, "본문으로 가기" first focus 확인
- **수동 (SR)**: VoiceOver / NVDA — route change 시 page title 읽는지

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| SPA route 후 focus 변경 ✕ (link 에 남음) | `<main tabIndex={-1}>` + useEffect focus | **validate (warn)** |
| header / nav 와 main 사이 Skip Link 없음 | first focusable = skip link | **validate (warn)** |
| modal close 후 focus 사라짐 | Radix / Aria 또는 ref 보관 복귀 | a11y-dialog-pattern 참고 |
| route change 시 SR announce ✕ | live region 또는 framework announcer | 수동 |
| custom dropdown 에서 ESC 안 닫힘 | onKeyDown Escape handler | 수동 |
| `tabIndex={2}` 같이 positive | DOM 순서 + tabIndex={0} | jsx-a11y/tabindex-no-positive (semantic-a11y) |
| `<main>` 에 `tabIndex` 없는데 focus 시도 | `tabIndex={-1}` 추가 | 수동 |
| `outline: none` 전체 | `:focus-visible` (semantic-a11y) | semantic-a11y validate |
| toast 알림이 SR 에 안 들림 | `role="status"` + aria-live="polite" | 수동 |
| 무한스크롤 새 콘텐츠 SR 알림 ✕ | live region count update | 수동 |

## Page-title focus 패턴 (route change 후)

```tsx
// app/layout.tsx 또는 react-router root layout
'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

export function Layout({ children }: { children: React.ReactNode }) {
  const mainRef = useRef<HTMLElement>(null)
  const pathname = usePathname()
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    mainRef.current?.focus()
  }, [pathname])

  return (
    <>
      <SkipLink />
      <Header />
      <main ref={mainRef} id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  )
}
```

## Skip Navigation link 패턴

```tsx
function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:bg-primary focus:text-primary-fg focus:px-4 focus:py-2 focus:rounded"
    >
      본문으로 가기
    </a>
  )
}
```

- `sr-only` (Tailwind utility) = 시각적으로 숨김 + SR 표시
- `focus:not-sr-only` = focus 시 보이게
- 첫 focusable element 로 배치

## Live region (route announcer) 패턴

```tsx
'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export function RouteAnnouncer() {
  const [message, setMessage] = useState('')
  const pathname = usePathname()

  useEffect(() => {
    const title = document.title  // e.g. "포스트 — MyApp"
    setMessage(`${title} 페이지로 이동`)
  }, [pathname])

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      role="status"
    >
      {message}
    </div>
  )
}
```

Next.js / React Router 가 *자동 announcer 내장* — 위는 framework 미사용 시 fallback. 우선 framework 기본 활용 권장.

## Toast / Notification 패턴

```tsx
function Toast({ message, severity }: Props) {
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      aria-live={severity === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="..."
    >
      {message}
    </div>
  )
}
```

- `role="status"` + `aria-live="polite"` = 일반 알림 (사용자 작업 중 끼어들지 ✕)
- `role="alert"` + `aria-live="assertive"` = 긴급 (즉시 announce)

## 참조

- [A11y Project — Skip Navigation Links](https://www.a11yproject.com/posts/skip-nav-links/)
- [WAI-ARIA — Live Regions](https://www.w3.org/WAI/PF/aria/states_and_properties#aria-live)
- [React Router — focus management](https://reactrouter.com/start/framework/route-navigation)
- [Next.js — usePathname](https://nextjs.org/docs/app/api-reference/functions/use-pathname)
- [Radix UI — Toast (live region 자동)](https://www.radix-ui.com/primitives/docs/components/toast)
- [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright)
