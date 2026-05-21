---
name: testing-infra
description: "CRITICAL for backend/tests/ and conftest.py — without this skill you WILL miss isolate_tool_registry (autouse=True, snapshots+restores _tools), reset_connected_providers_cache (autouse=True, calls cache_clear()), the FACTORY pattern for mock_anthropic_stream (async generator callable, NOT AsyncMock), and session_factory with LoopState. These isolation fixtures are the #1 cause of test pollution — load BEFORE writing ANY test."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (CRITICAL — baseline already knows common pytest patterns, these are the UNIQUE differentiators)
1. MUST define `isolate_tool_registry` as `autouse=True` fixture (snapshots+restores `ToolRegistry._tools`)
2. MUST define `reset_connected_providers_cache` as `autouse=True` fixture (calls `cache_clear()`)
3. `call_stream` mock MUST be async generator callable, NOT `AsyncMock(return_value=...)`
4. MUST define `mock_anthropic_stream` as FACTORY fixture (takes events list)
5. MUST define `session_factory` fixture with `LoopState`
6. VCR/cassette is  — do NOT implement in 

# testing-infra — Mock-based 테스트 인프라

## 이 skill은 언제 로드되는가

- `backend/tests/**/*.py` 새 테스트 작성
- `backend/tests/conftest.py` 새 fixture 추가
- "test pollution between cases" 증상
- "AsyncMock not awaited" warning
- pytest 마커 추가/변경

## 이 skill은 언제 로드되지 않는가

- VCR cassette 작성 ( — 별도 skill 또는 본 skill의 Chapter B)
- live API 호출 테스트 ()
- 통합/E2E 테스트 ()

> **Chapter B는  — H4 build plan 참조.** 본 skill은 Chapter A (mock-based
> unit test infra) 만 다룬다. VCR cassette 기반 record/replay 는 에서
> `testing-infra` skill에 Chapter B 로 추가된다. 그 이전에 VCR 패턴을 작성하지 말 것.

## Testing Infra의 정체성

 테스트의 핵심 원칙:

1. **No real API calls** — 모든 LLM/외부 서비스 호출은 `AsyncMock` 으로 대체한다.
2. **No real file I/O** in unit tests — `tmp_path` 또는 in-memory mock.
3. **Fast** — 전체 unit test suite < 10초 목표. `@pytest.mark.slow` 마커가 붙지
   않은 테스트는 모두 100ms 이내.
4. **Isolated** — 한 테스트가 다음 테스트의 상태에 영향을 주면 안 된다. process
   state (tool registry, provider cache, env) 는 autouse fixture 로 리셋.
5. **Async-first** — 거의 모든 코드가 async 이므로 fixture 도 async. `pytest-asyncio`
   `mode = "auto"` 를 pyproject.toml 에서 설정.

## conftest.py 공통 fixture

```python
# backend/tests/conftest.py
"""Shared pytest fixtures for App unit tests."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import AsyncIterator
from unittest.mock import AsyncMock

import pytest

from backend.providers.base import ContentBlock, Message, ProviderEvent


# ---------- Mock provider stream ----------

@pytest.fixture
def mock_anthropic_stream():
    """Returns a factory that builds a mock provider with an async-generator call_stream.

    IMPORTANT: call_stream must be an async-generator-returning callable, NOT an
    AsyncMock wrapping one. The agent loop does `async for ev in provider.call_stream(...)`
    — if call_stream is an AsyncMock, it becomes a coroutine that returns the generator
    instead of being the generator itself, breaking the iteration contract.
    """
    def _factory(events: list[dict]) -> MagicMock:
        async def _call_stream(**kwargs) -> AsyncIterator[ProviderEvent]:
            for ev in events:
                yield ProviderEvent(type=ev["type"], payload=ev.get("payload", {}))

        provider = MagicMock()
        provider.name = "anthropic"
        provider.model = "claude-sonnet-4-6"
        provider.supports_tools = True
        provider.supports_streaming = True
        provider.call_stream = _call_stream  # async generator callable, not AsyncMock
        provider.count_tokens = lambda msgs: sum(len(b.text or "") for m in msgs for b in m.content) // 4
        return provider
    return _factory


# ---------- Mock data reader ----------

# ---------- Session factory ----------

@pytest.fixture
def session_factory():
    """Build a minimal session/agent_spec/state tuple for tests."""
    def _factory(*, agent_name: str = "default", model: str = "claude-sonnet-4-6"):
        from backend.engine.loop import LoopState
        return {
            "agent_spec": {"name": agent_name, "model": model, "tools": []},
            "state": LoopState(task_budget_remaining=10),
            "session_id": "test-session-001",
        }
    return _factory


# ---------- Tool registry isolation (autouse) ----------

@pytest.fixture(autouse=True)
def isolate_tool_registry():
    """Reset ToolRegistry._tools before/after each test."""
    from backend.tools.registry import ToolRegistry
    original = dict(ToolRegistry._tools)
    ToolRegistry._tools.clear()
    yield
    ToolRegistry._tools.clear()
    ToolRegistry._tools.update(original)


# ---------- Connected providers cache reset (autouse) ----------

@pytest.fixture(autouse=True)
def reset_connected_providers_cache():
    from backend.services.model_resolution import connected_providers
    connected_providers.cache_clear()
    yield
    connected_providers.cache_clear()
```

