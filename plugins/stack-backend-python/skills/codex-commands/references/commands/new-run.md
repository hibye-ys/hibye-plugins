---
description: Scaffold a new `/run/<name>` endpoint. Creates backend/runs/<name>.yaml + backend/runs/prompts/<name>.md with one of 4 RunPolicy presets (interactive / classifier / tool-based / multi-agent). Enforces name pattern ^[a-z0-9_]+$ and RunPolicy full-form field names.
argument-hint: <name> [preset=interactive|classifier|tool-based|multi-agent]
---

Scaffold a new `/run/<name>` endpoint for the App AI backend.

## Usage

`/new-run chat_test`                        — defaults to interactive preset
`/new-run summarize classifier`             — classifier preset (single-shot, response_schema)
`/new-run research tool-based`              — tool-based preset (explicit allowed_tools)
`/new-run coordinator multi-agent`          — multi-agent preset (spawn_enabled=true)

## Dispatch rule

1. **Load `new-run` skill** — `.agents/skills/new-run/SKILL.md` defines the
   4 presets, field validation rules, and smoke test workflow.

2. **Validate name** (`backend/engine/policy.py:32` pattern):
   - Must match `^[a-z0-9_]+$` (lowercase letters, digits, underscore only)
   - Length 1~64
   - **Hyphens are forbidden** — reject `chat-test`, accept `chat_test`

3. **Refuse if name already exists**:
```bash
if [ -f "backend/runs/${NAME}.yaml" ]; then
    echo "ERROR: backend/runs/${NAME}.yaml already exists"
    exit 1
fi
```

4. **Scaffold 2 files** (see skill for preset templates):
   - `backend/runs/<name>.yaml` — RunPolicy instance
   - `backend/runs/prompts/<name>.md` — system prompt (empty template with TODO)

**중요 — `allowed_tools` 는 `backend/tools/` 에 실제 등록된 도구 이름만 허용** (pydantic `extra="forbid"` + `run-policy.md` invariant 로 startup fail-fast).

2026-04 기준 등록 이름 (정본은 `backend/tools/__init__.py::register_builtin_tools` + 각 `.py` 의 `name="..."` attribute):

- **baseline**: `read_file`, `write_file`, `edit_file`, `spawn_agent`
- **iyaki query (6종)**: `iyaki_query_character`, `iyaki_query_world_item`, `iyaki_query_note`, `iyaki_query_timeline_entry`, `iyaki_query_block`, `iyaki_query_episode`
- **iyaki mutate (개별 액션 20+ 종)**: `iyaki_edit_block_prose`, `iyaki_create_entity`, `iyaki_update_entity`, `iyaki_create_category`, `iyaki_update_category`, `iyaki_create_section`, `iyaki_rename_section`, `iyaki_move_episode_to_section`, `iyaki_create_group`, `iyaki_update_group`, `iyaki_add_graph_edge`, `iyaki_update_graph_edge`, `iyaki_create_area_label`, `iyaki_update_area_label`, `iyaki_delete_area_label`, `iyaki_create_era`, `iyaki_update_era`, `iyaki_create_timeline_entry`, `iyaki_update_timeline_entry`, `iyaki_create_wb_category`, `iyaki_update_wb_category`, `iyaki_create_wb_item`, `iyaki_update_wb_item`, `iyaki_delete_note`, ...

**절대 금지 — aggregate 이름 사용**: `iyaki_query`, `iyaki_mutate`, `search_files`, `glob_files` 는 **존재하지 않는 이름**. 사용 시 startup fail-fast. 항상 `backend/tools/` 의 실제 `name="..."` 을 확인하고 개별 이름으로 선언.

5. **Preset = interactive (default)** — conservative chat defaults:
```yaml
name: <name>
description: "TODO: describe what this run does"
system_prompt_file: "<name>.md"
model_preference: "default"
# Conservative — 최소 도구만.
# TODO: backend/tools/ 에 등록된 도구 중 필요한 것만 추가
allowed_tools: [read_file]
max_turns: 100
compaction_enabled: true
spawn_enabled: false
max_spawn_depth: 0
sse: true
session_enabled: true
```

