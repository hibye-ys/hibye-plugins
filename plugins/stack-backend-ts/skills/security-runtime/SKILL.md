---
name: security-runtime
description: apps/api 런타임 보안 감사 + 통합 보고서 작성 시 invoke. CORS / rate limit / auth 경로 커버리지 / leak-safe 404 / secret scanner / 요청 크기 제한 / 세션 TTL / CSRF / audit log retention. zod input parse 게이트 / Cloudflare Workers Secrets / WAF 연동.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/security-runtime
---

**적용된 §4.4 매트릭스 행**: `pydantic BaseModel.parse_obj` → `zSchema.parse(input)` (모든 입력 → 게이트), `starlette CORSMiddleware` → `hono/cors` `cors({ origin, ... })`, `slowapi` / `fastapi-limiter` rate limit → **Cloudflare Workers KV + sliding window** 또는 `hono-rate-limiter`, `python-jose` JWT → `hono/jwt` 또는 `jose` (npm), `AWS Secrets Manager` / `.env` → **Cloudflare Workers Secrets** (`wrangler secret put` + `c.env.<NAME>`), CSRF `starlette-csrf` → `hono/csrf` + double-submit cookie, audit log (Postgres trigger) → Drizzle insert + R2 immutable retention, `os.getenv` → `c.env.<NAME>`, `pip-audit` / `safety` → `npm audit` / `pnpm audit`

# security-runtime — 런타임 보안 감사 + 보고서 가이드

## 이 skill 은 언제 invoke 되는가

- `security-manager` sub-agent 호출 시 (runtime / deep-audit 모드)
- 런타임 보안 점검 (CORS, rate limit, auth) 필요 시
- 통합 보안 보고서 작성 시
- 새 라우트 추가 후 인증 커버리지 확인
- 시크릿 노출 사고 후 secret scanner 확장

## 이 skill 은 언제 invoke 되지 않는가

- 빠른 pre-merge 체크 → `pre-deploy-check` workflow
- 의존성 CVE 감사 → 별도 `pnpm audit` / Snyk 워크플로
- 코드 구현 작업 → 해당 서브시스템 workflow

## 절대 원칙 (모든 입력 → zod 게이트)

```typescript
// 모든 외부 입력 (req body / query / header / KV value / R2 metadata) =
// 라우트 진입 직후 zod parse 통과만 통과
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const RunInputSchema = z.object({
  input: z.string().max(50_000),
  agent: z.string().regex(/^[a-z0-9-]+$/).optional(),
})

app.post('/run/chat', zValidator('json', RunInputSchema), async (c) => {
  const body = c.req.valid('json')  // 이미 parse 됨
  // ...
})
```

> `input-safety-gate-ordering` invariant 의 V3 순서 (tombstone → jailbreak heuristic → jailbreak classifier → moderation → `_streamAgent`) 와 결합. zod parse 는 **0번 게이트** (가장 싸고 항상 가장 먼저).

## 1. CORS 설정 검증

```bash
# CORS middleware 등록 확인
rg -n "hono/cors|import.*cors|app\.use.*cors" apps/api/src/middleware/ apps/api/src/index.ts

# wildcard origin (VIOLATION in production)
rg -n "origin:\s*'\*'|origin:\s*\"\*\"|allowAllOrigins" apps/api/src/
```

```typescript
// ✅ 올바른 CORS 패턴
import { cors } from 'hono/cors'

app.use('/api/*', cors({
  origin: (origin) => {
    const allowed = [c.env.APP_WEB_ORIGIN]
    return allowed.includes(origin) ? origin : null
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
  exposeHeaders: ['X-Request-Id', 'X-App-Session-Id', 'X-App-Usage'],
  maxAge: 3600,
}))
```

## 2. Rate Limiting 설정

```bash
# rate limit 미들웨어
rg -n "rateLimit|hono-rate-limiter|kvRateLimit" apps/api/

# /media/* 별도 rate limit (비용 프로파일 다름)
rg -n "media.*rate|rate.*media" apps/api/src/routes/media.ts
```

```typescript
// ✅ Workers KV + sliding window rate limit
async function kvSlidingWindowRateLimit(
  kv: KVNamespace,
  key: string,
  windowSec: number,
  maxRequests: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const nowSec = Math.floor(Date.now() / 1000)
  const windowStart = nowSec - windowSec
  const raw = (await kv.get(key)) ?? ''
  const timestamps = raw.split(',').filter(Boolean).map(Number).filter((t) => t > windowStart)
  if (timestamps.length >= maxRequests) {
    return { allowed: false, remaining: 0 }
  }
  timestamps.push(nowSec)
  await kv.put(key, timestamps.join(','), { expirationTtl: windowSec + 60 })
  return { allowed: true, remaining: maxRequests - timestamps.length }
}
```

## 3. Auth 경로 커버리지

