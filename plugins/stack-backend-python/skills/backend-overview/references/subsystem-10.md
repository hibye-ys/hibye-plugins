> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/mcp-patterns.md` + live implementation under `backend/services/mcp/`.

# Subsystem 10 — MCP Integration

## 목적 (1줄)

Model Context Protocol 서버를 연결하여 외부 도구를 에이전트 도구셋에 런타임 추가.

## 파일 / 모듈

- `backend/services/mcp/client.py` — MCP 서버 연결 + 도구 스키마 로드
- `backend/services/mcp/bridge.py` — MCP 도구 → 내부 Tool 프로토콜 어댑터
- `backend/services/mcp/config.py` — MCP 서버 설정 (URL, 인증)
- `backend/routes/mcp.py` — `/ai/mcp/servers/*` CRUD 엔드포인트

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `McpClient` | 서버와 JSON-RPC 연결, tool schema 조회 |
| `McpToolBridge(mcp_tool)` | MCP 도구를 내부 `Tool` 프로토콜로 래핑 |
| `McpConfig` | 서버 URL, 인증, timeout, 허용 도구 목록 |
| `register_mcp_tools(registry, server_id)` | 로드 후 ToolRegistry에 동적 등록 |
| `McpServer` | id, name, url, status, last_ping_at |

## 용도

- 외부 DB 조회 도구 (Supabase, Notion 등)
- 웹 검색 도구
- 이미지 생성 도구
- 사용자 커스텀 도구 서버

## 흐름

```
1. POST /ai/mcp/servers  → 서버 등록
2. McpClient가 MCP 서버에 initialize
3. tools/list 조회 → McpToolBridge로 래핑
4. ToolRegistry에 동적 등록
5. 에이전트가 일반 도구와 동일하게 사용
6. 서버 해제 시 → 등록된 도구 제거
```

## 담당 skill

`mcp-integration`

## 범위

**미구현**. 에서 추가.

## Gotchas (예상)

- **MCP 도구 스키마 변경**: 외부 서버의 스키마가 바뀌면 기존 세션의 도구 정의와
  불일치. 런타임 감지 필요.
- **권한 검증**: 사용자가 등록한 MCP 서버는 `UserPermissions.allowed_tools`
  제한을 받아야 한다.
- **timeout + circuit breaker**: 외부 서버 응답 지연이 전체 에이전트 루프를 막지
  않도록 timeout + 빠른 실패.

## 관련 AD

- multi-provider (멀티 프로바이더) — 도구도 다양한 소스에서 동적으로 확장
- system prompt caching (샌드박싱) — 외부 도구가 임의 동작을 하지 못하도록 제약
