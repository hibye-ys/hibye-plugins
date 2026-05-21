> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/ai-agent-patterns.md` + live implementation at `backend/agents/loader.py` + `discover.py`.

# Subsystem 12 — Agents (config)

## 목적 (1줄)

App 에이전트 정의 + 로더. YAML 선언형 + Python 코드 하이브리드 (hybrid agent).

## 파일 / 모듈

- `backend/agents/loader.py` — YAML + custom/ 디렉토리 스캔 로더
- `backend/agents/base.py` — Agent 프로토콜 + YAML 런타임
- `backend/agents/{name}.yaml` — 선언형 에이전트 파일들
- `backend/agents/custom/{name}.py` — 코드 에이전트
- `backend/agents/prompts/{name}.md` — 각 에이전트의 system prompt

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `AgentDefinition` | name, description, system_prompt_file, tools, model_preference, max_tool_rounds, temperature |
| `Agent` (Protocol) | `pre_process()`, `should_continue()`, `post_process()` (optional hooks) |
| `YamlAgent(AgentDefinition)` | YAML로부터 Agent Protocol 구현 |
| `load_agents(root)` | YAML + custom 디렉토리 스캔 |
| `reload_agents()` | 핫 리로드 (`POST /ai/agents/reload`) |

## 에이전트 카탈로그 (초기 1개)

| 에이전트 | 역할 | 레벨 | 주요 도구 |
|---|---|---|---|
| `chat_assistant` | 범용 대화, 질문/답변, 세계관 Q&A | L2 | 전체 읽기 도구 |

 추가:
- `writing_assistant` (L3) — prose 생성
- `block_analyzer` (L1) — 블록 분할/태깅
- `entity_linker` (L1) — 엔티티 자동 인식
- `world_validator` (L1/L2) — 일관성 검증

## YAML 예시

```yaml
# agents/chat_assistant.yaml
name: chat_assistant
description: "범용 대화, 질문/답변, 세계관 Q&A"
system_prompt_file: prompts/chat_assistant.md
tools:
  - get_entity
  - get_episode_blocks
  - get_entity_relations
  - search_entities
model_preference:
  - anthropic/claude-sonnet-4-5
  - anthropic/claude-haiku-4-5
max_tool_rounds: 10
temperature: 0.6
```

## 담당 skill

없음 (로더 자체는 단순). 에이전트 프롬프트 수정 시 `context-assembly` 참고.

## 범위

- Loader + YAML 런타임 동작
- `chat_assistant.yaml` + 해당 prompt 파일 1개
- 코드 에이전트 구조는 있으나 실제 사용 

## Gotchas

- **tool 이름 오타**: YAML `tools:` 목록의 이름이 registry에 없으면 부팅 실패.
  로더가 validate해야 한다.
- **system_prompt_file 경로**: YAML 기준 상대 경로. 절대 경로 금지.
- **hot reload 중 요청 충돌**: reload 중 진행 중 요청이 있으면 기존 정의로
  계속 실행. 다음 요청부터 새 정의.

## 관련 AD

- hybrid agent (Hybrid 에이전트 구성) — 본 서브시스템의 설계 원칙
