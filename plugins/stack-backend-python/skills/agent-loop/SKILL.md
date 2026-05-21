---
name: agent-loop
description: "REQUIRED for backend/engine/loop.py and recovery.py — without this skill you WILL miss the LoopState dataclass, the 4 typed error branches, the is_concurrency_safe partitioning, and the compaction check stage. Load BEFORE writing any loop code. Also covers tool_use infinite-loop prevention, budget exhaustion, and recovery branch patterns."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (non-negotiable — baseline misses ALL of these)
1. MUST define `class LoopState` dataclass for loop-local state (NEVER store in message array)
2. MUST have 4 typed except branches: `RateLimitError`, `PromptTooLongError`, `MaxOutputTokensError`, `ProviderError`
3. MUST call `is_concurrency_safe(args)` to partition tools into parallel/sequential
4. MUST include compaction check stage (even as stub in )
5. System prompt built ONCE before loop, not per-turn

# agent-loop — Agent Loop 서브시스템 구조 청사진

## 이 skill은 언제 로드되는가
- `backend/engine/loop.py`, `backend/engine/recovery.py` 최초 작성
- 위 파일을 수정 (상태 추가, 에러 분기 추가, 토큰 관리 변경)
- "tool_use 무한 루프", "budget 이상 동작", "복구 분기가 안 탐" 같은 디버깅

## Agent Loop의 정체성

Agent Loop는 하나의 사용자 요청을 받아 다음을 반복한다:

1. 컨텍스트 조립 (system prompt + history + tool definitions)
2. 프로바이더 호출 (LLM 응답 수집)
3. tool_use 수집 (assistant 메시지에서 tool 호출 블록 추출)
4. tool 실행 (안전한 것은 병렬, 아닌 것은 순차)
5. tool 결과를 대화에 병합
6. "계속할지/끝낼지" 판단
7. 완료 또는 루프 재진입

이 7단계가 `loop.py`의 뼈대다. 7단계를 벗어나는 로직 (예: 사전 계획 수립,
post-hoc 검증)은 별도 모듈에 두고 loop는 순수하게 이 흐름만 돈다.

## 7단계 상세

### Stage 1 — 컨텍스트 조립 (pre-query)
- 입력: 현재 대화 히스토리 + agent spec + user input
- 출력: provider에 보낼 message 배열 + system prompt
- 모듈: `backend/engine/context.py::assemble_context` 호출
- 주의: system prompt는 매 루프 재생성하지 않고 루프 시작 시 한 번만 생성 (캐시 적중률)

### Stage 2 — 컴팩션 체크 (pre-query)
- 입력: 조립된 message 배열 + 현재 토큰 수 추정
- 판단: `token_count > effective_context_window - 13000` 이면 컴팩션 필요
- 분기: 컴팩션 필요 → `backend/engine/compaction.py::compact_messages` 호출 후 Stage 1 재실행
- ** 스코프**: 컴팩션 구현 자체는 H2 이후. 현재는 "임계값 초과 시 log + raise"로 stub
- 주의: 버퍼 13000은 단일 assistant turn의 최대 출력 토큰 + 안전 여유

### Stage 3 — 프로바이더 호출 (query)
- 입력: message 배열 + tool definitions + model + generation params
- 출력: async stream of provider events (text delta, tool_use, reasoning 등)
- 모듈: `backend/providers/{name}.py::call_stream` (현재는 Anthropic 단일)
- 주의: 이 단계가 가장 느림. 스트림을 소비자에게 즉시 전달하되 내부적으로는 완전 수집 후 다음 단계 진행

### Stage 4 — tool_use 수집
- 입력: 완전 수집된 assistant message
- 출력: `[(tool_name, tool_input), ...]` 리스트
- 빈 리스트 → Stage 7 (완료)
- 비어있지 않음 → Stage 5 계속

### Stage 5 — tool 실행 (병렬/순차 파티셔닝)
- 입력: tool_use 리스트 + tool registry
- 각 tool에 대해 `tool.is_concurrency_safe(input)` 호출
- True 그룹 → `asyncio.gather(..., return_exceptions=True)`로 병렬 실행
- False 그룹 → 순차 실행 (`for` 루프)
- 출력: `[(tool_use_id, result_or_error), ...]`
- 주의: 순서 보존 — 원본 tool_use 배열 순서대로 결과 배열이 정렬돼야 한다

