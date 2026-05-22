---
name: sub-agent
description: src/tools/spawn.ts 또는 src/engine/subagent.ts 최초 작성·수정 시 invoke. MAX_SPAWN_DEPTH = 3 상수 / SpawnDepthExceeded / checkDepth() 가드 / SpawnQueue (background task 추적) / useExactTools 캐시 정합성 / summarizeSession() 결과 압축. "depth budget exhausted", "무한 재귀", "부모 cache hit 소실" 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
---

**적용된 §4.4 매트릭스 행**: `pydantic BaseModel` / `ToolInput` → TypeScript interface + zod, `asyncio.create_task` → runtime background task helper (예: `ctx.waitUntil(Promise)`) 또는 `Promise` (process 기반 runtime 호환), `asyncio.timeout(n)` → `AbortSignal.timeout(n * 1000)` + `Promise.race`, `logger.warning(...)` → `console.warn(JSON.stringify({...}))`, `await asyncio.gather(...)` → `await Promise.allSettled(...)`, `asyncio.CancelledError` → AbortError, `os.environ` → `<framework env binding>` / runtime-specific bindings, Python dataclass/BaseModel → TypeScript interface

# sub-agent — 서브에이전트 spawn 청사진

## 이 skill은 언제 invoke 되는가

- `src/tools/spawn.ts` 또는 `src/engine/subagent.ts` 최초 작성 또는 수정
- 새 서브에이전트 카테고리 추가 (agent 설정 파일에 spawn 가능한 자식 정의)
- "depth budget exhausted", "무한 재귀", "부모 cache hit 소실" 디버깅
- `spawn-limits` invariant 변경 시

## Sub-agent Spawn의 정체성

App agent가 자신의 실행 도중에 다른 agent를 호출하게 한다. Agent Loop Stage 5에서 `spawn_agent` tool이 실행되면, 새 자식 agent loop이 생성되어 독립된 세션에서 동작한다. 결과는 부모 대화에 tool_result로 돌아온다.

두 가지 모드:

### 1. foreground — 부모가 결과를 기다림

부모 agent의 현재 turn이 블로킹된다. 자식 loop이 완료되면 결과가 요약되어 `SpawnAgentResult.summary`에 담겨 돌아온다.

```
parent turn N
  ├─ LLM 응답: spawn_agent("writing_assistant", "1장 작성", mode="foreground")
  ├─ ─── 자식 loop 실행 (await) ───
  │      └─ writing_assistant 가 3 turn 돈 뒤 완료
  ├─ 자식 결과 요약 → SpawnAgentResult.summary
  ├─ tool_result 로 부모 대화에 merge
  └─ 부모 turn N+1 진행
```

### 2. background — 부모는 즉시 진행

부모 agent가 즉시 다음 turn으로 진행한다. 자식은 runtime background task helper (예: `ctx.waitUntil(Promise)`) 또는 일반 `Promise` 로 백그라운드 실행 (runtime 별 메커니즘 — instance 측 project-local skill 참조). 결과는 비동기로 세션 inbox에 저장되며, 다음 사용자 prompt 시점에 자동 주입.

```
parent turn N
  ├─ LLM 응답: spawn_agent("validator", "검증해", mode="background")
  ├─ <runtime background task>(runChildAgent(...))   // 응답 후에도 실행 지속 (runtime-specific)
  ├─ SpawnAgentResult(summary: null, childSessionId: "abc")
  ├─ 부모 turn N+1 즉시 진행
  └─ ... 나중에 자식 완료 → inbox 저장 → 다음 /run/<name> 시 주입
```

> **Runtime 제약**: 일부 runtime (예: edge function, request-scoped lifecycle) 에서 `Promise` 를 fire-and-forget하면 응답 전송 후 런타임이 종료되어 자식이 중단된다. background 모드는 반드시 runtime background task helper 로 등록할 것 (구체 API 는 instance 측 project-local skill 참조).

## spawn_agent tool signature

