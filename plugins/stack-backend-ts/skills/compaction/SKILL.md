---
name: compaction
description: <api-app> 에서 토큰 한계 접근 시 conversation 요약·압축 트리거 시 invoke. 5 전략 에스컬레이션 (snip/micro/session_memory/auto/reactive), CompactionResult 타입, COMPACTABLE_TOOLS frozenset, autoCompactThreshold 계산 안내. "context window exceeded" 에러, auto compaction 미발동 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
---

**적용된 §4.4 매트릭스 행**: `asyncio.gather` → `Promise.allSettled`, `pydantic BaseModel` → TypeScript interface + zod, `msg.model_copy(deep=True)` → `JSON.parse(JSON.stringify(messages))` (deep clone), `async for event in provider.call_stream(...)` → `for await (const event of provider.callStream(...))`, `tiktoken` 토큰 수 → 근사 카운터 (`chars / 4`) 또는 `js-tiktoken`, `os.getenv` → `<framework env binding>`

# compaction — Agent Loop Context Compaction 청사진

## 이 skill은 언제 invoke 되는가

- `src/engine/compaction.ts` 최초 작성 또는 수정
- "context window exceeded" 에러 발생했는데 auto compaction 미발동
- Agent Loop Stage 2 (compaction check) stub 을 실제 구현으로 교체

## Compaction의 정체성

Compaction 은 Agent Loop 의 **Stage 2** (pre-query) 에 해당. 매 turn 마다 provider 호출 직전에 "현재 메시지 배열이 context window 에 넘치는가?" 판단하고, 넘치면 요약/압축.

### 5 핵심 원칙

1. **정보 보존 우선** — `tool_use_id` 같은 구조적 필수 필드는 절대 제거 금지
2. **비용 최소화** — LLM 없이 처리(snip) 가능하면 LLM 없이. 필요하면 경량 모델
3. **전략 에스컬레이션** — snip → micro → session_memory → auto → reactive (Error Recovery only)
4. **멱등 안전성** — 이미 요약된 블록(`compacted: true` 마커)은 재요약 skip
5. **에스컬레이션 타겟** — 각 전략은 `ESCALATION_TARGET_RATIO = 0.80` 목표 (threshold 의 80%)

## autoCompactThreshold 계산

```typescript
// src/engine/compaction.ts
export const EFFECTIVE_CONTEXT_WINDOW = 200_000
export const SAFETY_BUFFER = 13_000   // max output + tool definitions 여유
export const INTERNAL_MODEL = 'claude-haiku-4-5'  // 요약용 경량 모델 (~10x cheaper)

export function autoCompactThreshold(): number {
  return EFFECTIVE_CONTEXT_WINDOW - SAFETY_BUFFER  // 187_000
}
```

> `compaction-thresholds` invariant 가 이 상수의 정본. 변경 시 invariant 동시 업데이트.

## CompactionResult 타입

```typescript
export interface CompactionResult {
  strategy: 'snip' | 'micro' | 'session_memory' | 'auto' | 'reactive'
  messages: Message[]
  itemsCompacted: number
  tokensBefore: number
  tokensAfter: number
  notes: string
}
```

## COMPACTABLE_TOOLS

```typescript
export const COMPACTABLE_TOOLS = new Set([
  'file_read', 'search', 'list_dir', 'fetch_doc',
])
// 읽기 전용 — 요약/잘라내기 안전

export const NON_COMPACTABLE_TOOLS = new Set([
  'file_write', 'create_branch', 'send_email',
])
// 부작용 확인 정보 — 요약 금지
```

## 4 전략 상세

### Strategy 1 — snip (LLM 호출 없음)

```typescript
export function snipCompact(messages: Message[], threshold: number): CompactionResult {
  const tokensBefore = estimateTokens(messages)
  // Deep clone — 원본 수정 금지 (취소 안전성)
  const working: Message[] = JSON.parse(JSON.stringify(messages))
  let itemsCompacted = 0

  for (const msg of working) {
    if (msg.role !== 'user') continue
    for (const block of msg.content) {
      if (block.type !== 'tool_result') continue
      if ((block as { compacted?: boolean }).compacted) continue
      const toolName = (block as { name?: string }).name ?? ''
      if (!COMPACTABLE_TOOLS.has(toolName)) continue
      const text = extractText(block)
      if (text.length <= 200) continue
      ;(block as Record<string, unknown>).text = text.slice(0, 197) + '...'
      ;(block as Record<string, unknown>).compacted = true
      itemsCompacted++
    }
  }

  return {
    strategy: 'snip',
    messages: working,
    itemsCompacted,
    tokensBefore,
    tokensAfter: estimateTokens(working),
    notes: `Truncated ${itemsCompacted} tool_results to 200 chars`,
  }
}
```

