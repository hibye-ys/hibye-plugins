---
name: error-boundary-telemetry
description: React ErrorBoundary (react-error-boundary / Sentry.ErrorBoundary) + onError 텔레메트리 + 접근 가능한 fallback UI (role=alert) + reset. componentDidCatch silent swallow / fallback 누락 / boundary 안 throw 검출. ErrorBoundary 작성 또는 catch 핸들러 추가 시 자동 트리거.
metadata:
  priority: 4
  docs:
    - "https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary"
    - "https://github.com/bvaughn/react-error-boundary"
    - "https://docs.sentry.io/platforms/javascript/guides/react/features/error-boundary/"
    - "https://nextjs.org/docs/app/getting-started/error-handling"
  pathPatterns:
    - 'src/**/*.ts'
    - 'src/**/*.tsx'
    - 'src/**/*.js'
    - 'src/**/*.jsx'
    - 'app/**/*.ts'
    - 'app/**/*.tsx'
    - 'app/**/*.js'
    - 'app/**/*.jsx'
    - 'components/**/*.ts'
    - 'components/**/*.tsx'
    - 'components/**/*.js'
    - 'components/**/*.jsx'
    - 'app/**/error.tsx'
    - 'app/**/error.jsx'
    - 'app/**/global-error.tsx'
    - 'app/**/global-error.jsx'
  bashPatterns: []
  importPatterns:
    - 'react'
    - 'react-error-boundary'
    - '@sentry/react'
    - '@sentry/nextjs'
    - '@sentry/electron'
  validate:
    - pattern: '<(?:Sentry\.)?ErrorBoundary\b(?:(?!fallback|FallbackComponent|fallbackRender)[^>])*?/?>'
      message: 'ErrorBoundary 에 fallback / FallbackComponent / fallbackRender 모두 없음 — render 안 됨 (또는 silent). react-error-boundary 는 셋 중 하나 의무, Sentry.ErrorBoundary 는 fallback 권장.'
      severity: error
    - pattern: 'componentDidCatch\s*\([^)]*\)\s*\{\s*\}'
      message: 'componentDidCatch 빈 implementation — silent swallow. Sentry.captureException / 자체 telemetry 전송 의무. 단순 throw rethrow 도 boundary 의 의미 ✕.'
      severity: warn
    - pattern: 'componentDidCatch\s*\([^)]*\)\s*\{[^}]*\bthrow\b'
      message: 'componentDidCatch 안 throw — 위로 propagate (boundary 무효). 텔레메트리 전송 후 보존 또는 reset 패턴 사용.'
      severity: warn
retrieval:
  aliases:
    - error boundary
    - componentDidCatch
    - react-error-boundary
    - Sentry ErrorBoundary
    - error fallback
    - error.tsx
  intents:
    - catch react error
    - error fallback UI
    - report error to telemetry
    - reset error boundary
    - configure error.tsx
  entities:
    - ErrorBoundary
    - FallbackComponent
    - fallbackRender
    - onError
    - resetKeys
    - useErrorBoundary
chainTo:
  - pattern: '@sentry/(?:react|nextjs|electron|browser)'
    targetSkill: sentry-rum-pii
    message: 'Sentry 통합 감지 — DSN env var / sendDefaultPii / Session Replay PII 룰 (sentry-rum-pii skill).'
---

# error-boundary-telemetry

**ErrorBoundary 는 React render-tree 안 *동기 throw* 만 catch.** 자체 class component 직접 구현 ✕ — `react-error-boundary` library 또는 `@sentry/react` 의 `Sentry.ErrorBoundary` 위임이 표준. 본 skill 의 3 핵심 = (1) `onError` → Sentry / 자체 telemetry (silent swallow ✕), (2) `role="alert"` 접근 가능 fallback UI + 재시도 button, (3) `resetKeys` / `resetBoundary` 로 영구 에러 상태 회피. Suspense + ErrorBoundary 페어 / Next.js `error.tsx` 통합도 같은 원칙 — granularity 는 의미 있는 UI 단위.

