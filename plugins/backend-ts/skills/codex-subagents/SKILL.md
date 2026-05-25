---
name: codex-subagents
description: Codex CLI 에서 backend-ts plugin 의 18 named sub-agents 위임 시 invoke. Codex 의 `.codex/agents/<name>.toml` 시스템이 *실재* — 18 agent (architecture_reviewer / provider_manager / security_manager 등) 가 plugins/backend-ts/.codex/agents/ 에 TOML 로 정의되어 있고, /agent CLI + 자연어 위임 ("Spawn agent X to do Y") 으로 호출. 병렬 실행 가능. Do NOT use for backend-ts plugin skill (해당 skill 직접 invoke).
metadata:
  role: workflow
  scope: project
pair_invariant: spawn-limits
---

# codex-subagents — Codex CLI 의 named sub-agent 카탈로그

> **v4 update (2026-05-25)**: 이전 v3 가 *"Codex 에 부재"* 라고 잘못 안내했으나, [`developers.openai.com/codex/subagents`](https://developers.openai.com/codex/subagents) 가 실재 — Codex CLI 는 named sub-agent dispatch 를 정식 지원. 본 plugin 의 18 agent 가 실제 `.codex/agents/` 에 구축되었음.

## 이 skill 은 언제 invoke 되는가

- Codex CLI 에서 "architecture-reviewer 시각으로 봐줘" / "spawn provider_manager to audit fallback chain" 같은 위임
- "이 PR review 를 병렬로 split 해줘" — 다수 sub-agent 동시 실행
- 새 sub-agent 추가 / 기존 agent 의 instructions 수정
- 18 agent catalog 확인

## 핵심 사실 (Codex 공식 spec 직접 인용)

> *"Codex can run subagent workflows by spawning specialized agents in parallel and then collecting their results in one response. This can be particularly helpful for complex tasks that are highly parallel, such as codebase exploration or implementing a multi-step feature plan."*
> — [`developers.openai.com/codex/subagents`](https://developers.openai.com/codex/subagents)

**Discovery paths** (precedence: project > home):
- `<project>/.codex/agents/` (project-scoped)
- `~/.codex/agents/` (personal)

**TOML schema** (necessary fields):

| 필드 | 필수 | 비고 |
|---|---|---|
| `name` | ✅ | snake_case 권장 (Codex examples 모두 underscore). source of truth — 파일명 ≠ name 가능하지만 일치 권장 |
| `description` | ✅ | 한 줄, "when to use" 명시 |
| `developer_instructions` | ✅ | multi-line `"""..."""`, agent 의 핵심 behavior |
| `sandbox_mode` | optional | `"read-only"` 또는 생략 (parent 상속). read-only 면 Write 도구 차단 |
| `model` / `model_reasoning_effort` | optional | 생략 시 parent 상속 |
| `nickname_candidates` | optional | spawn 시 표시 nickname 후보 |
| `mcp_servers` | optional | `[mcp_servers.<name>]` 테이블로 추가 — agent-specific MCP |
| `skills.config` | optional | `[[skills.config]]` 배열, `path` + `enabled` — agent-specific skill subset |

## 본 plugin 의 18 agent catalog

`plugins/backend-ts/.codex/agents/` 에 18 TOML 실재:

| Agent | Modes | Sandbox | Primary paired skills |
|---|---|---|---|
| `architecture_reviewer` | (single) | read-only | [[architecture-invariants]], [[single-writer]], [[backend-overview]] |
| `architecture_validator` | layer / rule-compliance / spec-drift / rule-lint / full | inherit | [[full-architecture-audit]], [[architecture-invariants]], [[rule-linting]] |
| `invariant_compliance_checker` | (single) | read-only | [[architecture-invariants]] + 모든 audit skills |
| `rule_consistency_auditor` | (single) | read-only | [[rule-linting]] |
| `spec_diff_auditor` | (single, per-subsystem) | read-only | [[full-architecture-audit]] + per-subsystem invariant |
| `agent_loop_manager` | loop-audit / debug / compaction | inherit | [[agent-loop]], [[loop-audit]], [[debug-session]], [[compaction]] |
| `api_manager` | run-policy / routing-audit / schema-sync | inherit | [[api-audit]], [[api-routing]], [[run-policy-presets]] |
| `data_state_manager` | data-audit / session / cache | inherit | [[data-audit]], [[data-layer]], [[database]], [[session-audit]], [[app-domain-boundary]], [[media-job-lifecycle]] |
| `infra_performance_manager` | benchmark / concurrency / resource | inherit | [[performance-profiling]] + [[spawn-limits]] |
| `new_agent_builder` | scaffold / verify | write | [[new-agent]], [[agent-verify-def]], [[sub-agent]] |
| `output_stream_manager` | stream-audit / usage | read-only | [[sse-streaming]], [[sse-lifecycle-audit]], [[usage-tracking]] |
| `prompt_context_manager` | validate / audit / analyze | read-only | [[context-assembly]], [[token-budget-constants]] |
| `provider_manager` | scaffold / audit / debug / catalog-sync | write | [[provider-layer]], [[provider-scaffold]], [[provider-retry-audit]], [[provider-catalog-sync]] |
| `security_manager` | quick-check / deep-audit / dependency / runtime | read-only | [[security-audit-check]], [[security-runtime]], [[dependency-scanning]] |
| `settings_hooks_maintainer` | (single — harness 관리) | write | (Codex / Claude Code settings.json — backend-ts 코드와 별개) |
| `sub_agent_manager` | spawn-audit / topology | read-only | [[sub-agent]], [[spawn-limits-audit]], [[spawn-limits]] |
| `test_manager` | review / cleanup / scaffold / verify | write | [[testing-infra]], [[test-cleanup]], [[test-scaffold]], [[red-green-fix]] |
| `tools_manager` | tool-audit / mcp-audit / media-audit | read-only | [[tool-system]], [[tool-sort-order-audit]], [[mcp-namespace-audit]], [[media-pipeline-patterns]] |

## 사용법

### 명시 위임 (spawn)

자연어로 agent 이름 호출 — Codex 가 자동 spawn:

```text
사용자: "Spawn architecture_reviewer to audit the recent storage refactor"
Codex:  (architecture_reviewer 의 TOML developer_instructions 로드 → spawn → 결과 수집)
```

### 병렬 실행

```text
사용자: "Run security_manager (quick-check), test_manager (review),
        and provider_manager (audit) in parallel for the pre-merge gate"
Codex:  (3 agent 병렬 spawn → 각자 결과 → 통합 보고)
```

### /agent CLI

`/agent` — 활성 agent thread 간 전환 + 진행 상황 확인.

### sandbox_mode 의미

- `read-only` 명시된 agent (architecture_reviewer 등) — 절대 Write/Edit/Bash 의 mutation 사용 ✕
- 생략 (parent 상속) — parent session 의 sandbox 따라감

## 새 sub-agent 추가 절차

1. **TOML 작성**: `plugins/backend-ts/.codex/agents/<snake_case_name>.toml`
   - 필수 3 필드 (name / description / developer_instructions)
   - sandbox_mode 결정 (auditor 류 → `"read-only"`)
   - paired backend-ts skill 들을 developer_instructions 의 §Required reading 에 wiki-style cite (`[[` 와 `]]` 로 감싼 실제 skill name — 예: `[[architecture-invariants]]`, `[[agent-loop-invariants]]`) 으로 명시
2. **검증**:
   - TOML parse 가능 확인 (수동 또는 toml validator)
   - 모든 wiki-style cite 가 `plugins/backend-ts/skills/<해당 name>/` 에 실재 (broken cite ✕)
   - description ≤ 1024 chars (agentskills.io spec)
3. **본 SKILL.md catalog 표에 1행 추가**
4. **smoke test**: Codex 안에서 `/agent` 또는 자연어로 1회 spawn → 결과 검증

## 자주 보는 함정

- **kebab-case 이름**: Codex examples 는 모두 `snake_case` (`pr_explorer`, `reviewer`). `name = "architecture-reviewer"` 도 작동할 수 있으나 spec 미공개 — *snake_case 안전*.
- **`name` ≠ 파일명**: Codex docs *"Matching the filename to the agent name is the simplest convention, but the `name` field is the source of truth"*. 단 일치 권장 — drift 시 자기-혼동.
- **prompt 안 동적 값**: agent의 `developer_instructions` 는 정적 텍스트만 — Date.now / sessionId / turnCount 삽입 시 prompt cache prefix 무효화.
- **`mcp_servers` per-agent 정의**: parent session 의 MCP 와 *별개*. agent 본인이 직접 호출하는 MCP 만 명시. parent 의 MCP 도 쓰려면 옴기지 말고 inherit (생략).
- **`skills.config` path**: Codex examples 는 *absolute path* (`/Users/me/.agents/skills/...`). plugin portability 위해 본 plugin 은 `skills.config` 생략 — parent session 의 skills 그대로 상속. agent 별 subset 강제 필요 시만 추가.
- **infinite recursion**: `developer_instructions` 안에서 다시 `spawn architecture_reviewer` 같이 자기 자신 spawn → spawn depth 폭증. [[spawn-limits]] 의 `MAX_SPAWN_DEPTH=3` 준수.

## 향후 변경 감지

- [`developers.openai.com/codex/subagents`](https://developers.openai.com/codex/subagents) 의 TOML field 표 변경
- 새 *required* 필드 추가 시 본 plugin 의 18 TOML 모두 갱신 의무
- `skills.config` schema 의 공식 명시 (현재 examples 만 있고 spec 미공개)
- Codex 의 `/agent` CLI 서브커맨드 enumeration 공식 발행

## audit + 확장 cite

- [[spawn-limits]] — sub-agent spawn 의 invariant (MAX_SPAWN_DEPTH, CacheSafeParams)
- [[sub-agent]] — sub-agent workflow + 3 execution modes
- [[codex-commands]] — Codex 의 slash commands 모델 (commands 는 plugin component ✕ 와 대비)
