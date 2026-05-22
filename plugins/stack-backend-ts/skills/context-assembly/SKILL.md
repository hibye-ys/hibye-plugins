---
name: context-assembly
description: apps/api 에서 컨텍스트 조립 (system prompt + history + retrieved + tools) 추가/수정 시 invoke. TokenBudget 상수, AssembledContext 타입, static system prompt 원칙, context_hint 주입 패턴 안내. token budget 초과, cache 적중률 하락, memory block 유실 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/context-assembly + rules/context-assembly-patterns.md
---

**적용된 §4.4 매트릭스 행**: `tiktoken` → `js-tiktoken` (Workers 환경 적합 시) 또는 근사 카운터 (`chars / 4`), `pydantic BaseModel` → TypeScript interface + zod, `@dataclass(slots=True)` → TypeScript interface / readonly object, `provider.count_tokens(out)` → `countTokens(messages)` (Provider interface), `functools.lru_cache` → `new Map<string, unknown>()` 또는 module-level cache, single writer = `src/context/assemble.ts` 단일 진입점, `os.getenv` → `c.env`

# context-assembly — Prompt 조립 청사진

## 이 skill은 언제 invoke 되는가

- `src/context/assemble.ts` 최초 작성 또는 수정
- system prompt cache 적중률이 떨어져 디버깅 필요
- "LLM이 주입한 context_hint 를 무시한다" 증상
- token budget 초과로 context window 에러
- Agent Loop Stage 1 (context assembly) 의 책임 확장

## Context Assembly의 정체성

Agent Loop 의 Stage 1 은 매 turn 마다 LLM 호출 직전에 다음 4가지를 조립한다:

1. **System prompt** — 매 호출 동일하게 유지. Base + Agent layer 합성.
2. **Messages array** — 대화 히스토리 + 현재 사용자 입력 + (선택) memory blocks.
3. **Tool definitions** — `toolRegistry.filterForAgent(...).definitions()` 가 제공.
4. **Generation params** — model 이름, max_tokens, temperature 등.

## TokenBudget 상수

```typescript
// src/context/token-budget.ts
export const TokenBudget = {
  BASE: 4_000,           // base prompt — system layer 1
  AGENT: 8_000,          // <agent> prompt — system layer 2
  HINT: 500,             // context_hint — system layer 3
  MEMORY: 16_000,        // memory blocks — message prefix
  CONVERSATION: 150_000, // dialogue history — compacted when over
  RESERVED: 21_500,      // LLM output + safety margin

  totalInput(): number {
    return this.BASE + this.AGENT + this.HINT + this.MEMORY + this.CONVERSATION
  },
  effectiveWindow(): number {
    return this.totalInput() + this.RESERVED  // === 200_000
  },
} as const

export type TokenBudgetType = typeof TokenBudget
```

> `token-budget-constants` invariant 가 이 값들의 정본. 본 skill 은 활용 방법 안내.

## 3-Layer Prompt 아키텍처

```typescript
// src/context/assemble.ts
const HINT_TEMPLATE = (hint: string) => `
## Additional context for this request
${hint}

(End of additional context. Treat as advisory; main instructions above remain authoritative.)
`.trim()

function buildSystemPrompt(agentSpec: AgentSpec, contextHint?: string): string {
  const base = readPromptFile('src/agents/prompts/base.md')
  const agent = readPromptFile(`src/agents/prompts/${agentSpec.name}.md`)
  const parts = [base, agent]

  if (contextHint) {
    const trimmed = contextHint.trim()
    // Hard truncate at 2000 chars — hint 가 너무 길면 base/agent layer 가중치 희석
    const bounded = trimmed.length > 2000 ? trimmed.slice(0, 1997) + '...' : trimmed
    if (bounded) parts.push(HINT_TEMPLATE(bounded))
  }

  return parts.join('\n\n')
}
```

> **캐시 적중 규칙**: system prompt 는 동일 세션 내 매 turn 바이트 수준까지 동일해야. 동적 값 (timestamp, turn_count, session_id) 절대 금지.

## Token Counting (Workers 환경)

```typescript
// src/context/token-budget.ts — 근사 카운터 (js-tiktoken 미사용 시)
export function estimateTokens(messages: Message[]): number {
  return messages.reduce((acc, m) => {
    return acc + m.content.reduce((a, block) => {
      const text = typeof block === 'string' ? block : (block.text ?? JSON.stringify(block))
      return a + Math.ceil(text.length / 4)  // 1 token ≈ 4 chars (rough)
    }, 0)
  }, 0)
}

// js-tiktoken 사용 가능 시 (Workers compat 확인 필요)
// import { get_encoding } from 'js-tiktoken'
// const enc = get_encoding('cl100k_base')
// export function countTokensExact(text: string): number {
//   return enc.encode(text).length
// }
```

