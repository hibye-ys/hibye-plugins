---
name: compaction
description: "CRITICAL for backend/engine/compaction.py — without this skill the output is INDISTINGUISHABLE from baseline. You MUST name strategies exactly: snip, micro, auto, reactive (4-strategy escalation). You MUST define COMPACTABLE_TOOLS frozenset, auto_compact_threshold() = 187000, INTERNAL_MODEL = claude-haiku-4-5, CompactionResult with 6 fields, REACTIVE_TARGET_RATIO = 0.70, and the compacted=True idempotency marker. Load BEFORE writing ANY compaction logic."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (CRITICAL — baseline produces IDENTICAL output without these exact names and values)
1. MUST name strategies exactly: `snip`, `micro`, `auto`, `reactive` (4-strategy escalation)
2. MUST define `COMPACTABLE_TOOLS` frozenset (read-only tools only)
3. MUST define `auto_compact_threshold()` = `EFFECTIVE_CONTEXT_WINDOW - SAFETY_BUFFER` = 187,000
4. MUST use `INTERNAL_MODEL = "claude-haiku-4-5"` for summarization
5. MUST define `CompactionResult` dataclass with `strategy`, `messages`, `items_compacted`, `tokens_before`, `tokens_after`, `notes`
6. MUST define `REACTIVE_TARGET_RATIO = 0.70`
7. MUST check `compacted=True` marker for idempotency (never re-summarize)
8. `tool_use_id` MUST be preserved in ALL strategies (NEVER delete)

# compaction — Agent Loop Context Compaction 청사진

## 이 skill은 언제 로드되는가

- `backend/engine/compaction.py` 최초 작성 또는 수정
- "context window exceeded" 에러가 발생했는데 auto compaction 이 발동하지 않은 디버깅
- Agent Loop Stage 2 (compaction check) 의 stub 을 실제 구현으로 교체하는 시점

## Compaction의 정체성

Compaction 은 Agent Loop 의 **Stage 2** 에 해당한다. 매 turn 마다 provider 호출
직전에 "현재 메시지 배열이 context window 에 넘치는가?" 를 판단하고, 넘치면
메시지를 요약/잘라서 window 안에 넣는다.

### 4 핵심 원칙

1. **정보 보존 우선** — 요약은 항상 정보를 잃는다. `tool_use_id` 같은 구조적 필수 필드는 절대 제거 금지.
2. **비용 최소화** — LLM 없이 처리(snip) 가능하면 LLM 없이. 필요하면 경량 모델(claude-haiku-4-5).
3. **전략 에스컬레이션** — 가벼운 것부터: snip → micro → auto → reactive.
4. **멱등 안전성** — 이미 요약된 블록(`compacted=True` 마커)은 재요약 skip.

## autoCompactThreshold 계산

```python
# backend/engine/compaction.py
"""Context compaction layer — 4 strategies for keeping messages within the window."""
from __future__ import annotations

EFFECTIVE_CONTEXT_WINDOW: int = 200_000
"""Provider의 최대 context window (토큰). Anthropic 200K 기준."""

SAFETY_BUFFER: int = 13_000
"""단일 assistant turn 최대 출력(~8K) + tool definitions 여유(~5K)."""

INTERNAL_MODEL: str = "claude-haiku-4-5"
"""Compaction 내부 요약용 경량 모델. sonnet 대비 ~10배 저렴."""

def auto_compact_threshold() -> int:
    """effective_context_window - safety_buffer = 187_000."""
    return EFFECTIVE_CONTEXT_WINDOW - SAFETY_BUFFER  # 187_000
```

> **왜 13,000?** assistant max_output_tokens 8,192 + tool definitions ~3K-5K = ~13K.
> 이보다 작으면 `prompt_too_long` 빈도 증가, 크면 대화 공간 불필요 축소.

## 4 전략 상세

### Strategy 1 — snip (LLM 호출 없음)

오래된 tool_result content 를 200자로 잘라내기. 비용 $0, 지연 0ms.

