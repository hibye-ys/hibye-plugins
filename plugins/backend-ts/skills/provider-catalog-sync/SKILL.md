---
name: provider-catalog-sync
description: <api-app> 의 provider 모델 카탈로그 (bundled snapshot + FUZZY 별칭 + ENV default) 새로고침 시 invoke. 주요 provider 릴리스 직후 / `_meta.updated` 3개월 경과 / 새 provider 추가 직후 운영 절차. PROVIDER_SOURCES 표가 유일한 provider별 지식 — 새 provider 추가 = 행 1개 추가.
metadata:
  role: workflow
  scope: project
---

**적용된 §4.4 매트릭스 행**: `httpx.AsyncClient` / `httpx.get` → `fetch(url, init)` (sync 스크립트는 Node), `pyyaml` (`yaml.safe_load` / `yaml.safe_dump`) → **`yaml` (npm)** (`parse` / `stringify`), `difflib.unified_diff` → **`diff` (npm)** (`createTwoFilesPatch` / `createPatch`), `pydantic` 모델 → `zod` schema (`Z.parse`), `pytest` → `vitest` (테스트), `json.dump` (snapshot file) → `await writeFile(path, JSON.stringify(data, null, 2))`, `os.getenv("OPENROUTER_API_KEY")` → `process.env.OPENROUTER_API_KEY` (스크립트는 Node), `tenacity` → `p-retry` (네트워크 fetch 재시도), Python `WebFetch` (skill tool) → **Claude Code WebFetch tool** (동일 — 본 skill 실행 시 WebFetch 호출)

# provider-catalog-sync — 프로바이더 모델 카탈로그 동기화

## 언제 invoke 되는가

- 주요 provider 릴리스 (new flagship, deprecation 공지) 직후
- `bundled_models.json._meta.updated` 가 3개월 이상 된 경우
- 새 provider 가 `PROVIDER_REGISTRY` 에 추가된 직후 (그 provider 의 공식 소스를 아래 표에 등록)
- 사용자가 "모델 목록 업데이트", "최신 모델 반영" 요청 시

## 언제 invoke 되지 않는가

- 단발 모델 capability 조회 → `provider-layer` workflow
- fallback chain 순서 조정 → `<api-app>/catalog/fallback-chains.yaml` 직접 편집 (런타임 hot reload 없음, 재배포 필요)
- 새 provider **클래스** 추가 → `provider-scaffold` workflow (본 skill 은 그 다음 실행)

## 원칙

- **Provider-agnostic**: 아래 `PROVIDER_SOURCES` 표가 유일한 provider 별 지식. 새 provider 추가 = 표에 행 하나 추가
- **3 소스 교차검증**: 공식 문서 (WebFetch) + models.dev API (fallback) + live API listing (선택). 한 소스만 믿지 않음
- **Config 는 운영자 결정**: `<api-app>/catalog/fallback-chains.yaml` 변경은 **제안만** 출력. 본 skill 이 직접 쓰지 않음
- **Fail-safe**: diff 결과가 비어 있어도 `_meta.updated` 는 갱신 (sync 이력 보존)
- **runtime 비호환 — Node 스크립트**: 본 sync 작업은 `pnpm tsx <api-app>/scripts/sync-models.ts` 로 Node 에서 실행. 일부 runtime (예: edge / isolation 기반) 에서 실행 ✕ (instance 측 project-local skill 참조)

---

## PROVIDER_SOURCES (확장 지점)

새 provider 가 `PROVIDER_REGISTRY` 에 추가되면 아래 표에 행 하나만 추가하면 된다. Discovery 단계는 이 표를 iteration 한다.

