---
name: provider-scaffold
description: <api-app> 에 새 LLM provider (Anthropic / OpenAI / Google / OpenRouter / OpenAI-compatible self-hosted) 추가 시 invoke. 7-step 절차 — Provider interface 구현 / retry 매트릭스 / 카탈로그 yaml 항목 / test scaffolding / catalog sync. `provider-layer` 의 단일 변환 원칙 + `provider-retry-matrix` invariant 준수.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/provider-scaffold
---

**적용된 §4.4 매트릭스 행**: `httpx.AsyncClient` → `fetch(url, init)` (runtime fetch + AbortSignal), `pydantic Response` → `zod` schema (`Z.parse(await response.json())`), `tenacity` → `p-retry` 또는 수동 exponential backoff, `typing.Protocol` → TS `interface` (`Provider` — 정본 = `provider-layer` workflow), `dataclass ProviderConfig` → TS `interface` / `zod`, `os.getenv("PROVIDER_KEY")` → `<framework env binding>.<PROVIDER>_API_KEY` (runtime Bindings), `pytest` provider test → `vitest`, `pyyaml` 카탈로그 → `yaml` (npm), Python `register` decorator side effect → `registerProviderClass(name, factory)` 명시 호출 (runtime 빌드 안정성)

# provider-scaffold — 새 프로바이더 추가 가이드

## 이 skill 은 언제 invoke 되는가

- `provider-manager` sub-agent 호출 시 (scaffold 모드)
- 사용자가 "새 provider 추가" 를 요청할 때
- OpenAI-compatible 셀프 호스팅 엔드포인트 등록 시
- spec §1.2 의 "BYOK ✕, OpenRouter 게이트웨이로 대체" 우회 (Anthropic / OpenAI 직접 SDK escape hatch) 추가

## 이 skill 은 언제 invoke 되지 않는가

- 기존 provider 의 retry/timeout 정책 변경 → `provider-layer` workflow
- fallback chain / circuit breaker 디버깅 → `provider-layer` workflow + `provider-retry-audit`
- 모델 카탈로그 항목만 갱신 → `provider-catalog-sync` workflow

## 원칙

- **단일 변환** — provider 의 `convertTo()` / `convertFrom()` 단일 지점에서만 변환. 호출자는 내부 `Message` / `ContentBlock` 만 (`provider-layer` workflow §타입 경계)
- **runtime compat** — `fetch` API + `AbortSignal` 만 사용. `http` / `https` / `node-fetch` ✕ (runtime-specific — instance 측 project-local skill 참조)
- **Secrets = runtime secret store** — `<framework env binding>.<NAME>` 만. `process.env` ✕ (`security-runtime` workflow)
- **테스트 의무** — 7 시나리오 (정상 / streaming / 429 / timeout / 5xx / auth / circuit breaker)
- **카탈로그 yaml 등록 후 sync 실행** — `provider-catalog-sync` workflow

## Case A: 직접 SDK Provider (7-step)

### Step 1: `Provider` interface 구현 파일 생성

`Provider` interface 정본 = `provider-layer` workflow §Provider Interface. 본 SKILL.md 는 **구현 절차만**.

```typescript
// <api-app>/src/ai/providers/<name>.ts
import type { Provider, ProviderEvent, Message } from './base.ts'
import { MessageSchema } from './base.ts'
import pRetry, { AbortError } from 'p-retry'

export interface NewProviderConfig {
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
}

export class NewProvider implements Provider {
  readonly name = 'new-provider'
  readonly supportsTools = true
  readonly supportsStreaming = true
  readonly model: string

  constructor(
    private readonly _config: NewProviderConfig,
    model: string,
  ) {
    this.model = model
  }

  async *callStream(opts: {
    system: string
    messages: Message[]
    tools: Record<string, unknown>[]
    maxTokens?: number
  }): AsyncIterable<ProviderEvent> {
    const body = NewProvider._convertTo({ ...opts, model: this.model })
    const response = await pRetry(
      async () => {
        const r = await fetch(`${this._config.baseUrl ?? 'https://api.example.com'}/v1/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._config.apiKey}`,
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this._config.timeoutMs ?? 60_000),
        })
        if (r.status === 401 || r.status === 403) {
          throw new AbortError('auth_error')  // retry ✕
        }
        if (!r.ok) {
          throw new Error(`provider_error_${r.status}`)
        }
        return r
      },
      { retries: 3, minTimeout: 200, factor: 2 },
    )
    if (response.body === null) throw new Error('no body')
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value === undefined) continue
        for (const ev of NewProvider._parseSseChunk(value)) {
          yield NewProvider._convertFrom(ev)
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }

  countTokens(_messages: Message[]): number {
    // tiktoken / js-tiktoken 또는 provider tokenizer API
    return 0
  }

  // ── 단일 변환 지점 ───────────────────────────────
  private static _convertTo(opts: { system: string; messages: Message[]; tools: unknown[]; model: string; maxTokens?: number }): unknown {
    return {
      model: opts.model,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
    }
  }

  private static _convertFrom(raw: unknown): ProviderEvent {
    // provider 별 SSE 이벤트 → 내부 `ProviderEvent`
    return { type: 'text_delta', payload: { text: '' } }
  }

  private static *_parseSseChunk(_chunk: string): Iterable<unknown> {
    // SSE wire parsing — `event:`, `data:`, `\n\n` 단위
    yield {}
  }
}
```

