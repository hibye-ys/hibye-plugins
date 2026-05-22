# frontend-react-web

React Web frontend harness. **vercel plugin (`claude-plugins-official:vercel`) 의 보완 layer.**

vercel 의 24 skill (특히 `react-best-practices` 64 룰 / `nextjs` / `next-cache-components`) 이 *성능 / Next App Router / Cache Components / 빌드* 영역을 깊게 cover. 본 plugin 은 vercel 이 안 다루는 *8개 영역* 에 집중:

- **a11y** — semantic HTML, focus, keyboard, ARIA pattern
- **보안 (web)** — CSP / Trusted Types / postMessage / dangerouslySetInnerHTML
- **Electron** — contextIsolation / nodeIntegration / IPC allowlist / sandbox
- **Form** — controlled / uncontrolled / form-action / Conform / RHF
- **디자인 토큰** — Tailwind v4 `@theme` / CSS variable / dark mode / 대비
- **테스팅** — RTL / Playwright / MSW / axe-core CI
- **TS strict** — `strict` + `noUncheckedIndexedAccess` + branded
- **observability** — Sentry RUM / PII redaction / Web Vitals 전송

## 스택 전제

React 19 + Vite SPA / Next App Router / Remix / RR7 framework mode / Electron 렌더러. TypeScript strict + Tailwind v4. 메타프레임워크 specific 디테일은 vercel skill 들이 cover.

## 사용 권장 조합

| 시나리오 | vercel install | 우리 plugin install |
|---|---|---|
| Next.js / Vercel deploy | ✓ (필수) | ✓ |
| Vite SPA / Electron 만 | (선택) | ✓ |
| React Native | — | ✕ (별도 `frontend-react-native` 예정) |

vercel 미install 시 — 성능 / Web Vitals / Next cache 룰 공백.

## 기성품 도구 진입점 + delegation 경계

**핵심 원칙**: 본 plugin 의 skill validate 룰은 *도구가 잡지 못하는 / IDE 즉시 표시 가치가 큰* 패턴만. 도구가 잡는 룰 재현 ✕.

| 영역 | 도구 (위임) | 도구가 잡는 룰 | 본 plugin skill 이 *추가* 하는 룰 |
|---|---|---|---|
| 정적 a11y | `eslint-plugin-jsx-a11y` `recommended` | alt-text / anchor-is-valid / aria-props / aria-role / click-events-have-key-events / interactive-supports-focus / label-has-associated-control / mouse-events-have-key-events / no-noninteractive-element-interactions / role-has-required-aria-props / tabindex-no-positive 등 *35 룰* | First Rule of ARIA 원칙 / Custom interactive 3종 (role+tabIndex+onKeyDown) 패턴 / 색만 상태 ✕ / CSS `*:focus { outline: none }` (jsx-a11y 미커버 — CSS 사이드) |
| 정적 TS / React 19 | `@typescript-eslint`, `tsc --noEmit`, `react/forwardref-deprecated` (ESLint react plugin) | strict 옵션 위반 / no-floating-promises / forwardRef deprecation warning 등 | `typescript-strict` / `react19-migration` (tsconfig 룰 + ref-as-prop / use() / Activity 패턴) |
| 동적 a11y | `@axe-core/playwright` | WCAG 2.x 자동 룰 | Playwright a11y smoke 진입점 + report 해석 (`playwright-msw-e2e` 안) |
| 성능 / Web Vitals | Lighthouse CI (lab) + vercel:react-best-practices (budget) | LCP / INP / CLS budget / bundle 등 | `web-vitals-transport` (sendBeacon / visibilitychange transport 만 — budget 은 vercel 위임) |
| 컴포넌트 테스트 | Vitest + React Testing Library + `eslint-plugin-testing-library` (27+ 룰) | screen / fireEvent / await-async-queries 등 자동 | `rtl-query-priority` (testid warn / userEvent v14 await / fireEvent warn) + `test-doubles-discipline` (boundary-only mock + fake timers + Math.random 글로벌 재할당 error) |
| E2E | Playwright + MSW + `eslint-plugin-playwright` (15+ 룰) | no-wait-for-timeout / no-focused-test / prefer-web-first-assertions 등 | `playwright-msw-e2e` (waitForTimeout error / raw CSS warn / legacy page.click warn + MSW handler 격리 + axe smoke) |
| 보안 헤더 | CSP middleware (helmet / next.config) | CSP header presence | `security-dom-sinks` (strict-dynamic / Trusted Types / nonce 패턴 + dangerouslySetInnerHTML / eval / postMessage "*") |
| Electron 보안 | `electronegativity` + `@electron/lint-roller` | 13 옵션 룰 자동 | `electron-renderer-isolation` (renderer-side 5 옵션 + IPC allowlist + nodeIntegration:true 검출) |
| 디자인 토큰 | custom ESLint rule (`no-tailwind-arbitrary-color`) | `bg-[#xxx]` 같은 arbitrary color | `token-only-styling` (@theme 토큰 only / 대비 / dark mode / 인라인 style 색 검출) |
| Observability | Sentry Browser SDK + `@sentry/cli` + Vercel Speed Insights | error tracking + sourcemap + Session Replay (sdk 측 정책) | `sentry-rum-pii` (DSN 하드코딩 warn / sendDefaultPii true error / Session Replay mask false error / replay sample ≥ 0.5 warn) + `error-boundary-telemetry` (fallback 미지정 error / componentDidCatch silent swallow warn / boundary 안 throw warn) |

