---
name: mcp-integration
description: <api-app> 에서 MCP 서버 연결 / namespace 결정 / tool 자동 prefix 추가 시 invoke. @modelcontextprotocol/sdk 기반 client, MCPServerConfig, mcp_ prefix 브릿지, JSON schema → zod 동적 변환 패턴. "MCP tool not registered", "MCP server disconnected" 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/mcp-integration + rules/mcp-patterns.md
---

**적용된 §4.4 매트릭스 행**: Python MCP SDK (`mcp`) → `@modelcontextprotocol/sdk` (TS), `asyncio.wait_for(..., timeout=30)` → `AbortSignal.timeout(30_000)` + `Promise.race`, `pydantic BaseModel` + `create_model` → zod dynamic schema (`z.object({})`), `structlog.warning` → `console.warn`, `asyncio.CancelledError` → AbortError, `os.environ` → `<framework env binding>` / runtime-specific bindings

# mcp-integration — MCP client 청사진

## 이 skill은 언제 invoke 되는가

- `src/mcp/client.ts`, `src/mcp/bridge.ts`, `src/mcp/config.ts` 최초 작성 또는 수정
- 새 MCP server 통합 추가 (Postgres MCP, GitHub MCP, Slack MCP 등)
- "MCP tool not registered" 또는 "MCP server disconnected" 디버깅
- boot-time tool discovery 변경

## MCP의 정체성

Model Context Protocol — Anthropic 이 정의한 LLM 과 외부 도구 간 표준 통신 프로토콜.
<api-app> 는 **MCP CLIENT** 이다. 외부 MCP server에 연결해서 그 server가 노출하는 tools 를 `ToolRegistry` 에 동적 등록한다.

> **<api-app> 는 자신만의 MCP server를 호스팅하지 않는다. 외부 server의 client 역할만.**

MCP 1.0 프로토콜의 핵심 RPC 3개:
1. `initialize` — 핸드셰이크
2. `tools/list` — server 노출 도구 목록 + JSON schema
3. `tools/call` — 도구 실행 + 결과 반환

## 3-파일 구조

| 파일 | 책임 |
|---|---|
| `src/mcp/config.ts` | MCPServerConfig + 레지스트리 로드 |
| `src/mcp/client.ts` | MCP session 관리 (connect, list, call, close) |
| `src/mcp/bridge.ts` | MCP tools → ToolRegistry 동적 등록 |

단방향 의존 그래프: `config.ts → client.ts → bridge.ts → ToolRegistry`

## config.ts

```typescript
// src/mcp/config.ts
import { z } from 'zod'

export const MCPServerConfigSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'sse']),
  // stdio = process-based runtime 전용 (child_process.spawn 의존 — request-scoped runtime 비호환)
  // sse  = 모든 runtime 지원 (fetch + SSE 표준만 필요)
  command: z.string().optional(),            // stdio: 실행할 바이너리
  args: z.array(z.string()).default([]),
  url: z.string().optional(),               // sse: endpoint URL
  env: z.record(z.string()).default({}),    // 환경변수 (시크릿 inject)
  enabled: z.boolean().default(true),
})

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>

export function resolveEnvVars(env: Record<string, string>, bindings: Record<string, string>): Record<string, string> {
  /**  ${VAR} → bindings[VAR] (Wrangler binding 우선, fallback empty) */
  const resolved: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v.startsWith('${') && v.endsWith('}')) {
      const varName = v.slice(2, -1)
      resolved[k] = bindings[varName] ?? ''
    } else {
      resolved[k] = v
    }
  }
  return resolved
}

export async function loadMCPRegistry(env: Env): Promise<MCPServerConfig[]> {
  // request-scoped runtime: key-value cache or object storage 로부터 registry.json 로드
  // 개발 환경: runtime-specific local config (instance 측 project-local skill 참조) 에서 직접 읽기
  const raw = env.MCP_REGISTRY_JSON ?? '[]'
  const configs = JSON.parse(raw) as unknown[]
  return configs
    .map(c => MCPServerConfigSchema.safeParse(c))
    .filter(r => r.success && r.data.enabled)
    .map(r => (r as { success: true; data: MCPServerConfig }).data)
}
```

