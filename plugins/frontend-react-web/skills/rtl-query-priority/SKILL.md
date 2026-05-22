---
name: rtl-query-priority
description: React Testing Library query 우선순위 (getByRole > getByLabelText > getByText > ... > getByTestId) 강제 + user-event v14 async/await 규약. RTL / user-event / vitest / jest 테스트 파일 작성·리뷰 시 자동 트리거. eslint-plugin-testing-library 의 즉시 표시 보완.
metadata:
  priority: 4
  docs:
    - "https://testing-library.com/docs/queries/about/#priority"
    - "https://testing-library.com/docs/guiding-principles"
    - "https://testing-library.com/docs/user-event/intro"
    - "https://github.com/testing-library/jest-dom"
  pathPatterns:
    - '**/*.test.ts'
    - '**/*.test.tsx'
    - '**/*.test.js'
    - '**/*.test.jsx'
    - '**/*.spec.ts'
    - '**/*.spec.tsx'
    - '**/*.spec.js'
    - '**/*.spec.jsx'
    - '**/__tests__/**/*.ts'
    - '**/__tests__/**/*.tsx'
    - '**/__tests__/**/*.js'
    - '**/__tests__/**/*.jsx'
  bashPatterns: []
  importPatterns:
    - '@testing-library/react'
    - '@testing-library/user-event'
    - '@testing-library/dom'
    - '@testing-library/jest-dom'
    - 'vitest'
validate:
  - pattern: '(?:get|find|query)(?:All)?ByTestId\s*\('
    message: 'getByTestId / findByTestId 사용 — query priority 최하위. getByRole + name 조합 또는 getByLabelText 우선. (eslint-plugin-testing-library/prefer-presence-queries 와 부분 보완, IDE 즉시 표시 가치로 유지)'
    severity: warn
  - pattern: '(?<!await\s)(?<!await\s{2})(?<!await\s{3})userEvent\.(?:click|type|keyboard|hover|tab|clear|selectOptions|upload|pointer)\s*\('
    message: 'user-event v14 — 모든 인터랙션은 async. await userEvent.xxx(...) 형태로. (sync 호출 시 React act 경고 / state 미반영). (eslint-plugin-testing-library/await-async-events 와 중첩 — IDE 즉시 표시 가치로 유지, v14 migration 흔한 사고)'
    severity: error
  - pattern: '\bfireEvent\.(?:click|change|input|submit|keyDown|keyUp|focus|blur)\s*\('
    message: 'fireEvent 직접 호출 — userEvent (v14, async) 권장. fireEvent 는 user-event 미커버 케이스 (custom event dispatch / scroll) 에만. (eslint-plugin-testing-library recommended preset 미커버 — 본 plugin 유일)'
    severity: warn
retrieval:
  aliases:
    - RTL
    - react testing library
    - getByRole
    - user-event
    - unit test
    - testing-library
  intents:
    - write component test
    - query elements
    - simulate user interaction
    - assert accessible name
    - choose query method
  entities:
    - getByRole
    - getByLabelText
    - getByTestId
    - userEvent
    - fireEvent
    - screen
    - waitFor
chainTo: []
---

# rtl-query-priority

**RTL 의 핵심 = 사용자 관점 query.** `getByRole` + accessible name 우선, `getByTestId` 는 최후 수단. user-event v14 = 모든 interaction async. 본 skill 은 *priority 결정 트리 + async 규약 + 안티패턴 표* . 깊은 정적 검증은 `eslint-plugin-testing-library` (recommended preset) 위임.

## When to apply

- 새 컴포넌트 test 작성 (Vitest / Jest + RTL)
- 기존 test 리팩토링 (testid 남용 / sync user-event)
- a11y regression 발견 시 — accessible name 으로 query 작성하면 자동 a11y smoke
- user-event v13 → v14 마이그레이션 (sync → async)
- mock 결정 — MSW (HTTP) vs vi.mock (module) vs 의존성 주입

## 핵심 원칙

### 1. Query priority (8 단계)

testing-library.com 의 공식 priority — *사용자가 element 를 찾는 방식* 과 일치하는 순서:

1. **`getByRole`** + `name` — 거의 모든 interactive element (button / link / input / heading 등) 의 1순위. screen reader 와 동일 경로.
2. **`getByLabelText`** — form field 의 label 연결 (semantic-a11y 와 직결).
3. **`getByPlaceholderText`** — label 없는 input (단 placeholder 만으로 label ✕ — semantic-a11y 참고).
4. **`getByText`** — non-interactive content (`<p>` / `<span>` / `<li>`).
5. **`getByDisplayValue`** — form 안 현재 값 (수정 중 input / select).
6. **`getByAltText`** — `<img>` / `<area>` / `<input type="image">`.
7. **`getByTitle`** — `<title>` SVG / element title attribute.
8. **`getByTestId`** — *최후 수단*. text 가 i18n 변동되거나 role 없는 wrapper 만.

