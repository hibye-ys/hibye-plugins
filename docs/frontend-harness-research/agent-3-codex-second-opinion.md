# Agent 3 — Codex Second Opinion (raw)

- **목적**: frontend agent harness 구상에 second opinion — 백엔드 harness 와 대비, granularity / 우선순위 / 빠뜨리기 쉬운 항목
- **subagent**: `codex:codex-rescue` (Codex CLI 위임)
- **수집일**: 2026-05-22
- **참고**: 이 문서는 sub-agent 의 raw output 을 정돈 없이 옮긴 원본

---

**Grounding sources** (Codex 가 인용한 공식 docs):

- [React 19](https://react.dev/blog/2024/12/05/react-19)
- [React hydration](https://react.dev/reference/react-dom/client/hydrateRoot)
- [Next Server/Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [React Router framework mode/actions](https://reactrouter.com/start/framework/actions)
- [Remix pending UI/accessibility/concurrency](https://remix.run/guides/optimistic-ui)
- [Core Web Vitals](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [WAI-ARIA button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
- [MDN CSP/Trusted Types](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Vite env](https://vite.dev/guide/env-and-mode/)

---

## Q1. Always-On Invariants (15개)

1. `semantic-a11y` — [universal] Prefer native semantics; custom roles must preserve label, focus, and keyboard behavior.
2. `focus-navigation` — [universal/FW] Route changes, modals, drawers, and async swaps must not lose or trap focus incorrectly.
3. `token-only-styling` — [universal] Colors, spacing, radius, typography, and motion come from tokens, not magic literals.
4. `hydration-determinism` — [SSR/FW] Server and first client render must match; no time/random/browser-only reads in render.
5. `client-boundary-minimalism` — [Next/RSC] Put `"use client"` at interactive leaves; keep props serializable and server code out.
6. `suspense-error-locality` — [FW] Loading and error boundaries live near data/route islands with stable fallback dimensions.
7. `async-race-avoidance` — [universal] Effects, fetches, listeners, and optimistic mutations must abort, ignore, or order stale work.
8. `input-state-contract` — [universal] Inputs choose controlled, uncontrolled, or framework form-action ownership and never switch.
9. `render-purity` — [universal] Render stays pure; DOM, storage, network, subscriptions, and mutation live outside render.
10. `ref-escape-hatch` — [universal] Refs are for DOM/transient values, not hidden UI state or stale callback shortcuts.
11. `web-vitals-budget` — [universal] LCP, INP, CLS, JS size, image sizing, and long tasks stay inside project budgets.
12. `security-dom-sinks` — [universal] Dangerous HTML, URLs, scripts, and style sinks require sanitizer/Trusted Types policy.
13. `electron-renderer-isolation` — [Electron] `contextIsolation`, sandboxing, no renderer Node access, narrow typed bridge only.
14. `framework-data-contract` — [Next/Remix/RR7] Route data uses loaders/actions/server components before ad hoc mount-effect fetching.
15. `observable-ui-failures` — [universal] Runtime, route, recoverable hydration, and boundary errors are captured and actionable.

---

## Q2. On-Demand Verify Skills (20개)

1. `verify-a11y-axe` — Playwright + axe; catches WCAG and ARIA regressions.
2. `verify-semantic-interactions` — ESLint/AST grep; catches clickable divs, fake buttons, missing keyboard paths.
3. `verify-focus-routing` — Playwright tab/nav/modal script; catches lost focus and bad traps.
4. `verify-hydration-determinism` — SSR run + console scan; catches React hydration mismatches.
5. `verify-use-client-boundary` — import-graph scan; catches bloated or misplaced Next client boundaries.
6. `verify-rsc-serialization` — TS/AST scan; catches functions/classes/non-serializable props into client components.
7. `verify-effect-races` — hooks lint + AbortController/ignore scan; catches stale async effects.
8. `verify-stale-closures` — hooks lint + interval/listener scan; catches captured state bugs.
9. `verify-form-state-contract` — lint/tests; catches controlled/uncontrolled switches and missing `onChange`.
10. `verify-suspense-error-boundaries` — route tree scan; catches missing `loading`/`error`/`ErrorBoundary`.
11. `verify-web-vitals-budget` — Lighthouse/web-vitals; catches LCP/INP/CLS budget failures.
12. `verify-bundle-budget` — Vite/Next analyzer; catches large chunks, duplicate deps, barrel imports.
13. `verify-layout-shift` — Playwright trace + image dimension scan; catches CLS sources.
14. `verify-image-media` — lint; catches missing `alt`, dimensions, priority/preload mistakes.
15. `verify-csp-trusted-types` — header + sink scan; catches weak CSP and unsafe DOM sinks.
16. `verify-secret-leak-client` — env/bundle grep; catches leaked `VITE_*`, public env, keys.
17. `verify-electron-isolation` — config grep; catches `nodeIntegration`, disabled sandbox/context isolation.
18. `verify-ipc-allowlist` — preload AST scan; catches raw `ipcRenderer` exposure and broad channels.
19. `verify-router-data-contract` — framework scan; catches route data fetched late in mount effects.
20. `verify-console-runtime-errors` — Playwright console/pageerror; catches redboxes and recoverable errors.

---

## Q3. Taxonomy (12 카테고리)

| Category | Count | Rationale |
|---|---:|---|
| lifecycle/rendering/React19 | 10 | render purity, effects, transitions, actions, refs |
| styling/tokens/layout | 8 | tokens, responsive layout, CLS, media |
| state/events/concurrency | 10 | ownership, stale closures, optimistic races |
| data-fetching/mutations | 9 | server state, loaders/actions, cache invalidation |
| routing/rendering frameworks | 10 | Next App Router, Remix/RR7, Vite SPA, Electron renderer |
| a11y | 10 | semantics, focus, keyboard, announcements, forms |
| performance/build-bundle | 12 | vitals, chunking, images, waterfalls |
| security-web | 8 | CSP, Trusted Types, secrets, XSS sinks |
| electron | 7 | preload, IPC, sandbox, navigation, permissions |
| forms | 7 | React 19 actions, validation, pending state |
| testing/observability | 9 | Playwright, axe, Lighthouse, error capture |
| TypeScript/contracts | 6 | props, env, generated route types, public APIs |

---

## Q4. Backend To Frontend Translation

Clean mappings: backend `agent-loop` becomes render/event loop discipline; `single-writer` becomes state ownership; lifecycle cleanup maps to effects/subscriptions; workers/runtime checks map to browser/SSR/Electron boundaries; forbidden scans map to DOM sinks, secrets, and unsafe IPC.

Frontend diverges because users create nondeterministic ordering: clicks, typing, navigation, cancellation, resize, hydration, and network races interleave with concurrent React. Frontend-only invariants must cover focus management, keyboard events, layout shift, and hydration mismatch.

```tsx
// Race: older request can overwrite newer UI.
useEffect(() => {
  fetch(`/api/search?q=${query}`)
    .then(r => r.json())
    .then(setResults);
}, [query]);

// Safer: abort stale work.
useEffect(() => {
  const ac = new AbortController();
  fetch(`/api/search?q=${query}`, { signal: ac.signal })
    .then(r => r.json())
    .then(setResults)
    .catch(e => { if (e.name !== "AbortError") throw e; });
  return () => ac.abort();
}, [query]);
```

---

## Q5. Granularity Framework

Keep one skill when the same reader, tool, and decision tree apply every time. Split when automation differs, framework specificity matters, or the checklist is rarely invoked. Mirror backend `agent-loop` plus `agent-loop-invariants`: keep a short always-on invariant, then split heavy verification.

For a11y: keep one always-on `semantic-a11y`; split five verifies: `verify-a11y-axe`, `verify-keyboard-focus`, `verify-aria-patterns`, `verify-form-labels-errors`, `verify-route-announcements`.

For state: keep one always-on `state-ownership`; split local UI state, URL state, server/cache state, external stores, and optimistic/concurrent mutations.

Rule of thumb: if invoked in over 30% of frontend tasks, keep it under 500 tokens always-on; if tool-heavy or over 800 tokens, make it on-demand.

---

## Q6. Never Skip

- Hydration mismatch debugging for SSR/RSC apps.
- Next RSC/client boundary misuse.
- Effect races, stale closures, and missing cleanup.
- Fake ARIA controls and missing keyboard behavior.
- Focus after route/modal/pending UI transitions.
- CLS from unreserved media, skeletons, fonts, and conditional UI.
- Misused `useMemo` hiding dependency or purity bugs.
- Form pending/optimistic races in React 19, Remix, and RR7.
- Electron isolation and IPC allowlists.

```tsx
// Highest-ROI static catch: fake button.
<div role="button" onClick={save}>Save</div>

// Prefer native semantics.
<button type="button" onClick={save}>Save</button>
```

---

## Priority Table (M1 / M2 / M3)

| Milestone | Always-on invariants | Verify skills |
|---|---|---|
| **M1 minimum** | `semantic-a11y`, `hydration-determinism`, `client-boundary-minimalism`, `async-race-avoidance`, `input-state-contract`, `web-vitals-budget`, `security-dom-sinks`, `electron-renderer-isolation` | `verify-a11y-axe`, `verify-semantic-interactions`, `verify-hydration-determinism`, `verify-use-client-boundary`, `verify-effect-races`, `verify-stale-closures`, `verify-form-state-contract`, `verify-web-vitals-budget`, `verify-csp-trusted-types`, `verify-electron-isolation`, `verify-console-runtime-errors` |
| **M2** | `focus-navigation`, `suspense-error-locality`, `framework-data-contract`, `observable-ui-failures` | `verify-focus-routing`, `verify-rsc-serialization`, `verify-suspense-error-boundaries`, `verify-layout-shift`, `verify-image-media`, `verify-router-data-contract`, `verify-secret-leak-client` |
| **M3** | `token-only-styling`, `render-purity`, `ref-escape-hatch` | `verify-bundle-budget`, `verify-ipc-allowlist` |
