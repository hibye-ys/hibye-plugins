---
name: provider-layer
description: <api-app> 에 새 LLM provider 추가 / 기존 provider retry/timeout 정책 변경 / OpenRouter 게이트웨이 우회 (Anthropic·OpenAI·Google 직접 SDK escape hatch) 시 invoke. provider 코드 수정, model resolution 분기 변경, retry storm 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/provider-layer + rules/ai-provider-patterns.md
---

**적용된 §4.4 매트릭스 행**: `httpx.AsyncClient` → `fetch(url, init)`, `tenacity` → `p-retry` 또는 수동 `for/try/catch/backoff`, `pydantic BaseModel` → `z.object({...})` / `TypeScript interface`, `typing.Protocol` → `TypeScript interface`, `@functools.cache` → `let cachedResult: ... | null = null` (모듈 레벨 변수), `asyncio.sleep` → `await new Promise(r => setTimeout(r, ms))`, `asyncio.create_task` → `(async () => { ... })()` / Promise (fire-and-forget), `asyncio.CancelledError` → `AbortController` signal check, `os.getenv` → `<framework env binding>.<KEY>`

# provider-layer — Provider 추상화 + Model Resolution 청사진

## 이 skill은 언제 invoke 되는가

- `src/ai/providers/*.ts` 최초 작성 또는 수정
- `src/ai/model-resolution.ts` 작성 또는 resolve 분기 수정
- 새 Provider 추가 (예: Anthropic 직접 SDK escape hatch, OpenAI, Google)
- "model resolution miss", "retry storm", "provider-format 변환 버그" 디버깅
- `connectedProviders()` 가 stale 값을 돌려주는 증상

## Provider Layer의 정체성

Provider Layer는 LLM 호출의 모든 실측 디테일을 한 곳에 격리한다. 다섯 개의 부품으로 이뤄진다:

1. **Provider Interface** — 모든 provider가 구현해야 하는 TypeScript `interface` (`callStream`, `countTokens`).
2. **Unified Message / ContentBlock** — provider별 포맷 차이를 흡수하는 내부 표준 타입. Agent Loop는 이 포맷만 본다.
3. **Model Resolution** — agent spec + 사용자 요청 + fallback 으로부터 실제 model id 를 결정하는 4단계 알고리즘.
4. **Connected Providers Cache** — 어떤 provider가 활성화돼 있는지 한 번 검사 후 모듈 수명 캐시.
5. **Retry Policy** — foreground / background 차등 + provider 별 429 / 529 / 5xx 처리.

## Provider Interface

```typescript
// src/ai/providers/base.ts
import { z } from 'zod'

export const ContentBlockSchema = z.object({
  type: z.enum(['text', 'image', 'tool_use', 'tool_result']),
  text: z.string().optional(),
  source: z.record(z.unknown()).optional(),       // image source dict
  id: z.string().optional(),                      // tool_use id
  name: z.string().optional(),                    // tool name for tool_use
  input: z.record(z.unknown()).optional(),         // tool args for tool_use
  tool_use_id: z.string().optional(),             // for tool_result back-reference
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
  is_error: z.boolean().optional(),
})

export type ContentBlock = z.infer<typeof ContentBlockSchema>

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.array(ContentBlockSchema),
})

export type Message = z.infer<typeof MessageSchema>

export interface ProviderEvent {
  type: 'text_delta' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'done' | 'error'
  payload: Record<string, unknown>
}

export interface Provider {
  name: string
  model: string
  supportsTools: boolean
  supportsStreaming: boolean

  callStream(opts: {
    system: string
    messages: Message[]
    tools: Record<string, unknown>[]
    maxTokens?: number
  }): AsyncIterable<ProviderEvent>

  countTokens(messages: Message[]): number
}
```

> `Message` / `ContentBlock` 은 **내부 표준 타입**. provider 별 변환은 각 Provider 클래스 안에서만. Agent Loop 는 절대 provider-native 포맷을 다루지 않는다.

## Model Resolution 4단계