```typescript
// src/tools/spawn.ts
import { z } from 'zod'
import type { Tool, ToolResult, ToolContext } from './base.ts'

/**
 * spawn_agent 전용 ToolContext 확장.
 * executionCtx / metadata 는 base ToolContext 에 없으므로 여기서 선언.
 */
interface SpawnToolContext extends ToolContext {
  executionCtx?: unknown  // runtime-specific execution context (background task helper) — instance 측에서 정확한 타입 정의
  metadata?: {
    spawnDepth?: number            // 현재 agent 체인 깊이 (checkDepth 에서 참조)
    [key: string]: unknown
  }
}

const SpawnAgentInputSchema = z.object({
  agentName: z.string().describe(
    'Name of the child agent to invoke (must exist in agents/<name>.json).'
  ),
  userInput: z.string().describe(
    'The prompt/task to pass to the child agent.'
  ),
  mode: z.enum(['foreground', 'background']).default('foreground').describe(
    'foreground: parent blocks until child finishes. background: parent continues immediately.'
  ),
  timeoutSeconds: z.number().int().min(10).max(1800).default(300).describe(
    'Maximum wall-clock seconds for child execution (foreground only).'
  ),
  useExactTools: z.boolean().default(true).describe(
    'If true, child uses parent\'s exact tool set (cache-friendly). ' +
    'If false, child loads its own tools (cache-hostile).'
  ),
})

type SpawnAgentInput = z.infer<typeof SpawnAgentInputSchema>

export interface SpawnAgentResult {
  childSessionId: string
  mode: string
  summary: string | null   // foreground: 요약된 자식 출력; background: null
  error: string | null     // non-null if child failed
}
```

## SpawnTool 구현체

```typescript
// src/tools/spawn.ts (continued)
import { checkDepth } from '../engine/subagent.ts'
import { runChildAgent, scheduleBackgroundAgent } from '../engine/subagent.ts'
import { summarizeSession } from '../services/summary.ts'

export const spawnTool: Tool = {
  name: 'spawn_agent',
  description:
    'Delegate a task to another specialist agent. ' +
    'The child runs in its own session and returns a summary.',
  inputSchema: SpawnAgentInputSchema,

  isConcurrencySafe(_args: unknown): boolean {
    // spawn_agent 는 절대 concurrency-safe 아님.
    // state mutation (child session) + provider quota 소비.
    return false
  },

  async execute(args: unknown, ctx: SpawnToolContext): Promise<ToolResult> {
    const input = SpawnAgentInputSchema.parse(args)
    checkDepth(ctx)  // 무한 재귀 방지

    const childSessionId = makeChildSessionId(ctx.sessionId)
    const childDepth = (ctx.metadata?.spawnDepth ?? 0) + 1

    if (input.mode === 'foreground') {
      try {
        const result = await Promise.race([
          runChildAgent({
            agentName: input.agentName,
            userInput: input.userInput,
            childSessionId,
            spawnDepth: childDepth,
            useExactTools: input.useExactTools,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`spawn foreground timeout after ${input.timeoutSeconds}s`)),
              input.timeoutSeconds * 1000,
            )
          ),
        ])
        const summary = await summarizeSession(childSessionId)
        const outcome: SpawnAgentResult = {
          childSessionId,
          mode: 'foreground',
          summary,
          error: null,
        }
        return { content: JSON.stringify(outcome), isError: false }
      } catch (err) {
        const outcome: SpawnAgentResult = {
          childSessionId,
          mode: 'foreground',
          summary: null,
          error: String(err),
        }
        return { content: JSON.stringify(outcome), isError: true }
      }
    } else {
      // background: runtime background task helper 로 런타임에 작업 등록 (runtime-specific)
      const childPromise = scheduleBackgroundAgent({
        agentName: input.agentName,
        userInput: input.userInput,
        childSessionId,
        spawnDepth: childDepth,
        useExactTools: input.useExactTools,
      })
      // runtime background task helper — 응답 전송 후에도 계속 실행 (instance 측 project-local skill 참조)
      ctx.executionCtx?.waitUntil(childPromise)

      const outcome: SpawnAgentResult = {
        childSessionId,
        mode: 'background',
        summary: null,
        error: null,
      }
      return { content: JSON.stringify(outcome), isError: false }
    }
  },
}

function makeChildSessionId(parentSessionId: string): string {
  return `${parentSessionId}-child-${Date.now()}`
}
```

## depth limit (MAX_SPAWN_DEPTH = 3)

무한 재귀를 방지하는 핵심 안전장치. agent 체인은 최대 3단계까지만 허용.

```typescript
// src/engine/subagent.ts
export const MAX_SPAWN_DEPTH = 3

export class SpawnDepthExceeded extends Error {
  constructor(depth: number) {
    super(
      `max spawn depth ${MAX_SPAWN_DEPTH} reached (current depth=${depth}). ` +
      `Refusing to spawn another child.`
    )
    this.name = 'SpawnDepthExceeded'
  }
}

export function checkDepth(ctx: SpawnToolContext): void {
  const depth = ctx.metadata?.spawnDepth ?? 0
  if (depth >= MAX_SPAWN_DEPTH) {
    throw new SpawnDepthExceeded(depth)
  }
}
```