| provider type | 공식 문서 URL (WebFetch — primary) | models.dev prefix (fallback, **현재 API 엔드포인트 불안정**) | live listing API |
|---|---|---|---|
| `anthropic` | `https://docs.anthropic.com/en/docs/about-claude/models/overview` | `anthropic/` | `Anthropic` SDK `client.models.list()` |
| `openai` | `https://platform.openai.com/docs/models` | `openai/` | `openai` SDK `client.models.list()` |
| `google` | `https://ai.google.dev/gemini-api/docs/models/gemini` | `google/` | `@google/generative-ai` SDK list |
| `openrouter` | `https://openrouter.ai/models` | (모든 prefix) | `GET https://openrouter.ai/api/v1/models` |
| `openai_compatible` | — (self-hosted, 운영자 문서) | 없음 | 엔드포인트별 `/v1/models` |

**확장 예**: xAI Grok provider 가 추가되면 `grok / https://docs.x.ai/api/models / xai/ / xai SDK models.list()` 행 추가.

### models.dev API 주의

`https://models.dev/api/models.json` 은 시점에 따라 **302 → HTML landing page** 로 재지향되어 JSON 을 반환하지 않는 것이 관찰된 적 있음 (Python 측 sync 실패 원인). 다음 sync 시 재확인 순서:

1. `curl -sI https://models.dev/api/models.json` 으로 리다이렉트 여부 확인
2. 실패 시 대체 경로 탐색: `/data/models.json`, `api.models.dev/v1/models`, 프로젝트 GitHub repo (보통 `models.dev` 는 공개 JSON 을 repo 에 둠)
3. 모두 실패면 **공식 문서 (WebFetch) 만으로 진행** 하되 sync 보고서에 단일 소스 사실 명시 → 다음 sync 주기에 재검증

---

## Sync Process (5-step)

### Step 1. 현재 상태 스냅샷

```bash
# 등록된 provider type 확인 (표 iteration 기준)
rg "registerProviderClass\(['\"](\w+)['\"]" <api-app>/src/ai/providers/

# bundled snapshot 메타 확인
node -e "const d = require('./<api-app>/catalog/bundled_models.json'); console.log(d._meta); console.log(Object.keys(d.models).sort())"

# Router 별칭 + env default
rg "FUZZY_MAP|ENV_DEFAULT_MODEL" <api-app>/src/ai/
```

### Step 2. 각 provider 공식 문서 fetch (WebFetch)

등록된 provider type 각각에 대해 `PROVIDER_SOURCES` 표의 공식 URL 을 **Claude Code WebFetch tool** 로 조회. 프롬프트:

> "이 페이지에서 현재 'active' 또는 'GA' 또는 'recommended' 로 표기된 모델 ID 전체 리스트를 JSON 배열로 추출해줘. 각 항목은 `{id, displayName, contextWindow, maxOutput, releasedAt?, deprecated?}` 형태. Legacy / deprecated 는 제외."

### Step 3. models.dev cross-check

```bash
curl -s https://models.dev/api/models.json > /tmp/models_dev.json
node -e "const d = require('/tmp/models_dev.json'); console.log(Object.keys(d).filter(k => k.startsWith('openai/') || k.startsWith('anthropic/') || k.startsWith('google/')))"
```

공식 문서에 있는데 models.dev 에 없음 → 신규 (정상, models.dev 지연). models.dev 에 있는데 공식에 없음 → deprecated 후보 (WARNING 로그).

### Step 4. Diff 분류

| 분류 | 판정 | 액션 |
|---|---|---|
| **new** | 공식에 있음, bundled 에 없음 | `bundled_models.json.models` 에 추가 |
| **capability-changed** | 양쪽에 있지만 `contextWindow` / `maxOutput` 다름 | bundled 덮어쓰기 |
| **deprecated** | 공식에서 사라짐 + deprecation 날짜 확인 | bundled 유지하되 `_meta.deprecations` 에 기록 (chain 사용 중이면 운영자 경고) |
| **alias update** | provider 가 "sonnet" / "latest" 별칭 바꿈 | `FUZZY_MAP` 업데이트 |
| **flagship change** | provider 의 recommended default 바뀜 | `ENV_DEFAULT_MODEL` 업데이트 |
| **pricing change** | input/output per million 단가 변경 | `pricing` 필드 + `usage-tracking` workflow 참조 |

### Step 5. 업데이트 적용

