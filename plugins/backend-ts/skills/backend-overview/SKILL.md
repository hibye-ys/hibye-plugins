---
name: backend-overview
description: TS 백엔드 진입 시 또는 새 모듈 위치 결정 시 invoke. TS 디렉토리 구조와 모듈 의존성 방향, 주요 진입점 (src/routes/, src/ai/providers/, src/sse/) 안내. 새 contributor onboarding, "어디에 무엇이 있는지" 분류 필요 시에도 invoke. framework / runtime 무관.
metadata:
  role: workflow
  scope: project
---

**적용된 §4.4 매트릭스 행**: Python 모듈 트리 → TS 디렉토리 트리, `from app.routes import ...` → `import { app } from './routes/index.ts'`, `backend/` prefix → `src/` prefix, `pydantic BaseModel` → `zod schema / TypeScript interface`, `structlog` → 구조화 로깅 helper (`structured-log-schema` 참조), `os.getenv` → env 어댑터 (framework/runtime 무관)

# backend-overview — TS 백엔드 thin index

> 본 skill = **디렉토리 → 서브시스템 매핑** 만 (어디에 무엇이 있나). invariant 룰은 [[architecture-invariants]] 정본, 상황별 묶음은 [[ts-agent-rules]] 정본 — 세 메타 catalog 의 역할 분리는 [[architecture-invariants]] §"세 메타 catalog 의 역할 분리" 참조.

## 이 skill은 언제 invoke 되는가

- 세션 시작 시 (light load — 본 SKILL.md 만)
- "어디에 무엇이 있는지" 모를 때
- "이 변경이 어느 서브시스템에 속하는지" 분류 필요

## 아키텍처 불변식은 어디에

본 skill 은 **"어디에 뭐가 있는지" 위치 인덱스** 만 담당. 아키텍처 불변식 / 단일 작성자 / StoragePort / 도메인 경계 등 **"왜 이렇게 짰나, 어떻게 지켜야 하나"** 는 `plugins/stack-backend-ts/skills/` 의 invariant SKILL.md 파일들에 있다.

- 계층 / import 방향 / 단일 작성자 → `single-writer` invariant
- SSE lifecycle (12 이벤트) → `sse-lifecycle` invariant
- Provider retry 매트릭스 → `provider-retry-matrix` invariant
- Token budget 상수 → `token-budget-constants` invariant
- Tool 정렬 순서 → `tool-sort-order` invariant
- MCP namespace → `mcp-namespace` invariant
- Compaction threshold → `compaction-thresholds` invariant
- Agent loop 불변식 → `agent-loop-invariants` invariant
- HTTP 에러 sentinel → `http-error-sentinels` invariant
- Run policy 프리셋 → `run-policy-presets` invariant
- Spawn 한계 → `spawn-limits` invariant
- Input safety gate 순서 → `input-safety-gate-ordering` invariant
- App domain boundary → `app-domain-boundary` invariant
- Rate limit 정책 → `rate-limit-policy` invariant
- 구조화 로그 스키마 → `structured-log-schema` invariant
- CORS 정책 → `cors-policy` invariant
- 미디어 job lifecycle → `media-job-lifecycle` invariant
- env / secret 검증 → `config-env-validation` invariant
- AbortSignal 전파 → `cancellation-propagation` invariant

## 디렉토리 구조 (TS 백엔드 표준 레이아웃)

> framework 무관 — 어느 `<framework>` 에서나 동작. runtime 도 무관 (process-based runtime / edge runtime / 컨테이너 호스팅 등). 본 plugin 은 디렉토리 분류와 의존성 방향만 강제하고, framework/runtime 구체 어휘 (`<framework env binding>`, runtime config 파일 등) 는 별도 runtime/framework plugin 에서 다룬다.

### Sub-area 변형 (instance 별 선택 — 화이트리스트 허용)

기본 layout 외에 다음 sub-area 변형은 instance 의 도메인 / 규모 / 모노레포 구성에 따라 *허용*:

| Sub-area | 의미 | 기본 layout 대안 |
|---|---|---|
| `agents/` (top-level) | agent 정의 / prompts 가 자체 디렉토리 (AI agent 백엔드 instance) | `ai/agents/` 중첩 |
| `runs/` (top-level) | `POST /run/<name>` 정의 yaml + system prompt | `routes/runs/` 중첩 |
| `providers/` (top-level) | LLM provider 가 top-level (다른 ai- 모듈과 분리) | `ai/providers/` 중첩 |
| `db/` (top-level) | Drizzle/Kysely schema + migration 이 storage 와 분리 | `storage/db/` 중첩 |

`full-architecture-audit` + `audit-all.sh` 화이트리스트는 기본 + 변형 모두 union 으로 허용. instance 의 CLAUDE.md 에서 어느 변형을 사용하는지 명시 권장 (미사용 변형 디렉토리는 비어 있어야 함).