```python
def snip_compact(messages: list[Message], threshold: int) -> CompactionResult:
    """Truncate old tool_results to 200 chars. No LLM call.
    Only targets COMPACTABLE_TOOLS. Skips compacted=True blocks."""
    items_compacted = 0
    tokens_before = _estimate_tokens(messages)
    for msg in messages:
        if msg.role != "user":
            continue
        for block in msg.content:
            if block.type != "tool_result":
                continue
            if getattr(block, "compacted", False):
                continue
            if block.tool_name not in COMPACTABLE_TOOLS:
                continue
            text = _extract_text(block)
            if len(text) <= 200:
                continue
            block.text = text[:197] + "..."
            block.compacted = True
            items_compacted += 1
    tokens_after = _estimate_tokens(messages)
    return CompactionResult(
        strategy="snip", messages=messages,
        items_compacted=items_compacted,
        tokens_before=tokens_before, tokens_after=tokens_after,
        notes=f"Truncated {items_compacted} tool_results to 200 chars",
    )

def _extract_text(block: ContentBlock) -> str:
    if isinstance(block.content, str):
        return block.content
    if isinstance(block.content, list):
        return "\n".join(p.text for p in block.content if hasattr(p, "text"))
    return str(block.content)

def _estimate_tokens(messages: list[Message]) -> int:
    """Rough estimate: 1 token ~ 4 chars."""
    return sum(len(str(b.content)) for m in messages for b in m.content) // 4
```

### Strategy 2 — micro (1회 LLM 호출)

최근 N개 메시지 보존, 이전 메시지를 한 문장 요약으로 압축.

```python
MICRO_KEEP_RECENT: int = 6  # user/assistant 쌍 3회분

async def micro_compact(
    messages: list[Message], threshold: int,
    provider: "ProviderProtocol",
) -> CompactionResult:
    """Keep last N messages, summarize earlier with 1 LLM call."""
    tokens_before = _estimate_tokens(messages)
    if len(messages) <= MICRO_KEEP_RECENT:
        return CompactionResult(
            strategy="micro", messages=messages, items_compacted=0,
            tokens_before=tokens_before, tokens_after=tokens_before,
            notes="Too few messages for micro compaction",
        )
    old, recent = messages[:-MICRO_KEEP_RECENT], messages[-MICRO_KEEP_RECENT:]
    summary_text = await _llm_summarize(old, provider, instruction=(
        "Summarize the conversation history in 2-3 sentences. "
        "Preserve: key decisions, tool outputs affecting later steps, "
        "file paths and identifiers. Drop: verbose output, repeated attempts."
    ))
    summary_msg = Message(role="assistant", content=[
        ContentBlock(type="text", text=summary_text, compacted=True),
    ])
    compacted = [summary_msg] + recent
    tokens_after = _estimate_tokens(compacted)
    return CompactionResult(
        strategy="micro", messages=compacted,
        items_compacted=len(old),
        tokens_before=tokens_before, tokens_after=tokens_after,
        notes=f"Summarized {len(old)} old messages into 1 summary",
    )
```

### Strategy 3 — auto (단계별 전체 요약)

snip → micro 로도 threshold 아래 불가 시 사용. 전체 히스토리를 chunk 단위 요약.

```python
async def auto_compact(
    messages: list[Message], threshold: int,
    provider: "ProviderProtocol",
) -> CompactionResult:
    """Full stepwise summarization of entire history.
    1. Run snip first (free pass).
    2. Chunk messages into groups of 10 (excluding last 4).
    3. Summarize each chunk with _llm_summarize.
    4. Reassemble: [chunk_summaries..., last_4_messages].
    5. If still over, merge adjacent summaries until under.
    6. Preserve all tool_use_id references in summary text.
    """
    tokens_before = _estimate_tokens(messages)
    snip_result = snip_compact(messages, threshold)
    messages = snip_result.messages
    if _estimate_tokens(messages) <= threshold:
        return snip_result

    keep_tail = 4
    if len(messages) <= keep_tail:
        return CompactionResult(
            strategy="auto", messages=messages, items_compacted=0,
            tokens_before=tokens_before,
            tokens_after=_estimate_tokens(messages),
            notes="Cannot compact further — too few messages",
        )
    head, tail = messages[:-keep_tail], messages[-keep_tail:]
    chunks = [head[i:i+10] for i in range(0, len(head), 10)]

    summaries: list[Message] = []
    for chunk in chunks:
        text = await _llm_summarize(chunk, provider, instruction=(
            "Summarize this chunk in one paragraph. "
            "Preserve tool_use_id values, file paths, key decisions."
        ))
        summaries.append(Message(role="assistant", content=[
            ContentBlock(type="text", text=text, compacted=True),
        ]))

    # (...코드 30-40줄: merge adjacent summaries if still over threshold,
    #  token counting, logging, CompactionResult 조립...)

    compacted = summaries + tail
    tokens_after = _estimate_tokens(compacted)
    return CompactionResult(
        strategy="auto", messages=compacted, items_compacted=len(head),
        tokens_before=tokens_before, tokens_after=tokens_after,
        notes=f"Auto-compacted {len(head)} messages into {len(summaries)} summaries",
    )
```

