---
name: web-vitals-transport
description: web-vitals lib + sendBeacon (또는 fetch keepalive) transport + visibilitychange / pagehide listener — RUM (real user monitoring) 메트릭 전송 신뢰성. beforeunload listener 사용 / sendBeacon 미사용 / metric 전송 누락 검출. web-vitals import 또는 RUM endpoint 구현 시 자동 트리거. vercel:react-best-practices 가 budget 룰 cover — 본 skill 은 transport 만 보완.
metadata:
  priority: 3
  docs:
    - "https://web.dev/articles/vitals"
    - "https://github.com/GoogleChrome/web-vitals"
    - "https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon"
    - "https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event"
  pathPatterns:
    - 'src/**/*.ts'
    - 'src/**/*.tsx'
    - 'src/**/*.js'
    - 'src/**/*.jsx'
    - 'app/**/*.ts'
    - 'app/**/*.tsx'
    - 'app/**/*.js'
    - 'app/**/*.jsx'
    - '**/analytics/**/*.ts'
    - '**/analytics/**/*.js'
    - '**/instrumentation.ts'
    - '**/instrumentation.js'
    - 'instrumentation-client.ts'
    - 'instrumentation-client.js'
    - '**/reportWebVitals.ts'
    - '**/reportWebVitals.js'
    - 'pages/**/*.ts'
    - 'pages/**/*.tsx'
    - 'pages/**/*.js'
    - 'pages/**/*.jsx'
  bashPatterns: []
  importPatterns:
    - 'web-vitals'
    - 'web-vitals/attribution'
    - '@vercel/analytics'
    - '@vercel/speed-insights'
validate:
  - pattern: 'addEventListener\s*\(\s*[`''"]beforeunload[`''"]'
    message: 'beforeunload listener 안 metric 전송 — 불안정. bfcache 차단 / iOS Safari 미발화 / async 처리 불가. visibilitychange (state hidden) 또는 pagehide 사용.'
    severity: warn
  - pattern: '\b(?:onCLS|onINP|onLCP|onFID|onTTFB|onFCP)\s*\(\s*(?:\([^)]*\)|[^=)]*)\s*=>\s*\{\s*(?:console\.log|console\.debug)\s*\('
    message: 'web-vitals callback 안 console.log 만 — production transport 누락. navigator.sendBeacon / fetch keepalive / Vercel Analytics 통합 필요. (parenthesized arrow `(metric) =>` + bare `metric =>` 둘 다 검출)'
    severity: warn
retrieval:
  aliases:
    - web vitals
    - core web vitals
    - LCP
    - INP
    - CLS
    - RUM
    - sendBeacon
    - real user monitoring
  intents:
    - measure web vitals
    - send performance metrics
    - configure RUM transport
    - report core web vitals
    - bfcache safe metric
  entities:
    - onCLS
    - onINP
    - onLCP
    - onTTFB
    - onFCP
    - sendBeacon
    - visibilitychange
    - pagehide
chainTo: []
---

# web-vitals-transport

**RUM (real user monitoring) = lab data (Lighthouse / PageSpeed) 의 시뮬레이션과 다른 *실제 사용자 분포*** — 디바이스 / 네트워크 / locale 차이로 lab green 인 페이지가 field 에서는 red 일 수 있음. Google 의 `web-vitals` lib 가 표준 — `onCLS` / `onINP` / `onLCP` / `onTTFB` / `onFCP` 5 함수로 callback 받아 임의 endpoint 로 전송. 본 skill 은 *transport 신뢰성* (sendBeacon vs fetch keepalive / visibilitychange vs beforeunload / batch flush 패턴) + listener timing 만 — LCP / INP / CLS *budget* 룰은 `vercel:react-best-practices` 위임.

## When to apply

- web-vitals lib 신규 통합 (`import { onLCP, onINP, onCLS } from 'web-vitals'`)
- 자체 analytics endpoint 로 RUM 메트릭 전송 구현
- `@vercel/analytics` / `@vercel/speed-insights` 통합 결정
- Next.js `reportWebVitals` (Pages Router) → App Router `useReportWebVitals` 마이그레이션
- `instrumentation-client.ts` 안 web-vitals 초기화
- bfcache (back-forward cache) 호환성 점검 — `beforeunload` 잔재 발견
- RUM payload PII 검토 (URL / referrer / user-id)

## 핵심 원칙

### 1. web-vitals lib 5 함수 사용