> `autouse=True` fixture 는 모든 test 에 자동 적용된다. tool registry / provider
> cache 처럼 process state 를 건드리는 것은 반드시 autouse 로 격리해야 silent
> pollution 을 막을 수 있다.

## AsyncMock 패턴 (streaming provider)

```python
# backend/tests/test_loop_basic.py
import pytest

from backend.engine.loop import run_agent_loop


@pytest.mark.asyncio
async def test_loop_single_text_response(mock_anthropic_stream, session_factory):
    provider_events = [
        {"type": "text_delta", "payload": {"text": "Hello"}},
        {"type": "text_delta", "payload": {"text": ", world"}},
        {"type": "done", "payload": {}},
    ]
    provider = mock_anthropic_stream(provider_events)

    session = session_factory()
    events = []
    async for ev in run_agent_loop(
        session["agent_spec"], "hi", history=[], _provider_override=provider,
    ):
        events.append(ev)

    assert any(ev.type == "done" for ev in events)
    assert "".join(ev.payload.get("text", "") for ev in events if ev.type == "text_delta") == "Hello, world"
```

핵심은 `provider_events` 리스트가 곧 시나리오라는 점. 어떤 tool_use / text /
error 시퀀스든 이 리스트로 재현 가능. 단일 mock 객체를 쓰는 대신 factory
fixture 를 쓰면 한 파일 안에서 여러 시나리오를 병행할 수 있다.

## tool_use 블록 수동 생성

```python
@pytest.mark.asyncio
async def test_loop_single_tool_use(mock_anthropic_stream, session_factory):
    provider_events = [
        {"type": "tool_use_start", "payload": {"tool_use_id": "tu_001", "name": "echo"}},
        {"type": "tool_use_delta", "payload": {"tool_use_id": "tu_001", "partial_input": '{"text":"hi"}'}},
        {"type": "tool_use_end", "payload": {"tool_use_id": "tu_001"}},
        {"type": "done", "payload": {}},
    ]
    provider = mock_anthropic_stream(provider_events)

    # register a stub tool
    from backend.tools.base import Tool, ToolInput, ToolResult, ToolContext
    from backend.tools.registry import ToolRegistry

    class EchoInput(ToolInput):
        text: str

    class EchoTool:
        name = "echo"
        description = "echo back"
        input_schema = EchoInput
        def is_concurrency_safe(self, args): return True
        async def execute(self, args: EchoInput, ctx: ToolContext) -> ToolResult:
            return ToolResult(content=args.text)

    ToolRegistry.register(EchoTool())

    session = session_factory()
    events = []
    async for ev in run_agent_loop(session["agent_spec"], "echo hi", history=[], _provider_override=provider):
        events.append(ev)

    assert any(ev.type == "action_completed" and ev.payload.get("tool_use_id") == "tu_001" for ev in events)
```

이 패턴이 Agent Loop Stage 5 (tool 실행) 단위 테스트의 핵심이다. 실제 LLM 호출
없이 tool_use 흐름 전체 — discovery → execute → merge — 를 검증할 수 있다.

## pytest 마커 규칙

```toml
# pyproject.toml [tool.pytest.ini_options]
markers = [
  "unit: fast unit test (default; no I/O, no network)",
  "integration: slow test that touches multiple subsystems (still no network)",
  "slow: takes > 1s",
  "phase2b: VCR-dependent test (skipped in )",
]
```

```python
@pytest.mark.unit
async def test_fast_thing(): ...

@pytest.mark.integration
async def test_loop_with_real_data_layer(...): ...

@pytest.mark.phase2b
@pytest.mark.skip(reason="requires VCR cassette infra")
async def test_anthropic_record(): ...
```

