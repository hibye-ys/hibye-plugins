---
name: provider-layer
description: "REQUIRED for backend/providers/ and backend/services/model_resolution.py — without this skill you WILL miss tee_stream() for dual-consumer splitting, the is_foreground retry distinction (5 vs 2 attempts), FOREGROUND_529_RETRY_SOURCES frozenset, CancelledError propagation in retry sleep, and connected_providers() with @functools.cache. Load BEFORE writing any Provider class."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (non-negotiable — baseline misses ALL of these)
1. MUST implement `tee_stream()` for dual-consumer stream splitting
2. MUST distinguish `is_foreground` in retry policy (5 attempts foreground, 2 background)
3. MUST define `FOREGROUND_529_RETRY_SOURCES` frozenset for 529 allowlist
4. MUST propagate `CancelledError` in retry sleep (never swallow)
5. MUST implement `connected_providers()` with `@functools.cache`

# provider-layer — Provider 추상화 + Model Resolution 청사진

## 이 skill은 언제 로드되는가

- `backend/providers/{base,anthropic,openai,gemini}.py` 최초 작성
- `backend/services/model_resolution.py` 작성 또는 resolve_model 분기 수정
- 새 Provider 추가 (예: Bedrock, Vertex, Groq)
- "model resolution miss", "retry storm", "provider-format 변환 버그" 디버깅
- 테스트에서 `connected_providers()` 가 stale 값을 돌려주는 증상

요약: `backend/providers/**` 또는 `backend/services/model_resolution.py` 를
열기 전에 항상 이 skill을 먼저 읽어라.

## Provider Layer의 정체성

Provider Layer는 LLM 호출의 모든 실측 디테일을 한 곳에 격리한다. 다섯 개의
부품으로 이뤄진다:

1. **Provider Protocol** — 모든 provider가 구현해야 하는 인터페이스 (`call_stream`, `count_tokens`).
2. **Unified Message / ContentBlock** — provider별 포맷 차이를 흡수하는 내부 표준 타입. Agent Loop는 이 포맷만 본다.
3. **Model Resolution** — agent spec + 사용자 요청 + fallback 으로부터 실제 model id 를 결정하는 4 단계 알고리즘.
4. **Connected Providers Cache** — 어떤 provider가 활성화돼 있는지 한 번 검사 후 process lifetime 캐시.
5. **Retry Policy** — foreground / background 차등 + provider 별 429 / 529 / 5xx 처리.

이 5 부품이 `backend/providers/` + `backend/services/model_resolution.py` 의
뼈대다. Agent Loop Stage 3 는 이 계층에 의존한다 — 절대 provider-native
포맷이나 provider SDK 를 직접 건드리지 않는다.

## Provider Protocol

```python
# backend/providers/base.py
"""Provider protocol — all LLM providers implement this."""

from __future__ import annotations

from abc import abstractmethod
from typing import AsyncIterator, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict


class ContentBlock(BaseModel):
    """Content block — text / image / tool_use / tool_result variants."""

    model_config = ConfigDict(extra="forbid")

    type: str  # "text" | "image" | "tool_use" | "tool_result"
    # Variant fields populated based on type
    text: str | None = None
    source: dict | None = None       # image source dict
    id: str | None = None            # tool_use id
    name: str | None = None          # tool name for tool_use
    input: dict | None = None        # tool args for tool_use
    tool_use_id: str | None = None   # for tool_result back-reference
    content: str | list | None = None  # for tool_result payload
    is_error: bool | None = None     # for tool_result error flag


class Message(BaseModel):
    """Unified message — internal format, converted to provider-native at call site."""

    model_config = ConfigDict(extra="forbid")

    role: str  # "user" | "assistant" | "system" | "tool"
    content: list[ContentBlock]


class ProviderEvent(BaseModel):
    """Streaming event yielded by call_stream."""

    model_config = ConfigDict(extra="forbid")

    type: str  # "text_delta" | "tool_use_start" | "tool_use_delta"
               # | "tool_use_end" | "done" | "error"
    payload: dict


@runtime_checkable
class Provider(Protocol):
    name: str
    model: str
    supports_tools: bool
    supports_streaming: bool

    @abstractmethod
    async def call_stream(
        self,
        *,
        system: str,
        messages: list[Message],
        tools: list[dict],
        max_tokens: int = 4096,
    ) -> AsyncIterator[ProviderEvent]:
        """Stream provider response. Must yield ProviderEvent objects."""
        ...

    @abstractmethod
    def count_tokens(self, messages: list[Message]) -> int:
        """Estimate input tokens for the given messages."""
        ...
```

