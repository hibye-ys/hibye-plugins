---
name: new-run
description: 새 agent run 정의 시 invoke. `apps/api/runs/<name>.yaml` + `apps/api/runs/prompts/<name>.md` 스캐폴드 — 4 RunPolicy preset (interactive / classifier / tool-based / multi-agent) 중 선택. name pattern + full-form 필드명 + cross-field validation 강제. run-policy-presets + sse-lifecycle + token-budget-constants + spawn-limits invariant 자동 적용. new-agent 와 경계 분리 (agents 는 spawn 대상 / runs 는 `POST /run/<name>` 엔드포인트).
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/new-run
---

**적용된 §4.4 매트릭스 행**: `pydantic BaseModel RunPolicy` + `model_config = ConfigDict(extra="forbid", frozen=True)` → `zod schema` + `.strict()` + `Readonly<T>` (또는 `as const`), `@model_validator(mode="after")` → `zod refine()` / `superRefine()`, `asyncio.Task` → `Promise` + `AbortController`, `asyncio.CancelledError` → `AbortError`, `EventSourceResponse` (sse_starlette) → `streamSSE` (hono/streaming), `uvicorn backend.main:app --port 8001` → `wrangler dev` 또는 `tsx src/index.ts`, `curl -fs http://localhost:8001/health` 동일, `pytest` → `vitest`, env access `os.environ` → `c.env`

# new-run — `POST /run/<name>` 엔드포인트 스캐폴드

## 이 skill 은 언제 invoke 되는가

- `/new-run <name>` Codex/Claude command 실행
- 사용자가 "새 run endpoint", "POST /run/<name>" 추가 언급
- `apps/api/runs/*.yaml` 파일 생성 / 복제 필요
- 새 RunPolicy preset 만들 때 (4종 외 신규)

## 경계 (vs new-agent vs new-tool)

| Skill | 대상 경로 | 생성 결과 | 라우트 |
|---|---|---|---|
| `new-tool` | `apps/api/src/tools/<name>.ts` | Tool interface 구현 + 테스트 | N/A (ToolRegistry) |
| `new-agent` | `apps/api/agents/<name>.yaml` + prompts | `AgentDef` + prompt (zod) | N/A (agent registry, spawn 대상) |
| **`new-run` (본)** | `apps/api/runs/<name>.yaml` + prompts | `RunPolicy` + prompt | `POST /run/<name>` 자동 dispatch |

## 절차 (6 step)

1. **`apps/api/src/runs/<name>.ts`** (또는 yaml-only 의 경우 yaml + 자동 dispatch) — Run handler 정의
2. `run-policy-presets` 적용 — 4 preset 중 선택 또는 cross-field 검증 통과 신규
3. `sse-lifecycle` 룰 따라 SSE 스트림 (sse=true 인 경우) — `streamSSE` + 12 이벤트 + 종료 4 제약
4. `token-budget-constants` 로 budget 체크 — TokenBudget.RUN 등 적용
5. `AbortController` + onAbort 핸들러 — 클라이언트 끊김 / max_turns 초과 / spawn depth 초과 시 graceful abort
6. `test-scaffold` + SSE 골격 — vitest + sse curl smoke

## RunPolicy 정본 (`apps/api/src/engine/policy.ts`)

```typescript
import { z } from 'zod'

export const GLOBAL_MAX_SPAWN_DEPTH = 3

export const RunPolicySchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/).min(1).max(64),
  description: z.string().nullable().default(null),
  systemPromptFile: z.string(),
  modelPreference: z.string().default('default'),
  allowedTools: z.array(z.string()).nullable().default(null),
  maxTurns: z.number().int().positive().default(50),
  compactionEnabled: z.boolean().default(true),
  spawnEnabled: z.boolean().default(false),
  maxSpawnDepth: z.number().int().nonnegative().default(0),
  responseSchema: z.string().nullable().default(null),
  sse: z.boolean().default(true),
  sessionEnabled: z.boolean().default(true),
  requiredScope: z.string().nullable().default(null),
}).strict().superRefine((p, ctx) => {
  // cross-field 검증 — 아래 §Cross-Field Validation 참조
  if (p.spawnEnabled && p.allowedTools !== null && !p.allowedTools.includes('spawn_agent')) {
    ctx.addIssue({ code: 'custom', message: 'spawn_enabled=true requires spawn_agent in allowedTools' })
  }
  if (p.spawnEnabled && p.maxSpawnDepth < 1) {
    ctx.addIssue({ code: 'custom', message: 'spawn_enabled=true requires maxSpawnDepth >= 1' })
  }
  if (p.maxSpawnDepth > GLOBAL_MAX_SPAWN_DEPTH) {
    ctx.addIssue({ code: 'custom', message: `maxSpawnDepth must be <= ${GLOBAL_MAX_SPAWN_DEPTH}` })
  }
  if (!p.compactionEnabled && p.maxTurns > 10) {
    // WARNING only — 통과시키되 로그 경고
    console.warn(JSON.stringify({ warn: 'PTL risk', maxTurns: p.maxTurns, compactionEnabled: false }))
  }
})

export type RunPolicy = Readonly<z.infer<typeof RunPolicySchema>>
```