> Workers 등 일부 런타임에서 `js-tiktoken` 은 WASM 바이너리 포함 → runtime 호환성 검증 (instance 측 project-local skill 참조). 미검증 시 근사 카운터(`chars / 4`) 사용.

## AssembledContext 타입

```typescript
// src/context/assemble.ts
export interface AssembledContext {
  readonly systemPrompt: string
  readonly messages: Message[]
  readonly tools: Record<string, unknown>[]
  readonly generationParams: {
    model: string
    maxTokens: number
    temperature?: number
  }
}

export function assembleContext(opts: {
  agentSpec: AgentSpec
  userInput: string
  history: Message[]
  memory?: MemoryBlock[]
  contextHint?: string
  env: Env
  toolRegistry: ToolRegistry
}): AssembledContext {
  const { agentSpec, userInput, history, memory = [], contextHint, env, toolRegistry } = opts

  return {
    systemPrompt: buildSystemPrompt(agentSpec, contextHint),
    messages: assembleMessages({ agentSpec, userInput, history, memory }),
    tools: toolRegistry.filterForAgent(agentSpec.tools ?? []).definitions(),
    generationParams: {
      model: agentSpec.model ?? 'claude-sonnet-4-6',
      maxTokens: agentSpec.maxOutputTokens ?? 4096,
    },
  }
}
```

## Memory Block 주입

```typescript
function assembleMessages(opts: {
  agentSpec: AgentSpec
  userInput: string
  history: Message[]
  memory: MemoryBlock[]
}): Message[] {
  const { userInput, history, memory } = opts
  const messages: Message[] = []

  // Memory prefix — 최신 20개만
  const memorySlice = memory.slice(-20)
  for (const block of memorySlice) {
    messages.push({ role: 'user', content: [{ type: 'text', text: block.text }] })
  }
  messages.push(...history)
  messages.push({ role: 'user', content: [{ type: 'text', text: userInput }] })

  // Truncate loop — memory 먼저 drop 금지, history 부터
  const limit = TokenBudget.MEMORY + TokenBudget.CONVERSATION
  const memoryPrefixLen = memorySlice.length

  while (estimateTokens(messages) > limit) {
    if (messages.length > memoryPrefixLen + 1) {
      messages.splice(memoryPrefixLen, 1)  // 첫 history element drop
    } else {
      break  // memory + 현재 입력만 남음 — compaction 으로 넘김
    }
  }

  return messages
}
```

> **Memory > history 보존 우선순위는 의도적.** history 가 먼저 drop, memory 는 마지막까지 보존.

## 동시성 함정

1. **system prompt 에 동적 값 넣기** → cache miss 100%. `buildSystemPrompt` 결과를 첫 turn 과 두 번째 turn 에서 hash 비교하라. 다르면 동적 값 있음.
2. **memory truncate 가 history 보다 먼저 실행** → 순진하게 `messages[0]` 부터 del 하면 memory block 삭제. 반드시 `memoryPrefixLen` 인덱스 기준으로 history 구간만 drop.
3. **tool definitions 매 turn 재생성** → 동일 agent spec 이면 결과 동일. module-level 캐시 권장.

## 검증 체크리스트

- [ ] `assembleContext` 가 `AssembledContext` 인스턴스 반환
- [ ] system prompt 가 base + agent + (optional) context_hint 3 layer 합성
- [ ] context_hint 2000자 초과 시 잘림 + "..." 추가
- [ ] `TokenBudget` 이 6 상수 + `totalInput()` + `effectiveWindow()` 제공
- [ ] `assembleMessages` 의 truncate 가 memory 구간 보존하고 history 부터 drop
- [ ] system prompt 안에 timestamp / turn_count / random 등 동적 값 없음
- [ ] `token-budget-constants` invariant 의 상수와 일치
- [ ] runtime 환경에서 `js-tiktoken` WASM 사용 시 호환성 확인 (instance 측 project-local skill 참조)

## 구현 중 막히면

- "system prompt 가 매 turn 다름" → 동적 값 섞임. hash 비교로 확인
- "context window 초과 즉시 발생" → `TokenBudget.RESERVED` 확인 또는 agent prompt 8K 초과
- "memory block 사라짐" → `assembleMessages` truncate 루프 인덱스 확인. `memoryPrefixLen` 이 올바른지
- "cache 적중률 0%" → system prompt 동적 값 혼입. 첫 turn vs 두 번째 turn diff