> `Message` / `ContentBlock` 은 **내부 표준 타입**이다. provider 별 변환은 각
> Provider 클래스 안에서만 이루어진다. Agent Loop 는 절대 provider-native
> 포맷(Anthropic `tool_use` dict, OpenAI `function_call`, Gemini `parts[]`)을
> 다루지 않는다. 이 격리가 깨지면 에서 provider 하나 추가할 때
> Agent Loop 를 재작성해야 한다.

`@runtime_checkable Protocol` 을 쓰는 이유: concrete subclass 의 상속 없이
duck-typing 기반 `isinstance(p, Provider)` 검사를 허용하기 위함. 멀티
provider registry 가 여러 구현을 섞어 담을 때 타입 안전성을 유지해 준다.

## Model Resolution 4단계

Model id 결정은 엄격한 우선순위 체인이다:

```python
# backend/services/model_resolution.py
def resolve_model(
    *,
    explicit: str | None,            # 사용자가 직접 지정 (CLI / API param)
    agent_pref: str | None,          # agent spec 의 model 필드
    fallback_chain: list[str],       # 설정 파일의 fallback 순서
    default: str = "claude-sonnet-4-6",
) -> str:
    """4-stage resolution. Returns first viable model id."""
    candidates: list[str | None] = [explicit, agent_pref, *fallback_chain, default]
    for candidate in candidates:
        if not candidate:
            continue
        resolved = _fuzzy_match(candidate)  # "sonnet" → "claude-sonnet-4-6"
        if _provider_for(resolved) in connected_providers():
            return resolved
    raise ConfigurationError("No connected provider for any candidate model")
```

### Stage 1 — explicit
사용자가 직접 지정한 경우 (CLI flag, API param, test fixture). 가장 높은
우선순위. 미지정이면 None → Stage 2 로 넘어간다.

### Stage 2 — agent preference
`backend/agents/<name>.yaml` 의 `model:` 필드. agent 별로 선호 모델이 있다면
여기서 주입된다. 미지정이면 None → Stage 3.

### Stage 3 — fallback chain
`backend/config/providers.yaml` 의 `fallback_chain:` 배열. 예:
`["claude-opus-4-6", "claude-sonnet-4-6", "gpt-5"]`. 첫 번째 활성 provider 에
대응하는 model 을 고른다. 모두 unavailable 이면 Stage 4.

### Stage 4 — hard default
모든 단계 실패 시 `claude-sonnet-4-6` (Anthropic 기본). 이 값마저 unavailable
이면 `ConfigurationError` 를 raise 한다 — 호출자에게 실제로 configuration
문제가 있음을 알려야 하기 때문에 silent fallback 은 금지.

> **불변식**: resolve_model 은 반드시 연결된 provider 와 매칭되는 model id 를
> 돌려주어야 한다. "형식만 올바른" id 를 돌려주면 Stage 3 의 의미가 사라진다.

## Fuzzy Match + Connected Providers Cache

`_fuzzy_match` 는 사용자 입력의 alias / 약식 이름을 정식 model id 로
정규화한다:

```python
_FUZZY_MAP: dict[str, str] = {
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-6",
    "haiku": "claude-haiku-4-5",
    "gpt5": "gpt-5",
    "gpt-5": "gpt-5",
    "4.1-opus": "claude-opus-4-1",
}


def _fuzzy_match(name: str) -> str:
    """Return canonical model id, or pass through if not an alias."""
    return _FUZZY_MAP.get(name.lower(), name)
```

`connected_providers()` 는 활성 provider id 를 한 번만 검사 후 모듈 lifetime
캐시한다:

```python
import functools
import os


@functools.cache  # process lifetime — 한 번 검사 후 고정
def connected_providers() -> frozenset[str]:
    """Return the set of provider ids whose API key is configured."""
    connected: set[str] = set()
    if os.getenv("ANTHROPIC_API_KEY"):
        connected.add("anthropic")
    if os.getenv("OPENAI_API_KEY"):
        connected.add("openai")
    if os.getenv("GEMINI_API_KEY"):
        connected.add("gemini")
    return frozenset(connected)


def _provider_for(model_id: str) -> str:
    """Map canonical model id to its owning provider."""
    if model_id.startswith("claude-"):
        return "anthropic"
    if model_id.startswith("gpt-") or model_id.startswith("o"):
        return "openai"
    if model_id.startswith("gemini-"):
        return "gemini"
    raise ConfigurationError(f"Unknown provider for model: {model_id}")
```

