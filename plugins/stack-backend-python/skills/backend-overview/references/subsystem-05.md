> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/ai-provider-patterns.md` + live implementation under `backend/providers/` + `backend/services/model_resolution.py`.

# Subsystem 05 — Provider Layer

## 목적 (1줄)

Anthropic/OpenAI/Google 등 LLM 프로바이더를 추상화하여 에이전트 루프가
provider-agnostic하게 동작하도록 한다.

## 파일 / 모듈

- `backend/providers/base.py` — Provider Protocol + Message/ContentBlock 타입
- `backend/providers/registry.py` — 프로바이더 등록 + 모델 resolution + fallback
- `backend/providers/anthropic.py` — Anthropic 구현
- `backend/providers/openai.py` — OpenAI 구현
- `backend/providers/google.py` — Google 구현
- `backend/services/model_resolution.py` — 모델 선택 파이프라인
- `backend/services/api/{client,retry,errors,logging,usage}.py` — API 호출 인프라

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `Provider` (Protocol) | `name`, `call()`, `list_models()` |
| `Provider.call(messages, system_prompt, tools, model, stream)` | AsyncIterator[StreamEvent] 반환 |
| `Message` | unified 내부 타입 (role, content blocks) |
| `ContentBlock` | text / tool_use / tool_result / thinking |
| `StreamEvent` | provider-neutral 스트림 이벤트 |
| `resolve_model(agent, user_override?)` | 4단계 resolution 파이프라인 |
| `RetryPolicy` | `max_retries`, `base_delay_ms`, `max_delay_ms`, `retryable_status` |

## Model Resolution Pipeline (우선순위)

1. 사용자 명시 지정 (요청 시 `model` 파라미터)
2. 에이전트의 `model_preference` 첫 번째 사용 가능 모델
3. fallback chain 순회
4. 시스템 기본 모델 (`config.DEFAULT_MODEL`)

## 재시도 정책

```python
@dataclass
class RetryPolicy:
    max_retries: int = 3
    base_delay_ms: int = 1000
    max_delay_ms: int = 30000
    retryable_status: set[int] = {429, 500, 502, 503}
    retry_on_timeout: bool = True
```

Foreground 모드: `max_retries=2`로 빠른 실패. Background 모드: `max_retries=5`.

## API 클라이언트 레이어

| 모듈 | 역할 |
|---|---|
| `client.py` | httpx async 래퍼, 타임아웃, 커넥션 풀 |
| `retry.py` | 지수 백오프 재시도 |
| `errors.py` | 프로바이더 에러 → 통일된 `ProviderError` |
| `logging.py` | 요청 ID, 레이턴시, 토큰 수 구조화 로깅 |
| `usage.py` | 응답에서 토큰 사용량 추출 → `state/cost.py` |

## 담당 skill

`provider-layer` — 새 Provider 클래스 작성 전 반드시 로드.

## 범위

- Provider Protocol 완성
- 멀티 provider 지원 (Anthropic, OpenAI, Google 등)
- unified Message/ContentBlock 타입 확정
- Model resolution pipeline — 연결된 모든 provider의 모델을 대상으로 resolution
- 구현 방식 (직접 빌드 vs LiteLLM 하이브리드 등) 은 논의 중

## Gotchas

- **provider raw 타입을 외부에 노출 금지**: Anthropic SDK의 `MessageParam` 같은
  타입을 engine/loop에 유출하면 multi-provider가 불가능해진다 (unified Message/ContentBlock 위반).
- **스트림 이벤트 변환은 adapter 경계**: provider별 stream chunk → StreamEvent는
  반드시 provider 모듈에서 처리.
- **API 키 복호화는 call 시점**: `Provider.__init__`에서 키를 메모리에 캐시하면
  dual auth 위반 (평생 보관).

## 관련 AD

- multi-provider (멀티 프로바이더) — 본 서브시스템의 존재 이유
- unified Message/ContentBlock (unified Message/ContentBlock) — 내부 타입 통일
- dual auth (프로바이더 키 암호화) — client.py에서 요청 시점 복호화
