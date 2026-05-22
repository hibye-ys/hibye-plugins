---
name: new-agent
description: 새 agent 정의 (`apps/api/src/agents/<name>.ts` + `apps/api/agents/<name>.yaml` + prompts/<name>.md) 추가 시 invoke. AgentDef interface + zod schema 검증 + tool allowlist 룰 (coordinator vs worker) + 등록/스모크 체크. agent-loop-invariants + run-policy-presets + spawn-limits invariant 자동 적용. Codex 의 .codex-plugin/agents/ 마커도 함께 생성.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/new-agent
---

**적용된 §4.4 매트릭스 행**: Python `ABC` / Protocol → TS `interface` (`AgentDef`), `async def step()` → `async function step()`, `pydantic BaseModel AgentConfig` → `zod schema`, `pytest @pytest.mark.asyncio` → `vitest`, `unittest.mock.AsyncMock` → `vi.fn().mockResolvedValue()`, `uvicorn backend.main:app` → `wrangler dev` (Workers) 또는 `tsx src/index.ts` (Node), `ruff check` + `ty check` → `tsc --noEmit` + `eslint` (또는 `biome check`)

# new-agent — 에이전트 추가 청사진

## 이 skill 은 언제 invoke 되는가

- `apps/api/agents/<name>.yaml` 또는 `apps/api/src/agents/<name>.ts` 최초 생성
- `apps/api/agents/prompts/<name>.md` 시스템 프롬프트 작성
- `new-agent-builder` sub-agent (Codex) 호출 시 자동 로드
- 에이전트 로더 스키마 검증 — zod schema 변경 시
- "새 sub-agent 추가하고 싶다" 사용자 요청

## 절차 (6 step)

1. **`apps/api/src/agents/<name>.ts`** — `AgentDef` interface 구현 (코드 정의)
2. `agent-loop-invariants` 확인 (RunOpts / LoopDeps 호환)
3. `run-policy-presets` 확인 (preset 선택 또는 신규 RunPolicy)
4. `spawn-limits` 확인 (sub-agent 사용 시 — MAX_SPAWN_DEPTH=3 가드)
5. `test-scaffold` 로 vitest 테스트 골격 생성
6. Codex marker `.codex-plugin/agents/<name>.md` 추가 (Claude `.claude/agents/<name>.md` 와 동시 미러)

## AgentDef interface

```typescript
// src/agents/types.ts — 공통 정의
import { z } from 'zod'

export const AgentConfigSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/).min(1).max(64),
  description: z.string().min(1),
  systemPromptFile: z.string(),  // e.g. "prompts/<name>.md" — agents/ 기준 상대
  role: z.enum(['coordinator', 'worker']),
  tools: z.array(z.string()).optional(),  // worker 만; coordinator 필수 명시
  modelPreference: z.string().default('default'),
  maxTurns: z.number().int().positive().default(10),
  maxOutputTokens: z.number().int().positive().default(4096),
  metadata: z.record(z.string()).optional(),
})

export type AgentConfig = z.infer<typeof AgentConfigSchema>

export interface AgentDef {
  readonly config: AgentConfig
  // 시스템 프롬프트는 loader 가 systemPromptFile 에서 읽어 주입
  // step / loop 는 src/engine/loop.ts 가 담당 — agent 본인은 config + prompt 만 정의
}
```

## YAML 스키마 (Codex marker / Claude agent 양쪽 호환)

```yaml
# apps/api/agents/<name>.yaml
name: <snake_case>               # 필수. loader 가 파일명과 대조
description: <one-sentence>      # 필수. 에이전트 선택 UI / 로그에 노출
system_prompt_file: prompts/<name>.md   # 필수. agents/ 기준 상대경로
role: coordinator | worker       # 필수. 아래 "역할" 섹션 참조
tools:                           # 선택. 비우면 worker 전체 허용, coordinator 필수 명시
  - <tool_name>
  - <tool_name>
model_preference: <chain_name>   # 필수. config/providers.yaml 의 fallback_chains key
max_turns: <int>                 # 선택, default 10
max_output_tokens: <int>         # 선택, default 4096
metadata:                        # 선택. 디버그용 태그
  owner: <team>
  since: <phase>
```

zod `AgentConfigSchema` 가 boot 시 yaml 파싱 결과를 검증 — 오타 필드는 ZodError → 서버 부팅 실패 (fail-fast).

## 역할 (Coordinator vs Worker)

| | Coordinator | Worker |
|---|---|---|
| 목적 | 오케스트레이션 | 실제 작업 수행 |
| 허용 도구 | `spawn_agent`, `send_message`, `task_stop`, `task_list` 등 orchestration only | 도메인 도구 (search, edit, build 등). **spawn_agent 금지** (무한 재귀) |
| sub-agent spawn | Yes | No |
| 모델 | 보통 opus (판단 heavy) | sonnet / haiku (실행) |
| 예시 | `planner`, `dispatcher` | `writer`, `analyst`, `debugger` |

**금지**: worker 가 `spawn_agent` / `agent` 도구를 갖는 구성. 무한 재귀 → `SpawnDepthExceeded` 에러 (`spawn-limits` invariant).

## 시스템 프롬프트 템플릿

```markdown
<!-- apps/api/agents/prompts/<name>.md -->
You are the <agent_name> agent.

## Role
<specific purpose — 1-2 sentences>

## Available capabilities
<list of key tools / actions>

## Constraints
- <constraint 1: e.g., "always ask before destructive actions">
- <constraint 2>
- <constraint 3>

## Output format
<expected response shape — markdown / JSON / streaming / tool_use>
```

