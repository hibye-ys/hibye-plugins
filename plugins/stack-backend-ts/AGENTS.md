# stack-backend-ts-hono

`apps/api` 같은 *Hono + TypeScript* 백엔드 작업 시 적용. Cloudflare Workers 호환 룰 처음부터 강제.

## 백엔드 영역 룰

<!-- ━━━ inlined from ./rules/hono-workers-compat.md ━━━ -->

# Hono Backend — Web 표준 (Workers 호환) 룰

본 디렉토리 안 모든 파일 작업 시 적용. 공통 invariant 는 root `AGENTS.md` 참고.

## 런타임

Node (`@hono/node-server`) — 로컬 dev 편의. 단 **Cloudflare Workers 호환 코드 룰** 을 처음부터 지킨다.

## OK (Web 표준)

- `fetch`, `Request`, `Response`, `ReadableStream`, `URL`, `URLSearchParams`, `crypto.subtle`
- Hono `Context`, `c.req`, `c.json`, `c.env`
- `streamText` / `streamUI` 등 Vercel AI SDK
- `zod` 검증

## NG (Node-only API, Workers 부정합)

- `fs` / `fs/promises` — 파일 시스템 접근 X
- `child_process` — 외부 프로세스 호출 X
- `path` — Web 표준 `URL` 사용
- `Buffer` — `Uint8Array` 또는 `ArrayBuffer` 사용
- `process.env.X` 직접 read — 대신 Hono `c.env.X` 패턴 (양쪽 호환)
- Node Stream API (`stream` 모듈) — `ReadableStream` / `WritableStream` 사용
- `http` / `https` 모듈 — `fetch` 사용

## 환경변수

`c.env.OPENROUTER_API_KEY` 패턴. Node 에선 어댑터가 `process.env` 채워주고, Workers 에선 wrangler 가 채워줌.

## Escape hatch (격리 어댑터 안에서만 Node API OK)

- `apps/api/src/storage/provider.ts` 의 LocalFsProvider → R2 swap 시 통째 교체될 어댑터라 `fs` 사용 OK
- `apps/api/src/env.ts` → dotenv 로딩 (Node only, 부트스트랩)
- 그 외 일반 서버 코드에선 위 NG 룰 그대로 적용

## LLM 추상화 가이드

OpenRouter default 자체는 root `AGENTS.md`. 본 디렉토리 구현 시 추가 룰:

- **얇은 provider swap 어댑터 OK** — chain / agent / memory 자체 추상화는 ✕
- 추상화 부풀림 신호 = 12 개월 후 LangChain 닮은 자체 layer 가 자라남

## on-demand 체크리스트

- `verify-workers-compat` — Node-only API (`fs`, `Buffer`, `path`, `process.env` direct read 등) 사용 검출. backend 작업 마무리 단계에 실행.

## 관련 spec

- `docs/superpowers/specs/2026-05-21-shared-agent-marketplace-design.md` §3.2 (L2 backend stack), §5.3 (상시 룰 vs on-demand 분리), §10.M1

---

## 상시 적용 invariant 16개

> Claude Code 가 plugin install 후 fresh 세션 시작 시 다음 invariant 본문이 *상시 노출*. Workers 호환 / SSE lifecycle / provider retry 등 *불변* 룰 자동 적용.


<!-- ━━━ inlined from ./skills/workers-compat/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: N/A (M1 산출, Python source 없음)

# Hono Backend — Web 표준 (Workers 호환) 룰

본 디렉토리 안 모든 파일 작업 시 적용. 공통 invariant 는 root `AGENTS.md` 참고.

## 런타임

Node (`@hono/node-server`) — 로컬 dev 편의. 단 **Cloudflare Workers 호환 코드 룰** 을 처음부터 지킨다.

## OK (Web 표준)

- `fetch`, `Request`, `Response`, `ReadableStream`, `URL`, `URLSearchParams`, `crypto.subtle`
- Hono `Context`, `c.req`, `c.json`, `c.env`
- `streamText` / `streamUI` 등 Vercel AI SDK
- `zod` 검증

## NG (Node-only API, Workers 부정합)

- `fs` / `fs/promises` — 파일 시스템 접근 X
- `child_process` — 외부 프로세스 호출 X
- `path` — Web 표준 `URL` 사용
- `Buffer` — `Uint8Array` 또는 `ArrayBuffer` 사용
- `process.env.X` 직접 read — 대신 Hono `c.env.X` 패턴 (양쪽 호환)
- Node Stream API (`stream` 모듈) — `ReadableStream` / `WritableStream` 사용
- `http` / `https` 모듈 — `fetch` 사용

## 환경변수

`c.env.OPENROUTER_API_KEY` 패턴. Node 에선 어댑터가 `process.env` 채워주고, Workers 에선 wrangler 가 채워줌.

## Escape hatch (격리 어댑터 안에서만 Node API OK)

- `apps/api/src/storage/provider.ts` 의 LocalFsProvider → R2 swap 시 통째 교체될 어댑터라 `fs` 사용 OK
- `apps/api/src/env.ts` → dotenv 로딩 (Node only, 부트스트랩)
- 그 외 일반 서버 코드에선 위 NG 룰 그대로 적용

## LLM 추상화 가이드

OpenRouter default 자체는 root `AGENTS.md`. 본 디렉토리 구현 시 추가 룰:

- **얇은 provider swap 어댑터 OK** — chain / agent / memory 자체 추상화는 ✕
- 추상화 부풀림 신호 = 12 개월 후 LangChain 닮은 자체 layer 가 자라남

<!-- ━━━ inlined from ./skills/single-writer/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 동시성 (asyncio.gather → Promise.all/allSettled), Lock (asyncio.Lock → async-mutex `new Mutex()` 또는 advisory SQL lock `pg_advisory_xact_lock`)

> Language-neutral invariants — Single-writer pattern, atomic write, per-resource locking.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/data-layer-patterns.md`, `ts_agent_rules/data-layer-patterns.md`,
>             `python_agent_rules/architecture.md`, `ts_agent_rules/architecture.md`.

# Single Writer — 언어 무관 불변식

## 원칙

동일 자원의 **쓰기 경로는 1개로 제한**. 읽기는 복수 허용.

이유:
- 경쟁 조건 단일 지점 처리
- audit trail 집중
- 저장 백엔드 교체 용이
- crash-safety 보장 단일화

## 단일 작성자 자원 (3가지)

| 자원 | 경로 | 단일 작성자 |
|------|------|------------|
| Media job state | `data/media/jobs/<id>.json` | `WriteCoordinator.writeMediaJob` |
| Media output 바이너리 | `data/media/<id>/<file>` | `WriteCoordinator.writeMediaOutput` |
| User custom skill 본문 | `data/skills/user/<user>/<name>.md` | `WriteCoordinator.writeUserSkill` / `deleteUserSkill` |

세션 쓰기는 별도 — `state/session` (InMemory) 또는 `state/db_session` (DB) 가 단일 진입점, 호출자는 `SessionPort` interface 만 참조.

## 핵심 메커니즘

### 1. Atomic Write (temp + fsync + rename)

모든 쓰기는 `_atomicWrite` 패턴:

```
1. tmp 파일에 새 내용 write
2. fsync — disk flush 보장
3. rename(tmp, target) — atomic 교체
4. 실패 시 tmp unlink
```

→ crash-safe 불변. 부분 쓰기 / 손상 파일 발생 불가.

> ⚠️ Workers 환경 caveat: `fsync` / `rename` (Node fs API) 은 *escape hatch only* — `apps/api/src/storage/provider.ts` 의 `LocalFsProvider` 내부에서만 사용. Workers runtime 에서는 R2 / KV SDK 의 atomic put 패턴으로 대체 (예: `await c.env.R2_BUCKET.put(key, data, { onlyIf: { etagDoesNotMatch: oldEtag } })`).

### 2. Per-resource Lock

같은 자원에 대한 동시 쓰기는 lock 으로 직렬화:

- Per-job: `__media_job:<id>` lock
- Per-skill: `__user_skill:<user>:<name>` lock
- TS: `async-mutex` (`new Mutex()`) 또는 advisory SQL lock (`SELECT pg_advisory_xact_lock(...)`)

→ 같은 job 의 state 업데이트 + output 저장이 interleave 되지 않음.

### 3. WriteCoordinator 싱글턴

- `WriteCoordinator` 인스턴스는 **싱글턴 per data_dir**
- `getCoordinator(dataDir)` 헬퍼가 cache + 반환
- 여러 instance 생성 금지 — lock 격리 깨짐

### 4. 경로 헬퍼 단일 source

쓰기 경로 레이아웃은 **static method** 단일 source:

- `WriteCoordinator.userSkillRelpath(userId, name)` — DB / InMemory store 양쪽이 같은 helper 참조
- 직접 path 조립 금지 — drift 위험

## 멀티 워커 가정

- 현재: **싱글 프로세스** (단일 Node 프로세스 bind) 가정
- 멀티 워커 전환 시: process-local lock (`async-mutex`) → 파일 시스템 lock 또는 DB advisory lock 으로 교체 필요
- DB 모드는 transaction 자체가 직렬화 역할 — 별도 lock 불필요

## 읽기 경로 (복수 허용)

- Media job state 조회: `MediaJobPort.get` / `tryGet` (StoragePort abstraction). 파일 직접 read 금지
- Media 바이너리: response path (signed URL 또는 file://) 로 반환. backend 가 inline 로드 금지
- User skill 본문: `UserSkillPort.readBody(userId, name)` 경유

## 모듈 구조

```
ports.ts          (interface 선언)
   ↓
writer.ts         (단일 writer — WriteCoordinator)
   ↓