## When to apply

- 신규 ErrorBoundary 작성 (`react-error-boundary` 또는 `Sentry.ErrorBoundary`) / Suspense 페어 추가 (`suspense-error-locality` 동일 패턴)
- `@sentry/react` 통합 후 `Sentry.ErrorBoundary` / `Sentry.withErrorBoundary` 도입
- Next.js App Router `app/**/error.tsx` / `app/global-error.tsx` 작성
- fallback UI 접근성 점검 (`role="alert"` / heading / 재시도 button)
- `resetKeys` / `useErrorBoundary().resetBoundary()` reset 패턴 추가
- 자체 class ErrorBoundary → react-error-boundary 마이그레이션 / `componentDidCatch` silent swallow / rethrow 리팩토링

## 핵심 원칙

### 1. `react-error-boundary` 권장 — 자체 class 구현 ✕

- `<ErrorBoundary FallbackComponent={...} onError={...} resetKeys={...}>` — function component 친화 + `useErrorBoundary` hook 제공
- *3 prop 중 하나* (`fallback` / `FallbackComponent` / `fallbackRender`) 의무 — 셋 다 없으면 render 안 됨 (silent)
- 자체 class ErrorBoundary corner case (props 변경 시 reset / async tick / hydration) 다수 — 라이브러리 위임. React 19 + v4+ 호환

### 2. Fallback UI 접근성 — `role="alert"` + 안내 + 재시도

- *최소* = `role="alert"` (긴급도 낮으면 `role="status"`) + 명확한 안내 text + 재시도 button. 단순 `"Something went wrong"` 만 ✕
- 기술 detail (stack / componentStack) = `<details>` toggle 안 (production noise / 개발 디버깅 균형)
- focus 이동 — fallback render 직후 alert 영역에 focus 또는 `aria-live` 자동 announce (`focus-navigation` 동일 철학)

### 3. `onError` → telemetry 전송 의무 (silent swallow ✕)

- `Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } })` — Sentry 통합 케이스
- 자체 endpoint 면 `navigator.sendBeacon('/api/errors', JSON.stringify({...}))` — `web-vitals-transport` sendBeacon 패턴 공유
- PII 마스킹 의무 — error message / stack 안 사용자 입력 / 토큰 / 이메일 (`sentry-rum-pii` cross-ref). validate rule 2 = `componentDidCatch` 빈 body warn

### 4. Reset 패턴 — 영구 에러 상태 회피

- `<ErrorBoundary resetKeys={[userId, locale]}>` — dep 변경 시 자동 reset (사용자 전환 / route 변경). 사용자 클릭 reset = `useErrorBoundary().resetBoundary()` 또는 `fallbackRender` 의 `resetErrorBoundary` arg
- `onReset` prop = reset 시점 side-effect (`queryClient.invalidateQueries` / log). reset 없으면 새로고침까지 영구 fallback
- validate rule 3 = `componentDidCatch` 안 `throw` = 위로 propagate (boundary 무효) warn

### 5. Granularity + Suspense 페어

- *route / panel / section* 단위 boundary 분할 — sidebar widget 실패가 main content 까지 통째 fallback ✕. 전체 app 한 boundary ✕
- `<ErrorBoundary fallback={<Err />}><Suspense fallback={<Skel />}>...</Suspense></ErrorBoundary>` *같은 boundary level* — 또는 역순도 valid
- `useSuspenseQuery` (TanStack Query) throw 도 부모 ErrorBoundary catch — `suspense-error-locality` 본문 참고 (granularity 원칙 일치)

### 6. Next.js `error.tsx` / `global-error.tsx`

- App Router = 각 route segment 의 `error.tsx` 자동 ErrorBoundary — `'use client'` 필수. props = `{ error: Error & { digest?: string }; reset: () => void }`
- `reset` = segment 재 mount, `digest` = server 측 log key
- `app/global-error.tsx` = root layout 자체 에러까지 catch — 최후의 safety net (rare). `html` + `body` 직접 render

