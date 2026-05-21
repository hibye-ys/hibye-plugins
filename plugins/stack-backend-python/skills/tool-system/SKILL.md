---
name: tool-system
description: "REQUIRED for backend/tools/base.py, registry.py, orchestration.py — without this skill you WILL miss the input-based is_concurrency_safe METHOD, the ToolContext dataclass with cancel_event/deny_writes_outside, the filter_for_agent live view, and dispatch_tool_calls orchestration. Load BEFORE adding any Tool subclass or modifying the registry."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (non-negotiable — baseline misses ALL of these)
1. MUST define `is_concurrency_safe(self, args: ToolInput) -> bool` as input-based METHOD on Tool Protocol
2. MUST define `class ToolContext` dataclass with `cancel_event` and `deny_writes_outside` fields
3. MUST implement `filter_for_agent()` returning live `_FilteredRegistry` view
4. MUST implement `dispatch_tool_calls()` as orchestration entry point
5. `execute(args, ctx: ToolContext)` — `ctx` parameter is required

# tool-system — Tool 서브시스템 구조 청사진

## 이 skill은 언제 로드되는가

- `backend/tools/base.py`, `backend/tools/registry.py`, `backend/tools/orchestration.py` 최초 작성
- 새 Tool 서브클래스 추가 전 (registry 등록 룰 확인)
- 위 파일 수정 (Protocol 변경, concurrency 룰 변경)
- "tool 실행 race condition", "tool schema validation 실패", "registry에서 tool 못 찾음" 디버깅
- `/new-tool` command 실행 시점

## Tool System의 정체성

Tool System은 LLM이 호출할 수 있는 도구를 등록·검증·실행하는 계층이다. 핵심 구성:

1. **Tool Protocol** — 모든 tool이 구현해야 하는 pydantic v2 기반 인터페이스
2. **ToolRegistry** — 동적 등록/조회/필터링을 담당하는 싱글턴
3. **ToolContext** — 각 tool 호출 시 주입되는 실행 컨텍스트
4. **Orchestration** — Agent Loop Stage 5의 병렬/순차 파티셔닝과 결과 병합

이 4개가 `backend/tools/`의 뼈대다. 새 tool은 위 4개 인터페이스만 구현하면 자동으로
`agent-loop`의 Stage 5에 연결된다.

## Tool Protocol (pydantic v2)

```python
# backend/tools/base.py
"""Tool protocol — all agent tools implement this."""

from __future__ import annotations

from abc import abstractmethod
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel


class ToolInput(BaseModel):
    """Base for tool input schemas. Subclass with field declarations."""
    model_config = {"extra": "forbid"}


class ToolResult(BaseModel):
    """Generic tool result wrapper."""
    content: str | dict[str, Any]
    is_error: bool = False
    metadata: dict[str, Any] = {}


@runtime_checkable
class Tool(Protocol):
    """The contract every tool must satisfy."""

    name: str                    # unique identifier (snake_case)
    description: str             # 1-2 sentence purpose for LLM consumption
    input_schema: type[ToolInput]  # pydantic v2 model class

    @abstractmethod
    def is_concurrency_safe(self, args: ToolInput) -> bool:
        """Return True iff this *specific* invocation can run in parallel
        with other concurrency-safe tools. THIS IS INPUT-BASED, not a class
        attribute. Example: a file_read tool is safe in general, but if the
        path is the same as another concurrent write, it is not."""
        ...

    @abstractmethod
    async def execute(self, args: ToolInput, ctx: ToolContext) -> ToolResult:
        """Run the tool. Must be async-safe. Raise on internal errors;
        the registry wraps exceptions into ToolResult(is_error=True)."""
        ...
```

> 핵심 원칙: `is_concurrency_safe`는 **입력 기반**이다. 정적 클래스 속성으로 빼지 마라.
> 같은 tool이라도 입력 인자에 따라 안전성이 달라진다 (예: file_write 는 같은 path가
> 동시 쓰기면 unsafe, 다른 path면 safe).

## ToolRegistry API

```python
# backend/tools/registry.py
"""Tool registry — singleton, dynamic registration, agent-aware filtering."""

from __future__ import annotations

from typing import Iterator

from backend.tools.base import Tool, ToolInput, ToolResult, ToolContext


class ToolRegistry:
    _instance: "ToolRegistry | None" = None
    _tools: dict[str, Tool] = {}

    def __new__(cls) -> "ToolRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def register(cls, tool: Tool) -> None:
        """Register a tool. Raises if name collision."""
        if tool.name in cls._tools:
            raise ValueError(f"Tool {tool.name!r} already registered")
        cls._tools[tool.name] = tool

    @classmethod
    def get(cls, name: str) -> Tool:
        """Lookup by name. Raises KeyError if missing."""
        return cls._tools[name]

    @classmethod
    def definitions(cls) -> list[dict]:
        """Return JSON schemas for all registered tools (for LLM tool param)."""
        return [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema.model_json_schema(),
            }
            for t in cls._tools.values()
        ]

    @classmethod
    def filter_for_agent(cls, allow_list: list[str]) -> "ToolRegistry":
        """Return a view limited to the agent's allowed tool names."""
        # Implementation: subclass or wrapper, not a copy
        ...

    @classmethod
    def all(cls) -> Iterator[Tool]:
        return iter(cls._tools.values())
```