data/             (런타임 데이터 위치 — 파일/디렉토리)
```

- ports 모듈: `SessionPort` / `SessionHistoryPort` / `MediaJobPort` / `UserSkillPort` 만 선언. **interface 만** — 구체 구현체는 별도 분산
- writer 모듈: `WriteCoordinator` + `getCoordinator(dataDir)` 싱글턴
- LRU 유틸은 별도 모듈 (`utils/lru.ts::LRUDict`). hot read 캐시 (capacity=1024) — DB 모드에서는 사용 안 함

## `data/` vs `db/` 분리

| 계층 | 저장 매체 | 관리 대상 |
|------|-----------|-----------|
| `src/data/` | 파일 시스템 | 미디어 바이너리 + job state JSON + 유저 커스텀 skill 본문 markdown |
| `src/db/` | Postgres (drizzle / kysely) | 세션, 메시지, media job state, user_skills 메타, domain_mutations 감사 |

- `data/` 는 `db/` 를 import 안 함 (파일 시스템은 DB 독립)
- `db/` 는 `data/` 를 import 안 함 (ORM 자체 완결)
- 호출자 (state/, services/media/) 가 둘 중 선택 or Port interface 경유

## StoragePort 추상화

- 저장소 의존 컴포넌트는 interface 만 참조
- 구체 클래스 (`InMemorySessionStore`, `DbSessionStore`, `FileMediaJob`, `DbMediaJob`, `InMemoryUserSkillStore`, `DbUserSkillStore`) 은 **lifespan DI wiring 에서만** import 허용
- 같은 패턴이 입력측 안전 게이트에도 적용 (`skills/input-safety-gate-ordering/SKILL.md`)
- 이유: 파일/인메모리 ↔ DB 전환 시 호출자 코드 0줄 수정

## 공통 금지 사항 (언어 무관)

- `data/media/**` / `data/skills/user/**` 에 WriteCoordinator 우회 직접 write
- `data/extracted/**` 같은 디렉토리를 만들어 ground-truth 자체 보관 (도메인 경계 위반 — `skills/app-domain-boundary/SKILL.md`)
- user-state overlay 인프라 (`append_op` / `PatchOperation` / `UserStatePort` / `read_merged`) 재도입 — 별도 설계 승인 전 금지
- `WriteCoordinator` 인스턴스 여러 개 생성 (싱글턴 위반)
- 단일 writer 자원을 직접 read API (`JSON.parse(fs.readFileSync(...))` on raw file) 로 조회 (Port interface 경유)
- 호출자 코드가 concrete 구현체 (`DbSessionStore` / `FileMediaJob` 등) import (Port 만 참조)
- 경로 조립을 직접 (helper 우회) — static method 단일 source 깨짐
- `data/` ↔ `db/` 상호 import (저장 매체 분리 원칙 깨짐)

<!-- ━━━ inlined from ./skills/provider-retry-matrix/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: HTTP 클라이언트 (httpx.AsyncClient → fetch), Retry (tenacity → p-retry 또는 수동 exponential backoff), 환경변수 (os.getenv → c.env), 에러 (HTTPException(FastAPI) → HTTPException(hono/http-exception))

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

환경변수 접근: `c.env.OPENROUTER_API_KEY` (Hono `c.env`) — `process.env` 직접 read 금지.

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
3. models.dev 첫 fetch — 백그라운드 비동기 `Promise.all` / `c.executionCtx.waitUntil` (실패해도 부팅 차단 안 함)
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

<!-- ━━━ inlined from ./skills/token-budget-constants/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 토큰 카운트 (tiktoken → js-tiktoken)

> Language-neutral invariants — TokenBudget allocation, attachment ordering, partial loading thresholds.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/context-assembly-patterns.md`, `ts_agent_rules/context-assembly-patterns.md`.

# Token Budget — 언어 무관 불변식

## Token Budget 6 영역 (기준 모델 200K)

| 영역 | 토큰 | 전략 |
|------|------|------|
| BASE | 4,000 | 고정, truncate 불가 |
| AGENT | 8,000 | 고정, truncate 불가 |
| HINT | 500 | 2000자 컷 후 토큰 검증 |
| MEMORY | 16,000 | 최신순 LRU |
| CONVERSATION | 150,000 | Compaction 대상 (Stage 1 트리거) |
| RESERVED | 21,500 | output 예약 + tool overhead allocation (응답 생성 공간 확보 — output reservation 개념이며, compaction trigger threshold 와 다른 개념임. trigger SoT = `compaction-thresholds` 의 `SAFETY_BUFFER`) |
| **합계** | **200,000** | 기준 모델 (Claude 200K) context window |

## Provider 별 effective window 동적 스케일

- **Provider 별**: Anthropic 200K / OpenAI 128K / Google 1M+ 등
- 실제 `effective_window` 는 `provider.capabilities(model).context_window` 에서 조회
- 비-200K 모델: 영역별 비율 유지하며 스케일
  - 예: 128K 모델 → BASE 2,560 / AGENT 5,120 / MEMORY 10,240 / CONVERSATION 96,000 / RESERVED 13,760
- 정확한 스케일 로직은 `TokenBudget.forModel(model)` (TS static method) 에서 관리
- rule 은 비율·순서·불변만 정의, 정확한 상수는 코드에서 관리

토큰 카운트 구현: `js-tiktoken` (Workers 호환) 또는 Workers 호환 lite 카운터. `tiktoken` (Python/Node native) 는 Workers runtime 에서 사용 불가 — `js-tiktoken` 으로 대체.

## Compaction 트리거 조건

> **주의**: 트리거 공식의 단일 정본(SoT)은 `compaction-thresholds/SKILL.md` 의 `SAFETY_BUFFER` 상수.
> `RESERVED` 는 *output 영역 예약 + tool overhead 배정* 개념 — compaction trigger threshold 와 **다른 개념**이다.
> 두 상수(RESERVED=21,500 / SAFETY_BUFFER=13,000)는 역할이 다르므로 값이 달라도 모순이 아님.

```
trigger if current_input_tokens > effective_window - SAFETY_BUFFER
```
(trigger 상수 = `compaction-thresholds/SKILL.md` 의 `SAFETY_BUFFER`. 본 파일의 `RESERVED` 와 혼동 금지)

- `totalInput()` / `effectiveWindow()` 는 **instance method** (self 기반 합산)
- `forModel(modelId)` 만 static method (인스턴스 생성)

## 3-Layer System Prompt (순서 고정)

| Layer | 소스 | 변경 빈도 | 캐시 영향 |
|-------|------|----------|----------|
| 1. Base | `agents/prompts/base.md` | 극저 | prefix |
| 2. Agent | `agents/prompts/<agent>.md` | 저 | prefix |
| 3. Context hint (옵셔널) | 요청별 주입 | 고 | suffix |

- 합성 순서는 **base → agent → context_hint** 고정. 뒤바뀌면 cache prefix 무효화
- `buildSystemPrompt()` 는 동일 입력에 바이트 수준 동일 문자열 반환
- context_hint 는 `HINT_MAX_CHARS=2000` 초과 시 head + `...` 컷
- **Layer 1/2 에 동적 값 금지**: timestamp, turn_count, session_id, random seed 등 → messages 첫 user 또는 metadata 로 이동

## 프롬프트 .md 파일 관리 원칙

프롬프트는 코드가 아닌 **파일** 로 관리. 한 바이트 편집이 세션 전체 cache 무효화:

- 파일 끝 개행 추가/제거, trailing 공백 삽입, 탭↔스페이스 혼용 → prompt prefix bytes 달라짐 → prompt cache 히트 0%
- 에디터 자동 정리 (trim trailing whitespace, ensure newline at EOF) 가 범인인 경우 많음
- `.editorconfig` / pre-commit 훅으로 고정
- 무해해 보이는 "포맷 정리" 커밋이 토큰 비용 수 배 상승으로 이어짐

## Attachment 수집 순서 (변경 빈도 낮은 것 먼저, prefix cache 보호)

매 턴마다 Stage 1 은 고정 순서로 attachment 를 수집한다. 순서 변경 금지 — prompt cache prefix 가 무효화된다.

| 빈도 | 위치 | 예시 |
|------|------|------|
| 저빈도 | 앞쪽 | 에이전트 정의, 프로젝트 규칙 |
| 중빈도 | 중간 | memory block, nested rule |
| 고빈도 | 뒤쪽 | context hint, 최근 read 파일 |

**현재 vs 목표**: `AttachmentType` enum 은 **11 values** (현재 코드 기준). 디자인 spec 목표는 **17 types** (agents directory / commands / hooks / permissions 등 추가 예정). 순서/빈도 원칙은 동일하게 적용.

## SKILLS attachment 위치

- `AttachmentType.SKILLS` 의 ordinal 위치는 **9** (suffix 영역)
- 유저가 자주 편집하는 특성에 정합
- **ordinal 변경 금지** — 모든 세션 prompt cache prefix 무효화
- 본문은 `UserSkillPort.readBody(userId, name)` 에서 조회 후 `bodies` 파라미터로 주입
- 본문 없이 이름만 주면 header-only card 로 degrade

## Memory > History 보존 우선순위

- truncate 루프는 `memory_prefix_len` 인덱스부터 history 삭제. memory 구간(prefix) 은 건드리지 않음
- 뒤집으면 "사용자 등록 사실 증발" 버그 — 여러 턴 후 재현되어 추적 어려움
- 휘발성(history) < 영구성(memory) 원칙 고수

## Nested Memory Injection + Dual Dedup

- 파일 접근 시 CWD→대상 디렉토리까지 순회. 각 디렉토리의 AGENTS.md + 매칭 rules 수집
- **Dual dedup**: Non-evicting Set (재주입 방지, 항상 유지) + LRU (메모리 제한)
- Set 에 있으면 무조건 skip — LRU 가 evict 해도 Set 은 유지되어 재주입 안 됨
- 직접 append 금지 — 반드시 dedup 경유

## AssembledContext (Stage 1 산출물)

```
AssembledContext = (system_prompt, messages, tools, generation_params)
```

- 불변 (TS: `Readonly<AssembledContext>` 또는 frozen object). Stage 2+ 는 read-only 로 소비
- tools 는 `ToolRegistry.filterForAgent(...).definitions()` 로 제공 — API tools 파라미터로 별도 전달 (system prompt 에 inline 금지)
- Stage 1 이 끝난 후 system_prompt / messages 수정 금지

## 공통 금지 사항 (언어 무관)

- System prompt (Layer 1/2) 에 동적 값 삽입 (timestamp, turn_count, random)
- 도구 정의 결과를 system prompt 에 inline (반드시 API tools 파라미터로)
- Memory 구간을 history 보다 먼저 truncate
- Attachment 수집 순서를 런타임에 변경 (cache 무효화)
- Dual dedup 우회 직접 append (Set/LRU 양쪽에 반영되어야 함)
- TokenBudget 합계가 provider window 와 불일치
- AssembledContext 를 Stage 2 이후에 mutate
- Context hint 를 2000자 초과 그대로 주입 (반드시 컷)
- 영역별 토큰 수치를 비율 유지 없이 변경 (compaction 빈도 + cache miss 동반)

<!-- ━━━ inlined from ./skills/sse-lifecycle/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 스트리밍 (async generator → ReadableStream), SSE (EventSourceResponse(sse-starlette) → streamSSE(hono/streaming)), 큐·태스크 (asyncio.Queue → c.executionCtx.waitUntil), 프로세스 분리 (subprocess → Workers ✕)

> **정본** — App backend SSE 이벤트 lifecycle / 12 이벤트 집합 / 종료 보장 제약.
> 언어 무관 (Python / TS 공통). 양쪽 `*_agent_rules/sse-streaming-patterns.md`,
> `*_agent_rules/core-infrastructure.md`, 그리고 `frontend-contract.md` 에서 본 파일을
> 단일 source of truth 로 참조한다.

# SSE Lifecycle — 12 이벤트 정본

## 12 이벤트 집합 (고정)

```
session, agent, text, thinking, tool_call, tool_result, action, notification,
suggestions, usage, done, error
```

새 이벤트가 필요하다고 느껴지면 **대부분 기존 페이로드 확장으로 해결** 한다. 이벤트 타입 추가는 클라이언트 상태머신과 frontend-contract 모두 호환성 영향을 주므로 신중히 검토.

## Lifecycle 순서

```
session → agent → (text | thinking | tool_call | tool_result | action | notification)*
        → suggestions? → usage → done | error
```

- `session` 1회로 시작
- `agent` 1회 (현재 active agent 메타)
- 본문 이벤트 (text/thinking/tool_call/tool_result/action/notification) 0회 이상 반복
- `suggestions` 선택 (0 또는 1회)
- `usage` 1회
- `done` 또는 `error` 1회로 종료

## 종료 보장 4 제약

1. **`session` 이후 반드시 `done` 또는 `error` 로 종료.** 연결 drop 만으로 끝나면 안 됨 (서버측에서 의도적 종료 이벤트 emit 필수).
2. **`done` 과 `error` 는 배타.** 한 스트림에서 둘 다 보내지 않음.
3. **`usage` 는 `done` 직전에 전송** (token 수 / 비용 메타 누적치를 done 전 fence-line 으로 emit).
4. **SSE payload 에 session-wide 불변 메타 (token 수, 비용, model, session_id) 혼합 금지.**
   별도 `usage` 이벤트 또는 HTTP 헤더 (`X-App-*`) 로만 전달.

## Hono SSE 구현 패턴

```ts
import { streamSSE } from 'hono/streaming';

app.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: 'session', ... }), event: 'session' });
    // ... 본문 이벤트 emit ...
    await stream.writeSSE({ data: JSON.stringify({ type: 'usage', ... }), event: 'usage' });
    await stream.writeSSE({ data: JSON.stringify({ type: 'done' }), event: 'done' });
  });
});
```

백그라운드 태스크: `c.executionCtx.waitUntil(promise)` (Workers 호환). subprocess 분리는 Workers 환경에서 불가.

## 이벤트 카테고리

| 이벤트 | 카테고리 | 빈도 | 설명 |
|--------|---------|------|------|
| `session` | lifecycle | 1 | 스트림 시작 — session_id, request_id 발행 |
| `agent` | lifecycle | 1+ | 현재 turn 의 agent 메타 (sub-agent spawn 시 추가 emit) |
| `text` | content | * | assistant text delta |
| `thinking` | content | * | reasoning trace (provider 가 지원하는 경우) |
| `tool_call` | content | * | tool 호출 시작 marker (id + name + input) |
| `tool_result` | content | * | tool 결과 (id + content + is_error) |
| `action` | content | * | UI 측 사용자 visible action (`<tool_output>` 등) |
| `notification` | content | * | 비동기 알림 (background agent 완료, queued media job 등) |
| `suggestions` | content | 0\|1 | 사용자 후속 입력 제안 |
| `usage` | meta | 1 | input_tokens / output_tokens / cost / cache_creation / cache_read |
| `done` | terminal | 0\|1 | 정상 종료 |
| `error` | terminal | 0\|1 | 에러 종료 (`error_code` + 사용자 메시지) |

## 변경 영향

12 이벤트 집합 또는 lifecycle 순서 변경은 **클라이언트 상태머신 파괴 = breaking change**. 변경 시:

- 본 `skills/sse-lifecycle/SKILL.md` 갱신
- `*_agent_rules/sse-streaming-patterns.md` (양 언어) 추가 갱신 (wire format / 인코딩)
- `*_agent_rules/core-infrastructure.md` (양 언어) 추가 갱신
- `docs/api/frontend-contract.md` §5.2 갱신
- 프론트엔드 SSE 파서 (앱 측) 호환성 검증

## 금지 사항

- SSE payload 에 session-wide 메타 (token 수, cost, model, session_id) 혼합
- `done` 또는 `error` 누락 (연결 drop 만으로 종료)
- `usage` 를 `done` 이후에 전송
- 새 이벤트 타입을 본 12 집합 외부에 추가 (호환성 영향 평가 없이)
- Lifecycle 순서 변경 (예: `agent` 를 `session` 이전에)

<!-- ━━━ inlined from ./skills/compaction-thresholds/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 토큰 카운트 (간접 — 토큰 측정은 js-tiktoken 사용). 본문 자체는 language-neutral.

> Language-neutral invariants — Compaction stage order, thresholds, post-compact re-inject, tool output boundary.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/compaction-patterns.md`, `ts_agent_rules/compaction-patterns.md`.

# Compaction — 언어 무관 불변식

토큰 측정: `js-tiktoken` (Workers 호환) 또는 근사 카운터. `tiktoken` (Python native) 는 Workers runtime 에서 사용 불가.

## 4-Stage Escalation (순서 고정, 변경 금지)

비용 순서대로 escalate. 각 stage 가 target 에 도달하면 즉시 return.

| 순서 | 전략 | 동작 | LLM 호출 | 비용 |
|------|------|------|----------|------|
| 1 | `snip` | 오래된 tool_result 를 `SNIP_LIMIT_CHARS=200` 으로 head-truncate | 없음 | ~0 (string slice) |
| 2 | `micro` | 오래된 메시지 chunk 를 요약 LLM 으로 압축 | **있음** | 낮음 (Haiku, chunk 별) |
| 3 | `session_memory` | 세션 메모리 항목 중 predicate 매칭만 제거 | 없음 | ~0 (predicate filter) |
| 4 | `auto` | 전체 대화를 chunk 단위로 묶어 요약 | **있음** | 높음 (Haiku, 전체) |

오케스트레이터 시그니처: `compactMessages(messages, summarizer, threshold, memoryPredicate)`.

전략 식별자 5종: `snip`, `micro`, `session_memory`, `auto`, `reactive`. 5번째 `reactive` 는 **Error Recovery 경로 전용** (아래 §Reactive 참조).

## 핵심 상수 (모든 언어 동일)

| 상수 | 값 | 의미 |
|------|----|------|
| `SNIP_LIMIT_CHARS` | 200 | snip stage 의 head-truncate 길이 |
| `ESCALATION_TARGET_RATIO` | 0.80 | 각 stage 의 중단 조건 = `threshold × 0.80` 이하. 재트리거 가드 |
| `REACTIVE_TARGET_RATIO` | 0.70 | reactive stage 는 escalation 보다 공격적 |
| `SAFETY_BUFFER` | 13_000 | **compaction trigger threshold 의 SoT** — 요약 LLM 여유 + 한 턴 분량 + α. `token-budget-constants` 의 `RESERVED`(=21,500, output 예약 + tool overhead 배정)와 역할이 다른 별개 상수 |
| `EFFECTIVE_CONTEXT_WINDOW` | 200_000 | 기준 모델 (Claude 200K). 비-200K 는 `TokenBudget.forModel()` 가 별개 스케일 |
| `MAX_PTL_RETRIES` | 3 | Compaction 자체가 prompt-too-long 시 oldest group 삭제 후 재시도 한계 |
| `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` | 3 | 연속 실패 한계. 초과 시 상위로 에러 전파 |
| `INTERNAL_MODEL` | `"claude-haiku-4-5"` | 요약 LLM 하드코드. fallback chain 과 **완전 분리** |
| `COMPACTED_MARKER` | `"[COMPACTED]"` | 멱등성 식별자 prefix |

`autoCompactThreshold()` 는 `APP_AUTOCOMPACT_THRESHOLD` env 로 override 가능 (개발/튜닝용).

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
- `autoCompact` 연속 실패는 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3` 회까지 — 초과 시 상위로 에러 전파
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

`compactMessages()` 의 4-stage 에는 포함되지 않지만, **Prompt-Too-Long 복구** 경로에서 사용:

- 트리거: Stage 1 compaction 후에도 provider 호출이 PTL 반환 (토큰 추정 오차 / 갑자기 커진 tool_result / 이미지·PDF 부가 토큰)
- 함수: `reactiveCompact(messages, summarizer, ...)` (strategy=`reactive`)
- target: `threshold * REACTIVE_TARGET_RATIO` (= 0.70) — escalation 보다 공격적으로 축소
- 방식: oldest group drop + 요약 혼합

## Tool Output Boundary Preservation

Stage 5 가 모든 tool_result content 를 `<tool_output>...</tool_output>` 으로 감싸기 시작하면서 (indirect injection 방어), compaction 의 4 stage 가 그 envelope 를 부수지 않도록 유지해야 한다.

**핵심 불변식:**

- `isCompacted` / `_isCompacted` 는 `stripOuterWrap` 후 `COMPACTED_MARKER` 검사 — wrap 된 block 도 멱등성 인식
- `snipCompact` 는 strip → truncate → `wrapToolOutputText` 로 재포장 — close tag 잘림 방지
  결과: `<tool_output>\n[COMPACTED] inner...\n</tool_output>`
- `reactiveCompact` step 3 (last resort placeholder) 도 동일 wrap 적용
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

<!-- ━━━ inlined from ./skills/http-error-sentinels/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 에러 (HTTPException(FastAPI) → HTTPException(hono/http-exception), `throw new HTTPException(status, { message })`), 전역 예외 핸들러 (@app.exception_handler → app.onError)

> Language-neutral invariants — HTTP error code sentinels, error envelope shape, leak-safe 404, scrub_text.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/api-routing-patterns.md`, `ts_agent_rules/api-routing-patterns.md`,
>             `python_agent_rules/error-handling.md`, `ts_agent_rules/error-handling.md`.

# HTTP Error Sentinels — 언어 무관 불변식

## 에러 응답 envelope (고정 shape)

```json
{
  "error": {
    "code": "<sentinel>",
    "message": "<scrubbed>",
    "details": { ... }    // optional
  }
}
```

- 클라이언트 파서 계약 — shape 변경 금지
- `errorBody(code, message, details?)` helper 가 단일 source. 라우트 코드는 이 helper 만 사용

## Hono 에러 핸들링 패턴

```ts
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// helper — 라우트 outer-scope c 없이도 호출 가능, type-safe
// HTTPException message: 는 string 전용 → errorBody() 객체를 직접 전달하면 타입 오류.
// Hono 의 의도된 API: res: 에 Response 객체를 담아 envelope 보장.
function throwSentinelError(
  code: SentinelCode,
  status: ContentfulStatusCode,
  detail: string
): never {
  const body = errorBody(code, scrubText(detail));
  throw new HTTPException(status, {
    res: new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  });
}

// 라우트에서 사용
throwSentinelError("validation_error", 422, err.message);

// 전역 핸들러 (app.onError — @app.exception_handler 대응)
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    // throwSentinelError 경유 시 err.res 에 올바른 envelope 가 담겨 있음 — 그대로 반환
    return err.getResponse();
  }
  // 알 수 없는 에러
  return c.json(errorBody("internal_error", "unexpected"), 500);
});
```

## 내부 예외 → HTTP 매핑 (글로벌 exception handlers)

| 내부 예외 | HTTP code | `error.code` (sentinel) | 메시지 처리 |
|-----------|-----------|------------------------|-------------|
| `ValidationError` | 422 | `validation_error` | `scrubText(String(err))` |
| `ResourceError(user_data_pending_deletion)` | **410** | `user_data_pending_deletion` | `"your account data is queued for deletion"` (탐스톤 사용자 7-day grace 동안 모든 write 차단) |
| `ResourceError` (default) | 404 | `resource_error` | `scrubText(String(err))` |
| `ConfigurationError` | 500 | `configuration_error` | `"service misconfigured"` (상세 숨김) |
| `InternalError` | 500 | `internal_error` | `"internal server error"` (상세 숨김) |
| `AppError` (fallback) | 500 | `app_error` | `scrubText(String(err))` |

## Route-edge sentinel (route 가 직접 raise)

| 시나리오 | HTTP code | `error.code` | 메시지 / details |
|----------|-----------|--------------|-----------------|
| 입력 content moderation 거부 | 422 | `content_moderation_blocked` | `"this input violates content policy"` + `details.categories=[...]` (입력측 분류 결과) |
| 입력 jailbreak 거부 | 422 | `jailbreak_blocked` | `"this input was flagged as a system-instruction-bypass attempt"` — **NO `details` body** (R1-S8: attacker info-disclosure protection — pattern 시그너처 노출 시 evasion 학습 가능) |
| RunPolicy 위반 (예: `sse=true` + `response_schema`) | 422 | `invalid_policy` | request-time 거부 |
| `payload_too_large` | 413 | `payload_too_large` | `Content-Length` 가 path 별 cap 초과 |
| `length_required` | 411 | `length_required` | `Transfer-Encoding: chunked` 인데 `Content-Length` 없음 |
| Rate limit | 429 | (middleware 직접) | `Retry-After` 헤더 + `retry_after_ms` body |

## Leak-safe 404 원칙

리소스 소유권 불일치 시 **403 금지** — 존재/미존재/권한없음 을 **모두 동일한 404** 로 응답.

- 이유: 존재 여부를 권한으로 추론 불가하게 (enumeration 공격 차단)
- 적용 예: `routes/sessions.ts::getSession`, `routes/media.ts::assertOwnerOrWildcard`
- 패턴: `if (obj.userId !== caller && !hasScope(scopes, "*")) return notFound(c)`

## Tombstone (user_data_pending_deletion) 410 처리

- 사용자가 deletion 신청 후 7-day grace 동안 모든 write 가 차단됨
- `assertUserActive(userId)` 함수가 라우트 진입 시 검사
- 차단 시 `ResourceError(code="user_data_pending_deletion")` throw → 410 응답
- 사용자가 cancel 안 하면 7일 후 영구 삭제 (data-governance 영역)

## scrubText — secrets + PII 제거

응답 body 와 로그 양쪽에 적용:

- `scrubText = scrubPii(scrubSecrets(text))`
- 7 secret 패턴 + 5 PII 패턴 (RRN/모바일/유선/이메일/카드/운전면허)
- 스택 트레이스 / 내부 경로 / API key / token 모두 제거
- **Migration note (PII Phase 1)**: 이전 버전은 `scrubSecrets` 만 사용. 현재 `scrubText` 로 통합

## CORS expose_headers 7종 (FE contract)

브라우저 JS 가 response.headers 로 읽어야 하는 헤더 — 누락 시 FE breaking:

| 헤더 | 용도 |
|------|------|
| `X-App-Session-Id` | FE 의 session id 추출 |
| `X-App-Agent` | 현재 dispatch 된 run 이름 |
| `X-App-Model` | 해석된 모델 (fallback chain 소비 후) |
| `X-App-Run-Id` | run-scoped uuid (`sse=true` 응답에만, SSE Resilience Phase 1) |
| `X-App-Moderation-Status` | content moderation 결과 (`ok` / `failed_open` / `skipped_short` / `disabled`. `blocked` 은 422 envelope 분기) |
| `X-App-Jailbreak-Status` | jailbreak 결과 6값 (`ok` / `flagged` / `blocked` / `failed_open` / `disabled` / `skipped_short`) |
| `X-Request-Id` | 디버깅 / 서버 로그 correlation |

`expose_headers` 변경은 FE contract breaking. 헤더 상수는 stream 모듈의 `*_HEADER` 변수가 단일 source — 라우트는 re-export 만 사용.

## 공통 금지 사항 (언어 무관)

- 응답에 시크릿/PII/스택트레이스 포함 (반드시 `scrubText`)
- 403 으로 권한 거부 (반드시 leak-safe 404 — 단, 인증 자체 실패는 401 OK)
- 같은 sentinel 을 다른 의미로 재사용
- error envelope shape 임의 변경 (`{"error": {...}}` 고정)
- HTTP code 와 sentinel 의 1:1 mapping 깨기 (예: 같은 sentinel 이 여러 status code 로 나가면 클라이언트 분기 깨짐)
- 라우트 외부 (engine / services) 에서 HTTP-specific exception raise (내부는 AppError, 변환은 routes 경계에서만)

<!-- ━━━ inlined from ./skills/input-safety-gate-ordering/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 스키마 (pydantic → zod, `z.object({...})`), 검증 (pydantic validator → `z.refine`), 의존성 주입 (Depends → `c.set/get` Hono Context), 미들웨어 (FastAPI middleware → `app.use`)

> Language-neutral invariants — Input safety gate V3 ordering, two-port jailbreak, orthogonal moderation, header sentinels.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/run-policy.md`, `ts_agent_rules/run-policy.md`,
>             `python_agent_rules/architecture.md`, `ts_agent_rules/architecture.md`.

# Input Safety Gate Ordering — 언어 무관 불변식

## V3 Sequential Gate Order (cheapest-first §2)

`dispatchRun` 본문에서 **순차적으로** 게이트:

```
tombstone (account state)
  → jailbreak heuristic (regex, <1ms)
    → jailbreak classifier (opt-in, on heuristic miss, PromptGuard 2)
      → moderation (OpenAI omni-moderation)
        → _streamAgent (LLM 호출 진입)
```

이유: 가장 싼 layer 먼저, 가장 비싼 layer 마지막. 어느 layer 든 reject → 즉시 422 + history/replay 미기록 (LLM 호출 비용 0).

## 4 Layer 책임

| Layer | 역할 | 비용 | 결과 |
|-------|------|------|------|
| **tombstone** | 7-day grace 동안 deletion 신청 사용자 차단 | DB lookup (1 query) | `ResourceError(user_data_pending_deletion)` → 410 |
| **jailbreak heuristic** | regex pattern 매치 (system-instruction-bypass, prompt-leak) | <1ms in-process | `JailbreakDecision { allowed, matched_patterns }` |
| **jailbreak classifier** | PromptGuard 2 (opt-in, lazy transformers) | ~10ms ONNX | `JailbreakDecision { allowed, score }` |
| **moderation** | OpenAI omni-moderation 13 카테고리 | network call (~100ms) | `ModerationDecision { categories: {category: score} }` |

## Two-Port Jailbreak (R1-B1 — 단일 wrapper 금지)

- `app.jailbreakHeuristicPort` (`HeuristicJailbreakProvider` | `NoopJailbreakProvider`) — Hono `c.set/c.get` 또는 singleton 주입
- `app.jailbreakClassifierPort` (`PromptGuardJailbreakProvider` | `NoopJailbreakProvider`)
- **두 별도 lifespan-wired port**. 라우트는 interface 만 참조
- 단일 `_MultiJailbreakProvider` wrapper **금지** — interface 의 single-responsibility 위반
- `services/moderation/` 와 cross-import 금지 — 두 layer 는 직교

## Hono 미들웨어 / DI 패턴

```ts
// Zod 스키마 검증 (pydantic → zod)
const RunRequestSchema = z.object({
  session_id: z.string(),
  messages: z.array(z.object({ ... })),
}).refine((v) => /* cross-field */ true);

