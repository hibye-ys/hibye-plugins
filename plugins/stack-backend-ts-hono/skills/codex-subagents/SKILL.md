---
name: codex-subagents
description: Codex 환경에서 stack-backend-ts-hono plugin 의 subagent 정의/호출 시 invoke. `.codex-plugin/agents/` 카탈로그 + Claude Code 의 Agent tool contract 호환. Codex 가 named agent 를 직접 로드하지 못해 reference md 로 mirror.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/skills/codex-subagents
---

**적용된 §4.4 매트릭스 행**: Python sub-agent class → TS handler function (marker md frontmatter 동일 구조), `asyncio.create_task` → `Promise` + `AbortController`, `pytest` smoke → `vitest`, `print/logger.info` → `console.log(JSON.stringify(...))`, env access `os.environ` → `process.env`

# codex-subagents — Codex sub-agent adapter

> 본 skill = Codex 환경에서 stack-backend-ts-hono plugin 의 sub-agent catalog adapter. Codex 는 Claude Code 의 named agent 를 자동 로드하지 못하므로, agent prompt 를 `references/agents/<agent-name>.md` 에 저장하고 dispatch 시 읽어들인다.

## 이 skill 은 언제 invoke 되는가

- 사용자가 Codex 에 "이 sub-agent 써", "delegate to X" 요청
- Codex 안에서 manager / auditor / validator 호출 (예: `architecture-reviewer`, `provider-manager` 등)
- 새 sub-agent 정의 추가 (Codex + Claude Code 양쪽)
- "Claude 측 agent 를 Codex 에서 동일하게 부르려면?" 질문

## Dispatch 절차

1. 요청에서 agent 이름 / manager 영역 식별
2. `references/agents/<agent-name>.md` 읽기 (Codex 측 mirror — Claude Code 의 `.claude/agents/<agent-name>.md` 와 동등)
3. reference 안에서 named skill 들 (의존 skill) 을 먼저 로드 후 작업 시작
4. **사용자가 명시적으로 delegation / sub-agent / parallel agent work 를 요청한 경우만** Codex `spawn_agent` 사용 — 그 외에는 reference 본문 따라 local emulation
5. reference 의 read-only / write scope 준수 — auditor 류는 read-only 고정

## Agent Catalog

| Agent | Scope |
|---|---|
| `agent-loop-manager` | loop audit / debug / compaction 건강도 |
| `api-manager` | routes / RunPolicy / schema 동기화 |
| `architecture-reviewer` | layer / import direction / single-writer 점검 |
| `architecture-validator` | 최상위 architecture 조정 |
| `data-state-manager` | data / state / DB / app domain boundary |
| `infra-performance-manager` | benchmark / concurrency / 리소스 |
| `invariant-compliance-checker` | cross-rule invariant 준수 |
| `new-agent-builder` | runtime agent scaffold + verify |
| `output-stream-manager` | SSE / output 이벤트 / usage tracking |
| `prompt-context-manager` | context assembly / token budget / cache stability |
| `provider-manager` | providers / fallback / model catalog / provider debug |
| `rule-consistency-auditor` | rule 파일 구조 무결성 |
| `security-manager` | security / dependency audit |
| `settings-hooks-maintainer` | runtime settings / hook 설정 |
| `spec-diff-auditor` | one-subsystem rule-to-code drift |
| `sub-agent-manager` | backend sub-agent spawn 건강도 |
| `test-manager` | test review / cleanup / scaffold / verify |
| `tools-manager` | tools / MCP / 미디어 pipeline audit |

## reference 사용

특정 agent reference 만 읽기:

```bash
sed -n '1,240p' .codex-plugin/agents/<agent-name>.md
```

전체 카탈로그:

```bash
ls .codex-plugin/agents/
```

## sub-agent 정의 구조 (marker md)

Codex agent 정의 = marker md 한 파일 (frontmatter + 본문). Python / TS 동일 구조 — runtime 만 다름.

```markdown
---
name: architecture-reviewer
description: backend 계층 import direction / single-writer 검토. read-only.
scope: read-only
depends_on:
  - architecture-invariants
  - app-domain-boundary
  - single-writer
allowed-tools: Read, Grep, Glob, Bash
---

# architecture-reviewer

## Role
<1-2 sentences — agent 가 어떤 작업을 위임받는지>

## Available capabilities
<key tools / skills 의존 목록>

## Constraints
- <constraint 1: 항상 사용자 승인 후 destructive action>
- <constraint 2>

## Output format
<expected response shape — markdown report / JSON / streaming>
```

