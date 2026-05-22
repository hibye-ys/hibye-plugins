# Frontend Harness 구상 — 종합 보고서 (v2)

> ⚠ **plan v4 supersede 안내 (2026-05-22)**: 본 보고서의 §1 (backend 결구조) / §7 (12단계 본문, scripts/ 자동화, AGENTS.md auto-gen 명시) / §8 (forbidden-scan.sh) / §10.5 (scripts/ 자동화 미해결) 는 **`docs/superpowers/plans/2026-05-22-frontend-react-web-phase-1.md` (v4)** 에서 vercel 스타일로 대체 결정됨 — *backend 모방하지 않음*. Phase 2 작업자는 plan v4 를 정본으로 사용.

> `frontend-react-web` plugin 의 카테고리/룰/스킬을 정의하기 위한 리서치 종합.
> **v2 갱신**: vercel plugin (`claude-plugins-official:vercel` 0.43.0) 의 24 skill 발견 후, 우리 plugin 의 정체성을 *vercel 의 보완자* 로 재정의.

- **작성일**: 2026-05-22 (v1) · 갱신 2026-05-22 (v2)
- **스코프**: React 19 + 메타프레임워크 (Vite SPA / Next App Router / Remix / RR7 framework mode) + Electron 렌더러
- **out-of-scope**: React Native (별도 `frontend-react-native`)
- **확정 plugin 이름**: `frontend-react-web`
- **의존 모델**: **vercel plugin soft 권장** — install 시 강한 영역 위임, 우리는 빠진 영역 보완

## 0. Executive Summary (v2)

- 백엔드 plugin (`stack-backend-ts-hono`) 의 세 계층 (invariant / workflow / audit) 구조 유지 ⚠ **supersede (v4)** — vercel 스타일 frontmatter validate 통합 채택
- vercel plugin 의 24 skill 중 frontend 핵심 = `react-best-practices` (64 룰 × 8 카테고리, *모두 성능 위주*), `nextjs` (App Router 전반), `next-cache-components` (Next 16), `verification` (end-to-end dev 검증), `shadcn`, `routing-middleware`, `turbopack`, `env-vars` 등
- 우리 plugin = **vercel 의 보완 layer** — vercel 이 안 다루는 *a11y / 보안 (web) / Electron / Form / 디자인 토큰 / 테스팅 / TS strict / observability* 8개 영역에 집중
- 조정된 규모: 상시 invariant 13-14, on-demand verify 16-18, workflow 20-25 = **총 45-55 스킬** (백엔드 98 의 절반 — vercel 위임만큼 줄어듦)

## 1. 백엔드 결구조 (참조 모델)

`stack-backend-ts-hono` 분석 (Agent 1):

| Layer | 개수 | 노출 방식 |
|---|---|---|
| 상시 invariant | 18개 (6개 대분류 × 3) | `CLAUDE.md` 에 `@import` → fresh 세션마다 자동 로드 |
| workflow 스킬 | 39개 | on-demand, 사용자가 invoke |
| audit 스킬 | 21개 | `pair_invariant` 메타로 invariant 짝, pre-commit/CI grep |
| scripts/ | `audit-all.sh`, `forbidden-scan.sh`, `acceptance-check.sh`, `generate-agents-md.sh` | CI 자동화 |
| AGENTS.md | auto-gen | `@import` 전체 본문 인라인, Codex 등 다른 agent 용 |

**Skill 본문 12단계 패턴**: frontmatter → 어댑터 행 → 정체성 → when-to-invoke → 핵심 상수 → 알고리즘 → TS 예시 → cross-field 불변 → 금지 사항 → 모듈 구조 → placeholder → 변경 영향 매트릭스. ⚠ **supersede (v4)** — vercel 본문 ~200줄 패턴 채택

**Audit 스킬 3 계층 검증** (`audit-all.sh`): 문턱 grep → file-level awk scan → cross-file 수동. ⚠ **supersede (v4)** — scripts/ 자동화 미채택, frontmatter validate 통합

상세: `agent-1-backend-structure-analysis.md`

## 2. Vercel Plugin 의존 모델 (v2 신규)

### 2.1 vercel plugin 의 frontend 관련 skill 인벤토리

위치: `~/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/`

