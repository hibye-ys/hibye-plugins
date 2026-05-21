---
description: Scaffold a new App agent — creates backend/agents/<name>.yaml + backend/agents/prompts/<name>.md + smoke test, then auto-verifies the definition. Counterpart to /new-tool for agents.
argument-hint: <agent-name>
---

Scaffold a new agent named `$ARGUMENTS`.

## Usage

`/new-agent lore_analyzer`
`/new-agent world_builder`

`<agent-name>` MUST be a valid backend agent identifier (`[a-z][a-z0-9_]*`, max 64 chars). Use snake_case, not kebab-case. If invalid, refuse and show the rule.

## Dispatch rule

1. **Validate the name** — must match `^[a-z][a-z0-9_]*$` and max 64 chars. If invalid, refuse with the rule and stop.

2. **Load skills in order**:
   - `new-agent` skill — YAML schema, prompt template, coordinator/worker rules
   - `sub-agent-spawn` skill — coordinator vs worker role decision
   - `agent-verify-def` skill — post-creation verification

3. **Determine the role**:
   - If the user already specified coordinator/worker, use that.
   - If the role is ambiguous, ask whether this is a **coordinator** (orchestrates other agents, uses orchestration tools) or a **worker** (domain tools only, no AgentTool).
   - Do not scaffold until the role is explicit; `role` is required by the runtime agent schema.

4. **Determine `model_preference`**:
   - If the user specified one, use it after checking it exists in `config/providers.yaml`.
   - Otherwise inspect `config/providers.yaml` and use an existing default/general fallback chain if one is clearly present.
   - If no safe default is clear, ask the user. Do not write a placeholder `model_preference`.

5. **Check for collisions** — if `backend/agents/$ARGUMENTS.yaml` already exists, refuse and tell the user to choose another name. Do not overwrite.

6. **Write the agent YAML** to `backend/agents/$ARGUMENTS.yaml`:

```yaml
name: $ARGUMENTS
description: "TODO: 1-2 sentence purpose"
system_prompt_file: prompts/$ARGUMENTS.md
role: $ROLE
tools: []  # TODO: list allowed tools
model_preference: $MODEL_PREFERENCE
max_turns: 10
max_output_tokens: 4096
```

`$ROLE` must be `coordinator` or `worker`. `$MODEL_PREFERENCE` must be a real fallback chain from `config/providers.yaml`.

7. **Write the system prompt** to `backend/agents/prompts/$ARGUMENTS.md`:

```markdown
You are the $ARGUMENTS agent.

## Your role

TODO: describe what this agent does.

## Guidelines

- Follow the project's design principles
- Use only the tools listed in your definition
- Report findings clearly without auto-fixing
```

8. **Write the smoke test** to `backend/tests/test_agent_$ARGUMENTS.py`:

```python
"""Definition smoke test for $ARGUMENTS agent."""
import yaml
from pathlib import Path

def test_agent_yaml_valid():
    path = Path("backend/agents/$ARGUMENTS.yaml")
    assert path.exists(), f"{path} not found"
    data = yaml.safe_load(path.read_text())
    assert "name" in data
    assert "system_prompt_file" in data

def test_prompt_file_exists():
    prompt = Path("backend/agents/prompts/$ARGUMENTS.md")
    assert prompt.exists(), f"{prompt} not found"
    content = prompt.read_text()
    assert len(content) > 50, "prompt too short"
```

9. **Auto-verify** — run `agent-verify-def` skill checks on the new files:
   - YAML 필수 필드 존재 (name, description, system_prompt_file, role, tools, model_preference)
   - prompt 파일 존재
   - prompt 에 동적 값 없음
   - tools 의 도구가 registry 에 존재 (비어있으면 skip)
   - `model_preference` 값이 `config/providers.yaml` fallback chain에 존재

10. **Show the completion checklist** to the user:

> - [ ] `backend/agents/$ARGUMENTS.yaml` — TODO 필드 채우기
> - [ ] `backend/agents/prompts/$ARGUMENTS.md` — 상세 지시사항 작성
> - [ ] `tools:` 리스트에 허용 도구 추가
> - [ ] `model_preference:` 에 `config/providers.yaml` 의 기존 fallback chain 지정
> - [ ] coordinator 라면 `spawn_agent` / `send_message` 도구 포함 확인
> - [ ] worker 라면 `spawn_agent` 도구 **미포함** 확인
> - [ ] `pytest backend/tests/test_agent_$ARGUMENTS.py -v` 통과
> - [ ] 필요 시 `runs/<name>.yaml` 에 run policy 추가

11. **Stop.** 사용자가 TODO 를 채움.

## What this command does NOT do

- 에이전트 비즈니스 로직을 구현하지 않음 — 사용자가 TODO 채움
- agents YAML 의 tools 리스트를 자동 결정하지 않음 — 보안 경계이므로 사용자가 명시
- 기존 에이전트를 수정하지 않음 — 수정은 직접 edit
- run policy (runs/*.yaml) 를 생성하지 않음 — 필요 시 별도 작성

## Scope: backend/agents/ (런타임 에이전트)

이 커맨드는 **`backend/agents/*.yaml` 런타임 에이전트**를 scaffold 합니다.
`.agents/skills/codex-subagents/references/agents/*.md` 하네스 서브에이전트 (provider-manager, test-manager 등)와는 **별개**입니다.

| 대상 | 경로 | 이 커맨드 |
|------|------|----------|
| 런타임 에이전트 (LLM이 실행) | `backend/agents/*.yaml` | **O** — scaffold 대상 |
| 하네스 서브에이전트 (Claude Code가 실행) | `.agents/skills/codex-subagents/references/agents/*.md` | **X** — 직접 편집 |

## Relation to /new-tool

`/new-tool` 이 도구 scaffold 인 것처럼, `/new-agent` 는 에이전트 scaffold. 둘 다 템플릿 생성 + auto-verify + 체크리스트 제시로 끝남.
