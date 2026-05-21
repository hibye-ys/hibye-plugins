---
name: sub-agent-spawn
description: "REQUIRED for backend/tools/agents.py and backend/engine/subagent.py — without this skill you WILL miss MAX_SPAWN_DEPTH = 3 constant, SpawnDepthExceeded exception, check_depth() guard, SpawnQueue for background task tracking, use_exact_tools cache-friendly tool reuse, and summarize_session() result compression. Load BEFORE implementing any spawn capability."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (non-negotiable — baseline misses exact naming and values)
1. MUST define `MAX_SPAWN_DEPTH = 3` constant
2. MUST define `SpawnDepthExceeded` exception
3. MUST implement `check_depth(ctx)` before any child spawn
4. MUST implement `SpawnQueue` for background task tracking
5. MUST use `use_exact_tools` for cache-friendly tool reuse
6. MUST implement `summarize_session()` for result compression

# sub-agent-spawn — 서브에이전트 spawn 청사진

## 이 skill은 언제 로드되는가

- `backend/tools/agents.py` 또는 `backend/engine/subagent.py` 최초 작성/수정
- 새 sub-agent 카테고리 추가 (agent YAML 에 spawn 가능한 자식 정의)
- "depth budget exhausted", "infinite recursion", "parent loses cache hit after spawn" 디버깅

## Sub-agent Spawn의 정체성

App agent가 자신의 실행 **도중에** 다른 agent를 호출할 수 있게 한다. Agent
Loop Stage 5 에서 `spawn_agent` tool이 실행되면, 새 자식 agent loop이 생성되어
독립된 세션에서 동작한다. 결과는 부모 대화에 tool_result로 돌아온다.

두 가지 모드를 지원한다:

### 1. foreground — 부모가 결과를 기다림

부모 agent의 현재 turn이 **블로킹**된다. 자식 loop이 완료되면 결과가 요약되어
`SpawnAgentResult.summary` 에 담겨 돌아온다. 사용자가 보는 응답에 즉시 반영.

```
parent turn N
  ├─ LLM 응답: spawn_agent("writing_assistant", "1장 작성", mode="foreground")
  ├─ ─── 자식 loop 실행 (await) ───
  │      └─ writing_assistant 가 3 turn 돈 뒤 완료
  ├─ 자식 결과 요약 → SpawnAgentResult.summary
  ├─ tool_result 로 부모 대화에 merge
  └─ 부모 turn N+1 진행
```

### 2. background — 부모는 즉시 진행

부모 agent가 즉시 다음 turn으로 진행한다. 자식은 `asyncio.create_task`로 백그라운드
실행. 결과는 비동기로 세션 inbox에 저장되며, 다음 사용자 prompt 시점에 자동 주입.

```
parent turn N
  ├─ LLM 응답: spawn_agent("validator", "검증해", mode="background")
  ├─ asyncio.create_task(child_loop)
  ├─ SpawnAgentResult(summary=None, child_session_id="abc")
  ├─ 부모 turn N+1 즉시 진행
  └─ ... 나중에 자식 완료 → inbox 저장 → 다음 /run/<name> 시 주입
```

## spawn_agent tool signature

`spawn_agent`는 Tool Protocol을 구현하는 일반 tool이다. `backend/tools/agents.py`에
위치하며 ToolRegistry에 등록된다.

```python
# backend/tools/agents.py
"""spawn_agent — sub-agent spawning tool."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from backend.tools.base import ToolInput, ToolResult, Tool, ToolContext
from backend.engine.subagent import run_child_agent, schedule_background_agent
from backend.services.summary import summarize_session


class SpawnAgentInput(ToolInput):
    """Input schema for spawn_agent tool."""

    agent_name: str = Field(
        description="Name of the child agent to invoke (must exist in backend/agents/<name>.yaml).",
    )
    user_input: str = Field(
        description="The prompt/task to pass to the child agent.",
    )
    mode: Literal["foreground", "background"] = Field(
        default="foreground",
        description="foreground: parent blocks until child finishes. "
        "background: parent continues immediately.",
    )
    timeout_seconds: int = Field(
        default=300,
        ge=10,
        le=1800,
        description="Maximum wall-clock seconds for child execution (foreground only).",
    )
    use_exact_tools: bool = Field(
        default=True,
        description="If True, child uses parent's exact tool set (cache-friendly). "
        "If False, child loads its own tools (cache-hostile).",
    )


class SpawnAgentResult(BaseModel):
    """Result returned by spawn_agent tool."""

    child_session_id: str
    mode: str
    summary: str | None = None   # foreground: summarized child output; background: None
    error: str | None = None     # non-None if child failed
```

