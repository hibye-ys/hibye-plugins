---
name: mcp-integration
description: "REQUIRED for backend/services/mcp/ — without this skill you WILL miss MCPServerConfig pydantic model with transport field, _resolve_env_vars() for ${VAR} substitution, make_mcp_tool_class() for dynamic Tool creation, mcp_ prefix in bridge, _build_pydantic_from_schema() for JSON schema conversion, _CONNECT_TIMEOUT_SEC = 30 / _CALL_TIMEOUT_SEC = 60, and is_concurrency_safe returning False. Load BEFORE adding any MCP connection."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (non-negotiable — baseline misses ALL of these)
1. MUST define `MCPServerConfig` pydantic model with `transport` field
2. MUST implement `_resolve_env_vars()` for `${VAR}` substitution
3. MUST implement `make_mcp_tool_class()` for dynamic Tool creation
4. MUST prefix tool names with `mcp_` in bridge
5. MUST implement `_build_pydantic_from_schema()` for JSON schema to ToolInput conversion
6. MUST use `_CONNECT_TIMEOUT_SEC = 30` and `_CALL_TIMEOUT_SEC = 60`
7. `is_concurrency_safe` MUST return `False` for MCP tools (conservative default)

# mcp-integration — MCP client 청사진

## 이 skill은 언제 로드되는가

- `backend/mcp/{client,bridge,config}.py` 최초 작성 또는 수정
- 새 MCP server 통합 추가 (Postgres MCP, GitHub MCP, Slack MCP 등)
- "MCP tool not registered" 또는 "MCP server disconnected" 디버깅
- 동적 tool 등록 흐름 검토 또는 boot-time tool discovery 변경

## MCP의 정체성

Model Context Protocol — Anthropic이 정의한 LLM과 외부 도구 간 표준 통신 프로토콜.
App는 **MCP CLIENT** 이다. 외부 MCP server (예: postgres-mcp, github-mcp,
slack-mcp) 에 연결해서 그 server가 노출하는 tools 를 App ToolRegistry에
동적 등록한다.

> **App는 자신만의 MCP server를 호스팅하지 않는다. 외부 server의 client일 뿐.**

이 분리가 핵심이다:
- **외부 MCP server** = 도구 제공자. Postgres 쿼리, GitHub issue 관리, Slack 메시지
  전송 등 특화 기능을 tools/list, tools/call 프로토콜로 노출.
- **App** = 도구 소비자. MCP server에 연결 → tools/list 로 사용 가능한 도구
  목록 획득 → 각 도구를 App Tool subclass로 래핑 → ToolRegistry에 등록 →
  agent loop가 일반 도구와 동일하게 사용.

MCP 1.0 프로토콜의 핵심 RPC 3개:
1. `initialize` — 핸드셰이크 (capabilities 교환)
2. `tools/list` — server가 노출하는 도구 목록 + JSON schema
3. `tools/call` — 특정 도구 실행 요청 + 결과 반환

App는 이 3개만 사용한다. resources/list, prompts/list 등 확장 RPC는
범위 밖.

## 3-파일 구조

| 파일 | 책임 | 길이 target |
|---|---|---|
| `backend/mcp/config.py` | 연결 가능 MCP server endpoint 카탈로그 + 인증 | 60-100 |
| `backend/mcp/client.py` | MCP session 관리 (connect, list, call, close) | 120-180 |
| `backend/mcp/bridge.py` | MCP tools를 App Tool subclass로 동적 등록 | 100-150 |

3 모듈은 한 방향 의존 그래프를 유지한다:

```
config.py  ──►  client.py  ──►  bridge.py  ──►  ToolRegistry
```

bridge가 config를 직접 import 하면 안 된다 — client를 통해서만 접근.
ToolRegistry는 `backend/tools/registry.py` 에서 import (`tool-system` skill 참조).

## config.py

