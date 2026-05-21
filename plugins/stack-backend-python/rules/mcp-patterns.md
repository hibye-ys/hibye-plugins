---
paths:
  - "backend/services/mcp/**"
---

> App backend rules — MCP Integration invariants, extension guide, impact map.
> **정본:** `_shared/mcp-namespace.md` (`mcp__<server>__<tool>` prefix / 5-state lifecycle / lazy reconnection / ${VAR} caller-별 차별 정책 — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `config-management.md` (${VAR} 치환 정책), `tool-system-patterns.md` (ToolRegistry 정렬),
>       `context-assembly-patterns.md` (post-compact 재주입 대상 중 MCP instructions)

# mcp-patterns — MCP 통합

> **Scope:** `backend/services/mcp/` — MCP 서버 연결, tool bridging, 내장 ToolRegistry 등록 규약.

## 불변식 (Invariants)

### 모듈 구조

| 파일 | 역할 |
|------|------|
| `config.py` | `MCPServerConfig` + `MCPRegistry` pydantic 모델 + `load_registry()` + `resolve_env_vars()` |
| `client.py` | `MCPClient` (단일 서버 세션) + `ConnectionState` Literal (5-state) + timeouts |
| `bridge.py` | `register_all_mcp_tools()` — MCP tool → App `ToolProtocol` 변환 + `ToolRegistry` 등록 |

### Registry 로드 순서

`load_registry(path)` 해석 순서 (`config.py:58-74`):

1. 명시 `path` 인자
2. `APP_MCP_REGISTRY` env var 경로
3. 기본값: `backend/services/mcp/registry.json`

파일 없으면 빈 `MCPRegistry()` 반환 — **MCP 는 opt-in**. registry.json 이 repo 에 commit 되지 않는 것이 기본.

### `MCPServerConfig` 스키마

```python
class MCPServerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str              # pattern=r"^[a-zA-Z0-9_-]+$", 1~64자 (load-time 검증)
    transport: Literal["stdio", "sse"]
    command: str | None    # stdio 전용
    args: list[str]        # stdio 전용
    url: str | None        # sse 전용
    env: dict[str, str]    # ${VAR} 치환 대상 (stdio subprocess env)
    enabled: bool = True
```

- **`name` 정규식 강제**: `mcp__<server>__<tool>` 이 ToolRegistry 정렬 키와 충돌하지 않도록. 공백 / `__` injection 은 load-time reject (`Field(pattern=...)`)
- `extra="forbid"` — 오타 필드 load-time `ValidationError`
- transport 는 **`stdio`** 와 **`sse`** 두 가지만 지원. 새 transport 추가 시 `Transport` Literal + `client.py::connect()` 분기 동시 업데이트

### `${VAR}` 치환 정책 (MCP 전용)

- `resolve_env_vars(env)` 는 `substitute_env(env, on_missing="empty")` 호출 — **누락 var → empty string** (POSIX subprocess env convention)
- **다른 caller 와 정책 다름** (`config-management.md` §`${VAR}` 치환):
  - providers.yaml → `raise` (credential fail-fast)
  - runs/*.yaml → `keep_placeholder` (오타 surface)
  - **MCP → `empty`** (spawn 된 subprocess 가 env 누락을 자체 판단)
- 시크릿은 반드시 `${VAR}` 로 주입, `.env` 에 실제 값

### 도구 네이밍

- Qualified name: **`mcp__<server>__<tool>`** (`bridge.py::_qualified_name`)
- `MCP_PREFIX = "mcp__"` — `ToolRegistry` 정렬 키와 일치 (`tools/registry.py:_MCP_PREFIX`)
- 정렬 순서: built-in (알파벳) → MCP (알파벳). prefix 로 구분되어 prompt cache prefix 보호 — `tool-system-patterns.md` §invariants
- 내장 도구와 이름 충돌 방지: `mcp__` prefix 만으로 충분 (server name 정규식이 `__` 포함 금지)

### 5-State 연결 관리

`ConnectionState = Literal["disabled", "pending", "connected", "needs_auth", "failed"]` (`client.py:39-45`)

전이표 (`client.py:32-38` 주석):

```
disabled ↔ pending      (config toggle)
pending → connected     (initialize handshake 성공)
pending → needs_auth    (server 가 auth-required 응답)
pending → failed        (transport / handshake / timeout)
connected → failed      (call error past retry budget)
any → disabled          (admin-disable or lifespan shutdown)
```

- 전이는 `_set_state()` 한 곳 경유 — 모든 변경이 `mcp.state_transition` 로그로 관측됨
- timeouts: `_CONNECT_TIMEOUT_SEC = 30`, `_CALL_TIMEOUT_SEC = 60` (`client.py:29-30`)

### Lazy reconnection

- 연결 끊기면 memoized 캐시 (`_tools_cache`) 무효화, 다음 tool call 이 새 연결 트리거
- **백그라운드 polling 금지** — 재연결은 항상 on-demand
- 이유: MCP 서버가 off 인 상태에서 polling 은 리소스 낭비 + 로그 노이즈

### 독립 연결

- 각 `MCPClient` 인스턴스는 독립. 한 서버 실패가 다른 서버를 차단하지 않음
- bridge.py 의 `register_all_mcp_tools` 가 per-server try/except 로 격리 — 한 서버 connect 실패 시 WARNING 로그 + 해당 서버 skip, 나머지 계속

### 도구 등록

- MCP tool 은 `bridge.py::make_mcp_tool` 가 `ToolProtocol` 로 래핑 → `ToolRegistry.register` 로 내장 도구와 **동일 경로** 등록
- 등록 시점: 부팅 시 `ToolRegistry._freeze()` 전에 완료. 런타임 추가 금지
- input schema 변환: MCP tool `inputSchema` (JSON Schema) → `create_model` 로 pydantic `ToolInput` 서브클래스 생성 (`_build_pydantic_from_schema`)
- `anyOf` / `oneOf` / `$ref` / `allOf` 같은 복잡 구조 → `Any` 로 fallback + WARNING 로그

### 대형 출력 처리

- MCP tool 결과도 내장 도구와 **동일한 head-truncate preview** (`stream.py::TOOL_PREVIEW_MAX_CHARS=4000`) 적용
- MCP 전용 disk-spill 경로는 **미구현** — 전체 결과를 별도 저장 후 `mcp__<server>__fetch_full` 같은 보조 도구로 꺼내는 패턴은 future enhancement
- 토큰 상한 초과 시 truncated payload 가 그대로 모델에 반환 (`error-handling.md` §head-truncate 한계)

### Server instructions (현재 미구현)

- 개별 MCP server 가 반환하는 `instructions` 필드를 세션 system prompt 에 delta 로 주입하는 기능은 **현재 미구현**
- MCP SDK 의 `ClientSession` 이 initialize 응답에서 instructions 를 받지만, bridge.py / loop 이 이를 프롬프트에 연결하는 경로 없음
- `context-assembly-patterns.md` §Post-Compact 재주입 대상에 "MCP server instructions (delta)" 가 **aspirational target** 으로 기재되어 있음
- 구현 시 "매 턴 full 전송 금지 — delta 만 전송" 원칙 유지 (prompt cache 보호)

### 연결 종료

- `MCPClient.close()` 는 `AsyncExitStack` LIFO unwind — transport + session async context 가 역순으로 cleanup
- 진행 중 tool call 은 SDK 쪽에서 cancel 처리 (asyncio task cancellation 전파) — **명시적 barrier 는 없음**
- `close()` 는 idempotent — 이미 닫힌 상태에서 재호출 안전

## 새 MCP 서버 연결 추가하기

1. `backend/services/mcp/registry.json` (또는 `APP_MCP_REGISTRY` 로 가리킨 파일) 에 entry 추가:
   ```json
   {
     "servers": [
       {
         "name": "my_server",
         "transport": "stdio",
         "command": "uvx",
         "args": ["some-mcp-server"],
         "env": {"API_TOKEN": "${MY_SERVER_TOKEN}"},
         "enabled": true
       }
     ]
   }
   ```
2. `name` 정규식 통과 확인 (`^[a-zA-Z0-9_-]+$`, 1~64자)
3. 시크릿은 `${VAR}` 로 주입, `.env` / deployment secret store 에 실제 값
4. transport 별 필수 필드:
   - `stdio` → `command` 필수
   - `sse` → `url` 필수
5. 부팅 시 `bridge.py::register_all_mcp_tools` 가 자동 연결 + tool 등록 + `mcp.tool_registered` 로그
6. `/debug/providers` 또는 `/debug/mcp` (있다면) 에서 state 확인 (`connected` / `needs_auth` / `failed`)
7. 테스트: 서버 connect 성공/실패, tool call 성공/실패/타임아웃. live 서버 의존 테스트는 VCR cassette 또는 mock session

## 새 transport 추가 시 체크리스트

1. `config.py::Transport` Literal 에 새 값 추가
2. `MCPServerConfig` 에 transport-specific 필수 필드 추가 (필요 시)
3. `client.py::MCPClient.connect()` 의 transport 분기에 새 브랜치 추가
4. timeout / cancellation 정책 정의
5. 테스트: 신규 transport 로 최소 1 서버 연결 + tool 호출

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `mcp__` prefix 형식 변경 | 모든 기존 MCP 도구 이름, agent YAML `tools` 리스트, ToolRegistry 정렬 키, 클라이언트 파서 |
| `MCPServerConfig.name` 정규식/길이 변경 | 기존 registry.json 의 server name 재검증. load-time fail-fast |
| `ConnectionState` Literal 추가/변경 | `_set_state` 전이표 + health check endpoint + UI state 뱃지 |
| reconnect 방식 변경 (lazy → active polling) | 리소스 사용량 증가, 로그 노이즈, 백그라운드 task 수명 관리 필요 |
| tool output head-truncate 규약 변경 | `tool-system-patterns.md` + `error-handling.md` 와 정합 필요. MCP 와 내장 도구가 동일 경로 공유 |
| disk-spill 구현 추가 | 저장 경로 (`data/mcp_results/` 등), 조회 도구 정의, TTL 설계 |
| Server instructions delta 주입 구현 | `context-assembly-patterns.md` §Post-Compact 재주입 + compaction 경로 + prompt cache 영향 검증 |
| `${VAR}` on_missing 정책 변경 (empty → raise) | MCP 서버 부팅 실패 가능성 증가. `config-management.md` 의 caller 별 차별 정책 재검토 |
| `APP_MCP_REGISTRY` 경로 변경 | 배포 스크립트 + `.env.example` + 운영 문서 |

## 금지 사항

- `mcp__<server>__<tool>` 네이밍 규칙 우회 (ToolRegistry 정렬 키 / 충돌 방지 위반)
- `MCPServerConfig.name` 패턴 검증 우회한 직접 인스턴스 생성 (pydantic Field 가 강제 — model_validate 경유 필수)
- MCP 도구를 `ToolRegistry` 우회한 직접 등록 (정렬 무효화 + prompt cache prefix 오염)
- 서버 설정에 시크릿 하드코드 (반드시 `${VAR}` + `.env` / secret store)
- 한 서버 connect 실패가 다른 서버를 차단하도록 bridge.py 로직 변경 (독립 연결 원칙 위반)
- 백그라운드 polling 기반 재연결 (lazy 원칙 위반, 리소스 낭비)
- `ToolRegistry._freeze()` 이후 런타임에 MCP 도구 추가/제거 (정렬 prefix 재계산 → 캐시 무효화)
- `_set_state()` 우회한 직접 `self._state = ...` 할당 (관측 누락)
- `${VAR}` 치환을 `substitute_env(on_missing="raise")` 로 바꾸는 등 caller 별 정책 혼동 (config-management.md §정책 차별)
- Server instructions 를 매 턴 full 전송 (미래 구현 시 — prompt cache 보호, delta 만)