> 기본 실행 (`pytest`) 은 unit 만 포함. integration / slow 는 명시적 marker
> 선택: `pytest -m "unit or integration"`. phase2b 마커가 붙은 테스트는 자동
> skip 되어 CI noise 를 만들지 않는다.

## 동시성 함정 — 이 서브시스템 고유

1. **`AsyncMock not awaited` warning**
   `mock.method()` 가 coroutine 을 반환하지만 `await` 안 되면 warning. 항상
   `await mock.method()` 또는 `mock.method.assert_awaited_once()`. 특히 fixture
   안에서 mock 을 만들고 바로 버리는 케이스는 `return_value=` 가 아니라
   `side_effect=` 로 써야 할 때가 있다.

2. **`monkeypatch` 가 fixture scope 밖에서 누락**
   `monkeypatch` 는 function scope fixture. session-scoped fixture 안에서
   `monkeypatch` 를 사용할 수 없다. session 레벨 patch 는 `pytest_sessionstart`
   hook 이나 `monkeypatch.setenv` 대신 `os.environ` 직접 조작 + autouse
   teardown 으로 처리.

3. **`asyncio.gather(..., return_exceptions=True)` 의 결과를 assert**
   gather 결과 리스트에 Exception 객체가 들어 있으면 `assert result == expected`
   가 silent fail (Exception 객체는 truthy, 등가 비교가 False 만 나와도 `any`
   로 감싸면 통과). 반드시 `assert not isinstance(r, Exception)` 를 명시적으로
   먼저 체크한 다음 값 비교.

## 검증 체크리스트

- [ ] `conftest.py` 에 4개 fixture (mock_anthropic_stream, mock_data_reader,
      session_factory) + 2개 autouse (isolate_tool_registry,
      reset_connected_providers_cache)
- [ ] `mock_anthropic_stream` 이 ProviderEvent 시퀀스 생성 (factory pattern)
- [ ] `isolate_tool_registry` autouse=True
- [ ] `reset_connected_providers_cache` autouse=True
- [ ] pytest 마커 4종 (unit/integration/slow/phase2b) pyproject.toml 에 등록
- [ ] AsyncMock streaming pattern 예시 코드 1개 (text_delta sequence)
- [ ] tool_use 블록 수동 생성 패턴 예시 코드 1개 (start/delta/end)
- [ ] 동시성 함정 3개 (AsyncMock not awaited / monkeypatch scope / gather exception)
- [ ] Chapter B (VCR) 연기 문구 명시
- [ ] reference 비노출 통과

## 구현 중 막히면

- "AsyncMock not awaited warning 이 나온다" → `await` 누락. 또는 mock setup 이
  `return_value=` 대신 `side_effect=` 가 필요한 케이스.
- "test 가 다른 test 에 영향 준다" → autouse fixture 에서 reset 필요. tool
  registry, provider cache, env vars, 모듈 레벨 singleton 등.
- "VCR 가 필요하다" → 본 skill 범위 밖. **Chapter B 는  — H4 build plan
  참조.** 현 단계에서는 mock fixture 로 재현 가능한 시나리오만 다룬다.
- 위 가이드로 안 풀리면: 사용자에게 보고.

---

## Chapter B — VCR cassette 인프라

### 활성화 조건
- `/phase` 가 `2b` 이상 (H4 build plan 적용 후)
- `vcrpy` 또는 자체 cassette engine 의존성 설치
- `backend/services/vcr.py` 모듈 존재

### 3-tier 테스트 분류

| Tier | 이름 | 설명 | 명령 |
|---|---|---|---|
| 1 | static | 외부 호출 0, mock fixture만 | `pytest -m unit` |
| 2 | mock | 외부 호출 mock (Chapter A) | `pytest -m "unit or integration"` |
| 3a | VCR replay | cassette 재생 | `/agent-test --replay` |
| 3b | VCR record | cassette 녹화 (실제 호출) | `/agent-test --record` |
| 4 | live | 실 호출, cassette 무시 | `/agent-test --live` |

### cassette 디렉토리 구조

```
backend/tests/vcr_cassettes/
  anthropic/
    test_loop_basic_tool_use.yaml
    test_provider_retry_on_429.yaml
  openai/
    test_function_calling.yaml
```

### `services/vcr.py` API 계약

