---
name: new-agent
description: 새 agent 정의 (`<api-app>/src/agents/<name>.yaml` + `<api-app>/src/agents/prompts/<name>.md`) 추가 시 invoke. AgentDefinitionSchema 정본은 [[ai-agent-patterns]] — 본 skill 은 *워크플로 절차* (생성 → 등록 → 스모크 테스트 → Codex sub-agent TOML 미러) 만 안내. agent-loop-invariants + run-policy-presets + spawn-limits invariant 자동 적용.
metadata:
  role: workflow
  scope: project
---

# new-agent — 에이전트 추가 워크플로

> **schema 정본은 [[ai-agent-patterns]]**. 본 skill 은 *절차 + 미러 안내* 만 담당. zod schema 필드 / loader 규약 / coordinator vs worker 도구 화이트리스트 / cache 정책은 [[ai-agent-patterns]] 가 SoT.

## 이 skill 은 언제 invoke 되는가

- `<api-app>/src/agents/<name>.yaml` 최초 생성
- `<api-app>/src/agents/prompts/<name>.md` 시스템 프롬프트 작성
- "새 sub-agent 추가하고 싶다" 사용자 요청
- Codex `new_agent_builder` sub-agent (`plugins/backend-ts/.codex/agents/new_agent_builder.toml`) 호출 시 자동 로드

## 절차 (6 step)

1. **`<api-app>/src/agents/<name>.yaml`** — `AgentDefinitionSchema` 준수 (정본은 [[ai-agent-patterns]] §"`AgentDefinition` 스키마")
2. **`<api-app>/src/agents/prompts/<name>.md`** — system prompt (Layer 2 — [[context-assembly]] §3-Layer)
3. [[agent-loop-invariants]] 확인 (LoopDeps / RunPolicyLike 호환)
4. [[run-policy-presets]] 확인 (preset 선택 또는 신규 RunPolicy)
5. [[spawn-limits]] 확인 (sub-agent 사용 시 — MAX_SPAWN_DEPTH=3 가드)
6. Codex sub-agent 미러 — `plugins/backend-ts/.codex/agents/<name>.toml` (정본 위치는 [[codex-subagents]] — TOML 형식, `.codex-plugin/agents/` ✕)

## YAML 스키마 (정본 = [[ai-agent-patterns]])

```yaml
# <api-app>/src/agents/<name>.yaml
name: <snake_case>             # ^[a-z0-9_]+$ + 파일 stem 과 일치 (loadAgent 가 <name>.yaml 검색)
description: <one-sentence>    # nullable().optional() 이지만 UI /debug/agents 노출용으로 권장
systemPromptFile: <name>.md    # prompts/ 하위 상대 경로 (camelCase — snake_case ✕)
tools:                         # null = 전체 허용 / [] = 도구 없음 / list = 화이트리스트
  - <tool_name>                # coordinator: spawn_agent/send_message/task_stop 만
  - <tool_name>                # worker: spawn_agent 반드시 ✕ (무한 재귀)
modelPreference: <chain_name>  # providers.yaml 의 fallback chain 이름. default 'default'
maxToolRounds: 10              # int 1-100. default 10
temperature: 0.7               # 선택. 0 ≤ x ≤ 2 nullable
```

zod `AgentDefinitionSchema.parse()` 가 boot 시 검증 — 오타 필드는 `.strict()` 에 의해 ZodError → 서버 부팅 실패 (fail-fast). schema 자체 변경 시 [[ai-agent-patterns]] + 본 skill + audit-all.sh 의 `agent_verify_def_check()` 3 곳 동시 갱신 의무.

## Coordinator vs Worker 분류 (도구 화이트리스트로 결정)

본 plugin 의 schema 에는 *명시적 role 필드 ✕*. 분류는 `tools` 화이트리스트 + 사용처로 결정:

| | Coordinator | Worker |
|---|---|---|
| 목적 | 오케스트레이션 | 실제 작업 수행 |
| `tools` 화이트리스트 | `spawn_agent` / `send_message` / `task_stop` 3개만 ([[ai-agent-patterns]] L135 `COORDINATOR_TOOLS` 정본) | 도메인 도구 (search / edit / build 등). **`spawn_agent` 반드시 ✕** |
| sub-agent spawn | Yes | No |
| 모델 권장 | opus (판단 heavy) | sonnet / haiku (실행) |
| 예시 | `planner`, `dispatcher` | `writer`, `analyst`, `debugger` |

**금지**: worker 가 `spawn_agent` 도구 포함 → 무한 재귀 → `SpawnDepthExceeded` ([[spawn-limits]]).

검증 코드 패턴은 [[ai-agent-patterns]] §"Tool 선택 휴리스틱" `assertWorkerTools()` 참조.

## 시스템 프롬프트 템플릿

```markdown
<!-- <api-app>/src/agents/prompts/<name>.md -->
You are the <agent_name> agent.

## Role
<specific purpose — 1-2 sentences>

## Available capabilities
<list of key tools / actions>

## Constraints
- <constraint 1: e.g., "always ask before destructive actions">
- <constraint 2>

## Output format
<expected response shape — markdown / JSON / streaming / tool_use>
```

### 프롬프트 금지