**중복 금지 원칙**: 같은 패턴을 도구 *와* 본 plugin validate 가 둘 다 잡으면 — 본 plugin 에서 *제거*. 단 *CSS 사이드* (jsx-a11y 가 JSX 만 보므로 CSS file 안 패턴 미커버) 는 본 plugin 유일.

## Skill 카탈로그

> Phase 1 = semantic-a11y + token-only-styling (vercel-style 패턴 정립).
> Phase 2 = M1 a11y/보안/Electron/React 경계/async/form/suspense/TS strict + M2 UX 디테일 + M3 React 19 (14 skill).
> Phase 3 완료 — 22 skill (M1 13 + M2 6 + M3 1 + Phase 3 testing 3 + observability 3). **8 영역 모두 cover.**

@./skills/semantic-a11y/SKILL.md
@./skills/token-only-styling/SKILL.md
@./skills/a11y-dialog-pattern/SKILL.md
@./skills/security-dom-sinks/SKILL.md
@./skills/electron-renderer-isolation/SKILL.md
@./skills/client-boundary/SKILL.md
@./skills/render-purity/SKILL.md
@./skills/hydration-determinism/SKILL.md
@./skills/async-race-avoidance/SKILL.md
@./skills/input-state-contract/SKILL.md
@./skills/suspense-error-locality/SKILL.md
@./skills/typescript-strict/SKILL.md
@./skills/focus-navigation/SKILL.md
@./skills/server-vs-client-state/SKILL.md
@./skills/image-media-contract/SKILL.md
@./skills/react19-migration/SKILL.md
@./skills/rtl-query-priority/SKILL.md
@./skills/playwright-msw-e2e/SKILL.md
@./skills/test-doubles-discipline/SKILL.md
@./skills/sentry-rum-pii/SKILL.md
@./skills/web-vitals-transport/SKILL.md
@./skills/error-boundary-telemetry/SKILL.md

## 관련 자료

- 보고서: `docs/frontend-harness-research/synthesis-report.md` (v2)
- Phase 1 plan: `docs/superpowers/plans/2026-05-22-frontend-react-web-phase-1.md` (v5)
- Phase 2 plan: `docs/superpowers/plans/2026-05-22-frontend-react-web-phase-2.md`
- Phase 3 plan: `docs/superpowers/plans/2026-05-22-frontend-react-web-phase-3.md`
- vercel skill 패턴: `~/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/`