### depth 레벨 의미

| depth | 의미 | 예시 |
|---|---|---|
| 0 | 사용자 직접 호출한 메인 agent | `chat_assistant` |
| 1 | 메인이 호출한 1차 자식 | `writing_assistant` |
| 2 | 1차 자식이 호출한 2차 자식 | `world_validator` |
| 3 | 도달 불가 — `checkDepth`가 거부 | - |

`spawn-limits` invariant 에서 이 상수의 정본 값을 관리. 변경 시 invariant 동시 업데이트.

### depth 전파 (부모 → 자식)

```typescript
// src/engine/subagent.ts
export interface RunChildAgentOpts {
  agentName: string
  userInput: string
  childSessionId: string
  spawnDepth: number         // 부모 depth + 1
  useExactTools: boolean
}

export async function runChildAgent(opts: RunChildAgentOpts): Promise<void> {
  const agentSpec = loadAgentSpec(opts.agentName)

  const { systemPrompt, messages, tools } = buildChildMessages({
    userInput: opts.userInput,
    agentSpec,
    useExactTools: opts.useExactTools,
  })

  // spawnDepth 를 LoopState.chainDepth 로 전달 → 자식 ctx.metadata.spawnDepth
  await runAgentLoop({
    agentSpec,
    systemPrompt,
    messages,
    tools,
    chainDepth: opts.spawnDepth,   // <-- 전파 핵심
  })
}
```

> `chainDepth` 파라미터가 자식의 `LoopState.chainDepth`로 전달되고, 자식이 다시 `spawn_agent`를 호출하면 `ctx.metadata.spawnDepth`가 이 값이 된다. 이 전파 체인이 끊기면 `checkDepth`가 동작하지 않아 무한 재귀가 발생한다.

## useExactTools 캐시 정합성

LLM provider (특히 Anthropic)는 system prompt + tool definitions가 바이트 단위로 동일할 때 prompt cache를 적중시킨다. `useExactTools: true` (기본값)이면 자식이 부모와 동일한 tool set을 사용해서 부모의 다음 turn에서 tool definitions 캐시가 재활용된다.

```typescript
// src/engine/subagent.ts
interface BuildChildMessagesOpts {
  userInput: string
  agentSpec: AgentSpec
  useExactTools: boolean
  parentTools?: ToolDefinition[]
}

function buildChildMessages(opts: BuildChildMessagesOpts): {
  systemPrompt: string
  messages: Message[]
  tools: ToolDefinition[]
} {
  const childTools = opts.useExactTools && opts.parentTools
    ? opts.parentTools                                   // cache-friendly: 동일 JSON
    : toolRegistry.filterForAgent(opts.agentSpec.tools) // cache-hostile: 다른 JSON

  if (!opts.useExactTools) {
    console.warn(JSON.stringify({
      event: 'spawn_cache_hostile',
      agent: opts.agentSpec.name,
      reason: 'useExactTools=false invalidates parent cache',
    }))
  }

  const systemPrompt = BASE_SYSTEM_PROMPT + '\n\n' + opts.agentSpec.systemPromptLayer
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: opts.userInput }] }]
  return { systemPrompt, messages, tools: childTools }
}
```

| `useExactTools` | tool definitions | 부모 다음 turn 캐시 | 비용 영향 |
|---|---|---|---|
| `true` (default) | 부모와 동일 바이트 | 적중 (tool block) | 최소 |
| `false` | 자식 전용 필터 | 미스 (전체 재전송) | 비용 증가 |

## SpawnQueue (background task 추적)

background 모드에서 부모가 즉시 응답을 종료해도 자식 결과가 유실되지 않게 하는 세션 레벨 큐.

```typescript
// src/state/spawnQueue.ts

interface SpawnQueueEntry {
  parentSessionId: string
  childSessionId: string
  promise: Promise<void>
  status: 'pending' | 'done' | 'error'
  result?: string
  error?: string
}

class SpawnQueue {
  private entries: Map<string, SpawnQueueEntry> = new Map()

  register(parentSessionId: string, childSessionId: string, promise: Promise<void>): void {
    const entry: SpawnQueueEntry = {
      parentSessionId,
      childSessionId,
      promise,
      status: 'pending',
    }
    this.entries.set(childSessionId, entry)

    promise.then(
      () => { entry.status = 'done' },
      (err) => { entry.status = 'error'; entry.error = String(err) },
    )
  }

  drainCompleted(parentSessionId: string): SpawnQueueEntry[] {
    const done: SpawnQueueEntry[] = []
    for (const [id, entry] of this.entries) {
      if (entry.parentSessionId === parentSessionId && entry.status !== 'pending') {
        done.push(entry)
        this.entries.delete(id)
      }
    }
    return done
  }
}

export const spawnQueue = new SpawnQueue()
```

