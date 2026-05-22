---
name: config-env-validation
description: <api-app> 의 모든 환경변수 / 시크릿 접근에 적용되는 정본 invariant. startup fail-fast (assertRequiredSecrets 단일 진입점), Env Bindings 타입 + 코드 접근 정합, ${VAR} 치환 정책의 3-mode (raise / keep_placeholder / empty) caller 별 분기, ConfigurationError 통일. 누락 시 startup 실패 또는 첫 요청 실패.
metadata:
  role: invariant
  scope: project
---

# Config / Env Validation — 언어 무관 불변식

> Language-neutral invariants — startup fail-fast, env binding 접근 정합, ${VAR} 치환 policy.
> 정본 (single source of truth) — 분산된 env 검증 룰을 한 곳으로.

## 핵심 원칙

**시크릿 / 환경변수 누락은 startup 또는 첫 요청 시점에서 명확한 에러로 실패**. 런타임 중 silent fallback / undefined 전파 ✕.

## 1. 시크릿 접근 단일 함수

모든 시크릿 접근은 `getSecret(name, version?)` (또는 동등 helper) 단일 함수 경유:

```typescript
// src/config/secrets.ts
import { ConfigurationError } from '../errors.ts'

export function getSecret<K extends keyof Env['Bindings']>(
  env: Env['Bindings'],
  name: K,
): string {
  const value = env[name]
  if (value === undefined || value === null || value === '') {
    throw new ConfigurationError(`secret missing: ${String(name)}`)
  }
  return value as string
}
```

- 직접 `<framework env binding>.X` 접근도 OK — 단, **사용 직전 검증 (undefined 체크)** 의무
- `process.env.X` 사용 ✕ (일부 runtime 에서 undefined — runtime-specific, instance 측 project-local skill 참조)
- secret 로깅 ✕ (logger 가 자동 redact — `structured-log-schema` invariant)

## 2. assertRequiredSecrets — startup 검증

부팅 시점에 필수 시크릿 누락을 일괄 검출:

```typescript
// src/config/assert-secrets.ts
const REQUIRED_SECRETS: ReadonlyArray<keyof Env['Bindings']> = [
  'AUTH_SECRET',
  'DATABASE_URL',
  // ... runtime / framework 에 따라
] as const

export function assertRequiredSecrets(env: Env['Bindings']): void {
  const missing: string[] = []
  for (const name of REQUIRED_SECRETS) {
    if (env[name] === undefined || env[name] === '') {
      missing.push(String(name))
    }
  }
  if (missing.length > 0) {
    // 로그에는 누락된 key 이름 기록 (운영자용)
    // 응답에는 일반화된 메시지만 ("service misconfigured")
    throw new ConfigurationError(`missing required secrets: ${missing.join(', ')}`)
  }
}
```

호출 시점:
- **부팅 가능한 runtime**: 부팅 시 1회 (`src/index.ts` lifespan)
- **stateless runtime** (예: edge function): 첫 요청 시점 (lazy init + cache)

## 3. Env Bindings 타입 — 단일 source

Env binding 타입은 한 곳에서 선언, 코드 전반 import:

```typescript
// src/index.ts (또는 src/types/env.ts)
export type Env = {
  Bindings: {
    // === Auth / Session ===
    AUTH_SECRET: string
    SESSION_KV: KVNamespace
    // === DB ===
    DATABASE_URL: string
    // === LLM Providers ===
    OPENROUTER_API_KEY: string
    ANTHROPIC_API_KEY?: string  // optional → undefined 허용
    // ...
  }
}
```

- 새 시크릿 추가 절차:
  1. `Env.Bindings` 타입에 추가
  2. runtime secret store 에 등록 (runtime-specific CLI — instance 측 project-local skill 참조)
  3. `REQUIRED_SECRETS` 배열에 추가 (필수인 경우)
  4. 로컬 secret 파일 (`.env` / `.dev.vars` 등) 갱신 — `.gitignore` 포함 의무

