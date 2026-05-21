---
name: pre-deploy-check
description: apps/api 를 Cloudflare Workers 에 배포하기 전 invoke. type check + biome lint + audit 13 일괄 + Vitest smoke + wrangler whoami + dry-run 의 6단계 체인 가이드.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/skills/pre-deploy-check
---

# pre-deploy-check workflow

## 배포 전 6 단계 체인

```bash
# 1. type check
cd apps/api && pnpm tsc --noEmit

# 2. lint (biome)
pnpm biome check src/

# 3. audit 13 일괄 실행 (Task 8.2 산출)
bash scripts/audit-all.sh

# 4. Vitest smoke test (--bail=1)
pnpm vitest run --reporter=verbose

# 5. wrangler whoami (인증 확인)
pnpm wrangler whoami

# 6. wrangler deploy --dry-run (실 배포 전 검증)
pnpm wrangler deploy --dry-run
```

## 통과 기준 — 6 단계 모두 exit 0

- 한 단계 실패 = 배포 차단
- audit 13 중 1+ 위반 = 배포 차단
- 운영 시 GitHub Actions workflow 로 자동화

## 참조

- audit 12 = [04-audits.md](04-audits.md) 의 12 audit
- d1-forbidden-audit (Task 6.4) = audit 13 — D1 binding 검출
- wrangler docs: <https://developers.cloudflare.com/workers/wrangler/commands/>

## 적용된 §4.4 매트릭스 행

**적용된 §4.4 매트릭스 행**: 환경변수 (os.getenv → c.env), 프로세스 분리 (subprocess → wrangler CLI 호출), pytest → Vitest
