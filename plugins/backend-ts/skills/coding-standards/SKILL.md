---
name: coding-standards
description: <api-app> TS 코드 작성 / 리뷰 시 invoke. 본 plugin 의 *프로젝트 고유 결정* 만 기록 — snake_case 금지, scrubText / bindLogContext 화이트리스트, 5-level logLevel (z.enum, 오타 시 startup fail), AsyncLocalStorage vs edge runtime context store, ML-worker 격리, enum 금지 (as const 우선), tsconfig strict 3-옵션. 일반 TS 컨벤션 (camelCase / SRP-OCP-DRY-KISS-YAGNI / wildcard import / as any) 은 모델 native 적용 — 본 skill 명시 ✕.
metadata:
  role: workflow
  scope: project
---

# coding-standards — TS 작성 시 프로젝트 고유 결정 기록

> 일반 코딩 컨벤션 (네이밍 대소문자, import 정렬, SRP-OCP-DRY-KISS-YAGNI, 주석 why-not-what, `as any` 도주 금지, 빈 catch 금지, wildcard import 금지) 은 TS 커뮤니티 디폴트 — 본 plugin 미명시. 본 skill 은 *디폴트와 다른* 결정 + *프로젝트 고유 유틸/규약* 만 기록.

## 이 skill 은 언제 invoke 되는가

- `<api-app>/src/**/*.ts` 신규 작성 / 리뷰 — 모델 native 와 다른 결정 확인
- `tsconfig.json` strict 옵션 변경 / 신규 도입
- 로깅 / context 주입 / scrub 관련 디버깅
- "왜 snake_case 가 lint warning?" — Python 복붙 흔적 의심 시

## 프로젝트 고유 결정

### 1. 네이밍 — **snake_case 금지**

파일 / 변수 / 함수에 `snake_case` 사용 금지. Python 코드 복붙 흔적. TS 디폴트 (camelCase / kebab-case 파일명) 적용. 디렉토리도 **kebab-case** 강제.

### 2. TypeScript strict — 3-옵션 모두 ON

`tsconfig.json` 디폴트보다 *엄격*:

```jsonc
{ "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true }
```

외부 SDK 경계는 `unknown` + `z.parse` 또는 명시 type guard — `any` 도주 ✕. DI / interface 기반 stateless 서비스 정본은 [[ts-agent-rules]] §"interface 기반 DI" / §"Stateless 서비스".

### 3. 로깅 — 프로젝트 유틸 + 5-level enum

- **logger**: `pino` (Node) / `console.log(JSON.stringify(...))` (edge runtime — pino stream 의존성 회피)
- **5-level `logLevel`**: `z.enum(['debug','info','warn','error','fatal'])`. 오타 시 startup fail — [[structured-log-schema]] 정본 일치
- **`scrubText` 유틸**: 알려진 secret / API key / PII 패턴 fail-safe 차단. 민감 정보 인자로 받는 모든 log 호출에 적용
- **request-scoped context**: `AsyncLocalStorage` (Node) / `<framework context store>('logCtx', ...)` (edge runtime — ALS 부분 지원)
- **`bindLogContext` / `clearLogContext`** 경유 강제 — 화이트리스트 외 키 주입 시 `throw new Error(...)`. 직접 store 조작 ✕

### 4. CPU 블로킹 — ML-worker 격리

edge runtime 의 ALS 제약 + blocking 제약 때문에 CPU intensive 작업은 별도 `<ml-worker-app>` 으로 격리. Node 환경 only 면 `worker_threads`.

### 5. `enum` 신규 도입 금지

`as const` 객체 또는 union literal 우선. 사유: tree-shake / type-only 비중 유리 + runtime cost 0.

```typescript
// ✅
const LogLevel = { debug: 'debug', info: 'info', warn: 'warn', error: 'error', fatal: 'fatal' } as const
type LogLevel = typeof LogLevel[keyof typeof LogLevel]

// ❌ — 신규 도입 ✕
enum LogLevel { debug, info, warn, error, fatal }
```

## Python → TS 라이브러리 매핑 (transition reference)

`ruff`/`black`/`isort` → `eslint`+`prettier` (또는 `biome`) · `pyright` → `tsc --noEmit`+`vtsls` · `loguru`/`structlog` → `pino` (Node) / `console.log` (edge) · `asyncio` → `Promise`/`async` · `asyncio.gather` → `Promise.all`/`Promise.allSettled` · `pydantic v2` → `zod` (`z.infer<typeof>`) · `structlog contextvars` → `AsyncLocalStorage` (Node) / context store (edge)

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `tsconfig.json` strict 토글 | 전체 재컴파일 — 본 plugin 정책은 3-옵션 모두 ON |
| `logLevel` enum 변경 | startup validate fail-safe — [[structured-log-schema]] 와 동시 갱신 의무 |
| `scrubText` 패턴 추가 | secret leak fail-safe 확장 — runtime 검증 의무 |
| runtime 변경 (Node ↔ edge) | ALS 가용성 + pino stream 가용성 — context store 경로 변경 |
