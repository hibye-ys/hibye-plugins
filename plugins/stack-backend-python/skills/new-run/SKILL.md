---
name: new-run
description: Use when creating a new named run endpoint in the App AI backend. Scaffolds backend/runs name YAML and prompt markdown files with one of 4 RunPolicy presets (interactive/classifier/tool-based/multi-agent). Enforces name pattern, full-form field names, and cross-field validation. Counterpart to new-agent, which scaffolds backend/agents rather than backend/runs.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# new-run — `/run/<name>` 엔드포인트 스캐폴드

## 이 skill은 언제 로드되는가

- `/new-run <name>` command 실행
- 사용자가 "새 run endpoint", "/run/<name>" 추가 언급
- `backend/runs/*.yaml` 파일 생성/복제 필요

## 경계 (vs /new-agent vs /new-tool)

| Skill | 대상 경로 | 생성 결과 | 라우트 |
|-------|---------|---------|-------|
| `/new-tool` | `backend/tools/<name>.py` | Tool Protocol 구현체 + 테스트 | N/A (ToolRegistry) |
| `/new-agent` | `backend/agents/<name>.yaml` + prompts | AgentDefinition + prompt | N/A (agent registry, spawn 대상) |
| **`/new-run` (this)** | `backend/runs/<name>.yaml` + prompts | RunPolicy + prompt | `POST /run/<name>` 자동 dispatch |

## RunPolicy 정본 (`backend/engine/policy.py:30-48`)

```python
class RunPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(pattern=r"^[a-z0-9_]+$", min_length=1, max_length=64)
    description: str | None = None
    system_prompt_file: str
    model_preference: str = "default"
    allowed_tools: list[str] | None = None
    max_turns: int = Field(default=50, ge=1)
    compaction_enabled: bool = True
    spawn_enabled: bool = False
    max_spawn_depth: int = Field(default=0, ge=0)
    response_schema: str | None = None
    sse: bool = True
    session_enabled: bool = True
    required_scope: str | None = None
```

- **`extra="forbid"`** — 오타 필드는 startup 에 pydantic `ValidationError` → 서버 부팅 실패
- **`frozen=True`** — 인스턴스 mutate 차단 (startup 후 변경 불가)
- **name pattern**: underscore 만 허용 (`chat_test` ✅ / `chat-test` ❌)

## 4 Presets

### 1. `interactive` (default) — 대화형, **conservative**

**중요**: `allowed_tools` 는 `backend/tools/` 에 실제 등록된 **개별 이름** 만 써야 함. pydantic + `run-policy.md` invariant 가 startup 에 fail-fast. 2026-04 기준 정본 (`backend/tools/__init__.py::register_builtin_tools` + 각 `.py` 의 `name="..."` attribute):

- **baseline**: `read_file`, `write_file`, `edit_file`, `spawn_agent`
- **ì¸ë¶ ëë©ì¸ query (6)**: `<domain>_query_character`, `<domain>_query_world_item`, `<domain>_query_note`, `<domain>_query_timeline_entry`, `<domain>_query_block`, `<domain>_query_episode`
- **ì¸ë¶ ëë©ì¸ mutate (20+ 개별 액션)**: `<domain>_edit_block_prose`, `<domain>_create_entity`, `<domain>_update_entity`, `<domain>_create_category`, `<domain>_update_category`, `<domain>_create_section`, `<domain>_rename_section`, `<domain>_move_episode_to_section`, `<domain>_create_group`, `<domain>_update_group`, `<domain>_add_graph_edge`, `<domain>_update_graph_edge`, `<domain>_create_area_label`, `<domain>_update_area_label`, `<domain>_delete_area_label`, `<domain>_create_era`, `<domain>_update_era`, `<domain>_create_timeline_entry`, `<domain>_update_timeline_entry`, `<domain>_create_wb_category`, `<domain>_update_wb_category`, `<domain>_create_wb_item`, `<domain>_update_wb_item`, `<domain>_delete_note`, ...