- 동적 값 (timestamp / turn count / session id) — system prompt caching cache miss 유발 ([[ai-agent-patterns]] §Context budgeting)
- 도구 스키마 inline 서술 — API `tools` 파라미터 담당
- 다른 agent 의 prompt 중복 — `base.md` 로 공통화 ([[context-assembly]] §Layer 1)

## 등록 체크리스트

1. `<api-app>/src/agents/<name>.yaml` 작성 (schema 통과)
2. `<api-app>/src/agents/prompts/<name>.md` 작성 (base.md 계승)
3. `<api-app>/config/providers.yaml` 의 `fallback_chains` 에 `modelPreference` 값 존재 확인
4. 모든 도구명이 `ToolRegistry.names()` 에 등록 확인
5. loader boot smoke: runtime-specific dev server CLI → 로그에서 새 agent 등록 확인 (instance 측 project-local skill 참조)
6. 스모크 테스트: `<api-app>/test/agents/<name>.test.ts` 작성 (아래 스켈레톤)
7. `tsc --noEmit` + `eslint` (또는 `biome check`) 통과
8. **Codex sub-agent 미러**: `plugins/backend-ts/.codex/agents/<name>.toml` 작성 ([[codex-subagents]] 정본). Claude `.claude/agents/<name>.md` 가 필요한 경우는 별도 — backend-ts 의 18 agent 는 Codex TOML 만.

## 스모크 테스트 스켈레톤

```typescript
// <api-app>/test/agents/<name>.test.ts
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

## Codex sub-agent TOML (`plugins/backend-ts/.codex/agents/<name>.toml`)

정본 형식은 [[codex-subagents]]. minimal seed 예시:

```toml
name = "<name>"
description = "<one-sentence>"
sandbox_mode = "read-only"        # 또는 "workspace-write" — agent 책임 범위
# model = "gpt-5-codex"           # 선택 — 생략 시 user 설정 따름
# model_reasoning_effort = "high" # 선택

developer_instructions = """
You are the <name> agent.

## Scope
...

## Out of scope
...

## Required reading (skills)
[[ai-agent-patterns]] / [[agent-loop-invariants]] / [[<related-skills>]]

## Process
...
"""
```

`.codex/agents/<name>.toml` 위치 + TOML 형식 + `sandbox_mode` 선택 근거는 [[codex-subagents]] 참조.

## 공통 함정

1. **`tools: []` + worker 사용 의도** — 아무 것도 못함. 최소 1개 도구 필요 (순수 텍스트 agent 면 명시적 의도 주석)
2. **YAML `name` ≠ 파일명** — `loadAgent("<name>")` 가 `<name>.yaml` 검색 → stem mismatch 시 ResourceError
3. **base.md 없음** — prompt 공통 레이어 부재로 중복 증가. 먼저 base.md 생성 ([[context-assembly]])
4. **fallback chain 이름 오타** — boot 시 ZodError. `config/providers.yaml` 확인
5. **schema 정본 drift** — `AgentDefinitionSchema` 변경 시 [[ai-agent-patterns]] / 본 skill / `audit-all.sh` 의 `agent_verify_def_check()` 3 곳 동시 갱신
6. **prompt 에 동적 값** — 자동 캐시 miss → 토큰 비용 폭증. lint 단계에서 timestamp/session id 정규식 검출
7. **Codex marker stale 위치** — `.codex-plugin/agents/<name>.md` 는 *v3 부정 안내 대상* (Codex spec 에 부재). 정공법은 `.codex/agents/<name>.toml` ([[codex-subagents]] v4 정본)

## 검증 체크리스트

- [ ] YAML 모든 필수 필드 채움 (`AgentDefinitionSchema.parse()` 통과)
- [ ] coordinator/worker 분류 + 도구 allowlist 가 분류와 일치 (worker 에 `spawn_agent` ✕)
- [ ] 프롬프트에 동적 값 없음 (timestamp / turn_count / session_id)
- [ ] base.md 계승 구조 (프롬프트 레이어링)
- [ ] 스모크 테스트 1개 통과 (vitest)
- [ ] loader boot 시 새 agent 등록 로그 확인
- [ ] `tsc --noEmit` + eslint (또는 biome) 통과
- [ ] Codex sub-agent 미러: `.codex/agents/<name>.toml` (TOML 형식, [[codex-subagents]] 정본 위치)
- [ ] [[agent-loop-invariants]] 의 LoopDeps / RunPolicyLike 호환
- [ ] [[spawn-limits]] 의 MAX_SPAWN_DEPTH 가드 적용 (coordinator 의 spawn 호출 경로)

## 구현 중 막히면

- 도구 이름이 런타임 에러 → `ToolRegistry` 등록 순서 확인. `/new-tool` 로 먼저 도구 등록
- 모델 호출 실패 → `config/providers.yaml` provider credentials 확인 (`<framework env binding>.<PROVIDER>_API_KEY`)
- 로더가 agent 못 찾음 → 파일명 = YAML `name` 일치 + 디렉토리 위치 (`<api-app>/src/agents/`) 확인
- 프롬프트가 너무 김 → 8000 토큰 초과 시 `TokenBudget.AGENT` 위반 ([[token-budget-constants]]). 축소 또는 base.md 로 이동
- spawn 호출 시 `SpawnDepthExceeded` — 부모 agent depth + 1 ≤ 3 검증 ([[spawn-limits]])