| skill | 깊이 | 영역 |
|---|---|---|
| `react-best-practices` | **64 룰 × 8 카테고리** (rules/ AGENTS.md upstream/ overlay.yaml) | 성능 (waterfall, bundle, server, client, re-render, rendering, JS perf, advanced) |
| `nextjs` | App Router 전반 + Pages Router → App Router 마이그레이션 강제 | RSC, Server Action, metadata API, middleware→proxy |
| `next-cache-components` | Next 16 전용 | `'use cache'`, cacheLife, cacheTag, updateTag |
| `verification` | dev server 시작 시 자동 트리거 | full-story end-to-end |
| `shadcn` | 컴포넌트 라이브러리 | shadcn/ui + Tailwind |
| `routing-middleware` | proxy.ts 마이그레이션 | Next 16 |
| `turbopack` | 빌드 | Next |
| `env-vars` | env 분리 | `VITE_*`, `NEXT_PUBLIC_*` |
| `next-forge`, `next-upgrade` | boilerplate / 업그레이드 | Next |
| `chat-sdk`, `ai-sdk` | AI 기능 (우리 frontend harness 와 직접 관련 없음) | — |

### 2.2 의존 방식: Soft 권장

- 우리 plugin 의 CLAUDE.md 에 *"vercel plugin install 권장"* 명시
- `plugin.json` 에 hard dependency 선언 ✕ — 사용자가 Vite-only / Next 안 쓰는 프로젝트는 vercel 안 깔아도 우리 plugin 독립 작동
- vercel 미install 시 일부 커버 공백 (성능/캐시 깊이) — CLAUDE.md 노트로 명시
- chainTo / cross-reference 로 vercel skill 트리거 안내 (§ 4.6 참고)

### 2.3 분담 매트릭스

| 영역 | vercel 강도 | 우리 plugin 역할 |
|---|---|---|
| **성능 / Web Vitals** | ◎◎◎ (64 룰) | **위임** — chainTo 만 |
| **데이터 / 캐시** | ◎◎ | 보완 (Vite SPA 용 TanStack Query) |
| **라우팅 / 렌더링** | ◎◎ | 보완 (Vite/Remix/RR7/Electron 렌더러) |
| **빌드 / 번들** | ◎ | 보완 (Vite 전용, source map leak, env 분리) |
| **React core** | △ (rerender 16 룰만) | 보완 (React 19 신기능, hydration, render-purity) |
| **상태 / 동시성** | △ (rerender 일부) | **신규** (server-vs-client-state, async-race-avoidance) |
| **에러 / Suspense** | △ (`async-suspense-boundaries` 1개) | 보완 (error.tsx, telemetry) |
| **a11y** | ✕ | **신규 풀세트** |
| **디자인 토큰** | ✕ (shadcn chainTo 만) | **신규 풀세트** |
| **Form** | ✕ | **신규 풀세트** |
| **보안 (web)** | ✕ | **신규 풀세트** |
| **Electron** | ✕ | **신규 풀세트** |
| **테스팅** | ✕ (verification 은 dev-server flow) | **신규 풀세트** |
| **TS / observability** | ✕ | **신규 풀세트** |

## 3. 종합 대분류 (14개) — vercel 커버 표시

| # | 카테고리 | vercel 커버 | 우리 예상 skill 수 |
|---|---|---|---|
| 1 | React core (rendering/effects/refs/React19) | △ 보완 | 5-6 |
| 2 | 상태 / 동시성 | △ 신규 | 5-6 |
| 3 | 데이터 / 캐시 | ◎◎ 위임 + 보완 | 2-3 |
| 4 | 라우팅 / 렌더링 모델 | ◎◎ 위임 + 보완 | 3-4 |
| 5 | 스타일링 / 디자인 토큰 | ✕ 신규 | 4-5 |
| 6 | 접근성 | ✕ 신규 | 6-8 |
| 7 | 성능 / Web Vitals | ◎◎◎ **위임** | 1 (bridge 만) |
| 8 | Form | ✕ 신규 | 4-5 |
| 9 | 에러 / Suspense 경계 | △ 보완 | 3 |
| 10 | 보안 (web) | ✕ 신규 | 5-6 |
| 11 | Electron | ✕ 신규 | 5-6 |
| 12 | 빌드 / 번들 | ◎ 보완 | 2-3 |
| 13 | 테스팅 | ✕ 신규 | 4 |
| 14 | TS / observability | ✕ 신규 | 4-5 |

**총 추정 53-65 스킬** — 백엔드 98 의 약 절반.

