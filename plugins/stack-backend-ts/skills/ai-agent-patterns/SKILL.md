---
name: ai-agent-patterns
description: <api-app> 에 새 agent 정의 추가 / AgentDefinition 스키마 변경 / agent loader 수정 시 invoke. YAML + markdown prompt 선언, zod 기반 AgentDefinition 검증, in-memory cache (Map) 패턴, coordinator vs worker tool 제한, prompt cache 보전 안내.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/rules/ai-agent-patterns.md
---

**적용된 §4.4 매트릭스 행**:
- LLM client: `httpx` / `aiohttp` → **`fetch`** (runtime global)
- token counting: `tiktoken` → **`js-tiktoken`**
- env: `os.getenv("OPENAI_KEY")` → **`<framework env binding>.OPENAI_KEY`** (framework context binding)
- retry: `tenacity` → **`p-retry`**
- schema 검증: `pydantic BaseModel` → **`zod`** + `z.infer<typeof Schema>`
- 동시성: `asyncio.gather` → **`Promise.all`**
- 캐시: `@lru_cache(maxsize=64)` → **`Map<string, AgentDefinition>`** (singleton module-scoped) + 명시적 `clearAgentCacheForTests()`
- 타입: `class AgentDefinition(BaseModel)` → **`interface AgentDefinition` + `const AgentDefinitionSchema = z.object({...})`**

> source: `stack-backend-python/rules/ai-agent-patterns.md`
> *원칙* (tool 선택 휴리스틱 / context budgeting / safety gate 순서 / fallback 정책) 는 source 그대로 유지.

# ai-agent-patterns — 에이전트 정의 + 로더 (TS)

## 이 skill은 언제 invoke 되는가

- `<api-app>/src/agents/` 에 새 agent YAML 추가
- `AgentDefinition` zod schema 필드 추가 / 변경
- `loader.ts` / `discover.ts` 수정
- coordinator / worker tool 화이트리스트 변경
- "agent YAML 이 load 안 됨", "오타 필드가 통과됨", "prompt cache hit rate 떨어짐" 디버깅

## Scope

`<api-app>/src/agents/` 만. 에이전트가 **YAML + markdown prompt** 로 선언되고 zod 로 검증되는 구조 규약.

- spawn / depth / cache-safe params 는 `sub-agent` skill
- tool 필터링은 `tool-system` skill
- 프롬프트 조립은 `context-assembly` skill
- `/run/<name>` 라우팅은 `run-policy-presets` skill

## 불변식 (Invariants)

### 파일 레이아웃

```
<api-app>/src/agents/
├── loader.ts              # AgentDefinition + loadAgent() + loadAgentPrompt()
├── discover.ts            # discoverAgents() / discoverRuns() — UI용 스캔
├── prompts/
│   ├── base.md            # Layer 1 (모든 에이전트 공통 base prompt)
│   ├── chat.md            # agent-specific
│   └── <name>.md          # agent-specific (각 agent YAML 의 systemPromptFile 이 가리킴)
└── <name>.yaml            # 에이전트 선언 파일 — name 과 파일 stem 일치
```

- **Agent YAML 파일 이름 = `AgentDefinition.name`** 와 동일해야 함 (`loadAgent()` 가 `<name>.yaml` 을 찾음)
- prompt 파일은 `prompts/` 하위 — YAML 의 `systemPromptFile` 로 상대 경로 명시

### `AgentDefinition` 스키마 (zod, `loader.ts`)

```typescript
import { z } from 'zod';

export const AgentDefinitionSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9_]+$/).min(1).max(64),
    description: z.string().nullable().optional(),
    systemPromptFile: z.string(),                      // prompts/ 하위 상대 경로 (e.g. "writing_assistant.md")
    tools: z.array(z.string()).nullable().optional(),  // null = 전체 허용, [] = 도구 없음, list = 화이트리스트
    modelPreference: z.string().default('default'),    // fallback chain 이름
    maxToolRounds: z.number().int().min(1).max(100).default(10),
    temperature: z.number().min(0).max(2).nullable().optional(),
  })
  .strict();                                            // extra="forbid" 대응 — 미정의 필드 → ZodError

export type AgentDefinition = Readonly<z.infer<typeof AgentDefinitionSchema>>;
```

- `.strict()` — 오타 필드는 load-time 에 `ZodError` (pydantic `extra="forbid"` 대응)
- `Readonly<>` 로 type-level immutable 표현 (pydantic `frozen=True` 대응). 런타임 freeze 가 필요하면 `Object.freeze()` 적용
- 필드 추가/변경 시 **이 skill + 기존 YAML 전부 동시 업데이트**

### Loader 규약

`<api-app>/src/agents/loader.ts` 가 정본:

- `loadAgent(name: string): Promise<AgentDefinition>` — module-scoped `Map<string, AgentDefinition>` 캐시. 같은 이름 재호출 시 디스크 I/O skip
- `loadAgentPrompt(spec: AgentDefinition): Promise<string>` — prompt 파일 I/O 도 `Map<string, string>` 캐시
- `clearAgentCacheForTests(): void` — 두 캐시 clear (vitest fixture 용)
- **에러 매핑**:
  - YAML 파일 없음 → `ResourceError`
  - YAML 파싱 실패 / schema 불일치 / 이름 패턴 위반 → `ValidationError` (또는 `ZodError` wrap)
- 캐시 무효화는 **프로세스 재시작** 또는 테스트용 reset. hot-reload 는 미지원 (의도된 YAGNI — agent YAML 은 빈번히 바뀌지 않음)

Edge runtime 메모: agent YAML / prompt 파일은 **빌드 타임에 번들** 한다 (edge runtime 은 `fs` 접근 ✕ — runtime-specific, instance 측 project-local skill 참조). 옵션:

- `import yamlText from './<name>.yaml?raw'` + 파싱 (bundler raw import 지원)
- 또는 build step 으로 정적 JSON 으로 변환

### Discover 규약 (UI 전용)

`<api-app>/src/agents/discover.ts` 는 **canonical loader 와 별개**:

- `discoverAgents(): Promise<DiscoveredSpec[]>` — 디렉토리/번들 스캔으로 `{ name, kind, description, modelPreference, tools, sessionEnabled }` 6-필드만 뽑음. `sessionEnabled` 는 RunPolicy-only field — runs (`kind="run"`) 는 YAML 키 또는 default `true`, agents (`kind="agent"`) 는 항상 `null` (ZDR UI 계약 add-on — `/debug/agents` 응답이 이를 surface 해서 프론트엔드가 "Zero Data Retention" 인디케이터 렌더링 가능)
- 용도: `/debug/agents`, `/debug/providers/fallback-chains` 등 UI tree view
- **절대 실행 경로에서 쓰지 말 것** — 스키마 검증을 건너뛰고 malformed YAML 에 `console.warn` 만 찍음
- 실행 시 agent 로드가 필요하면 반드시 `loadAgent()` 경유

### 레지스트리 / 가드레일 (현재 미구현)

- **현재 없음**: `@register("name")` 같은 데코레이터, `AgentRegistry` 싱글턴, `GuardrailProtocol` / 가드레일 체인 모두 **미구현**
- 현재 에이전트는 `loadAgent(name)` 으로 on-demand 로드 + `Map` 캐시가 사실상 레지스트리 역할
- 향후 필요 시 추가 체크리스트는 아래 §미래 확장 참조

### Memory 시스템은 백엔드가 관리하지 않음

중요 분리:

- `.agents/rules/` + `AGENTS.md` 는 **agent CLI** 가 로드 — AI 백엔드 런타임과 무관
- 사용자 대화 맥락 / 세션 이력은 `context-assembly` skill (Stage 1 조립) + `SessionHistoryPort` (storage) 가 담당
- 파일 접근 시점의 nested rule 주입, dual dedup 등은 **agent CLI 의 메모리 시스템**이지 이 백엔드의 기능이 아님

### Memory 3-Tier 금지 (tool-use 원칙)

향후 설계 시 `session / long-term / episodic` 같은 **3-Tier memory** 구조 도입 금지:

- 이유: AI 가 **도구 호출로 직접 메모리 조회/기록** 하는 것이 이 프로젝트의 원칙. 백엔드가 미리 "이건 session memory, 이건 long-term" 으로 분류해두는 구조는 tool-use 중심 설계와 충돌
- 메모리 관련 요구가 생기면 **도구로 노출** (e.g. `memorySearch`, `memoryWrite`) — 백엔드는 저장소만 제공

## 원칙 (source 와 동일, 코드만 TS 화)

### Tool 선택 휴리스틱

```typescript
// coordinator 의 tools 화이트리스트 — 의도된 작음 세트만
const COORDINATOR_TOOLS = ['spawn_agent', 'send_message', 'task_stop'] as const;

// worker 의 tools 화이트리스트 — spawn_agent 반드시 제외
function assertWorkerTools(tools: readonly string[]): void {
  if (tools.includes('spawn_agent')) {
    throw new ValidationError('worker agent cannot include spawn_agent (infinite recursion)');
  }
}
```

### Context budgeting (요약)

- 시스템 prompt = 정적 (cache prefix). 동적 값 삽입 금지
- attachment 수집 = 변경 빈도 낮은 것 앞 (고정 순서)
- 토큰 카운팅: `js-tiktoken` lazy load (cold-start 무게 고려) + 임계치 근접 시만 정밀 계산

### Safety gate 순서

