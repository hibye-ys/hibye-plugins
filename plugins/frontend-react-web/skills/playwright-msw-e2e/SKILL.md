---
name: playwright-msw-e2e
description: Playwright E2E + MSW v2 handler 격리 + @axe-core/playwright smoke. locator-first (getByRole / getByLabel — raw CSS / xpath ✕) + web-first assertion + waitForTimeout 금지 패턴. playwright spec / playwright.config / e2e/ 디렉토리 작성 시 자동 트리거.
metadata:
  priority: 4
  docs:
    - "https://playwright.dev/docs/best-practices"
    - "https://playwright.dev/docs/locators"
    - "https://mswjs.io/docs/integrations/browser"
    - "https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright"
  pathPatterns:
    - 'e2e/**/*.ts'
    - 'e2e/**/*.js'
    - 'tests/e2e/**/*.ts'
    - 'tests/e2e/**/*.js'
    - 'playwright/**/*.ts'
    - 'playwright/**/*.js'
    - '**/*.e2e.ts'
    - '**/*.e2e.js'
    - 'playwright.config.ts'
    - 'playwright.config.js'
    - 'playwright.config.mjs'
    - 'playwright.config.cjs'
  bashPatterns: []
  importPatterns:
    - '@playwright/test'
    - 'msw'
    - 'msw/node'
    - 'msw/browser'
    - '@axe-core/playwright'
validate:
  - pattern: '(?:page|locator)\.waitForTimeout\s*\(|new\s+Promise\s*\(\s*(?:res|resolve)\s*=>\s*setTimeout\s*\('
    message: 'waitForTimeout / setTimeout sleep — flaky. expect(locator).toBeVisible() 같은 web-first auto-wait assertion 사용. (eslint-plugin-playwright/no-wait-for-timeout 와 보완, IDE 즉시 표시 가치)'
    severity: error
  - pattern: '\.locator\s*\(\s*[`''"](?:#|\.)[\w-]+[`''"]'
    message: 'raw CSS selector (#id / .class) — i18n / refactor 깨짐 + a11y 회귀 미검출. getByRole / getByLabel / getByText 권장. (eslint-plugin-playwright/no-raw-locators 와 중첩 — IDE 즉시 표시 가치로 유지)'
    severity: warn
  - pattern: 'page\.(?:click|fill|type|press|hover|check|uncheck|selectOption)\s*\(\s*[`''"]'
    message: 'legacy page.click(selector) — locator API 권장. await page.getByRole("button", { name: "..." }).click(). (auto-wait + retry 자동). (eslint-plugin-playwright/prefer-locator 와 중첩 — IDE 즉시 표시 가치로 유지)'
    severity: warn
retrieval:
  aliases:
    - playwright
    - e2e
    - end-to-end
    - MSW
    - mock service worker
    - axe
    - integration test
  intents:
    - write e2e test
    - mock network response
    - run accessibility smoke
    - configure playwright
    - isolate test handlers
  entities:
    - test
    - expect
    - locator
    - getByRole
    - server.use
    - AxeBuilder
chainTo: []
---

# playwright-msw-e2e

**E2E = testing trophy 의 상층.** Playwright + MSW v2 + @axe-core/playwright 조합으로 *locator-first* / *web-first assertion* / *network 격리* / *a11y smoke* 4박자 일관. 본 skill 은 *원칙 + setup 패턴 + 안티패턴 + 도구 진입점*. 깊은 정적 검증은 `eslint-plugin-playwright` (`recommended` preset, 15+ 룰) 위임.

## When to apply

- 새 E2E spec 작성 (`e2e/**` / `*.e2e.ts`)
- `playwright.config.ts` 신규 / 옵션 변경
- MSW handler 추가 — spec 별 격리 결정
- @axe-core/playwright 로 a11y smoke 통합
- `test.extend()` fixture (auth / seededData) 작성
- CI workflow 안 Playwright 추가 (trace / artifact 업로드)
- 기존 spec 의 `waitForTimeout` / raw CSS / legacy `page.click(selector)` 리팩토링

## 핵심 원칙

### 1. Locator-first — getByRole / getByLabel / getByText

- `page.getByRole('button', { name: '저장' })` 1순위 — screen reader 와 동일 경로 + a11y smoke 효과 동반 (semantic-a11y / rtl-query-priority 와 동일 철학)
- form field → `page.getByLabel('이메일')`
- non-interactive content → `page.getByText('환영합니다')`
- raw CSS (`page.locator('#submit')` / `.btn-primary`) ✕ — i18n / refactor 시 깨짐 + a11y 회귀 미검출
- `getByTestId` 는 *최후 수단* — text 가 i18n 빈번 또는 role 없는 wrapper 만