## react-error-boundary + Sentry.captureException 패턴

```tsx
'use client'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'
import * as Sentry from '@sentry/react'
import type { ErrorInfo } from 'react'

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" className="rounded-md border border-error/40 p-4">
      <h2 className="font-semibold text-error">콘텐츠를 불러올 수 없어요</h2>
      <p className="mt-1 text-sm">잠시 후 다시 시도해 주세요.</p>
      <details className="mt-2 text-xs opacity-70">
        <summary>기술 정보</summary>
        <pre className="mt-1 whitespace-pre-wrap">{error.message}</pre>
      </details>
      <button type="button" onClick={resetErrorBoundary} className="mt-3">다시 시도</button>
    </div>
  )
}

function handleError(error: Error, info: ErrorInfo) {
  // componentStack 동봉 — Sentry Issues 정확한 source 매핑
  Sentry.captureException(error, {
    contexts: { react: { componentStack: info.componentStack ?? '' } },
  })
}

export function DashboardSection({ userId }: { userId: string }) {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={handleError}
      resetKeys={[userId]}  // userId 변경 시 자동 reset
      onReset={() => {/* queryClient.invalidateQueries(...) */}}
    >
      <DashboardContent userId={userId} />
    </ErrorBoundary>
  )
}
```

핵심 = `FallbackComponent` + `onError` 안 `Sentry.captureException` + `resetKeys` 자동 reset + `onReset` side-effect.

## Accessible fallback UI 예시

```tsx
function MinimalErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" aria-live="assertive">
      <h2>문제가 발생했어요</h2>
      <p>콘텐츠를 표시할 수 없어요. 다시 시도해 주세요.</p>
      <details><summary>상세 정보</summary><pre>{error.message}</pre></details>
      <button type="button" onClick={resetErrorBoundary}>다시 시도</button>
    </div>
  )
}
```

3 요소 = `role="alert"` (SR 즉시 announce) + heading + 재시도 button. `<details>` toggle 로 기술 정보 progressive disclosure.

## Sentry.ErrorBoundary 통합 패턴

```tsx
'use client'
import * as Sentry from '@sentry/react'

export function PaymentSection() {
  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div role="alert">
          <h2>결제 정보를 표시할 수 없어요</h2>
          <p>{error.message}</p>
          <button type="button" onClick={resetError}>다시 시도</button>
        </div>
      )}
      showDialog
      beforeCapture={(scope) => { scope.setTag('section', 'payment'); scope.setLevel('error') }}
    >
      <PaymentForm />
    </Sentry.ErrorBoundary>
  )
}
```

`Sentry.ErrorBoundary` = `captureException` 자동 + `showDialog` (user feedback) + `beforeCapture` scope. Sentry-only 환경 적합.

## Next.js error.tsx / global-error.tsx 패턴

```tsx
// app/dashboard/error.tsx — route segment 단위 ErrorBoundary
'use client'
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

type Props = { error: Error & { digest?: string }; reset: () => void }

export default function DashboardError({ error, reset }: Props) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { route: 'dashboard' } })
  }, [error])

  return (
    <div role="alert">
      <h2>대시보드를 불러올 수 없어요</h2>
      {error.digest && <p>에러 ID: {error.digest}</p>}
      <button type="button" onClick={reset}>다시 시도</button>
    </div>
  )
}
```

```tsx
// app/global-error.tsx — root layout 까지 catch (production safety net)
'use client'
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error) }, [error])
  return (
    <html lang="ko"><body>
      <div role="alert">
        <h2>예기치 못한 오류가 발생했어요</h2>
        <p>새로고침해 주세요.</p>
      </div>
    </body></html>
  )
}
```