1. agent YAML schema 검증 (`AgentDefinitionSchema.parse`)
2. tool 화이트리스트 검증 (coordinator vs worker)
3. prompt 파일 존재 확인
4. provider fallback chain 존재 확인 (`modelPreference`)

### Fallback 정책

- LLM provider call 실패 → `p-retry` (`tenacity` 대응). 분류:
  - 429 / 5xx / timeout → retry (exponential backoff)
  - 4xx / validation → 즉시 실패
- agent 단위 fallback chain 은 `providers.yaml` 의 named chain 으로 처리 — agent 정의 변경 ✕

## 새 에이전트 추가하기

1. `<api-app>/src/agents/<name>.yaml` 생성
   - `name` 은 `^[a-z0-9_]+$` 패턴 + 파일 stem 과 일치
   - `description` 권장 (UI `/debug/agents` 에 노출됨)
   - `systemPromptFile: "<name>.md"` — prompts/ 하위 경로
2. `<api-app>/src/agents/prompts/<name>.md` 작성
   - Layer 2 agent prompt (`context-assembly` skill §3-Layer)
   - 동적 값 (timestamp, sessionId 등) 삽입 금지 — prompt cache prefix 무효화
3. `tools` 필드 설정
   - **Coordinator 역할**: `spawn_agent`, `send_message`, `task_stop` 만 허용
   - **Worker 역할**: `spawn_agent` **반드시 제외** (무한 재귀 방지 — `sub-agent` skill §Coordinator vs Worker)
   - 미지정 시 전체 도구 허용 (개발/실험용)
4. `modelPreference` 지정 — `providers.yaml` 의 fallback chain 이름
5. 테스트 (vitest): `loadAgent("<name>")` 이 성공하는지 + 해당 에이전트로 `/run/chat` 또는 spawn 경로 실행
6. `/debug/agents` 엔드포인트에서 UI 에 노출되는지 확인 (discover 가 picking up 하는지)

## 미래 확장 (현재 미구현)

구현 시 체크리스트 스케치:

- **Agent Registry**: `loadAgent()` 의 `Map` 캐시를 명시 레지스트리 클래스로 교체. runtime mutate 금지 원칙 (부팅 시에만 등록)
- **가드레일 체인**: `GuardrailProtocol` interface + 블로킹/논블로킹 분리 + fail-open 처리 (가드레일 에러 → pass through + ERROR 로그)
- **Hot-reload**: `POST /agents/reload` 엔드포인트. 진행 중 spawn 은 이전 definition 유지

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `AgentDefinitionSchema` 필드 추가/삭제 | 모든 기존 YAML + `loader.ts` + `discover.ts` + 이 skill 동시 업데이트. `.strict()` 이므로 기존 YAML 에 새 optional 필드 없으면 통과하지만 타입 변경 시 전부 재검증 |
| `name` 정규식 변경 | 기존 에이전트 YAML 의 이름이 매칭 안 되면 load-time `ZodError` |
| `loadAgent` 캐시 정책 변경 | hot-reload 동작 + 테스트 fixture 에서 `clearAgentCacheForTests()` 호출 지점 |
| `discoverAgents` 필드 추가 | `/debug/agents` UI 클라이언트 파서 동시 업데이트 |
| Coordinator 허용 도구 변경 | 기존 coordinator YAML 들의 tools 리스트 재검토 |
| Agent prompt 파일 공백 편집 | 세션 전체 prompt cache 무효화 |

## 금지 사항

- Memory 3-Tier (session/long-term/episodic) 도입 — tool-use 기반 원칙 충돌
- `AgentDefinitionSchema` 를 `.passthrough()` 로 완화 (오타 감지 상실)
- `Readonly<>` 제거 + 런타임 mutate 허용 (레이스 / 캐시 오염 위험)
- `discover.*` 를 실행 경로에서 사용 (스키마 검증 없음 — 반드시 `loadAgent()` 경유)
- Worker agent 의 `tools` 에 `spawn_agent` 포함 (무한 재귀 — `sub-agent` skill §Coordinator vs Worker)
- Agent prompt 에 동적 값 (timestamp / sessionId / turnCount) 삽입 (prompt cache prefix 무효화)
- `.agents/rules/` 의 conditional rule 을 백엔드 런타임이 읽으려 시도 (이건 agent CLI 소관)
- `loader.ts` 캐시 우회한 직접 YAML 파싱 (캐시 일관성 / 검증 우회)
- 레지스트리 / 가드레일 / hot-reload 를 미래 구현하면서 기존 불변식 (Coordinator 도구 제한, Memory 3-Tier 금지) 우회
- `fs.readFile` / `node:fs` 를 edge runtime 코드에서 직접 호출 (edge runtime 호환 ✕ — bundled raw import 또는 KV 사용. runtime-specific, instance 측 project-local skill 참조)