6. **Preset = classifier** — single-shot JSON output:
```yaml
name: <name>
description: "TODO: describe classification task"
system_prompt_file: "<name>.md"
model_preference: "default"
allowed_tools: []
max_turns: 1
compaction_enabled: false
response_schema: "<TODO: pydantic model name in backend/engine/types.py or routes/schemas.py>"
sse: false  # response_schema requires sse=false (mutually exclusive)
session_enabled: false
```

7. **Preset = tool-based** — bounded tool use with structured output:
```yaml
name: <name>
description: "TODO: describe task"
system_prompt_file: "<name>.md"
model_preference: "default"
# TODO: backend/tools/ 개별 등록 이름 중 선택 (예: read_file, edit_file, iyaki_query_character, iyaki_edit_block_prose)
allowed_tools: [read_file]
max_turns: 5
compaction_enabled: false
response_schema: "<TODO: pydantic model name>"
sse: false
session_enabled: false
```

8. **Preset = multi-agent** — coordinator with spawn_agent:
```yaml
name: <name>
description: "TODO: describe coordinator role"
system_prompt_file: "<name>.md"
model_preference: "default"
# spawn_agent 필수. 추가 도구는 backend/tools/ 에 존재하는 것만.
allowed_tools: [read_file, spawn_agent]
max_turns: 20
compaction_enabled: true
spawn_enabled: true
max_spawn_depth: 2  # global cap is 3
sse: true
session_enabled: true
```

9. **Generate prompts/<name>.md template**:
```markdown
# <name> system prompt

TODO: describe the agent's role, personality, and task boundaries.

## 금지
- ...

## 출력 형식
- ...
```

10. **Smoke test** (post-scaffold):
```bash
# Validate via startup — if runs/ YAML has errors, pydantic extra="forbid" fails
uv run uvicorn backend.main:app --port 8001 > /tmp/uvicorn.log 2>&1 &
UVICORN_PID=$!
trap "kill $UVICORN_PID 2>/dev/null || true" EXIT
sleep 5

# APP_AUTH_REQUIRED=false assumed (dev default)
curl -fs http://localhost:8001/health || { echo "FAIL: boot"; tail /tmp/uvicorn.log; exit 1; }
# jq -e: no-match 시 exit 1 (일반 jq 는 빈 output + exit 0 로 false-pass 하므로 반드시 -e)
curl -fs http://localhost:8001/runs | jq -e '.runs[] | select(.name == "'"$NAME"'")' > /dev/null \
  || { echo "FAIL: run '$NAME' not in /runs registry"; exit 1; }

# Cross-check via api-manager run-policy mode (optional)
echo "Scaffold complete. Next steps:"
echo "  1. Edit backend/runs/prompts/${NAME}.md"
echo "  2. If response_schema set, add pydantic model"
echo "  3. Test: curl -N -X POST http://localhost:8001/run/${NAME} -H 'Content-Type: application/json' -d '{\"message\":\"hello\"}'"
```

## Cross-field validation (pydantic `@model_validator` 이 startup 에 raise)

- `spawn_enabled=true` + `allowed_tools` 에 `spawn_agent` 없음 → **reject**
- `spawn_enabled=true` + `max_spawn_depth < 1` → **reject**
- `max_spawn_depth > GLOBAL_MAX_SPAWN_DEPTH (=3)` → **reject**
- `sse=true` + `response_schema` 설정 → **422 at request time** (상호배타)

## What this command does NOT do

- Does not modify `backend/main.py` — 라우트는 `/run/<name>` 으로 자동 dispatch (RunRegistry 기반)
- Does not create pydantic model for `response_schema` — 사용자가 별도 추가
- Does not invoke `POST /runs/reload` — 서버 재시작 또는 reload 는 사용자 판단
- Does not auto-fill the prompts/<name>.md — TODO 템플릿만 생성
- Does not add tests — 사용자가 `backend/tests/` 에 별도 추가

## Caveats

- `backend/runs/prompts/` 디렉토리가 없으면 자동 생성
- `backend/runs/` 기존 파일과 중복되면 abort (destructive 방지)
- Port 8001 smoke 는 `/agent-verify`, `/pre-deploy` 와 동일 포트 — 동시 실행 금지