### 2. Web-first assertion = auto-wait

- `await expect(locator).toBeVisible()` / `toHaveText('...')` / `toBeEnabled()` — Playwright 의 *auto-retry* 가 자동 polling
- 절대 manual `while` polling ✕ — flaky
- *expect.poll* 도 framework-supported (custom assertion 필요할 때만)
- `actionTimeout` / `expect.timeout` config 로 일관 조정

### 3. `waitForTimeout` ✕ — explicit signal 사용

- `page.waitForTimeout(1000)` = magic sleep = flaky (CI 느릴 때 fail)
- 대안 = explicit signal:
  - `await page.waitForResponse(url)` — 네트워크 응답 기다림
  - `await expect(locator).toHaveText('완료')` — DOM 상태 기다림
  - `await expect(locator).toBeEnabled()` — interaction 가능까지
  - `await page.waitForURL('/dashboard')` — route change
- 본 plugin validate 가 error 로 즉시 표시 (eslint-plugin-playwright `no-wait-for-timeout` 와 보완)

### 4. MSW v2 handler 격리 — `server.use()` + `resetHandlers`

- *spec 별* override = `server.use(http.get('/api/...', handler))`
- `afterEach(() => server.resetHandlers())` 의무 — cross-spec leak 방지
- *Node fixture* (Playwright worker 안 MSW) = `msw/node` `setupServer()`
- *Browser worker* (실제 페이지 안 MSW worker) = `msw/browser` `setupWorker()` — `global-setup.ts` 에서 시작
- 둘 차이: Node = test 의 fetch 가로채기 / Browser = 페이지 안 fetch 가로채기. 보통 *Browser* 권장 (실제 페이지 동작 검증).

### 5. axe-core smoke — main route 진입점

- `new AxeBuilder({ page }).analyze()` — 1회 main route smoke
- `violations.length === 0` assert (또는 known-violations whitelist)
- *full a11y audit* 은 별도 (수동 SR + keyboard 통과). smoke = 회귀 catch.
- `.withTags(['wcag2a', 'wcag2aa'])` 로 WCAG level 필터

### 6. Trace + screenshot on retry — `playwright.config.ts`

- `use: { trace: 'on-first-retry', screenshot: 'only-on-failure', video: 'retain-on-failure' }`
- CI 실패 시 artifact 자동 업로드 → `npx playwright show-trace` 로 재현
- 모든 test 에 항상 trace ✕ (slow + 디스크 소비) — *retry / failure 만*

### 7. Fixture 로 setup 공유 — `test.extend()`

- `test.extend<{ auth: AuthFixture }>({ auth: async ({ page }, use) => { ... await use(authedPage) } })`
- POM (Page Object Model) 은 *가벼움* — 거대한 PageObject 클래스 ✕, fixture + 작은 helper 함수 권장
- shared state (DB seed / login session) = `storageState` + `globalSetup` 활용

## Playwright + MSW v2 setup 예시

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

```ts
// e2e/login.spec.ts — MSW + locator-first
import { test, expect } from '@playwright/test'
import { http, HttpResponse } from 'msw'
import { server } from './msw-server'  // setupServer() 인스턴스

test.afterEach(() => server.resetHandlers())

test('로그인 성공 시 dashboard 로 이동', async ({ page }) => {
  server.use(
    http.post('/api/login', () =>
      HttpResponse.json({ token: 'fake', user: { id: 'u1', name: 'Alice' } }),
    ),
  )

  await page.goto('/login')
  await page.getByLabel('이메일').fill('a@b.com')
  await page.getByLabel('비밀번호').fill('pw')
  await page.getByRole('button', { name: '로그인' }).click()

  await expect(page).toHaveURL('/dashboard')
  await expect(page.getByRole('heading', { name: 'Alice 의 대시보드' })).toBeVisible()
})
```

## axe-core smoke 패턴

```ts
// e2e/a11y-smoke.spec.ts
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('홈 페이지 a11y smoke (WCAG 2 AA)', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(results.violations).toEqual([])
})
```

violation 발생 시 — Playwright HTML report 안 *axe report* 가 inline 표시. `--reporter=html` 후 `npx playwright show-report` 로 재현.

## 안티패턴 표 (검출 경로 명시)

