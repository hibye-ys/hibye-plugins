> Language-neutral invariants — Compaction stage order, thresholds, post-compact re-inject, tool output boundary.
> 정본 (single source of truth) for both Python and Rust harnesses.
> Cited from: `python_agent_rules/compaction-patterns.md`, `rust_agent_rules/compaction-patterns.md`.

# Compaction — 언어 무관 불변식

## 4-Stage Escalation (순서 고정, 변경 금지)

비용 순서대로 escalate. 각 stage 가 target 에 도달하면 즉시 return.

| 순서 | 전략 | 동작 | LLM 호출 | 비용 |
|------|------|------|----------|------|
| 1 | `snip` | 오래된 tool_result 를 `SNIP_LIMIT_CHARS=200` 으로 head-truncate | 없음 | ~0 (string slice) |
| 2 | `micro` | 오래된 메시지 chunk 를 요약 LLM 으로 압축 | **있음** | 낮음 (Haiku, chunk 별) |
| 3 | `session_memory` | 세션 메모리 항목 중 predicate 매칭만 제거 | 없음 | ~0 (predicate filter) |
| 4 | `auto` | 전체 대화를 chunk 단위로 묶어 요약 | **있음** | 높음 (Haiku, 전체) |

오케스트레이터 시그니처: `compact_messages(messages, summarizer, threshold, memory_predicate)`.

전략 식별자 5종: `snip`, `micro`, `session_memory`, `auto`, `reactive`. 5번째 `reactive` 는 **Error Recovery 경로 전용** (아래 §Reactive 참조).

## 핵심 상수 (모든 언어 동일)

| 상수 | 값 | 의미 |
|------|----|------|
| `SNIP_LIMIT_CHARS` | 200 | snip stage 의 head-truncate 길이 |
| `ESCALATION_TARGET_RATIO` | 0.80 | 각 stage 의 중단 조건 = `threshold × 0.80` 이하. 재트리거 가드 |
| `REACTIVE_TARGET_RATIO` | 0.70 | reactive stage 는 escalation 보다 공격적 |
| `SAFETY_BUFFER` | 13_000 | 요약 LLM 여유 + 한 턴 분량 + α |
| `EFFECTIVE_CONTEXT_WINDOW` | 200_000 | 기준 모델 (Claude 200K). 비-200K 는 `TokenBudget.for_model()` 가 별개 스케일 |
| `MAX_PTL_RETRIES` | 3 | Compaction 자체가 prompt-too-long 시 oldest group 삭제 후 재시도 한계 |
| `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` | 3 | 연속 실패 한계. 초과 시 상위로 에러 전파 |
| `INTERNAL_MODEL` | `"claude-haiku-4-5"` | 요약 LLM 하드코드. fallback chain 과 **완전 분리** |
| `COMPACTED_MARKER` | `"[COMPACTED]"` | 멱등성 식별자 prefix |

`auto_compact_threshold()` 는 `APP_AUTOCOMPACT_THRESHOLD` env 로 override 가능 (개발/튜닝용).

```
threshold = EFFECTIVE_CONTEXT_WINDOW - SAFETY_BUFFER = 187_000 (≈ 93.5%)
```

## Re-trigger Guard (`ESCALATION_TARGET_RATIO`)

- 각 stage 의 중단 조건은 "threshold 이하" 가 아니라 **`threshold × 0.80` 이하**
- 이유: threshold 바로 아래까지만 줄이면 다음 턴 한 두 번에 또 초과 → 재트리거 → 맥락 손실 누적
- 0.80 → 다음 5~10턴 여유 확보 (한 턴 입력 평균 5~10K 가정)

## 안전 규칙 (전 stage 공통)

