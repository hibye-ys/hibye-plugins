# CI 통합 템플릿

## GitHub Actions

```yaml
# .github/workflows/audit.yml
name: stack-backend-ts audit

on:
  pull_request:
    paths:
      - '<api-app>/**'
      - '.claude/skills/**'

jobs:
  audit:
    runs-on: ubuntu-latest
    env:
      # instance 측에서 값 결정 — placeholder 어휘를 forbidden-scan / audit 에 주입
      DOMAIN_VOCAB: "writer|author|scenario|novel|character|persona"
      API_APP_PATH: "apps/api"
      # framework-specific audit pattern (default = Hono + Workers).
      # instance 가 다른 framework 면 override:
      #   - Express 예: REQUEST_BODY_PATTERN='req\.(body|params|query)'
      #                 ROUTE_HANDLER_PATTERN='(app|router)\.(get|post|put|patch|delete)'
      #                 ROUTE_MUTATION_PATTERN='(app|router)\.(post|put|patch)'
      #                 KV_BINDING_PATTERN='process\.env\.[A-Z_]+'
      #                 ZOD_VALIDATOR_PATTERN='checkSchema|validateRequest'
      REQUEST_BODY_PATTERN: 'c\.req\.(json|valid|parseBody)'
      ROUTE_HANDLER_PATTERN: 'app\.(get|post|put|patch|delete)'
      ROUTE_MUTATION_PATTERN: 'app\.(post|put|patch)'
      KV_BINDING_PATTERN: 'c\.env\.[A-Z_]+'
      ZOD_VALIDATOR_PATTERN: 'zValidator'
    steps:
      - uses: actions/checkout@v4
      - name: acceptance-check
        run: bash .claude/plugins/stack-backend-ts/scripts/acceptance-check.sh
      - name: forbidden-scan
        run: bash .claude/plugins/stack-backend-ts/scripts/forbidden-scan.sh
      - name: audit-all (strict)
        # --strict: SKIP 도 fail 처리. instance src 가 마운트된 CI 에서 사용 — 디렉토리/envvar 누락으로
        # 모든 audit 이 SKIP 되어 "Total violations: 0" 가짜 안전을 내는 상황 차단.
        run: bash .claude/plugins/stack-backend-ts/scripts/audit-all.sh --strict "$API_APP_PATH"
```

## DOMAIN_VOCAB 형식

`|` 구분 정규식. 도메인 어휘를 enumeration 형식으로 나열:

```bash
export DOMAIN_VOCAB="entity1|entity2|entity3"
```

`app-domain-boundary` audit 가 본 env 를 읽어서 `<api-app>/src/` 트리에서 위 어휘 등장 시 violation 보고.