- **`.strict()`** — 오타 필드는 boot 시 `ZodError` → 서버 부팅 실패 (Python `extra="forbid"` 대응)
- **`Readonly<T>`** — 인스턴스 mutate 차단 (Python `frozen=True` 대응 — 컴파일 타임)
- **name pattern**: underscore 만 허용 (`chat_test` ✅ / `chat-test` ❌)

## 4 Presets

### 1. `interactive` (default) — 대화형, **conservative**

**중요**: `allowedTools` 는 `apps/api/src/tools/` 에 실제 등록된 **개별 이름** 만. zod `RunPolicySchema` + `run-policy-presets` invariant 가 boot 에 fail-fast. 등록된 도구 이름은 `apps/api/src/tools/index.ts` 의 `registerBuiltinTools()` + 각 `.ts` 의 `name: '...'` attribute 참조.

- **baseline (예시)**: `read_file`, `write_file`, `edit_file`, `spawn_agent`
- **domain query / mutate 도구**: 도메인 boundary 룰 (`app-domain-boundary`) 에 따라 등록 — 실제 등록 리스트는 `src/tools/index.ts` 직접 확인

**aggregate 이름 (예: `entity_query`, `entity_mutate`, `search_files`, `glob_files`) 가 실존하지 않으면 금지.** 파일명과 tool name 이 다르므로 항상 `src/tools/*.ts` 의 `name: '...'` 을 직접 확인.

```yaml
name: <name>
description: "TODO: describe what this run does"
system_prompt_file: "<name>.md"
model_preference: "default"

# Conservative tool scope — registered tool names only.
# TODO: 실제 요구에 맞게 src/tools/ 등록 이름 중 선택 후 추가
allowed_tools:
  - read_file

max_turns: 100
compaction_enabled: true
spawn_enabled: false     # 대화형은 spawn 비활성 default (multi-agent preset 별도)
max_spawn_depth: 0
sse: true
session_enabled: true
```

**근거**: 대화형은 장시간 + compaction 필요. 하지만 spawn 은 명시적 요구시에만 — 무한 재귀 리스크 + 권한 확장 최소화 원칙 (`design-principles` §1 safe defaults). 허용 도구도 최소 (`read_file`) — 사용자가 확장 시점에 등록 이름 확인 + TODO 주석으로 유도.

### 2. `classifier` — 단발 분류, JSON 응답

```yaml
name: <name>
description: "TODO: describe classification task"
system_prompt_file: "<name>.md"
model_preference: "default"
allowed_tools: []           # 도구 없음 — 순수 LLM 분류
max_turns: 1
compaction_enabled: false
response_schema: "<TODO: zod schema name>"  # e.g. "ClassificationResult"
sse: false                  # response_schema 와 sse=true 는 상호배타
session_enabled: false
```

**근거**: 1턴, 도구 없음, 고정 JSON → compaction 불필요, SSE 불필요, 세션 불필요.

### 3. `tool-based` — 제한 도구 + 구조화 출력

```yaml
name: <name>
description: "TODO: describe task"
system_prompt_file: "<name>.md"
model_preference: "default"
# TODO: src/tools/ 등록 개별 이름만 (aggregate 이름은 실존 ✕)
# 예시: read_file, edit_file, write_file (실제 등록 리스트는 src/tools/index.ts 참조)
allowed_tools:
  - read_file
max_turns: 5                # 과도한 turn 방지
compaction_enabled: false
response_schema: "<TODO: zod schema name>"
sse: false
session_enabled: false
```