```
<backend-root>/
  src/
    index.ts              ← app 엔트리 + middleware 등록
    routes/
      index.ts            ← route 집합
      run.ts              ← POST /run/:name — LLM 기반 실행
      sessions.ts         ← 세션 조회/취소
      media.ts            ← 미디어 파이프라인
    ai/
      providers/          ← provider 어댑터 (openrouter.ts, anthropic.ts 등)
      model-resolution.ts ← 4단계 model resolution
    sse/
      stream.ts           ← <framework SSE helper> + serialize 함수
      scrub.ts            ← secret/PII scrub 로직
    tools/
      registry.ts         ← ToolRegistry (Map<string, ToolHandler>)
      base.ts             ← Tool interface + ToolInput + ToolResult
      orchestration.ts    ← dispatch, parallel/sequential partition
    context/
      assemble.ts         ← assembleContext() — Stage 1
      token-budget.ts     ← TokenBudget 상수
    engine/
      loop.ts             ← agent loop 7단계
      compaction.ts       ← 4 전략 (snip/micro/auto/reactive)
      subagent.ts         ← sub-agent spawn
    mcp/
      client.ts           ← MCP session 관리
      bridge.ts           ← MCP tool → ToolRegistry 동적 등록
      config.ts           ← MCPServerConfig + 레지스트리
    middleware/
      auth.ts             ← JWT / API key 검증
      rate-limit.ts       ← 토큰 버킷
      request-id.ts       ← request id ContextVar
    storage/
      session.ts          ← SessionPort 추상화
      writer.ts           ← 단일 작성자 (Single Writer)
    types/
      index.ts            ← 공유 내부 타입 (Message, ContentBlock 등)
    utils/
      ids.ts              ← nanoid / hex id 헬퍼
      env.ts              ← env 어댑터 (framework/runtime 추상)
  <runtime-config>        ← runtime/framework 별도 (runtime config 파일 / Dockerfile / fly.toml 등) — runtime plugin 책임
```

## 계층 단방향 import

```
routes → engine / services → providers / tools / storage
                    ↘              ↗
                      runs/*.ts (RunPolicy)

middleware → routes (외곽)
tools → storage / utils (하향만)
engine → providers / tools / storage
providers → (외부 fetch / SDK)
```

```typescript
// TS import 방향 예
import { app } from './routes/index.ts'
import { assembleContext } from './context/assemble.ts'
import { getProvider } from './ai/providers/index.ts'
import { ToolRegistry } from './tools/registry.ts'
```

## 서브시스템 매핑

| # | 서브시스템 | 경로 | 담당 skill |
|---|---|---|---|
| 01 | Agent Loop | `src/engine/loop.ts`, `src/engine/recovery.ts` | agent-loop |
| 02 | Tool System | `src/tools/` | tool-system |
| 03 | Compaction | `src/engine/compaction.ts` | compaction |
| 04 | Sub-agent Spawn | `src/tools/spawn.ts`, `src/engine/subagent.ts` | sub-agent |
| 05 | Provider Layer | `src/ai/providers/`, `src/ai/model-resolution.ts` | provider-layer |
| 06 | Context Assembly | `src/context/assemble.ts` | context-assembly |
| 07 | SSE Streaming | `src/sse/stream.ts`, `src/routes/run.ts` | sse-streaming |
| 08 | Storage | `src/storage/` | — |
| 09 | MCP Integration | `src/mcp/` | mcp-integration |
| 10 | Routes / API | `src/routes/`, `src/index.ts` | api-routing |
| 11 | Auth / Secrets | `src/middleware/auth.ts` | auth |
| 12 | Error Handling | `src/middleware/error.ts` | error-handling |
| 13 | Debug | 로그 / 디버그 헬퍼 | debug-session |
| 14 | Config / Env | env 어댑터 + runtime config | config-env-validation (local invariant) + runtime plugin (runtime-specific config 파일만) |

## Runtime / framework 특화

본 plugin 은 framework / runtime 무관. 시크릿 접근 방식 (`process.env` vs `<framework env binding>` 등), config 파일 (runtime config 파일 / `Dockerfile` 등), CPU/메모리 한계, streaming 구현 (runtime background task helper 등) 등 *runtime-specific* 사항은 별도 runtime plugin 에 위치한다 (instance 측 project-local skill 참조).

새 backend project 를 부트스트랩 할 때:
1. 본 plugin (`stack-backend-ts`) = 디렉토리/계층/invariant 표준
2. + runtime plugin (process-based runtime / edge runtime / serverless function 등) = 시크릿/config/배포

## 자주 보는 사용 예시

- "어디에 SSE 스트림이 있나" → 위 표 #07 → `sse-streaming` skill
- "단일 작성자 규칙이 뭐였지" → `single-writer` invariant
- "새 route 추가" → `api-routing` skill
- "runtime-specific 이슈 (env undefined / 배포 / runtime config)" → runtime plugin 의 `debug-session` 또는 runtime 별 skill 참고