```python
# backend/mcp/config.py
"""MCP server endpoint catalog."""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, Field


class MCPServerConfig(BaseModel):
    """Single MCP server connection definition.

    transport 에 따라 command/args (stdio) 또는 url (sse) 중 하나를 사용.
    env 딕셔너리의 value 에 `${VAR}` 형태가 있으면 os.environ 에서 치환.
    """
    name: str                       # 사용자 친화 이름 (e.g., "postgres-prod")
    transport: str                  # "stdio" | "sse"
    command: str | None = None      # stdio: 실행할 바이너리 경로
    args: list[str] = Field(default_factory=list)  # stdio: 명령 인자
    url: str | None = None          # sse: endpoint URL
    env: dict[str, str] = Field(default_factory=dict)  # 환경변수 (시크릿 inject)
    enabled: bool = True            # False 이면 boot 시 skip


class MCPRegistry(BaseModel):
    """Top-level registry — 연결 가능한 MCP server 전체 목록."""
    servers: list[MCPServerConfig] = Field(default_factory=list)


def _resolve_env_vars(env: dict[str, str]) -> dict[str, str]:
    """Replace ${VAR} placeholders with os.environ values."""
    resolved: dict[str, str] = {}
    for key, val in env.items():
        if val.startswith("${") and val.endswith("}"):
            env_name = val[2:-1]
            resolved[key] = os.environ.get(env_name, "")
        else:
            resolved[key] = val
    return resolved


def load_registry(path: Path | None = None) -> MCPRegistry:
    """Load MCP server registry from JSON file.

    Default path: backend/mcp/registry.json.
    Override with APP_MCP_REGISTRY env var or explicit path.
    """
    if path is None:
        env_path = os.getenv("APP_MCP_REGISTRY")
        path = Path(env_path) if env_path else Path("backend/mcp/registry.json")
    if not path.exists():
        return MCPRegistry()
    return MCPRegistry.model_validate_json(path.read_text())
```

> config는 `.env`와 분리. 시크릿은 env var 참조 (`${POSTGRES_PASSWORD}`).
> registry 파일에 실제 시크릿 값을 적으면 안 된다.

## client.py

```python
# backend/mcp/client.py
"""MCP client session management."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from mcp import ClientSession
from mcp.client.stdio import stdio_client

from backend.mcp.config import MCPServerConfig, _resolve_env_vars

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT_SEC = 30
_CALL_TIMEOUT_SEC = 60


class MCPClient:
    """Manages a single MCP server connection.

    Lifecycle: __init__ -> connect() -> list_tools() / call_tool() -> close().
    connect() 전에 list_tools/call_tool 호출 시 RuntimeError.
    """

    def __init__(self, config: MCPServerConfig) -> None:
        self.config = config
        self.session: ClientSession | None = None
        self._session_ctx: Any = None
        self._tools_cache: list[dict] | None = None

    async def connect(self) -> None:
        """Establish MCP session. Raises on timeout or transport error."""
        resolved_env = _resolve_env_vars(self.config.env)

        if self.config.transport == "stdio":
            if not self.config.command:
                raise ValueError(f"stdio transport requires command: {self.config.name}")
            self._session_ctx = stdio_client(
                command=self.config.command,
                args=self.config.args,
                env=resolved_env,
            )
        elif self.config.transport == "sse":
            if not self.config.url:
                raise ValueError(f"sse transport requires url: {self.config.name}")
            from mcp.client.sse import sse_client
            self._session_ctx = sse_client(self.config.url)
        else:
            raise ValueError(f"unsupported transport: {self.config.transport}")

        try:
            self.session = await asyncio.wait_for(
                self._session_ctx.__aenter__(),
                timeout=_CONNECT_TIMEOUT_SEC,
            )
            await self.session.initialize()
        except asyncio.TimeoutError:
            logger.warning("mcp_connect_timeout", server=self.config.name,
                           timeout=_CONNECT_TIMEOUT_SEC)
            raise

    async def list_tools(self) -> list[dict]:
        """Get tools from server (cached after first call)."""
        self._assert_connected()
        if self._tools_cache is None:
            response = await self.session.list_tools()
            self._tools_cache = [t.model_dump() for t in response.tools]
        return self._tools_cache

    async def call_tool(self, name: str, arguments: dict) -> dict:
        """Call a tool on the MCP server. Returns {content, is_error}."""
        self._assert_connected()
        try:
            response = await asyncio.wait_for(
                self.session.call_tool(name, arguments),
                timeout=_CALL_TIMEOUT_SEC,
            )
            return {"content": response.content, "is_error": response.isError}
        except asyncio.TimeoutError:
            logger.warning("mcp_call_timeout", server=self.config.name,
                           tool=name, timeout=_CALL_TIMEOUT_SEC)
            return {"content": f"MCP timeout after {_CALL_TIMEOUT_SEC}s", "is_error": True}

    async def close(self) -> None:
        """Gracefully close the MCP session."""
        if self.session and self._session_ctx:
            try:
                await self._session_ctx.__aexit__(None, None, None)
            except Exception as e:
                logger.warning("mcp_close_error", server=self.config.name, error=str(e))
            finally:
                self.session = None
                self._tools_cache = None

    def _assert_connected(self) -> None:
        if self.session is None:
            raise RuntimeError(
                f"MCPClient not connected: {self.config.name}. Call connect() first."
            )
```