**근거**: 도구 호출 몇 번으로 완결되는 작업 (검색/조회 → 판단). `max_turns: 5` 로 비용 상한.

### 4. `multi-agent` — coordinator + spawn

```yaml
name: <name>
description: "TODO: describe coordinator role"
system_prompt_file: "<name>.md"
model_preference: "default"
allowed_tools:
  - read_file
  - spawn_agent            # ← spawn_enabled: true 와 정합 필수
max_turns: 20
compaction_enabled: true
spawn_enabled: true
max_spawn_depth: 2         # global cap = 3 (GLOBAL_MAX_SPAWN_DEPTH)
sse: true
session_enabled: true
```

**근거**: spawn 은 명시 활성화 필요. `max_spawn_depth: 2` 는 보수적 — 3 은 global cap, 초과 ✕.

## Cross-Field Validation

zod `RunPolicySchema.superRefine` 가 boot 시 검사:

1. `spawn_enabled: true` + `allowed_tools` ≠ null + `spawn_agent` 미포함 → **reject**
2. `spawn_enabled: true` + `max_spawn_depth < 1` → **reject** (모순)
3. `max_spawn_depth > GLOBAL_MAX_SPAWN_DEPTH (= 3)` → **reject**
4. `compaction_enabled: false` + `max_turns > 10` → WARNING only (PTL 리스크)
5. `sse: true` + `response_schema` 설정 → request-time 422 (boot 에선 통과, 실행 시 reject)

## SSE 핸들러 골격 (`apps/api/src/routes/run.ts`)

```typescript
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { HTTPException } from 'hono/http-exception'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getRunPolicy } from '../engine/runs.ts'
import { runAgentLoop } from '../engine/loop.ts'

const RunRequestSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
})

const runRouter = new Hono<{ Bindings: Env }>()

runRouter.post('/:name',
  zValidator('json', RunRequestSchema),
  async (c) => {
    const runName = c.req.param('name')
    const body = c.req.valid('json')

    const policy = getRunPolicy(runName)
    if (!policy) throw new HTTPException(404, { message: `run '${runName}' not found` })

    if (policy.sse) {
      return streamSSE(c, async (stream) => {
        const abortController = new AbortController()
        c.req.raw.signal.addEventListener('abort', () => abortController.abort())

        try {
          for await (const event of runAgentLoop({
            policy,
            userInput: body.message,
            sessionId: body.session_id,
            env: c.env,
            signal: abortController.signal,
          })) {
            // sse-lifecycle invariant — 12 이벤트 / 종료 4 제약 / single-writer
            await stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) })
          }
        } catch (err) {
          // AbortError 는 graceful — error 이벤트 ✕ (client 가 끊음)
          if ((err as Error).name !== 'AbortError') {
            await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: String(err) }) })
          }
        }
        // sse-lifecycle: done 이벤트는 runAgentLoop 내부 generator 가 보장
      })
    }

    // non-SSE: 단일 JSON 응답 (response_schema 적용)
    const events = []
    for await (const event of runAgentLoop({
      policy,
      userInput: body.message,
      sessionId: body.session_id,
      env: c.env,
    })) {
      events.push(event)
    }
    return c.json({ events })
  }
)

export default runRouter
```

## 스캐폴드 절차

1. **Parse args**: `$ARGUMENTS` 에서 `name` + optional `preset`
2. **Validate name**: `/^[a-z0-9_]+$/` + 길이 1~64. 실패 시 "use underscore, not hyphen" 가이드
3. **Check duplicate**: `apps/api/runs/<name>.yaml` 존재 시 abort
4. **Ensure dirs**: `apps/api/runs/` + `apps/api/runs/prompts/` 없으면 생성 (`mkdir -p`)
5. **Write YAML**: 선택된 preset 템플릿 → `apps/api/runs/<name>.yaml`
6. **Write prompt**: 아래 템플릿 → `apps/api/runs/prompts/<name>.md`
7. **Smoke**:
   - `npx wrangler dev --port 8787 &` 또는 `npx tsx src/index.ts &` + 부팅 대기
   - `curl -fs http://localhost:8787/health` — boot 확인
   - `curl -fs http://localhost:8787/runs | jq` — `/runs` 에 새 이름 등장 확인
   - 프로세스 정리 (`kill` + trap cleanup)
8. **Report**: 생성 경로 + 다음 단계 안내

## Prompt 템플릿 (`apps/api/runs/prompts/<name>.md`)

