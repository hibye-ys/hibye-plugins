---
name: lsp-server
description: <api-app> LSP 서버 (`<workspace-entity>` 언어 지능 — 예 prose editor / code editor / blog mention) 최초 작성 / 4-class 구조 (LSPManager / LSPRegistry / LSPInstance / LSPBridge) 추가 / completion·diagnostic·hover·definition 핸들러 수정 시 invoke. "completion 이 안 뜬다", "diagnostic 이 stale 텍스트에 걸려있다", "IDE 클라이언트가 30초 후 disconnect" 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
---

**적용된 §4.4 매트릭스 행**: `pygls LanguageServer` → `vscode-languageserver` (npm) `createConnection()`, `pydantic` / `dataclass` → `zod` schema / TS `interface`, `asyncio.wait_for(timeout=10)` → `AbortSignal.timeout(10_000)`, `asyncio.create_task` → `(async () => { ... })()` (fire-and-forget Promise), `asyncio.CancelledError` → `AbortError` (signal aborted), `lsprotocol.types` → `vscode-languageserver-types`, `logger = logging.getLogger(__name__)` → `console.warn(JSON.stringify(...))` (구조화), `os.getenv` → `<framework env binding>.<NAME>` (LSP 가 동거할 때) 또는 `process.env` (별도 Node 프로세스), `from __future__ import annotations` → 불필요 (TS), `lazy load entities` → 모듈 레벨 `let cachedEntities: ... | null = null`

## Core Rules (non-negotiable — baseline misses ALL of these)

1. MUST implement 4-class 구조: `LSPManager`, `LSPRegistry`, `LSPInstance`, `LSPBridge`
2. MUST implement `invalidateEntityCache()` on document change
3. MUST implement `cleanupStaleInstances()` with 5-minute threshold
4. MUST use `AbortSignal.timeout(10_000)` for agent call safety
5. MUST register instance 별 trigger character (예: `@` for mention, `#` for tag, `[[` for wiki link) on `capabilities.completionProvider.triggerCharacters`

# lsp-server — LSP 서버 구조 청사진

## 이 skill 은 언제 invoke 되는가

- `<api-app>/src/lsp/server.ts`, `completions.ts`, `diagnostics.ts`, `hover.ts`,
  `semanticTokens.ts` 최초 작성 또는 수정
- LSP-Agent bridge 코드 작성 (`<api-app>/src/lsp/bridge.ts`)
- "completion 이 안 뜬다", "diagnostic 이 stale 텍스트에 걸려있다",
  "IDE 클라이언트가 30초 후 disconnect" 같은 디버깅

## LSP server 의 정체성

프론트엔드 `<workspace-entity>` 에디터 (Monaco / CodeMirror — 예 prose-editor mention / code symbol / blog tag / wiki link) 에 **언어 지능** 을 제공한다.
코드 편집기의 LSP 와 같은 프로토콜이지만 대상이 instance 별 workspace entity (user mention, file reference, tag, symbol, link 등) 다.

4 core capabilities:

1. **Entity Completion** — instance 별 trigger character (예: `@` for mention, `#` for tag, `[[` for wiki link) 입력 시 엔티티 이름 자동완성 (aliases 포함)
2. **Diagnostics** — 실시간 일관성 경고. Hard Rule (결정론적) + Domain Rule (결정론적) +
   Soft Rule (LLM 기반, debounced)
3. **Hover Info** — 엔티티명 호버 시 요약 카드 (마크다운)
4. **Go to Definition** — 엔티티 클릭 → canonical URI 위치로 이동

## 배포 형태 — runtime 호환성

LSP 서버는 **request-scoped runtime 비호환** (long-lived WebSocket + lsprotocol JSON-RPC) — 별도 long-running 프로세스로 배포:

- 옵션 A: `<api-app>/src/lsp/` 를 **별도 process-based runtime 엔트리포인트** (예: Node 장기 프로세스) 로 export 하고 컨테이너 호스팅 (예: Fly.io / Railway) 에 배포
- 옵션 B: request-scoped runtime 의 `<api-app>/` 와 동거하되 별도 service binding 으로 분리 (해당 runtime 이 long-running container 지원 후)
- **현재 권장 = A** (request-scoped runtime 의 SSE / fetch 와 LSP JSON-RPC 는 lifetime 모델이 다름)

