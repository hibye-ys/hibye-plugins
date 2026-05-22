# Agent 2 — 2026 Frontend Best-Practice 웹 리서치 (raw)

- **목적**: AI 에이전트가 자동 강제할만한 React Web (Vite/Next/Remix/RR7/Electron) 룰/패턴 25개 카테고리 총망라
- **subagent**: `general-purpose` (WebSearch + WebFetch 권한)
- **수집일**: 2026-05-22
- **스택 전제**: React 19 + React Compiler 1.0 (2025-10 GA) + Next 16 Cache Components + Tailwind v4 + TypeScript strict
- **참고**: 이 문서는 sub-agent 의 raw output 을 정돈 없이 옮긴 원본

---

# Frontend AI-Agent Harness Rules — Total Inventory (May 2026)

스코프: Vite SPA + Next App Router (16.x, Cache Components 기본) + Remix + React Router 7 framework mode + Electron renderer (Chromium). React 19 + React Compiler 1.0 (2025-10 GA) + Tailwind v4 + TypeScript strict 기준.

표기 규약 — 각 카테고리에서:
- **[INV]** = 상시 invariant — 코드 생성시 항상 적용
- **[VER]** = on-demand verify-* 스킬 후보 (grep/lint/lighthouse/axe/playwright)
- **[ANTI]** = 흔한 안티패턴 (자동 검출 가치 있음)

---

## 1. 컴포넌트 합성

