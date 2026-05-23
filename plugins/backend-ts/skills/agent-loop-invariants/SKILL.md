---
name: agent-loop-invariants
description: Agent loop 6-stage 순서 (Context Prep → Model Call → Error Recovery → Tool Exec → Context Merge → Loop Decision), LoopTransition 8종 invariant. Stage 순서 변경 금지.
metadata:
  role: invariant
  scope: project
---

**적용된 §4.4 매트릭스 행**: 비동기 (async def → async function), 동시성 (asyncio.gather → Promise.all), 루프 (while True → while (true)), 최상위 (asyncio.run → top-level await)

> Language-neutral invariants — Agent Loop 6-stage order, LoopTransition enum, Error Recovery strategy.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/agent-loop-patterns.md`, `ts_agent_rules/agent-loop-patterns.md`.

# Agent Loop Invariants — 언어 무관 불변식

(slug: `agent-loop-invariants` — workflow 의 `agent-loop` 와 구분)

## 6-Stage 구조 (순서 고정, 변경 금지)

```
Stage 1: Context Preparation — compaction 판정 + attachment 수집
Stage 2: Model Call — provider streaming
Stage 3: Error Recovery — prompt-too-long / max-output-tokens
Stage 4: Tool Execution — partition → parallel/sequential batch
Stage 5: Context Merge — tool result + supplementary context
Stage 6: Loop Decision — continue/terminate + transition 기록
```

- 각 stage 는 독립 함수로 분리 (TS `async function stage1_contextPrep(...)`). stage 간 데이터는 `LoopState` 객체로 전달
- 핵심 의존성은 `LoopDeps` interface 로 주입. 메서드 이름은 코드 기준: `providerCall`, `compact`, `uuid`, `lookupTool`, `toolDefinitions`, `countTokens`, `trace`
- `RunPolicyLike` interface: 루프는 구체 `RunPolicy` 대신 structural interface 로 참조 — import cycle 회피 + 테스트 mock 주입 용이. 루프가 읽는 필드는 4개 (`name`, `max_turns`, `compaction_enabled`, `response_schema`)

## LoopTransition enum (8종, 순서 고정)

매 iteration 종료 시 반드시 `LoopTransition` 기록. **기록 없는 종료 금지**.

| 값 | Terminal? | 의미 |
|----|-----------|------|
| `completed` | ✓ | 정상 종료 (assistant message 완성) |
| `aborted` | ✓ | abort signal cascade |
| `max_turns` | ✓ | 강제 종료 상한 도달 |
| `prompt_too_long` | ✓ | PTL 복구 실패 후 종료 |
| `model_error` | ✓ | provider 호출 실패 (재시도 소진) |
| `hook_stopped` | ✓ | pre/post hook 가 stop 결정 |
| `tool_error` | ✓ | 도구 실패 — 모델에 반환 후 별도 종료 시그널 |
| `continuing` | ✗ | 다음 iteration 진행 |

`continuing` 만 non-terminal. 나머지 7종은 terminal.

## Stage 별 핵심 불변

### Stage 1 — Context Preparation
- compaction 트리거 판정 (token budget vs threshold)
- attachment 수집 (고정 순서, prefix cache 보호 — `skills/token-budget-constants/SKILL.md`)
- 결과: `AssembledContext = (system_prompt, messages, tools, generation_params)` — 불변, Stage 2+ 는 read-only

### Stage 2 — Model Call
- provider streaming 호출
- 내부 타입 (`Message`, `ContentBlock`) 으로 전파 — SDK 타입은 provider 경계에서 변환

### Stage 3 — Error Recovery (순서 고정)
- **prompt-too-long**: context collapse → reactive compact → terminate. target ratio = `REACTIVE_TARGET_RATIO=0.70` (`skills/compaction-thresholds/SKILL.md`)
- **max-output-tokens**: token 확대 → nudge message → terminate (재시도 횟수는 코드 상수)

### Stage 4 — Tool Execution
- partition 기반: 연속 concurrent-safe → parallel batch (`Promise.all`), non-safe → sequential
- `isConcurrencySafe(args)` 입력 기반 동적 결정 (`skills/tool-sort-order/SKILL.md`)
- parallel batch 최대 동시 실행 수는 코드 상수 (rule 은 패턴만)
- 도구 에러는 모델에게 반환 — 자동 재시도 금지 (design-principles §5)

### Stage 5 — Context Merge
- tool_result content 는 `wrapToolOutput` 으로 `<tool_output>...</tool_output>` 감싸짐 — indirect injection 방어
- tool_result 가 예산을 초과하면 **루프 내부에서 재-compaction** 트리거 — 다음 iteration 전에 token 회수

### Stage 6 — Loop Decision
- continue/terminate 판정
- `LoopTransition` 기록 (관측성 필수)
- abort signal / max_turns / hook stop / tool error / model error 분기

TS 루프 기본 골격:

```ts
async function agentLoop(state: LoopState, deps: LoopDeps): Promise<LoopResult> {
  while (true) {
    const ctx = await stage1_contextPrep(state, deps);
    const response = await stage2_modelCall(ctx, deps);
    const recovered = await stage3_errorRecovery(response, state, deps);
    if (recovered.terminate) break;
    const toolResults = await stage4_toolExecution(recovered.toolCalls, deps);
    state = await stage5_contextMerge(state, toolResults, deps);
    const decision = stage6_loopDecision(state, deps);
    deps.trace({ transition: decision.transition });
    if (decision.terminal) break;
  }
}
```

## 새 stage / 확장

현재 6-stage 는 고정. 각 stage 내부 확장만 허용:

1. **Stage 1 에 새 attachment 타입**: collector 등록. 변경 빈도 기준 위치 (`skills/token-budget-constants/SKILL.md`)
2. **Stage 4 에 새 hook**: pre_tool_use / post_tool_use chain 등록
3. **Stage 6 에 새 종료 조건**: `LoopTransition` 에 먼저 값 추가 → 판정 로직에 분기
4. **새 LoopDeps 의존성**: interface 메서드 추가 → production + test mock 동시 업데이트

## 공통 금지 사항 (언어 무관)

- 6-stage 순서 변경 또는 stage 병합 (loop invariant 파괴)
- `LoopState` 를 stage 경계 밖에서 직접 mutate (stage 내에서만 변경, 전달은 return)
- 도구 에러를 자동 재시도 (design-principles §5 — 구조화된 에러를 모델 반환)
- `LoopTransition` 기록 없이 종료 (관측성 누락)
- Stage 4 tool 실행 시 `isConcurrencySafe` 체크 생략 후 parallel batch 실행
- Recovery 분기 (prompt-too-long, max-output-tokens) 에서 무한 재시도
- engine/loop 에서 provider SDK 타입 직접 사용 (unified Message/ContentBlock 경계 위반)
- Stage 1 산출물 `AssembledContext` 를 Stage 2 이후에 mutate