runtime 호환성 invariant (instance 측 project-local skill 참조) 에서 `lsp/` 경로는 **별도 빌드 타겟** 으로 분리.

## vscode-languageserver scaffolding

```typescript
// <api-app>/src/lsp/server.ts
import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  type CompletionList,
  type Hover,
  type Location,
} from 'vscode-languageserver/node'
import { LSPManager } from './manager.ts'
import { LSPBridge } from './bridge.ts'
import type { DataReader } from './types.ts'

export function createLSPServer(dataReader: DataReader, bridge: LSPBridge) {
  const connection = createConnection(ProposedFeatures.all)
  const manager = LSPManager.getInstance({ dataReader, bridge })

  connection.onInitialize((params: InitializeParams): InitializeResult => ({
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Full,
      },
      completionProvider: {
        triggerCharacters: ['@'],
        resolveProvider: false,
      },
      hoverProvider: true,
      diagnosticProvider: {
        identifier: 'app',
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
      definitionProvider: true,
    },
  }))

  connection.onDidOpenTextDocument(async (params) => {
    const { uri, text } = params.textDocument
    manager.registerDocument(uri, text)
    connection.sendDiagnostics({
      uri,
      diagnostics: await manager.computeDiagnostics(uri),
    })
  })

  connection.onDidChangeTextDocument(async (params) => {
    const uri = params.textDocument.uri
    manager.updateDocument(uri, params.contentChanges[0].text)
    connection.sendDiagnostics({
      uri,
      diagnostics: await manager.computeDiagnostics(uri),
    })
  })

  connection.onCompletion(async (params): Promise<CompletionList | null> => {
    const items = await manager.computeCompletions(
      params.textDocument.uri,
      params.position,
    )
    return items.length > 0 ? { isIncomplete: false, items } : null
  })

  connection.onHover(async (params): Promise<Hover | null> => {
    return manager.computeHover(params.textDocument.uri, params.position)
  })

  connection.onDefinition(async (params): Promise<Location | null> => {
    return manager.computeDefinition(params.textDocument.uri, params.position)
  })

  return connection
}
```

> `TextDocumentSyncKind.Full` — 변경 시 전체 텍스트 수신. Incremental diff 는
> `<workspace-entity>` 에디터에서 이득이 거의 없고 복잡도만 올린다.

> NOTE: `triggerCharacters: ['@']` 는 mention 패턴 예시. instance 가 tag (`#`) /
> wiki link (`[[`) 같은 다른 trigger 를 쓰면 해당 character 로 교체. instance 측
> CLAUDE.md 에 `<workspace-entity>` → trigger 매핑 명시 (Placeholder 해석 섹션 참조).

## 3-tier 구조

```
┌───────────────────────────────────────────────┐
│  LSPManager (singleton)                        │
│  ├─ LSPBridge (agent 호출 gateway)              │
│  ├─ DataReader (엔티티 데이터 접근)               │
│  └─ registries: Map<string, LSPRegistry>       │
│      ├─ LSPRegistry (per workspace)            │
│      │   ├─ entityCache: Map<string, Entity>    │
│      │   └─ instances: Map<string, LSPInstance> │
│      │       ├─ LSPInstance (per document)      │
│      │       │   uri / text / version /         │
│      │       │   lastDiagnostics / lastAccessed │
│      │       └─ ...                            │
│      └─ LSPRegistry (per workspace) ...        │
└───────────────────────────────────────────────┘
```

### LSPManager (singleton)