## 4. 우리 plugin 상시 invariant 후보 (14개)

vercel 위임 영역 (`web-vitals-budget`, `react-compiler-discipline`) 제거, vercel-bridge invariant 1개 신규.

| # | invariant | 카테고리 | vercel 와의 관계 |
|---|---|---|---|
| 1 | `client-boundary` — `"use client"` leaf only, server 코드 import ✕ | 라우팅/렌더링 | vercel:nextjs 가 hooks → use client warn, 우리는 boundary 본문 |
| 2 | `hydration-determinism` — SSR/RSC render 결정성 | React core | vercel:react-best-practices `rendering-hydration-*` 와 별개 |
| 3 | `server-vs-client-state` — server state 는 TanStack Query/RSC, client store ✕ | 상태 | 신규 |
| 4 | `async-race-avoidance` — AbortController/ignore flag | 상태/동시성 | 신규 |
| 5 | `input-state-contract` — controlled/uncontrolled/form-action 셋 중 하나 | Form | 신규 |
| 6 | `suspense-error-locality` — Suspense + ErrorBoundary 둘 다 | 에러/Suspense | vercel:react-best-practices `async-suspense-boundaries` 보완 |
| 7 | `semantic-a11y` — first rule of ARIA | a11y | 신규 |
| 8 | `focus-navigation` — route/modal 후 focus 손실 ✕ | a11y | 신규 |
| 9 | `token-only-styling` — `@theme` 토큰만, 색/spacing literal ✕ | 디자인 토큰 | 신규 |
| 10 | `image-media-contract` — `<img>` ✕, width/height/sizes, LCP priority | 성능 (보완) | vercel 이 안 다룬 디테일 |
| 11 | `security-dom-sinks` — dangerously/eval/postMessage("*") ✕, CSP strict | 보안 (web) | 신규 |
| 12 | `electron-renderer-isolation` — contextIsolation, sandbox, IPC allowlist | Electron | 신규 |
| 13 | `typescript-strict` — strict family + satisfies + branded + exhaustive | TS | 신규 |
| 14 | `render-purity` — render = 순수, side-effect 는 event/effect | React core | 신규 |
| **bridge** | `vercel-bridge` — vercel:react-best-practices 가 활성화 가정 + chainTo 노트 | 메타 | **vercel-only** |

**vercel 위임 (우리 invariant 에서 제거):**
- `web-vitals-budget` → vercel:react-best-practices 가 64 룰로 더 깊게 커버
- `react-compiler-discipline` → vercel 의 rerender 룰 + bundle 룰이 cover

## 5. 우리 plugin verify 스킬 후보 (18개)

| # | verify-* | pair invariant | vercel 와의 관계 |
|---|---|---|---|
| 1 | `verify-a11y-axe` | semantic-a11y | 신규 |
| 2 | `verify-semantic-interactions` | semantic-a11y | 신규 |
| 3 | `verify-focus-routing` | focus-navigation | 신규 |
| 4 | `verify-hydration-determinism` | hydration-determinism | 보완 |
| 5 | `verify-use-client-boundary` | client-boundary | 보완 |
| 6 | `verify-rsc-serialization` | client-boundary | 보완 |
| 7 | `verify-effect-races` | async-race-avoidance | 신규 |
| 8 | `verify-stale-closures` | async-race-avoidance | 신규 |
| 9 | `verify-form-state-contract` | input-state-contract | 신규 |
| 10 | `verify-suspense-error-boundaries` | suspense-error-locality | 보완 |
| 11 | `verify-image-component` | image-media-contract | 신규 (vercel 안 다룸) |
| 12 | `verify-design-tokens` | token-only-styling | 신규 |
| 13 | `verify-postmessage` | security-dom-sinks | 신규 |
| 14 | `verify-dangerously-set` | security-dom-sinks | 신규 |
| 15 | `verify-csp-trusted-types` | security-dom-sinks | 신규 |
| 16 | `verify-secret-leak-client` | (standalone) | 신규 |
| 17 | `verify-electron-isolation` | electron-renderer-isolation | 신규 |
| 18 | `verify-ipc-allowlist` | electron-renderer-isolation | 신규 |
| **bridge** | `verify-vercel-chain` | vercel-bridge | vercel:react-best-practices 가 chainTo 되어야 할 시점 검출 |