```python
from enum import Enum
from contextlib import asynccontextmanager
from pathlib import Path


class VCRMode(str, Enum):
    REPLAY = "replay"
    RECORD = "record"
    LIVE = "live"


@asynccontextmanager
async def cassette(name: str, *, mode: VCRMode):
    """Wrap an async block to play back or record a cassette."""
    path = Path(f"backend/tests/vcr_cassettes/{name}.yaml")
    if mode == VCRMode.REPLAY:
        if not path.exists():
            raise CassetteMissing(name)
        # patch httpx to return recorded responses
        ...
    elif mode == VCRMode.RECORD:
        # patch httpx to record real responses to path
        ...
    elif mode == VCRMode.LIVE:
        # no patching — real calls go through
        ...
    yield
```

### `VCR_RECORD_MODE` 환경변수

```bash
VCR_RECORD_MODE=record /agent-test      # 실 호출 녹화
VCR_RECORD_MODE=replay /agent-test      # default — cassette 재생
VCR_RECORD_MODE=live   /agent-test      # cassette 무시, 실 호출
```

env 가 비어있으면 `replay` (안전 default).

### Cassette 작성 워크플로우

1. 새 test 작성, `@pytest.mark.vcr("anthropic/my_test")` decorator 사용
2. `VCR_RECORD_MODE=record` 로 1회 실행 → cassette 생성
3. cassette 내용 review (시크릿 redact 확인 — 자동 redact 가 빠뜨릴 수 있음)
4. `git add backend/tests/vcr_cassettes/anthropic/my_test.yaml`
5. 이후 CI/local 은 `replay` 로 실행

### 시크릿 redact

cassette 녹화 시 다음 필드 자동 redact:
- `Authorization` 헤더 → `Bearer [REDACTED]`
- `X-Api-Key` 헤더 → `[REDACTED]`
- request body 중 `api_key`, `password` → `[REDACTED]`

추가 패턴은 `services/vcr.py` 의 `REDACT_PATTERNS` 에 추가.

### 자주 보는 함정

1. **cassette 누락 시 silent skip vs raise**
   `replay` 모드에서 cassette 없으면 raise (`CassetteMissing`). 자동 record fallback
   금지 — 실수로 실 호출이 발생할 수 있음.

2. **redact 누락 시크릿이 cassette에 commit**
   cassette 작성 후 review 필수. `grep -r "sk-" backend/tests/vcr_cassettes/` 로 빠른 검사.

3. **CI에서 record 모드 실행**
   환경변수가 prod 에서 record 면 무한 비용. CI 에서는 `VCR_RECORD_MODE=replay` 강제.

상세는 `references/vcr-cassettes.md` 참조.

## Marker 자동 분류 invariant (2026-04-25 spec)

`backend/tests/conftest.py` 의 `pytest_collection_modifyitems` 가 모든 테스트에 `unit` / `integration` / `slow` 중 하나 이상을 자동 부여한다.

**Integration 판정 6 signal (any-of):**
1. 기존 `@pytest.mark.integration` (honor + idempotent)
2. `@pytest.mark.vcr`
3. fixturenames 에 `_INTEGRATION_FIXTURES` 중 하나 이상 (`client`, `db_engine`, `iyaki_env`, `iyaki_pool`, `populated_active_project`)
4. 파일 본문에 `TestClient` 또는 `pytest.mark.vcr` 문자열 (pytest_configure 에서 1회 scan — `@pytest.mark.vcr` 는 substring 으로 자동 catch)
5. 경로에 `/integration/` 또는 `/contract/`
6. 파일명 prefix: `test_iyaki_` / `test_db_` / `test_lsp_` / `test_live_` / `test_frontend_smoke`

**Slow 판정:** 수동 `@pytest.mark.slow` 또는 파일명 prefix `test_lsp_completion` / `test_live_anthropic`.

**Unit default:** 위 integration / slow 가 전혀 아닐 때만 `@pytest.mark.unit` 부여.

**핵심 불변식:**
- `_INTEGRATION_FIXTURES` 는 **single source of truth** — fixture rename / 추가 시 이 상수를 동시 갱신해야 `pytest -m unit` 의 "외부 I/O 0" 보장이 drift 하지 않음
- 수동 `@pytest.mark.integration` 은 hook 이 honor — unit 이 덧붙지 않음 (`get_closest_marker` 체크)
- `TestClient` 이외의 HTTP 기법 (예: raw `httpx.AsyncClient` 직접 사용) 은 content scan 이 탐지하지 않음 — 이 경우 반드시 수동 `@pytest.mark.integration` 또는 `client` fixture 경유

**테스트 네이밍 규칙:** 새 integration 테스트는 6 signal 중 **하나 이상**을 충족해야 한다. 가장 단순: `client` fixture request 또는 `@pytest.mark.integration` 명시. 상세: `docs/runbook/test-hygiene.md`.