```typescript
// <api-app>/src/lsp/manager.ts
import type { Diagnostic, Position, Hover, Location, CompletionItem } from 'vscode-languageserver-types'
import type { DataReader, Entity } from './types.ts'
import { LSPRegistry } from './registry.ts'
import type { LSPBridge } from './bridge.ts'

const STALE_INSTANCE_MAX_AGE_SEC = 300

export class LSPManager {
  private static _instance: LSPManager | null = null
  private readonly _registries = new Map<string, LSPRegistry>()
  // NOTE: setInterval = 옵션 A (별도 process-based runtime 배포) 가정. request-scoped runtime 동거 (옵션 B) 시
  //       이 필드는 사용 ✕ — Cron Trigger 또는 요청 hook 로 cleanupStaleInstances() 직접 호출.
  //       동시성 함정 #4 + "환경별 cleanup 트리거" 표 참조.
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null

  private constructor(
    private readonly _dataReader: DataReader,
    private readonly _bridge: LSPBridge,
  ) {}

  static getInstance(deps?: { dataReader: DataReader; bridge: LSPBridge }): LSPManager {
    if (LSPManager._instance === null) {
      if (!deps) throw new Error('LSPManager not initialized')
      LSPManager._instance = new LSPManager(deps.dataReader, deps.bridge)
      LSPManager._instance._startCleanup()
    }
    return LSPManager._instance
  }

  registerDocument(uri: string, text: string): void {
    this._getOrCreateRegistry(uri).registerInstance(uri, text)
  }

  updateDocument(uri: string, text: string): void {
    const registry = this._getOrCreateRegistry(uri)
    const inst = registry.getInstance(uri)
    if (inst === undefined) registry.registerInstance(uri, text)
    else {
      inst.text = text
      inst.version += 1
      inst.lastAccessed = Date.now()
    }
  }

  unregisterDocument(uri: string): void {
    const registry = this._getOrCreateRegistry(uri)
    registry.removeInstance(uri)
    if (registry.isEmpty()) this._registries.delete(LSPManager._extractWorkspace(uri))
  }

  async computeDiagnostics(uri: string): Promise<Diagnostic[]> {
    return this._getOrCreateRegistry(uri).computeDiagnostics(uri)
  }
  async computeCompletions(uri: string, pos: Position): Promise<CompletionItem[]> {
    return this._getOrCreateRegistry(uri).computeCompletions(uri, pos)
  }
  async computeHover(uri: string, pos: Position): Promise<Hover | null> {
    return this._getOrCreateRegistry(uri).computeHover(uri, pos)
  }
  async computeDefinition(uri: string, pos: Position): Promise<Location | null> {
    return this._getOrCreateRegistry(uri).computeDefinition(uri, pos)
  }

  cleanupStaleInstances(maxAgeSec = STALE_INSTANCE_MAX_AGE_SEC): void {
    const cutoff = Date.now() - maxAgeSec * 1000
    for (const reg of this._registries.values()) reg.evictOlderThan(cutoff)
  }

  /** 옵션 A (process-based runtime 배포) 전용 — request-scoped runtime 에서는 호출 ✕. */
  private _startCleanup(): void {
    // eslint-disable-next-line no-restricted-globals -- 옵션 A 가정 (runtime 호환성 invariant 에서 lsp/ 경로 별도 빌드 타겟 제외 — instance 측 project-local skill)
    this._cleanupTimer = setInterval(() => this.cleanupStaleInstances(), 60_000)
  }

  private _getOrCreateRegistry(uri: string): LSPRegistry {
    const ws = LSPManager._extractWorkspace(uri)
    let reg = this._registries.get(ws)
    if (reg === undefined) {
      reg = new LSPRegistry(ws, this._dataReader, this._bridge)
      this._registries.set(ws, reg)
    }
    return reg
  }

  private static _extractWorkspace(uri: string): string {
    const idx = uri.lastIndexOf('/')
    return idx === -1 ? uri : uri.slice(0, idx)
  }

  static reset(): void {
    if (LSPManager._instance?._cleanupTimer) clearInterval(LSPManager._instance._cleanupTimer)
    LSPManager._instance = null
  }
}
```

### LSPRegistry (per workspace)