**vercel 위임 (우리 verify 에서 제거):**
- `verify-web-vitals` → Lighthouse CI 는 vercel:react-best-practices + verification skill 영역
- `verify-bundle-budget` → vercel:react-best-practices `bundle-*` 5 룰 영역
- `verify-forwardref-free`, `verify-memo-discipline` → vercel:react-best-practices `rerender-*` 16 룰 영역

## 6. M1 / M2 / M3 우선순위 (v2 — vercel 의존 반영)

| Milestone | 상시 invariant | verify-* 스킬 | 다루는 영역 |
|---|---|---|---|
| **M1 — 안 깨지게 (10+10)** | client-boundary, hydration-determinism, async-race-avoidance, input-state-contract, semantic-a11y, suspense-error-locality, security-dom-sinks, electron-renderer-isolation, typescript-strict, token-only-styling | verify-a11y-axe, verify-semantic-interactions, verify-hydration-determinism, verify-use-client-boundary, verify-effect-races, verify-form-state-contract, verify-csp-trusted-types, verify-electron-isolation, verify-design-tokens, verify-secret-leak-client | 우리만의 가치 코어 |
| **M2 — 사용성 (3+5)** | focus-navigation, server-vs-client-state, image-media-contract | verify-focus-routing, verify-rsc-serialization, verify-suspense-error-boundaries, verify-image-component, verify-postmessage, verify-dangerously-set | UX 디테일 |
| **M3 — 최신화 (1+3)** | render-purity (+ vercel-bridge) | verify-stale-closures, verify-ipc-allowlist, verify-vercel-chain | React 19 디테일 + vercel 통합 |

## 7. 우리 plugin 의 정체성 (v2 신규)

`frontend-react-web` 정의:

- **이름**: frontend-react-web
- **prefix**: `frontend-*` (backend `stack-backend-*` 와 대비, surface-* 폐기)
- **역할**: vercel plugin 보완자 — 빠진 8개 영역 깊게
- **vercel 와의 분담**: § 2.3 매트릭스
- **스택 전제**: React 19 + Vite/Next/Remix/RR7 + Electron 렌더러 (Chromium 기반)
- **out-of-scope**: React Native (별도 `frontend-react-native`), Vercel 플랫폼/배포 (vercel plugin), Pages Router (vercel:nextjs 가 마이그레이션 강제)
- **백엔드와의 결**: ⚠ **supersede (v4)** — vercel 스타일 채택 (frontmatter validate 통합 / scripts/ ✕ / AGENTS.md ✕ / 본문 ~200줄). backend 모방 ✕.
- **chainTo 메커니즘**: vercel skill 트리거가 필요한 시점, 우리 skill 본문에 `→ Run Skill(react-best-practices)` 형태 명시

## 8. Backend → Frontend 핵심 매핑

| Backend invariant | Frontend 대응 | 결정적 차이 |
|---|---|---|
| `single-writer` (DB 동시 쓰기) | `async-race-avoidance` + `input-state-contract` | 프론트는 *사용자 입력 + 네트워크* 가 race 소스 |
| `agent-loop-invariants` | `render-purity` + `client-boundary` | render = 순수, side-effect 는 event/effect |
| `sse-lifecycle` | `suspense-error-locality` + `focus-navigation` | streaming 중 focus/scroll/skeleton |
| `workers-compat` | `electron-renderer-isolation` + `client-boundary` | runtime 경계 강제 |
| `provider-retry-matrix` | TanStack Query / vercel:react-best-practices `client-swr-dedup` | 외부 의존 호출 안정화 |
| `token-budget-constants` | vercel:react-best-practices `bundle-*` 5 룰 (위임) | 우리는 invariant 안 만듦 |
| `forbidden-scan.sh` | ⚠ **supersede (v4)** — frontmatter validate 패턴으로 통합 | scripts/ 미채택 |

## 9. 두 LLM 시각 일치 / 갈린 부분 (v1 그대로)

### 일치 (높은 신뢰도)
- 상시 invariant 10개 (§4 의 1-10번 ✓✓)
- "빠뜨리지 마라" — focus management, hydration mismatch, effect race, "use client" boundary
- 보안 must-have — Electron isolation, CSP/Trusted Types
- M1 우선순위 결