### Step 2: `PROVIDER_REGISTRY` 등록

`PROVIDER_REGISTRY` 정본 = `provider-retry-matrix` invariant §빌드/부팅 순서.

```typescript
// <api-app>/src/ai/providers/registry.ts (정본 = provider-retry-matrix)
import { NewProvider } from './new-provider.ts'
import { registerProviderClass } from './registry.ts'

// 명시 호출 — side effect import 대신 (runtime 빌드 안정성)
export function registerAllProviders(): void {
  registerProviderClass('new-provider', (config, model) => new NewProvider(config, model))
  // ... 기존 provider 들
}
```

### Step 3: Credentials 타입 + Bindings

```typescript
// <api-app>/src/index.ts (Env Bindings)
export type Env = {
  Bindings: {
    OPENROUTER_API_KEY: string
    NEW_PROVIDER_API_KEY: string   // 추가
    // ...
  }
}
```

```bash
# runtime secret 등록 (production) — runtime-specific CLI (instance 측 project-local skill 참조)
# 예: <runtime CLI> secret put NEW_PROVIDER_API_KEY

# 로컬 개발 — local secret file (gitignored, path 는 runtime-specific)
# echo 'NEW_PROVIDER_API_KEY=sk-...' >> <api-app>/<local-secret-file>
```

> `auth` workflow §시크릿 / `security-runtime` workflow §runtime secrets 참조.

### Step 4: 카탈로그 yaml 항목 추가

```yaml
# <api-app>/catalog/providers/new-provider.yaml
type: new-provider
display_name: "New Provider"
base_url: "https://api.example.com"
credentials_env: NEW_PROVIDER_API_KEY
models:
  - id: new-flagship-1
    context_window: 200000
    max_output: 8192
    supports_tools: true
    supports_streaming: true
    pricing:
      input_per_million: "3.00"
      output_per_million: "15.00"
```

> 카탈로그 정합성 = `provider-catalog-sync` workflow 가 검증.

### Step 5: Fallback chain 등록 (선택)

```yaml
# <api-app>/catalog/fallback-chains.yaml — 운영자 결정 (provider-catalog-sync 가 제안만)
default:
  - openrouter:openrouter/auto
  - new-provider:new-flagship-1
  - anthropic:claude-sonnet-4-7
```

### Step 6: 테스트 scaffold

```typescript
// <api-app>/tests/providers/new-provider.test.ts
import { describe, it, expect, vi } from 'vitest'
import { NewProvider } from '../../src/ai/providers/new-provider.ts'

describe('NewProvider', () => {
  it('정상 호출 — non-streaming', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('event: text_delta\ndata: {"text":"hi"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    const provider = new NewProvider({ apiKey: 'sk-test' }, 'new-flagship-1')
    const events: unknown[] = []
    for await (const ev of provider.callStream({ system: '', messages: [], tools: [] })) {
      events.push(ev)
    }
    expect(events.length).toBeGreaterThan(0)
    fetchMock.mockRestore()
  })

  it('정상 스트리밍', async () => { /* ... */ })
  it('RATE_LIMIT (429) → 재시도', async () => { /* p-retry attempt 추적 */ })
  it('TIMEOUT → 재시도', async () => { /* AbortSignal.timeout 시뮬레이션 */ })
  it('SERVER_ERROR (5xx) → 재시도', async () => { /* ... */ })
  it('AUTH_ERROR (401) → 즉시 실패 (재시도 ✕)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
    const provider = new NewProvider({ apiKey: 'sk-bad' }, 'new-flagship-1')
    await expect(async () => {
      for await (const _ of provider.callStream({ system: '', messages: [], tools: [] })) { /* */ }
    }).rejects.toThrow('auth_error')
    expect(fetchMock).toHaveBeenCalledTimes(1)  // retry 없음
    fetchMock.mockRestore()
  })
  it('CircuitBreaker CLOSED→OPEN→HALF_OPEN 전이', async () => { /* provider-retry-matrix 참조 */ })
})
```

> 테스트 패턴 정본 = `test-scaffold` workflow + `red-green-fix` workflow.

### Step 7: 검증