```typescript
// <api-app>/src/lsp/registry.ts
import {
  CompletionItemKind,
  MarkupKind,
  type CompletionItem,
  type Diagnostic,
  type Hover,
  type Location,
  type Position,
} from 'vscode-languageserver-types'
import type { DataReader, Entity } from './types.ts'
import type { LSPBridge } from './bridge.ts'
import { LSPInstance } from './instance.ts'

export class LSPRegistry {
  private readonly _instances = new Map<string, LSPInstance>()
  private _entityCache = new Map<string, Entity>()
  private _entityCacheValid = false

  constructor(
    readonly workspaceUri: string,
    private readonly _dataReader: DataReader,
    private readonly _bridge: LSPBridge,
  ) {}

  registerInstance(uri: string, text: string): void {
    this._instances.set(uri, new LSPInstance(uri, text))
  }
  getInstance(uri: string): LSPInstance | undefined {
    return this._instances.get(uri)
  }
  removeInstance(uri: string): void {
    this._instances.delete(uri)
  }
  isEmpty(): boolean {
    return this._instances.size === 0
  }
  evictOlderThan(cutoffMs: number): void {
    for (const [uri, inst] of this._instances.entries()) {
      if (inst.lastAccessed < cutoffMs) this._instances.delete(uri)
    }
  }

  private async _ensureEntityCache(): Promise<Map<string, Entity>> {
    if (!this._entityCacheValid) {
      const entities = await this._dataReader.listEntities()
      this._entityCache = new Map()
      for (const e of entities) {
        this._entityCache.set(e.name, e)
        for (const alias of e.aliases ?? []) this._entityCache.set(alias, e)
      }
      this._entityCacheValid = true
    }
    return this._entityCache
  }

  invalidateEntityCache(): void {
    this._entityCacheValid = false
  }

  async computeCompletions(uri: string, position: Position): Promise<CompletionItem[]> {
    const instance = this.getInstance(uri)
    if (instance === undefined) return []
    const cache = await this._ensureEntityCache()
    const prefix = instance.getWordAt(position)
    const items: CompletionItem[] = []
    for (const [name, ent] of cache.entries()) {
      if (prefix === '' || name.toLowerCase().startsWith(prefix.toLowerCase())) {
        items.push({
          label: name,
          kind: CompletionItemKind.Reference,
          detail: ent.type ?? 'entity',
          documentation: ent.summary ?? '',
        })
      }
    }
    return items
  }

  async computeHover(uri: string, position: Position): Promise<Hover | null> {
    const instance = this.getInstance(uri)
    if (instance === undefined) return null
    const word = instance.getWordAt(position)
    if (word === '') return null
    const entity = (await this._ensureEntityCache()).get(word)
    if (entity === undefined) return null
    const md =
      `### ${entity.name}\n**Type**: ${entity.type ?? 'unknown'}\n\n` +
      (entity.summary ?? 'No summary available.')
    return { contents: { kind: MarkupKind.Markdown, value: md } }
  }

  async computeDiagnostics(uri: string): Promise<Diagnostic[]> {
    const instance = this.getInstance(uri)
    if (instance === undefined) return []
    return this._bridge.runDiagnostics(instance.text, uri)
  }

  async computeDefinition(_uri: string, _position: Position): Promise<Location | null> {
    return null // TODO: canonical_uri lookup
  }
}
```

### LSPInstance (per document)

```typescript
// <api-app>/src/lsp/instance.ts
import type { Diagnostic, Position } from 'vscode-languageserver-types'

export class LSPInstance {
  text: string
  version = 0
  lastDiagnostics: Diagnostic[] = []
  lastAccessed: number = Date.now()

  constructor(readonly uri: string, text: string) {
    this.text = text
  }

  getWordAt(position: Position): string {
    this.lastAccessed = Date.now()
    const lines = this.text.split(/\r?\n/)
    if (position.line >= lines.length) return ''
    const line = lines[position.line]
    if (position.character > line.length) return ''
    let start = position.character
    // NOTE: '@' = mention trigger 예시. instance 별 trigger character ('#', '[[' 등) 로 교체.
    while (start > 0 && !/\s/.test(line[start - 1]) && line[start - 1] !== '@') start -= 1
    let end = position.character
    while (end < line.length && !/\s/.test(line[end])) end += 1
    return line.slice(start, end)
  }
}
```

## Bridge: LSP <-> Agent

```typescript
// <api-app>/src/lsp/bridge.ts
import {
  DiagnosticSeverity,
  type Diagnostic,
  type Range,
} from 'vscode-languageserver-types'
import type { DataReader } from './types.ts'

