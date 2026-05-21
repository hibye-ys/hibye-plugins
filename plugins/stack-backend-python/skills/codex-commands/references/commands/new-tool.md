---
description: Scaffold a new agent tool — creates backend/tools/<name>.py + backend/tests/test_<name>.py from the tool-system blueprint and walks the user through the registration checklist.
argument-hint: <tool-name>
---

Scaffold a new tool named `$ARGUMENTS`.

## Usage

`/new-tool <tool-name>`

`<tool-name>` MUST be a valid Python identifier in `snake_case` (lowercase + underscore, no digits at start). If not, refuse and show the rule.

## Dispatch rule

1. **Validate the name** — must match `^[a-z][a-z0-9_]*$`. If invalid, refuse with the rule and stop.
2. **Load the `tool-system` skill** — read `.agents/skills/tool-system/SKILL.md` fully so the Protocol contract, ToolContext fields, and concurrency rule are in context. Do not skip this — the templates below depend on the skill's exact field names.
3. **Check for collisions** — if `backend/tools/$ARGUMENTS.py` already exists, refuse and tell the user to choose another name. Do not overwrite.
4. **Write the tool scaffold** to `backend/tools/$ARGUMENTS.py`:

```python
"""$ARGUMENTS tool — scaffolded by /new-tool. Fill in the body."""

from __future__ import annotations

from backend.tools.base import Tool, ToolInput, ToolResult, ToolContext
from backend.tools.registry import ToolRegistry


class ${ARGUMENTS_PASCAL}Input(ToolInput):
    # TODO: declare input fields with pydantic v2 types
    pass


class ${ARGUMENTS_PASCAL}Tool(Tool):
    name = "$ARGUMENTS"
    description = "TODO: 1-2 sentence purpose for LLM consumption"
    input_schema = ${ARGUMENTS_PASCAL}Input

    def is_concurrency_safe(self, args: ${ARGUMENTS_PASCAL}Input) -> bool:
        # Default to sequential. Narrow to True only after verifying input cases.
        return False

    async def execute(self, args: ${ARGUMENTS_PASCAL}Input, ctx: ToolContext) -> ToolResult:
        # TODO: implement
        raise NotImplementedError("$ARGUMENTS.execute not implemented")


ToolRegistry.register(${ARGUMENTS_PASCAL}Tool())
```

5. **Write the test scaffold** to `backend/tests/test_$ARGUMENTS.py`:

```python
"""Smoke test for $ARGUMENTS tool — scaffolded by /new-tool."""

import pytest
from unittest.mock import AsyncMock

from backend.tools.base import ToolContext
from backend.tools.$ARGUMENTS import ${ARGUMENTS_PASCAL}Input, ${ARGUMENTS_PASCAL}Tool


@pytest.mark.asyncio
async def test_${ARGUMENTS}_smoke():
    tool = ${ARGUMENTS_PASCAL}Tool()
    args = ${ARGUMENTS_PASCAL}Input()  # TODO: provide minimal valid input
    ctx = AsyncMock(spec=ToolContext)
    with pytest.raises(NotImplementedError):
        await tool.execute(args, ctx)
```

6. **Show the registration checklist** to the user (verbatim from `tool-system` skill):

> - [ ] `backend/tools/$ARGUMENTS.py` 에 클래스 작성 완료 (Protocol 5필드)
> - [ ] `${ARGUMENTS_PASCAL}Input` pydantic v2 필드 + validator 정의
> - [ ] `is_concurrency_safe` 명시적 구현 (input 기반 분기)
> - [ ] `execute` 본문 구현, `ToolResult` 반환
> - [ ] `ToolRegistry.register` 호출 확인 (모듈 import 시점)
> - [ ] `pytest backend/tests/test_$ARGUMENTS.py -v` 통과
> - [ ] agent allowlist 갱신 (`backend/agents/*.yaml` 의 `tools:` 필드)
> - [ ] (선택) `is_concurrency_safe` 가 True 반환 가능한 입력 케이스 좁히기

7. **Stop**. Do not implement the tool body. The user fills in the TODOs.

## What this command does NOT do

- It does not implement the tool's business logic.
- It does not modify `backend/agents/*.yaml` allowlists (the user does that explicitly so they remember the security boundary).
- It does not run pytest. The user runs `/agent-test` or `pytest` after filling in the TODOs.
- It does not register the tool with any LLM provider — registration happens automatically at import time via `ToolRegistry.register()` in the scaffold.

> `${ARGUMENTS_PASCAL}` is the PascalCase form of the argument (e.g., `web_search` → `WebSearch`). Claude converts `$ARGUMENTS` directly when filling the template.