1. `<api-app>/catalog/bundled_models.json` — `_meta.updated` 를 오늘로 갱신 + `models` 엔트리 병합
2. `<api-app>/src/ai/router.ts` 의 `FUZZY_MAP` — 별칭 행 수정
3. `<api-app>/src/ai/bootstrap.ts` 의 `ENV_DEFAULT_MODEL` — provider 별 canonical default 수정
4. 테스트 실행 — 반드시 통과 확인:
   ```bash
   pnpm exec vitest run <api-app>/tests/ai/router.test.ts <api-app>/tests/ai/modelResolution.test.ts <api-app>/tests/providers/fallbackE2e.test.ts
   ```
5. **Report 출력** — 아래 템플릿 참조

---

## sync-models 스크립트 (참고 구현)

```typescript
// <api-app>/scripts/sync-models.ts
import { readFile, writeFile } from 'node:fs/promises'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import pRetry from 'p-retry'

const RemoteModelSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  contextWindow: z.number().int().positive(),
  maxOutput: z.number().int().positive().optional(),
  releasedAt: z.string().optional(),
  deprecated: z.boolean().optional(),
})

const RemoteModelsResponseSchema = z.object({
  data: z.array(RemoteModelSchema),
})

async function fetchOpenRouterModels(apiKey: string): Promise<z.infer<typeof RemoteModelSchema>[]> {
  const response = await pRetry(
    async () => {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      })
      if (!r.ok) throw new Error(`openrouter_fetch_${r.status}`)
      return r
    },
    { retries: 3, minTimeout: 500 },
  )
  const json = await response.json()
  return RemoteModelsResponseSchema.parse(json).data
}

async function loadLocalCatalog(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf-8')
  return yamlParse(text)
}

function diffCatalogs(localText: string, remoteText: string, fileName: string): string {
  return createTwoFilesPatch(`${fileName} (local)`, `${fileName} (remote)`, localText, remoteText)
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (apiKey === undefined) throw new Error('OPENROUTER_API_KEY required')

  const apply = process.argv.includes('--apply')

  const remoteModels = await fetchOpenRouterModels(apiKey)
  const localCatalogPath = '<api-app>/catalog/models.yaml'
  const localCatalog = await loadLocalCatalog(localCatalogPath) as { models: unknown[] }

  const remoteText = yamlStringify({ models: remoteModels })
  const localText = await readFile(localCatalogPath, 'utf-8')
  const patch = diffCatalogs(localText, remoteText, 'models.yaml')

  if (patch.split('\n').length <= 4) {
    console.log('no changes')
    return
  }

  console.log(patch)

  if (apply) {
    await writeFile(localCatalogPath, remoteText, 'utf-8')
    console.log('applied — review with `git diff`')
  } else {
    console.log('(dry-run — pass --apply to write)')
  }
}

void main()
```

실행:

```bash
# Dry-run (diff 출력만)
pnpm tsx <api-app>/scripts/sync-models.ts

# 적용
pnpm tsx <api-app>/scripts/sync-models.ts --apply
git diff <api-app>/catalog/
```

---

## Report 템플릿

```
# provider-catalog-sync — 2026-MM-DD

## Discovered providers
- anthropic, openai, google, openrouter

## Diff summary
| Provider  | new                   | deprecated         | capability-changed |
|-----------|-----------------------|--------------------|--------------------|
| openai    | gpt-5.5               | —                  | gpt-5.4 (cw 200K→400K) |
| anthropic | claude-opus-4-7       | claude-opus-4-1    | —                  |
| google    | —                     | —                  | gemini-2.5-pro (maxOut 8192→16384) |
| openrouter| (전체 prefix 위임)    | —                  | —                  |

## Files updated
- <api-app>/catalog/bundled_models.json  (+3 models, _meta.updated=2026-MM-DD)
- <api-app>/src/ai/router.ts             (FUZZY_MAP: "sonnet" → claude-sonnet-4-7)
- <api-app>/src/ai/bootstrap.ts          (ENV_DEFAULT_MODEL: openai → gpt-5.5)

## Suggested operator actions (NOT applied)
- <api-app>/catalog/fallback-chains.yaml :: default — 1순위를 gpt-5.5 로 승격 검토
- deprecated 알림: claude-opus-4-1 을 chain 에서 참조하는 운영자 있으면 마이그 필요

## Pricing changes (usage-tracking 영향)
- anthropic: claude-sonnet-4-7 input 3.00 → 3.50 per M (요약 LLM 비용 +17%)

## Tests
- pnpm exec vitest run <api-app>/tests/ai/  →  42 passed
- pnpm exec vitest run <api-app>/tests/providers/  →  28 passed
```

