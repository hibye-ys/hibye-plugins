---
name: dependency-scanning
description: 의존성 lockfile 변경 후 또는 배포 전 invoke. npm/pnpm audit CVE + Workers-incompat (Node built-in 직접 import) 두 가지를 검출. verify-workers-compat invariant 와 짝.
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/dependency-scanning
---

# dependency-scanning — 의존성 안전성 + Workers 호환성 audit

## 검증 대상 invariant

`apps/api/` 의 2가지 의존성 위험:

1. **CVE** — `pnpm audit --audit-level=high` 가 high/critical 취약점 0개
2. **Workers 비호환 import** — Node built-in (`fs` / `net` / `tls` / `child_process` 등) 을 `node:` prefix 또는 명시적 호환성 주석 없이 import

> Workers runtime 은 nodejs_compat flag 가 있어도 일부 Node API 만 polyfill. `node:` prefix 사용 + `compatibility_flags = ["nodejs_compat"]` 조합으로 한정해야 안전.

## 실행

```bash
# 패턴 1: npm/pnpm audit
cd apps/api && pnpm audit --audit-level=high 2>&1 | tail -20

# 패턴 2: Node built-in 직접 import (node: prefix 누락)
rg -nP "from\s+['\"](?:fs|net|tls|child_process|cluster|dgram|dns|http|https|os|path|stream|tty|vm)['\"]" \
  apps/api/src/ 2>/dev/null \
  | grep -v "node:" \
  | grep -v "// workers-compat-ok"
```

## 통과 기준

- 패턴 1: `pnpm audit` exit code = 0 (high/critical 0)
- 패턴 2: 출력 **0줄** (모든 Node 모듈 import 가 `node:` prefix 또는 명시적 ok 주석)

## 위반 시 조치

### 패턴 1 위반 — CVE

```bash
# 해결책 우선순위
pnpm update <package>           # patch 가능하면 minor/patch bump
pnpm audit --fix                # 자동 해결 시도
# 또는 package.json 의 overrides 로 transitive 강제
```

수동 검토:
- vulnerable 패키지가 runtime 인지 devDependency 인지 (devDeps 면 위험도 낮음)
- 다음 release ETA — 정해진 일정 안에 무력화 못 하면 mitigation (입력 제한 / 우회) 도 검토

### 패턴 2 위반 — Workers 비호환 import

```typescript
// 위반
import { readFile } from 'fs/promises'  // ← Workers 환경에선 안 돌아감

// 조치 1: node: prefix + compatibility_flags
import { readFile } from 'node:fs/promises'  // wrangler.toml: nodejs_compat 필수

// 조치 2: Workers 친화 API 로 교체
// fs → R2 / KV / Cache
// child_process → 없음 (별도 service worker 분리)

// 조치 3: 정말 어쩔 수 없으면 명시적 주석
import { something } from 'os'  // workers-compat-ok: build-time only, never reached at runtime
```

---

## audit 이 커버하지 않는 것

- 패키지 license 검증 → 별도 license audit
- bundle size 폭증 → `pre-deploy-check` 의 wrangler dry-run 단계
- runtime 동작 (의존성이 실제 동작하는가) → `runtime-verify`
