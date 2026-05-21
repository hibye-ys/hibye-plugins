---
name: provider-catalog-sync
description: Refresh provider model catalog across `bundled_models.json`, `_FUZZY_MAP`, and `_ENV_DEFAULT_MODEL`. Provider-agnostic — the PROVIDER_SOURCES table below is the single extension point when new providers join the registry. Load when model catalog drift is suspected (release notes show newer IDs than `bundled_models.json._meta.updated`, or when adding a new provider).
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch
---

# provider-catalog-sync — 프로바이더 모델 카탈로그 동기화

## 언제 로드하나

- 주요 provider 릴리스 (new flagship, deprecation 공지) 직후
- `bundled_models.json._meta.updated` 가 3개월 이상 된 경우
- 새 provider 가 `PROVIDER_REGISTRY` 에 추가된 직후 (그 provider 의 공식 소스를 아래 표에 등록)
- 사용자가 "모델 목록 업데이트", "최신 모델 반영" 요청 시

## 언제 로드하지 않나

- 단발 모델 capability 조회 → `provider-layer` skill
- fallback chain 순서 조정 → `config/providers.yaml` 직접 편집 (런타임 hot reload 없음, 재시작 필요)
- 새 provider **클래스** 추가 → `provider-scaffold` skill (이 skill 은 그 이후에 실행)

## 원칙

- **Provider-agnostic**: 아래 `PROVIDER_SOURCES` 표가 유일한 provider별 지식. 새 provider 추가 = 표에 행 하나 추가
- **3 소스 교차검증**: 공식 문서 (WebFetch) + models.dev API + live API listing (선택). 한 소스만 믿지 않음
- **Config 는 운영자 결정**: `config/providers.yaml` 의 chain 변경은 **제안만** 출력. 이 skill 이 직접 쓰지 않음
- **Fail-safe**: diff 결과가 비어 있어도 `_meta.updated` 는 갱신 (sync 이력 보존)

---

## PROVIDER_SOURCES (확장 지점)

새 provider 가 `backend/providers/base.py:PROVIDER_REGISTRY` 에 추가되면 아래 표에 행 하나만 추가하면 된다. Discovery 단계는 이 표를 iteration 한다.

| provider type | 공식 문서 URL (WebFetch — primary) | models.dev prefix (fallback, **현재 API 엔드포인트 불안정**) | live listing API |
|---|---|---|---|
| `anthropic` | `https://docs.anthropic.com/en/docs/about-claude/models/overview` | `anthropic/` | `anthropic.models.list()` |
| `openai` | `https://platform.openai.com/docs/models` | `openai/` | `openai.models.list()` |
| `google` | `https://ai.google.dev/gemini-api/docs/models/gemini` | `google/` | `google.generativeai.list_models()` |
| `openrouter` | `https://openrouter.ai/models` | (모든 prefix) | `GET /api/v1/models` |
| `openai_compatible` | — (self-hosted, 운영자 문서) | 없음 | 엔드포인트별 `/v1/models` |

**확장 예**: xAI Grok provider 가 추가되면 `grok / https://docs.x.ai/api/models / xai/ / xai.models.list()` 행 추가.

### ⚠ models.dev API 주의 (2026-04-18 검증)

`https://models.dev/api/models.json` 은 **302 → HTML landing page** 로 재지향되어 JSON 을 반환하지 않는 것이 관찰됨. 2026-04-18 sync 실패 원인이었음. 다음 sync 시 재확인 순서:
1. `curl -sI https://models.dev/api/models.json` 으로 리다이렉트 여부 확인
2. 실패 시 대체 경로 탐색: `/data/models.json`, `api.models.dev/v1/models`, 프로젝트 GitHub repo (보통 `models.dev` 는 공개 JSON 을 repo 에 둠)
3. 모두 실패면 **공식 문서 (WebFetch) 만으로 진행** 하되 sync 보고서에 단일 소스 사실 명시 → 다음 sync 주기에 재검증

---

## Sync Process (5-step)

### Step 1. 현재 상태 스냅샷

```bash
# 등록된 provider type 확인 (표 iteration 기준)
rg '"(\w+)":\s*\w+Provider' backend/providers/base.py
# bundled snapshot 메타 확인
python3 -c "import json; d=json.load(open('backend/providers/bundled_models.json')); print(d['_meta']); print(sorted(d['models'].keys()))"
# Router 별칭 + env default
rg '_FUZZY_MAP|_ENV_DEFAULT_MODEL' backend/providers/router.py backend/providers/bootstrap.py
```

### Step 2. 각 provider 공식 문서 fetch