`'use client'` 필수. `reset` = segment 재 mount. `global-error.tsx` = `html` + `body` 직접 render (root layout 무효화 상태).

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `<ErrorBoundary>` fallback / FallbackComponent / fallbackRender 모두 없음 | 셋 중 하나 명시 | **validate (error)** |
| `componentDidCatch(e, info) {}` (빈 body, silent swallow) | `Sentry.captureException(e, { contexts })` | **validate (warn)** |
| `componentDidCatch` 안 `throw` (위로 propagate) | telemetry 전송 후 보존 또는 reset 패턴 | **validate (warn)** |
| 전체 app 한 `<ErrorBoundary>` wrap | route / panel / section 단위 분할 | 수동 |
| Suspense 만 있고 ErrorBoundary 없음 | 페어로 wrap | suspense-error-locality 위임 |
| 자체 class ErrorBoundary 직접 구현 | `react-error-boundary` 라이브러리 위임 | 수동 |
| captureException 시 PII 미마스킹 (error.message 안 user 입력) | `beforeSend` scrub | sentry-rum-pii cross-ref |
| reset 미제공 (영구 fallback) | `resetKeys` 또는 `resetErrorBoundary` button | 수동 |
| Next.js `error.tsx` `'use client'` 누락 | 파일 상단 `'use client'` | 수동 / Next.js build |
| fallback UI 에 `role` / heading / 재시도 button 없음 | `role="alert"` + h2 + button 3종 | 수동 |
| Sentry.ErrorBoundary `showDialog` 없이 사용자 안내 불분명 | `showDialog` 또는 명시적 안내 text | 수동 |
| `app/global-error.tsx` 미설정 (root layout 충돌 시 빈 화면) | global-error.tsx + html/body render | 수동 |

## 도구 위임 (이 skill 의 진입점 역할)

- **`react-error-boundary`** — `FallbackComponent` / `fallbackRender` / `useErrorBoundary` / `resetKeys` / `onError` / `onReset` 자체 docs
- **`@sentry/react`** `Sentry.ErrorBoundary` — `captureException` 자동 + `showDialog` + `beforeCapture` scope. react-error-boundary 와 *둘 중 하나*
- **Sentry dashboard Issues / Replays** — runtime audit (실제 발생 빈도 / componentStack 정확도)
- **React DevTools** — Component stack 시각화. **chainTo `sentry-rum-pii`** — Sentry 통합 감지 시 PII 마스킹 + DSN env var 자동 chain
- **본 plugin validate 가 *추가* 하는 영역**: fallback 3종 모두 없는 `<ErrorBoundary>` 즉시 error (silent 사고) / `componentDidCatch` 빈 body warn (silent swallow) / `componentDidCatch` 안 `throw` warn (boundary 의미 무효)
- **cross-reference**: `suspense-error-locality` (페어 / granularity 동일), `sentry-rum-pii` (chainTo, PII redaction), `web-vitals-transport` (`sendBeacon` transport 공유), `focus-navigation` (fallback render 후 alert focus), `semantic-a11y` (`role="alert"` / live region 의미)

## 참조

- [React docs — Catching rendering errors with an error boundary](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
- [`react-error-boundary` (bvaughn)](https://github.com/bvaughn/react-error-boundary) · [Kent C. Dodds 가이드](https://kentcdodds.com/blog/use-react-error-boundary-to-handle-errors-in-react)
- [Sentry — React ErrorBoundary](https://docs.sentry.io/platforms/javascript/guides/react/features/error-boundary/) · [`captureException` componentStack](https://docs.sentry.io/platforms/javascript/usage/sdk-fundamentals/#capturing-errors)
- [Next.js — Error Handling](https://nextjs.org/docs/app/getting-started/error-handling) · [error.js 파일 규칙](https://nextjs.org/docs/app/api-reference/file-conventions/error)
- [MDN — ARIA `alert` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/alert_role) · [WAI-ARIA APG — Alert pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/) · [Live region 가이드](https://www.w3.org/WAI/ARIA/apg/practices/live-regions/)