### Strategy 4 — reactive (PromptTooLongError 응답)

Provider 가 `prompt_too_long` 을 던진 직후 발동. 가장 공격적. target = threshold * 0.70.

```python
async def reactive_compact(
    messages: list[Message], threshold: int,
    provider: "ProviderProtocol",
) -> CompactionResult:
    """Most aggressive — triggered by PromptTooLongError.
    1. Run auto_compact at 70% target (subsumes snip + micro).
    2. If still over: keep last 2 messages + mega-summary of rest.
    3. Last resort: strip all tool_results to placeholder with tool_use_id.
    """
    tokens_before = _estimate_tokens(messages)
    aggressive_target = int(threshold * 0.70)

    auto_result = await auto_compact(messages, aggressive_target, provider)
    if auto_result.tokens_after <= aggressive_target:
        return CompactionResult(
            strategy="reactive", messages=auto_result.messages,
            items_compacted=auto_result.items_compacted,
            tokens_before=tokens_before, tokens_after=auto_result.tokens_after,
            notes="Reactive: auto_compact sufficient at 70% target",
        )
    working = auto_result.messages
    if len(working) > 2:
        head, tail = working[:-2], working[-2:]
        mega = await _llm_summarize(head, provider, instruction=(
            "Extremely concise summary (3-5 sentences). Keep ONLY: "
            "final decisions, active file paths, pending tool_use_ids."
        ))
        working = [Message(role="assistant", content=[
            ContentBlock(type="text", text=mega, compacted=True),
        ])] + tail

    # (...코드 30-40줄: last-resort tool_result stripping, token counting,
    #  warning log, CompactionResult 조립...)

    if _estimate_tokens(working) > aggressive_target:
        for msg in working:
            for block in msg.content:
                if block.type == "tool_result" and not getattr(block, "compacted", False):
                    block.text = f"[output omitted — tool_use_id: {block.tool_use_id}]"
                    block.compacted = True
    tokens_after = _estimate_tokens(working)
    return CompactionResult(
        strategy="reactive", messages=working,
        items_compacted=tokens_before - tokens_after,
        tokens_before=tokens_before, tokens_after=tokens_after,
        notes=f"Reactive: compacted to {tokens_after} tokens (target {aggressive_target})",
    )
```

## 전략 선택 순서 (dispatch)

```python
async def compact_messages(
    messages: list[Message], threshold: int,
    provider: "ProviderProtocol", *, is_reactive: bool = False,
) -> CompactionResult:
    """Main entry point. Strategy order: snip → micro → auto.
    If is_reactive=True (PromptTooLongError recovery): jump to reactive."""
    if is_reactive:
        return await reactive_compact(messages, threshold, provider)
    result = snip_compact(messages, threshold)
    if result.tokens_after <= threshold:
        return result
    result = await micro_compact(messages, threshold, provider)
    if result.tokens_after <= threshold:
        return result
    return await auto_compact(messages, threshold, provider)
```

## COMPACTABLE_TOOLS 세트

```python
COMPACTABLE_TOOLS: frozenset[str] = frozenset({
    "file_read", "search", "list_dir", "fetch_doc",
})
"""읽기 전용 — 요약/잘라내기 안전."""

NON_COMPACTABLE_TOOLS: frozenset[str] = frozenset({
    "file_write", "create_branch", "send_email",
})
"""부작용 확인 정보 — 요약 금지. 줄 수/ID 등이 사라지면 LLM이 재실행 시도."""
```

| 기준 | COMPACTABLE | NON_COMPACTABLE |
|---|---|---|
| 부작용 | 없음 (읽기 전용) | 있음 (쓰기/전송/생성) |
| 요약 후 LLM 행동 변화 | 없음 | 있음 (재실행 위험) |
| 원본 필요 여부 | 불필요 (핵심만) | 필요 (정확한 값) |

> **규칙**: "이 결과를 3줄로 요약했을 때 LLM 이 다음 turn 에서 잘못된 판단을 할 수 있는가?"
> 그렇다면 NON_COMPACTABLE. **의심되면 NON_COMPACTABLE** 에 넣어라.

## CompactionResult dataclass

```python
from dataclasses import dataclass
from typing import Literal

@dataclass(slots=True)
class CompactionResult:
    """Outcome of a compaction pass — returned by all 4 strategies."""
    strategy: Literal["snip", "micro", "auto", "reactive"]
    """Which strategy produced this result."""
    messages: list[Message]
    """The compacted message array. Replaces the original in the loop."""
    items_compacted: int
    """Number of messages or blocks that were summarized/truncated."""
    tokens_before: int
    """Estimated token count of the original messages."""
    tokens_after: int
    """Estimated token count after compaction."""
    notes: str
    """Human-readable summary for logging."""
```