## client.ts

```typescript
// src/mcp/client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { MCPServerConfig } from './config.ts'

const CONNECT_TIMEOUT_MS = 30_000
const CALL_TIMEOUT_MS = 60_000

export class MCPClient {
  private client: Client | null = null
  private toolsCache: Record<string, unknown>[] | null = null

  constructor(readonly config: MCPServerConfig) {}

  async connect(bindings: Record<string, string>): Promise<void> {
    const { resolveEnvVars } = await import('./config.ts')
    const resolvedEnv = resolveEnvVars(this.config.env, bindings)

    let transport
    if (this.config.transport === 'stdio') {
      // ⚠️ **request-scoped runtime 비호환**: `StdioClientTransport` 는 Node `child_process.spawn` 의존 —
      // request-scoped runtime 에서 throw. 해당 runtime 배포 시 `SSEClientTransport` 만 사용.
      // stdio 는 *process-based runtime* (예: Node 장기 프로세스) 의 escape hatch.
      if (!this.config.command) throw new Error(`stdio transport requires command: ${this.config.name}`)
      transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: resolvedEnv,
      })
    } else {
      if (!this.config.url) throw new Error(`sse transport requires url: ${this.config.name}`)
      transport = new SSEClientTransport(new URL(this.config.url))
    }

    this.client = new Client({ name: 'apps-api', version: '1.0.0' }, { capabilities: {} })

    await Promise.race([
      this.client.connect(transport),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`MCP connect timeout: ${this.config.name}`)), CONNECT_TIMEOUT_MS)),
    ])
  }

  async listTools(): Promise<Record<string, unknown>[]> {
    this.assertConnected()
    if (this.toolsCache) return this.toolsCache
    const response = await this.client!.listTools()
    this.toolsCache = response.tools as Record<string, unknown>[]
    return this.toolsCache
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown; isError: boolean }> {
    this.assertConnected()
    try {
      const result = await Promise.race([
        this.client!.callTool({ name, arguments: args }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`MCP call timeout after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS)),
      ])
      return { content: (result as { content: unknown }).content, isError: false }
    } catch (err) {
      console.warn('mcp_call_error', { server: this.config.name, tool: name, error: String(err) })
      return { content: `MCP error: ${err}`, isError: true }
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try { await this.client.close() } catch { /* silent */ }
      this.client = null
      this.toolsCache = null
    }
  }

  private assertConnected(): void {
    if (!this.client) throw new Error(`MCPClient not connected: ${this.config.name}. Call connect() first.`)
  }
}
```

## bridge.ts

```typescript
// src/mcp/bridge.ts
import { z } from 'zod'
import type { MCPClient } from './client.ts'
import type { Tool, ToolResult, ToolContext, ToolInputSchema } from '../tools/base.ts'
import { toolRegistry } from '../tools/registry.ts'

const MCP_TOOL_PREFIX = 'mcp__'

export function makeMCPToolClass(client: MCPClient, mcpTool: Record<string, unknown>): Tool {
  const rawName = mcpTool.name as string
  const toolName = `${MCP_TOOL_PREFIX}${client.config.name}__${rawName}`
  // e.g. mcp__github__create_issue, mcp__postgres__query
  const description = (mcpTool.description as string | undefined) ?? `MCP tool: ${rawName}`
  const schema = (mcpTool.inputSchema as Record<string, unknown> | undefined) ?? {}

  const inputSchema = buildZodFromSchema(schema, toolName)

  return {
    name: toolName,
    description,
    inputSchema,

    isConcurrencySafe(_args: unknown): boolean {
      return false  // 보수적: MCP server 내부 동작 불명
    },

    async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
      try {
        const result = await client.callTool(rawName, args as Record<string, unknown>)
        return {
          content: result.content as string | Record<string, unknown>,
          isError: result.isError,
        }
      } catch (err) {
        return { content: `MCP server unavailable: ${err}`, isError: true }
      }
    },
  }
}

