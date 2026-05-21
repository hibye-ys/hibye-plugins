---
name: d1-forbidden-audit
description: 배포 전 또는 wrangler.toml / 데이터 코드 변경 후 invoke. spec §1.2 절대 금지 — Cloudflare D1 사용 검출. d1_databases bindings + D1Database import + c.env prepare 3가지 grep.
metadata:
  role: audit
  scope: apps/api
  source: (신규 — spec §1.2 enforce)
---

# d1-forbidden-audit — spec §1.2 Cloudflare D1 금지 enforce

## 검증 대상 invariant

**spec §1.2 — Cloudflare D1 절대 금지** ($5,000/10초 청구 사고 이후 영구 결정)

D1 은 다음 3가지 방식으로 코드에 침투할 수 있다:
1. `wrangler.toml` / `wrangler.jsonc` 에 `[[d1_databases]]` binding 선언
2. TS 코드에서 `D1Database` 타입 import
3. D1 API 패턴 `c.env.<NAME>.prepare(...)` 사용

이 audit 은 3가지 패턴을 모두 검출한다.

> **Durable Objects 금지** 도 spec §1.2. DO 관련 검출은 `single-writer-audit` 참조.

---

## 실행

```bash
# 패턴 1: wrangler.toml / wrangler.jsonc 안 d1_databases binding
grep -rE 'd1_databases|D1Database|D1_BINDING' \
  apps/api/wrangler.toml apps/api/wrangler.jsonc 2>/dev/null

# 패턴 2: TS 코드에서 D1Database import
grep -rE '\bD1Database\b' apps/api/src/

# 패턴 3: c.env.<NAME>.prepare (D1 API)
grep -rE 'c\.env\.\w+\.prepare\(' apps/api/src/
```

---

## 통과 기준

- 패턴 1, 2, 3 모두 match **0건**
- 매치 **1건 이상** = 즉시 **deploy 차단**

---

## 위반 시 조치

### 패턴 1 위반 — wrangler.toml `[[d1_databases]]` binding 발견

```toml
# 위반 예시 — 즉시 제거
[[d1_databases]]
binding = "DB"
database_name = "..."
database_id = "..."
```

조치:
- `[[d1_databases]]` 섹션 전체 제거
- Neon Postgres 로 마이그레이션: `[vars]` 에 `DATABASE_URL = "postgresql+..."` (실제값은 Cloudflare Secret)
- R2 blob 저장이 필요하면: `[[r2_buckets]]` 추가

### 패턴 2 위반 — `D1Database` import 발견

```typescript
// 위반 예시
import type { D1Database } from '@cloudflare/workers-types'
```

조치:
- `D1Database` → `NeonDatabase` (`@neondatabase/serverless`) 또는 Drizzle ORM 타입으로 교체
- Hono Env Bindings 에서 D1 타입 제거, `DATABASE_URL: string` 으로 교체

### 패턴 3 위반 — `.prepare()` D1 API 발견

```typescript
// 위반 예시
const stmt = c.env.DB.prepare('SELECT ...')
const result = await stmt.bind(userId).first()
```

조치:
- `@neondatabase/serverless` + Drizzle ORM API 로 교체:
  ```typescript
  import { neon } from '@neondatabase/serverless'
  const sql = neon(c.env.DATABASE_URL)
  const result = await sql`SELECT ... WHERE user_id = ${userId}`
  ```
- 또는 Drizzle query builder:
  ```typescript
  const result = await db.select().from(users).where(eq(users.id, userId))
  ```

---

## Workers 호환 DB 대안 (D1 대체)

| 대안 | 적합한 용도 | binding |
|------|------------|---------|
| **Neon Postgres** (권장) | durable 상태, ACID, 복잡한 쿼리 | `DATABASE_URL: string` |
| **Upstash Redis** | 캐시, rate limit, 단기 카운터 | `CACHE: KVNamespace` or REST |
| **R2** | blob 파일, 대용량 바이너리 | `STORAGE: R2Bucket` |
| **Cloudflare KV** | 단기 캐시, eventual consistency OK | `CACHE: KVNamespace` |
| Turso | 소규모 SQLite-as-a-service | HTTP API |
| PlanetScale | MySQL 호환 serverless | HTTP API |

---

## audit 이 커버하지 않는 것

- Durable Objects (DO) — `single-writer-audit` 가 담당
- Cloudflare Pages — 프레임워크 선택 audit 별도
- `process.env.D1_*` 환경변수 — 이 audit 은 Workers binding 에 집중

---

## 자동화 통합 예시

```bash
#!/usr/bin/env bash
# scripts/d1-audit.sh — CI pipeline 또는 pre-deploy hook 에 추가

set -euo pipefail

FAIL=0

echo "=== D1 Forbidden Audit ==="

# 패턴 1: wrangler 설정 파일
if grep -rE 'd1_databases|D1Database|D1_BINDING' \
    apps/api/wrangler.toml apps/api/wrangler.jsonc 2>/dev/null; then
  echo "FAIL: D1 binding found in wrangler config"
  FAIL=1
fi

# 패턴 2: TS 코드 D1Database import
if grep -rE '\bD1Database\b' apps/api/src/; then
  echo "FAIL: D1Database import found in source"
  FAIL=1
fi

# 패턴 3: D1 prepare API
if grep -rE 'c\.env\.\w+\.prepare\(' apps/api/src/; then
  echo "FAIL: D1 prepare() API found in source"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "PASS: No D1 usage detected"
else
  echo "BLOCKED: Deploy cancelled — D1 usage detected (spec §1.2)"
  exit 1
fi
```

---

*§4.4 매트릭스 적용: N/A (audit 자체 정의 — 어휘 치환 대상 없음)*