> `SpawnAgentInput`은 `ToolInput`을 상속하므로 `extra="forbid"` 가 자동 적용된다.
> LLM이 미등록 필드를 보내면 pydantic v2 validation이 즉시 거부한다.

### SpawnTool 구현체

```python
class SpawnTool:
    """Tool Protocol implementation for spawn_agent."""

    name: str = "spawn_agent"
    description: str = (
        "Delegate a task to another specialist agent. "
        "The child runs in its own session and returns a summary."
    )
    input_schema: type[ToolInput] = SpawnAgentInput

    def is_concurrency_safe(self, args: ToolInput) -> bool:
        # spawn_agent is NEVER concurrency-safe.
        # State mutation (child session) + provider quota consumption.
        return False

    async def execute(self, args: ToolInput, ctx: ToolContext) -> ToolResult:
        assert isinstance(args, SpawnAgentInput)
        check_depth(ctx)  # prevent infinite recursion

        child_session_id = _make_child_session_id(ctx.session_id)
        child_depth = ctx.metadata.get("spawn_depth", 0) + 1

        if args.mode == "foreground":
            # Block until child completes, return summary
            await run_child_agent(
                agent_name=args.agent_name,
                user_input=args.user_input,
                child_session_id=child_session_id,
                spawn_depth=child_depth,
                timeout_seconds=args.timeout_seconds,
                use_exact_tools=args.use_exact_tools,
            )
            summary = await summarize_session(child_session_id)
            result = SpawnAgentResult(
                child_session_id=child_session_id,
                mode="foreground", summary=summary,
            )
        else:
            # Schedule in background, return immediately
            await schedule_background_agent(
                agent_name=args.agent_name,
                user_input=args.user_input,
                child_session_id=child_session_id,
                spawn_depth=child_depth,
                use_exact_tools=args.use_exact_tools,
            )
            result = SpawnAgentResult(
                child_session_id=child_session_id,
                mode="background", summary=None,
            )

        return ToolResult(content=result.model_dump())
```

> foreground 모드에서 `asyncio.TimeoutError`와 일반 `Exception`은 `ToolResult(is_error=True)`로
> wrap하여 반환 — Agent Loop Stage 5의 표준 에러 처리 패턴. 코드 생략했으나 반드시 구현할 것.

## depth limit (max_depth=3)

무한 재귀를 방지하는 핵심 안전장치. 에이전트 체인은 최대 3단계까지만 허용된다.

```python
# backend/engine/subagent.py (상단)

MAX_SPAWN_DEPTH = 3


class SpawnDepthExceeded(Exception):
    """Raised when spawn depth exceeds MAX_SPAWN_DEPTH."""


def check_depth(ctx: ToolContext) -> None:
    """Validate that current spawn depth is within limits.

    Called at the very beginning of spawn_agent.execute() — before any
    child session is created.
    """
    depth = ctx.metadata.get("spawn_depth", 0)
    if depth >= MAX_SPAWN_DEPTH:
        raise SpawnDepthExceeded(
            f"max spawn depth {MAX_SPAWN_DEPTH} reached "
            f"(current depth={depth}). Refusing to spawn another child."
        )
```

### 3의 근거

| depth | 의미 | 예시 |
|---|---|---|
| 0 | 사용자 직접 호출한 메인 agent | `chat_assistant` |
| 1 | 메인이 호출한 1차 자식 | `writing_assistant` |
| 2 | 1차 자식이 호출한 2차 자식 | `world_validator` |
| 3 | **도달 불가** — `check_depth`가 거부 | - |

depth 4 이상이 필요한 요청은 거의 존재하지 않는다. 깊은 체인은 보통 설계 오류
(에이전트가 자기 자신을 재귀 호출)이며, 각 depth 마다 컨텍스트 윈도우와 비용이
곱절로 증가한다. 3이면 user → A → B → C 까지 허용하면서 폭주를 방지한다.

### depth 전파 (부모 → 자식)

