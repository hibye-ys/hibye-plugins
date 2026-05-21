---
name: infra-audit
description: wrangler.toml 변경 후 또는 배포 전 invoke. 필수 키 (name / main / compatibility_date) + 필수 binding (DATABASE_URL / OPENROUTER_API_KEY) + production / preview env 분리를 grep 으로 검증.
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/infra-audit
---

# infra-audit — Workers infra 설정 audit

## 검증 대상 invariant

`apps/api/wrangler.toml` (또는 `wrangler.jsonc`) 의 3가지 정합성:

1. **필수 top-level 키** — `name` / `main` / `compatibility_date` (Workers 배포 최소 조건)
2. **필수 binding** — `DATABASE_URL` (Neon connection string) / `OPENROUTER_API_KEY` (모델 게이트웨이)
3. **환경 분리** — `[env.preview]` 섹션 존재 (production vs preview 동일 secret 사용 ✕)

## 실행

```bash
WRANGLER="apps/api/wrangler.toml"
[[ -f "$WRANGLER" ]] || WRANGLER="apps/api/wrangler.jsonc"
[[ -f "$WRANGLER" ]] || { echo "missing wrangler config"; exit 1; }

# 패턴 1: 필수 top-level 키
for key in name main compatibility_date; do
  grep -qE "^\s*\"?${key}\"?\s*[:=]" "$WRANGLER" || echo "missing $key"
done

# 패턴 2: 필수 binding (vars 섹션 또는 secret 등록 키)
for binding in DATABASE_URL OPENROUTER_API_KEY; do
  grep -q "$binding" "$WRANGLER" || echo "missing $binding binding"
done

# 패턴 3: production / preview 분리
grep -qE "\[env\.preview\]|\"preview\"\s*:" "$WRANGLER" || echo "missing preview env"
```

## 통과 기준

- 위 세 패턴 모두 출력 **0줄**

## 위반 시 조치

### 패턴 1 위반 — 필수 키 누락

```toml
# apps/api/wrangler.toml
name = "apps-api"
main = "src/index.ts"
compatibility_date = "2025-09-15"
compatibility_flags = ["nodejs_compat"]
```

### 패턴 2 위반 — binding 누락

```toml
[vars]
# secret 은 `wrangler secret put DATABASE_URL` 로 별도 등록 — 여기엔 placeholder 만
DATABASE_URL = "set-via-wrangler-secret"
OPENROUTER_API_KEY = "set-via-wrangler-secret"
```

실제 secret 은:
```bash
wrangler secret put DATABASE_URL
wrangler secret put OPENROUTER_API_KEY
```

### 패턴 3 위반 — preview env 누락

```toml
[env.preview]
name = "apps-api-preview"
vars = { ENVIRONMENT = "preview" }

[env.production]
name = "apps-api"
vars = { ENVIRONMENT = "production" }
```

preview 배포 시 production secret 이 노출되지 않도록 `wrangler secret put DATABASE_URL --env preview` 로 별도 등록.

---

## audit 이 커버하지 않는 것

- D1 binding 검출 → `d1-forbidden-audit`
- Workers 호환성 (Node-only API) → `dependency-scanning`
- secret 값 자체 (placeholder 가 실제 값이면 위험) → `security-audit-check`