### Stage 6 — 결과 병합
- 입력: tool 실행 결과
- 동작: 각 결과를 `{"type": "tool_result", "tool_use_id": ..., "content": ...}` 형태로
  user message content에 append
- 에러 결과는 `is_error=True` 플래그와 함께 포함 (LLM이 다음 턴에 에러 인지)
- 출력: 업데이트된 대화 히스토리

### Stage 7 — 계속/완료 판단
- 조건:
  - 누적 turn 수 > `max_turns` → 강제 종료 (budget exhaustion)
  - tool_use 없었음 → 정상 완료
  - recovery 플래그 설정됨 (예: max_output_tokens 재시도) → Stage 1 재진입
- 완료 → `done` 이벤트 yield 후 return
- 재진입 → Stage 1로 goto

## 루프-로컬 상태 (배열 밖 유지)

이 상태들은 **메시지 배열에 섞이면 안 된다**. 지역 변수 또는 dataclass 인스턴스로
루프 함수 내부에 유지:

```python
@dataclass
class LoopState:
    task_budget_remaining: int          # 남은 turn 수
    chain_depth: int                    # 서브에이전트 중첩 깊이
    autocompact_tracking: CompactTracker # 컴팩션 이력
    reactive_compact_state: ReactiveCompactState  # 반응적 컴팩션 상태
    turn_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
```

**이유**: 이 상태들이 메시지 배열에 들어가면 컴팩션 시 요약되어 사라지거나
부정확해진다. 또한 LLM이 자기 이전 turn의 budget을 볼 필요가 없다
(프롬프트 오염 방지).

## 동시성 함정 — 이 서브시스템 고유

이 세 함정은 Agent Loop 구현에서 반복적으로 나타나며, Python의 일반적인
asyncio 지식만으로는 잡히지 않는다. 코드 리뷰 시 먼저 이 세 개를 체크한다.

1. **루프-로컬 상태 유지**: Agent Loop의 budget 카운터, chain depth, autocompact
   tracking은 메시지 배열 바깥 루프 로컬 변수로 유지한다. 상태를 메시지 배열에
   섞으면 컴팩션 시 사라진다. 이게 이 서브시스템 가장 큰 함정이다.

2. **contextModifier 큐잉**: 컨텍스트 수정 훅은 메인 루프를 블록하면 안 된다.
   `asyncio.Queue`로 주입하고 메인 루프는 async iterator로 소비한다. 훅이
   동기적으로 컨텍스트를 수정하게 허용하면 long-running 훅이 루프를 멈춘다.

3. **포그라운드 vs 백그라운드 재시도**: 사용자가 기다리는 포그라운드 호출은
   공격적 재시도 (짧은 백오프, 재시도 횟수 많음), 백그라운드 작업은 소극적
   재시도 (긴 백오프, 포기 빠름). 같은 재시도 정책을 쓰면 사용자 경험과
   비용 양쪽 다 나빠진다.

## 에러 복구 분기

`recovery.py`가 담당. 각 분기는 loop에서 명시적으로 처리:

| 에러 유형             | 감지                                                          | 복구                                                          |
|-----------------------|---------------------------------------------------------------|---------------------------------------------------------------|
| `RateLimitError`      | Provider API 응답 `status == 429`                             | 지수 백오프 + 재시도. `budget -= 1`                           |
| `PromptTooLongError`  | Provider 응답 `status == 400 && message includes "prompt too long"` | 강제 컴팩션 → Stage 1 재진입                          |
| `MaxOutputTokensError`| Provider 응답 `stop_reason == "max_tokens"`                   | 토큰 한도 증가 후 동일 query 재시도 (1회만)                   |
| `ProviderError` (기타)| 위 3개에 속하지 않는 provider 예외                            | 로그 + fail — 사용자에게 에러 yield                           |
| `ToolExecutionError`  | Stage 5에서 특정 tool이 던진 예외                             | tool_result에 `is_error=True`로 병합 (LLM이 다음 턴에 복구 시도) |

**원칙**: 에러 복구는 **분기**이지 **루프 밖 catch**가 아니다. 각 복구 경로는
명시적 branch로 코드에 나타나야 디버깅이 가능하다.

## Python 스켈레톤 (뼈대)

