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
      # framework-specific audit pattern — framework-neutral 의무 (default 없음).
      # 본 plugin (stack-backend-ts) 은 framework-neutral 이므로 framework / runtime 특화
      # 패턴을 default 로 두지 않는다. instance 측에서 다음 3 가지 방법 중 하나로 주입:
      #
      # 방법 1) STACK_BACKEND_TS_PRESET — 본 plugin 의 preset 파일 자동 로드
      #   STACK_BACKEND_TS_PRESET: hono-workers
      #
      # 방법 2) Preset 파일 source — 명시적 source (CI step 안에서)
      #   - run: |
      #       source .claude/plugins/stack-backend-ts/scripts/presets/hono-workers.env
      #       bash .claude/plugins/stack-backend-ts/scripts/audit-all.sh apps/api
      #
      # 방법 3) Env block 에 직접 명시 (Hono + Workers 예시):
      #   REQUEST_BODY_PATTERN: 'c\.req\.(json|valid|parseBody)'
      #   ROUTE_MUTATION_PATTERN: 'app\.(post|put|patch)'
      #   KV_BINDING_PATTERN: 'c\.env\.[A-Z_]+'
      #   ZOD_VALIDATOR_PATTERN: 'zValidator'
      #   KV_STORE_PATTERN: '(KV|kv)'
      #   TTL_FIELD_PATTERN: 'expirationTtl'
      #   AUTH_MIDDLEWARE_NAME: 'authMiddleware'
      #
      # Express + Redis 같은 다른 stack 예시:
      #   REQUEST_BODY_PATTERN: 'req\.(body|params|query)'
      #   ROUTE_MUTATION_PATTERN: '(app|router)\.(post|put|patch)'
      #   ZOD_VALIDATOR_PATTERN: '(validateRequest|checkSchema)'
      #   KV_BINDING_PATTERN: 'process\.env\.[A-Z_]+'
      #   KV_STORE_PATTERN: 'redis'
      #   TTL_FIELD_PATTERN: '(EX|PX|ttl)'
      #   AUTH_MIDDLEWARE_NAME: 'requireAuth'
      #
      # 본 예시는 방법 1 (STACK_BACKEND_TS_PRESET 자동 로드) 사용:
      STACK_BACKEND_TS_PRESET: hono-workers

      # audit-all strict 정책 — Round 3 분리 (--strict deprecated):
      #   - REQUIRE_MOUNT=1: API_DIR/src 부재 시 fail (instance src 마운트 강제)
      #   - STRICT_AUDITS=1 + EXPECTED_AUDITS: 명시한 audit 중 SKIP 된 것 있으면 fail.
      #     EXPECTED_AUDITS 가 비어 있으면 strict-audits 는 no-op.
      EXPECTED_AUDITS: "data-audit loop-audit api-audit session-audit single-writer input-safety"
    steps:
      - uses: actions/checkout@v4

      - name: acceptance-check
        run: bash .claude/plugins/stack-backend-ts/scripts/acceptance-check.sh

      - name: forbidden-scan (skills default)
        run: bash .claude/plugins/stack-backend-ts/scripts/forbidden-scan.sh

      # 선택: 문서/스크립트까지 스캔 — leak 검출 (실패 허용 권장 — 매핑 표 예시는 의도된 매치)
      # - name: forbidden-scan (all-plugin)
      #   continue-on-error: true
      #   run: bash .claude/plugins/stack-backend-ts/scripts/forbidden-scan.sh --profile=all-plugin

      - name: audit-all (mount + strict-audits)
        # instance src 마운트 강제 + 명시한 audit 목록의 SKIP 차단
        run: |
          bash .claude/plugins/stack-backend-ts/scripts/audit-all.sh \
            --require-mount \
            --strict-audits \
            "$API_APP_PATH"
