---
name: ts-agent-rules
description: TS 백엔드 작업 시 자동 로드. 18 invariant + 39 workflow + 21 audit 의 라우팅 + 자주 묶이는 룰 묶음 + core-infrastructure 흡수 보충 (타입 경계 / interface DI / Stateless / AsyncLocalStorage 10 필드 / 영향도 표). python-agent-rules 의 TS 동등 — 메모리 룰 rename.
metadata:
  role: workflow
  scope: project
---

**적용된 §4.4 매트릭스 행**: 모든 매트릭스 — 본 카탈로그는 어느 룰 SKILL.md 로 분기할지 안내. 개별 매트릭스 행은 각 룰 SKILL.md 안에. (`pydantic` → `zod`, `pyright` → `tsc --noEmit` / `vtsls`, `typing.Protocol` → `interface`, `ABC` → `interface`, `ContextVar` → `AsyncLocalStorage`, `structlog.contextvars` → 구조화 로깅 helper, `dataclass` → interface, `os.environ` → env 어댑터 (framework/runtime 무관), `asyncio` → `Promise` + `AbortController`)

# ts-agent-rules — TS 백엔드 공통 룰 카탈로그

> 본 skill = TS 백엔드의 *룰 카탈로그* — 어디서 어떤 룰을 invoke 하는지 + core-infrastructure 의 Python 특화 원칙 중 TS 측에 분산 흡수되지 못한 잔여분을 직접 정의한다.
> Cited from: Python 측 `python-agent-rules` (rename per 메모리 룰 — `python-` 도메인 prefix → `ts-`).

## 이 skill 은 언제 invoke 되는가

- 세션 시작 시 자동 로드 (TS 백엔드 컨텍스트)
- "이게 어느 룰에 해당하지?" 의문 시
- 새 영역 (route / provider / tool / sub-agent / 미디어 등) 작업 시작 시
- code review — 변경된 영역에 걸리는 룰 묶음 확인
- "Python 측에는 이 룰이 있는데 TS 측에서는?" 매핑 필요 시

## 카탈로그 구조 (78 SKILL.md)

`plugins/stack-backend-ts/skills/` 아래에 분류별 SKILL.md 가 있다 — `metadata.role` 로 구분:

| role | 개수 | 역할 |
|---|---|---|
| invariant | 18 (architecture-invariants 메타 포함) | 지속 강제 — 위반 시 큰 비용 |
| workflow | 39 | 작업 절차 + 구현 가이드 |
| audit | 21 | grep 기반 점검 (Python 1:1 변환 + TS-only 신규 합산) |

본 SKILL.md 가 다루지 않는 것 = 개별 룰 본문 (각 SKILL.md 가 정본). 본 카탈로그는 **인덱스 + 자주 묶이는 룰 묶음 + core-infrastructure 잔여분 흡수** 만.

## 자주 묶이는 룰 묶음

| 상황 | 묶음 |
|---|---|
| 새 route 추가 | api-routing + error-handling + auth + test-scaffold + http-error-sentinels |
| 새 provider 추가 | provider-scaffold + provider-retry-matrix + provider-catalog-sync + provider-layer |
| 새 LLM 호출 | provider-layer + token-budget-constants + sse-lifecycle |
| context 초과 임박 | compaction + compaction-thresholds + token-budget-constants |
| 새 tool 등록 | tool-system + tool-sort-order + mcp-namespace |
| 새 sub-agent | sub-agent + spawn-limits + run-policy-presets + agent-loop-invariants |
| 새 SSE 이벤트 | sse-streaming + sse-lifecycle + single-writer |
| 미디어 처리 | media-pipeline-patterns + media-job-lifecycle (R2 어댑터) |
| 사용자 입력 처리 | input-safety-gate-ordering + input-safety-audit + http-error-sentinels |
| 도메인 영역 분리 검증 | app-domain-boundary + app-domain-boundary-audit |
| 배포 전 | scripts/audit-all.sh (21 audit 전체) |

## core-infrastructure 흡수 보충

> port-map.md §"core-infrastructure 흡수 추적" 의 △ 6 건 중 일부를 본 SKILL.md 가 직접 흡수한다 (TYPE_CHECKING / 이중 변환 금지 / interface DI / Stateless / AsyncLocalStorage 10 필드 / 영향도 표).

### 1. 타입 경계 — 외부 SDK → 내부 타입 단일 변환