등록된 provider type 각각에 대해 `PROVIDER_SOURCES` 표의 공식 URL 을 `WebFetch` 로 조회. 프롬프트:

> "이 페이지에서 현재 'active' 또는 'GA' 또는 'recommended' 로 표기된 모델 ID 전체 리스트를 JSON 배열로 추출해줘. 각 항목은 `{id, display_name, context_window, max_output, released_at?, deprecated?}` 형태. Legacy/deprecated 는 제외."

### Step 3. models.dev cross-check

```bash
curl -s https://models.dev/api/models.json > /tmp/models_dev.json
python3 -c "import json; d=json.load(open('/tmp/models_dev.json')); [print(k) for k in d if k.startswith('openai/') or k.startswith('anthropic/') or k.startswith('google/')]"
```

공식 문서에 있는데 models.dev 에 없음 → 신규 (정상, models.dev 지연). models.dev 에 있는데 공식에 없음 → deprecated 후보 (WARNING 로그).

### Step 4. Diff 분류

| 분류 | 판정 | 액션 |
|---|---|---|
| **new** | 공식에 있음, bundled 에 없음 | `bundled_models.json.models` 에 추가 |
| **capability-changed** | 양쪽에 있지만 context_window / max_output 다름 | bundled 덮어쓰기 |
| **deprecated** | 공식에서 사라짐 + deprecation 날짜 확인 | bundled 유지하되 `_meta.deprecations` 에 기록 (chain 사용 중이면 운영자 경고) |
| **alias update** | provider 가 "sonnet" / "latest" 별칭 바꿈 | `router.py:_FUZZY_MAP` 업데이트 |
| **flagship change** | provider 의 recommended default 바뀜 | `bootstrap.py:_ENV_DEFAULT_MODEL` 업데이트 |

### Step 5. 업데이트 적용

1. `backend/providers/bundled_models.json` — `_meta.updated` 를 오늘로 갱신 + `models` 엔트리 병합
2. `backend/providers/router.py:_FUZZY_MAP` — 별칭 행 수정
3. `backend/providers/bootstrap.py:_ENV_DEFAULT_MODEL` — provider 별 canonical default 수정
4. 테스트 실행 — 반드시 통과 확인:
   ```bash
   pytest backend/tests/test_providers_router.py backend/tests/test_model_resolution.py backend/tests/test_provider_fallback_e2e.py -q
   ```
5. **Report 출력** — 아래 템플릿 참조

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
| google    | —                     | —                  | gemini-2.5-pro (max_out 8192→16384) |
| openrouter| (전체 prefix 위임)    | —                  | —                  |

## Files updated
- backend/providers/bundled_models.json  (+3 models, _meta.updated=2026-MM-DD)
- backend/providers/router.py            (_FUZZY_MAP: "sonnet" → claude-sonnet-4-7)
- backend/providers/bootstrap.py         (_ENV_DEFAULT_MODEL: openai → gpt-5.5)

## Suggested operator actions (NOT applied)
- config/providers.yaml :: fallback_chains.default — 1순위를 gpt-5.5 로 승격 검토
- deprecated 알림: claude-opus-4-1 을 chain 에서 참조하는 운영자 있으면 마이그 필요

## Tests
- pytest backend/tests/test_providers_*.py  →  42 passed
```

---

## 영향도

| 변경 | 영향받는 곳 |
|---|---|
| `bundled_models.json.models` 엔트리 추가/변경 | capabilities 5단계 해석 4순위 (models.dev fail 시 fallback), prompt cache 영향 없음 |
| `_FUZZY_MAP` 별칭 변경 | 해당 별칭 사용한 모든 YAML chain + agent `model_preference` |
| `_ENV_DEFAULT_MODEL` 변경 | env-only bootstrap (config/providers.yaml 없는 배포) 에서 default 변경 |
| `_meta.deprecations` 추가 | 운영자 알림 채널 (아직 미구현 — 로그 WARNING 만) |

## 금지 사항

- `config/providers.yaml` 을 이 skill 이 직접 수정 (chain 순서 = 운영자 결정)
- 공식 문서 1개 소스만으로 업데이트 결정 (반드시 cross-check)
- deprecated 모델을 bundled 에서 즉시 삭제 (마이그 기간 `_meta.deprecations` 에 기록 후 다음 sync 에서 제거)
- 테스트 실패 상태로 커밋 시도
- `PROVIDER_SOURCES` 표 업데이트 없이 새 provider 의 카탈로그를 수동 갱신 (추적성 저하)
- live API listing 을 주 소스로 사용 (rate limit + 계정별 편차 — cross-check 용도에만)