- [INV] React 19에서 `forwardRef` 신규 작성 금지. `ref`는 일반 prop으로 받는다 ([react.dev/blog/2024/12/05/react-19](https://react.dev/blog/2024/12/05/react-19)).
- [INV] Boolean prop 4개 이상이면 compound / slot(asChild) 패턴으로 리팩토링 후보.
- [INV] Polymorphic `as` prop은 `as: React.ElementType` + 제네릭으로 타입화. Radix `Slot` / `asChild` 우선.
- [INV] Controlled 컴포넌트는 `value` + `onChange` + `defaultValue` 미지정 (둘 다 주면 React warning).
- [VER] `forwardRef` grep → React 19 코드베이스에서 0건이어야.
- [VER] 같은 컴포넌트에 `value` + `defaultValue` 동시 사용 lint.
- [ANTI] Props drilling 3 depth 초과 시 context/composition 검토 강제.
- [ANTI] `React.cloneElement`로 자식 prop 강제 주입 (Slot으로 대체).

## 2. 상태 관리

- [INV] **Server state는 절대 client store(Zustand/Jotai/Redux)에 넣지 않는다.** 서버 상태는 TanStack Query 또는 RSC props로만.
- [INV] State colocation — 한 컴포넌트에서만 쓰면 하위 컴포넌트로 내려서 보유.
- [INV] Derived state는 변수/`useMemo`가 아니라 렌더 중 계산 (React Compiler가 메모화).
- [INV] Optimistic update는 `useOptimistic` 사용, 수동 setState rollback 금지.
- [VER] Zustand/Jotai store에서 `fetch(` / `axios` import 검출.
- [ANTI] `useState`로 props 미러링 (`useState(props.x)`).
- [ANTI] context value가 매 렌더 새 객체 (provider memoize 누락).

## 3. 데이터 페칭

- [INV] TanStack Query queryKey는 array, JSON-serializable, hierarchical (`['todos', userId, filters]`).
- [INV] `staleTime` 명시 (기본 0 = 즉시 stale). 정적 데이터 ≥ 60s ([tanstack.com](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)).
- [INV] RSC에서 동일 request에 중복 fetch가 있으면 `React.cache()`로 래핑 (Server Component 전용, 모듈 스코프에 정의) ([react.dev/reference/react/cache](https://react.dev/reference/react/cache)).
- [INV] Mutation 성공 시 `queryClient.invalidateQueries({ queryKey })` 또는 Server Action `revalidateTag`/`updateTag` ([nextjs.org](https://nextjs.org/docs/app/getting-started/caching-and-revalidating)).
- [INV] suspense query는 `<Suspense>` + `<ErrorBoundary>` 둘 다 위에 있어야.
- [VER] `useQuery({ queryKey: 'string' })` (배열 아님) lint.
- [VER] mutation onSuccess에 invalidate 누락 grep.
- [ANTI] Race condition: 동일 컴포넌트에서 두 개 mutation 동시 발사 후 첫 응답에 의존.

## 4. 라우팅

- [INV] Search params는 zod로 validate. TanStack Router `validateSearch`, Next는 `searchParams.then(z.parse)`.
- [INV] Path params = 필수 리소스 ID, search params = 필터/페이지/UI state.
- [INV] Next App Router에서 `params`, `searchParams`는 16.x부터 `Promise` — `await` 필수.
- [INV] Next 16에서 cache components가 켜져있으면 `searchParams` 접근 컴포넌트는 `<Suspense>` 안에.
- [VER] `useRouter().push()`에 외부 URL (http://) 직접 전달 grep — open redirect 위험.
- [ANTI] `useEffect` 안에서 `router.push` (조건부 navigation은 RSC/loader에서).

## 5. 렌더링 모델 (CSR/SSR/RSC/PPR)

- [INV] Next App Router: 기본 Server Component. `"use client"`는 진짜 인터랙션 필요한 leaf에만.
- [INV] Client Component에 Server Component를 import 금지 — `children` prop으로 주입 ([nextjs.org/docs/app/getting-started/server-and-client-components](https://nextjs.org/docs/app/getting-started/server-and-client-components)).
- [INV] Server Component에서 `useState`, `useEffect`, browser API, event handler 사용 금지.
- [INV] Server→Client props는 serializable (function, Date 인스턴스, class 인스턴스 제한적).
- [INV] Next 16 Cache Components 켜진 상태: 런타임 API(`cookies`, `headers`, `searchParams`, `connection()`) 접근 컴포넌트는 `<Suspense>` 필수, 그렇지 않으면 `'use cache'`.
- [INV] `'use cache'` 함수 인자 + 클로저 캡처 값 = cache key. 비결정적 입력 캡처 금지.
- [VER] `"use client"` 파일에서 `process.env.` (NEXT_PUBLIC 외) 사용 grep — 환경변수 누설.
- [VER] `server-only` import 패키지로 server 모듈 보호.
- [ANTI] 모든 컴포넌트 최상단에 `"use client"` (대규모 client bundle).

## 6. 스타일링 / 디자인 토큰

- [INV] Tailwind v4 `@theme`로 토큰 정의, 색/spacing literal 금지 — `bg-[#fff]` 또는 `style={{ color: '#000' }}` 금지 ([tailwindcss.com/docs/theme](https://tailwindcss.com/docs/theme)).
- [INV] Dark mode = CSS variable swap + `prefers-color-scheme`, class 토글은 user override만.
- [INV] Semantic token (`--color-bg-elevated`) → primitive token (`--color-gray-100`) → raw value. 컴포넌트는 semantic만 참조.
- [INV] 디자인 토큰 패키지 semver — breaking change(키 제거/리네임)는 major.
- [VER] grep `#[0-9a-fA-F]{3,8}` in `.tsx/.css` (token 파일 제외).
- [VER] grep `rgb(`/`rgba(` literal in components.
- [ANTI] Tailwind arbitrary value 남용 (`p-[13.5px]`).

## 7. 접근성 (a11y)

- [INV] **First Rule of ARIA** — native HTML 있으면 ARIA 쓰지 말 것 ([developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles)).
- [INV] 모든 interactive element는 keyboard 접근 가능 + visible focus ring.
- [INV] Dialog/Popover는 Radix 또는 React Aria 사용 — focus trap, ESC, aria-modal, return focus 자동.
- [INV] 이미지 `alt` 필수 (의미 없으면 `alt=""`).
- [INV] Form field는 `<label htmlFor>` 또는 `aria-labelledby` 필수.
- [INV] 텍스트 대비 WCAG AA 4.5:1 (UI 컴포넌트 3:1).
- [INV] `prefers-reduced-motion` 감지하여 transition/animation 단축.
- [VER] axe-core CI 실행 (Playwright `@axe-core/playwright`).
- [VER] `<div onClick>` (역할 없음) lint — `jsx-a11y/click-events-have-key-events`.
- [VER] `tabIndex` ≥ 1 grep (focus order 깨짐).
- [ANTI] `aria-hidden="true"` on focusable element.
- [ANTI] `role="button"` on `<a>` (대신 `<button>`).

## 8. 성능 / Web Vitals

- [INV] **2026 Core Web Vitals targets**: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 (75th percentile) ([web.dev/articles/vitals](https://web.dev/articles/vitals), [web.dev/articles/inp](https://web.dev/articles/inp)).
- [INV] LCP 이미지: `priority` / `fetchpriority="high"`, lazy 금지, dimension(width/height) 명시.
- [INV] Font: `font-display: swap` + `preload` + `next/font` 또는 self-hosted.
- [INV] Route별 JS bundle 예산 (예: route ≤ 170KB gzipped, app shell ≤ 90KB).
- [INV] List 100+ row는 TanStack Virtual (또는 `react-virtuoso`).
- [INV] React Compiler 1.0 활성 — 새 코드에서 `useMemo`/`useCallback` 기본 사용 금지, 명시적 escape hatch만 ([react.dev/blog/2025/10/07/react-compiler-1](https://react.dev/blog/2025/10/07/react-compiler-1)).
- [INV] `<Activity mode="hidden">`로 탭/패널 상태 보존 — 조건부 unmount보다 우선 ([react.dev/reference/react/Activity](https://react.dev/reference/react/Activity)).
- [VER] Lighthouse CI mobile preset (perf ≥ 90).
- [VER] `bundle-stats` / `size-limit` PR check.
- [VER] grep `loading="lazy"` on above-the-fold image.
- [VER] `useMemo`/`useCallback` 신규 추가 grep (compiler 활성 코드베이스).
- [ANTI] `next/dynamic({ ssr: false })`로 LCP 컴포넌트 lazy.
- [ANTI] 이미지 `width`/`height` 누락 → CLS.

## 9. Form

- [INV] Server Action 기반 form은 Conform + Zod (같은 schema가 client/server 양쪽 실행) — Next App Router progressive enhancement.
- [INV] 클라이언트 풍부 UX form은 react-hook-form + `zodResolver`, `mode: 'onBlur'`.
- [INV] Submit 버튼은 `useFormStatus().pending` 또는 `formState.isSubmitting`으로 `disabled`.
- [INV] 모든 input에 `name` 속성 (FormData/native submission 호환).
- [INV] File upload: server-side size + MIME 재검증, content-sniffing 방어.
- [INV] 다단계 form은 URL state 또는 server-persisted draft (refresh 손실 방지).
- [VER] `<form>` 내부에 `name` 없는 input grep.
- [VER] Submit handler `e.preventDefault()` 누락 (action 없는 form).
- [ANTI] 모든 input controlled로 `useState` 분리 (불필요 re-render — react-hook-form 권장).

## 10. 에러 / Suspense 경계

- [INV] Route segment마다 `error.tsx` + `loading.tsx` (Next App Router).
- [INV] Suspense fallback은 layout shift 최소화 (skeleton size = 최종 size).
- [INV] Error boundary는 telemetry (Sentry `captureException`) 호출 후 retry 옵션 제공.
- [INV] `use()` Promise는 항상 상위 Suspense + ErrorBoundary 필요 ([react.dev/reference/react/use](https://react.dev/reference/react/use)).
- [VER] App tree에 최소 1개 root ErrorBoundary 확인.
- [ANTI] `try/catch`로 `use()` 감싸기 (ErrorBoundary가 정답).

## 11. i18n / 로케일

- [INV] Locale 라우팅 — `app/[locale]/...` 또는 middleware redirect. 기본 locale 명시.
- [INV] 모든 사용자 노출 string은 `t()` (하드코딩 금지). 숫자/날짜는 `Intl.*` 또는 formatjs.
- [INV] RTL 지원: `dir={locale.dir}` + `logical CSS properties` (`margin-inline-start`).
- [VER] `>[A-Z][a-z]+<` 같은 raw English 텍스트 grep in JSX.
- [VER] `new Date().toLocaleString()` without locale arg.

## 12. SEO / Meta

- [INV] Next App Router: route segment의 `generateMetadata` 사용. React 19에서는 `<title>`, `<meta>` JSX로도 가능.
- [INV] 모든 page에 unique `<title>`, `<meta name="description">`, canonical.
- [INV] OG/Twitter card 누락 금지 (sharing thumbnail).
- [INV] `robots.txt`, `sitemap.xml` 자동 생성 (`next-sitemap` 또는 Next built-in).
- [INV] JSON-LD structured data는 server-rendered (CSR 후 추가 금지).
- [VER] Lighthouse SEO 점수 ≥ 90.
- [ANTI] CSR로 `document.title` 변경하여 SEO title 시도.

## 13. 이미지 / 미디어

- [INV] `<img>` 직접 사용 금지 — `next/image`, `unpic`, 또는 `<picture srcset>` ([nextjs.org/docs/app/api-reference/components/image](https://nextjs.org/docs/app/api-reference/components/image)).
- [INV] LCP 후보 이미지에 `priority` / `fetchpriority="high"`.
- [INV] `width`/`height` 또는 `fill` + 부모 `aspect-ratio` 필수.
- [INV] `sizes` 명시 (responsive image).
- [INV] AVIF → WebP → JPEG fallback.
- [VER] grep `<img ` (next/image 미사용) in Next 코드베이스.
- [VER] 이미지 alt 누락 axe rule.
- [ANTI] `priority` 남용 (모든 이미지에) — preload contention.

## 14. 보안 (Web)

- [INV] Strict CSP — `script-src 'nonce-{R}' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` ([developer.mozilla.org/CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)).
- [INV] `'unsafe-inline'`, `'unsafe-eval'` 금지. CSS는 nonce 또는 hash.
- [INV] `Trusted Types` 활성 — `require-trusted-types-for 'script'`.
- [INV] `dangerouslySetInnerHTML`은 DOMPurify (또는 trusted-types policy) 통과 후만.
- [INV] `target="_blank"` 외부 링크는 `rel="noopener noreferrer"`.
- [INV] `postMessage`는 `targetOrigin` 명시 (절대 `"*"` 금지), 수신 시 `event.origin` allowlist 검증 ([developer.mozilla.org/postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)).
- [INV] iframe `sandbox` 기본, 신뢰 origin만 화이트리스트.
- [INV] 응답 헤더: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `COOP: same-origin`, `COEP: require-corp` (SharedArrayBuffer 필요시).
- [VER] grep `dangerouslySetInnerHTML` → 모두 sanitizer 경유 확인.
- [VER] grep `target="_blank"` without `rel="noopener"`.
- [VER] grep `postMessage(.*,\s*['"]\*['"]`.
- [VER] CSP 헤더 응답 lint (production).
- [ANTI] `eval`, `new Function`, `setTimeout(string)`.

## 15. Electron 보안 (13+ 체크리스트)

[electronjs.org/docs/latest/tutorial/security](https://www.electronjs.org/docs/latest/tutorial/security)

- [INV] BrowserWindow `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`.
- [INV] HTTPS only — http 리소스 로딩 금지.
- [INV] Preload script로 IPC bridge 노출 (`contextBridge.exposeInMainWorld`), raw `ipcRenderer` 노출 금지.
- [INV] IPC handler: sender frame origin 검증 (`event.senderFrame.url`), 메시지 schema validate (Zod).
- [INV] CSP renderer에 강제 (`session.webRequest.onHeadersReceived` 또는 meta).
- [INV] `will-navigate`, `setWindowOpenHandler`로 navigation/popup allowlist.
- [INV] `shell.openExternal(url)`은 URL scheme/host allowlist 통과 후만.
- [INV] `<webview>` 비활성화 또는 `allowpopups` 제거 + nodeIntegration off.
- [INV] Auto-updater 서명 검증 (electron-updater + code signing).
- [INV] ASAR integrity check 활성 (Electron fuses).
- [INV] Production에서 DevTools 게이트 (`globalShortcut` 또는 빌드 플래그).
- [INV] 최신 stable Electron (보안 patch lag ≤ 1 minor).
- [VER] `@electron/lint-roller` + `electronegativity` CI scan.
- [VER] grep `nodeIntegration: true` / `contextIsolation: false`.
- [ANTI] Preload에서 `require('fs')` 결과를 그대로 window에 노출.

## 16. 테스팅

- [INV] 컴포넌트 unit = React Testing Library + Vitest. Test query 우선순위: `getByRole` > `getByLabelText` > `getByText` > `getByTestId`.
- [INV] E2E = Playwright. API mock은 MSW (browser + node 동일 핸들러).
- [INV] 모든 페이지 Playwright a11y smoke (`@axe-core/playwright`).
- [INV] Visual regression — 디자인 시스템 컴포넌트는 Chromatic/Percy 또는 Playwright snapshot.
- [INV] 비결정적 selector (`.css-xyz123`) 금지 — `data-testid` 또는 role 기반.
- [VER] `getByTestId` 비율 모니터링 (낮을수록 좋음).
- [VER] flaky test rate < 1%.
- [ANTI] `waitFor(() => setTimeout)` — `waitFor` + assertion.

## 17. 빌드 / 번들

- [INV] Vite/Turbopack — `import.meta.env.*` (Vite) 또는 `process.env.NEXT_PUBLIC_*` (Next)만 client 노출.
- [INV] Route-level code split + critical route preload (`<link rel="modulepreload">`).
- [INV] `package.json` `"sideEffects": false` 또는 명시적 list (tree-shaking).
- [INV] Dynamic import는 named chunk (`/* webpackChunkName */`) + retry wrapper.
- [INV] Bundle budget gate (`size-limit`) — PR fail on regression.
- [VER] `console.log` strip production (babel/swc plugin).
- [VER] source map upload to Sentry (production만 클라이언트 노출 X).
- [ANTI] `import * as _ from 'lodash'` — `lodash-es` named imports.

## 18. TypeScript

- [INV] `tsconfig` strict 패밀리 전부 on: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`.
- [INV] `any` 금지 (`@typescript-eslint/no-explicit-any`). 모르면 `unknown`.
- [INV] `as` 단언 최소화 — `satisfies` 우선 ([typescript-eslint.io](https://typescript-eslint.io/rules/)).
- [INV] Discriminated union + exhaustive `switch` — `default: assertNever(x)`.
- [INV] ID 타입은 branded (`type UserId = string & { __brand: 'UserId' }`).
- [INV] React event type 명시 (`React.MouseEvent<HTMLButtonElement>`).
- [VER] `typescript-eslint` `switch-exhaustiveness-check`, `no-unsafe-*` 룰.
- [VER] `tsc --noEmit` CI gate, `--incremental`로 캐시.
- [ANTI] `// @ts-ignore` — `@ts-expect-error` + 이유 주석.

## 19. 개발자 경험 / 로깅

- [INV] Production에서 `console.*` 자동 strip 또는 wrapper logger.
- [INV] React DevTools / Query DevTools dev only.
- [INV] Source map은 Sentry/Datadog 업로드 후 public path에서 제거.
- [VER] grep `console.log` in src (lint warn).

## 20. Observability

- [INV] Sentry/Datadog RUM — Web Vitals (`web-vitals` lib) → analytics 자동 송신.
- [INV] PII redaction — email, phone, auth token은 breadcrumb/request body에서 mask.
- [INV] `performance.mark` + `measure`로 핵심 user flow 계측.
- [INV] User session replay는 form input mask 기본.
- [VER] Sentry init이 layout root에 있는지.
- [VER] `Sentry.setUser({ email })` PII pattern grep.
- [ANTI] 로그에 JWT 전체 토큰.

## 21. 반응형 / 디바이스

- [INV] Mobile-first breakpoint (`min-width`). Tailwind `sm`/`md`/`lg`.
- [INV] Touch target ≥ 44×44 CSS px (Apple HIG/WCAG 2.5.5).
- [INV] Container query (`@container`) 사용 — 컴포넌트가 viewport보다 container에 반응.
- [INV] iOS safe area: `env(safe-area-inset-*)` + `viewport-fit=cover`.
- [INV] `100vh` 대신 `100dvh` (mobile address bar).
- [INV] `prefers-reduced-motion`, `prefers-contrast`, `prefers-reduced-data` 모두 대응.
- [VER] grep `100vh` (대신 `100dvh`/`100svh`).

## 22. IME / 양방향 입력

- [INV] 한/일/중 IME — `compositionstart`/`compositionend` 동안 Enter key submit 차단.
- [INV] Search/autocomplete debounce 후 composition state 확인.
- [VER] `onKeyDown="Enter"` 핸들러가 `e.nativeEvent.isComposing` 체크하는지 grep.
- [ANTI] `onChange`로 Enter 감지 (composing 중에도 fire).

## 23. React 19 신기능 룰

- [INV] `use(promise)`: 컴포넌트/훅 안에서만, 이벤트 핸들러 금지. Promise는 상위에서 생성 (cache or RSC).
- [INV] `useActionState` — error/pending state는 form action에서 일급으로 처리.
- [INV] `useFormStatus` — submit button을 form 자손으로 (form 자기 자신에서는 동작 안 함).
- [INV] `useOptimistic` — async action 시작 직후 set, 실패 시 자동 rollback.
- [INV] `<Activity mode="hidden">` — 탭/모달 state 보존, 비디오는 effect cleanup으로 pause.
- [INV] Ref callback cleanup function 활용 (React 19+).
- [VER] `forwardRef` import 검출.
- [VER] `<Context.Provider>` (React 19+에서는 `<Context>` 권장).

## 24. Next.js 신기능 룰 (16.x Cache Components)

[nextjs.org/docs/app/getting-started/caching-and-revalidating](https://nextjs.org/docs/app/getting-started/caching-and-revalidating)

- [INV] `cacheComponents: true` 기본. 모든 dynamic API(`cookies`, `headers`, `searchParams`, `connection`) 접근부는 `<Suspense>` 또는 `'use cache'`.
- [INV] `'use cache'` 함수 인자는 serializable. 비결정적 값은 캐시 밖에서 추출 후 prop으로 전달.
- [INV] `cacheLife('hours' | 'days' | ...)` 명시 — 기본값 신뢰 금지.
- [INV] `cacheTag(...)` 부여 + 변이 시 `updateTag(...)` / `revalidateTag(...)`.
- [INV] Server Action 끝에 `revalidateTag`/`revalidatePath` 또는 `updateTag` 호출.
- [INV] `after(() => ...)`로 응답 후 비동기 작업 (analytics 등).
- [VER] `'use cache'` 함수에서 `Date.now()`, `Math.random()` grep.
- [VER] `Uncached data was accessed outside of <Suspense>` build error 0.
- [ANTI] runtime API 컴포넌트를 `'use cache'`로 감싸기.

## 25. Streaming / Suspense 패턴

- [INV] Waterfall 방지 — sibling fetch는 `Promise.all` 또는 RSC parallel.
- [INV] Suspense boundary는 "로딩 중 부분만 노출되어도 의미있는" 지점에.
- [INV] `<SuspenseList revealOrder>` (React 19+ canary)로 순차 노출 제어.
- [INV] `startTransition`으로 navigation/tab switch 래핑 — pending state는 isPending으로.
- [INV] Skeleton fallback은 실제 컨텐츠와 동일 dimension (CLS 0).
- [ANTI] `useEffect` 안 fetch가 Suspense 안에 있다 — Suspense는 동작 안 함 (use TanStack Query suspense or RSC).

---

# Top 15 상시 Invariant 후보 (전체 코드 작성에 영향)

| # | 룰 | 영향 |
|---|---|---|
| 1 | Server state ↔ Client state 분리 (TanStack Query / RSC vs Zustand) | 상태 관리 전반 |
| 2 | RSC default + `"use client"` leaf 경계 | Bundle size, FCP |
| 3 | `'use cache'` + `<Suspense>` 강제 (Next 16) | 빌드 통과 |
| 4 | React Compiler 활성 → `useMemo`/`useCallback` 금지 (escape hatch만) | 코드 크기, 정확성 |
| 5 | TypeScript strict + `satisfies` + branded + exhaustive switch | 런타임 안정성 |
| 6 | First Rule of ARIA — semantic HTML 우선 | a11y 전반 |
| 7 | 색/spacing literal 금지, 디자인 토큰만 | 디자인 일관성, dark mode |
| 8 | CSP strict (nonce + strict-dynamic + Trusted Types) | XSS 차단 |
| 9 | Electron 13개 보안 옵션 default-on | 데스크탑 RCE 차단 |
| 10 | `next/image` + width/height + priority on LCP | LCP/CLS |
| 11 | postMessage origin allowlist 검증 | iframe XSS |
| 12 | Form은 Conform(서버액션) 또는 RHF+zod, 같은 schema | 검증 drift 차단 |
| 13 | queryKey 배열 + staleTime 명시 + invalidate on mutate | 데이터 신선도 |
| 14 | `target="_blank"` → `rel="noopener noreferrer"` | tab-nabbing |
| 15 | i18n `t()` 강제, raw string 금지 | 다국어, RTL 대응 |

# Top 20 On-Demand verify-* 스킬 후보

| # | 스킬 이름 안 | 검사 방식 | 출력 게이트 |
|---|---|---|---|
| 1 | `verify-web-vitals` | Lighthouse CI mobile | LCP/INP/CLS budget |
| 2 | `verify-a11y` | Playwright + axe-core | violations = 0 |
| 3 | `verify-bundle-budget` | size-limit | per-route 예산 |
| 4 | `verify-csp` | response header lint + meta scan | strict CSP 확인 |
| 5 | `verify-electron-security` | electronegativity | 보안 옵션 13개 |
| 6 | `verify-rsc-boundary` | grep `"use client"` + server-only imports | env 분리 |
| 7 | `verify-cache-tags` | AST: `'use cache'` 함수 ↔ `cacheTag`/`updateTag` 짝 | dangling tag 0 |
| 8 | `verify-image-component` | grep `<img ` + `loading="lazy"` on LCP | 0 직접 img |
| 9 | `verify-design-tokens` | grep hex/rgb literal in components | 0 hit |
| 10 | `verify-forwardref-free` | grep `forwardRef(` | React 19 0 hit |
| 11 | `verify-memo-discipline` | grep `useMemo\|useCallback` 신규 추가 | compiler 활성 시 0 |
| 12 | `verify-postmessage` | grep `postMessage(.*,\s*"\*"` + origin check | 모두 origin 검증 |
| 13 | `verify-dangerously-set` | grep `dangerouslySetInnerHTML` → sanitizer chain | 모두 검증됨 |
| 14 | `verify-form-name-attrs` | AST: input within form has `name` | 누락 0 |
| 15 | `verify-i18n-strings` | AST: JSX raw English string | t() 미사용 0 |
| 16 | `verify-typescript-strict` | tsconfig strict family + `--noEmit` | error 0 |
| 17 | `verify-search-params-zod` | AST: `searchParams` 접근 시 zod validate 있는지 | 100% |
| 18 | `verify-suspense-coverage` | Next dev/build에서 "Uncached data" error 캐치 | 0 |
| 19 | `verify-react-19-migration` | `<Context.Provider>`, `forwardRef`, ref cleanup 등 | 마이그레이션 grade |
| 20 | `verify-source-map-leak` | 빌드 산출물에 `.map` public 노출 검사 | production 0 |

---

# 추가 발견 — 누락하기 쉬운 카테고리

리스트에서 빠뜨리기 쉬운 것을 추가:

- **26. View Transitions** — React 19 `<ViewTransition>`은 라우터 navigation에 wrapping, 같은 컴포넌트 ID는 globally unique, `prefers-reduced-motion` 존중 ([react.dev/reference/react/ViewTransition](https://react.dev/reference/react/ViewTransition)).
- **27. Hydration mismatch 방지** — `Date.now()`, `Math.random()`, locale-sensitive format을 SSR 직접 호출 금지. `useSyncExternalStore` 또는 `useEffect`.
- **28. Third-party script** — `next/script` `strategy` 명시 (`afterInteractive`/`lazyOnload`), 분석 스크립트는 consent 후만.
- **29. Cookies / Auth** — `HttpOnly`, `Secure`, `SameSite=Lax`(default) 또는 `Strict`, CSRF는 `SameSite` + token 이중방어.
- **30. Feature flag / experiment** — flag evaluation은 server-side (RSC) 우선, client-only flag는 hydration mismatch 위험.

---

# Sources

- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19)
- [React `use()` reference](https://react.dev/reference/react/use)
- [React `cache()` reference](https://react.dev/reference/react/cache)
- [React `<Activity>` reference](https://react.dev/reference/react/Activity)
- [React `<ViewTransition>` reference](https://react.dev/reference/react/ViewTransition)
- [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1)
- [Next.js Caching with Cache Components](https://nextjs.org/docs/app/getting-started/caching-and-revalidating)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js Image component](https://nextjs.org/docs/app/api-reference/components/image)
- [web.dev Web Vitals](https://web.dev/articles/vitals)
- [web.dev INP](https://web.dev/articles/inp)
- [web.dev LCP](https://web.dev/articles/lcp)
- [web.dev CLS](https://web.dev/articles/cls)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [MDN ARIA Roles](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles)
- [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [Tailwind v4 @theme](https://tailwindcss.com/docs/theme)
- [TanStack Query important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [typescript-eslint rules](https://typescript-eslint.io/rules/)
- [Conform documentation](https://conform.guide/)
- [Microsoft MSRC postMessage advisory (2025)](https://www.microsoft.com/en-us/msrc/blog/2025/08/postmessaged-and-compromised)