## 4. ${VAR} 치환 정책 — 3 mode

YAML / config 파일 안 `${VAR}` 치환은 **caller 별 정책**:

| Caller | 정책 | onMissing |
|---|---|---|
| `providers.yaml` (LLM credentials) | **fail-fast** | `raise` — 누락 → throw |
| `mcp/registry.json` (MCP servers) | **empty string** | `empty` — POSIX subprocess env convention |
| `runs/*.yaml` (RunPolicy) | **placeholder 유지** | `keep_placeholder` — hot-reload 리뷰에서 surface |

```typescript
// src/config/substitute-env.ts
type OnMissing = 'raise' | 'empty' | 'keep_placeholder'

export function substituteEnv(
  obj: unknown,
  opts: { env: Record<string, string>; onMissing: OnMissing },
): unknown {
  // recurse: string 값에서 ${VAR} 매치 → env[VAR] 치환
  // onMissing 별 분기 — 위반 시 정책 충돌
}
```

**caller 가 정책을 명시 ✕ 하면 호출 거부** — default 없음 (의도된 정책 차이 보존).

## 5. ConfigurationError 일관 변환

모든 config / env 누락은 `ConfigurationError` 로 throw → HTTP 경계에서 500 + `configuration_error` sentinel 로 변환:

```typescript
// src/errors.ts (정본 = error-handling workflow)
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'configuration_error')
    this.name = 'ConfigurationError'
  }
}
```

응답:
- HTTP `500`
- body: `{ error: { code: 'configuration_error', message: 'service misconfigured' } }` (상세 숨김)
- 내부 로그: `scrubText(message)` 적용 (`http-error-sentinels` invariant)

## 6. 로컬 vs 운영 secret 격리

| 환경 | 저장소 |
|---|---|
| 로컬 개발 | 로컬 secret 파일 (`.env` / `.dev.vars` 등 — runtime-specific). `.gitignore` 포함 의무 |
| 운영 | runtime secret store (runtime-specific CLI 등록) |

테스트 fixture 의 secret 은 별도 namespace (`TEST_*` prefix 또는 별도 file) — production secret 과 같은 이름 사용 ✕.

## 공통 금지 사항

- `process.env.<NAME>` 직접 사용 (일부 runtime undefined — `<framework env binding>` 경유)
- 시크릿 누락을 silent fallback 으로 무시 (반드시 `ConfigurationError` throw)
- 시크릿 평문을 코드 / 설정 파일 / git history 에 커밋
- `getSecret` 우회한 직접 env 접근 + 검증 누락 (사용 직전 undefined 체크 ✕)
- `${VAR}` 치환 정책 (`raise` / `keep_placeholder` / `empty`) caller 별 분기 혼동 (provider/MCP/run 의 정책 차이 의도적)
- 시크릿 누락 응답 body 에 누락 key 이름 노출 (응답은 일반화, 로그에만 상세)
- 시크릿 회전 시 dual-key window 생략 (`secret-rotation` workflow 참조)
- `Env.Bindings` 타입에 새 secret 추가 없이 코드에서 사용 (TypeScript strict 우회)
- 로컬 secret 파일을 `.gitignore` 누락
- `assertRequiredSecrets()` 호출 누락 — startup 또는 첫 요청 시점에 검증 의무

## Cross-ref

- `auth` workflow — JWT secret / API key 회전 절차
- `secret-rotation` workflow — dual-key window
- `error-handling` workflow — `ConfigurationError` 정본
- `http-error-sentinels` invariant — `configuration_error` sentinel 매핑
- `provider-retry-matrix` invariant — providers.yaml 의 `${VAR}` raise 정책
- `mcp-namespace` invariant — registry.json 의 `${VAR}` empty 정책
- `run-policy-presets` invariant — runs/*.yaml 의 `${VAR}` keep_placeholder 정책
