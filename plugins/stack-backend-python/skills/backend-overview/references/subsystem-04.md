> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/sub-agent-patterns.md` + live implementation at `backend/tools/agents.py` + `backend/engine/subagent.py`.

# Subsystem 04 — Sub-agent Spawn

## 목적 (1줄)

메인 에이전트가 다른 전문 에이전트를 "도구처럼" 호출하여 태스크를 위임하는 구조.

## 파일 / 모듈

- `backend/tools/agents.py` — `spawn_agent` tool (Tool Protocol 구현)
- `backend/engine/subagent.py` — 독립 루프 생성 + 격리된 컨텍스트 + 결과 반환

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `spawn_agent(agent_name, prompt, context_hint?, mode?)` | 도구. foreground/background 모드 지정 |
| `run_subagent_loop(parent_ctx, agent_name, task)` | 서브에이전트 독립 루프 실행 |
| `SubagentResult` | `text`, `actions`, `usage`, `messages` (전문 포함 선택) |
| `ChainDepth` | 서브에이전트 중첩 깊이 추적 |

## 실행 모드

| 모드 | 설명 | 용도 |
|---|---|---|
| **foreground** | 결과를 기다려서 부모 에이전트에 반환 | 순차 위임 (검증 결과 필요 후 생성) |
| **background** | 비동기 실행, 완료 시 SSE notification | 병렬 위임 (여러 검증 동시) |

## 격리 보장

- 독립 메시지 히스토리 (부모 컨텍스트 오염 방지)
- 독립 tool_use 루프
- 결과만 부모에게 반환 (요약 또는 전문)
- 자체 모델/프로바이더 사용 가능 (에이전트별 model_preference)

## Depth 제한

- `max_depth=3` 기본. 서브에이전트가 다시 서브에이전트를 호출하는 연쇄 제한.
- `engine/loop.py`의 `LoopState.chain_depth`가 추적.
- 초과 시 `spawn_agent`는 tool 에러 반환, LLM이 대안 모색.

## Background 생명주기

1. `spawn_agent(background=True)` → 태스크 생성 (`state/task.py`)
2. 서브에이전트가 독립 루프에서 실행 (`asyncio.create_task`)
3. 완료 시 → 결과를 세션 inbox에 저장
4. 부모 세션에 SSE `event: notification` 전달 (스트림 열려 있으면)
5. 다음 `POST /run/<name>` 시 inbox 내용을 자동으로 messages에 주입

## 담당 skill

`sub-agent-spawn`

## 범위

- **미구현**. 메인 에이전트 1개로만 동작.
- 현재 spawn_agent 도구 + `engine/subagent.py` 추가.

## Gotchas

- **parent cancellation propagation**: 부모 loop가 abort되면 background subagent도
  abort 시그널을 받아야 한다. 좀비 태스크 방지.
- **chain_depth는 ToolContext에 주입**: 단순 global counter 금지 (session 간 교차).
- **background 결과 미전달**: inbox에 쌓였지만 다음 요청이 안 오면 알림 누락 →
  수동 조회 API (`GET /ai/sessions/{id}/inbox`) 필요.

## 관련 AD

- Protocol DI (L1~L3 현재) — 본 서브시스템은 L4로 가는 다리. 에서 활성화
- session store Protocol (인메모리 세션) — background 결과 저장처가 세션. Redis 전환 대상