- 서브시스템 간 경계는 통일된 **내부 타입** (zod schema 또는 TS interface) 으로만 통신. 외부 SDK 타입은 경계에서 즉시 변환
- 외부 SDK 타입은 `import type` (TS 의 type-only import) 만 — 런타임 코드에 전파 ✕
- **이중 변환 금지** — 각 provider 의 `convertTo()` / `convertFrom()` 단일 지점에서만 변환. 호출 chain 어디서도 다시 변환 ✕
- TS 의 `import type` = Python 의 `TYPE_CHECKING` 대응 (런타임 import 없이 타입만)

```typescript
// ❌ 외부 SDK 타입 전파
import { Message as AnthropicMessage } from '@anthropic-ai/sdk'
function processMessage(m: AnthropicMessage) { ... }  // ❌ 경계 누출

// ✅ 내부 타입으로 변환
import type { Message as AnthropicMessage } from '@anthropic-ai/sdk'
import type { Message } from './types.ts'  // 내부

function convertFrom(m: AnthropicMessage): Message { ... }  // 단일 변환 지점
function processMessage(m: Message) { ... }  // 내부 타입만 받음
```

### 2. interface 기반 DI (TS 의 Protocol 대응)

- Python `typing.Protocol` + `@runtime_checkable` → TS `interface` (structural typing 자동)
- 호출자는 interface 타입 힌트로 받음. 구체 클래스 이름에 의존 ✕
- 정의 위치:
  - `ToolProtocol` → `src/tools/types.ts` (`tool-system` skill)
  - `ProviderProtocol` → `src/providers/types.ts` (`provider-layer` skill)
  - `SessionPort` / `SessionHistoryPort` / `MediaJobPort` → `src/storage/ports.ts` (`database` skill)

```typescript
// ✅ interface DI
export interface ProviderProtocol {
  callStream(req: Request): AsyncIterable<Chunk>
  name(): string
}

// 호출자 = interface 의존
async function runLoop(provider: ProviderProtocol, ...) { ... }

// 구체 구현
class AnthropicProvider implements ProviderProtocol { ... }
class OpenRouterProvider implements ProviderProtocol { ... }
```

`@runtime_checkable` 동등은 TS 에 없음 — runtime 검사 필요 시 zod schema 또는 type guard 함수로 처리.

### 3. Stateless 서비스 — module-level mutable state ✕

- `src/services/*` 는 요청 간 mutable state ✕
- 상태가 필요하면 (1) 요청 인자로 전달, (2) 외부 저장소 (Postgres / Redis / object storage 등) 위임, (3) TTL 명시 Cache 주입
- **모듈 전역 mutable state ✕** — module-level `let counter = 0` 같은 mutable 변수는 (a) serverless / isolate runtime 에서 인스턴스 재사용 보장 ✕, (b) 동일 process 안에서도 동시 요청 race 위험 → 항상 stateless
- 요청 컨텍스트는 framework 가 제공하는 *요청 범위* 객체로만 (`<framework context store>` / `<framework env binding>` — 각 framework 의 *요청별 context store* 추상) — global 로 새지 않음

```typescript
// ❌ module-level mutable (framework-neutral pseudo)
let requestCount = 0
export function handler(ctx) {
  requestCount++  // ❌ 인스턴스 race + 누수
  return <framework json response>(ctx, { count: requestCount })
}

// ✅ stateless — 외부 저장소 또는 요청 컨텍스트
export async function handler(ctx) {
  const store = <framework env binding>(ctx).COUNTER_STORE  // KV/Redis/etc adapter
  const count = Number(await store.get('total') ?? 0) + 1
  await store.put('total', String(count))
  return <framework json response>(ctx, { count })
}
```

### 4. AsyncLocalStorage 10 필드 (Python ContextVar 대응)

Node.js `AsyncLocalStorage` (대부분 TS 런타임 지원) 를 ContextVar 대응으로 사용. 10 필드 고정:

```typescript
// src/observability/contextvars.ts
import { AsyncLocalStorage } from 'node:async_hooks'

export interface LogContext {
  request_id?: string
  trace_id?: string
  span_id?: string
  session_id?: string
  user_id?: string
  run_name?: string
  agent?: string
  model?: string
  turn_count?: number
  spawn_depth?: number
}

export const ALL_FIELDS = [
  'request_id', 'trace_id', 'span_id', 'session_id', 'user_id',
  'run_name', 'agent', 'model', 'turn_count', 'spawn_depth',
] as const satisfies readonly (keyof LogContext)[]

const storage = new AsyncLocalStorage<LogContext>()

export function bindLogContext(extra: Partial<LogContext>, fn: () => Promise<void>) {
  // 화이트리스트 검증 — 오타 키는 throw
  for (const k of Object.keys(extra)) {
    if (!(ALL_FIELDS as readonly string[]).includes(k)) {
      throw new Error(`unknown log context field: ${k}`)
    }
  }
  const current = storage.getStore() ?? {}
  return storage.run({ ...current, ...extra }, fn)
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {}
}
```