> 등록은 모듈 import 시점에 자동으로 일어난다 — 각 tool 모듈 하단에
> `ToolRegistry.register(MyTool())`. 중복 등록 방지를 위해 `__init__.py`가
> 명시적으로 import 순서를 잠근다.

## ToolContext 전체 필드

```python
@dataclass(slots=True)
class ToolContext:
    """Per-invocation context. Created by orchestration, passed to tool.execute()."""

    session_id: str                  # 현재 세션 ID
    agent_name: str                  # 호출한 agent의 이름
    turn_index: int                  # Agent Loop Stage 7 turn count
    tool_use_id: str                 # LLM이 부여한 unique tool_use ID
    cwd: str                         # 작업 디렉토리
    cancel_event: asyncio.Event      # 사용자 cancel 시 set
    metrics: ToolMetrics             # 실행 시간/메모리 카운터
    deny_writes_outside: list[str]   # write 차단 경로 (e.g., ["reference/", ".env"])
```

> `cancel_event`는 long-running tool이 1초 단위로 polling해서 graceful exit. 무시하면
> Agent Loop가 stuck.

## 병렬 실행 파티셔닝 (Agent Loop Stage 5)

Agent Loop Stage 5는 본 skill 의 분류 결과에 직접 의존한다. safe/unsafe로 나뉘며,
safe는 `asyncio.gather`로 병렬 실행, unsafe는 sequential 실행한다:

```python
# Pseudocode used by backend/engine/loop.py
def _partition_by_concurrency(
    tool_uses: list[tuple[str, dict]],
    registry: ToolRegistry,
) -> tuple[list, list]:
    safe, unsafe = [], []
    for name, raw_args in tool_uses:
        tool = registry.get(name)
        args = tool.input_schema.model_validate(raw_args)
        if tool.is_concurrency_safe(args):
            safe.append((tool, args))
        else:
            unsafe.append((tool, args))
    return safe, unsafe


# In loop.py Stage 5:
safe, unsafe = _partition_by_concurrency(tool_uses, tools)
safe_results = await asyncio.gather(
    *(tool.execute(args, ctx) for tool, args in safe),
    return_exceptions=True,
)
# unsafe run sequential — one after another, never in parallel
unsafe_results = []
for tool, args in unsafe:
    try:
        unsafe_results.append(await tool.execute(args, ctx))
    except Exception as e:
        unsafe_results.append(e)
```

> 결과 순서는 원본 `tool_uses` 배열 순서로 재정렬해서 LLM 에게 전달해야 한다.
> `agent-loop` skill Stage 6 참조.

## 동시성 함정 — 이 서브시스템 고유

1. **`is_concurrency_safe` 를 클래스 속성으로 빼지 마라**
   같은 tool이라도 입력에 따라 안전성이 달라진다. 정적 속성으로 빼면 false-positive
   parallel execution이 발생해서 race condition이 생긴다. 반드시 메서드로 유지하고,
   `args` 를 인자로 받아 입력별 분기를 하라.

2. **`ToolRegistry.register`는 멱등 아니다**
   같은 이름 두 번 등록하면 raise. test fixture에서 import 순서가 꼬이면 silent
   double-registration → ValueError. test setup에서 `ToolRegistry._tools.clear()`로
   초기화 후 등록하는 helper가 필요.

3. **`asyncio.gather(..., return_exceptions=True)` 의 결과는 예외 객체**
   `.execute` 가 raise하면 결과 리스트에 `Exception` 인스턴스가 들어간다. 이를
   `ToolResult(is_error=True)` 로 wrap하지 않고 그대로 LLM에게 보내면 다음 turn에서
   schema mismatch가 발생. orchestration.py가 반드시 결과를 스캔하면서 예외를
   ToolResult로 감싸야 한다.

## 신규 도구 체크리스트 (`/new-tool` command가 자동 적용)

새 tool을 추가할 때 반드시:

- [ ] `backend/tools/<name>.py` 에 `class <Name>Tool` 생성, `Tool` Protocol 구현
- [ ] `<Name>Input(ToolInput)` pydantic 모델 정의 (필드 + validator)
- [ ] `is_concurrency_safe(args)` 명시적 구현 — input 기반 분기 또는 `return False` (보수적)
- [ ] `async def execute(args, ctx)` 구현, `ToolResult` 반환
- [ ] 모듈 하단에 `ToolRegistry.register(<Name>Tool())` (또는 `__init__.py` 에서 import)
- [ ] `backend/tests/test_<name>.py` 에 `AsyncMock` 기반 단위 테스트 (`testing-infra` skill 참조)
- [ ] agent allowlist 갱신 (`backend/agents/*.yaml` 의 `tools:` 필드)
- [ ] `pytest backend/tests/test_<name>.py -v` 로컬 실행 후 통과 확인