**aggregate 이름 (`<domain>_query`, `<domain>_mutate`, `search_files`, `glob_files`) 은 실존하지 않으니 금지.** 파일명과 tool name 이 다르므로 항상 `backend/tools/*.py` 의 `name="..."` 을 직접 확인.

```yaml
name: <name>
description: "TODO: describe what this run does"
system_prompt_file: "<name>.md"
model_preference: "default"

# Conservative tool scope — registered tool names only.
# TODO: 실제 요구에 맞게 backend/tools/ 등록 이름 중 선택 후 추가
allowed_tools:
  - read_file

max_turns: 100
compaction_enabled: true
spawn_enabled: false     # 대화형은 spawn 비활성 default (multi-agent preset 별도)
max_spawn_depth: 0
sse: true
session_enabled: true
```

**근거**: 대화형은 장시간 + compaction 필요. 하지만 spawn 은 명시적 요구시에만 — 무한 재귀 리스크 + 권한 확장 최소화 원칙 (design-principles §1 safe defaults). 허용 도구도 최소 (`read_file`) — 사용자가 확장 시점에 등록 이름 확인 + TODO 주석으로 유도.

### 2. `classifier` — 단발 분류, JSON 응답

```yaml
name: <name>
description: "TODO: describe classification task"
system_prompt_file: "<name>.md"
model_preference: "default"
allowed_tools: []           # 도구 없음 — 순수 LLM 분류
max_turns: 1
compaction_enabled: false
response_schema: "<TODO: pydantic model name>"  # e.g. "ClassificationResult"
sse: false                  # response_schema 필수 조건
session_enabled: false
```

**근거**: 1턴, 도구 없음, 고정 JSON → compaction 불필요, SSE 불필요, 세션 불필요.

### 3. `tool-based` — 제한 도구 + 구조화 출력

```yaml
name: <name>
description: "TODO: describe task"
system_prompt_file: "<name>.md"
model_preference: "default"
# TODO: backend/tools/ 등록 개별 이름만 (aggregate 이름 `<domain>_query` / `<domain>_mutate` 는 실제 존재하지 않음)
# 예시: read_file, edit_file, write_file, <domain>_query_character, <domain>_query_block,
#       <domain>_edit_block_prose, <domain>_create_note (실제 등록 리스트는 backend/tools/<domain>/__init__.py 참조)
allowed_tools:
  - read_file
max_turns: 5                # 과도한 turn 방지
compaction_enabled: false
response_schema: "<TODO: pydantic model name>"
sse: false
session_enabled: false
```

**근거**: 도구 호출 몇 번으로 완결되는 작업 (검색/조회 → 판단). `max_turns=5` 로 비용 상한.

### 4. `multi-agent` — coordinator + spawn

```yaml
name: <name>
description: "TODO: describe coordinator role"
system_prompt_file: "<name>.md"
model_preference: "default"
allowed_tools:
  - read_file
  - spawn_agent            # ← spawn_enabled=true 와 정합 필수
max_turns: 20
compaction_enabled: true
spawn_enabled: true
max_spawn_depth: 2         # global cap=3 (GLOBAL_MAX_SPAWN_DEPTH)
sse: true
session_enabled: true
```

**근거**: spawn 은 명시 활성화가 필요한 선택사항. `max_spawn_depth=2` 는 보수적 (3 은 global cap, 초과 금지).

## Cross-Field Validation

`RunPolicy.@model_validator(mode="after")` 가 startup 시 검사:

1. `spawn_enabled=true` + `allowed_tools` 가 None 이 아닌데 `spawn_agent` 미포함 → **reject**
2. `spawn_enabled=true` + `max_spawn_depth < 1` → **reject** (모순)
3. `max_spawn_depth > GLOBAL_MAX_SPAWN_DEPTH (=3)` → **reject**
4. `compaction_enabled=false` + `max_turns > 10` → WARNING only (PTL 리스크)
5. `sse=true` + `response_schema` 설정 → request-time 422 (startup 에선 통과, 실행 시 reject)

## 스캐폴드 절차 (skill 실행 단계)