## Codex spawn 시 contract

명시 위임 시 `spawn_agent` 호출:

```typescript
// scripts/_codex-spawn.ts (Codex CLI host 측)
import { spawnAgent } from '@codex/cli-host'

await spawnAgent({
  agentName: 'architecture-reviewer',
  prompt: referenceMd,   // .codex-plugin/agents/architecture-reviewer.md 본문
  userTask: '<사용자 요청 텍스트>',
  notes: [
    '.claude/ 는 Claude Code mirror — read-only',
    '.agents/ 는 Codex-facing shared source',
  ],
})
```

spawn 후 결과는 부모 (현재 Codex 세션) 로 돌아오며, agent 의 출력은 그대로 사용자에게 표시.

## emulation vs spawn 판단

| 사용자 요청 | 처리 |
|---|---|
| "architecture-reviewer 로 봐줘" | spawn (명시 위임) |
| "이 코드 layer 점검해줘" | local emulation (reference 본문 따라 직접 grep / 보고) |
| "다른 agent 한테 넘겨서 병렬로" | spawn |
| "이 reference 본문 보여줘" | reference 만 read |

## 신규 sub-agent 추가 절차

1. `.codex-plugin/agents/<name>.md` marker 작성 (frontmatter + Role/Capabilities/Constraints/Output)
2. `.claude/agents/<name>.md` 동일 frontmatter + 본문 미러 (Claude Code 측)
3. `depends_on:` 에 본 plugin 의 skill 명시 — Codex dispatch 가 자동 로드
4. 본 SKILL.md Agent Catalog 표에 1행 추가
5. `allowed-tools` 화이트리스트 — auditor 류는 Read/Grep/Glob/Bash 만, manager 류는 Write 포함
6. smoke: Codex 안에서 명시 위임 1회 + reference local read 1회 → 출력 검증

## 자주 보는 함정

- **Claude `.claude/agents/` 와 Codex `.codex-plugin/agents/` drift** — frontmatter 가 미러 안 됨. 양쪽 동시 갱신 의무
- **`scope:` 누락** — read-only / write 미정 → auditor 가 silent edit. 모든 marker 에 명시 강제
- **무한 재귀** — sub-agent 가 또 sub-agent spawn. `depends_on:` 만으로 표현 ✕ — agent 내부에서 `spawn_agent` 호출 시 `spawn-limits` invariant (MAX_SPAWN_DEPTH=3) 준수
- **`depends_on:` 의 skill 미존재** — Codex 가 silent skip → agent 가 컨텍스트 누락된 채 실행. dispatch 전 의존 skill 존재 검증
- **prompt 에 동적 값 포함** (timestamp / session id 등) → prompt cache miss. agent reference 는 정적 텍스트만

## 검증 체크리스트

- [ ] 본 SKILL.md Agent Catalog 의 모든 행에 대응 `.codex-plugin/agents/<name>.md` 존재
- [ ] Claude Code `.claude/agents/<name>.md` 도 동일 frontmatter (mirror drift ✕)
- [ ] 모든 marker 에 `scope:` 명시 (read-only / write)
- [ ] `depends_on:` 의 모든 skill 이 `plugins/stack-backend-ts-hono/skills/` 안에 실재
- [ ] auditor 류 marker 의 `allowed-tools:` 에 Write/Edit 없음 (read-only 강제)
- [ ] spawn 시 부모 sub-agent depth + 1 ≤ MAX_SPAWN_DEPTH (spawn-limits invariant)

## 구현 중 막히면

- Codex 가 agent reference 못 찾음 → `.codex-plugin/agents/` 디렉토리 plugin root 기준 경로 확인
- spawn 호출 실패 → `@codex/cli-host` 패키지 / API 가용성 확인. dev 모드면 local emulation 으로 폴백
- agent 가 의존 skill 누락된 채 실행 → marker `depends_on:` 누락. 본 SKILL.md Catalog 와 비교
- Claude 측은 동작하는데 Codex 에서 결과 다름 → Claude `.claude/agents/<name>.md` 의 본문 (Role/Constraints) 과 Codex 측 reference 비교 — 본문 drift 가 흔한 원인
