> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/context-assembly-patterns.md` + live implementation at `backend/engine/context.py` + `backend/agents/prompts/`.

# Subsystem 06 — Context Assembly

## 목적 (1줄)

system_prompt와 messages를 3계층(Base + Agent + Context injection)으로 조립하여
LLM 호출 직전의 최종 입력을 만든다.

## 파일 / 모듈

- `backend/engine/context.py` — system prompt 조립 + context_hint 주입
- `backend/agents/prompts/_base.md` — 모든 에이전트 공통 base prompt
- `backend/agents/prompts/{agent}.md` — 에이전트별 프롬프트

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `build_system_prompt(agent, context_hint, memory)` | 3계층 조립 엔트리 |
| `ContextHint` | episode_id, block_id, entity_id, view, selection |
| `load_base_prompt()` | `_base.md` 읽기 (프로세스 캐시 가능) |
| `load_agent_prompt(agent_name)` | `{agent}.md` 읽기 |
| `inject_context(hint, memory)` | 현재 작업/포커스 엔티티/세션 메모리 텍스트화 |

## 3계층 아키텍처

```
[Base Prompt]           ← agents/prompts/_base.md (공통)
  - 역할 정의
  - 세계관 데이터 접근 규칙
  - 출력 형식 (text + action)
  - 도구 사용 가이드라인

[Agent Prompt]          ← agents/prompts/{agent_name}.md
  - 에이전트 고유 지시
  - 톤/스타일
  - 도메인 전문성

[Context Injection]     ← engine/context.py (동적)
  - 현재 작업 회차 정보
  - 포커스 엔티티 정보
  - 현재 뷰 컨텍스트
  - 세션 메모리 요약
  - 프로젝트 요약 (엔티티 수, 회차 수 등)
```

## context_hint 스키마

```python
class ContextHint(BaseModel):
    episode_id: str | None = None
    block_id: str | None = None
    entity_id: str | None = None
    view: str | None = None          # narrative_list, character, ...
    selection: str | None = None     # 선택된 텍스트
```

## 담당 skill

`context-assembly`

## 범위

- 3계층 조립 전체 구현
- Base + Agent prompt 파일 작성
- Context injection은 기본형 (episode/entity 요약)
- 세션 메모리 주입은  (Memory System 이후)

## Gotchas

- **Base + Agent prompt는 static prefix**: 프롬프트 캐시 적중률을 위해 두 부분은
  요청마다 동일해야 한다 (system prompt caching). 동적 값(날짜, 엔티티 요약)은 반드시 Context
  injection 또는 `metadata` 필드에.
- **ContextHint 필드 전부 Optional**: 프론트가 어떤 필드를 전달할지 알 수 없다.
  None 체크 누락 시 NPE.
- **prompts/*.md 파일 누락 → 부팅 실패**: loader는 시작 시점에 모두 로드하고,
  누락된 파일이 있으면 fail-fast로 기동 중단.

## 관련 AD

- system prompt caching (system prompt 캐시 적중률) — 3계층 구조의 핵심 근거
- hybrid agent (Hybrid 에이전트) — prompts/ 디렉토리 구조와 직결