```bash
# 1. 부팅 — runtime 호환 import 검사
pnpm exec tsc --noEmit

# 2. Provider 등록 확인 (runtime)
pnpm exec vitest run <api-app>/tests/providers/new-provider.test.ts

# 3. Catalog sync 실행 — provider-catalog-sync workflow
pnpm tsx <api-app>/scripts/sync-models.ts --provider new-provider --dry-run

# 4. runtime dev server 부팅 (runtime 환경 실측 — runtime-specific CLI)
# 예: <runtime dev CLI>
# 로컬에서 /run/chat 호출 → 새 provider 응답 확인
```

## Case B: OpenAI-compatible 셀프 호스팅 (코드 변경 없음)

`_openaiBase.ts` (공통 OpenAI-compatible 구현) 가 있으면 **카탈로그 yaml 만 추가**:

### Step 1: 카탈로그 entry

```yaml
# <api-app>/catalog/providers/vllm-internal.yaml
type: openai_compatible
base_url: "http://vllm.internal:8000/v1"
credentials_env: VLLM_KEY
models:
  - id: my-model-v1
    context_window: 32000
    supports_tools: true
    pricing:
      input_per_million: "0.10"   # 자체 호스팅 = 운영자 추정값
      output_per_million: "0.30"
```

### Step 2: runtime Secret + Bindings

```bash
# runtime-specific CLI 로 secret 등록 (instance 측 project-local skill 참조)
# 예: <runtime CLI> secret put VLLM_KEY
```

```typescript
// Env Bindings 추가
VLLM_KEY: string
```

### Step 3: 부팅 확인

```bash
# runtime-specific dev server CLI (instance 측 project-local skill 참조)
# 예: <runtime dev CLI>
curl -s http://localhost:<port>/models | jq .   # 신규 모델 노출 확인
```

## 검증 체크리스트

- [ ] `Provider` interface 의 모든 메서드 구현 (`callStream`, `countTokens`, `name`, `model`, `supportsTools`, `supportsStreaming`)
- [ ] `_convertTo` / `_convertFrom` 가 provider 파일 내에만 존재 (단일 변환)
- [ ] `registerProviderClass` 호출 추가 (`registerAllProviders()` 안에)
- [ ] `Env.Bindings` 에 `<PROVIDER>_API_KEY` 타입 추가 + runtime secret store 등록
- [ ] 카탈로그 yaml 항목 추가 (`<api-app>/catalog/providers/<name>.yaml`)
- [ ] 테스트 7개 시나리오 작성 (vitest)
- [ ] `tsc --noEmit` 통과 (runtime compat)
- [ ] `provider-catalog-sync` workflow 실행 (드라이런 통과)
- [ ] `fetch` + `AbortSignal` 만 사용 (`http` / `node-fetch` ✕)
- [ ] `<framework env binding>.<NAME>` 만 사용 (`process.env` ✕)

## 절대 금지

- `Provider` interface 정의 본 SKILL.md 에 재정의 (정본 = `provider-layer`)
- `PROVIDER_REGISTRY` 정의 본 SKILL.md 에 재정의 (정본 = `provider-retry-matrix`)
- `convertTo` / `convertFrom` 을 provider 파일 밖에 작성
- `node-fetch` / `http` / `https` import (runtime 비호환 가능성 — instance 측 project-local skill 참조)
- `process.env.<NAME>` 사용 (일부 runtime 에서 undefined)
- side effect import (`import './new-provider'` 만으로 등록 — runtime 빌드 tree-shaking 위험)
- retry 대상 아닌 에러 (auth / validation / quota) 를 재시도 → `AbortError` 명시
- 카탈로그 yaml 없이 fallback chain 에 추가 (pricing lookup 실패)

## 구현 중 막히면

- `Provider` interface 정의 모름 → `provider-layer` workflow §Provider Interface
- `PROVIDER_REGISTRY` 정의 모름 → `provider-retry-matrix` invariant §빌드/부팅 순서
- `_openaiBase.ts` 구조 모름 → `<api-app>/src/ai/providers/_openaiBase.ts` 직접 read
- credentials 패턴 모름 → `auth` workflow §runtime secrets
- 카탈로그 yaml 스키마 모름 → `provider-catalog-sync` workflow §카탈로그 schema

## Cross-ref

- `provider-layer` (Provider interface 정본, model resolution)
- `provider-retry-matrix` (PROVIDER_REGISTRY 정본, retry / circuit breaker)
- `provider-catalog-sync` (카탈로그 yaml diff / write)
- `auth` (runtime secrets / runtime secret store CLI)
- `security-runtime` (`process.env` ✕)
- `test-scaffold` (테스트 패턴)
- `red-green-fix` (TDD)
- runtime 호환성 (instance 측 project-local skill — `fetch` / `AbortSignal` 만)
