---
name: sentry-rum-pii
description: "Sentry Browser SDK 초기화 + beforeSend PII redaction + Session Replay masking + sourcemap upload + production sample rate. sendDefaultPii: true / DSN 하드코딩 / replay 100% sampling 검출. sentry.client.config / Sentry.init 사용처 작성·리뷰 시 자동 트리거."
metadata:
  priority: 4
  docs:
    - "https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/"
    - "https://docs.sentry.io/platforms/javascript/guides/react/"
    - "https://docs.sentry.io/platforms/javascript/session-replay/privacy/"
    - "https://docs.sentry.io/platforms/javascript/sourcemaps/"
  pathPatterns:
    - 'src/**/*.ts'
    - 'src/**/*.tsx'
    - 'src/**/*.js'
    - 'src/**/*.jsx'
    - 'app/**/*.ts'
    - 'app/**/*.tsx'
    - 'app/**/*.js'
    - 'app/**/*.jsx'
    - '**/sentry.client.config.ts'
    - '**/sentry.client.config.js'
    - '**/sentry.server.config.ts'
    - '**/sentry.server.config.js'
    - '**/sentry.edge.config.ts'
    - '**/sentry.edge.config.js'
    - '**/instrumentation.ts'
    - '**/instrumentation.js'
    - 'instrumentation-client.ts'
    - 'instrumentation-client.js'
    - 'next.config.js'
    - 'next.config.ts'
    - 'next.config.mjs'
    - 'next.config.cjs'
    - 'vite.config.ts'
    - 'vite.config.js'
    - 'vite.config.mjs'
    - 'vite.config.cjs'
    - '**/entry.client.ts'
    - '**/entry.client.tsx'
    - '**/entry.client.js'
    - '**/entry.client.jsx'
    - '**/entry.server.ts'
    - '**/entry.server.tsx'
    - '**/entry.server.js'
    - '**/entry.server.jsx'
    - 'electron/**/*.ts'
    - 'electron/**/*.tsx'
    - 'electron/**/*.js'
    - 'electron/**/*.jsx'
    - 'src/main/**/*.ts'
    - 'src/main/**/*.js'
    - 'src/preload/**/*.ts'
    - 'src/preload/**/*.js'
  bashPatterns: []
  importPatterns:
    - '@sentry/browser'
    - '@sentry/react'
    - '@sentry/nextjs'
    - '@sentry/remix'
    - '@sentry/electron'
    - '@sentry/vite-plugin'
validate:
  - pattern: 'Sentry\.init\s*\(\s*\{[^}]*\bdsn\s*:\s*[`''"][^`''"$]+[`''"]'
    message: 'Sentry DSN 하드코딩 — env var (process.env.NEXT_PUBLIC_SENTRY_DSN / VITE_SENTRY_DSN) 권장. 노출 자체는 sensitive 아니지만 환경별 분리 / rotation 위해 env var.'
    severity: warn
  - pattern: 'sendDefaultPii\s*:\s*true'
    message: 'sendDefaultPii: true — IP / cookies / Authorization header / referer 자동 전송. PII 정책 검토 필요. 기본값 (false) 유지 + 의도된 필드만 beforeSend 에서 명시.'
    severity: error
  - pattern: 'replaysSessionSampleRate\s*:\s*(?:1(?:\.0+)?|0?\.[5-9]\d*)'
    message: 'replaysSessionSampleRate ≥ 0.5 — cost + PII risk. production 은 0.1 이하 + maskAllText / blockAllMedia 의무. 개발 / staging 만 높은 sample.'
    severity: warn
  - pattern: 'maskAllText\s*:\s*false|maskAllInputs\s*:\s*false|blockAllMedia\s*:\s*false'
    message: 'Session Replay PII guard 비활성 (maskAllText / maskAllInputs / blockAllMedia false). 의도된 unmask 는 selector (mask: ".sensitive") 권장, 전체 비활성 ✕.'
    severity: error
retrieval:
  aliases:
    - sentry
    - RUM
    - error tracking
    - PII
    - session replay
    - sourcemap
    - observability
  intents:
    - setup sentry
    - redact PII
    - configure session replay
    - upload sourcemaps
    - sentry production config
    - sentry sample rate
  entities:
    - Sentry.init
    - beforeSend
    - sendDefaultPii
    - maskAllText
    - replaysSessionSampleRate
    - tracesSampleRate
    - dsn
