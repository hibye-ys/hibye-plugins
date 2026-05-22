# frontend-react-web Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1/2 의 vercel-style 패턴을 그대로 적용해 *6 신규 skill* 작성 — `frontend-react-web` 의 마지막 두 영역 (**testing** / **observability**) 을 채워 8 영역 완성.

**Architecture:** Phase 1/2 의 16 skill 이 *template reference*. 각 신규 skill 도 동일 frontmatter (`priority` / `pathPatterns` / `bashPatterns` / `importPatterns` / `validate` / `retrieval` / `chainTo`) + 동일 본문 구조 (When to apply / 핵심 원칙 / 도구 위임 / 안티패턴 표 / 예시 / 참조). 본문 길이 ~180-260줄.

**Tech Stack:** Vitest + React Testing Library + user-event v14 + Playwright + MSW v2 + @axe-core/playwright. Sentry Browser SDK + web-vitals lib + react-error-boundary.

**참조:**
- Phase 1 plan v5: `docs/superpowers/plans/2026-05-22-frontend-react-web-phase-1.md`
- Phase 2 plan: `docs/superpowers/plans/2026-05-22-frontend-react-web-phase-2.md`
- Template skill (대표): `plugins/frontend-react-web/skills/semantic-a11y/SKILL.md` (214줄) + `plugins/frontend-react-web/skills/token-only-styling/SKILL.md` (208줄) + `plugins/frontend-react-web/skills/suspense-error-locality/SKILL.md` (246줄)
- CLAUDE.md (delegation matrix): `plugins/frontend-react-web/CLAUDE.md`
- vercel skill 패턴: `~/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/`

**범용 원칙 — 모든 신규 skill 에 적용:**
1. **vercel 스타일 본문 ~200-260줄**. backend 12단계 패턴 ✕. placeholder 어휘 ✕.
2. **validate 룰 = 도구 미커버 / IDE 즉시 표시 가치 가 큰 패턴만**. eslint-plugin-testing-library / eslint-plugin-playwright / @typescript-eslint 중복 금지. CLAUDE.md 의 delegation matrix 참고.
3. **chainTo 는 *실제로 존재하는* skill 만 참조**. dangling chain ✕.
4. **본문 구조 표준** = `# {skill-name}` + intro + `## When to apply` + `## 핵심 원칙` (N 개 numbered) + `## 도구 위임` + `## 안티패턴 표` + (선택) 예시 코드 블록 + `## 참조`
5. **frontmatter validate 정규식 검증** = 각 skill 의 Step "false positive smoke test" 필수
6. **commit 단위** = 1 skill = 1 commit. message = `feat(frontend-react-web): {skill-name} — {one-line summary}` + body + Co-Authored-By trailer

---

## File Structure (Phase 3 종료 후)

```
plugins/frontend-react-web/skills/
├── (Phase 1+2 의 16 skill — 생략)
├── rtl-query-priority/SKILL.md          (Batch 1)
├── playwright-msw-e2e/SKILL.md          (Batch 1)
├── test-doubles-discipline/SKILL.md     (Batch 1)
├── sentry-rum-pii/SKILL.md              (Batch 2)
├── web-vitals-transport/SKILL.md        (Batch 2)
└── error-boundary-telemetry/SKILL.md    (Batch 2)
```

22 SKILL.md 총 (16 기존 + 6 신규). 6 commit + catalog 갱신 commit.

---

## Batch 분할

| Batch | 주제 | Skill 수 | M-tier |
|---|---|---|---|
| 1 | testing (RTL / Playwright+MSW / mock 규율) | 3 | M1 |
| 2 | observability (Sentry / Web Vitals / Error Boundary 텔레메트리) | 3 | M2 |

---

## Skill 명세 (Task 1-6)

각 task 본문 = *frontmatter spec + 본문 outline + validate 정규식 + smoke test*. SKILL.md 전체 본문은 implementer 가 Phase 1/2 의 기존 skill 들을 *template* 으로 동일 패턴 적용.