1. **Parse args**: `$ARGUMENTS` 에서 `name` + optional `preset`
2. **Validate name**: `^[a-z0-9_]+$` + 길이 1~64. 실패 시 "use underscore, not hyphen" 가이드
3. **Check duplicate**: `backend/runs/<name>.yaml` 존재 시 abort
4. **Ensure dirs**: `backend/runs/` + `backend/runs/prompts/` 없으면 생성 (mkdir -p)
5. **Write YAML**: 선택된 preset 템플릿 → `backend/runs/<name>.yaml`
6. **Write prompt**: 아래 템플릿 → `backend/runs/prompts/<name>.md`
7. **Smoke**:
   - `uv run uvicorn backend.main:app --port 8001 &` + `sleep 5`
   - `curl -fs http://localhost:8001/health` — boot 확인
   - `curl -fs http://localhost:8001/runs | jq` — `/runs` 에 새 이름 등장 확인
   - `kill` + trap cleanup
8. **Report**: 생성 경로 + 다음 단계 안내

## Prompt 템플릿 (`backend/runs/prompts/<name>.md`)

```markdown
# <name> system prompt

<TODO: describe the agent's role, personality, and task boundaries here>

## 역할
...

## 금지
- 시크릿 / API key / 개인정보 노출
- ...

## 출력 형식
<사용자 지정 스키마 또는 자연어 설명>
```

**Static system prompt 원칙** (context-assembly-patterns.md):
- 동적 값 (timestamp, session_id, random) 삽입 금지 — prompt cache prefix 무효화
- `{변수}` placeholder 가 runtime 에 치환되는 것도 금지 — Layer 2 동적 영역은 API messages 경로로

## 완료 후 사용자 가이드

```
✓ Scaffolded: backend/runs/<name>.yaml
✓ Scaffolded: backend/runs/prompts/<name>.md
✓ Smoke PASS: /runs includes "<name>"

다음 단계:
  1. `backend/runs/prompts/<name>.md` 의 TODO 채우기
  2. response_schema 를 사용했다면:
     - pydantic 모델을 `backend/routes/schemas.py` 에 선언 (또는 `backend/engine/types.py`)
     - `backend/routes/schemas.py::register_response_schemas()` 에
       `register_response_schema("<Name>", <PydanticModel>)` 호출 추가
       (정본: `backend/engine/schemas.py::register_response_schema`)
     - `main.py` lifespan 이 부팅 시 `register_response_schemas()` 호출하므로
       `response_schema: <Name>` 이 load-time 에 resolve 됨
  3. `allowed_tools` 재검토 — 실 수요에 맞게 좁히기
  4. 테스트 추가:
     backend/tests/test_run_<name>.py
  5. 실제 호출:
     curl -N -X POST http://localhost:8001/run/<name> \
       -H 'Content-Type: application/json' \
       -d '{"message":"hello"}'
  6. Hot reload (선택):
     POST /runs/reload  (runs:admin scope 필요)
```

## Non-Goals

- 자동으로 `POST /runs/reload` 호출 안 함 — scope 필요
- pydantic 모델 자동 생성 안 함 — 사용자가 `response_schema` 필드에 이름만 지정
- 기존 파일 덮어쓰기 금지 — 실수로 삭제 방지
- 테스트 파일 자동 생성 안 함 — `backend/tests/` 는 사용자가 별도 추가
- `backend/main.py` 수정 안 함 — 라우트는 RunRegistry 자동 dispatch

## 절대 금지

- hyphen 포함 이름 (`chat-test`, `my-run`) 통과 — 반드시 underscore (`chat_test`)
- full form 아닌 필드명 (`compaction`, `spawn`, `session`) 스캐폴드 — pydantic `extra="forbid"` 가 startup 에 reject
- `max_spawn_depth > 3` 스캐폴드 — GLOBAL_MAX_SPAWN_DEPTH 초과
- `sse=true` + `response_schema` 조합 스캐폴드 — 상호배타
- 대화형 preset 에 `spawn_enabled=true` default — multi-agent preset 과 분리 유지
- Prompt 에 동적 값 삽입 — prompt cache 무효화