chainTo: []
---

# sentry-rum-pii

**Sentry 는 React Web 의 가장 흔한 RUM / error tracking 통합** — JS 예외 / unhandled rejection / Web Vitals / Session Replay 까지 한 SDK 로 처리. 단 *기본값 그대로* 두면 IP / cookies / Authorization header / 사용자 입력 / DOM 텍스트가 production 으로 흘러감 — GDPR / 사내 PII 정책 위반의 흔한 출처. 본 skill 은 *default-safe init + beforeSend redaction + Session Replay masking + sourcemap policy 4박자*. 깊은 dashboard 운영 / alert 룰 / release tagging 은 Sentry docs + `@sentry/cli` 위임.

## When to apply

- Sentry 신규 통합 (`@sentry/browser` / `@sentry/react` / `@sentry/nextjs` / `@sentry/remix`)
- `sentry.client.config.ts` / `instrumentation-client.ts` 작성·수정
- Session Replay 활성화 결정 (`@sentry/browser` `replayIntegration()`)
- production sourcemap upload 설정 (`@sentry/vite-plugin` / `withSentryConfig`)
- Next.js `withSentryConfig` 옵션 변경
- Electron `@sentry/electron/main` + `@sentry/electron/renderer` 분리 init
- DSN 하드코딩 → env var 마이그레이션
- 사용자 입력 (form / search query / chat message) 안 PII 누출 점검

## 핵심 원칙

### 1. DSN = env var (하드코딩 ✕)

- Next.js → `process.env.NEXT_PUBLIC_SENTRY_DSN`, Vite → `import.meta.env.VITE_SENTRY_DSN`
- DSN 자체는 *공개되어도 치명적이지 않음* (write-only ingest key) — 단 환경별 (`dev` / `staging` / `prod`) project 분리 + rotation 위해 env var 의무
- 본 plugin validate rule 1 = 리터럴 DSN (`"https://..."` / `` `https://...` ``) 검출, env var (`process.env.X`) + template literal (`` `${x}` ``) 은 통과

### 2. `sendDefaultPii: false` 유지 (default)

- `sendDefaultPii: true` = IP 주소 / 모든 cookies / `Authorization` header / `Referer` / `User-Agent` 자동 전송 — GDPR / 사내 PII 정책 위반의 가장 흔한 케이스
- 기본값 `false` 유지 + *의도된 필드만* `beforeSend` 안에서 명시적으로 add
- 본 plugin validate rule 2 = `sendDefaultPii: true` 즉시 error

### 3. `beforeSend` 안 사용자 입력 sanitize

- request body / breadcrumb (`message` / `data`) / `extra` / `tags` / `user` 안 모든 free-form 값 = sanitize 대상
- 이메일 / 카드 번호 / JWT / API key / phone / 주민번호 패턴 regex 마스킹
- *화이트리스트 fields* 만 전송 (blacklist 보다 안전 — 새 필드 추가 시 자동 차단)
- `beforeSendTransaction` 도 동일 정책 적용 (Sentry Performance 의 URL / query string)

### 4. Session Replay = mask + block 의무

- `maskAllText: true` + `maskAllInputs: true` + `blockAllMedia: true` (production default)
- 의도된 unmask = *selector 명시* (`unmask: '.public-bio'`) — 전체 비활성 ✕
- 사용자 의도 없이 `false` 로 두면 입력 필드 / DOM 텍스트 / 이미지 / 비디오 통째로 녹화됨 — 채팅 / 결제 화면에서 즉시 사고
- 본 plugin validate rule 4 = `maskAllText: false` / `maskAllInputs: false` / `blockAllMedia: false` 즉시 error

### 5. Sample rate production ≤ 0.1

- `tracesSampleRate: 0.1` (production) / `1.0` (dev) — Sentry Performance 의 비용은 transaction 단위
- `replaysSessionSampleRate: 0.1` 이하 (production) — Session Replay 는 사용량 + storage 폭증
- `replaysOnErrorSampleRate: 1.0` 는 OK — 에러 발생 시점만 녹화하므로 비용 통제 (errors-only replay 권장 패턴)
- 본 plugin validate rule 3 = `replaysSessionSampleRate ≥ 0.5` 즉시 warn

