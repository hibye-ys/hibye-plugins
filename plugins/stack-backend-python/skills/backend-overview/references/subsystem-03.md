> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/compaction-patterns.md` + live implementation at `backend/engine/compaction.py`.

# Subsystem 03 — Compaction

## 목적 (1줄)

대화가 길어져 컨텍스트 윈도우를 초과하는 것을 방지하는 메시지 압축 전략.

## 파일 / 모듈

- `backend/engine/compaction.py` — 4 전략 구현 + 트리거 판단

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `maybe_compact(messages, model_ctx_window)` | 엔트리. 현재 토큰 수 측정 → 전략 선택 → 압축된 messages 반환 |
| `auto_compact(messages)` | 대화 요약으로 교체. LLM 호출 1회 (경량 모델) |
| `micro_compact(messages)` | 개별 tool_result의 인라인 축약 (Entity 데이터 등 큰 결과) |
| `snip_old_tool_results(messages)` | 오래된 tool_result를 placeholder로 대체 |
| `reactive_compact(messages)` | 토큰 초과 에러 수신 후 긴급 압축 (fallback) |
| `estimate_tokens(messages)` | 빠른 토큰 카운터 (provider-specific) |

## 4 전략

| 전략 | 설명 | 트리거 |
|---|---|---|
| **Auto-Compact** | 컨텍스트 한계 임박 시 대화 요약으로 교체 | round 종료 후 토큰 > 80% |
| **Micro-Compact** | 도구 결과가 클 때 인라인 압축 | 단일 tool_result > N 토큰 |
| **Snip** | 오래된 도구 결과 잘라내기 | round N+ 이전 tool_result 제거 |
| **Reactive Compact** | 토큰 초과 에러 시 긴급 압축 | `prompt_too_long` 에러 수신 |

## 압축 판단 로직

```python
async def maybe_compact(messages, model_ctx_window):
    token_count = estimate_tokens(messages)
    threshold = model_ctx_window * 0.8
    if token_count > threshold:
        messages = snip_old_tool_results(messages)
        if estimate_tokens(messages) > threshold:
            summary = await summarize_conversation(messages)
            messages = [system_msg, summary_msg] + messages[-N:]
    return messages
```

## 담당 skill

`compaction`

## 범위

- Reactive compact만 구현 (fallback). Auto/Micro/Snip은 .
- 내부 LLM 호출은 경량 모델 (`anthropic/claude-haiku-4-5`) 사용.

## Gotchas

- **system prompt + 첫 user 메시지는 보존**: Snip/Auto-Compact 시 첫 user turn은
  대화 시작 컨텍스트이므로 유지. (system prompt caching prompt cache 적중률 유지)
- **summary는 role="user" message로 주입**: role="system" 중복은 프로바이더가
  거부할 수 있다.
- **토큰 추정은 프로바이더마다 다르다**: tiktoken vs anthropic tokenizer. 추상
  인터페이스로 감쌀 것.

## 관련 AD

- system prompt caching (system prompt 캐시 적중률) — 압축 시 static prefix 보존 중요
- multi-provider (멀티 프로바이더) — 전략은 provider에 독립적이어야
