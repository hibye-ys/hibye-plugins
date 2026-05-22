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
    steps:
      - uses: actions/checkout@v4
      - name: acceptance-check
        run: bash .claude/plugins/stack-backend-ts/scripts/acceptance-check.sh
      - name: forbidden-scan
        run: bash .claude/plugins/stack-backend-ts/scripts/forbidden-scan.sh
      - name: audit-all
        run: bash .claude/plugins/stack-backend-ts/scripts/audit-all.sh "$API_APP_PATH"
```

## DOMAIN_VOCAB 형식

`|` 구분 정규식. 도메인 어휘를 enumeration 형식으로 나열:

```bash
export DOMAIN_VOCAB="entity1|entity2|entity3"
```

`app-domain-boundary` audit 가 본 env 를 읽어서 `<api-app>/src/` 트리에서 위 어휘 등장 시 violation 보고.
