---
name: tool-system
description: apps/api 에 새 LLM tool 추가 / ToolRegistry 수정 / tool concurrency 정책 변경 시 invoke. tool 등록 규칙, is_concurrency_safe 분기, ToolContext dataclass, dispatch_tool_calls orchestration 포함. "tool not registered", "tool schema validation 실패", race condition 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/tool-system + rules/tool-system-patterns.md
---

**적용된 §4.4 매트릭스 행**: `pydantic BaseModel` + `extra="forbid"` → `z.object({...}).strict()` / TypeScript interface, `typing.Protocol` + `@runtime_checkable` → TypeScript `interface`, `asyncio.gather(..., return_exceptions=True)` → `Promise.allSettled([...])`, `asyncio.Event` → `AbortController` / Promise signal, `@dataclass(slots=True)` → TypeScript `interface` / class, `ToolRegistry` singleton → `Map<string, ToolHandler>` + module-level instance, `pydantic.create_model` → dynamic zod schema, `zod-to-json-schema` 로 JSON Schema 변환

# tool-system — Tool 서브시스템 구조 청사진

## 이 skill은 언제 invoke 되는가

- `src/tools/base.ts`, `src/tools/registry.ts`, `src/tools/orchestration.ts` 최초 작성
- 새 Tool 추가 전 (registry 등록 룰 확인)
- 위 파일 수정 (interface 변경, concurrency 룰 변경)
- "tool 실행 race condition", "tool schema validation 실패", "registry에서 tool 못 찾음" 디버깅

## Tool System의 정체성

Tool System은 LLM이 호출할 수 있는 도구를 등록·검증·실행하는 계층이다. 핵심 구성:

1. **Tool Interface** — 모든 tool이 구현해야 하는 TypeScript `interface`
2. **ToolRegistry** — 동적 등록/조회/필터링을 담당하는 Map 기반 싱글턴
3. **ToolContext** — 각 tool 호출 시 주입되는 실행 컨텍스트
4. **Orchestration** — Agent Loop Stage 5의 병렬/순차 파티셔닝과 결과 병합

## Tool Interface

```typescript
// src/tools/base.ts
import { z } from 'zod'

export type ToolInputSchema = z.ZodObject<z.ZodRawShape>

export interface ToolResult {
  content: string | Record<string, unknown>
  isError: boolean
  metadata?: Record<string, unknown>
}

export interface ToolContext {
  sessionId: string
  agentName: string
  turnIndex: number
  toolUseId: string
  cwd: string
  cancelSignal: AbortSignal     // AbortController.signal — AbortError 시 graceful exit
  denyWritesOutside: string[]   // write 차단 경로
}

export interface Tool<TSchema extends ToolInputSchema = ToolInputSchema> {
  name: string                    // unique identifier (snake_case)
  description: string             // 1-2 sentence purpose for LLM consumption
  inputSchema: TSchema            // zod schema

  /** Return true iff THIS specific invocation can run in parallel.
   *  INPUT-BASED — not a static property. Same tool may be safe/unsafe
   *  depending on args (e.g., file_read is safe unless path conflicts). */
  isConcurrencySafe(args: z.infer<TSchema>): boolean

  execute(args: z.infer<TSchema>, ctx: ToolContext): Promise<ToolResult>
}
```

> 핵심 원칙: `isConcurrencySafe` 는 **입력 기반**. 정적 속성으로 빼지 말 것. 같은 tool 이라도 입력에 따라 안전성이 달라진다.

## ToolRegistry

```typescript
// src/tools/registry.ts
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Tool, ToolInputSchema } from './base.ts'

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>()

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Tool '${name}' not found in registry`)
    return tool
  }

  definitions(): Record<string, unknown>[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.inputSchema, { target: 'openApi3' }),
    }))
  }

  filterForAgent(allowList: string[]): ToolRegistry {
    const filtered = new ToolRegistry()
    for (const name of allowList) {
      if (this.tools.has(name)) {
        filtered.tools.set(name, this.tools.get(name)!)
      }
    }
    return filtered
  }

  all(): IterableIterator<Tool> {
    return this.tools.values()
  }

  clear(): void {
    this.tools.clear()
  }
}