- **`onLCP`** (Largest Contentful Paint) — 가장 큰 above-the-fold 요소 paint 시점
- **`onINP`** (Interaction to Next Paint) — 2024 부터 *FID 대체* Core Web Vitals 표준 (모든 interaction 응답성)
- **`onCLS`** (Cumulative Layout Shift) — viewport 안 unexpected layout shift 누적
- **`onTTFB`** (Time to First Byte) — server 응답 시작
- **`onFCP`** (First Contentful Paint) — 첫 paint
- 각 callback 은 *final value* 가 결정되는 시점 (보통 page hidden 또는 unload) 에 1회 호출
- `onFID` 는 *deprecated* — INP 로 마이그레이션 의무 (2024-03 부터 CWV 표준 변경)

### 2. Transport = `navigator.sendBeacon` 1순위

- `navigator.sendBeacon(url, body)` = **page unload 시점에도 안전** + async + queue + 즉시 return
- HTTP POST 본질 (Content-Type 은 `application/x-www-form-urlencoded` 기본 — `Blob` 으로 명시 가능)
- 본문 크기 한도 = **64KB** (브라우저별 차이) — payload 가 크면 batch 분할
- fallback = `fetch(url, { method: 'POST', body, keepalive: true })` — sendBeacon 미지원 환경 (구형 브라우저)
- *절대 ✕* — sync XHR / 1x1 `Image()` ping / 일반 `fetch` (`keepalive` 없이) — unload 시점 inflight request 가 강제 cancel 됨

### 3. `beforeunload` listener ✕ — `visibilitychange` + `pagehide`

- **`beforeunload`** = bfcache (back-forward cache) **차단** 의 주범 — 모든 메이저 브라우저 2022+ 정책으로 등록만 해도 bfcache 자격 박탈
- 추가로 **iOS Safari 에서 미발화** — iOS 의 swipe-back / app switch 시점에 절대 호출 안 됨
- async 처리 불가 (return value 만 dialog 용도)
- **권장 = `visibilitychange` (state === 'hidden') + `pagehide` 둘 다 등록** — web.dev 의 Page Lifecycle 공식 가이드 패턴
  - `visibilitychange` (hidden) = 모던 메이저 브라우저의 *탭 전환 / 앱 백그라운드* 시점
  - `pagehide` = iOS Safari 의 *최종 unload 직전* fallback
- 본 plugin validate rule 1 = `beforeunload` listener 등록 자체를 warn (metric-transport 외 context 에도 권장하지 않음)

### 4. Batch + flush 패턴

- 각 metric callback 마다 즉시 send ✕ — 5 개 메트릭 × 5 requests = 비효율 + sendBeacon 64KB 한도 분산 손해
- **queue** 에 적재 → `visibilitychange` (hidden) / `pagehide` 시점에 *단일 flush*
- queue 자체는 module-scope 변수 (`let queue: Metric[] = []`)
- flush 후 `queue = []` reset (재방문 / SPA 라우팅 대응)
- INP / CLS 처럼 *update 발생 가능* (final value 미확정 동안 callback 여러 번) 인 메트릭은 같은 `id` 의 최신 값으로 덮어쓰기

### 5. attribution build 활용 (root cause)

- `web-vitals` 기본 build = 메트릭 *값* 만 (LCP = 2400ms 같은)
- `web-vitals/attribution` build = 추가 `attribution` 필드 — *어떤 element / 어떤 stage* 가 원인인지
  - `onLCP` → `element` (CSS selector) / `url` (이미지) / `loadTime` / `renderTime` / `timeToFirstByte`
  - `onINP` → `interactionTarget` (element) / `interactionType` (pointer / keyboard) / `inputDelay` / `processingDuration` / `presentationDelay`
  - `onCLS` → `largestShiftTarget` (element) / `largestShiftTime` / `loadState`
- bundle 크기 약간 증가 (전체 build = 약 2KB → attribution = 약 3.5KB gzip)
- CI 단계 (Lighthouse user-flow) + debug session 에 권장 — production 도 sampling 으로 일부만 attribution build 사용 가능

### 6. Server Timing header 보완

- client RUM 만으로는 *server-side latency* 가시화 불가 — TTFB 안에 묶임
- 응답 header `Server-Timing: db;dur=42, render;dur=8, edge;dur=3` 추가 → client `PerformanceObserver` 로 read
- `new PerformanceObserver(list => { list.getEntriesByType('navigation').forEach(e => e.serverTiming) }).observe({ type: 'navigation', buffered: true })`
- RUM payload 에 serverTiming 동봉 → DB / render / edge stage 별 latency 추적
- 보안 — credentials 동봉 cross-origin 요청은 header 노출 안 됨 (`Timing-Allow-Origin` header 필요)