- `bindLogContext` / `getLogContext` 만 외부 노출 — `storage.run` 직접 호출 ✕ (whitelist 우회)
- 값이 없으면 `undefined` (OMITTED) — `null` 명시 ✕
- 요청 범위 상태에만 — 부팅 설정 ✕
- Sub-agent spawn: 자식 안에서 `spawn_depth + 1` 로 rebind (부모 오염 방지)
- 테스트: 매 테스트 시작 시 `storage.run({}, ...)` 으로 fresh context

### 5. 예외 계층

`src/exceptions.ts` — 4종만:

```
AppError
├── ValidationError       — 입력/설정 형식
├── ConfigurationError    — env/시크릿 누락. 부팅 실패
├── ResourceError         — 미존재/접근불가. 재시도 가능
└── InternalError         — 불변식 위반. 재시도 무의미
```

상세 (4 패턴 + 복구 전략) 는 `error-handling` workflow + `http-error-sentinels` invariant 참조.

### 6. 캐시 안정성 (prefix 보호)

prompt cache 무효화는 세션 전체 토큰 비용 수 배 상승. 아래 불변이 prefix 를 고정:

- **도구 정렬**: built-in (이름순) → MCP (이름순). 순서 변경 ✕ → `tool-sort-order` invariant
- **3-Layer system prompt**: base → agent → context_hint. 동적 값 ✕ → `context-assembly` workflow
- **Attachment 수집 순서**: 고정 ordinal. 기존 순서 변경 ✕ (append-only) → `context-assembly` workflow
- **CacheSafeParams (sub-agent fork)**: 부모의 prompt + tools + model byte-identical 상속 → `spawn-limits` invariant
- **도구 정의**: system prompt 에 inline ✕. API `tools` 파라미터로 별도 전달

## 영향도 표 (변경 → 영향 영역)

| 변경 | 영향받는 곳 |
|---|---|
| SSE 이벤트 타입 추가/삭제 | `SSEEventType` literal + stream 모듈 + 클라이언트 파서 + `sse-streaming` workflow + frontend contract 문서 |
| SSE lifecycle 순서 변경 | 클라이언트 상태 머신 파괴 — 사실상 breaking change |
| 내부 타입 (Message / ContentBlock) 변경 | 모든 provider 의 `convertTo/from` + engine + tools |
| AsyncLocalStorage 필드 추가/삭제 | `ALL_FIELDS` 상수 + 미들웨어 + 로깅 설정 + 테스트 fixture + `bindLogContext` 화이트리스트 |
| 예외 계층 변경 | `error-handling` 의 4 패턴 / 4 예외 맵 + 모든 catch 블록 매칭 |
| 캐시 prefix 불변 3종 (도구 정렬 / Attachment 순서 / CacheSafeParams) 변경 | 모든 세션의 prompt cache 즉시 무효화 |
| MAX_SPAWN_DEPTH 변경 | `spawn-limits` invariant + `sub-agent` workflow + audit + 런타임 가드 |
| RunPolicy 필드 추가/제거 | `run-policy-presets` invariant + 4 preset 템플릿 + `new-run` workflow + cross-field validator + 모든 기존 yaml |

## 금지 사항 (cross-cutting)

- SSE payload 에 session-wide 불변 메타 (token 수, cost, model, session_id) 혼합 — HTTP 헤더 또는 별도 이벤트
- module-level mutable state 로 요청 상태 관리
- 서브시스템 경계에서 외부 SDK 타입 반환 (반드시 내부 타입으로 변환)
- 화이트리스트 우회 (`storage.run` 직접 호출 등)
- AsyncLocalStorage 에 `null` 명시 set (OMITTED 원칙 위반)
- 동적 값 (timestamp / turn count / session id) 을 prompt prefix 에 inline
- `await new Promise(r => setTimeout(r, 0))` 같은 yield 꼼수 — proper async/await 사용

## 본 카탈로그가 다루지 않는 것 (의도적 제외)