const SOFT_DIAG_DEBOUNCE_MS = 2_000
const AGENT_TIMEOUT_MS = 10_000

interface AgentRunner {
  runAgent(input: {
    agent: 'lsp-diagnostic'
    userInput: string
    maxTurns: number
    signal: AbortSignal
  }): AsyncIterable<{ text?: string }>
}

export class LSPBridge {
  private _softDiagAbort: AbortController | null = null
  private _softDiagTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly _dataReader: DataReader,
    private readonly _agentRunner?: AgentRunner,
  ) {}

  async runDiagnostics(text: string, uri: string): Promise<Diagnostic[]> {
    const diags = await this._checkHardRules(text, uri)
    diags.push(...(await this._checkDomainRules(text, uri)))
    this._scheduleSoftDiagnostics(text, uri) // debounced, fire-and-forget
    return diags
  }

  private async _checkHardRules(text: string, _uri: string): Promise<Diagnostic[]> {
    const entities = await this._dataReader.listEntities()
    const names = new Set<string>()
    for (const e of entities) {
      names.add(e.name.toLowerCase())
      for (const alias of e.aliases ?? []) names.add(alias.toLowerCase())
    }
    const diags: Diagnostic[] = []
    const lines = text.split(/\r?\n/)
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
      const line = lines[lineIdx]
      let col = 0
      while (col < line.length) {
        if (line[col] === '@') {
          const start = col + 1
          let end = start
          while (end < line.length && !/\s/.test(line[end])) end += 1
          const mention = line.slice(start, end)
          if (mention !== '' && !names.has(mention.toLowerCase())) {
            diags.push({
              range: {
                start: { line: lineIdx, character: col },
                end: { line: lineIdx, character: end },
              } satisfies Range,
              severity: DiagnosticSeverity.Warning,
              source: 'app-hard',
              message: `Unknown entity: @${mention}`,
            })
          }
          col = end
        } else col += 1
      }
    }
    return diags
  }

  private async _checkDomainRules(_text: string, _uri: string): Promise<Diagnostic[]> {
    return [] // TODO: instance 별 domain consistency checks (instance 측 entity 스키마 정의에 따라 구현)
  }

  private _scheduleSoftDiagnostics(text: string, uri: string): void {
    if (this._softDiagTimer !== null) clearTimeout(this._softDiagTimer)
    if (this._softDiagAbort !== null) this._softDiagAbort.abort()
    this._softDiagAbort = new AbortController()
    const abortController = this._softDiagAbort
    this._softDiagTimer = setTimeout(() => {
      void this._runSoftAgent(text, uri, abortController.signal)
    }, SOFT_DIAG_DEBOUNCE_MS)
  }

  private async _runSoftAgent(text: string, uri: string, abortSignal: AbortSignal): Promise<void> {
    if (this._agentRunner === undefined) return
    const timeoutSignal = AbortSignal.timeout(AGENT_TIMEOUT_MS)
    const combined = AbortSignal.any([abortSignal, timeoutSignal])
    try {
      const buffer: string[] = []
      for await (const event of this._agentRunner.runAgent({
        agent: 'lsp-diagnostic',
        userInput: LSPBridge._buildDiagnosticPrompt(text),
        maxTurns: 1,
        signal: combined,
      })) {
        if (event.text !== undefined) buffer.push(event.text)
      }
      // Parse buffer.join('') into Diagnostic[] (see _buildDiagnosticPrompt format)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return // expected (timeout / debounce)
      console.warn(JSON.stringify({ event: 'soft_diagnostics_failed', uri, error: String(err) }))
    }
  }

  private static _buildDiagnosticPrompt(text: string): string {
    // NOTE: instance 측 domain 에 맞춰 prompt 교체 (예: prose narrative / code symbol / blog post).
    return (
      'Analyze the following workspace text for inconsistencies. ' +
      'Report: LINE:<n> SEVERITY:<warning|error> MESSAGE:<desc>\n\n' +
      `---\n${text}\n---`
    )
  }
}
```

## Feature 우선순위 + 구현 순서

| 순서 | Feature | 모듈 | 의존 |
|------|---------|------|------|
| 1 | **Completion** | `completions.ts` | DataReader |
| 2 | **Diagnostics** | `diagnostics.ts` | DataReader + Bridge |
| 3 | **Hover** | `hover.ts` | DataReader |
| 4 | **Definition** | registry inline | DataReader (canonicalUri) |
| 5 | **Semantic Tokens** | `semanticTokens.ts` | DataReader + NER + legend |

근거: Completion 이 가장 단순하고 유저 가치가 크다. Diagnostics 에서 Bridge agent
호출 경로를 처음 검증. Hover 는 entity cache 재사용. Definition 은 가장 얇다.

## Agent 호출 패턴

LSP 는 SSE 와 다르다 — 결과 완전 수집 후에야 CompletionItem / Diagnostic 구성 가능.
**non-streaming collect 패턴**:

```
LSP request → LSPManager → entity cache 필터 (빠름, agent 불필요)
                         → [soft diagnostics 만] agent loop 호출
                              → runAgent({ maxTurns: 1 })
                              → text event buffer 수집
                              → 파싱 → Diagnostic[] 반환