### Strategy 2 — micro (1회 LLM 호출)

```typescript
const MICRO_KEEP_RECENT = 6  // user/assistant 쌍 3회분

export async function microCompact(
  messages: Message[],
  threshold: number,
  provider: Provider,
): Promise<CompactionResult> {
  const tokensBefore = estimateTokens(messages)
  if (messages.length <= MICRO_KEEP_RECENT) {
    return { strategy: 'micro', messages, itemsCompacted: 0, tokensBefore, tokensAfter: tokensBefore, notes: 'Too few messages' }
  }

  const old = messages.slice(0, -MICRO_KEEP_RECENT)
  const recent = messages.slice(-MICRO_KEEP_RECENT)
  const summaryText = await llmSummarize(old, provider, {
    instruction: 'Summarize the conversation history in 2-3 sentences. Preserve: key decisions, tool outputs, file paths. Drop: verbose output.',
  })
  const summaryMsg: Message = {
    role: 'assistant',
    content: [{ type: 'text', text: summaryText, compacted: true } as ContentBlock],
  }
  const compacted = [summaryMsg, ...recent]

  return {
    strategy: 'micro',
    messages: compacted,
    itemsCompacted: old.length,
    tokensBefore,
    tokensAfter: estimateTokens(compacted),
    notes: `Summarized ${old.length} old messages`,
  }
}
```

### Strategy 3 — session_memory (이전 세션 본문 → long-term memory 이관)

이전 session 본문을 long-term memory 로 이관. history 에는 메모리 placeholder 만 남김. micro 이후에도 threshold 를 초과하는 경우 적용.

```typescript
export async function sessionMemoryCompact(
  messages: Message[],
  threshold: number,
  provider: Provider,
  opts: { memoryStore?: MemoryStore } = {},
): Promise<CompactionResult> {
  const tokensBefore = estimateTokens(messages)
  const targetTokens = Math.floor(threshold * ESCALATION_TARGET_RATIO)

  // 오래된 메시지를 long-term memory 에 이관
  const keepTail = 4
  const old = messages.slice(0, -keepTail)
  const recent = messages.slice(-keepTail)

  if (opts.memoryStore && old.length > 0) {
    const summaryText = await llmSummarize(old, provider, {
      instruction: 'Extract key facts, decisions, and context as a concise memory entry.',
    })
    await opts.memoryStore.store({ content: summaryText, timestamp: Date.now() })
  }

  // placeholder 삽입
  const placeholder: Message = {
    role: 'assistant',
    content: [{ type: 'text', text: '[이전 세션 내용이 long-term memory 에 이관됨]', compacted: true } as ContentBlock],
  }
  const compacted = [placeholder, ...recent]

  return {
    strategy: 'session_memory',
    messages: compacted,
    itemsCompacted: old.length,
    tokensBefore,
    tokensAfter: estimateTokens(compacted),
    notes: `session_memory: ${old.length} messages moved to long-term memory`,
  }
}
```

### Strategy 4 — auto (단계별 전체 요약)

```typescript
export async function autoCompact(
  messages: Message[],
  threshold: number,
  provider: Provider,
): Promise<CompactionResult> {
  // 1. snip pass (free)
  const snipResult = snipCompact(messages, threshold)
  if (snipResult.tokensAfter <= threshold) return snipResult

  // 2. chunk into groups of 10 (excluding last 4)
  const keepTail = 4
  const head = snipResult.messages.slice(0, -keepTail)
  const tail = snipResult.messages.slice(-keepTail)
  const chunks: Message[][] = []
  for (let i = 0; i < head.length; i += 10) chunks.push(head.slice(i, i + 10))

  // 3. Summarize each chunk
  const summaries: Message[] = []
  for (const chunk of chunks) {
    const text = await llmSummarize(chunk, provider, {
      instruction: 'Summarize in one paragraph. Preserve tool_use_id values, file paths, key decisions.',
    })
    summaries.push({ role: 'assistant', content: [{ type: 'text', text, compacted: true } as ContentBlock] })
  }

  const compacted = [...summaries, ...tail]
  return {
    strategy: 'auto',
    messages: compacted,
    itemsCompacted: head.length,
    tokensBefore: estimateTokens(messages),
    tokensAfter: estimateTokens(compacted),
    notes: `Auto-compacted ${head.length} messages into ${summaries.length} summaries`,
  }
}
```

### Strategy 5 — reactive (PromptTooLongError 응답 — Error Recovery only)