export async function registerAllMCPTools(clients: MCPClient[]): Promise<number> {
  let count = 0
  for (const client of clients) {
    let tools: Record<string, unknown>[]
    try {
      tools = await client.listTools()
    } catch (err) {
      console.warn('mcp_list_tools_failed', { error: String(err) })
      continue
    }
    for (const mcpTool of tools) {
      try {
        const tool = makeMCPToolClass(client, mcpTool)
        toolRegistry.register(tool)
        count++
        console.info('mcp_tool_registered', { tool: (mcpTool as { name: string }).name })
      } catch (err) {
        console.warn('mcp_tool_register_failed', { tool: (mcpTool as { name?: string }).name, error: String(err) })
      }
    }
  }
  return count
}

function buildZodFromSchema(schema: Record<string, unknown>, toolName: string): ToolInputSchema {
  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {}
  const required = new Set((schema.required as string[] | undefined) ?? [])

  const fields: Record<string, z.ZodTypeAny> = {}
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    const fs = fieldSchema as Record<string, unknown>
    if (fs.anyOf || fs.oneOf || fs.$ref) {
      console.warn('mcp_schema_complex_type', { tool: toolName, field: fieldName })
      fields[fieldName] = z.any()
    } else {
      const jsType = jsonTypeToZod(fs)
      fields[fieldName] = required.has(fieldName) ? jsType : jsType.optional()
    }
  }
  return z.object(fields) as unknown as ToolInputSchema
}

function jsonTypeToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const typeMap: Record<string, z.ZodTypeAny> = {
    string: z.string(),
    integer: z.number().int(),
    number: z.number(),
    boolean: z.boolean(),
    array: z.array(z.unknown()),
    object: z.record(z.unknown()),
  }
  return typeMap[schema.type as string] ?? z.string()
}
```

> **`mcp__<server>__<tool>` 형식**: MCP 에서 가져온 tool 은 `mcp__postgres__query`, `mcp__github__create_issue` 등 이중 밑줄 namespace 로 native tool 과 이름 충돌 방지. `mcp-namespace` invariant 의 SoT 형식 = `mcp__<server>__<tool>` (double underscore).
> **`isConcurrencySafe = false`**: MCP server 내부 동작 불명 → 보수적 sequential 실행.

## 동적 tool 등록 흐름 (boot 시 1회)

```
1. `<framework>` app startup (src/index.ts lifespan)
2. loadMCPRegistry(env) → MCPServerConfig[]
3. for each config: MCPClient.connect() — 30s timeout, 실패 시 skip
4. registerAllMCPTools(clients) → ToolRegistry 에 mcp_* 도구 등록
5. Agent Loop 에서 ToolRegistry.definitions() 호출 → LLM 에게 native + MCP 도구 전달
```

## 실패 모드

| 실패 | 복구 |
|---|---|
| connect timeout (30s) | 해당 server skip + warn. 나머지 계속 |
| tools/list schema invalid | 해당 tool skip + warn. 나머지 계속 |
| server disconnect 중 tool call | `ToolResult(isError: true)` — LLM 다음 turn 인지 |
| slow tools/call (60s) | `ToolResult(isError: true, content: "MCP timeout")` |

## 검증 체크리스트

- [ ] `MCPServerConfig` 가 zod schema 로 검증
- [ ] `MCPClient` 가 connect / listTools / callTool / close 메서드 보유
- [ ] `MCP_TOOL_PREFIX = 'mcp__'` + `<server>__<tool>` 형식으로 모든 MCP tool name 에 namespace prefix (`mcp-namespace` invariant SoT)
- [ ] `isConcurrencySafe` 가 항상 `false` 반환
- [ ] 4 실패 모드 처리 코드 존재
- [ ] boot 시 sequential 등록 (concurrent 호출 방지)
- [ ] `mcp-namespace` invariant 의 namespace 룰 준수