- `system` message 는 SNIP 대상에서 **제외** — Layer 1/2 지시 소실 방지
- `compacted=true` 멱등성: 이미 처리된 블록은 `COMPACTED_MARKER` prefix 로 식별 후 재처리 skip
- Compaction 자체가 PTL 시 **oldest group 삭제 후 재시도** — 최대 `MAX_PTL_RETRIES=3` 회
- `auto_compact` 연속 실패는 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3` 회까지 — 초과 시 상위로 에러 전파
- Compaction 은 **턴당 1회** — 같은 턴에서 재실행 금지 (lossy 누적 방지)

## Post-compact 재주입 의무

Compaction 후 messages 가 축소되면서 **대화 밖 참조** 도 함께 사라진다. Stage 1 재실행 시 예산 내에서 재주입:

- 최근 read 파일 (최신 N개)
- 활성 skill
- 현재 plan
- deferred tools 스키마 (요청된 것)
- MCP server instructions (delta)
- agent 목록 (coordinator 에만 — worker 는 spawn 권한 없음)

**전체 skill listing 은 재주입 안 함** — 설치된 모든 skill 이름 나열은 토큰 낭비. 모델은 `Skill` 도구로 필요 시 검색 가능 (design-principles §7 partial loading).

## 요약 LLM (summarizer) 구현

- **모델 하드코드**: `INTERNAL_MODEL = "claude-haiku-4-5"`. Sonnet 대비 ~10배 저렴. fallback chain 과 **완전 분리** — 사용자 요청 chain 이 Sonnet/Opus 여도 compaction 은 항상 Haiku 직행
- **호출 파라미터** (고정):
  - `tools=[]`, `max_tokens=1024`, `temperature=0.0`, `stream=true`
  - system prompt: `"You are a precise conversation summarizer. Output only the summary text — no preamble, no closing remarks."`
- **Cancel 안전**: 요약 중 cancel → 부분 결과 폐기 + 에러 재전파. 잘린 요약이 messages 에 들어가면 맥락 오염
- **사용 stage**: `micro` + `auto` + `reactive`. `snip` 과 `session_memory` 는 summarizer 사용 안 함

## Reactive 전략 (5번째 — Error Recovery 전용)

`compact_messages()` 의 4-stage 에는 포함되지 않지만, **Prompt-Too-Long 복구** 경로에서 사용:

- 트리거: Stage 1 compaction 후에도 provider 호출이 PTL 반환 (토큰 추정 오차 / 갑자기 커진 tool_result / 이미지·PDF 부가 토큰)
- 함수: `reactive_compact(messages, summarizer, ...)` (strategy=`reactive`)
- target: `threshold * REACTIVE_TARGET_RATIO` (= 0.70) — escalation 보다 공격적으로 축소
- 방식: oldest group drop + 요약 혼합

## Tool Output Boundary Preservation

Stage 5 가 모든 tool_result content 를 `<tool_output>...</tool_output>` 으로 감싸기 시작하면서 (indirect injection 방어), compaction 의 4 stage 가 그 envelope 를 부수지 않도록 유지해야 한다.

**핵심 불변식:**

- `is_compacted` / `_is_compacted` 는 `strip_outer_wrap` 후 `COMPACTED_MARKER` 검사 — wrap 된 block 도 멱등성 인식
- `snip_compact` 는 strip → truncate → `wrap_tool_output_text` 로 재포장 — close tag 잘림 방지
  결과: `<tool_output>\n[COMPACTED] inner...\n</tool_output>`
- `reactive_compact` step 3 (last resort placeholder) 도 동일 wrap 적용
  결과: `<tool_output>\n[COMPACTED] [output omitted — tool_use_id: ...]\n</tool_output>`
- `SUMMARIZER_SAFETY_PREAMBLE` 상수가 micro / auto chunk / reactive mega 의 3 prompt 모두에 prepend — summarizer LLM 이 tool output 안의 instruction 을 따르지 않게 강제. base.md 의 defensive block 과 동일 톤
- Tag 이름 (`<tool_output>`) 은 `tool_output_guard` 모듈의 `TOOL_OUTPUT_OPEN` / `TOOL_OUTPUT_CLOSE` 단일 source. 변경 시 base.md defensive block + 본 정본 + 모든 helper 동시 갱신

## 공통 금지 사항 (언어 무관)

- 4-stage 순서 재배치 (저렴한 것부터 원칙 위반 — design-principles §2)
- `system` message 를 SNIP / MICRO / AUTO 대상에 포함 (기본 지시 소실)
- LLM 호출 stage (MICRO / AUTO / REACTIVE) 를 SNIP / SESSION_MEMORY 이전에 시도 (비용 낭비)
- 같은 턴에서 compaction 재실행 (lossy 누적)
- `threshold` 바로 아래로만 축소하고 중단 (재트리거 가드 우회)
- post-compact 재주입 항목 생략 (최근 read 파일 / 활성 skill / plan / deferred tools / MCP instructions / agent listing)
- 전체 skill listing 을 post-compact 재주입 (토큰 낭비, partial loading 원칙 위반)
- `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` 카운터 없이 무한 재시도
- summarizer 의 부분 결과 (cancel 중단분) 를 messages 에 저장
- `INTERNAL_MODEL` 을 fallback chain 에 연결 (사용자 대화 모델과 혼용 금지)
- `COMPACTED_MARKER` 없이 요약본 append (재처리 루프 위험)
- snip 에서 wrap 통째 truncate (close tag 잘림 → boundary 파괴)
- reactive placeholder 를 bare string 으로 emit (wrap 없이 message 진입 — 재트리거 시 모델이 instruction 으로 해석)
- summarizer prompt 에서 `SUMMARIZER_SAFETY_PREAMBLE` 생략 (summarizer LLM 이 injection 에 노출)
- compaction 결과의 derived tool_result content 가 wrap 없이 message 로 진입
