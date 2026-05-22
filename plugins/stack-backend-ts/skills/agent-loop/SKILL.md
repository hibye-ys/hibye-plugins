---
name: agent-loop
description: apps/api 에서 agentic loop (provider → tool calls → 결과 feed → loop) 구현 / 수정 시 invoke. LoopState 관리, 에러 복구 4분기, tool concurrency 파티셔닝, compaction check 위치 안내. tool_use 무한 루프, budget 이상, 복구 분기 미발동 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/agent-loop + rules/agent-loop-patterns.md
---

**적용된 §4.4 매트릭스 행**: `asyncio.run` → `await` (top-level), `while True:` → `while (true) { ... }`, max-turn 카운터 → `let turn = 0; while (turn++ < MAX_TURNS)`, `asyncio.gather(..., return_exceptions=True)` → `Promise.allSettled([...])`, `@dataclass class LoopState` → TypeScript interface/class, `AsyncIterator` → `AsyncIterable<Event>`, `async for event in stream:` → `for await (const event of stream)`, `asyncio.CancelledError` → `AbortController` signal / `stream.onAbort`

# agent-loop — Agent Loop 서브시스템 구조 청사진

## 이 skill은 언제 invoke 되는가

- `src/engine/loop.ts`, `src/engine/recovery.ts` 최초 작성
- 위 파일 수정 (상태 추가, 에러 분기 추가, 토큰 관리 변경)
- "tool_use 무한 루프", "budget 이상 동작", "복구 분기가 안 탐" 디버깅

## Agent Loop의 정체성

Agent Loop는 하나의 사용자 요청을 받아 다음을 반복한다:

1. 컨텍스트 조립 (system prompt + history + tool definitions)
2. 컴팩션 체크 (pre-query)
3. Provider 호출 (LLM 응답 수집)
4. tool_use 수집 (assistant 메시지에서 tool 호출 블록 추출)
5. tool 실행 (안전한 것은 병렬, 아닌 것은 순차)
6. tool 결과를 대화에 병합
7. "계속할지/끝낼지" 판단

이 7단계가 `src/engine/loop.ts` 의 뼈대다. `agent-loop-invariants` invariant 가 6-stage 순서와 `LoopTransition` 8 enum 을 정본으로 관리.

## LoopState — 루프 로컬 상태

```typescript
// src/engine/loop.ts
interface LoopState {
  taskBudgetRemaining: number      // 남은 turn 수
  chainDepth: number               // sub-agent 중첩 깊이
  turnCount: number
  totalInputTokens: number
  totalOutputTokens: number
}

// 초기화
function createLoopState(maxTurns: number): LoopState {
  return {
    taskBudgetRemaining: maxTurns,
    chainDepth: 0,
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  }
}
```

> **LoopState 는 메시지 배열에 섞이면 안 된다.** compaction 시 요약되어 사라진다.

## 7단계 스켈레톤 (TS/Hono)