```typescript
// src/ai/model-resolution.ts
export function resolveModel(opts: {
  explicit?: string
  agentPref?: string
  fallbackChain?: string[]
  default?: string
  env: Env
}): string {
  const { explicit, agentPref, fallbackChain = [], default: def = 'claude-sonnet-4-6', env } = opts
  const candidates = [explicit, agentPref, ...fallbackChain, def].filter(Boolean) as string[]

  for (const candidate of candidates) {
    const resolved = fuzzyMatch(candidate)
    if (providerFor(resolved) in connectedProviders(env)) {
      return resolved
    }
  }
  throw new Error('No connected provider for any candidate model')
}
```

### Stage 1 — explicit
사용자가 직접 지정한 경우 (API param, test fixture). 가장 높은 우선순위.

### Stage 2 — agent preference
`src/agents/<name>.ts` 또는 YAML 의 `model:` 필드.

### Stage 3 — fallback chain
설정 파일의 `fallbackChain:` 배열. 첫 번째 활성 provider에 대응하는 model 선택.

### Stage 4 — hard default
모든 단계 실패 시 `claude-sonnet-4-6`. 이 값마저 unavailable 이면 Error throw — silent fallback 금지.

## Fuzzy Match + Connected Providers Cache

```typescript
const FUZZY_MAP: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5',
  gpt5: 'gpt-5',
  'gpt-5': 'gpt-5',
  '4.1-opus': 'claude-opus-4-1',
}

export function fuzzyMatch(name: string): string {
  return FUZZY_MAP[name.toLowerCase()] ?? name
}

// 모듈 레벨 캐시.
// Runtime-specific 캐시 lifetime:
//   - isolation 기반 runtime (예: edge function): 같은 invocation 안 1회만 검사, cold start 마다 재검사
//   - process 기반 runtime (예: 장기 Node 프로세스): process lifetime, 재시작 전까지 캐시
// (instance 측 project-local skill 참조)
let _cachedConnectedProviders: Set<string> | null = null

export function connectedProviders(env: Env): Set<string> {
  if (_cachedConnectedProviders) return _cachedConnectedProviders
  const connected = new Set<string>()
  if (env.ANTHROPIC_API_KEY) connected.add('anthropic')
  if (env.OPENAI_API_KEY) connected.add('openai')
  if (env.OPENROUTER_API_KEY) connected.add('openrouter')
  if (env.GEMINI_API_KEY) connected.add('gemini')
  _cachedConnectedProviders = connected
  return connected
}

// 테스트에서 반드시 캐시 무효화
export function clearConnectedProvidersCache(): void {
  _cachedConnectedProviders = null
}

export function providerFor(modelId: string): string {
  if (modelId.startsWith('claude-')) return 'anthropic'
  if (modelId.startsWith('gpt-') || modelId.startsWith('o')) return 'openai'
  if (modelId.startsWith('gemini-')) return 'gemini'
  // OpenRouter default for anything else
  return 'openrouter'
}
```

> `_cachedConnectedProviders` 는 runtime 별 lifetime — isolation 기반 runtime 에서는 cold start 마다 재검사, process 기반 runtime 에서는 process lifetime (instance 측 project-local skill 참조). 테스트에서 반드시 `clearConnectedProvidersCache()` 호출.

## Retry Policy — Foreground vs Background

| 정책 | Foreground | Background |
|---|---|---|
| 최대 재시도 횟수 | 5 | 2 |
| 백오프 base | 0.5초 | 5초 |
| 백오프 max | 8초 | 60초 |
| 429 재시도 | Yes | Yes |
| 529 재시도 | Yes — allowlist 출처만 | No |
| 5xx 재시도 | Yes | No |

```typescript
// src/ai/retry.ts
const FOREGROUND_529_RETRY_SOURCES = new Set(['anthropic', 'bedrock'])

export async function withRetry<T>(
  call: () => Promise<T>,
  opts: { isForeground: boolean; provider: string; maxRetries?: number }
): Promise<T> {
  const { isForeground, provider, maxRetries } = opts
  const maxAttempts = maxRetries ?? (isForeground ? 5 : 2)
  const base = isForeground ? 500 : 5000   // ms
  const cap = isForeground ? 8000 : 60000  // ms

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await call()
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status
      const isRateLimit = status === 429
      const isOverload = status === 529
      const isServerError = status !== undefined && status >= 500 && status !== 529

      if (isRateLimit || (isOverload && isForeground && FOREGROUND_529_RETRY_SOURCES.has(provider)) || (isServerError && isForeground)) {
        const delay = Math.min(base * Math.pow(2, attempt), cap)
        // AbortSignal 체크 — abort 되었으면 즉시 throw
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delay)
          // AbortController integration point
          if (typeof AbortController !== 'undefined') {
            // caller can pass signal for cancellation
          }
        })
        continue
      }
      throw err
    }
  }
  throw new Error(`Max retries exceeded after ${maxAttempts} attempts (${provider})`)
}
```