---

### Batch 1 — Task 1-3 (M1 testing)

#### Task 1: rtl-query-priority

**Why**: React Testing Library 의 query 우선순위 (Testing Library Guiding Principles) — `getByRole` 가 1순위, 마지막은 `getByTestId`. 잘못 쓰면 a11y 회귀 + 깨지기 쉬운 테스트. user-event v14 (await 필수) 도 동일 영역.

**Frontmatter (key fields)**:
- `name: rtl-query-priority`
- `priority: 4`
- `pathPatterns`: `**/*.test.{ts,tsx,js,jsx}`, `**/*.spec.{ts,tsx,js,jsx}`, `**/__tests__/**/*.{ts,tsx,js,jsx}`
- `bashPatterns`: []
- `importPatterns`: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/dom`, `@testing-library/jest-dom`, `vitest`
- `validate` (3 룰):
  - `getByTestId\s*\(` 또는 `findByTestId\s*\(` 사용 — warn (testid 는 마지막 수단 — eslint-plugin-testing-library `prefer-presence-queries` 와 보완, IDE 즉시 가치)
  - `userEvent\.(?:click|type|keyboard|hover|tab)\s*\(` 가 `await\s+` 없이 — error (user-event v14 = async, await 필수)
  - `fireEvent\.(?:click|change|input)\s*\(` (user-event 미사용) — warn (`fireEvent` 보다 `userEvent` 권장)
- `retrieval.aliases`: `RTL`, `react testing library`, `getByRole`, `user-event`, `unit test`
- `retrieval.intents`: `write component test`, `query elements`, `simulate user interaction`
- `chainTo`: pattern `(?:render|screen)\s*\.[a-zA-Z]+\s*\([^)]*role` → semantic-a11y 본문 cross-reference (chainTo 형태로 별도 추가 ✕ — 본문 안내만)
- `docs`: Testing Library docs (about queries / guiding principles), user-event v14 migration, jest-dom matchers

**본문 outline**:
- ## When to apply: 컴포넌트 unit test 작성 / 기존 test 리팩토링 / a11y 회귀 검출 목적 테스트
- ## 핵심 원칙: (1) query priority — `getByRole` > `getByLabelText` > `getByPlaceholderText` > `getByText` > `getByDisplayValue` > `getByAltText` > `getByTitle` > `getByTestId` / (2) `getBy*` (예외) vs `queryBy*` (null OK) vs `findBy*` (await) 선택 / (3) `screen.*` 우선 (destructure 보다) / (4) user-event v14 = async — 모든 호출에 `await` / (5) jest-dom matchers (`toBeInTheDocument`, `toHaveAccessibleName`) 활용 / (6) test ID 는 *최후 수단* — 우선 role + name 조합
- ## query 결정 트리 코드 예시
- ## user-event v14 패턴 (setup + await)
- ## 안티패턴 표 (testid 남용 / fireEvent 직접 / sync user-event / container.querySelector 직접 / waitFor 안 act 경고)
- ## 도구 위임: `eslint-plugin-testing-library` (recommended) — `prefer-screen-queries` / `prefer-presence-queries` / `no-node-access` / `await-async-utils` 자동
- ## 참조: testing-library.com docs, kentcdodds.com common mistakes

#### Task 2: playwright-msw-e2e

**Why**: Playwright + MSW v2 = E2E + network handler 격리. axe-core smoke 도 본 skill 진입점. fixture 패턴 + Page Object Model (POM) 가벼운 안내.

**Frontmatter**:
- `name: playwright-msw-e2e`
- `priority: 4`
- `pathPatterns`: `e2e/**/*.{ts,js}`, `tests/e2e/**/*.{ts,js}`, `playwright/**/*.{ts,js}`, `**/*.e2e.{ts,js}`, `playwright.config.{ts,js,mjs,cjs}`
- `bashPatterns`: []
- `importPatterns`: `@playwright/test`, `msw`, `msw/node`, `msw/browser`, `@axe-core/playwright`
- `validate` (3 룰):
  - `test\s*\([^)]*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{[^}]*page\.click` (legacy non-locator API) — warn (Playwright locators 권장)
  - `page\.waitForTimeout\s*\(` 또는 `await\s+new\s+Promise\(.*setTimeout` — error (flaky — `expect.toBeVisible` 같은 web-first assertion 사용)
  - `\.locator\s*\(\s*['"`]#[\w-]+['"`]` (raw ID selector) 또는 `\.locator\s*\(\s*['"`]\.[\w-]+['"`]` (raw class selector) — warn (`getByRole` / `getByLabel` 권장)
- `retrieval.aliases`: `e2e`, `playwright`, `MSW`, `mock service worker`, `axe`, `integration test`
- `retrieval.intents`: `write e2e test`, `mock network`, `accessibility smoke`
- `chainTo`: pattern `@axe-core/playwright|injectAxe|new\s+AxeBuilder` → semantic-a11y 본문 cross-reference (axe 결과 해석)
- `docs`: Playwright best practices, MSW v2 docs, @axe-core/playwright README

**본문 outline**:
- ## When to apply: 신규 E2E spec / MSW handler 작성 / Playwright config 갱신 / a11y smoke 추가
- ## 핵심 원칙: (1) locator-first (CSS / xpath 직접 ✕, `getByRole` / `getByLabel` / `getByText`) / (2) web-first assertions (`expect(locator).toBeVisible()` 같은 auto-wait) / (3) `waitForTimeout` ✕ — explicit signal / (4) MSW handlers = test 단위 격리 (`server.use()` + `afterEach` cleanup) / (5) axe smoke 1회 / 주요 페이지 (`new AxeBuilder({ page }).analyze()`) / (6) trace + screenshot on retry (config) / (7) fixture 로 setup 공유
- ## Playwright + MSW v2 setup 예시 (msw/browser worker + Playwright route)
- ## axe-core smoke 예시
- ## 안티패턴 표 (waitForTimeout / raw CSS selector / global MSW handler / 미 cleanup)
- ## 도구 위임: `eslint-plugin-playwright`, MSW devtools, Playwright traceviewer
- ## 참조: playwright.dev, mswjs.io, dequelabs/axe-core-npm

#### Task 3: test-doubles-discipline

**Why**: vitest / jest mock 남용 = 테스트가 *implementation* 만 검증. 외부 boundary (network / time / random / storage) 만 mock — 내부 함수 mock ✕. Date / Math.random / fetch 같은 ambient API 안전한 대체.

**Frontmatter**:
- `name: test-doubles-discipline`
- `priority: 3`
- `pathPatterns`: `**/*.test.{ts,tsx,js,jsx}`, `**/*.spec.{ts,tsx,js,jsx}`, `vitest.config.{ts,js,mjs}`, `vitest.setup.{ts,js}`
- `bashPatterns`: []
- `importPatterns`: `vitest`, `jest`, `sinon`, `@vitest/spy`, `msw`
- `validate` (3 룰):
  - `vi\.mock\s*\(\s*['"`](?!.*\b(node:|fs|path|crypto|child_process|http|https|net|os|util|stream|events|dns|tls|cluster|worker_threads|next/|@sentry/)).*['"`]` — warn (internal module mock — eslint-plugin-vitest 미커버 영역. 외부 boundary 또는 framework 만 권장)
  - `jest\.mock\s*\(\s*['"`]` — warn (vitest 환경에서 jest API — `vi.mock` 통일)
  - `Math\.random\s*=\s*` 또는 `Date\.now\s*=\s*` (직접 글로벌 재할당) — error (`vi.useFakeTimers()` / `vi.spyOn(Math, 'random')` 사용)
- `retrieval.aliases`: `mock`, `spy`, `stub`, `vitest mock`, `fake timers`, `test isolation`
- `retrieval.intents`: `mock module`, `fake date`, `mock fetch`, `reset mocks`
- `chainTo`: [] (async-race-avoidance + server-vs-client-state 와 본문 cross-reference)
- `docs`: Vitest docs (mocking / fake timers), Kent C. Dodds "Common Testing Mistakes"

**본문 outline**:
- ## When to apply: vitest mock 사용 / Date / Math.random / fetch 대체 / MSW 사용 결정
- ## 핵심 원칙: (1) mock = boundary 만 (network → MSW / time → fake timers / random → spyOn / storage → mock implementation) / (2) 내부 모듈 mock ✕ — 의존성 주입 / re-export 패턴 / (3) `vi.useFakeTimers()` + `vi.setSystemTime()` for Date / (4) `vi.spyOn(global, 'fetch')` ✕ — MSW handler 권장 / (5) `beforeEach` 마다 mock reset (`vi.clearAllMocks` / `restoreAllMocks`) / (6) snapshot test 는 *결정적* 출력만 / (7) `vi.hoisted` 활용 (top-level mock factory 안 변수)
- ## fake timers + system time 예시
- ## fetch mock vs MSW 비교 예시
- ## 안티패턴 표 (Math.random 직접 재할당 / internal module mock / mock 미 reset / spy 후 restore 망각)
- ## 도구 위임: `eslint-plugin-vitest` (recommended), MSW for network boundary
- ## 참조: vitest.dev/api, mswjs.io, testing trophy

---

### Batch 2 — Task 4-6 (M2 observability)

#### Task 4: sentry-rum-pii

**Why**: Sentry Browser SDK 초기화 + `beforeSend` PII redaction + sourcemap upload + Session Replay 의 PII masking. 잘못 두면 사용자 입력 / 토큰 / 이메일 leak.

**Frontmatter**:
- `name: sentry-rum-pii`
- `priority: 4`
- `pathPatterns`: `src/**/*.{ts,tsx,js,jsx}`, `app/**/*.{ts,tsx,js,jsx}`, `**/sentry.client.config.{ts,js}`, `**/sentry.server.config.{ts,js}`, `**/instrumentation*.{ts,js}`, `next.config.{js,ts,mjs,cjs}`
- `bashPatterns`: []
- `importPatterns`: `@sentry/browser`, `@sentry/react`, `@sentry/nextjs`, `@sentry/remix`, `@sentry/electron`
- `validate` (4 룰):
  - `Sentry\.init\s*\([^)]*\bdsn:\s*['"`][^'"`]+['"`]` — warn (DSN literal — env var 권장, IDE 즉시 표시)
  - `Sentry\.init\s*\([^)]*\)` 가 있지만 `beforeSend` / `sendDefaultPii` / `maskAllText` 중 어느 것도 없음 — warn (heuristic, PII 정책 부재)
  - `sendDefaultPii\s*:\s*true` — error (의도된 거면 명시 disable 후 적용, 본 plugin 은 default block)
  - `replaysSessionSampleRate\s*:\s*1(\.0)?\b` (모든 세션 replay) — warn (cost + PII)
- `retrieval.aliases`: `sentry`, `RUM`, `error tracking`, `PII`, `sourcemap`
- `retrieval.intents`: `setup sentry`, `redact PII`, `session replay`, `upload sourcemaps`
- `chainTo`: pattern `<ErrorBoundary|errorElement=|ErrorBoundary>` → error-boundary-telemetry skill (Batch 2 후반 task — chainTo 본문에 추가)
- `docs`: Sentry Browser SDK, Sentry PII docs, Session Replay privacy, Next.js Sentry integration

**본문 outline**:
- ## When to apply: 신규 Sentry 통합 / sentry.client.config 작성 / Session Replay 활성화 / production sourcemap 설정
- ## 핵심 원칙: (1) DSN = env var (`process.env.NEXT_PUBLIC_SENTRY_DSN`) / (2) `sendDefaultPii: false` (default — IP / cookies / headers 차단) / (3) `beforeSend` 안 사용자 입력 sanitize / (4) Session Replay = `maskAllText: true` + `blockAllMedia: true` + 의도된 unmask 만 selector / (5) `tracesSampleRate` + `replaysSessionSampleRate` ≤ 0.1 production / (6) sourcemap upload (release / dist) — `@sentry/nextjs` `withSentryConfig` 또는 sentry-cli / (7) `tunnel: '/api/sentry-tunnel'` 로 ad-blocker bypass 옵션 / (8) Electron — `@sentry/electron/main` + `@sentry/electron/renderer` 분리
- ## sentry.client.config.ts 예시 (PII-safe)
- ## beforeSend redaction 예시 (이메일 / token 마스킹)
- ## 안티패턴 표 (DSN 하드코딩 / sendDefaultPii: true / replay 100% / sourcemap public / window.onerror 중복)
- ## 도구 위임: Sentry dashboard alert rules, `@sentry/cli`, ESLint custom rule (`no-process-env-leak`)
- ## 참조: docs.sentry.io (PII / sourcemap / Session Replay)

#### Task 5: web-vitals-transport

**Why**: web-vitals lib + `sendBeacon` (unload 안전) + Server Timing header. Lighthouse 는 *lab* 데이터 — RUM (real user monitoring) 이 본 skill 범위.

**Frontmatter**:
- `name: web-vitals-transport`
- `priority: 3`
- `pathPatterns`: `src/**/*.{ts,tsx,js,jsx}`, `app/**/*.{ts,tsx,js,jsx}`, `**/analytics/**/*.{ts,js}`, `**/instrumentation*.{ts,js}`
- `bashPatterns`: []
- `importPatterns`: `web-vitals`, `web-vitals/attribution`, `@vercel/analytics`, `@vercel/speed-insights`
- `validate` (2 룰):
  - `import\s*\{[^}]*\b(onCLS|onINP|onLCP|onFID|onTTFB|onFCP)\b[^}]*\}\s*from\s*['"`]web-vitals` 가 있는 파일에 `(?:navigator\.sendBeacon|fetch.*keepalive)` 모두 없음 — warn (delivery 신뢰성 문제 — `sendBeacon` 또는 `fetch({keepalive: true})` 권장)
  - `addEventListener\s*\(\s*['"`]beforeunload['"`]` 에서 metric 전송 — warn (`visibilitychange` + `pagehide` 권장)
- `retrieval.aliases`: `web vitals`, `LCP`, `INP`, `CLS`, `RUM`, `core web vitals`, `sendBeacon`
- `retrieval.intents`: `measure web vitals`, `send metrics`, `RUM transport`, `report performance`
- `chainTo`: [] (vercel:react-best-practices 가 budget 영역 cover — 본 skill 은 transport 만)
- `docs`: web.dev Core Web Vitals, web-vitals lib README, MDN sendBeacon

**본문 outline**:
- ## When to apply: RUM 메트릭 전송 구현 / Vercel Speed Insights 또는 자체 analytics endpoint 통합
- ## 핵심 원칙: (1) web-vitals lib 사용 — `onCLS` / `onINP` / `onLCP` / `onTTFB` / `onFCP` / (2) transport = `navigator.sendBeacon` 1순위, `fetch({keepalive: true})` fallback / (3) `beforeunload` ✕ — `visibilitychange` + `pagehide` 안전 / (4) batch send (queue + flush) production / (5) attribution build (`web-vitals/attribution`) 으로 root cause 식별 / (6) Server Timing header 도 활용 (server-side latency) / (7) Vercel Speed Insights / `@vercel/analytics` 위임 가능
- ## web-vitals + sendBeacon 패턴 예시
- ## visibilitychange / pagehide listener 패턴
- ## attribution 패턴 (LCP element 식별)
- ## 안티패턴 표 (beforeunload 사용 / fetch 동기 / metric 누락 / sample rate 미설정)
- ## 도구 위임: Vercel:react-best-practices (budget 룰), Lighthouse CI (lab), Chrome UX Report (CrUX)
- ## 참조: web.dev/articles/vitals, github.com/GoogleChrome/web-vitals

#### Task 6: error-boundary-telemetry

**Why**: React `ErrorBoundary` + `componentDidCatch` (또는 `react-error-boundary` 의 `onError`) → Sentry / 자체 텔레메트리 전송. 그러나 fallback UI 도 *접근 가능* + reset 가능 해야.

**Frontmatter**:
- `name: error-boundary-telemetry`
- `priority: 4`
- `pathPatterns`: `src/**/*.{tsx,jsx}`, `app/**/*.{tsx,jsx}`, `components/**/*.{tsx,jsx}`
- `bashPatterns`: []
- `importPatterns`: `react`, `react-error-boundary`, `@sentry/react`, `@sentry/nextjs`
- `validate` (3 룰):
  - `class\s+\w+\s+extends\s+(?:React\.)?Component[^}]*?componentDidCatch\s*\(` 가 있지만 `console\.error` 또는 telemetry 호출 없음 — warn (silent swallow)
  - `<ErrorBoundary\b[^>]*>` 또는 `<Sentry\.ErrorBoundary\b[^>]*>` 에 `fallback=` / `FallbackComponent=` / `fallbackRender=` 어느 것도 없음 — error
  - `componentDidCatch\s*\([^)]*\)\s*\{[^}]*\}` 안 try/catch 없이 `throw` 또는 `Promise.reject` — warn (boundary 안 또 throw → 위로 전파)
- `retrieval.aliases`: `error boundary`, `componentDidCatch`, `react-error-boundary`, `Sentry ErrorBoundary`
- `retrieval.intents`: `catch react error`, `error fallback UI`, `report error to sentry`, `reset error boundary`
- `chainTo`: pattern `Sentry\.|@sentry/` → sentry-rum-pii skill (이미 Batch 2 Task 4 — chainTo 가능)
- `docs`: React docs (Component / componentDidCatch), react-error-boundary README, Sentry ErrorBoundary docs

**본문 outline**:
- ## When to apply: 신규 ErrorBoundary 작성 / suspense-error-locality 와 페어 / 텔레메트리 통합
- ## 핵심 원칙: (1) `react-error-boundary` 권장 (function component + hooks) / (2) fallback UI 접근 가능 (`role="alert"` + 안내 + 재시도 버튼) / (3) `onError` → Sentry / 자체 telemetry (sanitize PII before send) / (4) `resetKeys` 또는 `useErrorBoundary().resetBoundary()` 으로 reset / (5) granularity = 의미 있는 UI 단위 (route / panel 단위 — 전체 app ✕) / (6) Suspense + ErrorBoundary 페어 (suspense-error-locality cross-ref) / (7) Next.js App Router `error.tsx` 는 client-side ErrorBoundary 의 자동 형태
- ## react-error-boundary 패턴 예시 (onError + Sentry.captureException)
- ## fallback UI 접근성 예시 (`role="alert"` + 재시도)
- ## Sentry.ErrorBoundary 통합 예시
- ## 안티패턴 표 (silent swallow / fallback 미지정 / boundary 안 또 throw / reset 미제공 / PII 미마스킹 후 capture)
- ## 도구 위임: Sentry dashboard issue grouping, React DevTools error tracking
- ## 참조: react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary, github.com/bvaughn/react-error-boundary

---

## Implementation flow (subagent-driven, batch 별)

각 batch:

1. **Batch dispatch** — batch 안 3 task sequential. 각 task 별:
   - implementer 디스패치 (plan 본문 = task 의 frontmatter spec + 본문 outline + Phase 1/2 template reference)
   - implementer 가 SKILL.md *전체 본문* 작성 (Phase 1/2 의 skill 본문 패턴 따라 ~200-260줄)
   - spec + quality combined review 1번 (또는 Phase 2 처럼 batch 끝 cumulative review 로 합쳐도 OK)
   - commit 1개
2. **Batch 끝 cumulative review + catalog cleanup** — batch 안 새 skill 들의 정합성 + chainTo 일관성 + `plugins/frontend-react-web/CLAUDE.md` 의 `@./skills/...` 목록 갱신 commit
3. **다음 batch**
4. **Phase 3 종료 후 최종 commit** — CLAUDE.md 의 Phase 3 종료 멘트 + Skill 카탈로그 머리말 갱신 (`Phase 3 완료 — 22 skill (M1 13 + M2 6 + M3 1)` 같이) + sentry-rum-pii ↔ error-boundary-telemetry 의 chainTo 양방향 검증

---

## Cross-skill chainTo / cross-reference 갱신 (batch 끝 별도 commit)

- **Batch 1 끝**:
  - `semantic-a11y` 본문 안 "도구 위임" 섹션에 RTL/Playwright 진입점 cross-reference 1줄 (선택)
  - `async-race-avoidance` 본문 안 cross-reference (test 안 race 회피 = `test-doubles-discipline` 의 fake timers 패턴)
- **Batch 2 끝**:
  - `error-boundary-telemetry` ↔ `suspense-error-locality` 본문 cross-reference (이미 Phase 2 suspense-error-locality 의 본문에서 ErrorBoundary 언급 — Phase 3 commit 으로 정본 link 추가)
  - `error-boundary-telemetry` → `sentry-rum-pii` chainTo 검증
- **Phase 3 종료 commit**:
  - `plugins/frontend-react-web/CLAUDE.md` 의 Skill 카탈로그 머리말 갱신 (`Phase 3 완료 — 22 skill (M1 13 + M2 6 + M3 1). 8 영역 모두 cover.`)
  - 6 신규 skill 의 `@./skills/...` import 추가
  - 기성품 도구 진입점 표 안 testing / observability 행 갱신 (testing-library / Playwright / Sentry / web-vitals 도구 위임 명시)

---

## Self-Review (plan v1 — Phase 3)

**Phase 1/2 패턴 일관성:**
- ✓ 6 skill 모두 vercel-style frontmatter + ~200-260줄 본문
- ✓ chainTo 는 *실제로 만들 skill* 만 참조 (Phase 1/2 의 기존 skill + Phase 3 안 신규 skill)
- ✓ validate 룰 = eslint-plugin-testing-library / eslint-plugin-playwright / eslint-plugin-vitest 미커버 영역만
- ✓ backend 모방 ✕

**Cross-skill chainTo 갱신:**
- error-boundary-telemetry → sentry-rum-pii (Task 6 commit 시점에 frontmatter 안)
- semantic-a11y → playwright-msw-e2e (axe smoke 진입점 — 본문 안내, chainTo 까지는 ✕)
- suspense-error-locality → error-boundary-telemetry (본문 cross-reference, chainTo 갱신 별도 commit 선택)

**Out-of-scope (Phase 4+):**
- visual regression (Percy / Chromatic) — Phase 4 후보
- contract testing (Pact / OpenAPI) — Phase 4
- bundle / lighthouse-ci 자동화 — vercel:react-best-practices 가 cover
- a11y-extended (color-contrast / focus-order playwright addon) — Phase 4

**Risk:**
- 6 skill × 220 줄 ≈ 1320 줄 SKILL.md — Phase 2 (14 skill) 보다 작음. context risk 낮음
- validate 정규식 false positive — 각 task 별 smoke test 필수 (특히 `vi.mock` allowlist regex / `getByTestId` 검출)
- chainTo forward reference 위험 ↓ — Batch 2 안 sentry-rum-pii 가 error-boundary-telemetry 보다 먼저 작성 (Task 4 → Task 6 순). error-boundary-telemetry 안 chainTo 는 *이미 존재하는* sentry-rum-pii 참조 — safe.
