---
paths:
  - "backend/engine/compaction.py"
---

> App backend rules — Compaction invariants, extension guide, impact map.
> **정본:** `_shared/compaction-thresholds.md` (4-stage 순서 / 모든 상수 / post-compact 재주입 / Tool Output Boundary — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `agent-loop-patterns.md` (Stage 1 판정 + Error Recovery reactive),
>       `design-principles.md` (§2 저렴한 것부터, §7 부분 로드),
>       `context-assembly-patterns.md` (post-compact 재주입 대상)

# compaction-patterns — 컨텍스트 압축

## 불변식 (Invariants)

### 4-Stage Escalation (순서 고정, 변경 금지)

| 순서 | 전략 | 함수 | LLM 호출 | 비용 |
|------|------|------|----------|------|
| 1 | `snip` — 오래된 tool_result 를 `_SNIP_LIMIT_CHARS=200` 으로 head-truncate | `snip_compact()` | 없음 | ~0 (string slice) |
| 2 | `micro` — 오래된 메시지 chunk 를 요약 LLM 으로 압축 | `micro_compact(summarizer=...)` | **있음** | 낮음 (Haiku, chunk 별) |
| 3 | `session_memory` — 세션 메모리 항목 중 predicate 매칭만 제거 | `session_memory_compact()` | 없음 | ~0 (predicate filter) |
| 4 | `auto` — 전체 대화를 chunk 단위로 묶어 요약 | `auto_compact(summarizer=...)` | **있음** | 높음 (Haiku, 전체) |

오케스트레이터: `compact_messages(messages, summarizer, threshold=None, memory_predicate=None)` (`backend/engine/compaction.py:642`). 각 stage 를 순차 실행하면서 target 에 도달하면 즉시 return.

**전략 식별자 위치**: Python enum 은 **존재하지 않음**. `CompactionResult.strategy: Literal["snip", "micro", "session_memory", "auto", "reactive"]` (`compaction.py:150`) 가 정본 — 5번째 `reactive` 는 Error Recovery 경로 전용 (아래 §Reactive 참조).

### Re-trigger Guard — `ESCALATION_TARGET_RATIO`

- 각 stage 의 중단 조건은 "threshold 이하" 가 아니라 **`threshold * ESCALATION_TARGET_RATIO` (= 0.80) 이하**
- 이유: threshold 바로 아래까지만 줄이면 다음 턴 한 두 번에 또 초과 → 재트리거 → 맥락 손실 누적
- 0.80 → 다음 5~10턴 여유 확보 (한 턴 입력 평균 5~10K 가정)
- 상수: `ESCALATION_TARGET_RATIO: float = 0.80` (`compaction.py:71`)

### 안전 규칙 (전 stage 공통)

- `system` message 는 SNIP 대상에서 **제외** — Layer 1/2 지시 소실 방지
- `compacted=True` 멱등성: 이미 처리된 블록은 `COMPACTED_MARKER` (`"[COMPACTED]"`) prefix 로 식별 후 재처리 skip
- Compaction 자체가 prompt-too-long 시 **oldest group 삭제 후 재시도** — 최대 `MAX_PTL_RETRIES=3` 회
- `autocompact` 연속 실패는 **`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3`** 회까지 — 초과 시 상위로 에러 전파 (호출 측 deps.compact wrapper 가 카운터 관리)
- Compaction 은 **턴당 1회** — 같은 턴에서 재실행 금지 (lossy 누적 방지)

### Post-compact 재주입 의무

Compaction 후 messages 배열이 축소되면서 **대화 밖 참조** 도 함께 사라진다. Stage 1 재실행 시 예산 내에서 재주입:

- 최근 read 파일 (최신 N개)
- 활성 skill
- 현재 plan
- deferred tools 스키마 (요청된 것)
- MCP server instructions (delta)
- agent 목록 (coordinator 에만 — worker 는 spawn 권한 없음)

**전체 skill listing 은 재주입 안 함** — 설치된 모든 skill 이름 나열은 토큰 낭비. 모델은 `Skill` 도구로 필요 시 검색 가능 (design-principles §7 partial loading).

### autoCompact Threshold

```
threshold = EFFECTIVE_CONTEXT_WINDOW - SAFETY_BUFFER
          = 200_000 - 13_000
          = 187_000   (≈ 93.5%)
```

- `SAFETY_BUFFER: int = 13_000` — 요약 LLM 호출 여유 공간 + 한 턴 분량 + α
- `auto_compact_threshold()` 가 `APP_AUTOCOMPACT_THRESHOLD` env 로 override 가능 (개발/튜닝용)
- 200K 모델 기준. 비-200K 모델은 `TokenBudget.for_model()` 가 별개로 스케일 (context-assembly-patterns.md)

### 요약 LLM (summarizer) 구현

요약은 사용자 대화와 **별도 LLM** 으로 수행 — 비용 절감 + 안정성:

- **모델 하드코드**: `INTERNAL_MODEL: str = "claude-haiku-4-5"` (`compaction.py:64`). Sonnet 대비 ~10배 저렴. fallback chain 과 **완전 분리** — 사용자 요청 chain 이 Sonnet/Opus 여도 compaction 은 항상 Haiku 직행
- **팩토리**: `make_provider_summarizer(provider_call) -> SummarizerFn` (`compaction.py:731`) — `ProviderProtocol.call_stream` 을 `str → str` 로 래핑
- **호출 파라미터** (고정):
  - `tools=[]`, `max_tokens=1024`, `temperature=0.0`, `stream=True`
  - system prompt: `"You are a precise conversation summarizer. Output only the summary text — no preamble, no closing remarks."`
- **Cancel 안전**: 요약 중 `CancelledError` → 부분 결과 폐기 + 재전파. 잘린 요약이 messages 에 들어가면 맥락 오염
- **주입 지점**: `backend/engine/deps.py:170` — `LoopDeps.compact` wrapper 가 production summarizer 주입. 테스트는 `AsyncMock`-style fake summarizer
- **사용 stage**: `micro` + `auto` + `reactive`. `snip` 과 `session_memory` 는 summarizer 사용 안 함

### Reactive 전략 (5번째 — Error Recovery 전용)

`compact_messages()` 의 4-stage 에는 포함되지 않지만, **Prompt-Too-Long 복구** 경로에서 사용:

- 트리거: Stage 1 compaction 후에도 provider 호출이 PTL 반환 (토큰 추정 오차 / 갑자기 커진 tool_result / 이미지·PDF 부가 토큰)
- 함수: `reactive_compact(messages, summarizer, ...)` (strategy=`"reactive"`)
- target: `threshold * REACTIVE_TARGET_RATIO` (= **0.70**) — escalation 보다 공격적으로 축소
- 방식: oldest group drop + 요약 혼합
- 연관: `agent-loop-patterns.md` §Error Recovery "prompt-too-long: context collapse → reactive compact → terminate"

## 새 compaction 전략 추가하기

1. `CompactionResult.strategy` Literal (`compaction.py:150`) 에 새 값 추가
2. 새 stage 함수 구현 — 시그니처: `(messages, ..., summarizer?) -> CompactionResult`
3. `compact_messages()` (`compaction.py:642`) 의 순차 로직에 삽입 — **반드시 비용 순서 유지** (저렴한 것부터, design-principles §2)
4. LLM 호출 여부 문서화 + `summarizer` 필요 여부 시그니처에 반영
5. target 도달 판정에 `ESCALATION_TARGET_RATIO` 사용 (일관성)
6. `COMPACTED_MARKER` 멱등성 존중 — 이미 처리된 블록은 재처리 skip
7. post-compact 재주입 로직이 새 전략에서도 작동하는지 확인
8. 테스트: 해당 전략만 트리거되는 토큰 시나리오 + cancel-safe 확인 + 누적 호출 시 무한 루프 없음

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 4-stage 순서 변경 | 비용 최적화 파괴 (design-principles §2) — 절대 금지 |
| `SAFETY_BUFFER` 변경 | compaction 트리거 빈도 전면 변경 → 대화 길이/품질 영향, AUTO 여유 공간 |
| `ESCALATION_TARGET_RATIO` 변경 | 너무 낮으면 공격적 축소로 맥락 손실, 너무 높으면 재트리거 빈발 |
| `REACTIVE_TARGET_RATIO` 변경 | PTL 복구의 공격성 — 너무 낮으면 recovery 성공률 저하 |
| `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` 변경 | 너무 낮으면 일시 장애에 취약, 너무 높으면 무한 재시도 |
| `INTERNAL_MODEL` 변경 | 요약 비용 / 품질 trade-off, capabilities 해석 재검증 필요 |
| post-compact 재주입 항목 변경 | 모델이 잃는/얻는 맥락 변경 → 품질 직접 영향 |
| SNIP 대상 확대 | system message 포함 시 지시 소실 — 반드시 제외 유지 |
| MICRO/AUTO chunk 크기 변경 | 요약 품질 vs 호출 수 trade-off |
| `COMPACTED_MARKER` 문자열 변경 | 기존 세션의 멱등성 판정 깨짐 → 재처리로 맥락 손실 |
| `reactive` 전략 제거 | PTL 복구 경로 전면 재설계 필요 (agent-loop-patterns 동시 업데이트) |

## 금지 사항

- 4-stage 순서 재배치 (저렴한 것부터 원칙 위반 — design-principles §2)
- `system` message 를 SNIP / MICRO / AUTO 대상에 포함 (기본 지시 소실)
- LLM 호출 stage (MICRO / AUTO / REACTIVE) 를 SNIP / SESSION_MEMORY 이전에 시도 (비용 낭비)
- 같은 턴에서 compaction 재실행 (lossy 누적)
- `threshold` 바로 아래로만 축소하고 중단 (재트리거 가드 우회)
- post-compact 재주입 항목 생략 (최근 read 파일 / 활성 skill / plan / deferred tools / MCP instructions / agent listing)
- 전체 skill listing 을 post-compact 재주입 (토큰 낭비, partial loading 원칙 위반)
- `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` 카운터 없이 무한 재시도
- summarizer 의 부분 결과 (`CancelledError` 중단분) 를 messages 에 저장
- `INTERNAL_MODEL` 을 fallback chain 에 연결 (사용자 대화 모델과 혼용 금지)
- `COMPACTED_MARKER` 없이 요약본 append (재처리 루프 위험)

## Tool Output Boundary Preservation (2026-04-25 spec)

Stage 5 가 모든 tool_result content 를 `<tool_output>...</tool_output>` 으로
감싸기 시작하면서 (indirect injection 방어, `tool-system-patterns.md` §Tool
Output Guardrail), compaction 의 4 stage 가 그 envelope 를 부수지 않도록
유지해야 한다. Spec: `docs/completed/superpowers/specs/2026-04-25-indirect-injection-defense-design.md`.

**핵심 불변식:**

- `_is_compacted` 는 `strip_outer_wrap` 후 `COMPACTED_MARKER` 검사 — wrap 된
  block 도 멱등성 인식
- `snip_compact` 는 strip → truncate → `wrap_tool_output_text` 로 재포장 —
  close tag 잘림 방지. 결과: `<tool_output>\n[COMPACTED] inner...\n</tool_output>`
- `reactive_compact` step 3 (last resort placeholder) 도 동일 wrap 적용 —
  `<tool_output>\n[COMPACTED] [output omitted — tool_use_id: ...]\n</tool_output>`
- `_SUMMARIZER_SAFETY_PREAMBLE` 상수가 micro / auto chunk / reactive mega 의
  3 prompt 모두에 prepend — summarizer LLM 이 tool output 안의 instruction 을
  따르지 않게 강제. base.md 의 defensive block 과 동일 톤
- Tag 이름 (`<tool_output>`) 은 `backend/engine/_tool_output_guard.py` 의
  `_TOOL_OUTPUT_OPEN` / `_TOOL_OUTPUT_CLOSE` 단일 source. 변경 시 base.md
  defensive block + 본 rule + 모든 helper 동시 갱신

**금지:**

- snip 에서 wrap 통째 truncate (close tag 잘림 → boundary 파괴)
- reactive placeholder 를 bare string 으로 emit (`_mark_compacted` 만 해서
  wrap 없이 message 에 진입 — 재트리거 시 모델이 그 placeholder 의 instruction
  으로 해석 위험)
- summarizer prompt 에서 `_SUMMARIZER_SAFETY_PREAMBLE` 생략 (summarizer LLM 이
  injection 에 노출됨 — assistant message 로 변환되면서 role 경계 자체 깨짐)
- compaction 결과의 derived tool_result content 가 wrap 없이 message 로 진입
  (역시 boundary 파괴)