| 안티 | 교정 | 검출 |
|---|---|---|
| `await page.waitForTimeout(1000)` | `await expect(locator).toBeVisible()` / `waitForResponse` | **validate (error)** + eslint-plugin-playwright/no-wait-for-timeout |
| `new Promise(resolve => setTimeout(resolve, 100))` (test 안) | web-first assertion | **validate (error)** |
| `page.locator('#submit-button')` | `page.getByRole('button', { name: '저장' })` | **validate (warn)** |
| `page.locator('.btn-primary')` | role + name 또는 getByLabel | **validate (warn)** |
| `await page.click('#submit')` (legacy) | `await page.getByRole('button').click()` (locator API) | **validate (warn)** |
| MSW global handler — `afterEach(resetHandlers)` 누락 | `test.afterEach(() => server.resetHandlers())` | 수동 (cross-spec leak) |
| `test.beforeAll` 안 server.use (전체 worker 오염) | `test.beforeEach` 또는 spec 안 `server.use` | 수동 |
| `screenshot: 'on'` 모든 test (CI artifact 폭증) | `'only-on-failure'` | 수동 |
| `actionTimeout` 무이유 늘리기 (`60_000`) | 원인 (loading state / animation) 해결 후 default | 수동 |
| `locator` 변수 재사용 — DOM mutation 후 stale | `page.getByRole(...)` 매번 호출 (lazy) | 수동 (race) |
| `test.only` / `test.skip` CI commit | `eslint-plugin-playwright/no-focused-test` + no-skipped-test | eslint-plugin-playwright |
| `expect(await locator.textContent()).toBe(...)` (수동 read) | `expect(locator).toHaveText(...)` (auto-wait) | eslint-plugin-playwright/prefer-web-first-assertions |

## 도구 위임 (이 skill 의 진입점 역할)

- **정적 (recommended, 15+ 룰)**: `eslint-plugin-playwright` `recommended` preset — `no-wait-for-timeout` / `no-focused-test` / `no-skipped-test` / `no-conditional-in-test` / `prefer-web-first-assertions` / `expect-expect` / `valid-expect` / `no-element-handle` / `prefer-to-be` 등. 본 plugin validate 는 *3 패턴* 보완:
  - `prefer-web-first-assertions` → 수동 `expect(await .textContent()).toBe(...)` 검출 (본 plugin validate ✕)
  - `no-element-handle` → `$$` / `$` legacy ElementHandle 사용 검출 (본 plugin validate ✕)
  - `no-wait-for-timeout` → `waitForTimeout` 검출 (본 plugin error 와 *중첩* — IDE 즉시 표시 가치로 유지)
  - `no-focused-test` / `no-skipped-test` → `.only` / `.skip` 검출
- **본 plugin validate 가 추가하는 영역**:
  - `waitForTimeout` / `new Promise(setTimeout)` 즉시 error (sleep 패턴 광범위 검출)
  - raw CSS selector (`page.locator('#id')` / `.class`) warn — i18n / a11y 회귀 가시화
  - legacy `page.click(selector)` 등 9 API warn — locator API 마이그레이션 가이드
- **MSW devtools**: 브라우저 DevTools 안 MSW 패널 — handler match / mismatch 시각화
- **Playwright traceviewer**: `npx playwright show-trace trace.zip` — DOM snapshot + network + console + action timeline
- **a11y audit**: `@axe-core/playwright` 의 violations report — `incomplete` / `passes` 도 활용
- **chainTo 영역**:
  - **vercel:nextjs** — Playwright + Next.js 통합 (`webServer` config + App Router 라우팅)
  - **semantic-a11y** — axe violation 해석 (role / name / focus)
  - **rtl-query-priority** — 컴포넌트 단위 test (E2E 보다 가벼움, 같은 query 철학)
  - **test-doubles-discipline** — vitest `vi.mock` vs MSW vs 의존성 주입 결정 (unit 측 mock 규율)

## 참조

- [Playwright — Best Practices](https://playwright.dev/docs/best-practices) · [Locators](https://playwright.dev/docs/locators) · [Auto-waiting](https://playwright.dev/docs/actionability)
- [Playwright — Test fixtures](https://playwright.dev/docs/test-fixtures) · [Trace viewer](https://playwright.dev/docs/trace-viewer)
- [MSW v2 — Browser integration](https://mswjs.io/docs/integrations/browser) · [setupWorker](https://mswjs.io/docs/api/setup-worker) · [server.use](https://mswjs.io/docs/api/setup-server/use)
- [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright) — WCAG 2.x automatic audit
- [eslint-plugin-playwright — rules](https://github.com/playwright-community/eslint-plugin-playwright/tree/main/docs/rules)
- [web.dev — Accessibility testing](https://web.dev/articles/accessibility-testing)
