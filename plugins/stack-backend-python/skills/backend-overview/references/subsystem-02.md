> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/tool-system-patterns.md` + live implementation under `backend/tools/`.

# Subsystem 02 — Tool System

## 목적 (1줄)

에이전트가 `tool_use`로 호출할 수 있는 도구들의 레지스트리 + 프로토콜 + 병렬
실행 오케스트레이션.

## 파일 / 모듈

- `backend/tools/base.py` — Tool Protocol + ToolResult 타입
- `backend/tools/registry.py` — ToolRegistry (등록/조회/필터/정의 생성)
- `backend/tools/orchestration.py` — 병렬/순차 실행 오케스트레이션
- `backend/tools/{read_file,write_file,edit_file}.py` — 파일 I/O 도구
- `backend/tools/iyaki_query.py` / `iyaki_mutate.py` — iyaki 도메인 도구 (iyaki 도메인 경계)
- `backend/tools/agents.py` — spawn_agent
- `backend/tools/_security.py` — path guard + deny list
- `backend/tools/_iyaki_db.py` — 전용 asyncpg pool (ì¸ë¶ ëë©ì¸ public.*)

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `Tool` (Protocol) | `name`, `description`, `input_schema`, `call(args, context)`, `is_concurrency_safe()` |
| `ToolResult` | `data`, `actions: list[FrontendAction]`, `context_modifier?` |
| `ToolContext` | session_id, user_id, data_reader, data_writer, cache, agent_name, context_hint, spawn_agent, abort_signal |
| `ToolRegistry` | `register()`, `get()`, `definitions()`, `filter(names)` |

## 도구 분류

### 읽기 도구 (병렬 안전)

external domain 읽기: `iyaki_query_entities`, `iyaki_query_blocks` 등
(`backend/tools/iyaki_query.py`). 파일 읽기: `read_file`.

`is_concurrency_safe=True` → `asyncio.gather` 로 동시 실행.

### 쓰기/실행 도구 (순차)

external domain 쓰기: `iyaki_mutate_*` (`backend/tools/iyaki_mutate.py`).
파일 쓰기: `write_file`, `edit_file`. 모두 `is_concurrency_safe=False` → 순차 실행.

## 병렬 실행 오케스트레이션

```
tool_use 블록들 수신
  → 병렬 안전 도구끼리 그룹핑
  → 각 그룹 동시 실행 (asyncio.gather)
  → 비안전 도구는 순차 실행
  → 결과를 messages에 추가
```

**Context modifier**: 도구가 결과와 함께 컨텍스트 변경 함수를 반환할 수 있다.
병렬 실행 시 변경은 큐잉 후 배치 사이에 순차 적용. 예: `create_entity`가 캐시
갱신 → 후속 도구가 새 엔티티 즉시 조회.

## 담당 skill

`tool-system` — 새 Tool 서브클래스 작성 전 반드시 로드.
`new-tool` command로 스캐폴드 가능.

## 범위

- Tool Protocol + Registry + 모든 외부 도메인 도구 (`iyaki_*` prefix)
- 병렬/순차 오케스트레이션
- `read_file` / `write_file` / `edit_file` (샌드박스 + deny list 적용)
- `spawn_agent` (coordinator → worker fork)

## Gotchas

- **is_concurrency_safe 기본값 주의**: 쓰기 도구를 `True`로 두면 동시 쓰기 충돌.
  기본을 `False`로 설정하고 읽기 도구만 명시적으로 `True`.
- **ToolContext는 매 호출 생성**: 세션 간 ToolContext를 공유하면 cache 오염.
- **input_schema는 JSON Schema**: pydantic v2 모델의 `.model_json_schema()`를
  쓰되 LLM용으로 `additionalProperties: false` 추가.

## 관련 AD

- tool-use 기반 (tool_use 기반) — 본 서브시스템의 핵심 전제
- system prompt caching (Bash/File 샌드박싱) — file_edit/write/bash 도구에 적용