```python
# backend/engine/subagent.py

async def run_child_agent(
    agent_name: str,
    user_input: str,
    parent_session_id: str,
    child_session_id: str,
    spawn_depth: int,
    timeout_seconds: int,
    use_exact_tools: bool,
) -> None:
    """Run a child agent loop to completion (foreground mode)."""
    agent_spec = load_agent_spec(agent_name)

    child_messages = _build_child_messages(
        child_user_input=user_input,
        agent_spec=agent_spec,
        use_exact_tools=use_exact_tools,
    )

    async with asyncio.timeout(timeout_seconds):
        async for event in run_agent_loop(
            agent_spec=agent_spec,
            user_input=user_input,
            history=[],
            max_turns=agent_spec.max_turns,
            chain_depth=spawn_depth,       # <-- depth 전파
        ):
            await session_store.write_event(child_session_id, event)
```

> `chain_depth` 파라미터가 `run_agent_loop`의 `LoopState.chain_depth`로 전달되고,
> 자식이 다시 `spawn_agent`를 호출하면 `ctx.metadata["spawn_depth"]`가 이 값이 된다.
> 이 전파 체인이 끊기면 `check_depth`가 동작하지 않아 무한 재귀가 발생한다.

## useExactTools 캐시 정합성

LLM provider (특히 Anthropic)는 system prompt + tools 정의가 **바이트 단위로 동일**할
때 prompt cache를 적중시킨다. 자식 agent를 spawn하면 자식의 system prompt는 부모와
다를 수밖에 없지만, **tool definitions**는 동일하게 유지할 수 있다.

`use_exact_tools=True` (기본값)이면 자식이 부모와 동일한 tool set을 사용한다.
이렇게 하면 부모의 다음 turn에서 provider가 tool definitions 부분의 캐시를 재활용
할 수 있다.

```python
# backend/engine/subagent.py

def _build_child_messages(
    child_user_input: str, agent_spec, *,
    use_exact_tools: bool, parent_tools: list[dict] | None = None,
) -> tuple[str, list[dict], list[dict]]:
    """Return (child_system_prompt, child_messages, child_tools)."""
    from backend.tools.registry import ToolRegistry

    if use_exact_tools and parent_tools is not None:
        # Cache-friendly: same tool JSON → provider cache stays valid
        child_tools = parent_tools
    else:
        # Cache-hostile: different JSON → parent cache invalidated
        child_tools = ToolRegistry.filter_for_agent(agent_spec.tools).definitions()

    child_system = _build_child_system_prompt(agent_spec)
    child_messages = [{"role": "user", "content": child_user_input}]
    return child_system, child_messages, child_tools


def _build_child_system_prompt(agent_spec) -> str:
    """Same base prompt as parent (cache-friendly prefix) + child agent layer."""
    from backend.engine.context import BASE_SYSTEM_PROMPT
    return BASE_SYSTEM_PROMPT + "\n\n" + agent_spec.system_prompt_layer
```

| `use_exact_tools` | tool definitions | 부모 다음 turn 캐시 | 비용 영향 |
|---|---|---|---|
| `True` (default) | 부모와 동일 바이트 | 적중 (tool block) | 최소 |
| `False` | 자식 전용 필터 | 미스 (전체 재전송) | 비용 증가 |

> `use_exact_tools=False`가 필요한 유일한 케이스: 자식이 부모에게 없는 위험한 tool
> (예: `bash`, `file_write`)을 사용해야 하고 prompt scoping으로 제한 불가한 경우.

## 결과 요약 통합

foreground spawn 완료 후, 자식의 전체 출력을 부모에게 그대로 돌려보내면 부모의
컨텍스트 윈도우를 낭비한다. 대신 `backend/services/summary.py`가 자식 세션의
텍스트 이벤트를 읽어 짧은 요약을 생성한다.

```python
# backend/services/summary.py

SUMMARY_THRESHOLD_WORDS = 100

async def summarize_session(
    child_session_id: str,
    *,
    max_words: int = SUMMARY_THRESHOLD_WORDS,
) -> str:
    """Read child session events, return concise summary."""
    events = await session_store.read_events(child_session_id)
    text = "".join(
        e.payload.get("text", "") for e in events if e.type == "text_delta"
    ).strip()

    if not text:
        return "(child agent produced no text output)"
    if len(text.split()) <= max_words:
        return text

    # Use internal lightweight model (haiku-class) for summarization
    return await _llm_summarize_short(text, max_words=max_words)
```

> `_llm_summarize_short`는 `get_internal_model()` (haiku 급)을 사용해 요약.
> 메인 agent의 비싼 모델이 아닌 요약 전용. API key 없으면 raw text truncation fallback.

## 동시성 함정 — 이 서브시스템 고유