### 7. Vercel Speed Insights / `@vercel/analytics` 위임 옵션

- Next.js / Vercel deploy 환경 = **turn-key 옵션** — `<SpeedInsights />` + `<Analytics />` 컴포넌트 1줄
- 자동 = transport (sendBeacon + visibilitychange) / sampling / dashboard / 자동 attribution / route 단위 분석
- 자체 endpoint 구축 비용 (storage / aggregation / dashboard) 회피
- 단점 = vendor lock-in + custom dimension 제한. 자체 product analytics 와 통합 필요 시 web-vitals lib 직접 + 자체 endpoint
- 본 skill 의 transport 패턴은 *자체 endpoint* 케이스 — Vercel 사용 시 본 skill 가이드 대부분 자동

## web-vitals + sendBeacon 패턴

```ts
// lib/web-vitals.ts
import { onCLS, onINP, onLCP, onTTFB, onFCP, type Metric } from 'web-vitals'

const ENDPOINT = '/api/rum'
let queue: Metric[] = []
let flushed = false

function enqueue(metric: Metric) {
  // 같은 id 면 update (INP / CLS 의 progressive value)
  queue = queue.filter((m) => m.id !== metric.id)
  queue.push(metric)
}

function flush() {
  if (flushed || queue.length === 0) return
  flushed = true
  const body = JSON.stringify({ metrics: queue, url: location.pathname })
  // sendBeacon 1순위
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    navigator.sendBeacon(ENDPOINT, blob)
  } else {
    // fallback — fetch keepalive
    fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
  }
  queue = []
}

export function initWebVitals() {
  onCLS(enqueue)
  onINP(enqueue)
  onLCP(enqueue)
  onTTFB(enqueue)
  onFCP(enqueue)

  // 둘 다 등록 — visibilitychange = 모던 브라우저, pagehide = iOS Safari fallback
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  addEventListener('pagehide', flush)
}
```

## visibilitychange / pagehide listener 패턴

```ts
// 둘 다 등록 의무 — 한쪽만은 cover 불완전
addEventListener('visibilitychange', () => {
  // 모던 메이저 브라우저 — 탭 전환 / 앱 백그라운드 / 윈도우 minimize
  if (document.visibilityState === 'hidden') flushMetrics()
})

addEventListener('pagehide', () => {
  // iOS Safari fallback — swipe-back / 새 탭 / app switch 의 최종 unload
  flushMetrics()
})

// ✕ 절대 ✕ — bfcache 차단 + iOS 미발화
// addEventListener('beforeunload', flushMetrics)
```

`flushMetrics` 안에서 *idempotent* 보장 — 두 listener 가 같은 navigation 안에서 모두 발화 가능.

## attribution 패턴 (LCP root cause)

```ts
import { onLCP, type LCPMetricWithAttribution } from 'web-vitals/attribution'

onLCP((metric: LCPMetricWithAttribution) => {
  const { value, attribution } = metric
  console.warn(`LCP = ${value}ms`, {
    element: attribution.element,           // CSS selector
    url: attribution.url,                   // image URL (있으면)
    loadTime: attribution.lcpResourceLoadTime,
    renderTime: attribution.lcpResourceRenderTime,
    ttfb: attribution.timeToFirstByte,
  })
  // RUM payload 에 element / url 동봉 → dashboard 에서 element 별 LCP 분포
})
```