| 제외 항목 | 이유 |
|---|---|
| Memory 3-Tier (session / long-term / episodic) | tool-use 기반 (Anthropic Memory Tool) + 단일 영속층 (Session 포트) 와 직접 충돌 |
| 자체 connection pool 클래스 | 런타임/플랫폼 제공 pool (Hyperdrive / pgbouncer / 라이브러리 내장) 사용. 별도 pool 도입 ✕ |
| LangChain / LangGraph 추상화 | 직접 provider SDK 호출 (`src/providers/<name>.ts`) — chain abstraction 비용 ✕ |
| 500/300줄 등 문서 길이 강제 제한 | 단일 집중 문서 철학 (build plan + 설계 doc) 유지 |
| Next.js / RSC / Server Actions | 메모리 룰 + spec §1.2 절대 금지 (분리 방향 충돌) |
| BYOK (사용자 자기 키 가져오기) | 게이트웨이 (OpenRouter 등) 로 일원화 — spec §1.2 절대 금지 |

이 6 항목이 코드에 들어가려는 신호 (예: 새 `memory/` 디렉토리, `Pool` 클래스, `langchain` import, `next/*` import) 가 발견되면 즉시 사용자 확인.

## 다른 skill 과의 관계

본 skill 은 **Layer 2 (L2) reference** 카탈로그다. Layer 1 구현 skill 과 역할이 다르다:

| Layer | skill 예 | 역할 |
|---|---|---|
| L1 구현 | `agent-loop`, `tool-system`, `provider-layer`, `context-assembly`, `sse-streaming` 등 | 특정 파일/모듈을 작성할 때 로드. 서브시스템별 계약 + 불변식 |
| L2 정책 (본 skill) | `ts-agent-rules` | TS / 에이전트 공통 룰. 어느 파일을 작성하든 참고 |
| L2 index | `backend-overview` | "어디에 무엇이 있는지" thin index |
| L2 메타 | `architecture-invariants` | 18 invariant 카탈로그 + 라우팅 |

**로딩 순서 권장**:
1. 세션 시작 시: `backend-overview` (어디에 무엇이 있는지) + `architecture-invariants` (어느 invariant 가 어디 적용) + 본 `ts-agent-rules` (어떻게 작성)
2. 특정 작업 시작 시: 해당 L1 skill (예: provider 추가 → `provider-layer`)
3. 작업 중 룰 의문 시: 본 카탈로그의 관련 룰 묶음 lazy load

본 skill 은 L1 skill 과 **중복 ✕** — L1 이 서브시스템 특정 계약을 다루면 본 카탈로그는 TS 공통 + cross-cutting 만 다룬다.

## 자주 보는 함정

- **"이 패턴이 룰에 맞는지 모르겠다"** → 본 카탈로그의 "금지 사항" + 해당 영역의 invariant 먼저 확인
- **"Python 측에는 있는 룰이 TS 측에 없다"** → port-map.md 의 누락 행 확인. 진짜 누락이면 사용자 보고
- **module-level state 도입 시도** → 런타임 인스턴스 재사용 불보장 → 항상 stateless 또는 외부 저장소
- **외부 SDK 타입 transparently re-export** → 경계 누출. 즉시 내부 타입으로 변환
- **AsyncLocalStorage 화이트리스트 우회** — `storage.run` 직접 호출 발견 시 `bindLogContext` 로 강제 통일

## 검증 체크리스트

이 skill 자체는 정적 카탈로그라 lint 의무는 없지만, 카탈로그가 78 SKILL.md 와 동기화돼야 한다:

- [ ] `plugins/stack-backend-ts/skills/` 안 SKILL.md 개수 = 78 (architecture-invariants + ts-agent-rules 포함)
- [ ] 18 invariant SKILL.md 가 모두 `architecture-invariants` 카탈로그에 등재
- [ ] 39 workflow SKILL.md 가 모두 `backend-overview` 인덱스에 등재
- [ ] 21 audit SKILL.md 가 모두 `scripts/audit-all.sh` 에 등재
- [ ] 본 SKILL.md "자주 묶이는 룰 묶음" 표의 모든 룰명이 실제 SKILL.md 디렉토리로 존재
- [ ] `core-infrastructure 흡수 보충` 6 항목 모두 본문에 명시 (TYPE_CHECKING / interface DI / Stateless / AsyncLocalStorage / 예외 / 캐시)

## 구현 중 막히면

- "이 영역에 어떤 룰이 걸리지?" → 본 SKILL.md "자주 묶이는 룰 묶음" 표 또는 `architecture-invariants` "적용 매핑" 표
- "Python 측 룰을 TS 로 어떻게?" → §4.4 매트릭스 (각 SKILL.md 의 frontmatter 아래 첫 줄) + port-map.md
- 새 룰 추가 필요 → 카테고리 결정 (invariant / workflow / audit) → 별도 SKILL.md → 본 카탈로그 + `architecture-invariants` (invariant 일 때) + `audit-all.sh` (audit 일 때) 갱신