### 금지 — 프롬프트에 넣지 말 것

- 현재 시각 / turn count / session id 등 **동적 값** (system prompt caching cache miss 유발)
- 도구 스키마 inline 서술 (API `tools` 파라미터가 담당)
- 다른 agent 의 프롬프트 중복 (`base.md` 로 공통화)

## 등록 체크리스트

1. `apps/api/agents/<name>.yaml` 작성 (zod schema 준수)
2. `apps/api/agents/prompts/<name>.md` 작성 (`base.md` 계승)
3. `apps/api/config/providers.yaml` 의 `fallback_chains` 에 `model_preference` 값이 존재하는지 확인
4. 모든 도구명이 `ToolRegistry.names()` 에 등록되어 있는지 확인
5. loader boot smoke: `wrangler dev` (Workers) 또는 `tsx src/index.ts` → 로그에서 새 agent 등록 확인
6. 스모크 테스트: `apps/api/test/agents/<name>.test.ts` 작성
   - mock provider (`vi.fn().mockResolvedValue(...)`) 가 간단한 text 반환
   - agent 로드 → 1 턴 실행 → `done` 이벤트 검증
7. `tsc --noEmit` + `biome check` (또는 `eslint`) 통과
8. Codex marker `.codex-plugin/agents/<name>.md` + Claude `.claude/agents/<name>.md` 미러 (코드와 동일 frontmatter)

## 스모크 테스트 스켈레톤

```typescript
// apps/api/test/agents/<name>.test.ts
import { describe, it, expect, vi } from 'vitest'
import { loadAgent } from '../../src/agents/loader.ts'
import { runAgentLoop } from '../../src/engine/loop.ts'

describe('<name> agent smoke', () => {
  it('completes one turn with done event', async () => {
    const agent = await loadAgent('<name>')

    const provider = {
      name: () => 'mock',
      callStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'text', delta: 'Hello.' }
        yield { type: 'done' }
      }),
    }

    const events: any[] = []
    for await (const event of runAgentLoop({
      agentSpec: agent,
      userInput: 'hi',
      history: [],
      provider,
    })) {
      events.push(event)
    }

    expect(events.at(-1)?.type).toBe('done')
  })
})
```

## Codex marker (`.codex-plugin/agents/<name>.md`)

```markdown
---
name: <name>
description: <one-sentence>
scope: <read-only | write>
depends_on:
  - agent-loop-invariants
  - run-policy-presets
  - <other dependent skills>
allowed-tools: Read, Grep, Glob, Bash  # write 가 필요한 경우만 Write/Edit 추가
---

# <name>

## Role
...

## Available capabilities
...

## Constraints
- ...

## Output format
...
```

`.claude/agents/<name>.md` 도 같은 frontmatter + 본문으로 미러. `codex-subagents` skill 참조.

## 공통 함정

1. **`tools: []` + role: worker** — 아무 것도 못하는 agent. 최소 1개 도구 필요 또는 순수 텍스트 agent 라면 `role: text_only` 표시 (YAGNI — 거의 없음)
2. **YAML `name` ≠ 파일명** — loader 가 파일명 기반으로 등록하는 경우 mismatch 발견 어려움. zod schema + loader 가 양쪽 검증
3. **base.md 없음** — prompt 공통 레이어 부재로 중복 증가. 먼저 `base.md` 생성
4. **fallback chain 이름 오타** — boot 시 ZodError. `config/providers.yaml` 확인
5. **Codex marker 와 Claude marker drift** — 한쪽만 갱신. PR 시 양쪽 diff 확인 의무
6. **prompt 에 동적 값** — 자동 캐시 miss → 토큰 비용 폭증. lint 단계에서 timestamp/session id 정규식 검출

## 검증 체크리스트

- [ ] YAML 모든 필수 필드 채움 (zod schema 통과)
- [ ] role 명시 + 도구 allowlist 가 role 과 일치 (worker 에 spawn_agent ✕)
- [ ] 프롬프트에 동적 값 없음 (timestamp / turn_count / session_id)
- [ ] base.md 계승 구조 (프롬프트 레이어링)
- [ ] 스모크 테스트 1개 통과 (vitest)
- [ ] loader boot 시 새 agent 등록 로그 확인
- [ ] `tsc --noEmit` + `biome check` 통과
- [ ] Codex `.codex-plugin/agents/<name>.md` + Claude `.claude/agents/<name>.md` 양쪽 미러 (drift ✕)
- [ ] `agent-loop-invariants` 의 LoopDeps / RunPolicyLike 인터페이스 호환
- [ ] `spawn-limits` 의 MAX_SPAWN_DEPTH 가드 적용 (coordinator 의 spawn 호출 경로)

## 구현 중 막히면

- 도구 이름이 런타임 에러 → `ToolRegistry` 등록 순서 확인. `/new-tool` 로 먼저 도구 등록
- 모델 호출 실패 → `config/providers.yaml` 의 provider credentials 확인 (`c.env.<PROVIDER>_API_KEY`)
- 로더가 agent 못 찾음 → 파일명 = YAML `name` 일치 + 디렉토리 위치 (`apps/api/agents/`) 확인
- 프롬프트가 너무 김 → 8000 토큰 초과 시 `TokenBudget.AGENT` 위반 (`token-budget-constants`). 축소 또는 `base.md` 로 이동
- spawn 호출 시 `SpawnDepthExceeded` — 부모 agent 의 depth + 1 ≤ 3 검증 (`spawn-limits` invariant)