// 미들웨어 (FastAPI Depends → app.use / c.set)
app.use('*', async (c, next) => {
  c.set('jailbreakPort', getJailbreakPort());
  await next();
});
```

## Jailbreak ↔ Moderation 직교

두 게이트는 **독립적**으로 작동 — 두 layer 모두 통과해야 `_streamAgent` 진입.

- 결과 헤더 분리: `X-App-Jailbreak-Status` + `X-App-Moderation-Status`
- 한쪽 disabled 라도 다른 쪽은 정상 작동
- 단일 input 이 둘 다 trip 가능 (예: jailbreak attempt + sexual content) — 첫 reject layer 만 422 envelope, 다른 layer 는 헤더로만 surface

## Header Set (5종 status × 2 layer)

### `X-App-Moderation-Status` (5값)
- `ok` — 모든 카테고리가 threshold 미만
- `failed_open` — provider 호출 실패 → 통과 (audit)
- `skipped_short` — 입력 너무 짧음 (예: <3 chars)
- `disabled` — `enabled=false`
- (422 분기) — `blocked` 헤더 set 안 됨 — 422 envelope 자체가 신호

### `X-App-Jailbreak-Status` (6값)
- `ok` — 매치 없음
- `flagged` — 매치 + `enforcement="log_only"` → 200 통과 (창작 platform UX)
- `blocked` — 매치 + `enforcement="block"` → 422 envelope
- `failed_open` — provider 호출 실패 → 통과 (audit)
- `disabled` — `enabled=false`
- `skipped_short` — 입력 너무 짧음

## Decision-to-Status Mapping (S-R2-2 — route 가 single source)

- Provider (heuristic / classifier / moderation) 는 **raw match facts** 만 반환
  - jailbreak: `allowed`, `matched_patterns`, `score`, `failed_open`
  - moderation: `categories: {category: score}`, `failed_open`
- **Route** 가 `JailbreakPolicy.enforcement` / `ModerationPolicy.thresholds` 를 보고 final action 결정 + 헤더 매핑
- `decisionToStatus(decision, { blockedLabel })` 헬퍼가 input/output 양쪽의 facts→status 매핑 단일 source
- `JailbreakDecision` / `ModerationDecision` 에 `status` 필드 도입 **금지** — 헤더 매핑은 라우트가 단일 source

## ModerationPolicy 핵심 불변

- `enabled: boolean = true`
- `thresholds: Record<string, number> = {}` — OpenAI omni-moderation 13 카테고리 중 override 만 명시
- 기본 `_DEFAULT_HARD_BLOCK_THRESHOLDS`: `sexual/minors=0.5`, `self-harm/instructions=0.5`. 나머지 11 카테고리는 1.0 (log-only)
- 점수 범위 `[0.0, 1.0]` 만 허용. 1.0 = "절대 block 안 함" sentinel (provider strict-greater 비교)
- **Hard floor invariant**: `_HARD_FLOOR_THRESHOLDS` (sexual/minors=0.5, self-harm/instructions=0.5) 는 YAML override 로 weakening 불가 — 이 값보다 큰 threshold 입력 시 startup `ValidationError`
- **Drift guard (S-R2-1)**: `_HARD_FLOOR_THRESHOLDS` ⊆ `_DEFAULT_HARD_BLOCK_THRESHOLDS`. 누락 시 import-time error throw
- Zod schema: `z.object({ ... }).strict()` — 카테고리 이름 typo (예: `self-harm-instructions` slash↔hyphen) 시 startup `ValidationError`
- `output_enabled: boolean = false` — opt-in output-side moderation. 활성 시 streaming 끝나기 전 output text 1회 check + notification SSE

## JailbreakPolicy 핵심 불변

- `enabled: boolean = true`
- `classifier_enabled: boolean = false` — PromptGuard 2 opt-in (R1-B4). default false = heuristic-only
- `enforcement: 'log_only' | 'block' = 'log_only'` — Phase 1 default `log_only` (B-Plat-1: 창작 platform UX 우선). 매치되어도 200 통과 + `flagged` 헤더만. `"block"` opt-in 시 매치 → 422
- `threshold: number = 0.9` (PromptGuard 한정, `ge=0.5, le=0.99`) — heuristic 은 binary, ignored. classifier 만 사용. **Strict bounds**: 0.0/1.0 sentinel 거부 (R1-S5)
- **Hard floor 없음** (Phase 1, B-Plat-1) — 창작 platform 보존. Phase 2 운영 데이터 누적 후 검토
- Heuristic pattern 추가/제거 시 `_PATTERN_COUNT_EXPECTED` 상수 동시 업데이트 (drift guard, Q13)
- Classifier opt-in 했지만 lifespan 이 실제 wire 안 했으면 (operator 가 env + extra 미설치) silently `NoopJailbreakProvider` 반환 → heuristic-only + WARNING 로그 (Sister-B5 graceful degrade)

## 3-Layer Safety Validator (R1-B5)

`moderation.enabled=false` AND `pii_redaction=false` AND `jailbreak.enabled=false` → WARNING 로그 (`run_policy.no_safety_layer`).

- 세 입력측 안전 레이어가 모두 꺼진 상태는 fictional-only / internal scope 에서만 정당화
- startup 실패 아님 (audit trail 만)
- jailbreak cycle 이 moderation cycle 의 2-layer 검증을 **REPLACE** (PR ordering: moderation 이 먼저 merge 되면 2-layer 도입 → jailbreak merge 시 3-layer 로 supersede)
- 단일 layer 비활성 (예: `jailbreak.enabled=false` 만) 은 warning 안 함 — heuristic FP 우려 시 비활성화는 정상 use case

## Input Reject 시 데이터 처리

- 422 응답 + history/replay 미기록 (LLM 호출 비용 0)
- structlog: `jailbreak.detected` (operator-only — pattern + score 포함) / `moderation.flagged` (categories + scores 포함)
- 사용자 응답 body 는 minimal — pattern 시그너처 / score 노출 금지 (R1-S8)

## 공통 금지 사항 (언어 무관)

- 게이트 순서 변경 (cheapest-first 위반)
- 어떤 게이트도 우회한 직접 LLM 호출
- 단일 `_MultiJailbreakProvider` wrapper 도입 (R1-B1 — heuristic + classifier 는 두 별도 port)
- `JailbreakDecision` / `ModerationDecision` 에 `status: string` 필드 도입 (S-R2-2 — 헤더 매핑은 라우트 단일 source)
- 422 envelope 의 `jailbreak_blocked` 에 `details` body (R1-S8 — attacker info-disclosure)
- `ModerationPolicy.thresholds` 에 `_HARD_FLOOR_THRESHOLDS` 보다 큰 값 주입
- `JailbreakPolicy.threshold` 에 0.0 또는 1.0 sentinel 주입 (Field validator 거부)
- `services/jailbreak/` 와 `services/moderation/` cross-import (직교 layer)
- moderation cycle 의 2-layer warning 로 회귀 (R1-B5 무력화)

<!-- ━━━ inlined from ./skills/mcp-namespace/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 거의 ✕ (protocol-level). MCP 클라이언트 import: Python `mcp` SDK → `@modelcontextprotocol/sdk` (TS)

> Language-neutral invariants — MCP namespace, connection lifecycle, env substitution policy, registry isolation.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/mcp-patterns.md`, `ts_agent_rules/mcp-patterns.md`.

