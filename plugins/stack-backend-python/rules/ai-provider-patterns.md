---
paths:
  - "backend/providers/**"
  - "backend/services/model_resolution.py"
---

> App backend rules — Multi-Provider module invariants, extension guide, impact map.
> **정본:** `_shared/provider-retry-matrix.md` (6 provider type / 5 추상화 원칙 / 4 retryable 에러 / fallback chain / 4-state circuit breaker / 6-단계 capabilities — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `error-handling.md` (예외 계층), `sub-agent-patterns.md` (model override),
>       `config-management.md` (credentials), `design-principles.md` (§3 캐시 안정성)

# ai-provider-patterns — 멀티 프로바이더 모듈

> **Scope:** `backend/providers/` + `backend/services/model_resolution.py`.

## 불변식 (Invariants)

### 지원 Provider

`PROVIDER_REGISTRY` 에 등록된 **6 type**:

| type key | 구현 | 용도 |
|----------|------|------|
| `anthropic` | `anthropic.py::AnthropicProvider` | Anthropic 직접 |
| `openai` | `openai.py::OpenAIProvider` | OpenAI 직접 |
| `openai_compatible` | `openai.py::OpenAICompatibleSelfHostedProvider` | vLLM / Ollama / TGI / 자체 OpenAI 호환 엔드포인트 |
| `google` | `google.py::GoogleProvider` | Google Gemini |
| `openrouter` | `openrouter.py::OpenRouterProvider` | OpenRouter (다중 모델 aggregator) |
| `local` | `local.py::LocalProvider` | 로컬 OSS 런타임 어댑터 (llama.cpp / LM Studio / MLX 등) |

`openai_compatible` 은 **별개 클래스** 로 구현됨 — 설정만으로 추가되지 않음. 동일 SDK 를 쓰되 인증/endpoint 처리를 셀프호스팅 맞춤.

### 모듈 구조

| 파일 | 역할 |
|------|------|
| `base.py` | `ProviderProtocol` + `PROVIDER_REGISTRY` (type → class, write-once) + `register_provider_class()` |
| `registry.py` | `ProviderRegistry` — 인스턴스 등록 + connected 상태 |
| `router.py` | `ModelRouter` — fallback chain resolution + `call_with_fallback` |
| `capabilities.py` | `ModelCapabilities` 타입 + `resolve_capabilities()` 6단계 해석 |
| `compatibility.py` | 요청 설정 ↔ 모델 능력 호환성 검증 + 자동 filter/clamp |
| `converter.py` | 변환 dispatch → 각 provider 의 `_convert_to/from()` |
| `config.py` | `ProviderConfig`, `FallbackChain`, `Credentials`, `CustomModel` 타입 |
| `pricing.py` | `ModelCosts` + `MODEL_COSTS` 정적 dict + `register_catalog_costs()` overlay |
| `circuit_breaker.py` | `CircuitBreaker` (CLOSED / OPEN / HALF_OPEN) |
| `bootstrap.py` | 부팅 시 provider 인스턴스화 + prewarm |
| `chain_writer.py` | `/debug/providers/*` 에서 fallback chain 런타임 갱신 |
| `openrouter_catalog.py` | OpenRouter live catalog fetch + TTL 캐시 |
| `_openai_base.py` | OpenAI-compatible 공통 구현 (openai / openrouter / 셀프호스팅 공유) |
| `_token_utils.py` | tokenizer 근사치 유틸 |
| `anthropic.py`, `openai.py`, `google.py`, `openrouter.py`, `local.py` | provider 별 구현 |

### Provider 추상화 5원칙

1. **타입 경계** — SDK 타입 → 내부 타입 즉시 변환. 내부 전파 금지
2. **패턴 라우팅** — 모델 ID 로 라우팅. 호출자는 구체 provider 모름
3. **단일 변환** — 변환은 각 provider 의 `_convert_to/from()` 1곳. `converter.py` 는 dispatch 만
4. **Protocol DI** — 호출자는 `ProviderProtocol` 에만 의존
5. **Stateless** — config + client 만. 요청 간 mutable state 금지

### ProviderConfig 스키마

```yaml
<name>:
  type: <registry_key>        # 6 type 중 하나 (위 표)
  base_url: <url> | null       # 커스텀 엔드포인트 (셀프호스팅)
  credentials: <dict>          # provider 별 다름 — 상세는 config.py::Credentials
  enabled: <bool>
  custom_models: <list>        # 파인튜닝 / 셀프호스팅 자기 선언 (선택)
```

Credentials 구체 스키마는 `config.py` 가 정본. 현재 지원: `api_key` (Anthropic / OpenAI / OpenRouter), `api_key` 또는 `service_account_json` (Google), 셀프호스팅용 `api_key` (openai_compatible / local). **Azure OpenAI / AWS Bedrock 은 현재 미지원** — 필요 시 새 provider 추가 (아래 §새 provider 추가하기).

### Model Capabilities (6단계 해석)

| 단계 | 소스 | 용도 |
|------|------|------|
| 1 | override config | 운영자 강제 지정 (디버그 / 임시 제약) |
| 2 | `ProviderConfig.custom_models` | 파인튜닝 / 셀프호스팅 자기 선언 |
| 2.5 | OpenRouter live catalog | OpenRouter 모델 ID 에 한해 실시간 (TTL 캐시) |
| 3 | models.dev API | hourly cache, 메이저 provider 자동 최신화 |
| 4 | bundled snapshot | 네트워크 실패 fallback (`bundled_models.json`) |
| 5 | heuristic | 모델 이름 패턴 추론 (WARNING 로그) |

구현: `capabilities.py::resolve_capabilities()`. Stage 순서는 코드에 고정 — rule 은 순서만 보장.

### Fallback Chain

- 운영자가 `config/providers.yaml` 의 `fallback_chains` 에 정의. 사용자에게 노출 안 됨
- chain 이름으로 에이전트 YAML 에서 참조 (`model_preference: default`)
- 호출 실패 (retryable) → chain 다음 모델로 즉시 재시도
- chain 소진 → 에러 반환
- **Fork agent 는 fallback 없이 parent model 고정** (cache stability, design-principles §3)

### Retryable 에러 (4종만)

| 에러 | 재시도 | Fallback 전환 조건 |
|------|--------|-------------------|
| `RATE_LIMIT` (429) | 예 | chain 소진 시 |
| `TIMEOUT` | 예 | 재시도 실패 시 |
| `SERVER_ERROR` (5xx) | 예 | circuit open 시 |
| `CONNECTION_ERROR` | 예 | fallback 즉시 전환 |

그 외 (auth, validation, quota) → 즉시 실패, 재시도/fallback 금지.

### CircuitBreaker

- Provider 별 독립. `CLOSED → OPEN → HALF_OPEN → CLOSED`
- 연속 실패 N회 → OPEN (추가 호출 즉시 reject)
- cooldown 후 → HALF_OPEN (첫 동시 호출 1개만 probe)
- probe 성공 → CLOSED, 실패 → OPEN 복귀
- 정확한 threshold / cooldown 은 `circuit_breaker.py` 상수 (rule 은 상태만)

### Message Converter (dispatch 패턴)

- `converter.py` 는 dispatch 만
- 실제 변환은 각 provider 의 `_convert_to()` / `_convert_from()`
- provider 내부에 변환 로직 격리 (단일 변환 원칙)

## 데이터 소스 맵 (구체 값은 코드 정본)

새 provider 추가 또는 기존 provider 확장 시 **어디를 건드려야 하는지** 위치 가이드. 구체 값 (모델 ID, 가격 숫자, context window 등) 은 rule 에서 관리하지 않음 — 자주 변경되어 drift 위험.

### 모델 카탈로그 (어떤 모델이 존재하나)

| 소스 | 파일 / 경로 | 갱신 빈도 |
|------|------------|----------|
| 정적 스냅샷 | `backend/providers/bundled_models.json` | manual, 릴리스 시 |
| OpenRouter live | `backend/providers/openrouter_models.json` (캐시) + `openrouter_catalog.py` fetch | TTL 기반 |
| models.dev API | `https://models.dev/api/models.json` — `capabilities.py:43` | hourly (runtime fetch) |
| 운영자 선언 | `config/providers.yaml` 의 `custom_models: [...]` | 운영자 편집 |

### Capability 필드 정의

- 타입: `ModelCapabilities` pydantic (`capabilities.py::ModelCapabilities`)
- 필드는 코드가 정본 (현재: `context_window`, `max_output`, `supports_tools`, `supports_thinking`, `supports_reasoning_effort`, `supports_streaming`, `supports_vision`)
- 해석 순서 (6단계) 는 위 §Model Capabilities 참조

### Pricing

| 경로 | 역할 |
|------|------|
| `pricing.py::MODEL_COSTS` | 정적 dict — key 는 `bundled_models.json` id 와 일치 |
| `pricing.py::ModelCosts` | pydantic 타입 (input / output / cache_read / cache_creation 단가) |
| `pricing.py::register_catalog_costs(provider, {model: ModelCosts})` | 런타임 overlay (openrouter catalog refresh 등) |
| `pricing.py::get_model_costs(model, provider=...)` | 조회 API — unknown 은 `DEFAULT_UNKNOWN_COSTS` + WARNING |

### 파라미터 호환성 (provider 별 차이 흡수)

| 경로 | 역할 |
|------|------|
| `compatibility.py::filter_request_params(caps, params)` | capability 기반 자동 drop/clamp (예: `reasoning_effort` 미지원 시 drop, `temperature` clamp 0~2, `max_tokens > caps.max_output` 시 clamp) |
| `compatibility.py::is_compatible(caps, params)` | 호환성 boolean 체크 |
| 각 provider 의 `_convert_to()` | SDK param name 변환 (예: `thinking_budget_tokens` → Anthropic extra_body, `reasoning_effort` → OpenAI effort 필드) |

### 빌드 / 부팅 순서

1. 각 provider 모듈 import → `register_provider_class()` 가 `PROVIDER_REGISTRY` 에 자가 등록 (side effect, `providers/__init__.py` 가 트리거)
2. `bootstrap.py` / `main.py` lifespan 이 `config/providers.yaml` 파싱 → `ProviderRegistry` 인스턴스 생성
3. models.dev 첫 fetch — 백그라운드 비동기 (실패해도 부팅 차단 안 함)
4. OpenRouter catalog prewarm — 설정 시에만 (`POST /debug/providers/openrouter/refresh-catalog` 로 수동 refresh 가능)
5. `ModelRouter` 생성 → agent 의 `model_preference` chain 해석 준비 완료

## 새 provider 추가하기 (직접 구현)

Anthropic/OpenAI/Google 같은 unique provider 추가 시:

1. `providers/{name}.py` — `ProviderProtocol` 구현
2. 같은 파일에 `_convert_to()` / `_convert_from()` 구현
3. 파일 끝에서 `register_provider_class("{name}", NewProvider)` 호출 → `PROVIDER_REGISTRY` 자가 등록
4. `config.py::Credentials` 에 새 필드 필요 시 추가 (Azure 의 `api_version` 등)
5. `.env.example` 에 API key 환경변수 추가
6. 모델 카탈로그:
   - 소수 모델이면 `custom_models` 로 `providers.yaml` 에 선언
   - 메이저 provider 면 `bundled_models.json` 에 추가 + `pricing.py::MODEL_COSTS` 에 가격 등록
   - models.dev 가 해당 provider 지원하면 런타임 자동 갱신 (추가 작업 불필요)
7. 기본 fallback chain 에 필요 시 포함
8. 테스트: 정상 호출, streaming, 각 에러 유형 (retryable 4종), circuit breaker 전이

## OpenAI-compatible 셀프 호스팅 추가하기 (설정만)

vLLM / Ollama / TGI / 자체 OpenAI-compatible 엔드포인트 추가 시 **코드 변경 없음**:

1. `config/providers.yaml` 에 entry 추가:
   ```yaml
   my_writer_v3:
     type: openai_compatible
     base_url: http://vllm.internal:8000/v1
     credentials: { api_key: ${VLLM_KEY} }
     custom_models:
       - id: app-writer-v3
         context_window: 32000
         supports_tools: true
   ```
2. 가격 필요 시 `pricing.py::MODEL_COSTS` 에 수동 추가 (셀프호스팅은 models.dev 미제공)
3. 필요 시 fallback chain 에 포함
4. 부팅 시 자동 등록 (`bootstrap.py`)

## 새 fallback chain 추가하기

1. `config/providers.yaml` 의 `fallback_chains` 에 chain 이름 + 항목 추가
2. 에이전트 YAML 에서 `model_preference: {chain_name}` 참조
3. chain 내 모든 모델이 capabilities 해석 가능한지 확인 (custom_models / models.dev / bundled / heuristic 중 하나 매칭)

## 사용자 모델 선택 기능 추가 (미래)

1. `router.py` 의 `resolve()` 에 user preference 분기 추가 (우선순위 최상위)
2. user plan 에서 허용된 모델인지 검증 로직 추가
3. 나머지 모듈 변경 없음

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `PROVIDER_REGISTRY` type key 추가/변경 | 모든 `config/providers.yaml` 의 `type` 필드 |
| `ProviderProtocol` 메서드 추가 | 모든 provider 구현체 + mock 동시 업데이트 |
| 내부 Message/ContentBlock 변경 | 모든 provider 의 `_convert_to/from` + engine + tools |
| `Credentials` 스키마 변경 | 해당 provider 전체 환경 (dev/staging/prod) |
| fallback chain 순서 변경 | 어떤 모델이 선택되는지 전면 변경 |
| capabilities 해석 순서 변경 | 같은 모델의 능력 판정이 달라질 수 있음 |
| `bundled_models.json` 변경 | Stage 4 fallback 이 달라짐 — 네트워크 장애 시 동작 변화 |
| `pricing.py::MODEL_COSTS` 키 변경 | 해당 모델의 비용 추적이 `DEFAULT_UNKNOWN_COSTS` 로 떨어짐 (WARNING) |
| `compatibility.py` 규칙 변경 | 모델에 전달되는 파라미터 변경 → 응답 품질 영향 |
| `CircuitBreaker` 파라미터 변경 | 장애 복구 속도 / 불필요 차단 시간 |
| `_openai_base.py` 변경 | openai + openrouter + 모든 셀프호스팅 동시 영향 |
| retry 정책 변경 | 비용 / 지연 / 사용자 체감 |
| models.dev fetch 간격 변경 | capability 최신성 vs 외부 의존성 |

## 금지 사항

- `PROVIDER_REGISTRY` 런타임 mutate (부팅 후 등록/제거)
- 각 provider 밖에서 SDK 타입 변환 (단일 변환 원칙)
- `converter.py` 에 실제 변환 로직 작성 (dispatch 만)
- Fork agent 에서 fallback chain 순회 (parent model 고정 — cache stability)
- 외부 SDK 타입을 호출자까지 전파 (경계에서 변환)
- `CircuitBreaker` 우회하는 직접 호출 경로
- 재시도 대상 아닌 에러를 재시도 (무한 루프 위험)
- `pricing.py::MODEL_COSTS` 없이 신규 모델 등록 (unknown cost 로 추적 불가)
- `bundled_models.json` 과 `MODEL_COSTS` 의 모델 id 불일치 (pricing lookup 실패)
- models.dev live fetch 결과를 테스트에서 사용 (테스트는 `modelsdev_lookup` 파라미터로 주입)

**예외 — 입력측 안전 게이트 SDK import:**

- `backend/services/moderation/openai_provider.py` 와 `backend/services/jailbreak/*_provider.py` 는 OpenAI / Hugging Face transformers SDK 를 직접 import 한다. 이들은 LLM 호출 chain 이 아니라 `ModerationPort` / `JailbreakPort` 의 구현체로, `architecture.md` 에서 별도 Port 로 분리되어 있다. `backend/providers/` 의 단일 변환 / fallback chain 규율과 직교 — audit grep 이 이 경로를 잡아도 violation 이 아니다.