다음 `/run/<name>` 호출 시 middleware가 `spawnQueue.drainCompleted(sessionId)`로 완료된 task를 확인, 결과/에러를 다음 대화 context에 자동 주입.

## 결과 요약 통합

foreground spawn 완료 후, 자식의 전체 출력을 그대로 돌려보내면 부모의 context window를 낭비한다. `src/services/summary.ts`가 자식 세션의 텍스트 이벤트를 읽어 짧은 요약을 생성한다.

```typescript
// src/services/summary.ts
const SUMMARY_THRESHOLD_WORDS = 100

export async function summarizeSession(
  childSessionId: string,
  opts: { maxWords?: number } = {},
): Promise<string> {
  const maxWords = opts.maxWords ?? SUMMARY_THRESHOLD_WORDS
  const events = await sessionStore.readEvents(childSessionId)
  const text = events
    .filter(e => e.type === 'text_delta')
    .map(e => (e.payload as { text?: string }).text ?? '')
    .join('')
    .trim()

  if (!text) return '(child agent produced no text output)'
  if (text.split(/\s+/).length <= maxWords) return text

  // 경량 내부 모델 (haiku 급)으로 요약 — INTERNAL_MODEL 상수 참조
  return llmSummarizeShort(text, maxWords)
}

async function llmSummarizeShort(text: string, maxWords: number): Promise<string> {
  // fallback: API 키 없으면 단순 truncation
  try {
    return await callInternalModel(text, maxWords)
  } catch {
    const words = text.split(/\s+/)
    return words.slice(0, maxWords).join(' ') + '...'
  }
}
```

## 동시성 함정 — 이 서브시스템 고유

### 1. background 모드의 결과 회수 누락

request-scoped lifecycle runtime 에서 background task helper 없이 Promise를 fire-and-forget하면, 응답 전송 후 런타임이 즉시 종료되어 자식이 중단된다.

**해결**: `ctx.executionCtx?.waitUntil(childPromise)` + `spawnQueue.register(parentSessionId, childSessionId, childPromise)` 두 줄이 모두 있어야 한다.

### 2. depth metadata 전파 누락

`ctx.metadata.spawnDepth`를 부모가 +1 해서 자식의 `LoopState.chainDepth`에 전달해야 한다. 이 전파가 누락되면:

- 자식의 `spawnDepth`가 항상 0
- `checkDepth()`가 절대 거부하지 않음
- agent A → B → C → D → ... 무한 재귀 가능

**체크포인트**: `runChildAgent`에 `spawnDepth` 인자가 있는지, 그 인자가 `runAgentLoop`의 `chainDepth`로 전달되는지, `ToolContext.metadata`에 다시 저장되는지 — 이 3단계를 모두 grep으로 확인.

### 3. useExactTools=false 로 인한 cache invalidation

`useExactTools: false`를 사용하면 자식의 tool definitions가 부모와 달라진다. Provider 캐시는 tool definitions를 바이트 단위로 비교하므로, **자식 호출 하나로 부모의 후속 turn 전체가 캐시 미스**가 된다.

**방어**: `useExactTools`의 default가 `true`인 것은 이 이유다. `false`로 명시 설정하는 경우에는 `console.warn` 로그를 반드시 남긴다.

## 검증 체크리스트

- [ ] `SpawnAgentInputSchema` 에 5필드 (agentName, userInput, mode, timeoutSeconds, useExactTools)
- [ ] `SpawnAgentResult` 에 4필드 (childSessionId, mode, summary, error)
- [ ] `MAX_SPAWN_DEPTH = 3` 상수 + `checkDepth()` 함수가 `SpawnDepthExceeded` throw
- [ ] foreground / background 두 모드 분기 존재
- [ ] foreground 타임아웃 → `ToolResult({ isError: true })` wrap (throw 금지)
- [ ] background → `ctx.waitUntil` + `spawnQueue.register` 두 줄 모두 존재
- [ ] `useExactTools: true` default + `buildChildMessages` 에 분기 + `false` 시 `console.warn`
- [ ] `summarizeSession` 함수 (SUMMARY_THRESHOLD_WORDS + LLM fallback)
- [ ] `isConcurrencySafe` 가 항상 `return false`
- [ ] 동시성 함정 3개 (background queue, depth 전파, cache WARNING) 코드 반영
- [ ] `spawn-limits` invariant 의 `MAX_SPAWN_DEPTH` 값과 일치