> `_CONNECT_TIMEOUT_SEC = 30`, `_CALL_TIMEOUT_SEC = 60`. connect가 30초 넘으면
> 해당 server를 skip. call이 60초 넘으면 `is_error=True`로 결과 반환.

## bridge.py

```python
# backend/mcp/bridge.py
"""Bridge MCP tools into App ToolRegistry."""

from __future__ import annotations

import logging
from typing import Any

from pydantic import create_model

from backend.mcp.client import MCPClient
from backend.tools.base import Tool, ToolInput, ToolResult, ToolContext
from backend.tools.registry import ToolRegistry

logger = logging.getLogger(__name__)

_MCP_TOOL_PREFIX = "mcp_"


def make_mcp_tool_class(client: MCPClient, mcp_tool: dict) -> type:
    """Dynamically build a Tool-compatible class that proxies to MCP server.

    MCP server의 tool 정의(name, description, inputSchema)를 받아
    App Tool Protocol을 구현하는 클래스를 런타임에 생성한다.
    """
    raw_name: str = mcp_tool["name"]
    tool_name = f"{_MCP_TOOL_PREFIX}{raw_name}"
    description = mcp_tool.get("description", f"MCP tool: {raw_name}")
    schema = mcp_tool.get("inputSchema", {})

    InputModel = _build_pydantic_from_schema(schema, name=f"{tool_name}_Input")

    class MCPProxiedTool:
        name = tool_name
        description = description
        input_schema = InputModel

        def is_concurrency_safe(self, args: ToolInput) -> bool:
            return False  # 보수적: MCP server 내부 동작을 모르므로

        async def execute(self, args: ToolInput, ctx: ToolContext) -> ToolResult:
            result = await client.call_tool(raw_name, args.model_dump())
            return ToolResult(
                content=result["content"],
                is_error=result.get("is_error", False),
            )

    MCPProxiedTool.__name__ = f"MCP_{raw_name}"
    MCPProxiedTool.__qualname__ = f"MCP_{raw_name}"
    return MCPProxiedTool


async def register_all_mcp_tools(clients: list[MCPClient]) -> int:
    """Register all tools from all connected MCP clients into ToolRegistry.

    Sequential iteration -- 동일 tool name 충돌 방지. 등록 실패한 tool은
    skip + WARN log, 다른 tool 등록은 계속 진행.
    """
    count = 0
    for client in clients:
        try:
            tools = await client.list_tools()
        except Exception as e:
            logger.warning("mcp_list_tools_failed",
                           server=client.config.name, error=str(e))
            continue
        for mcp_tool in tools:
            try:
                tool_cls = make_mcp_tool_class(client, mcp_tool)
                ToolRegistry.register(tool_cls())
                count += 1
                logger.info("mcp_tool_registered",
                            server=client.config.name, tool=mcp_tool["name"])
            except Exception as e:
                logger.warning("mcp_tool_register_failed",
                               server=client.config.name,
                               tool=mcp_tool.get("name", "unknown"), error=str(e))
    return count


def _build_pydantic_from_schema(schema: dict[str, Any], *, name: str) -> type[ToolInput]:
    """Convert MCP tool JSON schema to pydantic v2 ToolInput subclass.

    Handles common cases: object with properties, required fields,
    basic types (string, integer, number, boolean, array).
    Complex constructs (anyOf, oneOf, $ref) are logged as WARN and
    the affected field falls back to Any.
    """
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    field_definitions: dict[str, Any] = {}
    for field_name, field_schema in properties.items():
        py_type = _json_type_to_python(field_schema)
        if field_name in required:
            field_definitions[field_name] = (py_type, ...)
        else:
            field_definitions[field_name] = (py_type | None, None)
    return create_model(name, __base__=ToolInput, **field_definitions)


def _json_type_to_python(field_schema: dict) -> type:
    """Map JSON schema type to Python type. Best-effort."""
    if "anyOf" in field_schema or "oneOf" in field_schema or "$ref" in field_schema:
        logger.warning("mcp_schema_complex_type", schema=field_schema)
        from typing import Any as AnyType
        return AnyType
    json_type = field_schema.get("type", "string")
    type_map: dict[str, type] = {
        "string": str, "integer": int, "number": float,
        "boolean": bool, "array": list, "object": dict,
    }
    return type_map.get(json_type, str)
```