```

## DOMAIN_VOCAB 형식

`|` 구분 정규식. 도메인 어휘를 enumeration 형식으로 나열:

```bash
export DOMAIN_VOCAB="entity1|entity2|entity3"
```

`app-domain-boundary` audit 가 본 env 를 읽어서 `<api-app>/src/` 트리에서 위 어휘 등장 시 violation 보고.

## audit-all 옵션 매트릭스 (Round 3)

| Flag | env | 효과 |
|------|-----|------|
| `--require-mount` | `REQUIRE_MOUNT=1` | `API_DIR/src` 부재 시 exit 1. instance src 마운트 강제 |
| `--strict-audits` | `STRICT_AUDITS=1` | `EXPECTED_AUDITS` 중 SKIP 된 audit 있으면 exit 1 |
| `EXPECTED_AUDITS` | env only | space-separated audit 이름 (예: `"data-audit loop-audit"`). 강제할 audit 목록 |
| `--strict` (deprecated) | 없음 — env var 형태는 미지원 | `--require-mount` + `--strict-audits` 동시 활성화. 새 코드는 두 flag 직접 사용 권장 |

EXPECTED_AUDITS 가 비어 있고 `--strict-audits` 만 있으면 informational warning (no-op). instance 측에서 강제 audit 명시 권장.

### 사용 예시

```bash
# (1) instance src 마운트 강제 + 4개 핵심 audit 통과 강제
EXPECTED_AUDITS="data-audit loop-audit api-audit session-audit" \
  bash scripts/audit-all.sh --require-mount --strict-audits apps/api

# (2) 마운트 확인만 (audit SKIP 허용 — optional subsystem 부재 OK)
bash scripts/audit-all.sh --require-mount apps/api

# (3) audit 결과만 보기 (gate 없음 — local dev)
bash scripts/audit-all.sh apps/api
```

## forbidden-scan 옵션 매트릭스 (Round 3)

| Flag | env | 효과 |
|------|-----|------|
| `--profile=skills` (default) | `PROFILE=skills` | `plugins/stack-backend-ts/skills/` 만 스캔 |
| `--profile=all-plugin` | `PROFILE=all-plugin` | plugin root 전체 스캔. **`scripts/**` 는 self-match 방지 위해 항상 제외** (forbidden-terms.txt 자기 정의 + audit 스크립트 본문의 grep 패턴 string 이 자기 forbidden 패턴에 매치되는 false-positive 차단). docs / 기타 root 파일에 leak 검출 가능 |
| `--profile=docs` | `PROFILE=docs` | `plugins/stack-backend-ts/docs/` 만 |
| `[target-dir]` (positional) | — | 명시 시 `--profile` 무시. scripts/ 자체를 스캔하려면 `bash scripts/forbidden-scan.sh plugins/stack-backend-ts/scripts/` 처럼 명시 (단 self-match warning 많이 나옴 — forbidden-terms.txt + audit 본문의 grep 패턴이 모두 hit) |

### 사용 예시

```bash
# 기본 — skills/ 만
bash scripts/forbidden-scan.sh

# docs/ 에 framework / runtime 어휘 leak 검출
bash scripts/forbidden-scan.sh --profile=docs

# plugin 전체
bash scripts/forbidden-scan.sh --profile=all-plugin
```

> `all-plugin` / `docs` profile 은 placeholder-vocabulary.md / instance-claude-md-template.md 의 *예시 매핑* 도 hit 함 (의도된 forbidden 어휘 — 매핑 예시이므로). CI 에서는 `continue-on-error: true` 또는 별도 exclude 권장.
>
> **참고**: `all-plugin` profile 은 `scripts/**` 를 항상 제외한다 (forbidden-scan.sh:116-118 의 self-exclude — forbidden-terms.txt 정의 + audit 스크립트 grep 패턴의 self-match 방지). 따라서 `all-plugin` 으로는 scripts/ 안 leak 을 검출하지 못한다. scripts/ 검증이 필요하면 positional arg 로 별도 호출 (`bash scripts/forbidden-scan.sh plugins/stack-backend-ts/scripts/`) — 단 self-match warning 가 많이 나오므로 별도 exclude 또는 수동 review 권장.