> 위 체크리스트 자동화는 `/new-tool <name>` command 가 담당한다. command는 본 skill을
> 먼저 로드한 뒤 스캐폴드 파일을 생성한다.

## 검증 체크리스트

`backend/tools/base.py`, `registry.py`, `orchestration.py` 초안이 완성되면 다음을 모두
만족해야 한다:

- [ ] `Tool` Protocol에 `name`/`description`/`input_schema`/`is_concurrency_safe`/`execute` 5필드
- [ ] `ToolInput`/`ToolResult` pydantic v2 모델 (`extra="forbid"`)
- [ ] `ToolRegistry` 싱글턴 + `register`/`get`/`definitions`/`filter_for_agent`/`all` 5메서드
- [ ] `ToolContext` dataclass에 위 8필드 모두
- [ ] `_partition_by_concurrency` 함수가 `agent-loop` Stage 5에서 import 가능한 형태
- [ ] 동시성 함정 3개 항목이 코드에 반영됨
- [ ] pytest 스켈레톤 1개 이상 (`testing-infra` skill의 mock 패턴 사용)
- [ ] reference 비노출 검증 통과 (18개 키워드)

## Orchestration 결과 병합 규약

`asyncio.gather` 결과에 예외가 섞여 있을 수 있으므로, orchestration 계층은 반드시
결과 리스트를 스캔하면서 예외를 `ToolResult(is_error=True)`로 감싸야 한다. 그리고
원래 `tool_uses` 순서와 일치하도록 safe/unsafe 결과를 interleave한다:

```python
# backend/tools/orchestration.py
from typing import Sequence

from backend.tools.base import Tool, ToolInput, ToolResult, ToolContext
from backend.tools.registry import ToolRegistry


async def dispatch_tool_calls(
    tool_uses: Sequence[tuple[str, dict]],
    registry: ToolRegistry,
    ctx: ToolContext,
) -> list[ToolResult]:
    """Validate → partition → run → reorder → unwrap exceptions."""
    safe, unsafe, order = [], [], []
    for i, (name, raw) in enumerate(tool_uses):
        tool = registry.get(name)
        args = tool.input_schema.model_validate(raw)
        bucket = safe if tool.is_concurrency_safe(args) else unsafe
        bucket.append((i, tool, args))
        order.append((i, "safe" if bucket is safe else "unsafe"))

    safe_raw = await asyncio.gather(
        *(t.execute(a, ctx) for _, t, a in safe),
        return_exceptions=True,
    )
    unsafe_raw = []
    for _, t, a in unsafe:
        try:
            unsafe_raw.append(await t.execute(a, ctx))
        except Exception as e:
            unsafe_raw.append(e)

    # Reassemble in original order, wrapping any exception into a ToolResult
    results: list[ToolResult | None] = [None] * len(tool_uses)
    for (idx, _, _), raw in zip(safe, safe_raw):
        results[idx] = _wrap(raw)
    for (idx, _, _), raw in zip(unsafe, unsafe_raw):
        results[idx] = _wrap(raw)
    return [r for r in results if r is not None]


def _wrap(raw: ToolResult | BaseException) -> ToolResult:
    if isinstance(raw, BaseException):
        return ToolResult(content=f"{type(raw).__name__}: {raw}", is_error=True)
    return raw
```

> `_wrap` 가 없으면 Agent Loop Stage 6에서 LLM에게 예외 객체를 직렬화하려다
> `TypeError` 가 난다. 반드시 wrap 단계를 타라.

## 구현 중 막히면

- "이 tool이 concurrency-safe인지 모르겠다" → 보수적으로 `return False`. unsafe로
  분류되면 순차 실행되므로 정확성은 보장됨. 나중에 측정 후 안전 입력 케이스만 True로
  좁혀라.
- "registry singleton이 test마다 오염된다" → conftest fixture로 `_tools.clear()` 후
  필요 tool만 재등록. `testing-infra` skill의 `tool_registry` fixture 패턴 참조.
- "tool input schema validation이 실패한다" → `ToolInput.model_validate(raw_args)`
  의 에러 메시지를 ToolResult(is_error=True, content=str(e)) 로 wrap해서 LLM에게
  반환. raise하지 마라 — Agent Loop Stage 5가 catch하지 못한다.
- "`Protocol` 을 구현하는데 `isinstance` 체크가 실패한다" → `@runtime_checkable`
  데코레이터가 붙어있는지 확인. 붙어있어도 추상 메서드의 시그니처가 완전히 일치해야
  duck typing이 통과한다.
- "agent allowlist 가 tool에 반영되지 않는다" → `filter_for_agent` 는 복사본이 아닌
  wrapper view 로 구현해야 한다. 복사본으로 구현하면 런타임 register 가 반영되지
  않는다.
- 위 가이드로도 안 풀리면: 사용자에게 직접 보고 + 판단 요청.