### 6. sourcemap upload (release / dist)

- `@sentry/nextjs` = `withSentryConfig({ silent: false, widenClientFileUpload: true })` 가 자동 sourcemap upload + release tagging
- `@sentry/vite-plugin` = build step 에 plugin 추가 + `SENTRY_AUTH_TOKEN` env var
- *sourcemap 자체는 public 노출 ✕* — webpack/vite `hidden-source-map` 옵션 (브라우저는 `.map` 다운로드 ✕, Sentry 만 보유)
- release tag (`release: process.env.SENTRY_RELEASE`) = git SHA / version tag 명시 — Sentry Issues 에 정확한 source line 매핑

### 7. tunnel option (ad-blocker bypass)

- `tunnel: '/monitoring/sentry-tunnel'` = Sentry CDN 직접 호출 ✕ → 자체 서버 endpoint 가 proxy
- ad-blocker 가 `sentry.io` 호스트 차단 시 — RUM 데이터 손실 발생. tunnel = 1st-party 호스트로 위장
- 자체 서버 endpoint 의 *CORS / auth proxy* 의무 — Sentry envelope 만 forward, 외부 발신 차단
- Next.js Route Handler / Vite middleware / Electron main 에서 구현

### 8. Electron = main / renderer 분리 init

- `@sentry/electron/main` (main process) — Node 측 crash / exception
- `@sentry/electron/renderer` (renderer) — Browser 측 React error
- preload 에서 통합 init ✕ — sandbox + contextIsolation 호환 ✕ (`electron-renderer-isolation` skill 참고)
- main 측에서 IPC 로 renderer event 받는 패턴은 SDK 가 자동 처리

## sentry.client.config.ts 예시 (PII-safe, Next.js App Router)

```ts
// sentry.client.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,  // env var 의무
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',

  // PII guard
  sendDefaultPii: false,  // IP / cookies / Authorization header 차단

  // sample rate (production)
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.0,   // errors-only 전략
  replaysOnErrorSampleRate: 1.0,   // 에러 발생 시점만 녹화

  // Session Replay masking 의무
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
      // 의도된 unmask 만 selector 명시
      unmask: ['.public-bio', '.product-name'],
    }),
  ],

  // ad-blocker bypass (선택)
  tunnel: '/monitoring/sentry-tunnel',

  // PII redaction
  beforeSend(event) {
    return redactPii(event)
  },
  beforeSendTransaction(event) {
    return redactPii(event)
  },
})
```

## beforeSend redaction 예시

```ts
// lib/sentry-redact.ts
import type { ErrorEvent, EventHint } from '@sentry/types'

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const CARD = /\b(?:\d[ -]*?){13,16}\b/g
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

function scrub(value: string): string {
  return value.replace(EMAIL, '[email]').replace(CARD, '[card]').replace(JWT, '[jwt]')
}

export function redactPii(event: ErrorEvent): ErrorEvent {
  // Authorization header 제거 (sendDefaultPii: false 여도 안전망)
  if (event.request?.headers) {
    delete event.request.headers['Authorization']
    delete event.request.headers['Cookie']
  }
  // query string 안 token 제거
  if (event.request?.query_string && typeof event.request.query_string === 'string') {
    event.request.query_string = scrub(event.request.query_string)
  }
  // breadcrumb message sanitize
  event.breadcrumbs = event.breadcrumbs?.map((b) => ({
    ...b,
    message: b.message ? scrub(b.message) : b.message,
  }))
  return event
}
```

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `Sentry.init({ dsn: "https://abc@..." })` (literal) | `dsn: process.env.NEXT_PUBLIC_SENTRY_DSN` | **validate (warn)** |
| `sendDefaultPii: true` | default `false` + 의도된 필드만 beforeSend 안 add | **validate (error)** |
| Session Replay `maskAllText: false` / `maskAllInputs: false` / `blockAllMedia: false` | 모두 true + unmask selector 명시 | **validate (error)** |
| `replaysSessionSampleRate: 1.0` (production) | 0.0 + `replaysOnErrorSampleRate: 1.0` (errors-only) | **validate (warn)** |
| sourcemap public 노출 (`sourceMap: true` + 정적 hosting) | `hidden-source-map` + Sentry 만 upload | 수동 / build 설정 |
| `window.addEventListener('error', ...)` 직접 (Sentry global handler 와 중복) | Sentry 자동 핸들러 (`autoSessionTracking` / `dedupeIntegration`) | 수동 |
| tunnel endpoint CORS 무제한 (`Access-Control-Allow-Origin: *`) | own origin 만 + Sentry envelope content-type 검증 | 수동 |
| Electron `@sentry/electron` main + renderer 통합 init in preload | `@sentry/electron/main` + `@sentry/electron/renderer` 분리 | `electron-renderer-isolation` cross-ref |
| `beforeSend` 안 무거운 작업 (DB 쿼리 / 외부 API) | 동기 sanitize + return | 수동 (perf 저하 + drop) |
| breadcrumb 안 사용자 입력 그대로 (`Sentry.addBreadcrumb({ message: userQuery })`) | scrub 후 add | 수동 |
| `user: { email: u.email, ip: req.ip }` (수동 PII attach) | `user: { id: u.id }` 만 (necessary minimum) | 수동 |
| dev / staging / prod 가 같은 Sentry project (DSN 하나) | project 분리 + DSN 분리 (env var 활용) | 수동 |

