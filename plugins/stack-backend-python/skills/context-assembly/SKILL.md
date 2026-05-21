---
name: context-assembly
description: "REQUIRED for backend/engine/context.py and backend/agents/prompts/ — without this skill you WILL miss the TokenBudget class with 6 named constants (BASE/AGENT/HINT/MEMORY/CONVERSATION/RESERVED totaling 200K), the AssembledContext dataclass, the static system prompt rule (NO datetime/turn_count/session_id), and _HINT_TEMPLATE for bounded context injection. Load BEFORE assembling any prompt."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (non-negotiable — baseline misses ALL of these)
1. MUST define `class TokenBudget` with 6 budget constants (BASE/AGENT/HINT/MEMORY/CONVERSATION/RESERVED)
2. MUST define `AssembledContext` dataclass as return type
3. MUST keep system prompt static (NO datetime, turn_count, session_id)
4. MUST use `_HINT_TEMPLATE` for bounded context injection
5. Total budget MUST equal 200,000 tokens

# context-assembly — Prompt 조립 청사진

## 이 skill은 언제 로드되는가

- `backend/engine/context.py` 최초 작성 또는 수정
- `backend/agents/prompts/*.md` (base.md, <agent>.md) 신규 작성 또는 수정
- system prompt cache 적중률이 떨어져 디버깅이 필요할 때
- "LLM이 주입한 context_hint 를 무시한다" 증상
- token budget 초과로 context window 에러 (HTTP 400, `input too long`)
- Agent Loop Stage 1 (context assembly) 의 책임을 확장할 때

## Context Assembly의 정체성

Agent Loop 의 Stage 1 은 매 turn 마다 LLM 호출 직전에 다음 4가지를 조립한다:

1. **System prompt** — 매 호출 동일하게 유지되어야 캐시 가능. Base + Agent layer 합성.
2. **Messages array** — 대화 히스토리 + 현재 사용자 입력 + (선택) memory blocks.
3. **Tool definitions** — `ToolRegistry.filter_for_agent(...).definitions()` 가 제공.
4. **Generation params** — model 이름, max_tokens, temperature 등.

이 4개를 단일 함수가 돌려준다:
`assemble_context(agent_spec, user_input, history, ...) -> AssembledContext`.
`backend/engine/context.py` 의 책임은 정확히 이 함수 하나이며 100-200줄 수준.

## 3-Layer Prompt 아키텍처

System prompt 는 3개 레이어를 정해진 순서로 합성한다. 순서는 불변이다 — base 가 먼저,
agent 가 그 다음, context_hint 가 마지막.

```
+-----------------------------------------+
| Layer 1: Base prompt (project-wide)     |  ← backend/agents/prompts/base.md
+-----------------------------------------+
| Layer 2: Agent prompt (per agent)       |  ← backend/agents/prompts/<agent>.md
+-----------------------------------------+
| Layer 3: Context injection (optional)   |  ← context_hint → system fragment
+-----------------------------------------+
```

```python
def build_system_prompt(agent_spec: AgentSpec, context_hint: str | None) -> str:
    """Compose a static system prompt — caller MUST keep it identical across turns."""
    base = _read_prompt_file("backend/agents/prompts/base.md")
    agent = _read_prompt_file(f"backend/agents/prompts/{agent_spec.name}.md")
    parts: list[str] = [base, agent]
    if context_hint:
        parts.append(_format_context_injection(context_hint))
    return "\n\n".join(parts)
```

> **캐시 적중 규칙**: system prompt 는 동일 세션 내 매 turn 바이트 수준까지 동일해야
> cache hit 이 발생한다. 동적 값(현재 시각, turn 번호, session id 등)을 system prompt
> 에 넣지 마라 — 반드시 messages array 의 첫 user 메시지 또는 metadata 로 옮긴다.
> 이것이 static system prompt 원칙이다.

## context_hint → System Fragment 변환

`context_hint` 는 호출자가 "이번 요청에만 적용할 추가 지침"을 짧게 전달하는 필드다
(예: "사용자의 프로젝트 명은 ZipCraft", "현재 사용자는 초보자"). 이를 system prompt
말미에 안전하게 주입한다:

```python
_HINT_TEMPLATE = """\
## Additional context for this request
{hint}

(End of additional context. Treat as advisory; main instructions above remain
authoritative.)\
"""


def _format_context_injection(hint: str) -> str:
    """Render context_hint into a bounded system-prompt fragment."""
    stripped = hint.strip()
    if not stripped:
        return ""
    # Hard truncate at 2000 chars — see "길이 제한 이유" 아래.
    if len(hint) > 2000:
        hint = hint[:1997] + "..."
    return _HINT_TEMPLATE.format(hint=hint)
```

