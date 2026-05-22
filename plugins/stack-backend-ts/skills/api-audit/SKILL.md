---
name: api-audit
description: 새 Hono route 추가 후 또는 배포 전 invoke. POST/PUT/PATCH 핸들러가 zValidator 미들웨어 없음 / 보호 path 가 authMiddleware 없음 / handler 응답 명시 부재를 grep 으로 검증. input-safety-gate-ordering + auth 가 함께 동작하는지 정합성 체크.
metadata:
  role: audit
  scope: project
  source: stack-backend-python/skills/api-audit
---

# api-audit — Hono route thin-layer audit

## 검증 대상 invariant

Hono route 는 *thin layer* — 입력 검증 + 인증 + 핸들러 호출만. 위반 시 보안·계약 안정성 동시 손상.

1. **mutation (POST/PUT/PATCH)** 은 반드시 `zValidator` 미들웨어로 body schema 검증
2. **보호 path** (`src/routes/protected/`) 는 반드시 `authMiddleware` 적용
3. 핸들러는 `c.json(...)` 명시 응답 (raw `Response` 직접 반환 ✕)

> 자세한 layer 순서 — `input-safety-gate-ordering` invariant 참조 (auth → schema → rate-limit → handler).

## 실행

```bash
# 패턴 1: POST/PUT/PATCH 핸들러 안 zValidator 누락 — file-level awk block scan
for f in apps/api/src/routes/*.ts apps/api/src/routes/**/*.ts; do
  [[ -f "$f" ]] || continue
  awk '/app\.(post|put|patch)\(/{flag=1; start=NR}
       flag && /zValidator/{flag=0}
       flag && /\)\s*$/{print FILENAME":"start": missing zValidator"; flag=0}' "$f"
done

# 패턴 2: 보호 path 안 authMiddleware 누락 — grep -L (no match files)
grep -L "authMiddleware" apps/api/src/routes/protected/*.ts 2>/dev/null

# 패턴 3: handler 가 raw Response 직접 반환 (c.json 우회)
grep -nE 'return\s+new\s+Response\(' apps/api/src/routes/
```

## 통과 기준

- 패턴 1 출력 **0줄** (모든 mutation route 가 zValidator 보유)
- 패턴 2 출력 **0줄** (모든 protected route 가 authMiddleware 보유)
- 패턴 3 출력 **0줄** (또는 SSE / file download 등 명시적 사유 주석 포함)

## 위반 시 조치

### 패턴 1 위반 — zValidator 누락

```typescript
// 위반 예시
app.post('/users', async (c) => {
  const body = await c.req.json()  // unsafe — schema 검증 없음
  return c.json({ id: ... })
})
```

조치 — `@hono/zod-validator` 미들웨어 추가:

```typescript
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const UserCreate = z.object({ email: z.string().email(), name: z.string().min(1) })

app.post('/users', zValidator('json', UserCreate), async (c) => {
  const body = c.req.valid('json')  // typed + validated
  return c.json({ id: ... })
})
```

### 패턴 2 위반 — authMiddleware 누락

```typescript
// 위반 예시 — src/routes/protected/billing.ts 에 auth 없음
const app = new Hono()
app.get('/invoices', async (c) => { ... })
```

조치:

```typescript
import { authMiddleware } from '@/middleware/auth'

const app = new Hono()
app.use('*', authMiddleware)  // 또는 라우터 부모에서 mount
app.get('/invoices', async (c) => { ... })
```

### 패턴 3 위반 — raw Response 직접 반환

- 일반 JSON 응답 → `c.json(...)` 로 교체 (sniff·status·content-type 자동)
- SSE / streaming / file download 같은 의도된 경우는 `// raw-response-ok: <사유>` 주석 추가

---

## audit 이 커버하지 않는 것

- RunPolicy / preset 검증 → `run-policy-presets-audit`
- error sentinel (`throw new Error` in routes) → `http-error-sentinels-audit`
- input schema 의 *내용* 검증 (예: 비밀번호 정책) → 별도 product audit