```bash
# 인증 미들웨어 사용 현황
rg -n "authMiddleware|requireAuth|c\.get\('auth'\)" apps/api/src/routes/

# 인증 없는 엔드포인트 (health / metrics 만 OK)
for f in apps/api/src/routes/*.ts; do
  routes=$(rg -c "app\.(get|post|patch|delete|put)" "$f" 2>/dev/null || echo 0)
  auths=$(rg -c "authMiddleware|requireAuth|c\.get\('auth'\)" "$f" 2>/dev/null || echo 0)
  echo "$(basename $f): routes=$routes auths=$auths"
done
```

## 4. Leak-safe 404 패턴

```bash
# 403 반환 경로 (VIOLATION — 모두 404 여야 함)
rg -n "HTTPException\(403|status:\s*403|new Response.*403" apps/api/src/routes/

# 소유권 검증 후 404 반환 패턴
rg -n "throw new ResourceError|assertOwner|assertOwnership" apps/api/src/routes/
```

```typescript
// ✅ Leak-safe — 권한 부재든 미존재든 동일 404 (존재 정보 leak ✕)
const entity = await reader.findById(id)
if (entity === null || entity.ownerId !== auth.userId) {
  throw new HTTPException(404, { message: 'not found' })
}
```

## 5. Secret Scanner 커버리지

```bash
# SCRUB_PATTERNS 목록 (최소 4종: sk-, AKIA, ghp_, PEM)
rg -n "SCRUB_PATTERNS|scrubSecrets|SCAN_EVENTS" apps/api/src/sse/

# scrub 함수가 SSE 7 이벤트 전부에 호출되는지
rg -n "scrubText|scrubDict|scrubSecrets" apps/api/src/sse/ | wc -l
```

```typescript
// 최소 4종 (보강 시 추가)
export const SCRUB_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}\b/g,           // OpenAI / Anthropic
  /\bAKIA[0-9A-Z]{16}\b/g,              // AWS Access Key
  /\bghp_[A-Za-z0-9]{20,}\b/g,          // GitHub PAT
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
]
```

## 6. 요청 크기 제한

```bash
# max body size / content length 제한
rg -n "bodyLimit|maxBodySize|content.length|contentLengthLimit" apps/api/src/middleware/ apps/api/src/index.ts
```

```typescript
// ✅ hono/body-limit
import { bodyLimit } from 'hono/body-limit'

app.use('*', bodyLimit({
  maxSize: 5 * 1024 * 1024,  // 5 MB
  onError: (c) => c.json({ error: 'payload too large' }, 413),
}))

// /media/upload 만 더 크게
app.use('/media/upload', bodyLimit({ maxSize: 100 * 1024 * 1024 }))
```

## 7. 세션 TTL / CSRF

```bash
# 세션 만료 설정
rg -n "expirationTtl|sessionTtl|maxAge|JWT.*expiresIn|exp:" apps/api/src/

# CSRF 보호 (SSE GET 엔드포인트는 별도)
rg -n "hono/csrf|csrfMiddleware|X-CSRF" apps/api/src/
```

```typescript
// ✅ Hono CSRF — POST/PATCH/DELETE 만 적용 (SSE GET 제외)
import { csrf } from 'hono/csrf'

app.use('*', csrf({
  origin: (origin, c) => origin === c.env.APP_WEB_ORIGIN,
}))
```

## 8. Workers Secrets / 환경변수 분리

```bash
# .dev.vars 가 .gitignore 에 있는지
grep -q "\.dev\.vars" .gitignore && echo OK || echo VIOLATION

# wrangler secret 등록 목록 확인
pnpm exec wrangler secret list

# 코드에서 process.env 사용 (VIOLATION in Workers)
rg -n "process\.env\." apps/api/src/
```

```typescript
// ❌ Workers 에서 process.env 사용 ✕
const key = process.env.API_KEY  // 런타임 undefined

// ✅ c.env.<NAME> + Bindings 타입
export type Env = {
  Bindings: {
    OPENROUTER_API_KEY: string     // wrangler secret put OPENROUTER_API_KEY
    AUTH_SECRET: string
    DATABASE_URL: string
  }
}
const key = c.env.OPENROUTER_API_KEY
```

## 9. Audit log retention

```bash
# 인증/권한 변경 audit 호출 지점
rg -n "emitAuditEvent|auditLog\.(write|insert)" apps/api/src/routes/auth/ apps/api/src/services/

# R2 immutable (Object Lock 또는 prefix retention)
rg -n "auditLog.*R2|writeAudit.*R2" apps/api/src/
```

> `data-governance` invariant — audit log 는 6 event taxonomy 고정, append-only, 7년 retention. 인증/권한 변경은 별도 R2 immutable prefix (Object Lock).

## 통합 보안 보고서 템플릿