# MCP Integration — 언어 무관 불변식

## 도구 네이밍 — `mcp__<server>__<tool>`

- Qualified name 형식: **`mcp__<server>__<tool>`** (double underscore separator)
- `MCP_PREFIX = "mcp__"` — `ToolRegistry` 정렬 키와 일치 (`skills/tool-sort-order/SKILL.md`)
- 정렬: built-in (알파벳) → MCP (알파벳). prefix 로 그룹 분리 → prompt cache prefix 보호
- 내장 도구와 이름 충돌 방지: `mcp__` prefix + server name 정규식이 `__` 포함 금지로 충분

## `MCPServerConfig` 스키마

```yaml
name: str              # 정규식 ^[a-zA-Z0-9_-]+$, 1~64자 (load-time 검증)
transport: stdio | sse # 두 가지만 지원
command: str | null    # stdio 전용
args: list[str]        # stdio 전용
url: str | null        # sse 전용
env: dict[str, str]    # ${VAR} 치환 대상 (stdio subprocess env)
enabled: bool = true
```

TS 구현: `@modelcontextprotocol/sdk` — Python `mcp` SDK 의 대응 패키지.

- **`name` 정규식 강제**: `mcp__<server>__<tool>` 정렬 키와 충돌하지 않도록. 공백 / `__` injection 은 load-time reject
- Zod schema: `z.object({ ... }).strict()` — 오타 필드 load-time `ValidationError`
- transport 는 **`stdio`** 와 **`sse`** 두 가지만. 새 transport 추가 시 enum + connect 분기 동시 업데이트

## Registry 로드 순서

`loadRegistry(path)` 해석 순서:

1. 명시 `path` 인자
2. `APP_MCP_REGISTRY` env var 경로
3. 기본값: `services/mcp/registry.json`

파일 없으면 빈 `MCPRegistry()` 반환 — **MCP 는 opt-in**. registry.json 이 repo 에 commit 되지 않는 것이 기본.

## `${VAR}` 치환 정책 (caller 별 차별)

