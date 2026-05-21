---
name: mcp-namespace
description: MCP 도구 네이밍 (`mcp__<server>__<tool>`), 연결 5-state lifecycle, registry 로드 순서, env 치환 정책 invariant.
metadata:
  role: invariant
  scope: apps/api
  source: stack-backend-python/_shared/mcp-namespace.md
---

**적용된 §4.4 매트릭스 행**: 거의 ✕ (protocol-level). MCP 클라이언트 import: Python `mcp` SDK → `@modelcontextprotocol/sdk` (TS)

> Language-neutral invariants — MCP namespace, connection lifecycle, env substitution policy, registry isolation.
> 정본 (single source of truth) for both Python and TS harnesses.
> Cited from: `python_agent_rules/mcp-patterns.md`, `ts_agent_rules/mcp-patterns.md`.

# MCP Integration — 언어 무관 불변식

## 도구 네이밍 — `mcp__<server>__<tool>`

- Qualified name 형식: **`mcp__<server>__<tool>`** (double underscore separator)
- `MCP_PREFIX = "mcp__"` — `ToolRegistry` 정렬 키와 일치 (`skills/tool-sort-order/SKILL.md`)
- 정렬: built-in (알파벳) → MCP (알파벳). prefix 로 그룹 분리 → prompt cache prefix 보호
- 내장 도구와 이름 충돌 방지: `mcp__` prefix + server name 정규식이 `__` 포함 금지로 충분

## `MCPServerConfig` 스키마

```yaml
name: str              # 정규식 ^[a-zA-Z0-9_-]+$, 1~64자 (load-time 검증)
transport: stdio | sse # 두 가지만 지원
command: str | null    # stdio 전용
args: list[str]        # stdio 전용
url: str | null        # sse 전용
env: dict[str, str]    # ${VAR} 치환 대상 (stdio subprocess env)
enabled: bool = true
```

TS 구현: `@modelcontextprotocol/sdk` — Python `mcp` SDK 의 대응 패키지.

- **`name` 정규식 강제**: `mcp__<server>__<tool>` 정렬 키와 충돌하지 않도록. 공백 / `__` injection 은 load-time reject
- Zod schema: `z.object({ ... }).strict()` — 오타 필드 load-time `ValidationError`
- transport 는 **`stdio`** 와 **`sse`** 두 가지만. 새 transport 추가 시 enum + connect 분기 동시 업데이트

## Registry 로드 순서

`loadRegistry(path)` 해석 순서:

1. 명시 `path` 인자
2. `APP_MCP_REGISTRY` env var 경로
3. 기본값: `services/mcp/registry.json`

파일 없으면 빈 `MCPRegistry()` 반환 — **MCP 는 opt-in**. registry.json 이 repo 에 commit 되지 않는 것이 기본.

## `${VAR}` 치환 정책 (caller 별 차별)