```

> `maxTurns: 1` 이 핵심. tool_use 루프에 진입하면 IDE 타임아웃을 초과한다.
> `AbortSignal.timeout(10_000)` hard timeout 필수.

## 동시성 함정 — 이 서브시스템 고유

1. **stale instance text**
   `didChange` 처리 중 `computeDiagnostics` 가 이전 버전 text 를 읽는다.
   해결: `updateDocument` → `computeDiagnostics` 를 같은 `await` chain 에서
   sequential 호출. 별도 Promise 분리하면 race condition 발생.

2. **registry memory leak**
   `didOpen` 으로 생성된 LSPInstance 가 `didClose` 누락 시 영원히 남는다 (IDE
   비정상 종료). 해결: LSPManager 의 `cleanupStaleInstances(maxAgeSec=300)`
   주기적 정리. instance 에 `lastAccessed: number` 추가, 5분 이상 미접근 시 제거.

3. **agent loop 이 LSP 타임아웃보다 느림**
   IDE 클라이언트는 5–10초 내 응답 기대. agent loop 이 tool_use 에 빠지면 수십 초.
   해결: (a) `maxTurns: 1` — tool loop 진입 금지 (b) `AbortSignal.timeout(10_000)`
   hard timeout (c) timeout 시 빈 다이내믹 반환 (fail-open). agent 가 느리다고 IDE 가
   멈추면 안 된다.

4. **request-scoped runtime 에서 setInterval 금지**
   `cleanupStaleInstances` 의 `setInterval` 은 **process-based runtime 전용**. request-scoped runtime 동거 시
   runtime cron trigger 또는 요청 hook 으로 대체. → 위 "배포 형태 — runtime 호환성" 참조.

   **환경별 cleanup 트리거 매트릭스**:

   | 환경 | 트리거 | 호출 시점 |
   |------|--------|-----------|
   | 옵션 A — process-based runtime (예: 컨테이너 호스팅) | `setInterval(60_000)` | `LSPManager.getInstance()` 시 `_startCleanup()` |
   | 옵션 B — request-scoped runtime + cron trigger | runtime cron 설정 (예: `*/1 * * * *`) + scheduled 핸들러 | scheduled event 마다 `manager.cleanupStaleInstances()` |
   | 옵션 B — request-scoped runtime + 요청 hook | `<framework middleware registration>('*', async (ctx, next) => { await next(); if (Math.random() < 0.01) manager.cleanupStaleInstances() })` | 요청 100건당 1번 |

   request-scoped runtime 변형 예시 (옵션 B + Cron, 의사코드):

   ```typescript
   // <api-app>/src/lsp/scheduled.ts — runtime cron handler (runtime-specific signature)
   export const scheduled = async (_event: unknown, env: Env, ctx: unknown) => {
     const manager = LSPManager.getInstance({ dataReader: env.dataReader, bridge: env.bridge })
     // runtime background task helper 로 등록
     // <runtime background task>(Promise.resolve(manager.cleanupStaleInstances()))
   }
   ```

   `LSPManager.getInstance()` 에 `autoStartCleanup: boolean` 옵션 추가하여
   옵션 A = `true` (default), 옵션 B = `false` (Cron 외부 트리거) 분기.

## 검증 체크리스트

- [ ] `createLSPServer` 가 `vscode-languageserver` `Connection` 반환
- [ ] 6개 핸들러: initialize, didOpen, didChange, completion, hover, definition
- [ ] LSPManager singleton — `getInstance()` + `reset()` 패턴
- [ ] LSPRegistry per-workspace — entity cache lazy-load + `invalidateEntityCache()`
- [ ] LSPInstance — `uri` / `text` / `version` / `lastDiagnostics` / `lastAccessed` + `getWordAt()`
- [ ] LSPBridge.runDiagnostics 가 hard rule (즉시) + soft rule (debounced) 분리
- [ ] agent 호출 시 `maxTurns: 1` + `AbortSignal.timeout(10_000)` hard timeout
- [ ] vitest 스켈레톤 1개 이상 (mock DataReader → completion item shape 검증)
- [ ] request-scoped runtime 비호환 — 별도 process-based 빌드 타겟으로 분리 (runtime 호환성 invariant — instance 측 project-local skill)

## 구현 중 막히면

- **"completion 이 안 뜬다"** → `capabilities.completionProvider.triggerCharacters`
  에 `@` 포함 확인. 없으면 클라이언트가 요청을 안 보낸다. return 타입이
  `CompletionList | null` 인지 확인 — `null` 은 미지원, 빈 리스트는 후보 없음.

- **"diagnostic 이 stale 텍스트에 걸려있다"** → `onDidChangeTextDocument` 에서
  `updateDocument` 후 `computeDiagnostics` 를 같은 `await` chain 에서 호출하는지
  확인. 별도 fire-and-forget Promise 시 이전 text 로 계산됨. 동시성 함정 #1.

- **"IDE 클라이언트가 30초 후 disconnect"** → WebSocket keepalive 누락
  확인. agent 타임아웃 미설정 시 단일 요청 30초 블로킹. 동시성 함정 #3.

- **"entity cache 가 갱신되지 않는다"** → 엔티티 변경 (single-writer 경로) 후
  `LSPRegistry.invalidateEntityCache()` 호출 확인. `single-writer` invariant 참조.

## Cross-ref

- `sse-streaming` — LSP 와 SSE 의 차이 (LSP = JSON-RPC long-lived, SSE = stream HTTP)
- `ts-agent-rules` — TS interface DI / AsyncLocalStorage 10 필드
- runtime 호환성 invariant (instance 측 project-local skill) — `lsp/` 경로 별도 빌드 타겟
- `single-writer` — `invalidateEntityCache()` 호출 시점

## Placeholder 해석

본 workflow 의 `<workspace-entity>` placeholder 는 instance 측에서 해석:
- iyaki 프로젝트 예: prose-editor 의 character / scenario / persona mention (`@` trigger)
- code editor 예: function / class / variable symbol (`@` trigger)
- blog 예: post / category / tag mention (`#` or `[[` trigger)
- 다른 instance: 자체 CLAUDE.md 에 매핑 명시

instance 별 entity 스키마 (`Entity.name` / `aliases` / `type` / `summary` 외 추가 필드)
는 instance 측 `./types.ts` 에 정의. 본 skill 의 4-class 구조 / cleanup / timeout / bridge
패턴은 instance 와 무관하게 동일.