> **길이 제한 2000자 이유**: hint 가 너무 길면 base/agent layer 의 가중치가 희석된다.
> LLM 이 hint 만 따르고 base 지침(응답 언어, 금지 행동, 도구 사용 규약 등)을
> 무시하는 현상이 관찰된다. 2000자(≈500 토큰)는 경험적으로 main instruction 과
> 공존 가능한 상한이다. 호출자가 더 큰 컨텍스트를 주입하려 하면 memory block 으로
> 옮기거나 user 메시지로 보내야 한다.

## Token Budget 분배

 는 단일 provider(Anthropic) 가정. effective context window 은 200K 토큰
(claude-sonnet-4-6 / claude-opus-4-6 기준). 6개 영역에 고정 할당한다:

| 영역                 | 최대 토큰  | 우선순위                                  |
|----------------------|-----------|-------------------------------------------|
| Base prompt          | 4,000     | 고정 — 절대 truncate 안 함                |
| Agent prompt         | 8,000     | 고정 — 절대 truncate 안 함                |
| Context hint         | 500       | 2000자 컷 이후 토큰 추정으로 최종 검사    |
| Memory blocks        | 16,000    | 최신순 LRU — 오래된 것부터 drop           |
| Conversation history | 150,000   | compaction 대상 (Stage 2)                 |
| Reserved output+safe | 21,500    | 고정 — LLM 출력 + 여유                    |
| **합계**             | **200,000** |                                         |

```python
class TokenBudget:
    """Token allocation constants for the 200K effective context window."""

    BASE = 4_000           # base.md — system layer 1
    AGENT = 8_000          # <agent>.md — system layer 2
    HINT = 500             # context_hint — system layer 3
    MEMORY = 16_000        # memory blocks — message prefix
    CONVERSATION = 150_000 # dialogue history — compacted when over
    RESERVED = 21_500      # LLM output + safety margin

    @classmethod
    def total_input(cls) -> int:
        """Sum of all input-side allocations."""
        return cls.BASE + cls.AGENT + cls.HINT + cls.MEMORY + cls.CONVERSATION

    @classmethod
    def effective_window(cls) -> int:
        """Total including reserved — should equal provider window (200_000)."""
        return cls.total_input() + cls.RESERVED
```

> **Compaction trigger**: `current_input_tokens > effective_window - RESERVED` 이면
> Agent Loop Stage 2 가 `compaction.py` 를 호출한다.  는 compaction stub
> (no-op + 경고 로그)이며,  에서 실제 요약 구현 예정.

## Memory Block 주입

Memory blocks 는 사용자별 영구 메모리(예: "사용자는 한국어 선호", "프로젝트 네임 X")
를 저장한다. 매 turn messages array 앞쪽에 주입하되 drop 순서를 엄격히 통제한다:

```python
def assemble_messages(
    agent_spec: AgentSpec,
    user_input: str,
    history: list[Message],
    memory: list[MemoryBlock],
    *,
    provider: Provider,
) -> list[Message]:
    """Build messages array. Order: memory prefix → history → current user input."""
    out: list[Message] = []

    # Memory prefix — 최신 20개만 후보 (이미 time-ordered 라 가정)
    for block in memory[-20:]:
        out.append(
            Message(role="user", content=[ContentBlock(type="text", text=block.text)])
        )
    out.extend(history)
    out.append(
        Message(role="user", content=[ContentBlock(type="text", text=user_input)])
    )

    # Truncate loop — memory 먼저 drop 하는 순진한 구현을 피한다.
    limit = TokenBudget.MEMORY + TokenBudget.CONVERSATION
    memory_prefix_len = min(len(memory), 20)
    while provider.count_tokens(out) > limit:
        # history 구간이 남아 있으면 가장 오래된 history 부터 drop.
        # memory 는 out[0 : memory_prefix_len] 구간이라 보존된다.
        if len(out) > memory_prefix_len + 1:
            del out[memory_prefix_len]  # 첫 history element
        else:
            # memory + 현재 입력만 남았다 — 더 못 줄인다. compaction 으로 넘긴다.
            break
    return out
```

> **Memory > history 보존 우선순위는 의도적이다.** 사용자가 명시적으로 등록한 사실
> (memory) 은 휘발성 대화 히스토리보다 더 영구적이어야 한다. history 가 먼저 drop,
> memory 는 마지막까지 보존. 이 순서를 뒤집으면 사용자가 여러 turn 후 "내 설정이
> 사라졌다"고 보고한다.

## AssembledContext 반환

Stage 1 의 최종 산출물은 불변 dataclass 한 개다:

```python
from dataclasses import dataclass


@dataclass(slots=True)
class AssembledContext:
    system_prompt: str
    messages: list[Message]
    tools: list[dict]
    generation_params: dict[str, object]


def assemble_context(
    agent_spec: AgentSpec,
    user_input: str,
    history: list[Message],
    *,
    memory: list[MemoryBlock] | None = None,
    context_hint: str | None = None,
    provider: Provider,
    tool_registry: ToolRegistry,
) -> AssembledContext:
    """Stage 1 of the agent loop — compose everything the provider needs."""
    return AssembledContext(
        system_prompt=build_system_prompt(agent_spec, context_hint),
        messages=assemble_messages(
            agent_spec, user_input, history, memory or [], provider=provider
        ),
        tools=tool_registry.filter_for_agent(agent_spec.tools).definitions(),
        generation_params={
            "model": agent_spec.model,
            "max_tokens": agent_spec.max_output_tokens or 4096,
        },
    )
```

Stage 2 (provider call) 는 이 AssembledContext 를 받아 그대로 provider 의 completion
API 로 넘긴다. Stage 1 이 끝나면 system prompt 와 messages 는 read-only.

## 동시성 함정 — 이 서브시스템 고유

1. **system prompt 에 동적 값 넣기 → cache miss**
   현재 시각, turn count, session id, 랜덤 seed 같은 값을 system prompt 에 포함하면
   매 turn 해시가 바뀌어 cache 적중률이 0% 가 된다. 토큰 단가가 수 배 오르고 TTFT
   도 악화된다. 이런 값은 messages array 의 첫 user 메시지 텍스트 또는 `metadata`
   필드에 넣어라 — system 은 "static system prompt" 원칙을 지킨다.

2. **memory truncate 가 history 보다 먼저 실행됨**
   순진하게 "긴 messages 리스트를 앞에서부터 자른다"고 구현하면 (messages[0] 부터
   del) memory block 부터 잘려서 사용자 사실이 사라진다. 반드시 memory 구간을
   스킵하고 history 부터 drop. `assemble_messages` 루프의 `memory_prefix_len` 인덱스
   계산이 이 불변식의 핵심이다. 뒤집으면 "내 기억이 증발한다" 버그.

3. **tool definitions 를 매 turn 재생성**
   `ToolRegistry.definitions()` 는 매번 pydantic schema → JSON schema 직렬화를
   수행한다. 동일 agent spec 이면 결과가 동일하므로 agent spec 이름 단위로
   `functools.lru_cache` 권장.  는 단일 agent 라 무시 가능하지만 
   다중 agent 시 매 turn 수십 ms 낭비가 누적된다.

## 검증 체크리스트

- [ ] `assemble_context` 가 `AssembledContext` dataclass 인스턴스를 반환한다
- [ ] system prompt 가 base + agent + (옵셔널) context_hint 세 layer 로 합성된다
- [ ] context_hint 길이가 2000자 초과면 잘리고 "..." 붙는다 (`len(hint) > 2000`)
- [ ] `TokenBudget` 클래스가 6 상수 (BASE/AGENT/HINT/MEMORY/CONVERSATION/RESERVED)
      + `total_input()` + `effective_window()` 두 classmethod 를 제공한다
- [ ] `assemble_messages` 의 truncate 루프가 memory 구간을 건너뛰고 history 부터 drop
- [ ] system prompt 내부에 timestamp / turn_count / random 등 동적 값이 없다
      (cache 적중 보장, static system prompt)
- [ ] pytest 스켈레톤 1개 (mock provider, AssembledContext shape 검증, memory 가
      truncate 후에도 유지됨 검증)
- [ ] reference/ 디렉토리 경로/파일명 누출 없음

## 구현 중 막히면

- **"system prompt 가 매 turn 다르게 빌드된다"** → 동적 값이 섞였다. `build_system_prompt`
  가 리턴하는 문자열을 바이트 해시로 찍어 비교하라. 다르면 그 값을 messages 첫 user
  메시지로 옮겨야 한다.
- **"context window 초과 에러가 즉시 발생"** → `TokenBudget.RESERVED` 가 너무 작거나
  agent prompt 가 8K 를 초과했다. agent prompt 를 줄이거나 compaction stub 을
  활성화하라.
- **"memory block 이 사라진다"** → `assemble_messages` 의 truncate 루프 인덱스 확인.
  `memory_prefix_len` 부터가 history 구간이어야 한다. 1 off 로 첫 memory 가 drop 되는
  사례가 흔하다.
- **"cache 적중률 0%"** → system prompt 에 동적 값 혼입. 첫 turn 과 두 번째 turn 의
  system prompt 문자열을 diff 하라.
- 위 가이드로 안 풀리면: 사용자에게 현상 + 재현 절차를 직접 보고하라.