## Stream Tee — 이중 소비 패턴

Agent Loop Stage 3 는 provider stream 을 SSE forward 와 tool_use 수집에 동시 사용해야 한다. 단순 한 번 소비로는 양쪽을 모두 처리할 수 없다 — `ReadableStream.tee()` 패턴:

```typescript
// src/ai/providers/tee.ts
// pump-and-buffer 패턴: source 를 두 independent queue 로 분기
// type-safe: 일반 function → Promise<[...]> tuple 반환 (async function* 는 return tuple 불가)
export function teeStream(
  source: AsyncIterable<ProviderEvent>
): [AsyncIterable<ProviderEvent>, AsyncIterable<ProviderEvent>] {
  const forwardQueue: ProviderEvent[] = []
  const collectQueue: ProviderEvent[] = []
  const done = { value: false }

  // pump in background
  ;(async () => {
    for await (const event of source) {
      forwardQueue.push(event)
      collectQueue.push(event)
    }
    done.value = true
  })()

  // forward async iterable
  const forward = async function* () {
    while (!done.value || forwardQueue.length > 0) {
      if (forwardQueue.length > 0) yield forwardQueue.shift()!
      else await new Promise(r => setTimeout(r, 0))
    }
  }

  // collect async iterable
  const collect = async function* () {
    while (!done.value || collectQueue.length > 0) {
      if (collectQueue.length > 0) yield collectQueue.shift()!
      else await new Promise(r => setTimeout(r, 0))
    }
  }

  return [forward(), collect()]
}
```

## Provider-specific Quirks

| Provider | tool 호출 표현 | streaming 단위 | 알려진 함정 |
|---|---|---|---|
| Anthropic | `tool_use` block in assistant content | SSE event per delta | `cache_control: ephemeral` 에 따라 캐시 적중률 급변 |
| OpenAI | `function_call` (legacy) / `tools` (chat completions) | `delta.tool_calls` | function 이름 64자 제한 |
| OpenRouter | provider별로 다름 (내부 라우팅) | 표준 OpenAI 포맷 | 신모델 등록 지연 시 escape hatch 필요 |

> **Default = OpenRouter** (multi-provider 한 SDK 안 접근). Escape hatch = provider 직접 SDK (신모델 등록 지연 시만). `src/ai/providers/<name>.ts`.

## 검증 체크리스트

- [ ] `Provider` interface 가 `callStream` + `countTokens` + 4 속성 (`name`, `model`, `supportsTools`, `supportsStreaming`) 포함
- [ ] `ContentBlock` / `Message` 가 zod schema 로 정의 (`z.object`, `z.infer`)
- [ ] `resolveModel` 이 4-stage 분기 명시 (`explicit → agentPref → fallbackChain → default`)
- [ ] `fuzzyMatch` + `FUZZY_MAP` (최소 sonnet/opus/haiku/gpt5)
- [ ] `connectedProviders()` 가 모듈 레벨 캐시 + `clearConnectedProvidersCache()` 노출
- [ ] `withRetry` 가 foreground / background 분기 + `FOREGROUND_529_RETRY_SOURCES` 참조
- [ ] Stream tee 패턴이 provider stream 소비 경로에 적용됨
- [ ] `provider-retry-matrix` invariant 참조 확인

## 구현 중 막히면

- "Model id 가 alias" → `FUZZY_MAP` 에 alias 추가. key 는 반드시 lowercase
- "Stream 을 forward 하면서 수집이 안 됨" → tee 패턴. `teeStream()` 활용
- "Retry 무한 루프" → `maxAttempts` 명시 + sleep cap + error status 정확히 분류
- "Test 에서 connectedProviders 값 이상" → `clearConnectedProvidersCache()` 호출 누락
- "Anthropic vs OpenAI tool 포맷 섞임" → 각 Provider 클래스 내부에서만 변환
