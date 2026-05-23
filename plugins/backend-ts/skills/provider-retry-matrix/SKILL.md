---
name: provider-retry-matrix
description: Provider 추상화, retry/fallback 매트릭스, circuit breaker, model resolution invariant. OpenRouter default, provider SDK escape hatch.
metadata:
  role: invariant
  scope: project
---

**적용된 §4.4 매트릭스 행**: HTTP 클라이언트 (httpx.AsyncClient → fetch), Retry (tenacity → p-retry 또는 수동 exponential backoff), 환경변수 (os.getenv → `<framework env binding>`), 에러 (Python framework HTTP exception → `<framework HTTP error class>`)

> Language-neutral invariants — Provider abstraction, retry/fallback matrix, circuit breaker, model resolution.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/ai-provider-patterns.md`, `ts_agent_rules/ai-provider-patterns.md`.

# Provider Layer — 언어 무관 불변식

## 지원 Provider (6 type)

| type key | 용도 |
|----------|------|
| `anthropic` | Anthropic 직접 |
| `openai` | OpenAI 직접 |
| `openai_compatible` | vLLM / Ollama / TGI / 자체 OpenAI 호환 엔드포인트 |
| `google` | Google Gemini |
| `openrouter` | OpenRouter (다중 모델 aggregator) |
| `local` | 로컬 OSS 런타임 어댑터 (llama.cpp / LM Studio / MLX 등) |

`openai_compatible` 은 **별개 클래스** — 동일 SDK 를 쓰되 인증/endpoint 처리를 셀프호스팅 맞춤.

Azure OpenAI / AWS Bedrock 은 현재 미지원 — 필요 시 새 provider 추가.

## Provider 추상화 5원칙

1. **타입 경계** — SDK 타입 → 내부 타입 (`Message`, `ContentBlock`) 즉시 변환. 내부 전파 금지
2. **패턴 라우팅** — 모델 ID 로 라우팅. 호출자는 구체 provider 모름
3. **단일 변환** — 변환은 각 provider 의 `convertTo / convertFrom` 1곳. `converter` 모듈은 dispatch 만
4. **Protocol DI** — 호출자는 `ProviderProtocol` (TS `interface`) 에만 의존
5. **Stateless** — config + client 만. 요청 간 mutable state 금지

## Retryable 에러 (4종만)

| 에러 | 재시도 | Fallback 전환 조건 |
|------|--------|-------------------|
| `RATE_LIMIT` (429) | 예 | chain 소진 시 |
| `TIMEOUT` | 예 | 재시도 실패 시 |
| `SERVER_ERROR` (5xx) | 예 | circuit open 시 |
| `CONNECTION_ERROR` | 예 | fallback 즉시 전환 |

그 외 (auth, validation, quota) → **즉시 실패**, 재시도/fallback 금지.

TS 구현: `p-retry` 라이브러리 또는 수동 exponential backoff:

```ts
// 공통 helper (재사용 가능)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// p-retry 예시
import pRetry from 'p-retry';
const result = await pRetry(() => fetch(url, init), { retries: 3, minTimeout: 100 });

// 수동 예시
for (let i = 0; i < 3; i++) {
  try { return await callProvider(req); }
  catch (e) { if (!isRetryable(e)) throw e; await sleep(2 ** i * 100); }
}
```

## Fallback Chain

- 운영자가 `config/providers.yaml` 의 `fallback_chains` 에 정의. 사용자에게 노출 안 됨
- chain 이름으로 에이전트 YAML 에서 참조 (`model_preference: default`)
- 호출 실패 (retryable) → chain 다음 모델로 즉시 재시도
- chain 소진 → 에러 반환
- **Fork agent 는 fallback 없이 parent model 고정** — cache stability (design-principles §3, `skills/spawn-limits/SKILL.md`)

## CircuitBreaker (4-state)

```
CLOSED → OPEN → HALF_OPEN → CLOSED
```

- Provider 별 독립 (per-provider circuit)
- 연속 실패 N회 → `OPEN` (추가 호출 즉시 reject)
- cooldown 후 → `HALF_OPEN` (첫 동시 호출 1개만 probe)
- probe 성공 → `CLOSED`, 실패 → `OPEN` 복귀
- 정확한 threshold / cooldown 은 `circuit_breaker` 모듈 상수 (rule 은 상태만)

## Model Capabilities (6단계 해석 순서)

| 단계 | 소스 | 용도 |
|------|------|------|
| 1 | override config | 운영자 강제 지정 (디버그 / 임시 제약) |
| 2 | `ProviderConfig.custom_models` | 파인튜닝 / 셀프호스팅 자기 선언 |
| 2.5 | OpenRouter live catalog | OpenRouter 모델 ID 에 한해 실시간 (TTL 캐시) |
| 3 | models.dev API | hourly cache, 메이저 provider 자동 최신화 |
| 4 | bundled snapshot (`bundled_models.json`) | 네트워크 실패 fallback |
| 5 | heuristic | 모델 이름 패턴 추론 (WARNING 로그) |

`ModelCapabilities` 필드 (현재): `context_window`, `max_output`, `supports_tools`, `supports_thinking`, `supports_reasoning_effort`, `supports_streaming`, `supports_vision`.

## ProviderConfig 스키마

```yaml
<name>:
  type: <registry_key>        # 6 type 중 하나
  base_url: <url> | null       # 커스텀 엔드포인트 (셀프호스팅)
  credentials: <dict>          # provider 별 다름
  enabled: <bool>
  custom_models: <list>        # 파인튜닝 / 셀프호스팅 자기 선언 (선택)