- **MCP**: `substituteEnv(env, { onMissing: 'empty' })` — 누락 var → empty string (POSIX subprocess env convention)
- **providers.yaml**: `raise` (credential fail-fast)
- **runs/*.yaml**: `keep_placeholder` (오타 surface)

→ caller 별 정책 차이 의도적. MCP 는 spawn 된 subprocess 가 env 누락을 자체 판단.

## 5-State 연결 관리

```
ConnectionState = disabled | pending | connected | needs_auth | failed
```

전이표:

```
disabled ↔ pending      (config toggle)
pending → connected     (initialize handshake 성공)
pending → needs_auth    (server 가 auth-required 응답)
pending → failed        (transport / handshake / timeout)
connected → failed      (call error past retry budget)
any → disabled          (admin-disable or lifespan shutdown)
```

- 전이는 `setState()` **한 곳 경유** — 모든 변경이 `mcp.state_transition` 로그로 관측됨
- timeouts: `CONNECT_TIMEOUT_SEC = 30`, `CALL_TIMEOUT_SEC = 60`

## Lazy Reconnection

- 연결 끊기면 memoized 캐시 (`_toolsCache`) 무효화, 다음 tool call 이 새 연결 트리거
- **백그라운드 polling 금지** — 재연결은 항상 on-demand
- 이유: MCP 서버가 off 인 상태에서 polling 은 리소스 낭비 + 로그 노이즈

## 독립 연결 (서버 격리)

- 각 `MCPClient` 인스턴스는 독립
- 한 서버 실패가 다른 서버를 차단하지 않음
- bridge 의 `registerAllMcpTools` 가 per-server try/catch 로 격리 — 한 서버 connect 실패 시 WARNING 로그 + 해당 서버 skip, 나머지 계속

## 도구 등록

- MCP tool 은 bridge 의 `makeMcpTool` 가 `ToolProtocol` interface 로 래핑 → `ToolRegistry.register` 로 내장 도구와 **동일 경로** 등록
- 등록 시점: 부팅 시 `ToolRegistry.freeze()` 전에 완료. **런타임 추가 금지**
- input schema 변환: MCP `inputSchema` (JSON Schema) → 내부 타입
  - TS: `zod` 스키마로 변환 또는 `z.unknown()` fallback + WARNING 로그
- `anyOf` / `oneOf` / `$ref` / `allOf` 같은 복잡 구조 → `z.unknown()` 로 fallback + WARNING 로그

## 대형 출력 처리

- MCP tool 결과도 내장 도구와 **동일한 head-truncate preview** (`TOOL_PREVIEW_MAX_CHARS=4000`, `skills/tool-sort-order/SKILL.md`)
- MCP 전용 disk-spill 경로는 미구현 — `mcp__<server>__fetch_full` 같은 보조 도구 패턴은 future enhancement
- 토큰 상한 초과 시 truncated payload 가 그대로 모델에 반환

## Server Instructions (현재 미구현)

- 개별 MCP server 가 반환하는 `instructions` 필드를 세션 system prompt 에 delta 로 주입하는 기능은 **현재 미구현**
- MCP SDK 의 `ClientSession` 이 initialize 응답에서 instructions 를 받지만, bridge / loop 이 이를 프롬프트에 연결하는 경로 없음
- `skills/compaction-thresholds/SKILL.md` Post-Compact 재주입 대상에 "MCP server instructions (delta)" 가 **aspirational target** 으로 기재
- 구현 시 "매 턴 full 전송 금지 — delta 만 전송" 원칙 유지 (prompt cache 보호)

## 연결 종료

- `MCPClient.close()` 는 **LIFO unwind** — transport + session async context 가 역순으로 cleanup
  - TS: `AsyncDisposable` 패턴 또는 명시적 `try/finally` unwind
- 진행 중 tool call 은 SDK 쪽에서 cancel 처리 (Promise cancellation 또는 AbortController 전파)
- `close()` 는 **idempotent** — 이미 닫힌 상태에서 재호출 안전

## 모듈 구조

| 책임 | 파일 |
|------|------|
| `MCPServerConfig` + `MCPRegistry` + `loadRegistry` + `resolveEnvVars` | `config.ts` |
| `MCPClient` (단일 서버 세션) + `ConnectionState` | `client.ts` |
| `registerAllMcpTools` — MCP tool → `ToolProtocol` 변환 + 등록 | `bridge.ts` |

## 공통 금지 사항 (언어 무관)

- `mcp__<server>__<tool>` 네이밍 규칙 우회 (정렬 키 / 충돌 방지 위반)
- `MCPServerConfig.name` 패턴 검증 우회한 직접 인스턴스 생성 (Field 가 강제 — modelValidate / deserialize 경유 필수)
- MCP 도구를 `ToolRegistry` 우회한 직접 등록 (정렬 무효화 + prompt cache prefix 오염)
- 서버 설정에 시크릿 하드코드 (반드시 `${VAR}` + `.env` / secret store)
- 한 서버 connect 실패가 다른 서버를 차단하도록 bridge 로직 변경 (독립 연결 원칙 위반)
- 백그라운드 polling 기반 재연결 (lazy 원칙 위반, 리소스 낭비)
- `ToolRegistry.freeze()` 이후 런타임에 MCP 도구 추가/제거 (정렬 prefix 재계산 → 캐시 무효화)
- `setState()` 우회한 직접 state 할당 (관측 누락)
- `${VAR}` 치환을 caller 별 정책 (`raise` / `keep_placeholder` / `empty`) 혼동
- Server instructions 를 매 턴 full 전송 (미래 구현 시 — prompt cache 보호, delta 만)
- `mcp_server` 가 engine / routes import (edge adapter cross-import 금지 — `skills/single-writer/SKILL.md` data layer 와 동급의 boundary)
