---
name: dependency-scanning
description: 의존성 lockfile 변경 후 또는 배포 전 invoke. npm/pnpm audit 으로 high/critical CVE 를 검출.
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/dependency-scanning
---

# dependency-scanning — 의존성 안전성 audit (CVE)

## 검증 대상 invariant

`apps/api/` 의 의존성 CVE 위험:

- **CVE** — `pnpm audit --audit-level=high` 가 high/critical 취약점 0개

## 실행

```bash
# npm/pnpm audit
cd apps/api && pnpm audit --audit-level=high 2>&1 | tail -20
```

## 통과 기준

- `pnpm audit` exit code = 0 (high/critical 0)

## 위반 시 조치

### CVE 위반

```bash
# 해결책 우선순위
pnpm update <package>           # patch 가능하면 minor/patch bump
pnpm audit --fix                # 자동 해결 시도
# 또는 package.json 의 overrides 로 transitive 강제
```

수동 검토:
- vulnerable 패키지가 runtime 인지 devDependency 인지 (devDeps 면 위험도 낮음)
- 다음 release ETA — 정해진 일정 안에 무력화 못 하면 mitigation (입력 제한 / 우회) 도 검토

---

## audit 이 커버하지 않는 것

- 패키지 license 검증 → 별도 license audit
- bundle size 폭증 → `pre-deploy-check` 의 wrangler dry-run 단계
- runtime 동작 (의존성이 실제 동작하는가) → `runtime-verify`