## 도구 위임 (이 skill 의 진입점 역할)

- **Sentry dashboard** (Issues / Replays / Performance / Crons) — runtime audit, 본 plugin validate 가 잡지 못하는 *실제 incoming event* 안 PII / sample 확인
- **`@sentry/cli`** — sourcemap upload + release tagging (CI 단계). `sentry-cli releases new` / `sentry-cli sourcemaps upload`
- **`@sentry/vite-plugin`** (Vite) / **`withSentryConfig`** (Next.js) — build-time sourcemap + release 자동
- **Lighthouse / web-vitals lib** — Sentry Performance 와 보완 영역. *Web Vitals 전송 별도* = `web-vitals-transport` skill 이 sendBeacon transport / visibilitychange listener 깊게 다룸
- **ESLint custom rule** (`no-process-env-leak`) — `process.env.SENTRY_*` 가 클라이언트 번들에 새지 않는지
- **`@sentry/replay-canvas`** — canvas-based UI (chart / map) replay 필요 시 별도 integration (privacy 정책 동일 적용)
- **본 plugin validate 가 *추가* 하는 영역** — DSN 리터럴 하드코딩 warn / `sendDefaultPii: true` 즉시 error (사고의 60% 출처) / `replaysSessionSampleRate ≥ 0.5` warn / Session Replay mask 비활성 즉시 error

## 관련 skill cross-reference

- **`electron-renderer-isolation`** — Electron main / renderer 분리 init / **`security-dom-sinks`** — Sentry tunnel endpoint 의 CORS / CSP 정책
- **`web-vitals-transport`** — Web Vitals beacon 전송 + Sentry Performance 보완 / **`error-boundary-telemetry`** — ErrorBoundary + `Sentry.withErrorBoundary` (해당 skill 이 본 skill 로 chainTo)

## 참조

- [Sentry — Sensitive Data (PII)](https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/) — `sendDefaultPii` / `beforeSend` 정본
- [Sentry — Session Replay Privacy](https://docs.sentry.io/platforms/javascript/session-replay/privacy/) — masking / blocking selector
- [Sentry — Sourcemaps](https://docs.sentry.io/platforms/javascript/sourcemaps/) · [`hidden-source-map` 가이드](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/hosting-publicly/)
- [Sentry — React SDK](https://docs.sentry.io/platforms/javascript/guides/react/) · [Next.js SDK](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Sentry — Electron SDK](https://docs.sentry.io/platforms/javascript/guides/electron/) — main / renderer 분리
- [Sentry — Tunnel option](https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option) — ad-blocker bypass
- [`@sentry/vite-plugin`](https://www.npmjs.com/package/@sentry/vite-plugin) · [`@sentry/cli`](https://docs.sentry.io/cli/)
