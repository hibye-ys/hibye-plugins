---
name: coding-standards
description: <api-app> TS 코드 작성 시 invoke. 네이밍 (camelCase / PascalCase / UPPER_SNAKE / kebab-case 파일명), 타입 (strict TS + zod 경계), async (Promise / fetch / Promise.all), 로깅 (pino + AsyncLocalStorage / edge runtime JSON.stringify), SRP / DRY / KISS / YAGNI 원칙 안내.
metadata:
  role: workflow
  scope: project
---

**적용된 §4.4 매트릭스 행**:
- linter: `ruff` → **`eslint`** + (선택) **`@biomejs/biome`**
- formatter: `black` → **`prettier`** 또는 **`biome format`**
- import sort: `isort` → **`eslint-plugin-import`** 또는 **`biome organize-imports`**
- type checker: `pyright` / `pylsp` → **`tsc --noEmit`** + **`vtsls`**
- 로깅: `loguru` / `structlog` → **`pino`** (Node) / **`console.log(JSON.stringify(...))`** (edge runtime — pino 의 stream 의존성 회피)
- 비동기: `asyncio` → **`Promise` / `async`**, `asyncio.gather` → **`Promise.all`** / **`Promise.allSettled`**
- schema: `pydantic v2 BaseModel` → **`zod`** + `z.infer<typeof>`
- contextvars: `structlog contextvars` → **`AsyncLocalStorage`** (Node) / **request-scoped Map via `<framework context store>('logCtx', ...)`** (edge runtime — AsyncLocalStorage 부분 지원)

# coding-standards — TypeScript 공통 코딩 규약 (<api-app>)

## 이 skill은 언제 invoke 되는가

- `<api-app>/src/**/*.ts` 신규 작성 / 리뷰
- 네이밍 / 파일명 충돌 발생
- `tsconfig.json` strict 옵션 / lint 설정 변경
- "왜 `print()` 가 lint warning?" 디버깅

## 불변식 (Invariants)

### 네이밍

| 대상 | 규칙 | 예시 |
|------|------|------|
| 파일명 | **kebab-case.ts** | `agent-loop.ts`, `tool-runner.ts` |
| 변수 / 함수 | **camelCase** | `runTool`, `loopState` |
| 클래스 / Interface / Type | **PascalCase** | `ToolDefinition`, `LoopState` |
| 상수 | **UPPER_SNAKE_CASE** | `MAX_TOKENS`, `DEFAULT_TIMEOUT_MS` |
| private 필드 | prefix `_` 또는 `#` (class private) | `_normalize`, `#cache` |
| 테스트 | `<module>.test.ts` 또는 `<module>.spec.ts` | `loop.test.ts` |
| 디렉토리 | **kebab-case** | `agent-loop/`, `tool-runner/` |

> 이유: TS 커뮤니티 합의 + TS 백엔드 생태 디폴트. Python `snake_case` 변수명을 TS 코드에 그대로 가져오지 말 것.

### Import 규약

```typescript
// ✅ 명시적 named import (framework-neutral 예시 — 실제 import 는 instance 측 framework 따라)
import { z } from 'zod';
// import { App } from '<framework>';
// import { sseHelper } from '<framework>/streaming';

// ✅ 같은 패키지 sub-path 는 묶지 말고 분리 (tree-shake 유리)
// import { HttpError } from '<framework>/http-exception';

// ❌ wildcard import
// import * as fw from '<framework>';

// ❌ default import 를 임의로 별칭 (혼동 유발)
// import App2 from '<framework>';
```

- import 정렬: external → internal → relative. `eslint-plugin-import` 또는 `biome organize-imports` 가 강제
- `import type { ... }` 활용 — 런타임 import 와 타입 import 분리 (bundle 사이즈)

### 타입 (TypeScript strict)

- `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`
- 모든 public 함수는 명시적 반환 타입 (`function foo(): Promise<Result>`). 내부 함수는 추론 허용
- `any` 금지 — 외부 SDK 경계에서 불가피하면 즉시 `zod` parse 또는 명시 type guard 로 좁히기
- `unknown` 은 외부 입력 / `JSON.parse` 결과 받을 때만. 사용 전 `z.parse` 또는 type guard
- DI: TS `interface` (Python `Protocol` 대응). 구현체는 `implements` 명시 권장 (덕 타이핑은 IDE jump-to 약함)