이 세 함정은 sub-agent spawn 구현에서 반복적으로 나타나며, 일반적인 asyncio
지식만으로는 잡히지 않는다. 코드 리뷰 시 먼저 이 세 개를 체크한다.

### 1. background 모드의 결과 회수 누락

부모가 `mode="background"` spawn 후 즉시 자기 loop을 종료하면, 자식
`asyncio.Task`의 결과를 아무도 확인하지 않는다. 자식이 실패해도 예외가 묻힌다.

**해결**: `schedule_background_agent`가 `asyncio.create_task` + `SpawnQueue.register`
로 세션 레벨 queue에 등록. 다음 `/run/<name>` 호출 시 미들웨어가 완료된 task를 확인,
결과/에러를 다음 대화 context에 자동 주입.

```python
async def schedule_background_agent(...) -> None:
    task = asyncio.create_task(
        run_child_agent(..., timeout_seconds=600),
        name=f"bg-spawn-{child_session_id}",
    )
    await SpawnQueue.register(parent_session_id, child_session_id, task)
```

### 2. depth metadata 전파 누락

`ctx.metadata["spawn_depth"]`를 부모가 **명시적으로 +1 해서** 자식의 `LoopState`에
전달해야 한다. 이 전파가 누락되면:

- 자식의 `spawn_depth`가 항상 0
- `check_depth()`가 절대 거부하지 않음
- agent A → B → C → D → ... 무한 재귀 가능

**체크포인트**: `run_child_agent`에 `spawn_depth` 인자가 있는지, 그 인자가
`run_agent_loop`의 `chain_depth`로 전달되는지, `ToolContext.metadata`에 다시
저장되는지 — 이 3단계를 모두 grep으로 확인.

### 3. useExactTools=False 로 인한 cache invalidation

`use_exact_tools=False`를 사용하면 자식의 tool definitions가 부모와 달라진다.
Provider 캐시는 tool definitions를 바이트 단위로 비교하므로, **자식 호출 하나로
부모의 후속 turn 전체가 캐시 미스**가 된다.

**방어**: `SpawnAgentInput.use_exact_tools`의 default가 `True`인 것은 이 이유다.
`False`로 명시 설정하는 경우에는 LLM이 의도적으로 선택한 것이므로 허용하되,
WARNING 로그를 남긴다:

```python
if not args.use_exact_tools:
    logger.warning(
        "spawn_cache_hostile",
        agent=args.agent_name,
        reason="use_exact_tools=False invalidates parent cache",
    )
```

## 검증 체크리스트

`backend/tools/agents.py`, `backend/engine/subagent.py`, `backend/services/summary.py`
초안이 완성되면 다음을 모두 만족해야 한다:

- [ ] `SpawnAgentInput(ToolInput)` 에 5필드 (agent_name, user_input, mode, timeout_seconds, use_exact_tools)
- [ ] `SpawnAgentResult(BaseModel)` 에 4필드 (child_session_id, mode, summary, error)
- [ ] `MAX_SPAWN_DEPTH = 3` 상수 + `check_depth()` 함수가 `SpawnDepthExceeded` raise
- [ ] foreground / background 두 모드 모두 `_execute_foreground` / `_execute_background` 분리
- [ ] `use_exact_tools=True` default + `_build_child_messages` 의 분기 존재
- [ ] `summarize_session` 함수 (SUMMARY_THRESHOLD_WORDS + LLM fallback)
- [ ] `is_concurrency_safe(args)` 가 항상 `return False`
- [ ] 동시성 함정 3개 (background queue, depth propagation, cache WARNING) 코드 반영

## 구현 중 막히면

- **"background 모드 결과를 어디 저장하나"** → `backend/state/spawn_queue.py`에
  in-memory `asyncio.Queue` + task registry. 에서 Redis로 전환 (session store Protocol).
  지금은 프로세스 메모리면 충분하다.

- **"use_exact_tools=False가 정말 필요한 케이스가 있나"** → 자식이 부모와 **완전히
  다른** tool set이 필요한 경우만. 예를 들어 부모는 read-only agent인데 자식은
  `bash` + `file_write`가 필요한 경우. 그 외에는 `True` 강제. prompt scoping으로
  tool 사용을 제한하는 것이 캐시 면에서 훨씬 효율적이다.

- **"summarize_session의 internal model API key가 없다"** →  초기에는
  `get_internal_model()`이 stub raise 할 수 있다. 그 경우 raw text를 max_words
  까지 잘라서 반환하는 fallback을 넣어라. 완벽한 요약보다 동작하는 코드가 우선.