### 2. `getBy*` vs `queryBy*` vs `findBy*`

- **`getBy*`** = element 존재 보장 (없으면 throw). default assertion 용.
- **`queryBy*`** = null 반환 가능. *not-exist* 검증 (`expect(queryByText('Error')).toBeNull()`) 전용.
- **`findBy*`** = async (Promise). element 가 *나타날 때까지 기다림* (default timeout 1s). 비동기 UI 검증.

> *getBy* 로 not-exist assert ✕ — throw 됨. `queryBy*` 사용. async appearance → `findBy*` (waitFor + getBy 보다 간결).

### 3. `screen.*` 우선 (destructure 비추천)

- `screen.getByRole(...)` ✓ — query scope 명확 + autocomplete 일관.
- `const { getByRole } = render(...)` 후 `getByRole(...)` 도 동작하지만 — 코드 일관성 깨짐.
- *예외* = `within(element).getByRole(...)` — 특정 sub-tree 안 query (table row / list item 등).

### 4. user-event v14 = async + `setup()` 패턴

```ts
import userEvent from '@testing-library/user-event'

test('clicks button', async () => {
  const user = userEvent.setup()  // 매 test 마다 fresh setup
  render(<Form />)
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(screen.getByText('저장됨')).toBeInTheDocument()
})
```

- v13 (sync) → v14 (async) — *모든 인터랙션* `await` 의무.
- sync 호출 시 React `act()` 경고 + state 갱신 미반영 — flaky test 의 흔한 원인.
- `userEvent.setup()` 은 매 test 마다 (clipboard / timer state 격리).

### 5. jest-dom matcher 우선

- `expect(el).toBeInTheDocument()` > `expect(el).toBeTruthy()` (의미 명확)
- `toHaveAccessibleName(...)` > `toHaveAttribute('aria-label', ...)` (a11y 일관)
- `toBeDisabled()` / `toBeChecked()` / `toHaveValue(...)` / `toHaveFocus()`
- vanilla `expect(...).toBe(...)` 보다 *test failure message* 가 풍부.

### 6. test-id 는 최후 수단

- text 가 i18n / 빈번한 카피 변경 → testid 정당화 가능
- 그 외 90% 케이스 = `getByRole` + `name` 가능
- `data-testid="submit-button"` 보다 `<button>저장</button>` + `getByRole('button', { name: '저장' })` 가 *동시에 a11y smoke* 효과.

## query 결정 트리 + 코드 예시

```
어떤 element 찾기?
├─ interactive (button / link / input / heading / dialog)?
│   └─ YES → getByRole + { name: '...' }
├─ form field?
│   └─ YES → getByLabelText (또는 getByRole + name)
├─ 일반 텍스트 (paragraph / span)?
│   └─ YES → getByText
├─ image?
│   └─ YES → getByAltText
└─ 위 모두 불가 (role 없는 wrapper, i18n 빈번)?
    └─ getByTestId (최후)
```

```tsx
// ✕ testid 남용
const submitBtn = screen.getByTestId('submit-btn')
const emailInput = screen.getByTestId('email-input')

// ✓ role + accessible name (a11y 검증 효과 동반)
const submitBtn = screen.getByRole('button', { name: '저장' })
const emailInput = screen.getByLabelText('이메일')
```

## user-event v14 패턴

```tsx
// ✕ sync 호출 (v13 잔존)
test('login flow', () => {
  render(<LoginForm />)
  userEvent.type(screen.getByLabelText('이메일'), 'a@b.com')  // await 누락
  userEvent.click(screen.getByRole('button', { name: '로그인' }))
  expect(screen.getByText('환영합니다')).toBeInTheDocument()  // flaky
})

// ✓ v14 async + setup
test('login flow', async () => {
  const user = userEvent.setup()
  render(<LoginForm />)
  await user.type(screen.getByLabelText('이메일'), 'a@b.com')
  await user.click(screen.getByRole('button', { name: '로그인' }))
  expect(await screen.findByText('환영합니다')).toBeInTheDocument()
})
```

> v13 → v14 migration: 모든 `userEvent.xxx(...)` 앞에 `await` + 함수 시작에 `const user = userEvent.setup()`.