---

## 영향도

| 변경 | 영향받는 곳 |
|---|---|
| `bundled_models.json.models` 엔트리 추가/변경 | capabilities 해석 (`provider-layer`), prompt cache 영향 없음 |
| `FUZZY_MAP` 별칭 변경 | 해당 별칭 사용한 모든 catalog chain + agent `modelPreference` |
| `ENV_DEFAULT_MODEL` 변경 | env-only bootstrap (catalog 없는 배포) 에서 default 변경 |
| `pricing` 단가 변경 | `usage-tracking` workflow 의 비용 계산 / 일일 한도 / Sentry alert 임계값 |
| `_meta.deprecations` 추가 | 운영자 알림 채널 (현재 = console.warn) |

## 금지 사항

- `<api-app>/catalog/fallback-chains.yaml` 을 본 skill 이 직접 수정 (chain 순서 = 운영자 결정)
- 공식 문서 1개 소스만으로 업데이트 결정 (반드시 cross-check)
- deprecated 모델을 bundled 에서 즉시 삭제 (마이그 기간 `_meta.deprecations` 에 기록 후 다음 sync 에서 제거)
- 테스트 실패 상태로 커밋 시도
- `PROVIDER_SOURCES` 표 업데이트 없이 새 provider 의 카탈로그를 수동 갱신 (추적성 저하)
- live API listing 을 주 소스로 사용 (rate limit + 계정별 편차 — cross-check 용도에만)
- 일부 runtime (edge / isolation 기반) 에서 sync 실행 (Node 스크립트 전용 — 큰 fetch / 파일 시스템 쓰기)
- API key 를 sync 스크립트에 하드코딩 (`process.env.<PROVIDER>_API_KEY` 만)

## 검증 체크리스트

- [ ] `PROVIDER_SOURCES` 표의 모든 행 fetch 시도
- [ ] cross-check 실패 시 (models.dev 502 등) 단일 소스 명시
- [ ] `_meta.updated` 가 today 로 갱신됨 (diff 비어있어도)
- [ ] `pnpm exec vitest run` 관련 테스트 통과
- [ ] Report 템플릿의 모든 섹션 채움
- [ ] Suggested operator actions 는 **제안** 으로만 (직접 적용 ✕)
- [ ] pricing 변경 시 `usage-tracking` workflow 측에 영향 보고

## 구현 중 막히면

- WebFetch 응답이 HTML — Claude Code WebFetch tool 사용, raw curl 은 JS 렌더링 부족
- `yaml` (npm) 파싱 에러 → `js-yaml` 대체 시도 또는 yaml 4-space indent 강제
- diff 가 너무 큼 (전체 reformat) → `yaml.stringify` 옵션 통일 (`sortMapEntries: true`)
- OpenRouter rate limit → API key + `p-retry` minTimeout 500ms
- `bundled_models.json` 수동 편집 충돌 → sync 전 항상 `git stash`

## Cross-ref

- `provider-scaffold` (본 skill 호출 직전 — 새 provider 클래스 추가)
- `provider-layer` (Provider interface / model resolution — 카탈로그 변경 시 영향)
- `provider-retry-matrix` (PROVIDER_REGISTRY / FUZZY_MAP / ENV_DEFAULT_MODEL 정본)
- `usage-tracking` (pricing 변경 시 비용 계산 / 일일 한도 영향)
- runtime 호환성 (instance 측 project-local skill — sync 스크립트는 Node, 런타임은 instance-specific)