// Module-level singleton
export const toolRegistry = new ToolRegistry()
```

## 병렬 실행 파티셔닝 (Agent Loop Stage 5)

```typescript
// src/tools/orchestration.ts
import { z } from 'zod'
import type { Tool, ToolResult, ToolContext, ToolInputSchema } from './base.ts'
import type { ToolRegistry } from './registry.ts'

export async function dispatchToolCalls(
  toolUses: Array<{ name: string; input: Record<string, unknown> }>,
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<ToolResult[]> {
  type Bucket = { idx: number; tool: Tool; args: unknown }
  const safe: Bucket[] = []
  const unsafe: Bucket[] = []
  const results: ToolResult[] = new Array(toolUses.length)

  for (let i = 0; i < toolUses.length; i++) {
    const { name, input } = toolUses[i]
    const tool = registry.get(name)
    const parsed = tool.inputSchema.safeParse(input)
    if (!parsed.success) {
      results[i] = {
        content: `Validation error: ${parsed.error.message}`,
        isError: true,
      }
      continue
    }
    const args = parsed.data
    const bucket = tool.isConcurrencySafe(args) ? safe : unsafe
    bucket.push({ idx: i, tool, args })
  }

  // Parallel safe batch
  const safeSettled = await Promise.allSettled(
    safe.map(({ tool, args }) => tool.execute(args, ctx))
  )
  for (let j = 0; j < safe.length; j++) {
    const { idx } = safe[j]
    const settled = safeSettled[j]
    results[idx] = settled.status === 'fulfilled'
      ? settled.value
      : { content: `${settled.reason}`, isError: true }
  }

  // Sequential unsafe
  for (const { idx, tool, args } of unsafe) {
    try {
      results[idx] = await tool.execute(args, ctx)
    } catch (err) {
      results[idx] = { content: `${err}`, isError: true }
    }
  }

  return results
}

function wrapError(err: unknown): ToolResult {
  return {
    content: err instanceof Error ? err.message : String(err),
    isError: true,
  }
}
```

## 동시성 함정

1. **`isConcurrencySafe` 를 정적 속성으로 빼지 마라** — 입력에 따라 다르므로 반드시 메서드로 유지
2. **`ToolRegistry.register` 는 멱등 아님** — 같은 이름 두 번 등록하면 throw. 테스트에서 `registry.clear()` 후 재등록 필요
3. **`Promise.allSettled` 결과는 예외 포함** — `status === 'rejected'` 인 것을 `ToolResult(isError: true)` 로 wrap 하지 않으면 다음 turn에서 schema mismatch

## 신규 도구 체크리스트

새 tool 추가 시:

- [ ] `src/tools/<name>.ts` 에 `class <Name>Tool implements Tool` 구현
- [ ] zod schema 로 input 정의 (`z.object({...}).strict()`)
- [ ] `isConcurrencySafe(args)` 명시적 구현 — input 기반 분기 또는 `return false` (보수적)
- [ ] `async execute(args, ctx)` 구현, `ToolResult` 반환
- [ ] 모듈 하단 또는 `src/tools/index.ts` 에서 `toolRegistry.register(new <Name>Tool())`
- [ ] Vitest 기반 단위 테스트
- [ ] agent allowlist 에 이름 등록

## 검증 체크리스트

- [ ] `Tool` interface 에 `name` / `description` / `inputSchema` / `isConcurrencySafe` / `execute` 5필드
- [ ] `ToolRegistry` 에 `register` / `get` / `definitions` / `filterForAgent` / `all` / `clear` 메서드
- [ ] `ToolContext` 에 `sessionId` / `agentName` / `turnIndex` / `toolUseId` / `cwd` / `cancelSignal` / `denyWritesOutside`
- [ ] `dispatchToolCalls` 가 safe 병렬 + unsafe 순차 + 결과 재정렬 + 예외 wrap 구현
- [ ] `zodToJsonSchema` 로 LLM API의 `tools` 파라미터에 사용할 JSON Schema 생성
- [ ] `tool-sort-order` invariant 준수 (built-in 이름순 → MCP 이름순)

## 구현 중 막히면

- "이 tool이 concurrency-safe 인지 모르겠다" → 보수적으로 `return false`
- "registry singleton이 test마다 오염" → `registry.clear()` 후 재등록
- "tool input validation 실패" → `safeParse` + `ToolResult(isError: true)` 로 wrap — throw 금지
- "agent allowlist 가 tool 에 미반영" → `filterForAgent` 가 view 반환인지 확인