> **`_MCP_TOOL_PREFIX = "mcp_"`**: MCP에서 가져온 tool은 `mcp_query`, `mcp_create_issue`
> 같이 prefix가 붙어 native App tool과 이름 충돌을 방지한다.

> **`is_concurrency_safe` = `False`**: MCP server 내부 동작을 모르므로 보수적으로
> sequential 실행. Agent Loop Stage 5에서 unsafe partition으로 분류된다.

## 동적 tool 등록 흐름

boot 시 1회 실행되는 6단계 흐름:

```
1. App boot (main.py lifespan)
   │
   ▼
2. config.load_registry()
   -> MCPRegistry (list of MCPServerConfig)
   -> enabled=False 인 server 는 여기서 필터
   │
   ▼
3. for each enabled server config:
       client = MCPClient(config)
       await client.connect()       <- 30s timeout, 실패 시 skip + WARN
       clients.append(client)
   │
   ▼
4. await register_all_mcp_tools(clients)
   -> 각 client.list_tools() 호출
   -> 각 tool에 대해 make_mcp_tool_class() -> ToolRegistry.register()
   │
   ▼
5. ToolRegistry 에 두 종류의 tool 공존:
   +---------------------------------------------------+
   |  native App tools (module import 시 등록)     |
   |  MCP-proxied tools    (boot 시 동적 등록)           |
   +---------------------------------------------------+
   │
   ▼
6. Agent Loop Stage 3 에서 ToolRegistry.definitions() 호출
   -> LLM에게 모든 tool (native + MCP) 의 schema 전달
   -> LLM이 MCP tool 호출 시 Stage 5 에서 MCPProxiedTool.execute() 실행
   -> client.call_tool() 로 MCP server 에 RPC
```

> 등록은 boot 시 1회. 매 turn마다 tools/list를 재호출하지 않는다.
> 새 MCP server 추가 시 process restart 필요. 에서는 restart 로 충분.

## 실패 모드

| 실패 | 감지 | 복구 | 에러 패턴 |
|---|---|---|---|
| connect timeout | `client.connect()` 에서 `asyncio.TimeoutError` (30s) | 해당 server skip + WARN, 다른 server 계속 | 패턴 4 (best-effort) |
| tools/list schema invalid | pydantic validation error in `_build_pydantic_from_schema` | 해당 tool skip + WARN, 다른 tool 계속 | 패턴 4 (best-effort) |
| server disconnect 중 tool call | `session.call_tool()` 에서 `ConnectionError` | ToolResult(is_error=True), LLM이 다음 turn 인지 | 패턴 2 (내부 서비스) |
| slow tools/call | `asyncio.wait_for` timeout (60s) | ToolResult(is_error=True, content="MCP timeout") | 패턴 2 (내부 서비스) |

> boot 실패 (connect timeout, schema invalid) 는 **best-effort** — 실패해도 나머지
> 서비스는 정상 동작. runtime 실패 (disconnect, slow call) 는 **typed error** —
> ToolResult로 감싸서 LLM에게 전달.