```typescript
export const ESCALATION_TARGET_RATIO = 0.80  // 각 전략의 목표 비율 (threshold 대비)
export const REACTIVE_TARGET_RATIO = 0.70   // reactive 는 더 공격적 (30% 여유)

export async function reactiveCompact(
  messages: Message[],
  threshold: number,
  provider: Provider,
): Promise<CompactionResult> {
  const tokensBefore = estimateTokens(messages)
  const aggressiveTarget = Math.floor(threshold * REACTIVE_TARGET_RATIO)

  const autoResult = await autoCompact(messages, aggressiveTarget, provider)
  if (autoResult.tokensAfter <= aggressiveTarget) {
    return { ...autoResult, strategy: 'reactive' }
  }

  // Last resort: strip all tool_results to placeholder with tool_use_id
  const working: Message[] = JSON.parse(JSON.stringify(autoResult.messages))
  for (const msg of working) {
    for (const block of msg.content) {
      if (block.type === 'tool_result' && !(block as { compacted?: boolean }).compacted) {
        const b = block as Record<string, unknown>
        b.text = `[output omitted — tool_use_id: ${b.tool_use_id}]`
        b.compacted = true
      }
    }
  }

  return {
    strategy: 'reactive',
    messages: working,
    itemsCompacted: tokensBefore - estimateTokens(working),
    tokensBefore,
    tokensAfter: estimateTokens(working),
    notes: `Reactive: emergency compaction`,
  }
}
```

## 전략 선택 순서 (dispatch)

```typescript
export async function compactMessages(
  messages: Message[],
  threshold: number,
  provider: Provider,
  opts: { isReactive?: boolean; memoryStore?: MemoryStore } = {},
): Promise<CompactionResult> {
  // reactive = Error Recovery only (PromptTooLongError 직접 응답)
  if (opts.isReactive) return reactiveCompact(messages, threshold, provider)

  // Stage 1: snip (LLM 없음)
  let result = snipCompact(messages, threshold)
  if (result.tokensAfter <= threshold) return result

  // Stage 2: micro (1회 LLM — 최근 N 쌍 보존)
  result = await microCompact(messages, threshold, provider)
  if (result.tokensAfter <= threshold) return result

  // Stage 3: session_memory (이전 세션 → long-term memory 이관)
  result = await sessionMemoryCompact(messages, threshold, provider, { memoryStore: opts.memoryStore })
  if (result.tokensAfter <= threshold) return result

  // Stage 4: auto (청크 단위 전체 요약)
  return autoCompact(messages, threshold, provider)
}
```

## 경량 모델 요약

```typescript
async function llmSummarize(
  messages: Message[],
  provider: Provider,
  opts: { instruction: string },
): Promise<string> {
  const dump = formatMessagesForSummary(messages)
  const summaryMessages: Message[] = [{
    role: 'user',
    content: [{ type: 'text', text: `${opts.instruction}\n\n---\n\n${dump}` }],
  }]

  const chunks: string[] = []
  for await (const event of provider.callStream({
    system: 'You are a precise conversation summarizer. Output only the summary.',
    messages: summaryMessages,
    tools: [],
    maxTokens: 1024,
  })) {
    if (event.type === 'text_delta' && typeof event.payload.text === 'string') {
      chunks.push(event.payload.text)
    }
  }
  return chunks.join('')
}
```

## 동시성 함정

1. **원본 직접 수정** → 취소 안전성 파괴. `JSON.parse(JSON.stringify(messages))` 로 deep clone 후 작업
2. **tool_use_id 유실** → orphaned tool_result 에러. reactive 최종 수단에서도 ID 보존
3. **threshold-just-met 재트리거** → `REACTIVE_TARGET_RATIO = 0.70` (30% 여유). 매 turn compaction 방지

## 검증 체크리스트

- [ ] 5 전략 (`snip` / `micro` / `session_memory` / `auto` / `reactive`) 코드에서 식별 가능
- [ ] `ESCALATION_TARGET_RATIO = 0.80` + `REACTIVE_TARGET_RATIO = 0.70` 상수 존재
- [ ] `autoCompactThreshold()` = 187,000 (`compaction-thresholds` invariant 일치)
- [ ] `COMPACTABLE_TOOLS` 에 읽기 전용 도구만 포함
- [ ] `CompactionResult` 에 6 필드 (`strategy` / `messages` / `itemsCompacted` / `tokensBefore` / `tokensAfter` / `notes`)
- [ ] `INTERNAL_MODEL = 'claude-haiku-4-5'` 사용
- [ ] `tool_use_id` 보존됨 (reactive 포함)
- [ ] deep clone 후 작업 (원본 불변)
- [ ] Vitest 기반 compaction before/after 비교 테스트
