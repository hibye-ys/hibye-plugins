---
name: new-agent
description: Use when creating a new App agent under backend/agents/ — defines the YAML schema (name, description, system_prompt_file, tools, model_preference, coordinator role), the prompt template inheriting base.md, the tool allowlist rule (coordinator = orchestration only, worker = no AgentTool), and the registration + smoke test checklist. Feeds new-agent-builder sub-agent. Load before creating a `.yaml` under `backend/agents/`.
allowed-tools: Read, Write, Edit, Grep, Glob
---

# new-agent — 에이전트 추가 청사진

## 이 skill은 언제 로드되는가

- `backend/agents/<name>.yaml` 최초 생성
- `backend/agents/prompts/<name>.md` 시스템 프롬프트 작성
- `new-agent-builder` sub-agent 호출 시 자동 로드
- 에이전트 로더 스키마 검증

## YAML 스키마 (RFC 수준)

```yaml
# backend/agents/<name>.yaml
name: <snake_case>               # 필수. loader 가 파일명과 대조
description: <one-sentence>      # 필수. 에이전트 선택 UI / 로그에 노출
system_prompt_file: prompts/<name>.md   # 필수. 상대경로
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

## 역할 (Coordinator vs Worker)

| | Coordinator | Worker |
|---|---|---|
| 목적 | 오케스트레이션 | 실제 작업 수행 |
| 허용 도구 | `agent`, `send_message`, `task_stop`, `task_list` 등 orchestration only | 도메인 도구 (search, edit, build 등). **AgentTool 금지** (무한 재귀) |
| sub-agent spawn | Yes | No |
| 모델 | 보통 opus (판단 heavy) | sonnet/haiku (실행) |
| 예시 | `planner`, `dispatcher` | `writer`, `analyst`, `debugger` |

**금지**: worker 가 `agent` / `spawn_*` 도구를 갖는 구성. 무한 재귀 → depth 초과 에러.

## 시스템 프롬프트 템플릿

```markdown
<!-- backend/agents/prompts/<name>.md -->
You are the <agent_name> agent for App.

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
- 다른 agent 의 프롬프트 중복 (base.md 로 공통화)

## 등록 체크리스트

1. `backend/agents/<name>.yaml` 작성 (스키마 준수)
2. `backend/agents/prompts/<name>.md` 작성 (base.md 계승)
3. `config/providers.yaml` 의 `fallback_chains` 에 `model_preference` 값이 존재하는지 확인
4. 모든 도구명이 `ToolRegistry.names()` 에 등록되어 있는지 확인
5. loader boot smoke: `uvicorn backend.main:app --reload` → 로그에서 새 agent 등록 확인
6. 스모크 테스트: `backend/tests/test_agent_<name>.py` 작성
   - mock provider (AsyncMock) 가 간단한 text 반환
   - agent 로드 → 1 턴 실행 → `done` 이벤트 검증
7. `ruff check` + `ty check backend/tests/test_agent_<name>.py` 통과

## 스모크 테스트 스켈레톤

```python
# backend/tests/test_agent_<name>.py
import pytest
from unittest.mock import AsyncMock

from backend.agents.loader import load_agent
from backend.engine.loop import run_agent_loop


@pytest.mark.asyncio
async def test_<name>_smoke():
    agent = load_agent("<name>")
    provider = AsyncMock()
    provider.call_stream.return_value = _mock_text_stream("Hello.")
    events = []
    async for event in run_agent_loop(
        agent_spec=agent,
        user_input="hi",
        history=[],
        provider=provider,
    ):
        events.append(event)
    assert events[-1].type == "done"
```

## 공통 함정

1. **`tools: []` + role: worker** — 아무 것도 못하는 agent. 최소 1개 도구 필요 또는 순수 텍스트 agent 라면 `role: text_only` 표시 (YAGNI — 거의 없음)
2. **YAML `name` ≠ 파일명** — loader 가 파일명 기반으로 등록하는 경우 mismatch 발견 어려움
3. **base.md 없음** — prompt 공통 레이어 부재로 중복 증가. 먼저 base.md 생성
4. **fallback chain 이름 오타** — boot 시 ValidationError. config/providers.yaml 확인

## 검증 체크리스트

- [ ] YAML 스키마 모든 필수 필드 채움
- [ ] role 명시 + 도구 allowlist 가 role 과 일치
- [ ] 프롬프트에 동적 값 없음 (timestamp / turn_count / session_id)
- [ ] base.md 계승 구조 (프롬프트 레이어링)
- [ ] 스모크 테스트 1개 통과
- [ ] loader boot 시 새 agent 등록 로그 확인
- [ ] `ruff check` + `ty check` 통과

## 구현 중 막히면

- 도구 이름이 런타임 에러 → ToolRegistry 등록 순서 확인. `/new-tool` 로 먼저 도구 등록
- 모델 호출 실패 → `config/providers.yaml` 의 provider credentials 확인
- 로더가 agent 못 찾음 → 파일명 = YAML `name` 일치 + 디렉토리 위치 확인
- 프롬프트가 너무 길음 → 8000 토큰 초과 시 `TokenBudget.AGENT` 위반. 축소 또는 base.md 로 이동