```markdown
# <name> system prompt

<TODO: describe the agent's role, personality, and task boundaries>

## 역할
...

## 금지
- 시크릿 / API key / 개인정보 노출
- ...

## 출력 형식
<사용자 지정 스키마 또는 자연어 설명>
```

**Static system prompt 원칙** (`context-assembly`):
- 동적 값 (timestamp, session_id, random) 삽입 ✕ — prompt cache prefix 무효화
- `{변수}` placeholder 가 runtime 에 치환되는 것도 ✕ — Layer 2 동적 영역은 API messages 경로로

## 완료 후 사용자 가이드

```
✓ Scaffolded: apps/api/runs/<name>.yaml
✓ Scaffolded: apps/api/runs/prompts/<name>.md
✓ Smoke PASS: /runs includes "<name>"

다음 단계:
  1. apps/api/runs/prompts/<name>.md 의 TODO 채우기
  2. response_schema 를 사용했다면:
     - zod schema 를 apps/api/src/routes/schemas.ts 에 선언 (또는 src/engine/types.ts)
     - apps/api/src/engine/schemas.ts::registerResponseSchema('<Name>', <ZodSchema>) 호출 추가
     - src/index.ts 부팅 시 registerResponseSchemas() 호출 — response_schema: <Name> 이 load-time 에 resolve
  3. allowed_tools 재검토 — 실 수요에 맞게 좁히기
  4. 테스트 추가:
     apps/api/test/runs/<name>.test.ts
  5. 실제 호출:
     curl -N -X POST http://localhost:8787/run/<name> \
       -H 'Content-Type: application/json' \
       -d '{"message":"hello"}'
  6. Hot reload (선택):
     POST /runs/reload  (runs:admin scope 필요)
```

## Non-Goals

- 자동으로 `POST /runs/reload` 호출 ✕ — scope 필요
- zod schema 자동 생성 ✕ — 사용자가 `response_schema` 필드에 이름만 지정
- 기존 파일 덮어쓰기 ✕ — 실수로 삭제 방지
- 테스트 파일 자동 생성 ✕ — `apps/api/test/` 는 사용자가 별도 추가
- `apps/api/src/index.ts` 수정 ✕ — 라우트는 RunRegistry 자동 dispatch

## 절대 금지

- hyphen 포함 이름 (`chat-test`, `my-run`) 통과 — 반드시 underscore (`chat_test`)
- full form 아닌 필드명 (`compaction`, `spawn`, `session`) 스캐폴드 — zod `.strict()` 가 boot 에 reject
- `max_spawn_depth > 3` 스캐폴드 — `GLOBAL_MAX_SPAWN_DEPTH` 초과
- `sse: true` + `response_schema` 조합 스캐폴드 — 상호배타
- 대화형 preset 에 `spawn_enabled: true` default — multi-agent preset 과 분리 유지
- Prompt 에 동적 값 삽입 — prompt cache 무효화

## 검증 체크리스트

- [ ] YAML 모든 필드가 zod `RunPolicySchema` 통과
- [ ] preset 선택 + cross-field validation 모두 만족
- [ ] `allowed_tools` 의 모든 이름이 `ToolRegistry.names()` 에 실재
- [ ] SSE 핸들러가 `sse-lifecycle` 12 이벤트 + 종료 4 제약 준수
- [ ] AbortController 와 client signal 연결 + AbortError graceful 처리
- [ ] `token-budget-constants` 의 budget 적용 (RUN / AGENT / TOOL_RESULT 등)
- [ ] vitest smoke 통과 (1 turn → done 이벤트)
- [ ] curl boot smoke (`/health` + `/runs`) 통과

## 구현 중 막히면

- boot 시 `ZodError` → 어느 필드인지 메시지 확인. 오타 / 누락 필드 / cross-field 위반
- SSE 스트림이 흐르지 않음 → `streamSSE` 안 `stream.writeSSE` 가 generator pump 와 동기인지 확인
- AbortController 전파 안 됨 → `c.req.raw.signal` 리스너 등록 위치 확인 (streamSSE 콜백 시작 시점)
- spawn 시 `SpawnDepthExceeded` → 부모 run 의 `max_spawn_depth` 확인 + `spawn-limits` invariant
- response_schema 미해결 → boot 시 `registerResponseSchema('<Name>', schema)` 호출 누락. lifespan / on-boot 후크 확인