```markdown
## Security Audit Report — <date>

### Executive Summary
- Audit scope: apps/api/ (Phase <N>)
- Critical: <N> | High: <N> | Medium: <N> | Low: <N>

### 1. Input safety
- [OK/FAIL] All routes use `zValidator` or manual `Schema.parse`
- [OK/FAIL] Input safety gate V3 순서 유지 (tombstone → jailbreak → moderation → agent)

### 2. Supply Chain
- [OK/FAIL] `pnpm audit` clean (또는 ignore 사유 명시)
- License risks: <list>
- Stale dependencies: <list>

### 3. Runtime Security (this skill)
- CORS: [OK/FAIL] — wildcard 없음, allow-list 기반
- Rate limiting: [OK/FAIL] — 라우트별 적용 여부
- Auth coverage: [OK/FAIL] — <N>/<M> routes protected
- Leak-safe 404: [OK/FAIL] — 403 사용 0건
- Secret scanner: [OK/FAIL] — <N> patterns, <M> events covered
- Request size limits: [OK/FAIL] — bodyLimit 적용
- Session TTL / CSRF: [OK/FAIL]
- Workers Secrets: [OK/FAIL] — `process.env` 사용 0건
- Audit log retention: [OK/FAIL] — append-only / R2 immutable

### 4. Top 5 Attack Surfaces
1. <surface> — risk: <level>, mitigation: <action>
2. ...

### 5. Remediation Priority
| # | Finding | Severity | Effort | Recommendation |
|---|---------|----------|--------|---------------|
| 1 | ... | CRITICAL | Low | Fix immediately |
```

## core-infrastructure 흡수 보충 — 보안 측 △

### 예외 계층 (보안 측 매핑)

> 정본 = `error-handling` workflow §예외 계층. 본 SKILL.md 는 **보안 매핑만** 추가.

| 예외 (정본 = `error-handling`) | 보안 측 행동 |
|---|---|
| `ValidationError` (zod 실패) | 422, 사용자 input scrub 후 반환 — stack ✕ |
| `ConfigurationError` (env 누락) | 500 "service misconfigured" — 어떤 env 누락인지 ✕ |
| `ResourceError` (권한/미존재) | **항상 404** (leak-safe), 403 ✕ |
| `InternalError` (불변식 위반) | 500 "internal server error" — 상세 메시지 ✕ |

### 영향도 — 보안 정책 변경 시

| 변경 | 영향받는 곳 |
|---|---|
| CORS allow-list 변경 | 프론트엔드 빌드 + 모바일 (web view), CSRF origin 동시 갱신 |
| Rate limit threshold 변경 | KV cost, 정당 사용자 차단 risk — Sentry alert 임계값도 동시 갱신 |
| Secret 회전 | `wrangler secret put` → 모든 worker 인스턴스 즉시 반영 (재배포 불필요) — 단 캐시된 client 인스턴스 (`p-retry` 등) reset 필요 |
| Auth middleware 순서 변경 | `input-safety-gate-ordering` 게이트 순서와 충돌 가능 — V3 순서 유지 검증 |
| 새 secret 추가 | (1) `wrangler secret put` (2) `Env.Bindings` 타입 추가 (3) `pnpm exec wrangler types` |

### 영향도 — 보안 정책 금지사항

- CORS `origin: '*'` (production)
- 403 반환 (404 leak-safe 위반)
- `process.env.<NAME>` 사용 (Workers undefined)
- `.dev.vars` 를 git 에 commit
- Audit log 의 update / delete (append-only 위반)
- Secret 을 KV 에 저장 (KV 는 평문) — 반드시 `wrangler secret`
- JWT 에 PII 포함 (payload 는 base64, encryption ✕)

## 의존 자산

- `input-safety-gate-ordering` invariant — V3 게이트 순서
- `error-handling` workflow — 4 예외 / 4 패턴 (정본)
- `http-error-sentinels` invariant — sentinel 매핑
- `auth` workflow — JWT / Workers Secrets / KV 세션
- `data-governance` invariant — audit log 6 event taxonomy
- `ts-agent-rules` workflow — AsyncLocalStorage 10 필드 (requestId / userId)

## 검증 체크리스트

- [ ] 9개 런타임 체크 블록 실행
- [ ] 보고서 템플릿의 모든 섹션 채움
- [ ] CRITICAL 항목은 즉시 보고
- [ ] 403 사용 경로는 모두 VIOLATION 으로 분류
- [ ] `process.env` 사용 0건 (Workers compat)
- [ ] `pnpm audit` 결과 첨부

## 구현 중 막히면

- auth middleware 미구현 → 인증 미구현 경고 (CRITICAL)
- rate limit 미구현 → KV sliding window 패턴 (위 §2) 적용
- CORS 미설정 → 개발 환경이라도 경고
- `wrangler secret` 미사용 → `.dev.vars` → `wrangler secret put` 마이그
- `process.env` 사용 발견 → `verify-workers-compat` invariant + `c.env.<NAME>` 마이그

## Cross-ref

- `error-handling` (정본 — 예외 4종 정의)
- `input-safety-gate-ordering` (V3 게이트 순서)
- `auth` (시크릿 / JWT / KV 세션)
- `data-governance` (audit log)
- `verify-workers-compat` (`process.env` ✕)
- `ts-agent-rules` (AsyncLocalStorage / 영향도 표 정본)