### 갈린 부분
| 항목 | Codex | 웹 리서치 | v2 판단 |
|---|---|---|---|
| token-only-styling | M3 | M1 | **M1** — vercel 안 다룸, 우리만의 가치 |
| react-compiler-discipline | 미명시 | M1 강조 | **위임 (vercel)** — invariant 에서 제거 |
| a11y granularity | 1 invariant + 5 verify | 1 카테고리 한 덩어리 | **Codex split** — semantic 1 + focus 1 + verify 3 |
| TS strict | 6 카테고리 | 별도 카테고리 #18 | invariant 1 + verify (생략, tsc CI gate) |
| web-vitals-budget | M1 | M1 | **위임 (vercel)** — bridge invariant 만 |

## 10. v2 미해결 결정사항

1. **vercel chainTo 표현 방식** — skill 본문에 `→ Run Skill(react-best-practices)` 식 markdown link / frontmatter `chainTo` 필드 / 본문 reference 중 어느 패턴이 표준인가? (vercel skill 들의 `chainTo` frontmatter 참고)
2. **vercel 미install fallback** — CLAUDE.md 의 안내 외 추가 가드? skill 본문이 vercel 부재 시 일부 룰을 self-contained 으로 보강해야 하나?
3. **M1 스코프 (10+10) 적절성** — 백엔드 18 invariant 와 비교해 충분한가, 더 축소해야 하나?
4. **bridge skill 의 위치** — `vercel-bridge` invariant 는 *상시 노출* 인가, *vercel install 감지 시만 노출* 인가?
5. ~~**scripts/ 자동화** — backend 와 동일~~ ✓ **결정 (v4): 미채택** — vercel 스타일 frontmatter validate 로 통합. 기성품 도구 (eslint-plugin-jsx-a11y / axe / Lighthouse / electronegativity) 위임.

## 11. 카테고리별 출처 매핑 (자료 신뢰도)

| 섹션 | 출처 |
|---|---|
| §1 백엔드 결구조 | Agent 1 raw output 100% |
| §2 vercel 의존 모델 | 본 보고서 v2 신규 — vercel skill 직접 read |
| §3 14 카테고리 | Agent 2 (25) ∪ Agent 3 (12), 본 보고서가 14로 묶음 + vercel 커버 칼럼 추가 |
| §4 14 invariant + 1 bridge | v1 의 16 → vercel 위임 2개 제거, bridge 1개 추가 |
| §5 18 verify + 1 bridge | v1 의 22 → vercel 위임 4개 제거 |
| §6 M1/M2/M3 | v1 base + vercel 위임 반영 재배치 |
| §7 plugin 정체성 | v2 신규 |
| §8 backend→frontend 매핑 | v1 그대로 + vercel 위임 표시 |
| §9 일치/갈린 부분 | v1 base + v2 판단 칼럼 추가 |

## 부록 A. raw 자료

- [agent-1-backend-structure-analysis.md](agent-1-backend-structure-analysis.md) — 백엔드 plugin 구조 (Explore)
- [agent-2-web-research.md](agent-2-web-research.md) — 25 카테고리 + Top 15 invariant + Top 20 verify (웹 리서치)
- [agent-3-codex-second-opinion.md](agent-3-codex-second-opinion.md) — 15 invariant + 20 verify + granularity framework (Codex)
- **vercel plugin 본문 위치** (read-only 참고): `~/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/{react-best-practices,nextjs,next-cache-components,verification,...}/SKILL.md`

## 부록 B. 주요 출처 URL

### React / Next.js
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19)
- [React `use()`](https://react.dev/reference/react/use) · [`cache()`](https://react.dev/reference/react/cache) · [`<Activity>`](https://react.dev/reference/react/Activity) · [`<ViewTransition>`](https://react.dev/reference/react/ViewTransition)
- [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1)
- [Next.js Cache Components](https://nextjs.org/docs/app/getting-started/caching-and-revalidating)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)

### Web 표준
- [web.dev Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds) · [INP](https://web.dev/articles/inp) · [LCP](https://web.dev/articles/lcp) · [CLS](https://web.dev/articles/cls)
- [MDN ARIA Roles](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles) · [CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) · [postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/button/)

### Electron
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)

### 도구
- [Tailwind v4 `@theme`](https://tailwindcss.com/docs/theme)
- [TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [typescript-eslint rules](https://typescript-eslint.io/rules/)
- [Conform](https://conform.guide/)
- [React Router framework mode actions](https://reactrouter.com/start/framework/actions)
- [Vite env and mode](https://vite.dev/guide/env-and-mode/)