## 동시성 함정 — 이 서브시스템 고유

1. **client lifetime과 tool lifetime 불일치**

   `MCPClient`는 process lifetime으로 유지된다. `MCPProxiedTool`은 매 호출마다
   `client.call_tool()`을 사용한다. client가 close 된 상태에서 tool 호출이 오면
   `RuntimeError`가 raise된다.

   해결: `MCPProxiedTool.execute()` 안에서 `client._assert_connected()`가 호출되어
   명시적 에러가 발생한다. 이를 ToolResult(is_error=True)로 감싼다.

   ```python
   # MCPProxiedTool.execute 내부 — client 연결 상태 검증은 client 레벨에서 수행
   async def execute(self, args, ctx):
       try:
           result = await client.call_tool(self.name, args.model_dump())
           return ToolResult(content=result["content"], is_error=result.get("is_error", False))
       except RuntimeError as e:
           return ToolResult(content=f"MCP server unavailable: {e}", is_error=True)
   ```

2. **dynamic registration race condition**

   `register_all_mcp_tools`가 여러 곳에서 동시 호출되면 같은 tool name이 두 번
   등록되어 `ToolRegistry.register()`가 `ValueError`를 raise한다.

   해결: boot 시 sequential로만 호출. concurrent하게 호출하는 코드가 있으면
   refactor. 함수 내부에서 `asyncio.Lock`을 추가하는 것도 방어적으로 가능하지만
   근본 원인은 호출 패턴이다.

3. **JSON schema에서 pydantic 변환 시 정보 손실**

   MCP tool의 input schema에 `anyOf`, `oneOf`, `$ref`, nested `allOf` 같은 복합
   구성이 있으면 pydantic v2 `create_model`로 정확하게 변환할 수 없다.

   해결: `_json_type_to_python`에서 복합 타입 감지 시 `Any`로 fallback하고
   WARN log를 남긴다. **silent skip 금지** — 반드시 로그를 남겨서 어떤 tool의
   어떤 field가 정보 손실되었는지 추적 가능해야 한다.

## 검증 체크리스트

`backend/mcp/` 초안이 완성되면 다음을 모두 만족해야 한다:

- [ ] `config.py` 에 `MCPServerConfig` + `MCPRegistry` pydantic v2 모델 + `load_registry()` 함수
- [ ] `client.py` 에 `MCPClient`: `connect()` / `list_tools()` / `call_tool()` / `close()`, stdio + sse 지원
- [ ] `bridge.py` 에 `make_mcp_tool_class()` + `register_all_mcp_tools()` + `_build_pydantic_from_schema()`
- [ ] 4 실패 모드 (connect timeout, schema invalid, server disconnect, slow call) 처리 코드
- [ ] 동시성 함정 3개 (client lifetime, registration race, schema conversion loss) 코드 반영
- [ ] `MCPProxiedTool.is_concurrency_safe` 가 항상 `False` 반환
- [ ] pytest 스켈레톤 1개 (mock MCP server + dynamic registration + `ToolRegistry.get("mcp_<name>")`)

## 구현 중 막히면

- **"MCP server는 어디서 받나"** → App가 만드는 게 아니다. 외부 도구다.
  postgres-mcp, github-mcp, filesystem-mcp 등 커뮤니티/공식 MCP server를 사용자가
  config 파일에 등록한다. App는 client 역할만.

- **"JSON schema 변환이 실패한다"** → `pydantic.create_model`로 기본 타입은
  변환 가능. `anyOf`/`oneOf`/`$ref` 등 복합 구성은 `Any` fallback + WARN log.
  tool 전체를 skip 하지 않고 **해당 field만** fallback.

- **"client connect timeout"** → `asyncio.wait_for` 로 30s 후 raise. 해당 server만
  skip, 다른 server는 계속. boot 전체가 실패하지 않는다.

- **"agent가 MCP tool을 못 찾는다"** → ToolRegistry에 등록된 이름 확인. `mcp_`
  prefix가 붙어 있다. agent YAML의 `tools:` allowlist에 `mcp_*` 와일드카드 또는
  구체적 이름이 포함되어야 한다.