> 멀티 provider 지원이 초기 요구사항이므로 `connected_providers()` 는 환경변수에
> 설정된 모든 provider 를 반환한다. `_provider_for` 와 `_FUZZY_MAP` 에 각
> provider 매핑이 포함되어야 한다. 구현 방식 (직접 SDK 래핑 vs LiteLLM
> 하이브리드 등) 은 별도 논의 중이며, 이 추상화 계층의 인터페이스는 방식에
> 무관하게 유지된다.

## Retry Policy — Foreground vs Background

Foreground (사용자가 기다리는 호출) 와 background (notification, 백그라운드
분석, pre-compute) 는 재시도 정책이 다르다. 사용자를 기다리게 할 땐
적극 재시도, 백그라운드는 빨리 포기.

| 정책 | Foreground | Background |
|---|---|---|
| 최대 재시도 횟수 (max_retries) | 5 | 2 |
| 백오프 base | 0.5초 | 5초 |
| 백오프 max (cap) | 8초 | 60초 |
| 429 (rate limit) 재시도 | Yes | Yes |
| 529 (overload) 재시도 | Yes — allowlist 출처만 | No |
| 5xx 서버 에러 재시도 | Yes | No |

```python
import asyncio

FOREGROUND_529_RETRY_SOURCES = {"anthropic", "bedrock"}
# 다른 provider 는 529 를 영구 fail 신호로 해석 — 재시도하면 오히려 해로움.


async def with_retry(
    call,
    *,
    is_foreground: bool,
    provider: str,
    max_retries: int | None = None,
):
    """Execute `call()` with the appropriate retry policy."""
    max_attempts = max_retries or (5 if is_foreground else 2)
    base = 0.5 if is_foreground else 5
    cap = 8 if is_foreground else 60

    for attempt in range(max_attempts):
        try:
            return await call()
        except RateLimitError:
            delay = min(base * 2 ** attempt, cap)
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                raise  # 취소는 그대로 전파 — silent swallow 금지
        except OverloadedError:
            if not (is_foreground and provider in FOREGROUND_529_RETRY_SOURCES):
                raise
            delay = min(base * 2 ** attempt, cap)
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                raise
        except ServerError:
            if not is_foreground:
                raise
            delay = min(base * 2 ** attempt, cap)
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                raise
    raise MaxRetriesExceeded(f"after {max_attempts} attempts ({provider})")
```

**왜 529 에 allowlist 가 필요한가**: 모든 provider 가 529 를 동일하게
해석하지 않는다. Anthropic 은 일시적 overload 신호 (재시도하면 성공 가능),
반면 OpenAI-계 provider 는 영구 fail 에 가까워서 재시도하면 rate-limit 을
악화시킨다.  시점의 allowlist 는 `{"anthropic", "bedrock"}` — Bedrock
이 Anthropic 모델을 호스팅할 때 동일한 semantics 를 물려받기 때문.

## Provider-specific Quirks

| Provider | tool 호출 표현 | streaming 단위 | 알려진 함정 |
|---|---|---|---|
| Anthropic | `tool_use` block in assistant content | SSE event per delta | `cache_control: ephemeral` 에 따라 캐시 적중률 급변 |
| OpenAI | `function_call` (legacy) / `tools` (chat completions) | `delta.tool_calls` | function 이름 64자 제한, nested array schema 미지원 |
| Gemini | `function_call` in `parts[]` | chunk per text | `contents[]` 가 user/model 교대 강제, system 별도 필드 |

> 멀티 provider 는 초기 요구사항이다. 각 provider 의 concrete 구현
> (`backend/providers/{anthropic,openai,google}.py`) 을 모두 작성한다.
> 구현 방식 (각 SDK 직접 래핑 vs LiteLLM 하이브리드 등) 은 별도 논의 중이므로,
> **Provider Protocol 인터페이스는 방식에 무관하게 안정적으로 유지**해야 한다.
> 내부 구현만 교체 가능하도록 설계한다.

## 동시성 함정 — 이 서브시스템 고유

1. **`connected_providers()` 캐시 무효화**

   `@functools.cache` 는 process lifetime 캐시다. 환경변수를 런타임에
   monkeypatch 해도 캐시된 첫 값이 그대로 돌아온다. test 에서 반드시
   `connected_providers.cache_clear()` 를 monkeypatch 뒤에 호출한다.

   ```python
   def test_only_anthropic_connected(monkeypatch):
       monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
       monkeypatch.delenv("OPENAI_API_KEY", raising=False)
       connected_providers.cache_clear()  # 필수
       assert connected_providers() == frozenset({"anthropic"})
   ```

   `conftest.py` 에 `@pytest.fixture(autouse=True)` 로 cache_clear 훅을
   박아 두면 더 안전하다.