```typescript
// src/engine/loop.ts
import { assembleContext } from '../context/assemble.ts'
import { dispatchToolCalls } from '../tools/orchestration.ts'
import { getProvider } from '../ai/providers/index.ts'
import { compactMessages, autoCompactThreshold } from './compaction.ts'
import type { Message } from '../types/index.ts'

type RunOpts = {
  agentSpec: AgentSpec
  userInput: string
  history: Message[]
  maxTurns?: number
  sessionId?: string   // ToolContext 에 전달할 session id (선택)
  env: Env
}

export async function* runAgentLoop(opts: RunOpts): AsyncIterable<[string, unknown]> {
  const { agentSpec, userInput, history, maxTurns = 50, sessionId, env } = opts
  const state = createLoopState(maxTurns)
  const provider = getProvider(agentSpec.model, env)

  // Stage 1: 시스템 프롬프트는 루프 시작 시 한 번만 생성 (캐시 적중률)
  const ctx = assembleContext({ agentSpec, userInput, history, env })
  const systemPrompt = ctx.systemPrompt
  let messages = ctx.messages

  while (state.taskBudgetRemaining > 0) {
    state.taskBudgetRemaining--
    state.turnCount++

    // Stage 2: 컴팩션 체크
    if (needsCompaction(messages, env)) {
      const result = await compactMessages(messages, autoCompactThreshold(), provider)
      messages = result.messages
    }

    // Stage 3: Provider 호출
    let assistantMessage: Message
    try {
      assistantMessage = await collectStream(
        provider.callStream({
          system: systemPrompt,
          messages,
          tools: ctx.tools,
        }),
        // tee: forward to SSE stream while collecting
      )
    } catch (err) {
      // 에러 복구 분기
      if (isRateLimitError(err)) {
        await backoffAndRetry(err)
        continue
      }
      if (isPromptTooLongError(err)) {
        const result = await compactMessages(messages, autoCompactThreshold(), provider, { isReactive: true })
        messages = result.messages
        continue
      }
      if (isMaxOutputTokensError(err)) {
        increaseOutputBudget(provider)
        continue
      }
      // ProviderError: 사용자에게 error yield 후 return
      yield ['error', { code: 'ProviderError', message: String(err) }]
      return
    }

    messages = [...messages, assistantMessage]

    // Stage 4: tool_use 수집
    const toolUses = extractToolUses(assistantMessage)
    if (toolUses.length === 0) {
      // Stage 7: 완료
      yield ['done', { turn_count: state.turnCount }]
      return
    }

    // Stage 5: tool 실행 (병렬/순차 파티셔닝)
    const toolResults = await dispatchToolCalls(toolUses, toolRegistry, {
      sessionId: sessionId ?? '',
      agentName: agentSpec.name,
      turnIndex: state.turnCount,
      toolUseId: toolUses[0].id,
      cwd: env.CWD ?? '/',
      cancelSignal: new AbortController().signal,
      denyWritesOutside: [],
    })

    // Stage 6: 결과 병합
    messages = [...messages, buildToolResultMessage(toolUses, toolResults)]

    // Stage 7: continue (loop)
  }

  // Budget exhausted
  yield ['error', { code: 'BudgetExhausted', message: `max_turns ${maxTurns} exhausted` }]
}
```

## 에러 복구 분기

| 에러 유형 | 감지 | 복구 |
|---|---|---|
| `RateLimitError` | 429 status | 지수 백오프 + 재시도. `budget -= 1` |
| `PromptTooLongError` | 400 "prompt too long" | 강제 compaction → Stage 1 재진입 |
| `MaxOutputTokensError` | `stop_reason === 'max_tokens'` | 토큰 한도 증가 후 동일 query 재시도 (1회만) |
| `ProviderError` (기타) | 위 3개 아닌 예외 | 로그 + error yield + return |
| `ToolExecutionError` | Stage 5 특정 tool throw | `tool_result` 에 `isError: true` 로 병합 (LLM 이 다음 turn 복구) |

**원칙**: 에러 복구는 **분기** 이지 루프 밖 catch 가 아님. 각 복구 경로는 명시적 branch 로 코드에 나타나야.

## 동시성 함정

1. **LoopState 를 messages 배열에 섞기** — compaction 시 사라짐. 반드시 루프 로컬 변수로 유지
2. **foreground vs background retry 차이** — 사용자 대기 = 짧은 백오프·많은 재시도, background = 긴 백오프·빨리 포기. `provider-layer` skill §retry 참조
3. **system prompt 매 turn 재생성** — prompt cache miss. `systemPrompt` 는 루프 진입 전 1회만 생성

## Workers 특화

- `Promise.all` / `Promise.allSettled` 로 병렬 — `asyncio.gather` 동등
- Workers CPU time 한계 (10ms ~ 50ms free/paid). LLM 호출은 `waitUntil` 또는 streaming response 필수
- `AbortController` + `cancelSignal` 로 tool 취소. `asyncio.Event` 동등

## 검증 체크리스트

- [ ] 7단계가 코드에서 순서대로 식별됨
- [ ] `LoopState` 가 messages 배열 밖 지역 변수로 존재
- [ ] 4개 에러 복구 분기 (RateLimit / PromptTooLong / MaxOutputTokens / ProviderError) 명시적 catch 블록
- [ ] `ToolExecutionError` 는 `tool_result` 에 `isError: true` 로 병합 (loop catch 아님)
- [ ] budget exhaustion (`maxTurns`) 처리 존재
- [ ] `runAgentLoop` 반환 타입이 `AsyncIterable<[string, unknown]>`
- [ ] `agent-loop-invariants` invariant 의 `LoopTransition` 8 enum 준수

## 구현 중 막히면

- "이 상태를 어디 둬야 하지?" → messages 배열에 섞이면 compaction 손상 → 지역 변수
- "tool_use 실행 순서가 중요한가?" → safe 그룹은 `Promise.allSettled`, unsafe 그룹은 for 루프, 결과는 원본 순서로 재정렬
- "system prompt 가 매 turn 다르다" → 동적 값이 섞임. `buildSystemPrompt` 가 매 turn 동일한지 확인