## 경량 모델 사용 패턴

```python
async def _llm_summarize(
    messages: list[Message], provider: "ProviderProtocol", *, instruction: str,
) -> str:
    """Summarize messages using claude-haiku-4-5 (~10x cheaper than sonnet).
    Builds a tight prompt: instruction + conversation dump. No tools."""
    conversation_dump = _format_messages_for_summary(messages)
    summary_messages = [Message(role="user", content=[ContentBlock(
        type="text",
        text=f"{instruction}\n\n---\n\n{conversation_dump}",
    )])]
    chunks: list[str] = []
    async for event in provider.call_stream(
        system="You are a precise conversation summarizer. Output only the summary.",
        messages=summary_messages, tools=[],
        model=INTERNAL_MODEL, max_tokens=1024, temperature=0.0,
    ):
        if hasattr(event, "text"):
            chunks.append(event.text)
    return "".join(chunks)

def _format_messages_for_summary(messages: list[Message]) -> str:
    lines: list[str] = []
    for msg in messages:
        role = msg.role.upper()
        for block in msg.content:
            if block.type == "text":
                lines.append(f"[{role}] {block.text[:500]}")
            elif block.type == "tool_use":
                lines.append(f"[{role}] tool_call: {block.name}(...)")
            elif block.type == "tool_result":
                lines.append(f"[TOOL_RESULT:{block.tool_use_id}] {_extract_text(block)[:300]}")
    return "\n".join(lines)
```

## 동시성 함정 — 이 서브시스템 고유

### 1. 사용자 취소 (user cancel during compaction)

compaction 중 SSE 끊김 → `_llm_summarize` 의 async generator 중단 → 원본이 반쯤
수정된 상태. **대책**: 원본을 직접 수정하지 않고 **복사본**에서 작업.
`CompactionResult.messages` 반환 전까지 원본은 그대로.

```python
# WRONG — for block in messages: block.text = summarized
# RIGHT — working = [msg.model_copy(deep=True) for msg in messages]
```

### 2. tool_use_id 유실

tool_result 요약 시 `tool_use_id` 삭제 → provider 가 "orphaned tool_result" 에러.
**대책**: 내용만 축소, ID 는 절대 제거 금지. reactive 최종 수단에서도
`f"[output omitted — tool_use_id: {block.tool_use_id}]"` 형태로 보존.

### 3. threshold-just-met 재트리거 방지

compaction 후 threshold 바로 아래 → 다음 turn assistant 응답 1개로 다시 초과 →
매 turn compaction 발동 (compaction loop). **대책**: reactive 목표 = `threshold * 0.70`
(30% 여유). auto/micro 도 80% 이하 아니면 에스컬레이션.

## 검증 체크리스트

- [ ] 4 전략 (snip / micro / auto / reactive) 이 코드에서 식별 가능
- [ ] `auto_compact_threshold()` = `EFFECTIVE_CONTEXT_WINDOW - SAFETY_BUFFER` (187,000)
- [ ] `COMPACTABLE_TOOLS` 에 읽기 전용 도구만 포함, 쓰기 도구 없음
- [ ] `CompactionResult` 에 strategy / messages / items_compacted / tokens_before / tokens_after / notes 6필드
- [ ] `_llm_summarize` 가 `INTERNAL_MODEL` (claude-haiku-4-5) 사용
- [ ] tool_result 요약 시 `tool_use_id` 보존됨
- [ ] 전략 시도 순서: snip → micro → auto (reactive 는 is_reactive 플래그로 분리)

## 구현 중 막히면

- **"어떤 전략을 먼저?"** → snip(무비용) → micro(LLM 1회) → auto(LLM 다회) →
  reactive(PromptTooLongError 후). 항상 가벼운 것부터.
- **"tool_result 요약 후 다음 turn 에러"** → `tool_use_id` 보존 확인. Anthropic API 는
  tool_result-tool_use 쌍 매칭 필수. ID 삭제 = orphan 에러.
- **"compaction 매 turn 발동 (무한 루프)"** → target 이 threshold 정확히 아래가 아니라
  threshold * 0.70~0.80 이하인지 확인.
- **"요약 품질 나쁨"** → `_llm_summarize` instruction 확인. "Preserve tool_use_id,
  file paths, key decisions" 같은 구체적 보존 대상을 명시.
