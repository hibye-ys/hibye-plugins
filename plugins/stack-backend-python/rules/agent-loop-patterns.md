---
paths:
  - "backend/engine/loop.py"
  - "backend/engine/recovery.py"
---

> App backend rules — Agent Loop invariants, extension guide, impact map.
> **정본:** `_shared/agent-loop.md` (6-stage 순서 / LoopTransition 8 enum / Error Recovery 순서 — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `compaction-patterns.md` (Stage 1), `tool-system-patterns.md` (Stage 4),
>       `sub-agent-patterns.md` (spawn), `ai-provider-patterns.md` (retry)

# agent-loop-patterns — 에이전트 루프

## 불변식 (Invariants)

**6-Stage 구조 (순서 고정, 변경 금지):**

```
Stage 1: Context Preparation — compaction 판정 + attachment 수집
Stage 2: Model Call — provider streaming
Stage 3: Error Recovery — prompt-too-long / max-output-tokens
Stage 4: Tool Execution — partition → parallel/sequential batch
Stage 5: Context Merge — tool result + supplementary context
Stage 6: Loop Decision — continue/terminate + transition 기록
```

- 각 stage 는 독립 메서드로 분리. stage 간 데이터는 `LoopState` 객체로 전달
- 핵심 의존성은 `LoopDeps` Protocol 로 주입. 메서드 이름은 코드 기준: `provider_call`, `compact`, `uuid`, `lookup_tool`, `tool_definitions`, `count_tokens`, `trace` 등
- **`RunPolicyLike` Protocol (`backend/engine/loop.py:130-138`)**: 루프는 구체 `RunPolicy` (pydantic) 대신 structural Protocol 로 참조 — import cycle 회피 + 테스트 `FakeLoopDeps` 주입 용이. 루프가 읽는 필드는 4개 (`name`, `max_turns`, `compaction_enabled`, `response_schema`). RunPolicy 에 필드가 추가돼도 루프 변경 없음
- 매 iteration 종료 시 반드시 `LoopTransition` enum 기록. 기록 없는 종료 금지
- `LoopTransition` 값 (8종, 코드 순서): `completed`, `aborted`, `max_turns`, `prompt_too_long`, `model_error`, `hook_stopped`, `tool_error`, `continuing`. `continuing` 만 non-terminal (다음 iteration), 나머지 7종은 terminal. `tool_error` 는 도구 실패로 모델에 반환되는 경로
- Stage 5 (Context Merge) 직후 tool_result 가 예산을 초과하면 **루프 내부에서 재-compaction** 트리거 — 다음 iteration 전에 token 회수
- Tool result content 는 `_wrap_tool_result_content` 로 `<tool_output>` 감싸짐 — indirect injection 방어. 상세: `tool-system-patterns.md` §Tool Output Guardrail
- 도구 실행은 partition 기반: 연속 concurrent-safe → parallel batch, non-safe → sequential
- parallel batch 최대 동시 실행 수는 코드에서 상수로 관리
- 도구 에러는 모델에게 반환 (자동 재시도 금지, design-principles §5)

**Error Recovery (순서 고정):**

- prompt-too-long: context collapse → reactive compact → terminate
- max-output-tokens: token 확대 → nudge message → terminate (재시도 횟수는 코드 상수)

## 새 Stage 추가 / Loop 확장하기

현재 6-stage 는 고정이지만, 각 stage 내부에서 확장은 가능:

1. **Stage 1 에 새 attachment 타입 추가**: `context.py` 의 attachment collector 에 등록. 수집 순서는 변경 빈도가 낮으면 앞쪽, 높으면 뒤쪽에 배치
2. **Stage 4 에 새 hook 추가**: pre_tool_use / post_tool_use hook 체인에 등록
3. **Stage 6 에 새 종료 조건 추가**: LoopTransition enum 에 먼저 값 추가 → 판정 로직에 분기 추가
4. **새 LoopDeps 의존성 추가**: Protocol 에 메서드 추가 → production + test mock 동시 업데이트

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| stage 순서 변경 | 전체 loop 동작 파괴 — 절대 금지 |
| LoopTransition 값 추가 | structlog 메트릭, 모니터링 대시보드, 클라이언트 에러 핸들링 |
| LoopDeps Protocol 변경 | 모든 production deps + 모든 test mock 동시 업데이트 |
| partition 로직 변경 | 도구 실행 순서 변경 → 부수 효과 순서에 의존하는 도구 주의 |
| attachment 수집 순서 변경 | prompt cache prefix 무효화 가능 |
| recovery 상수 변경 | compaction 동작에 영향 → compaction-patterns.md 상수와 정합성 확인 |

## 금지 사항

- 6-stage 순서 변경 또는 stage 병합 (loop invariant 파괴)
- `LoopState` 를 stage 경계 밖에서 직접 mutate (stage 내에서만 변경, 전달은 return)
- 도구 에러를 자동 재시도 (design-principles §5 — 구조화된 에러를 모델 반환)
- `LoopTransition` 기록 없이 종료 (관측성 누락)
- Stage 4 tool 실행 시 `is_concurrency_safe` 체크 생략 후 parallel batch 실행
- recovery 분기 (prompt-too-long, max-output-tokens) 에서 무한 재시도
- engine/loop.py 에서 provider SDK 타입 직접 사용 (unified Message/ContentBlock 경계 위반 — 내부 타입으로만 통신)