```typescript
// ✅ interface + zod 분리 (구조 계약 + 런타임 검증)
export interface ToolPort {
  run(input: ToolInput): Promise<ToolResult>;
}
export const ToolInputSchema = z.object({ name: z.string(), args: z.unknown() });
export type ToolInput = z.infer<typeof ToolInputSchema>;
```

### 비동기 (Promise)

- I/O 함수는 `async function`. 순수 연산은 동기 — 불필요한 async 전염 금지
- Provider / tool 호출은 반드시 `await`. 병렬은 `Promise.all` (실패 short-circuit) 또는 `Promise.allSettled` (각자 처리)
- CPU 블로킹 작업: 일부 runtime (예: edge runtime) 에서는 ML-worker (`<ml-worker-app>`) 로 격리. Node 환경에서는 `worker_threads`
- 스트림: `AsyncIterable<Event>` / `ReadableStream` — `for await (const ev of stream)` 패턴

### 로깅 (pino / runtime console)

- **구조화 로깅 필수**: `logger.info({ tool, ms }, 'tool_ran')` 또는 edge runtime `console.log(JSON.stringify({ level: 'info', event: 'tool_ran', tool, ms }))`
- 민감 정보 (secret, API key, PII) 로깅 절대 금지 — `scrubText` 유틸이 fail-safe 로 차단 (알려진 패턴만)
- request-scoped context (request_id / spawn_depth 등) 는 `AsyncLocalStorage` (Node) 또는 `<framework context store>('logCtx', ...)` (edge runtime) 로 주입. bind / clear 는 `bindLogContext` / `clearLogContext` 경유 — 화이트리스트 외 키는 `throw new Error(...)`
- 레벨: `debug` (개발) / `info` (정상) / `warn` (복구 가능) / `error` (실패) / `fatal` (시스템 영향 — startup fail / secret 누설 시도). `logLevel` 은 `z.enum(['debug','info','warn','error','fatal'])` — 5-level (`[[structured-log-schema]]` 정본 일치). 오타 시 startup fail

### 원칙

- **SRP** — 한 모듈 / 클래스는 변경 이유 1개
- **OCP** — 확장 열림, 수정 닫힘 (새 Tool 은 `ToolPort` interface 구현)
- **DRY** — 같은 로직 2회 이상 → 유틸 추출. 우연한 중복은 제외
- **KISS** — 1단계 함수 체인 > 3단계 추상화
- **YAGNI** — 지금 필요 없는 유연성 금지

### 주석

- **why 만, what ✕** — 코드가 무엇을 하는지는 코드로. 왜 그렇게 했는지 / 어떤 함정을 피했는지만 주석
- TODO / FIXME 는 owner + issue 링크 동반 권장: `// TODO(@youngseo, #123): handle 429`

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| TypeScript 버전 변경 | strict 옵션 동작, 새 타입 기능 사용 가능 여부 |
| zod 메이저 변경 | 모든 schema 정의 + parse 호출부 |
| pino 설정 변경 | 모든 로그 출력 형식, ALS 컨텍스트 바인딩 |
| `tsconfig.json` strict 토글 | 전체 코드베이스 재컴파일 + 에러 발생 가능 |
| runtime 호환 모드 변경 | `node:fs` 등 Node-only import 의 가용성 |

## 금지 사항

- `console.log` 프로덕션 코드 (디버그 잔여물) — 구조화 로깅 경유 필수
- wildcard import (`import * as x`) — tree-shake / 가독성 저해
- global mutable state — module-scoped const 또는 DI 로 주입
- `try { } catch { }` 빈 catch (조용한 swallowing) — 최소 `console.warn` + 의도 주석
- 블로킹 I/O 를 async 내부에서 await 없이 호출
- 하드코드 절대 경로 — `<framework env binding>` / config object 주입
- `as any` / `as unknown as T` 도주 — zod parse 또는 type guard 로 대체
- snake_case 변수명 / file 명 (Python 코드 복붙 흔적)
- 한 줄 함수에 `function` 키워드 남발 — 1줄 lambda 는 화살표 함수 권장 (`const add = (a: number, b: number) => a + b`)
- `enum` 신규 도입 — `as const` 객체 또는 union literal 우선 (tree-shake / type-only 비중 유리)