2. **Stream 소비 vs 수집 — tee 패턴 의무**

   Agent Loop Stage 3 는 provider stream 을 소비자에게 즉시 forward 하면서
   동시에 내부적으로 완전 수집해야 한다 (tool_use block 추출용). naive
   `async for event in call_stream(...)` 한 번만 돌리고 list 에 모으면
   forward 가 안 되고, 두 번 돌리면 async generator 가 소진된 뒤라 빈
   iterator 가 된다.

   해결: tee 패턴. `asyncio.Queue` 두 개를 만들어 forward / collect 로
   분기한다:

   ```python
   async def tee_stream(
       source: AsyncIterator[ProviderEvent],
   ) -> tuple[asyncio.Queue, asyncio.Queue]:
       forward_q: asyncio.Queue = asyncio.Queue()
       collect_q: asyncio.Queue = asyncio.Queue()

       async def pump():
           async for event in source:
               await forward_q.put(event)
               await collect_q.put(event)
           await forward_q.put(None)  # 종료 sentinel
           await collect_q.put(None)

       asyncio.create_task(pump())
       return forward_q, collect_q
   ```

   `aiostream.stream.tee` 같은 외부 라이브러리도 쓸 수 있지만  는
   stdlib 만으로 끝낸다.

3. **Retry 시 exponential backoff sleep 도중 cancel**

   `asyncio.sleep` 은 취소 가능한 awaitable 이다. 사용자가 FastAPI 요청을
   취소하면 sleep 중 `asyncio.CancelledError` 가 raise 된다. 이걸
   `except Exception` 으로 쓸어 담으면 취소가 무시되어 retry 루프가 계속
   돌고, 결국 서버 리소스 누수로 이어진다.

   규칙: `CancelledError` 는 반드시 그대로 `raise` 해라. `with_retry`
   샘플 코드에도 `try/except asyncio.CancelledError: raise` 가 명시돼 있다.

## 검증 체크리스트

`backend/providers/base.py`, `backend/providers/anthropic.py`,
`backend/services/model_resolution.py` 초안이 완성되면 아래 항목을 모두
체크한다:

- [ ] `Provider` Protocol 이 `@runtime_checkable` 로 선언돼 있고 4 메서드/속성 (`name`, `model`, `supports_tools`, `supports_streaming`) + `call_stream` + `count_tokens` 포함
- [ ] `Message` / `ContentBlock` / `ProviderEvent` 가 pydantic v2 (`ConfigDict(extra="forbid")`) 로 정의
- [ ] `ContentBlock.type` 이 최소 4 variant (`text`, `image`, `tool_use`, `tool_result`) 를 지원
- [ ] `resolve_model` 함수가 4 stage 분기 명시 (`explicit → agent_pref → fallback_chain → default`)
- [ ] `_fuzzy_match` + `_FUZZY_MAP` (최소 sonnet/opus/haiku/gpt5)
- [ ] `connected_providers()` 가 `@functools.cache` 로 감싸짐
- [ ] `with_retry` 가 foreground / background 분기 + `FOREGROUND_529_RETRY_SOURCES` 참조
- [ ] `FOREGROUND_529_RETRY_SOURCES` 에 최소 `"anthropic"` 포함
- [ ] 동시성 함정 3 개 모두 코드 반영 (`cache_clear`, tee stream, cancel-safe retry sleep)
- [ ] `backend/tests/test_provider_anthropic.py` 스켈레톤 1 개 (AsyncMock 으로 stream 시뮬레이션)
- [ ] `conftest.py` 에 `connected_providers.cache_clear()` autouse fixture
- [ ] 본 skill body 에 외부 reference 경로 토큰 없음

## 구현 중 막히면

- "Model id 가 alias 이라서 못 찾음" → `_FUZZY_MAP` 에 alias 추가. key 는 반드시 lowercase.
- "Stream 을 forward 하면서 수집이 안 됨" → tee 패턴, `asyncio.Queue` 두 개로 분기.
- "Retry 가 무한 루프 같다" → `max_attempts` 명시 + sleep cap + exception type 정확히 분류. 429 는 재시도, `AuthError` 는 즉시 raise.
- "Test 에서 `connected_providers` 값이 이상함" → `cache_clear` 호출 누락. autouse fixture 추가.
- "Anthropic vs OpenAI tool 포맷이 섞임" → 각 Provider 클래스 내부에서만 변환. Agent Loop 에 provider-native 포맷이 새어 나가면 안 됨.
- 위 가이드로도 안 풀리면: 사용자에게 직접 보고 + 판단 요청.