attribution build = 어떤 이미지 / 어떤 component 가 LCP 후보인지 *element selector* 단위로 추적 가능.

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `addEventListener('beforeunload', sendMetrics)` | `visibilitychange` (hidden) + `pagehide` 둘 다 | **validate (warn)** |
| web-vitals callback 안 `console.log(metric)` 만 (production 잔존) | sendBeacon / fetch keepalive / Vercel Analytics | **validate (warn)** |
| sync XHR (`xhr.open(..., false)`) 로 metric 전송 | `navigator.sendBeacon` | 수동 |
| `new Image().src = '/rum?...'` ping | sendBeacon (POST body / 64KB 가능) | 수동 |
| 일반 `fetch(url, { method: 'POST' })` (no keepalive) | `keepalive: true` 또는 sendBeacon | 수동 |
| metric 마다 즉시 send (batch ✕) | queue + visibilitychange flush | 수동 |
| `onFID` 사용 (deprecated since 2024-03) | `onINP` 로 마이그레이션 | 수동 |
| Vercel deploy 인데 `<SpeedInsights />` 컴포넌트 미렌더 | `<SpeedInsights />` / `<Analytics />` 추가 | 수동 |
| sample rate 100% (production) | 5-10% sampling — cost / noise 통제 | 수동 |
| Server-Timing header 무시 | `PerformanceObserver('navigation').serverTiming` read + payload 동봉 | 수동 |
| RUM payload 안 `user.email` / 풀 URL query (token 포함) | id 만 + URL path (no query) | 수동 (PII) |
| `web-vitals` + `web-vitals/attribution` 동시 import (bundle 중복) | 한 쪽만 — 보통 attribution build 만 사용 | 수동 (bundle 분석) |

## 도구 위임 (이 skill 의 진입점 역할)

- **`vercel:react-best-practices`** — *LCP / INP / CLS budget* 룰 정본. 컴포넌트 단위 budget (이미지 size / interaction handler / animated layout shift) 본 plugin 미터치. chainTo 가능 — 본 plugin 은 *transport* 만 보완하는 분리 책임.
- **Vercel Speed Insights / Analytics** (`@vercel/speed-insights` + `@vercel/analytics`) — turn-key transport + dashboard + route 단위 자동 분석 + 자동 attribution + 동반 product analytics. Next.js / Vercel deploy 환경 1순위.
- **Chrome UX Report (CrUX)** — historical aggregate (real-world Chrome users 28-day window). PageSpeed Insights / `https://chromeuxreport.com/` API 로 read. lab data 보완.
- **PageSpeed Insights** — lab (Lighthouse) + field (CrUX) 단일 화면. 본 plugin 의 RUM transport 와는 *입력 source* 가 다름 (PSI = 외부 측정 / 본 skill = own transport).
- **Lighthouse CI** — *lab* budget enforcement (CI 단계 — 모든 PR). 본 skill 의 RUM 과 *별개 영역* — lab + field 둘 다 운영 권장.
- **Sentry Performance** — Sentry RUM 통합 시 Web Vitals 도 자동 수집. `sentry-rum-pii` skill 의 sample rate / PII 정책 동일 적용.
- **본 skill 의 validate 가 *추가* 하는 영역**:
  - `beforeunload` listener 등록 즉시 warn (bfcache + iOS Safari 두 위험 동시 신호)
  - web-vitals callback 안 console.log-only 검출 — production transport 누락 (dev shim 잔재의 흔한 사고)

## 관련 skill cross-reference

- **`sentry-rum-pii`** — Sentry Performance 의 Web Vitals 자동 수집 / sample rate / PII redaction (transport 측 동일 sendBeacon 적용)
- **`image-media-contract`** — LCP 후보 이미지 (priority / fetchPriority="high") — *root cause* 이미지 LCP 회귀 시 cross-ref
- **`async-race-avoidance`** — listener cleanup (visibilitychange / pagehide 의 SPA 라우팅 시 재등록)
- **`error-boundary-telemetry`** — ErrorBoundary error → Sentry / RUM transport 패턴 공유 (둘 다 sendBeacon-class 전송 적용)
- **`client-boundary`** — `instrumentation-client.ts` / `'use client'` 위치 — web-vitals 는 client only

## 참조

- [web.dev — Vitals (LCP / INP / CLS 정의 + threshold)](https://web.dev/articles/vitals) · [INP 마이그레이션 가이드](https://web.dev/articles/inp)
- [GoogleChrome/web-vitals — README + attribution build 가이드](https://github.com/GoogleChrome/web-vitals)
- [MDN — `navigator.sendBeacon`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon) · [`fetch` `keepalive` 옵션](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#keepalive)
- [web.dev — Page Lifecycle API (visibilitychange / pagehide / bfcache)](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- [MDN — `visibilitychange` event](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) · [`pagehide` event](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)
- [Vercel — Speed Insights docs](https://vercel.com/docs/speed-insights) · [`@vercel/analytics`](https://vercel.com/docs/analytics)
- [web.dev — Server-Timing](https://web.dev/articles/custom-metrics#server-timing-api) · [`PerformanceServerTiming`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceServerTiming)
- [Chrome — bfcache (왜 beforeunload 차단인가)](https://web.dev/articles/bfcache)