- **MCP**: `substituteEnv(env, { onMissing: 'empty' })` — 누락 var → empty string (POSIX subprocess env convention)
- **providers.yaml**: `raise` (credential fail-fast)
- **runs/*.yaml**: `keep_placeholder` (오타 surface)

→ caller 별 정책 차이 의도적. MCP 는 spawn 된 subprocess 가 env 누락을 자체 판단.

## 5-State 연결 관리

```
ConnectionState = disabled | pending | connected | needs_auth | failed
```

전이표:

```
disabled ↔ pending      (config toggle)
pending → connected     (initialize handshake 성공)
pending → needs_auth    (server 가 auth-required 응답)
pending → failed        (transport / handshake / timeout)
connected → failed      (call error past retry budget)
any → disabled          (admin-disable or lifespan shutdown)
```

- 전이는 `setState()` **한 곳 경유** — 모든 변경이 `mcp.state_transition` 로그로 관측됨
- timeouts: `CONNECT_TIMEOUT_SEC = 30`, `CALL_TIMEOUT_SEC = 60`

## Lazy Reconnection

- 연결 끊기면 memoized 캐시 (`_toolsCache`) 무효화, 다음 tool call 이 새 연결 트리거
- **백그라운드 polling 금지** — 재연결은 항상 on-demand
- 이유: MCP 서버가 off 인 상태에서 polling 은 리소스 낭비 + 로그 노이즈

## 독립 연결 (서버 격리)

- 각 `MCPClient` 인스턴스는 독립
- 한 서버 실패가 다른 서버를 차단하지 않음
- bridge 의 `registerAllMcpTools` 가 per-server try/catch 로 격리 — 한 서버 connect 실패 시 WARNING 로그 + 해당 서버 skip, 나머지 계속

## 도구 등록

- MCP tool 은 bridge 의 `makeMcpTool` 가 `ToolProtocol` interface 로 래핑 → `ToolRegistry.register` 로 내장 도구와 **동일 경로** 등록
- 등록 시점: 부팅 시 `ToolRegistry.freeze()` 전에 완료. **런타임 추가 금지**
- input schema 변환: MCP `inputSchema` (JSON Schema) → 내부 타입
  - TS: `zod` 스키마로 변환 또는 `z.unknown()` fallback + WARNING 로그
- `anyOf` / `oneOf` / `$ref` / `allOf` 같은 복잡 구조 → `z.unknown()` 로 fallback + WARNING 로그

## 대형 출력 처리

- MCP tool 결과도 내장 도구와 **동일한 head-truncate preview** (`TOOL_PREVIEW_MAX_CHARS=4000`, `skills/tool-sort-order/SKILL.md`)
- MCP 전용 disk-spill 경로는 미구현 — `mcp__<server>__fetch_full` 같은 보조 도구 패턴은 future enhancement
- 토큰 상한 초과 시 truncated payload 가 그대로 모델에 반환

## Server Instructions (현재 미구현)

- 개별 MCP server 가 반환하는 `instructions` 필드를 세션 system prompt 에 delta 로 주입하는 기능은 **현재 미구현**
- MCP SDK 의 `ClientSession` 이 initialize 응답에서 instructions 를 받지만, bridge / loop 이 이를 프롬프트에 연결하는 경로 없음
- `skills/compaction-thresholds/SKILL.md` Post-Compact 재주입 대상에 "MCP server instructions (delta)" 가 **aspirational target** 으로 기재
- 구현 시 "매 턴 full 전송 금지 — delta 만 전송" 원칙 유지 (prompt cache 보호)

## 연결 종료

- `MCPClient.close()` 는 **LIFO unwind** — transport + session async context 가 역순으로 cleanup
  - TS: `AsyncDisposable` 패턴 또는 명시적 `try/finally` unwind
- 진행 중 tool call 은 SDK 쪽에서 cancel 처리 (Promise cancellation 또는 AbortController 전파)
- `close()` 는 **idempotent** — 이미 닫힌 상태에서 재호출 안전

## 모듈 구조

| 책임 | 파일 |
|------|------|
| `MCPServerConfig` + `MCPRegistry` + `loadRegistry` + `resolveEnvVars` | `config.ts` |
| `MCPClient` (단일 서버 세션) + `ConnectionState` | `client.ts` |
| `registerAllMcpTools` — MCP tool → `ToolProtocol` 변환 + 등록 | `bridge.ts` |

## 공통 금지 사항 (언어 무관)

- `mcp__<server>__<tool>` 네이밍 규칙 우회 (정렬 키 / 충돌 방지 위반)
- `MCPServerConfig.name` 패턴 검증 우회한 직접 인스턴스 생성 (Field 가 강제 — modelValidate / deserialize 경유 필수)
- MCP 도구를 `ToolRegistry` 우회한 직접 등록 (정렬 무효화 + prompt cache prefix 오염)
- 서버 설정에 시크릿 하드코드 (반드시 `${VAR}` + `.env` / secret store)
- 한 서버 connect 실패가 다른 서버를 차단하도록 bridge 로직 변경 (독립 연결 원칙 위반)
- 백그라운드 polling 기반 재연결 (lazy 원칙 위반, 리소스 낭비)
- `ToolRegistry.freeze()` 이후 런타임에 MCP 도구 추가/제거 (정렬 prefix 재계산 → 캐시 무효화)
- `setState()` 우회한 직접 state 할당 (관측 누락)
- `${VAR}` 치환을 caller 별 정책 (`raise` / `keep_placeholder` / `empty`) 혼동
- Server instructions 를 매 턴 full 전송 (미래 구현 시 — prompt cache 보호, delta 만)
- `mcp_server` 가 engine / routes import (edge adapter cross-import 금지 — `skills/single-writer/SKILL.md` data layer 와 동급의 boundary)

<!-- ━━━ inlined from ./skills/run-policy-presets/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 거의 ✕ (constants table). 본문 안 Python config 클래스 → TS `const` + zod 검증 형태로 적용.

> Language-neutral invariants — RunPolicy schema, defaults, cross-field validation, presets.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/run-policy.md`, `ts_agent_rules/run-policy.md`.

# RunPolicy — 언어 무관 불변식

## 엔드포인트 = YAML

`POST /run/<name>` 은 `runs/<name>.yaml` 의 `RunPolicy` 를 로드해서 실행.

- 코드 변경 없이 YAML 추가만으로 새 엔드포인트가 생긴다
- RunPolicy 는 **범위 제약** 만 선언, 엔진(6-stage loop) 은 하나
- RunPolicy 는 **frozen** + Zod `strict()` — 인스턴스 생성 후 mutate 차단 + 오타 시 startup `ValidationError`

## RunPolicy 16 필드 (defaults + 의미)

TS 구현: `z.object({ ... }).readonly()` 또는 `Object.freeze(policy)` 로 immutability 보장.

| 필드 | 타입 | 기본값 | 의미 |
|------|------|--------|------|
| `name` | string | — | 라우트 세그먼트. `[a-z0-9_]+`, 1~64자 |
| `description` | string / null | null | 내부 문서용. 런타임 동작 영향 없음 |
| `system_prompt_file` | string | — | `runs/prompts/<file>.md` 상대 경로. 필수 |
| `model_preference` | string | `"default"` | fallback chain 이름 |
| `allowed_tools` | string[] / null | null | null=전체, []=도구 없음, list=화이트리스트 |
| `max_turns` | number | 50 | 루프 강제 종료 상한 |
| `compaction_enabled` | boolean | true | Stage 1 compaction 활성 여부 |
| `spawn_enabled` | boolean | false | spawn_agent 도구 노출 여부 |
| `max_spawn_depth` | number | 0 | 이 run 이 허용하는 서브 깊이 (`ge=0`). 전역 상한 `MAX_SPAWN_DEPTH=3` 초과 시 startup reject |
| `response_schema` | string / null | null | 스키마 이름. 지정 시 마지막 assistant text 블록을 schema 로 파싱. **`sse=true` 와 상호 배타** |
| `sse` | boolean | true | true=streamSSE, false=JSON buffer |
| `session_enabled` | boolean | true | false=stateless (매 호출 새 세션) |
| `pii_redaction` | boolean | true | true=user_message + tool_result 에 5종 PII 패턴 (RRN/모바일/유선/이메일/카드/운전면허) 일방향 redact |
| `moderation` | nested | `ModerationPolicy()` (enabled=true, hard-block defaults) | Content moderation Phase 1 (input-side only) |
| `jailbreak` | nested | `JailbreakPolicy()` (enabled=true, classifier_enabled=false, enforcement="log_only") | Jailbreak detection Phase 1 (input-side only) |
| `required_scope` | string / null | null | null=authenticated caller 허용. 설정 시 inline scope check + leak-safe 404 |

## Cross-field 불변 (startup fail-fast)

- `spawn_enabled=true` 인데 `allowed_tools` 에 `spawn_agent` 가 없으면 → 시작 시 `ValidationError`
- `spawn_enabled=true` 인데 `max_spawn_depth < 1` → 시작 시 `ValidationError`. "spawn 허용하지만 깊이 0" 은 모순
- `max_spawn_depth > 3 (=MAX_SPAWN_DEPTH)` → startup 실패
- `compaction_enabled=false` + `max_turns > 10` → WARNING 로그 (`run_policy.ptl_risk`). 긴 대화에서 PTL 발생 가능성 경고만 — startup 실패 아님
- `response_schema` + `sse=true` → **request-time 422** (`invalid_policy`). 반드시 `sse=false` 와 조합 — schema 파싱은 전체 assistant message 가 손에 있어야 가능
- `session_enabled=false` 인 run 은 세션 쓰기 금지. 메모리 추출 로직도 skip
- `moderation.enabled=false` AND `pii_redaction=false` AND `jailbreak.enabled=false` → WARNING 로그 (`run_policy.no_safety_layer`). 세 입력측 안전 레이어가 모두 꺼진 상태는 fictional-only / internal scope 에서만 정당화 — startup 실패 아님 (audit trail 만)
- YAML 의 key 이름은 RunPolicy 필드와 **정확히 일치**. 오타 있으면 Zod `strict()` 로 reject

## 정책 해석 순서 (시작 시 1회)

1. `runs/<name>.yaml` 파싱 → object
2. `${VAR}` 치환 — `substituteEnv(obj, { onMissing: 'keep_placeholder' })`. **누락 env 는 placeholder 문자열 그대로 유지** (startup 을 막지 않음 — 오타는 hot-reload 리뷰 시점에 surface). Provider/MCP YAML 과 다름 (provider/MCP 는 missing 시 throw 가 기본)
3. `RunPolicySchema.parse(substituted)` — 필드 검증 + Zod strict
4. cross-field 검증 (spawn/tools, depth, PTL warning)
5. `allowed_tools` 에 존재하지 않는 도구 이름 있으면 `ValidationError`
6. `RunRegistry` 에 등록 (write-once) + 시스템 프롬프트 pre-resolve

## 프리셋 가이드 (YAML 작성자용)

| 용도 | 핵심 설정 |
|------|-----------|
| **대화형 에이전트 (chat)** | `max_turns=100`, `compaction=true`, `spawn=true`, `sse=true`, `session=true`, `allowed_tools=null` |
| **단발 분류 task** | `allowed_tools=[]`, `max_turns=1`, `compaction=false`, `response_schema=<Schema>`, `sse=false`, `session=false` |
| **도구 기반 task** | `allowed_tools=[read_file, search, ...]`, `max_turns=5`, `compaction=false`, `response_schema=<Schema>`, `sse=false`, `session=false` |
| **multi-agent task** | `allowed_tools=[read_file, spawn_agent, ...]`, `max_turns=20`, `spawn_enabled=true`, `max_spawn_depth=2`, `compaction=true`, `sse=true`, `session=true` |

## 공통 금지 사항 (언어 무관)

- 코드에서 `RunPolicy` 직접 인스턴스화 후 loop 호출 (반드시 `runs/*.yaml` 경유)
- YAML 에 시크릿 하드코드 (반드시 `${VAR}`)
- 기존 agent-loop / tool-system / sub-agent / compaction 불변식을 **RunPolicy 로 우회**. 범위 제약 외의 의미를 담지 말 것
- `allowed_tools` 에 존재하지 않는 도구 이름 (startup fail-fast 해야 함)
- 같은 name 으로 2개 YAML 파일 (duplicate 감지 시 `ConfigurationError`)
- RunPolicy 를 런타임에 mutate (`Object.freeze` / Zod readonly 로 물리 차단되어 있지만 우회 시도 금지)
- `sse=true` + `response_schema` 조합 (422 — 반드시 `sse=false` 와 조합)
- RunRegistry runtime mutate (부팅/reload 시에만 갱신)

<!-- ━━━ inlined from ./skills/spawn-limits/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 동시성 (asyncio.gather → Promise.all), 프로세스 분리 (Workers `c.executionCtx.waitUntil` 한계 명시), 큐 (BackgroundTasks → Promise/waitUntil 동등 패턴). Workers 제약: CPU 시간 한계, `waitUntil` 길이 제한. `p-limit` 라이브러리 권장.

> Language-neutral invariants — Sub-agent spawn limits, isolation, cache discipline.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/sub-agent-patterns.md`, `ts_agent_rules/sub-agent-patterns.md`.

# Sub-Agent Spawn Limits — 언어 무관 불변식

## 핵심 상수

| 상수 | 값 | 의미 |
|------|----|------|
| `MAX_SPAWN_DEPTH` | **3** | 코드 하드 천장. 어떤 RunPolicy 도 이 값을 초과 불가. `policy.ts` 가 `GLOBAL_MAX_SPAWN_DEPTH` 라는 별칭으로 re-export |
| `policy.max_spawn_depth` | YAML, `ge=0` | per-run cap. 유효 상한 = `Math.min(MAX_SPAWN_DEPTH, policy.max_spawn_depth)` |

`max_spawn_depth: 0` 선언 시 spawn 시도가 코드 수준에서도 거부.

## spawn_agent 도구의 3 Mode (사용자 API)

| Mode | 동작 | 현재 구현 | 사용 시점 |
|------|------|----------|----------|
| `foreground` | blocking spawn — 결과까지 await | `runForeground()` | 짧은 위임 (< timeout_seconds) |
| `in_process` | 별도 mailbox 로 병렬 실행 목표 | **foreground 의 alias (현재)** — mailbox/병렬 TBD | 미래 병렬 워크로드 |
| `background` | non-blocking, 부모 즉시 다음 턴 진행 | `scheduleBackground()` — 같은 프로세스 내 Promise/`c.executionCtx.waitUntil` (**별도 프로세스 아님**) | 장시간 작업 (분 단위) |

`in_process` 는 rule 에 선언되어 있지만 **아직 구현 미완** — 사용자는 현재 foreground 와 동일 결과를 얻음. 별도 mailbox / 병렬 실행은 미래 작업.

**Workers 제약**: Cloudflare Workers 에서 `c.executionCtx.waitUntil(promise)` 는 CPU time limit 및 실행 시간 한계 있음. 장시간 background 작업은 Node 모드 전용이거나 외부 큐 위임 검토 필요.

병렬 실행 시 concurrency 제어: `p-limit` 라이브러리 권장.

```ts
import pLimit from 'p-limit';
const limit = pLimit(5); // 최대 5개 동시
const results = await Promise.all(tasks.map((t) => limit(() => runAgent(t))));
```

## Forked Agent (엔진 내부, spawn_agent 와 별개)

Compaction summarizer / memory extraction 등 **엔진이 내부용으로 임시 에이전트를 fork** 하는 경로. 사용자 API `spawn_agent` 와 **다른 개념**:

- 부모 state 를 복제 + `CacheSafeParams` 로 자식 실행
- 결과는 엔진이 소비 (user-facing tool 반환 아님)
- depth counter 는 여전히 적용됨 — `checkDepth()` 공유
- 혼용 금지: "forked mode" 라는 spawn_agent 옵션은 없음

## Coordinator vs Worker 분리

- **Coordinator** 는 오케스트레이션 도구만 사용 (`spawn_agent`, `send_message`, `task_stop`)
- **Worker** 는 실행 도구만 사용 — **`spawn_agent` 호출 금지**
- Worker 가 `spawn_agent` 호출 시 reject (메시지: `"worker agents cannot invoke spawn_agent"`)
- 이유: worker 가 sub-agent 생성하면 무한 재귀 — depth limit 만으로는 비용 통제 불가

## RunPolicy 와의 cross-field 충돌 (startup fail-fast)

- `spawn_enabled=true` + `max_spawn_depth=0` → startup `ValidationError` (모순)
- `spawn_enabled=true` + `allowed_tools` 에 `spawn_agent` 없음 → startup `ValidationError`
- `max_spawn_depth > MAX_SPAWN_DEPTH (=3)` → startup 실패

## Deterministic Child ID

- 형식: `{name}@{team}`
- 같은 입력 → 같은 ID (결정론적)
- `@` 를 name/team 구성요소에 사용 금지 (파싱 충돌)

## State Isolation

- messages, tool decisions, file cache 는 **자식에게 deep copy** 로 전달 (TS: `structuredClone()`)
- 자식의 상태 변이가 부모에 보이면 버그 — 격리 불변 (design-principles §4)
- **예외 (공유 허용)**:
  - **abort signal**: 부모 → 자식 cascade (자식 즉시 중단), TS `AbortController` 전파
  - **trace 필드 10개** (`request_id`, `trace_id`, `span_id`, `session_id`, `user_id`, `run_name`, `agent`, `model`, `turn_count`, `spawn_depth`): read-only 관측용. spawn 시 fresh context 복제 + `spawn_depth + 1` rebind (부모 오염 방지)

## CacheSafeParams (fork agent 전용)

Fork agent 는 부모의 다음 항목을 **byte-identical** 로 상속:

- `system_prompt` — 변경 시 prefix cache miss
- `tools` 목록 — 정렬·필터 모두 동일
- `message_prefix` — 첫 N 메시지 동일
- `model` — 부모 모델 그대로 (override 무시)

→ prompt cache hit → 비용 절감 (design-principles §3).

해석 헬퍼: `resolveCacheSafeParams(ctx)` — 컨텍스트의 metadata 에서 read-only 로 꺼냄.

## `use_exact_tools` 플래그 (사용자 API)

| 값 | 동작 | 결과 |
|----|------|------|
| `true` | 자식이 부모의 tool pool 을 **필터링 없이 그대로** 사용 | parent tool cache 보존 |
| `false` | 자식 agent 의 own `allowed_tools` 로 재필터링 | parent tool cache 무효화 (`reason="use_exact_tools=false invalidates parent tool cache"`) |

기본값은 보수적 (false 또는 명시 필수) — 캐시 보존이 필요한 경우 명시적 opt-in.

## Model Override Priority

1. `spawn_agent` explicit `model` 파라미터 (worker 대상)
2. 자식 agent definition (`agents/{name}.yaml::model_preference`)
3. 부모 model (fork agent 는 무조건 이것)
4. system default

**Fork agent 는 모든 override 무시하고 부모 모델 고정** — `CacheSafeParams` 가 의존.

## Background 완료 Notification

- 완료 시 부모 session 에 구조화된 알림 inject
- Notification event: `{"kind": "background_agent_completed", "status": ..., "summary": ..., "result": ..., "usage": {...}}`
- 전달 경로: SSE notification event 또는 session inbox (mpsc / queue, 추후 확장 포인트)
- 부모가 turn 진행 중이면 다음 turn 시작 시 inbox 에서 수확

## 공통 금지 사항 (언어 무관)

- Worker 에게 `spawn_agent` / `spawn_*` 도구 허용 (무한 재귀 위험)
- `checkDepth()` 생략 후 spawn
- Sub-agent state 를 부모와 mutable 하게 공유 (abort + trace 필드만 예외)
- Fork agent 에서 `CacheSafeParams` 깨기 (model / prompt / tools 부모와 다르게)
- Fork agent 에 model override 적용 (부모 모델 고정 — cache 안정성 필수)
- `in_process` mode 를 "현재 병렬 실행 가능" 으로 문서화 (실제는 foreground alias)
- Background spawn 을 "별도 프로세스" 로 문서화 (실제는 같은 프로세스 task)
- Sub-agent ID 에 `@` 외 구분자 사용
- Background agent 완료 알림 생략
- 레지스트리 runtime mutate 로 sub-agent 추가/제거
- `spawn_agent` tool 에 `forked` 같은 엔진 내부 mode 노출 (사용자 API 와 내부 fork 분리)

<!-- ━━━ inlined from ./skills/tool-sort-order/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 거의 ✕. Python tool 등록 예시 → TS `Map<string, ToolHandler>` 또는 array 형태로 치환.

> Language-neutral invariants — Tool sort order, cache-stable tools array, dynamic safety determination.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/tool-system-patterns.md`, `ts_agent_rules/tool-system-patterns.md`,
>             `python_agent_rules/core-infrastructure.md`, `ts_agent_rules/core-infrastructure.md`.

# Tool Sort Order — 언어 무관 불변식

## API `tools` 배열 정렬 순서 (cache prefix 보호)

```
[built-in 이름순] + [MCP 이름순]
```

- 두 그룹 분리 — built-in 먼저, MCP 다음
- 각 그룹 내부는 사전 정렬 (이름 순 ascending)
- MCP 도구는 모두 `mcp__<server>__<tool>` prefix — built-in 과 같은 namespace 에 진입하지 않음
- 이 순서가 Anthropic prompt cache key 의 일부 — 변경 시 모든 세션의 cache 즉시 무효화

이유: 새 도구를 추가해도 기존 cache 가 살아남도록 deterministic 정렬.

TS 구현: 도구는 `Map<string, ToolHandler>` 또는 `ToolHandler[]` 로 관리하되, API 전송 전 반드시 위 순서로 정렬:

```ts
const sortedTools = [
  ...builtinTools.sort((a, b) => a.name.localeCompare(b.name)),
  ...mcpTools.sort((a, b) => a.name.localeCompare(b.name)),
];
```

## is_concurrency_safe — 입력 기반 동적 결정

도구 안전성은 **클래스 속성이 아니라 입력에 따라 동적 결정**:

- 같은 도구도 인자에 따라 read-only 또는 destructive
- 예: `bash` 도구 — `ls /tmp` 은 read-only, `rm -rf` 는 destructive
- 시그니처: `isConcurrencySafe(args: unknown): boolean` / `isReadOnly(args: unknown): boolean`
- 미선언 시 보수적 기본값: **순차 실행 + 쓰기 가정** (`isConcurrencySafe=false`)

## 실행 전 2단계 체크 (의무)

```
validateInput → checkPermissions → call
```

| 단계 | 책임 | 제약 |
|------|------|------|
| `validateInput(args)` | 논리 검증 | I/O 금지, 부수 효과 금지, 순수 함수 |
| `checkPermissions(args, ctx)` | 권한 판정 | `allow` / `ask` / `deny` / `passthrough` 반환 |

두 단계 모두 통과한 도구만 `call(args, ctx)` 진입.

## ToolProtocol 8 멤버 (data 3 + methods 5)

- **data 3**: `name`, `description`, `input_schema`
- **methods 5**: `isConcurrencySafe(args)`, `isReadOnly(args)`, `validateInput(args)`, `checkPermissions(args, ctx)`, `call(args, ctx)`

도구 직접 인스턴스화 금지 — 반드시 `buildTool()` 팩토리 경유 (미선언 필드는 safe default 적용).

## 결과 절단 (head-truncate + preview)

- `TOOL_PREVIEW_MAX_CHARS = 4000` — 도구 결과가 이 길이 초과 시 head-truncate + preview 반환
- 절단 마커: `[truncated, N more chars]`
- 대용량 disk-spill (`tool_result_fetch` 도구로 on-demand 조회) 은 미래 확장 항목 — 현재 미구현

## Read 후 Edit 의무 (mtime guard)

- Read 없이 Edit 도구 호출 금지
- Read 후 외부 변경 감지 (mtime 비교) 시 Edit 거부
- 이유: §1 safe-default 의 예외 — 외부 변경 감지 필요

## 도구 60개 초과 시 deferred loading

- 정렬·캐시 안정성은 도구 수와 무관하게 유지
- 60개 초과 시 모든 정의를 항상 로드하면 token budget 부담 → `ToolSearch` 도구로 on-demand 로딩 검토 필요

## 공통 금지 사항 (언어 무관)

- ToolProtocol 직접 인스턴스 생성 (반드시 `buildTool()` 팩토리 경유)
- `isConcurrencySafe` 를 static 속성으로 고정 (입력 기반 판정 원칙 위반)
- `validateInput` 내부에서 I/O 또는 부수 효과 (순수 검증만)
- Read 없이 Edit 도구 호출 허용 (mtime 검증 필수)
- 도구 결과를 전체 그대로 context 에 주입 (초과 시 head-truncate + preview)
- 도구 registry 직접 mutate (부팅 후 등록/제거 금지)
- MCP 도구를 `mcp__` prefix 없이 등록 (이름 충돌)
- 도구 정렬 순서 runtime 변경 (prompt cache prefix 무효화)
- 병렬 실행 시 exception swallow (단축 평가 + 예외 전파)

<!-- ━━━ inlined from ./skills/agent-loop-invariants/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 비동기 (async def → async function), 동시성 (asyncio.gather → Promise.all), 루프 (while True → while (true)), 최상위 (asyncio.run → top-level await)

> Language-neutral invariants — Agent Loop 6-stage order, LoopTransition enum, Error Recovery strategy.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/agent-loop-patterns.md`, `ts_agent_rules/agent-loop-patterns.md`.

# Agent Loop Invariants — 언어 무관 불변식

(slug: `agent-loop-invariants` — workflow 의 `agent-loop` 와 구분)

## 6-Stage 구조 (순서 고정, 변경 금지)

```
Stage 1: Context Preparation — compaction 판정 + attachment 수집
Stage 2: Model Call — provider streaming
Stage 3: Error Recovery — prompt-too-long / max-output-tokens
Stage 4: Tool Execution — partition → parallel/sequential batch
Stage 5: Context Merge — tool result + supplementary context
Stage 6: Loop Decision — continue/terminate + transition 기록
```

- 각 stage 는 독립 함수로 분리 (TS `async function stage1_contextPrep(...)`). stage 간 데이터는 `LoopState` 객체로 전달
- 핵심 의존성은 `LoopDeps` interface 로 주입. 메서드 이름은 코드 기준: `providerCall`, `compact`, `uuid`, `lookupTool`, `toolDefinitions`, `countTokens`, `trace`
- `RunPolicyLike` interface: 루프는 구체 `RunPolicy` 대신 structural interface 로 참조 — import cycle 회피 + 테스트 mock 주입 용이. 루프가 읽는 필드는 4개 (`name`, `max_turns`, `compaction_enabled`, `response_schema`)

## LoopTransition enum (8종, 순서 고정)

매 iteration 종료 시 반드시 `LoopTransition` 기록. **기록 없는 종료 금지**.

| 값 | Terminal? | 의미 |
|----|-----------|------|
| `completed` | ✓ | 정상 종료 (assistant message 완성) |
| `aborted` | ✓ | abort signal cascade |
| `max_turns` | ✓ | 강제 종료 상한 도달 |
| `prompt_too_long` | ✓ | PTL 복구 실패 후 종료 |
| `model_error` | ✓ | provider 호출 실패 (재시도 소진) |
| `hook_stopped` | ✓ | pre/post hook 가 stop 결정 |
| `tool_error` | ✓ | 도구 실패 — 모델에 반환 후 별도 종료 시그널 |
| `continuing` | ✗ | 다음 iteration 진행 |

`continuing` 만 non-terminal. 나머지 7종은 terminal.

## Stage 별 핵심 불변

### Stage 1 — Context Preparation
- compaction 트리거 판정 (token budget vs threshold)
- attachment 수집 (고정 순서, prefix cache 보호 — `skills/token-budget-constants/SKILL.md`)
- 결과: `AssembledContext = (system_prompt, messages, tools, generation_params)` — 불변, Stage 2+ 는 read-only

### Stage 2 — Model Call
- provider streaming 호출
- 내부 타입 (`Message`, `ContentBlock`) 으로 전파 — SDK 타입은 provider 경계에서 변환

### Stage 3 — Error Recovery (순서 고정)
- **prompt-too-long**: context collapse → reactive compact → terminate. target ratio = `REACTIVE_TARGET_RATIO=0.70` (`skills/compaction-thresholds/SKILL.md`)
- **max-output-tokens**: token 확대 → nudge message → terminate (재시도 횟수는 코드 상수)

### Stage 4 — Tool Execution
- partition 기반: 연속 concurrent-safe → parallel batch (`Promise.all`), non-safe → sequential
- `isConcurrencySafe(args)` 입력 기반 동적 결정 (`skills/tool-sort-order/SKILL.md`)
- parallel batch 최대 동시 실행 수는 코드 상수 (rule 은 패턴만)
- 도구 에러는 모델에게 반환 — 자동 재시도 금지 (design-principles §5)

### Stage 5 — Context Merge
- tool_result content 는 `wrapToolOutput` 으로 `<tool_output>...</tool_output>` 감싸짐 — indirect injection 방어
- tool_result 가 예산을 초과하면 **루프 내부에서 재-compaction** 트리거 — 다음 iteration 전에 token 회수

### Stage 6 — Loop Decision
- continue/terminate 판정
- `LoopTransition` 기록 (관측성 필수)
- abort signal / max_turns / hook stop / tool error / model error 분기

TS 루프 기본 골격:

```ts
async function agentLoop(state: LoopState, deps: LoopDeps): Promise<LoopResult> {
  while (true) {
    const ctx = await stage1_contextPrep(state, deps);
    const response = await stage2_modelCall(ctx, deps);
    const recovered = await stage3_errorRecovery(response, state, deps);
    if (recovered.terminate) break;
    const toolResults = await stage4_toolExecution(recovered.toolCalls, deps);
    state = await stage5_contextMerge(state, toolResults, deps);
    const decision = stage6_loopDecision(state, deps);
    deps.trace({ transition: decision.transition });
    if (decision.terminal) break;
  }
}
```

## 새 stage / 확장

현재 6-stage 는 고정. 각 stage 내부 확장만 허용:

1. **Stage 1 에 새 attachment 타입**: collector 등록. 변경 빈도 기준 위치 (`skills/token-budget-constants/SKILL.md`)
2. **Stage 4 에 새 hook**: pre_tool_use / post_tool_use chain 등록
3. **Stage 6 에 새 종료 조건**: `LoopTransition` 에 먼저 값 추가 → 판정 로직에 분기
4. **새 LoopDeps 의존성**: interface 메서드 추가 → production + test mock 동시 업데이트

## 공통 금지 사항 (언어 무관)

- 6-stage 순서 변경 또는 stage 병합 (loop invariant 파괴)
- `LoopState` 를 stage 경계 밖에서 직접 mutate (stage 내에서만 변경, 전달은 return)
- 도구 에러를 자동 재시도 (design-principles §5 — 구조화된 에러를 모델 반환)
- `LoopTransition` 기록 없이 종료 (관측성 누락)
- Stage 4 tool 실행 시 `isConcurrencySafe` 체크 생략 후 parallel batch 실행
- Recovery 분기 (prompt-too-long, max-output-tokens) 에서 무한 재시도
- engine/loop 에서 provider SDK 타입 직접 사용 (unified Message/ContentBlock 경계 위반)
- Stage 1 산출물 `AssembledContext` 를 Stage 2 이후에 mutate

<!-- ━━━ inlined from ./skills/app-domain-boundary/SKILL.md ━━━ -->


**적용된 §4.4 매트릭스 행**: 거의 ✕ (protocol-level). 본문 안 도메인 식별자는 `app_*` / `domain_*` 로 일반화 (legacy prefix 잔존 금지).

> **정본** — App backend ↔ 웹서비스 도메인 경계 규약.
> 언어 무관 (Python / TS 공통). 양쪽 `*_agent_rules/architecture.md` 와
> `*_agent_rules/database-patterns.md` 에서 본 파일을 단일 source of truth 로 참조한다.
> 구체적인 ORM / migration 도구 / pool 라이브러리 차이는 각 언어 룰에 명시.

# 앱 도메인 경계 — 데이터 소유권 / 쓰기 규약

## 핵심 원칙

**도메인 엔티티 ground truth 는 웹서비스 소유.** AI 백엔드는 자체 도메인 테이블을
보관하지 않는다. 동일 Postgres 인스턴스를 공유하되 스키마로 분리:

| 스키마 | 소유자 | 내용 |
|--------|--------|------|
| `public.*` | **웹서비스** | 도메인 엔티티 (entity / block / episode / category / character / note / graph_edge / project / app_state 등) — AI 가 소유 안 함 |
| `ai_backend.*` | **AI 백엔드** | 세션 / 메시지 / media job / user_skills 메타 / domain_mutations 감사 / governance jobs / audit_log |

## 접근 경로 — 언어별 분리된 pool

`public.*` (웹서비스 도메인) 접근은 ORM/메인 엔진과 **분리된 전용 pool** 경유. 이유:

- 웹서비스가 raw SQL 중심 (ORM 모델 없음)
- advisory lock / jsonb codec 같은 PostgreSQL 고유 기능 필요
- DSN 분리 (`DOMAIN_DATABASE_URL`) — 누락 시 startup fail (`APP_DATABASE_URL` fallback 없음)

언어별 pool 구현 위치는 각 언어 룰에 명시 (예: TS `src/tools/_domain_db.ts`).

## 도메인 row 쓰기 — 3 조건

`public.*` 의 도메인 row (entity / block / episode / category / graph_edge / character / note 등) 를
INSERT / UPDATE / DELETE 할 때 **반드시 다음 3 조건을 동일 트랜잭션 안에서** 만족:

1. **`lockProject(projectId)` advisory lock**
   - `pg_advisory_xact_lock(bigint)` — lock key 는 `SHA-256("app:project:<id>")` 의 앞 8바이트
   - 프로젝트 단위 직렬화 — 웹서비스 사용자 쓰기 / AI 쓰기 interleave 방지
2. **`ai_backend.domain_mutations` 감사 append**
   - prev / new 값 raw SQL `INSERT` (ORM 모델 **없음** — 테이블 스키마는 migration 에서 직접 관리)
   - 트랜잭션 내부에서 도메인 변경과 함께 atomic
3. **`ToolResult.metadata["resource_updated"]` 신호**
   - 도구 결과에 명시적 변경 신호 — UI 측 캐시 invalidation 트리거

## 예외 — project lifecycle 메타 작업

`public.project` row 자체의 INSERT, `public.app_state` 의 `active_project_id` 키 UPSERT
같은 **project 메타 작업** 에는 위 3 조건 비적용:

- `lockProject` 적용 불가 (project_id 가 아직 없거나 — create / 글로벌 key — switch)
- audit 는 `ai_backend.domain_mutations` 가 아니라 `structuredLog` (구조화 로깅) 으로 대체
- 적용 도구: `domain_create_project`, `domain_switch_project` (V0 신규)

## 마이그레이션 격리

마이그레이션 도구는 `ai_backend.*` 스키마만 관리해야 한다. `public.*` 은 웹서비스가
소유하므로 AI 백엔드의 migration 으로 절대 변경하지 않음.

언어별 구현:
- TS (drizzle / kysely migrate): `include_object` 필터로 `public.*` 제외, 또는 `SET search_path TO ai_backend`

migration autogenerate 가 `public.*` row 를 보면 잘못된 결과 — 필터 검증 필수.

## DSN 분리

| Env var | 사용처 | 누락 시 |
|---------|--------|---------|
| `APP_DATABASE_URL` | `ai_backend.*` (메인 ORM/엔진) | startup fail (production), SQLite fallback (local) |
| `DOMAIN_DATABASE_URL` | `public.*` (웹서비스 도메인 pool) | 즉시 `RuntimeError("DOMAIN_DATABASE_URL is not set")` (production+local 모두) |

`DOMAIN_DATABASE_URL` 은 fallback 없음 — `.env.example` 에 별도 항목 유지.

## 변경 영향

| 변경 | 영향 |
|------|------|
| 새 도메인 엔티티 INSERT 도구 추가 | 3 조건 (lockProject + domain_mutations + resource_updated) 모두 적용 + 테스트 |
| project lifecycle 도구 추가 | 예외 패턴 적용 + audit 로깅 (3 조건 아님) |
| `lockProject` 키 알고리즘 변경 (SHA-256 앞 8바이트) | 기존 lock 호환성 깨짐 — 웹서비스 측과 동시 배포 필요 |
| `ai_backend.domain_mutations` 스키마 변경 | migration + 감사 로그 호환성 + governance 보존 정책 |
| 마이그레이션 격리 필터 누락 | autogenerate 가 `public.*` 변경 — 웹서비스 데이터 파괴 위험 |
| `DOMAIN_DATABASE_URL` fallback 추가 | DSN 혼동 — 도메인 분리 원칙 깨짐 |

## 금지 사항

- `public.*` 도메인 row 를 ORM 모델로 매핑 (raw SQL + domain_mutations 만)
- AI 백엔드 자체의 도메인 데이터 사본 보관 (예: `ai_backend.entity_cache`) — ground truth 는 웹서비스 만
- `lockProject` 없이 `public.*` row 쓰기 (race condition + audit 누락)
- `ai_backend.domain_mutations` 누락 (audit trail 누수)
- AI migration 이 `public.*` 건드리기 (스키마 격리 깨짐)
- `DOMAIN_DATABASE_URL` 누락을 silent fallback 으로 무시 (DSN 분리 원칙)
- 도메인 도구가 domain_mutations 쓰지 않고 구조화 로깅으로만 audit 갈음 (예외는 project lifecycle 메타 작업만)

(legacy 출처 경로는 frontmatter `source` 참조)

<!-- ━━━ inlined from ./skills/media-job-lifecycle/SKILL.md ━━━ -->


> Language-neutral invariants — Media job lifecycle, retry classification, stale-lease reaper, tenant ownership.
> 정본 (single source of truth) for Python harness, TS / Hono harness, 그리고 미래 Rust harness.
> Cited from: `stack-backend-python/rules/_shared/media-job-lifecycle.md`, `stack-backend-python/rules/media-pipeline-patterns.md`, `stack-backend-ts-hono/skills/media-pipeline-patterns/SKILL.md`.

# Media Job Lifecycle — 언어 무관 불변식

(slug: `media-job-lifecycle` — workflow 의 `media-pipeline-patterns` 와 구분)

## 검증 대상 invariant 4건

### Invariant 1: 상태 전이 monotone — 역행 금지

```
pending (= queued) → processing (= running) → succeeded (= completed) | failed | canceled | dlq
```

- **역행 금지**: terminal → pending, processing → pending (단, stale-lease reaper 예외 — 아래 참조), succeeded → processing 등 일체 금지
- **점프 금지**: pending → succeeded 직접 전이 ✕ (반드시 processing 거침)
- 단, **`STALE_SEC` 초과한 running lease 의 reaper 복원** (`running` → `queued`, `attemptCount` 보존) 은 의도된 예외 — orphan 복구이지 정상 흐름의 역행이 아님

### Invariant 2: `jobId` = idempotency key — 재시도 멱등

- 동일 `jobId` 로 enqueue 호출 = noop (기존 job 반환). 새 job 생성 ✕
- 동일 `jobId` 로 worker 가 다시 pickup 해도 result 가 달라지면 안 됨 (handler idempotent 의무)
- 클라이언트 retry 시 새 `jobId` 발급하지 말고 기존 `jobId` 로 polling

### Invariant 3: terminal 후 result immutable

- `status ∈ TERMINAL_JOB_STATUSES` 이면 `result` / `resultPath` / `resultMetadata` / `error` 필드 **변경 ✕**
- 변경이 필요한 경우 = **새 job 생성** (새 `jobId`)
- DB 모드: terminal row 에 UPDATE 시 `WHERE status IN (terminal)` 조건 + check constraint 또는 `RETURNING` 검증으로 차단
- KV 모드: WriteCoordinator 가 terminal guard 검증 후 stale write drop (`media.stale_terminal_write` 경고)

### Invariant 4: canceled = soft signal

- `DELETE /media/jobs/<id>` 호출은 **즉시 종료 보장 ✕**. `canceled` 상태 set + worker 의 **다음 checkpoint** 에서 종료
- worker 는 pickup 시 / checkpoint 마다 status 확인 — `canceled` 면 handler skip 또는 cooperative cancel
- 강제 종료 = `AbortController.abort()` cascade 도 가능하지만 **외부 SDK 호출 중간에는 강제 중단 불가** — best-effort 정책
- terminal set 에 포함됨 (`TERMINAL_JOB_STATUSES`) — 일단 `canceled` 면 추가 전이 ✕

## TypeScript 표현 (apps/api)

```typescript
// src/services/media/types.ts
export type MediaJobStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'dlq';

export interface MediaResult {
  resultPath?: string;                                  // R2 key
  resultMetadata?: Record<string, unknown>;
}

export interface MediaJob {
  jobId: string;                                        // crypto.randomUUID() 기반 + 'job_' prefix
  userId: string | null;
  category: 'image' | 'audio' | 'video';
  op: string;                                           // qualified name (e.g. 'image.generate')
  status: MediaJobStatus;
  attemptCount: number;
  nextRetryAt: string | null;                           // ISO 8601
  request: Record<string, unknown>;                     // op-specific params
  result?: MediaResult;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export const TERMINAL_JOB_STATUSES: ReadonlyArray<MediaJobStatus> = [
  'succeeded',
  'failed',
  'canceled',
  'dlq',
] as const;

export function isTerminal(status: MediaJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}
```

### 6-state ↔ 본 invariant 의 매핑

본 invariant 가 정의한 6 상태 (`MediaJobStatus` = pending / processing / succeeded / failed / canceled / dlq) 는 **외부 API contract**. `media-pipeline-patterns` workflow 의 6 internal stage (queued / running / completed / failed / canceled / dlq) 와 다음과 같이 매핑:

| 본 invariant `MediaJobStatus` (external) | workflow `InternalJobStage` (internal) | 비고 |
|----------------------------------------|---------------------------------------|------|
| `pending` | `queued` | enqueue 직후 |
| `processing` | `running` | worker pickup + handler 호출 직전 |
| `succeeded` | `completed` | handler 성공 |
| `failed` | `failed` | handler 예외 (legacy 경로) |
| `canceled` | `canceled` | DELETE 트리거, soft signal |
| `dlq` | `dlq` | retry 예산 소진 또는 permanent error |

> 매핑 함수 = `toExternalStatus(stage: InternalJobStage): MediaJobStatus` (workflow skill `media-pipeline-patterns` 정의). DB column / worker queue 는 `InternalJobStage` 사용, 외부 응답은 `MediaJobStatus`. 본 invariant 의 4 invariant (monotone / idempotency / immutable / soft cancel) 는 두 vocabulary 모두에 적용 — terminal set 도 6 stage 모두 포함 (`TERMINAL_JOB_STATUSES` ⊇ `succeeded` / `failed` / `canceled` / `dlq`, `TERMINAL_INTERNAL_STAGES` ⊇ `completed` / `failed` / `canceled` / `dlq`).

## 위반 = 즉시 차단

다음 코드는 **PR / CI 시 차단**:

```typescript
// ✕ pending → succeeded 직접 점프 (Invariant 1 위반)
await db.update(mediaJobs).set({ status: 'succeeded', result }).where(eq(mediaJobs.id, jobId));
// (이 row 의 status 가 'pending' 이었으면 → CHECK constraint 또는 transition guard 가 reject)

// ✕ terminal → pending 역행 (Invariant 1 위반, reaper 예외 제외)
await db.update(mediaJobs).set({ status: 'pending' }).where(eq(mediaJobs.id, jobId));

// ✕ 동일 jobId 에 다른 result write (Invariant 3 위반)
const job = await getJob(jobId);
if (job.status === 'succeeded') {
  await db.update(mediaJobs).set({ result: differentResult }).where(eq(mediaJobs.id, jobId));
}

// ✕ canceled 강제 즉시 종료 (Invariant 4 위반 — soft signal 이어야 함)
await killWorkerHandler(jobId);                       // 외부 SDK 가 중간에 cancel 안 됨
```

### 정상 코드

```typescript
// ✅ 상태 전이는 trasition function 경유 (CHECK 와 guard 둘 다)
export async function transitionJob(
  db: Database,
  jobId: string,
  from: MediaJobStatus,
  to: MediaJobStatus,
): Promise<void> {
  if (isTerminal(from)) {
    throw new Error(`cannot transition out of terminal status: ${from} → ${to}`);
  }
  const updated = await db
    .update(mediaJobs)
    .set({ status: to, updatedAt: new Date().toISOString() })
    .where(and(eq(mediaJobs.id, jobId), eq(mediaJobs.status, from)))
    .returning({ id: mediaJobs.id });
  if (updated.length === 0) {
    throw new Error(`stale transition: ${jobId} not in expected status ${from}`);
  }
}

// ✅ result write 는 transition 과 atomic
export async function completeJob(
  db: Database,
  jobId: string,
  result: MediaResult,
): Promise<void> {
  await db.transaction(async (tx) => {
    await transitionJob(tx, jobId, 'processing', 'succeeded');
    await tx.update(mediaJobs).set({ result }).where(eq(mediaJobs.id, jobId));
  });
}

// ✅ cancel 은 status set 만, handler kill 시도 ✕
export async function cancelJob(db: Database, jobId: string): Promise<void> {
  await db
    .update(mediaJobs)
    .set({ status: 'canceled', updatedAt: new Date().toISOString() })
    .where(and(eq(mediaJobs.id, jobId), notInArray(mediaJobs.status, [...TERMINAL_JOB_STATUSES])));
  // worker 가 다음 checkpoint 에서 status 확인 + skip
}
```

## 핵심 상수 (언어 무관)

| 상수 | 값 | 의미 |
|------|----|------|
| `STALE_MS` | 1_800_000 (30분) | claim 후 이 시간 지나면 stale 로 판정 + reaper 복원 |
| `MAX_ATTEMPTS` | 5 | retry 예산 (분류된 retryable 에러) |
| `MAX_UNKNOWN_ATTEMPTS` | 3 | 분류 안 된 에러의 retry 예산 |
| Backoff 시퀀스 | `10s → 40s → 160s → 640s → 2560s` | exponential ± 25% jitter |
| `CATEGORY_CAPS` | `{ image: 100, audio: 200, video: 50 }` | queued 상태 row 개수 상한. 초과 시 429 + `Retry-After: 60` |
| `CATEGORY_CONCURRENCY` | `{ image: 2, audio: 3, video: 1 }` | per-category worker pool 크기 |

## Stale-lease reaper (Invariant 1 예외)

- 모든 claim 은 `workerId` + `claimedAt` 을 row 에 기록 (dequeue SQL 이 atomic 하게 증가)
- 부팅 시 + 주기적 (Cron Trigger `*/15 * * * *`) 으로 `resetStaleLeases(cutoff = now - STALE_MS)` 실행 — `claimedAt < cutoff` 인 `running` (= `processing`) row 를 `queued` (= `pending`) 로 복원 (`attemptCount` 보존, `workerId` / `claimedAt` 초기화)
- 본 invariant 1 의 monotone 규칙의 **유일한 예외** — orphan 복구이지 정상 흐름의 역행이 아님
- Handler 는 idempotent 해야 함 (재시작 시 max 1회 추가 실행) — Invariant 2 의 idempotency key 와 일관

## 테넌트 소유권 (IDOR fix)

- `MediaJob.userId: string | null` — 신규 job 은 enqueue 라우트가 auth context 에서 채움. nullable 은 pre-fix 데이터 호환용 — 신규 생성 시 `null` 금지
- `GET` / `DELETE /media/jobs/{id}`: 소유자 불일치 + wildcard scope 없으면 **leak-safe 404** (403 금지 — 존재 자체를 leak 하지 않음)
- 구현: `assertOwnerOrWildcard` (`job.userId !== caller && !hasScope(scopes, '*')` → 404)

## 에러 처리 + 자동 retry

- Worker 는 cancel 시그널 전파 (`AbortSignal`) + 핸들러 실패는 분류 후 전이
- **분류 기반 자동 retry** — worker 가 handler 예외를 `classifyError` 로 분류:
  - retryable (429 / 5xx / timeout / connection) → `scheduleRetry` + exponential backoff
  - permanent (4xx / validation) → 즉시 `markDlq`
  - retry 예산 소진 → DLQ
- LLM 도구 에러 정책 (모델 반환) 은 적용 안 됨 — 미디어는 모델이 호출자가 아님
- 에러 message 는 worker 가 `scrubSecrets` 적용 후 `job.error.message` 에 저장 (SDK exception 에 API key 포함 가능성)

## 공통 금지 사항 (언어 무관)

- 상태 전이 monotone 위반 (역행 / 점프) — Invariant 1
- 동일 `jobId` 로 신규 row 중복 생성 — Invariant 2
- terminal 후 `result` / `error` mutate — Invariant 3
- `canceled` 강제 즉시 종료 (`AbortController.abort()` 외 — 외부 SDK 중간에는 ✕) — Invariant 4
- 결과물을 HTTP body 로 inline 반환 (반드시 R2 key / signed URL)
- `WriteCoordinator` 우회한 직접 바이너리 쓰기 (single writer 위반)
- DB 모드에서 transaction 우회한 raw SQL / 직접 execute
- 호출자가 concrete 구현체 import (오직 `MediaJobPort` interface 만 참조)
- LLM 루프에서 `/media/*` 를 tool 처럼 HTTP 호출 (필요 시 미디어 전용 도구를 `tools/` 에 추가)
- SSE 이벤트 스트림으로 미디어 결과 전송 (/run vs /media 분리 원칙 위반)
- Handler exception message 를 scrub 없이 `job.error` 에 저장 (API key leak)
- 영속화된 `error.message` 를 scrub 없이 logger 로 emit (이중 leak 경로)
- `jobId` 에 개인정보 / 순차 카운터 사용 (UUID 기반 강제)
- `userId` 없이 신규 job 생성 (auth context 에서 반드시 주입)
- Job 조회 / 취소 시 `assertOwnerOrWildcard` 우회 (leak-safe 404 깨짐)
- 동일 op 를 `registerHandler` 로 두 번 다른 callable 등록 (idempotent 는 같은 callable 만)

<!-- ━━━ inlined from ./skills/architecture-invariants/SKILL.md ━━━ -->


# architecture-invariants (overview / meta)

> 본 skill = apps/api 의 **16 invariant** 카탈로그 + 라우팅 가이드. 각 invariant 의 원칙·금지·grep 패턴은 개별 invariant SKILL.md 가 정본 — 본 파일은 *어디서 어떤 invariant 를 봐야 하는지* 만 안내한다.
> Cited from: Python 측 14 invariant 카탈로그 (legacy). TS 측 = workers-compat + media-job-lifecycle 추가 → 16 invariant. 도메인 boundary invariant 는 `app-domain-boundary` 로 rename (메모리 룰 — 도메인 중립 식별자).

## 이 skill 은 언제 invoke 되는가

- `apps/api/` 안에서 새 모듈 작성 시 (어느 invariant 가 적용되는지 빠르게 매핑)
- "이 변경 이 invariant 깨뜨리나?" 빠른 확인 필요 시
- 새 invariant 추가/삭제 시 (본 파일 카탈로그 갱신)
- code review 준비 — 변경 영역에 걸리는 invariant 만 좁히기

## 원칙은 개별 invariant SKILL.md 에 있다

**불변식 본문 / 금지 사항 / grep 패턴 / 영향도** 는 모두 개별 invariant SKILL.md 안에 있다. 본 skill 은 **인덱스 + 라우팅** 만 담당한다. 충돌 시 개별 invariant SKILL.md 가 authoritative.

## 16 invariant 카탈로그

| invariant | 적용 상황 |
|---|---|
| workers-compat | 모든 코드 — `Buffer` / `fs` / `process.env` 직접 접근 ✕ (apps/api 는 Workers compat) |
| single-writer | SSE 응답 — writer 1개만 (`streamSSE` 내부에서 동시 write ✕) |
| provider-retry-matrix | LLM / 외부 API 호출 — p-retry + CircuitBreaker + per-provider 재시도 분류 |
| token-budget-constants | context 조립 / compaction 판정 — js-tiktoken 카운트 + 5 budget 상수 |
| sse-lifecycle | SSE 응답 라이프사이클 — 12 이벤트 / 종료 4 제약 (`done` 미누락 / `done` + `error` 배타 / `usage` direct-before-`done` / payload 메타 혼합 ✕) |
| compaction-thresholds | context 81% 도달 시 — compaction 트리거 / 결과 검증 / 실패 시 폴백 |
| http-error-sentinels | `HTTPException` 던질 때 — 4 패턴 (공개 envelope / 내부 throw / 부팅 throw / 옵션 null+warn) |
| input-safety-gate-ordering | 사용자 입력 처리 시 — gate 순서 (size → schema → safety → policy) 고정 |
| mcp-namespace | MCP tool 등록 시 — namespace prefix + 충돌 검출 + 도구 정렬 안정성 |
| run-policy-presets | agent run 시작 시 — interactive / classifier / tool-based / multi-agent 4 preset + cross-field validation |
| spawn-limits | sub-agent spawn 시 — `MAX_SPAWN_DEPTH = 3` / `SpawnDepthExceeded` / `checkDepth()` 가드 / CacheSafeParams |
| tool-sort-order | tool list 렌더링 시 — built-in (이름순) → MCP (이름순) cache-stable 정렬 |
| agent-loop-invariants | agent loop 실행 시 — 6-stage 순서 고정 + LoopTransition 8종 + LoopDeps/LoopState/RunPolicyLike |
| app-domain-boundary | 도메인 분리 검증 시 — 백엔드는 도메인 어휘 ✕, 식별자 중립 |
| media-job-lifecycle | 미디어 job 처리 시 — 6-state machine + terminal status 집합 + 상태 전이 단방향 |
| architecture-invariants | (본 skill 자체 = 메타 라우터 — 카탈로그 갱신용) |

## 적용 매핑 (작업 → invariant 묶음)

각 코드 영역 작업 시 *동시에* 적용되는 invariant 묶음:

| 작업 영역 | 적용 invariant |
|---|---|
| 새 route 추가 (`src/routes/`) | workers-compat + http-error-sentinels + (auth) |
| LLM 호출 (`src/providers/`) | workers-compat + provider-retry-matrix + token-budget-constants + tool-sort-order |
| SSE 응답 핸들러 | workers-compat + sse-lifecycle + single-writer + token-budget-constants |
| context 조립 (`src/engine/context.ts`) | workers-compat + token-budget-constants + compaction-thresholds + tool-sort-order |
| 새 tool 등록 (`src/tools/`) | workers-compat + tool-sort-order + mcp-namespace |
| 새 sub-agent 호출 (`src/tools/spawn.ts`) | workers-compat + spawn-limits + agent-loop-invariants + run-policy-presets |
| 사용자 입력 처리 (`src/middleware/safety.ts`) | workers-compat + input-safety-gate-ordering + http-error-sentinels |
| 미디어 job 처리 (`src/media/`) | workers-compat + media-job-lifecycle + (single-writer 의 미디어 쓰기 부분) |
| 도메인 영역 침범 검토 | app-domain-boundary (+ 모든 import 직접 grep) |

## 새 invariant 추가 절차

1. `apps/api/src/<area>/` 안 새 불변 식별 (지속적 / 위반 시 큰 비용)
2. 별도 SKILL.md 작성 — `metadata.role: invariant` + scope/source 명시
3. 본 SKILL.md 카탈로그 표에 1행 추가 (적용 상황 컬럼)
4. 적용 매핑 표에도 해당 작업 영역에 추가
5. 가능하면 audit skill 도 동시 추가 (`<invariant>-audit`) — `audit-all.sh` 에 등록
6. pre-deploy-check chain 에 추가 검토 (위반이 배포 차단 사유면)

## 새 invariant 삭제 절차

1. 코드에서 해당 패턴 사용처 0 확인
2. 본 SKILL.md 카탈로그에서 행 제거
3. 적용 매핑 표 정리
4. audit skill 삭제 + `audit-all.sh` 에서 라인 제거
5. 의존 invariant (다른 SKILL.md 의 "참조" 줄) 갱신

## invariant 변경 vs 새로 추가 판단

| 변경 유형 | 처리 |
|---|---|
| 기존 invariant 의 본문 명확화 / 예시 추가 | 해당 invariant SKILL.md 만 갱신 |
| 기존 invariant 의 *경계* 확장 (예: spawn-limits MAX_SPAWN_DEPTH 3 → 5) | 해당 invariant SKILL.md + 의존 코드 동시 갱신 + audit 갱신 |
| 새 영역 (지속 강제 필요) 발견 | 새 invariant SKILL.md + 본 카탈로그 추가 + audit 추가 |
| 일회성 / 단발 규칙 | invariant ✕ — workflow 또는 audit 으로 처리 |

## 자주 보는 함정

- **"이거 invariant 인가, workflow 인가?"** → *지속 강제 + 위반 시 큰 비용* = invariant. *어떻게 작성하는지 절차* = workflow. *기존 코드 점검 grep* = audit.
- **"단일 invariant 가 너무 커진다"** → 분리. invariant 1개당 한 가지 불변에 집중 (예: sse-lifecycle 은 이벤트 집합만, single-writer 는 동시 writer 만).
- **"invariant SKILL.md 와 코드가 다르다"** → invariant 가 정본. 코드 정정 또는 사용자 합의 후 invariant 갱신 — *코드 일치를 핑계로 invariant 슬쩍 완화 ✕*.
- **새 invariant 카탈로그 미갱신** → 본 SKILL.md 가 stale → agent 가 invariant 누락 → 위반 코드 통과. 신규 추가 시 본 카탈로그 갱신 의무.

## 검증 체크리스트

- [ ] 본 SKILL.md 카탈로그 행 수 = `ls plugins/stack-backend-ts-hono/skills/ | rg -c '^(workers-compat|single-writer|provider-retry-matrix|token-budget-constants|sse-lifecycle|compaction-thresholds|http-error-sentinels|input-safety-gate-ordering|mcp-namespace|run-policy-presets|spawn-limits|tool-sort-order|agent-loop-invariants|app-domain-boundary|media-job-lifecycle)$'` = 15 (본 skill 제외)
- [ ] 적용 매핑 표 = 작업 영역마다 *모든* 관련 invariant 명시 (누락 ✕)
- [ ] 신규 invariant 추가 시 — 카탈로그 + 적용 매핑 동시 갱신
- [ ] 모든 카탈로그 행에 frontmatter `name` 일치하는 SKILL.md 존재

## 구현 중 막히면

- `apps/api/` 디렉토리가 없음 → NOT_YET_IMPLEMENTED. invariant 만 정의되고 적용 코드는 추후
- "이 변경에 어떤 invariant 가 걸리는지 모르겠다" → 작업 영역 컬럼 매핑 표 참고. 그래도 모르면 사용자 확인
- 새 invariant 가 기존 invariant 와 중복 → 통합 또는 한 쪽 폐기. 같은 영역의 invariant 2개 공존 ✕

---

## 사용 가능한 workflow 스킬 39개 (on-demand, description trigger)

- `backend-overview` — 코드베이스 진입 / 모듈 위치 결정
- `provider-layer` — 새 LLM provider 추가 / retry-timeout 수정
- `sse-streaming` — Hono SSE route 추가/수정
- `tool-system` — LLM tool calling 추가/수정
- `agent-loop` — agentic loop 구현
- `context-assembly` — 컨텍스트 조립 / token budget 적용
- `mcp-integration` — MCP 서버 연결 / 도구 prefix
- `compaction` — conversation 요약·압축
- `api-routing` — Hono route / middleware / onError
- `auth` — 인증·세션·시크릿
- `error-handling` — 에러 sentinel / onError / structured log
- `sub-agent` — sub-agent 호출 (Workers 호환)
- `debug-session` — 백엔드 debug session (Hono+Workers 특화)
- `update-config-runtime` — Workers c.env 바인딩 / .dev.vars / wrangler.toml (renamed)
- `data-governance` — 데이터 거버넌스 (retention/PII/portability) 정책 결정 시
- `data-layer` — Repository/DAO 패턴, transaction, optimistic locking 추가 시
- `database` — DB 선택·연결·마이그레이션 (Workers 호환 Neon, D1 ✕)
- `testing-infra` — Vitest+Hono 테스트 인프라 셋업 시
- `test-scaffold` — 새 route/service/provider 테스트 골격 생성 시
- `test-cleanup` — afterEach/afterAll DB/KV/mock 정리 패턴 시
- `red-green-fix` — TDD red→green→refactor 사이클 시
- `pre-deploy-check` — Workers 배포 전 6-step 체인 (type/lint/audit-all/vitest/whoami/dry-run)
- `ai-agent-patterns` — AI agent 휴리스틱 / context budgeting / safety gate
- `coding-standards` — TS 백엔드 코딩 컨벤션 (eslint/prettier/biome)
- `commit-rules` — conventional commit + scope 카탈로그
- `design-principles` — YAGNI / DRY / SoC / TS 예시
- `media-pipeline-patterns` — 미디어 R2/ML-worker 파이프라인 (Workers compat)
- `codex-commands` — Codex slash command 카탈로그 + arg 파싱
- `codex-subagents` — Codex subagent dispatch 가이드
- `ts-agent-rules` — TS 백엔드 agent 룰 카탈로그 + core-infra 흡수
- `new-agent` — 새 agent 추가 절차 (AgentDef + Codex marker)
- `new-run` — 새 run 추가 절차 (SSE + budget + abort)
- `lsp-server` — tsc/vtsls 진단 (Workers vs Node 분리)
- `performance-profiling` — 0x/clinic/node --inspect
- `incident-triage` — wrangler tail / Sentry / rollback
- `security-runtime` — zod parse / rate limit / CSRF / audit log
- `usage-tracking` — LLM 토큰 사용량 집계 + Cron Triggers
- `provider-scaffold` — 새 provider 추가 스캐폴딩
- `provider-catalog-sync` — OpenRouter 모델 카탈로그 sync (Node 전용)

## 사용 가능한 audit 스킬 24개 (on-demand)

> 13 = M2.5 Task 4.1-4.12 + d1-forbidden-audit (Task 6.4). +11 = M2.5 Task 9e.1-9e.11 (audit-port). M2.5 audit 총 24.
> 배포 전 / provider 추가 후 / route 추가 후 등 *변화 후 검증* 시 trigger.

### 기존 13 audit

- `provider-retry-audit` — retry-able vs fatal sentinel 매트릭스 (provider 추가 후)
- `sse-lifecycle-audit` — 4-state + onAbort + heartbeat (SSE route 변경 후)
- `single-writer-audit` — KV/R2/UPDATE lock 없는 다중 writer (DB 코드 변경 후)
- `token-budget-audit` — token 상수 import vs 매직 넘버 (context 변경 후)
- `tool-sort-order-audit` — tool 등록 순서 (tool 추가 후)
- `input-safety-audit` — auth → schema → rate-limit → handler 순서 (route 추가 후)
- `mcp-namespace-audit` — prefix 누락·중복 (MCP 추가 후)
- `compaction-thresholds-audit` — threshold 매직 넘버 (compaction 변경 후)
- `http-error-sentinels-audit` — throw HTTPException vs Error / c.json 직접 (error path 변경 후)
- `run-policy-presets-audit` — timeout/max-turn preset 우회 (AI run 코드 변경 후)
- `spawn-limits-audit` — parallel call limit 없음 (sub-agent 변경 후)
- `app-domain-boundary-audit` — core 디렉토리 도메인 어휘 누출 (모듈 추가/이동 후)
- `d1-forbidden-audit` — Cloudflare D1 사용 검출 (spec §1.2 enforce, 배포 전 — 06 Task 6.4 산출, Codex 4차 추가)

### 신규 11 audit (Task 9e.1–9e.11)

- `agent-verify-def` — agent def 필수 필드 / 중복 name
- `api-audit` — Hono route zValidator / auth middleware
- `data-audit` — FK 인덱스 / RLS / migration 순서
- `full-architecture-audit` — 24 audit 통합 + madge cycle + 디렉토리 정합
- `infra-audit` — wrangler.toml 필수 키 / bindings / preview env
- `loop-audit` — while(true) 안전성
- `session-audit` — KV TTL / storage adapter 우회
- `security-audit-check` — secret 하드코딩 / eval / SSRF / SQL injection
- `rule-linting` — SKILL.md frontmatter 검증
- `dependency-scanning` — npm audit CVE + Workers-incompat
- `runtime-verify` — deploy 직후 health / SSE timing