## 안티패턴 표 (검출 경로 명시)

| 안티 | 교정 | 검출 |
|---|---|---|
| `getByTestId('submit-btn')` (role 가능) | `getByRole('button', { name: '저장' })` | **validate (warn)** |
| `userEvent.click(btn)` (await 누락) | `await user.click(btn)` | **validate (error)** |
| `fireEvent.click(btn)` | `await user.click(btn)` (userEvent v14) | **validate (warn)** |
| `getByText('Error')` 로 not-exist assert | `queryByText('Error')` + `toBeNull()` | eslint-plugin-testing-library/prefer-presence-queries |
| `waitFor(() => getByText(...))` (1초 polling) | `await findByText(...)` (간결) | eslint-plugin-testing-library/prefer-find-by |
| `container.querySelector('.submit')` | `getByRole` + name | eslint-plugin-testing-library/no-container, no-node-access |
| `render` 결과 destructure (`const { getByRole } = render(...)`) | `screen.getByRole(...)` | eslint-plugin-testing-library/prefer-screen-queries |
| `findBy*` 결과를 `await` 안 함 (`const el = findByText(...)`) | `const el = await findByText(...)` | eslint-plugin-testing-library/await-async-queries |
| `expect(el).toBeTruthy()` (존재 검증) | `expect(el).toBeInTheDocument()` | jest-dom matcher 권장 |
| `expect(el.getAttribute('aria-label')).toBe('...')` | `expect(el).toHaveAccessibleName('...')` | 수동 / jest-dom |
| `userEvent.setup()` 호출 안 함 (v14) | `const user = userEvent.setup()` | 수동 |
| 매 test 마다 같은 setup 반복 | `beforeEach` + helper 함수 | 수동 |

## 도구 위임 (이 skill 의 진입점 역할)

- **정적 (recommended)**: `eslint-plugin-testing-library` `recommended` preset — 27+ 룰. 본 plugin validate 는 *3 패턴* 보완:
  - `prefer-screen-queries` → destructure 검출 (본 plugin validate ✕)
  - `prefer-presence-queries` → getBy / queryBy 잘못된 짝 검출 (본 plugin testid warn 과 *부분 중첩*)
  - `prefer-find-by` → `waitFor(() => getBy(...))` 패턴 검출 (본 plugin validate ✕)
  - `no-container` / `no-node-access` → container.querySelector / DOM API 직접 사용 검출 (본 plugin validate ✕)
  - `await-async-queries` → `findBy*` 결과 await 누락 검출 (본 plugin userEvent error 와 *다른 영역*)
  - `await-async-utils` → `waitFor` / `waitForElementToBeRemoved` await 누락
  - `no-debugging-utils` → CI 에 남은 `screen.debug()` / `logRoles()` 검출
- **본 plugin validate 가 추가하는 영역**:
  - `getByTestId` / `findByTestId` 사용 즉시 표시 (IDE 가치 — prefer-presence-queries 가 *부분* 만 커버)
  - `userEvent.xxx(...)` await 누락 검출 (v14 마이그레이션 즉시 표시)
  - `fireEvent.xxx(...)` 직접 호출 warn (user-event 우선 가이드)
- **a11y 효과**: `getByRole` + `name` 작성 자체가 a11y smoke 보완 (semantic-a11y 와 cross-ref). axe 가 잡지 못하는 *accessible name 누락* 도 test 작성 단계에서 자동 드러남.
- **async 디테일**: `async-race-avoidance` skill 의 cleanup 패턴이 useEffect test 작성 시 직접 적용 (AbortController / ignore flag).
- **mock 위임**: `test-doubles-discipline` skill — MSW (HTTP) / vi.mock (module) / 의존성 주입 결정.

## 참조

- [Testing Library — Queries Priority](https://testing-library.com/docs/queries/about/#priority)
- [Testing Library — Guiding Principles](https://testing-library.com/docs/guiding-principles)
- [user-event v14 docs](https://testing-library.com/docs/user-event/intro) · [v13 → v14 migration](https://testing-library.com/docs/user-event/setup)
- [jest-dom matchers](https://github.com/testing-library/jest-dom) — `toBeInTheDocument` / `toHaveAccessibleName` 등 50+ matcher
- [eslint-plugin-testing-library — rules](https://github.com/testing-library/eslint-plugin-testing-library/tree/main/docs/rules)
- [Kent C. Dodds — Common mistakes with RTL](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Vitest](https://vitest.dev/) · [Jest](https://jestjs.io/) — test runner