```

환경변수 접근: framework env binding (예: `<framework env binding>.OPENROUTER_API_KEY`) 만 사용 — 글로벌 process env 직접 read 금지 (runtime-specific bypass — instance 측 project-local skill 참조).

Credentials: `api_key` (Anthropic / OpenAI / OpenRouter), `api_key` 또는 `service_account_json` (Google), 셀프호스팅용 `api_key` (openai_compatible / local).

## Pricing

- 정적 dict `MODEL_COSTS` — key 는 모델 카탈로그 id 와 일치
- `ModelCosts` 타입: input / output / cache_read / cache_creation 단가
- 런타임 overlay 가능 (`registerCatalogCosts` — openrouter catalog refresh 등)
- unknown 모델은 `DEFAULT_UNKNOWN_COSTS` + WARNING

## 파라미터 호환성 (provider 별 차이 흡수)

- `filterRequestParams(caps, params)` — capability 기반 자동 drop/clamp
  - 예: `reasoning_effort` 미지원 시 drop
  - 예: `temperature` clamp 0~2
  - 예: `max_tokens > caps.max_output` 시 clamp
- 각 provider 의 `convertTo` 가 SDK param name 변환 (예: `thinking_budget_tokens` → Anthropic `extra_body`)

## 빌드 / 부팅 순서

1. 각 provider 모듈 import → `registerProviderClass()` 가 `PROVIDER_REGISTRY` 에 자가 등록 (side effect)
2. `bootstrap` / `lifespan` 이 `config/providers.yaml` 파싱 → `ProviderRegistry` 인스턴스 생성
3. models.dev 첫 fetch — 백그라운드 비동기 (예: `Promise.all` + runtime-specific background task scheduler; 실패해도 부팅 차단 안 함. 구체 메커니즘은 instance 측 project-local skill 참조)
4. OpenRouter catalog prewarm — 설정 시에만
5. `ModelRouter` 생성 → agent 의 `model_preference` chain 해석 준비 완료

## 입력측 안전 게이트 SDK import 예외

- `services/moderation/openai_provider` 와 `services/jailbreak/*_provider` 는 OpenAI / Hugging Face transformers SDK 를 직접 import
- 이들은 LLM 호출 chain 이 아니라 `ModerationPort` / `JailbreakPort` 의 구현체 (`skills/input-safety-gate-ordering/SKILL.md`)
- `providers/` 의 단일 변환 / fallback chain 규율과 직교 — audit grep 이 이 경로를 잡아도 violation 이 아님

## 공통 금지 사항 (언어 무관)

- `PROVIDER_REGISTRY` 런타임 mutate (부팅 후 등록/제거)
- 각 provider 밖에서 SDK 타입 변환 (단일 변환 원칙)
- `converter` 모듈에 실제 변환 로직 작성 (dispatch 만)
- Fork agent 에서 fallback chain 순회 (parent model 고정 — cache stability)
- 외부 SDK 타입을 호출자까지 전파 (경계에서 변환)
- `CircuitBreaker` 우회하는 직접 호출 경로
- 재시도 대상 아닌 에러를 재시도 (무한 루프 위험)
- `MODEL_COSTS` 없이 신규 모델 등록 (unknown cost 로 추적 불가)
- `bundled_models.json` 과 `MODEL_COSTS` 의 모델 id 불일치 (pricing lookup 실패)
- models.dev live fetch 결과를 테스트에서 사용 (테스트는 mock 주입)