```python
# backend/engine/loop.py
"""Agent execution loop — 7-stage pipeline."""

import asyncio
from dataclasses import dataclass, field
from typing import AsyncIterator

from backend.engine.context import assemble_context
from backend.engine.stream import Event, DoneEvent, ErrorEvent
from backend.engine.recovery import (
    RateLimitError, PromptTooLongError, MaxOutputTokensError,
    backoff_and_retry, force_compaction, increase_output_budget,
)
from backend.providers.registry import get_provider
from backend.tools.registry import ToolRegistry


@dataclass
class LoopState:
    task_budget_remaining: int
    chain_depth: int = 0
    turn_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0


async def run_agent_loop(
    agent_spec,
    user_input: str,
    history: list,
    *,
    max_turns: int = 30,
) -> AsyncIterator[Event]:
    """Main agent loop. Yields stream events for SSE transport."""
    state = LoopState(task_budget_remaining=max_turns)
    provider = get_provider(agent_spec.model)
    tools = ToolRegistry.filter_for_agent(agent_spec)

    # Stage 1: one-time system prompt
    ctx = assemble_context(agent_spec, user_input, history)
    system_prompt = ctx.system_prompt
    messages = ctx.messages

    while state.task_budget_remaining > 0:
        state.task_budget_remaining -= 1
        state.turn_count += 1

        # Stage 2: compaction check (stub for )
        if _needs_compaction(messages):
            # TODO(H2): replace stub with real compaction
            yield ErrorEvent(reason="compaction not implemented in ")
            return

        # Stage 3: provider call
        try:
            assistant_message = await _collect_stream(
                provider.call_stream(
                    system=system_prompt,
                    messages=messages,
                    tools=tools,
                ),
            )
        except RateLimitError as e:
            await backoff_and_retry(e)
            continue
        except PromptTooLongError:
            messages = await force_compaction(messages)
            continue
        except MaxOutputTokensError:
            increase_output_budget(provider)
            continue

        messages.append(assistant_message)

        # Stage 4: collect tool_use
        tool_uses = _extract_tool_uses(assistant_message)
        if not tool_uses:
            yield DoneEvent(turn_count=state.turn_count)
            return

        # Stage 5: execute tools (parallel/sequential partitioning)
        safe, unsafe = _partition_by_concurrency(tool_uses, tools)
        safe_results = await asyncio.gather(
            *(tools.execute(tu) for tu in safe),
            return_exceptions=True,
        )
        unsafe_results = []
        for tu in unsafe:
            try:
                unsafe_results.append(await tools.execute(tu))
            except Exception as e:
                unsafe_results.append(e)

        # Stage 6: merge results
        tool_result_message = _build_tool_result_message(
            tool_uses, safe_results + unsafe_results
        )
        messages.append(tool_result_message)

        # Stage 7: continue (loop)

    # Budget exhausted
    yield ErrorEvent(reason=f"max_turns {max_turns} exhausted")
```

> 위 스켈레톤은 뼈대다. 헬퍼 함수 (`_needs_compaction`, `_collect_stream`,
> `_extract_tool_uses`, `_partition_by_concurrency`, `_build_tool_result_message`)
> 는 TS 원본 구조와 불변식을 이해한 뒤 Python 관용으로 재작성한다.

## 검증 체크리스트

loop.py 초안이 완성되면 다음을 모두 만족해야 한다:

- [ ] 7단계가 코드에서 순서대로 식별됨 (주석 또는 함수 분리)
- [ ] `LoopState`가 메시지 배열 밖 지역 변수로 존재
- [ ] 4개 에러 복구 분기 (RateLimit / PromptTooLong / MaxOutputTokens / ProviderError)
      가 명시적 except 블록으로 존재
- [ ] `ToolExecutionError`는 tool_result에 `is_error=True`로 병합 (loop catch 아님)
- [ ] budget exhaustion (`max_turns`) 처리 존재
- [ ] pytest 스켈레톤 1개 이상 작성 (단일 tool_use 시나리오)
- [ ] `async def run_agent_loop`의 반환 타입이 `AsyncIterator[Event]`
- [ ] 본 skill의 "동시성 함정" 3개 항목이 코드에 반영됨

## 구현 중 막히면

- TS 원본 구조가 이해 안 가는 경우: 본 skill의 "동시성 함정" 섹션 재확인
- "이 상태를 어디 둬야 하지?" 판단: 메시지 배열에 섞이면 컴팩션 손상 → 지역 변수
- "tool_use 실행 순서가 중요한가?": 병렬 그룹은 gather, 순차 그룹은 for,
  결과는 원본 tool_use 배열 순서로 재정렬
- 위 가이드로도 해결 안 되면 stop and report — 개별 판단으로 새 패턴을 섞지 마라
