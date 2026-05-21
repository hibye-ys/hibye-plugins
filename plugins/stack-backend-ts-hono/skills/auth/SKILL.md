---
name: auth
description: apps/api 인증·세션·시크릿 추가 또는 수정 시 invoke. JWT / c.env 시크릿 / Hono middleware 순서 / API key / rate limit 패턴. Workers 환경 특화 (c.env 시크릿, KV 세션 스토어). 인증 실패 401 디버깅, 시크릿 누락 에러 시에도 invoke.
metadata:
  role: workflow
  scope: apps/api
  source: (신규 — Python 인증 분산 부분 통합)
---

**적용된 §4.4 매트릭스 행**: `os.getenv("AUTH_SECRET")` → `c.env.AUTH_SECRET` (Hono Context Bindings), `pydantic BaseModel` + `AuthSettings` → zod + TypeScript interface, `Depends(require_auth)` → `app.use("/api/*", authMiddleware)` + `c.get("auth")`, `SessionPort` Protocol → `KVNamespace` (Wrangler binding) 또는 TypeScript interface, `asyncio.wait_for` → `AbortSignal.timeout()`, JWT verify `python-jose` → `jose` / `hono/jwt`

# auth — 인증·세션·시크릿 패턴

## 이 skill은 언제 invoke 되는가

- `src/middleware/auth.ts` 최초 작성 또는 수정
- 새 시크릿 바인딩 추가 (`wrangler.toml` + `.dev.vars`)
- JWT 발급/검증 로직 변경
- API key 인증 추가
- rate limit 정책 변경
- "c.env undefined", "AUTH_SECRET 누락", "401 unauthorized" 디버깅

## Workers 환경 시크릿 원칙

```typescript
// 올바른 시크릿 접근 (Workers)
export type Env = {
  Bindings: {
    AUTH_SECRET: string        // JWT signing secret
    OPENROUTER_API_KEY: string
    KV_SESSIONS: KVNamespace  // 세션 스토어
    // ... 추가 시크릿
  }
}

// route/middleware 안에서
app.use('*', async (c, next) => {
  const secret = c.env.AUTH_SECRET  // ✅ Workers 방식
  // process.env.AUTH_SECRET 는 Workers 에서 미지원 ✕
  await next()
})
```

> **절대 `process.env` 사용 금지** — Workers 환경에서 `process` 객체가 없다. 항상 `c.env.<KEY>` 사용. `verify-workers-compat` invariant 참조.

## wrangler.toml + .dev.vars

```toml
# wrangler.toml
name = "apps-api"

[vars]
APP_ENV = "production"

# KV binding
[[kv_namespaces]]
binding = "KV_SESSIONS"
id = "xxxx"

# 시크릿은 wrangler.toml 에 값 직접 기입 금지 — wrangler secret put 사용
# 또는 .dev.vars (로컬 개발 전용, gitignore)
```

```bash
# .dev.vars (로컬 전용)
AUTH_SECRET=dev-secret-change-in-prod
OPENROUTER_API_KEY=sk-or-...
```

```bash
# 운영 시크릿 등록
wrangler secret put AUTH_SECRET
wrangler secret put OPENROUTER_API_KEY
```

## JWT 인증 Middleware

```typescript
// src/middleware/auth.ts
import { verify } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'
import type { MiddlewareHandler } from 'hono'

export interface AuthPayload {
  userId: string
  scopes: string[]
  method: 'jwt' | 'api_key'
}

// Context type extension
declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthPayload
  }
}

export const authMiddleware: MiddlewareHandler<{ Bindings: Env['Bindings'] }> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader) {
    // APP_AUTH_REQUIRED 가 false 이면 anonymous fallback
    if (c.env.APP_AUTH_REQUIRED === 'false') {
      c.set('auth', { userId: 'anonymous', scopes: ['chat'], method: 'jwt' })
      return next()
    }
    throw new HTTPException(401, { message: 'Authorization header required' })
  }

  // JWT 검증
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const payload = await verify(token, c.env.AUTH_SECRET, 'HS256')
      c.set('auth', {
        userId: payload.sub as string,
        scopes: (payload.scopes as string[] | undefined) ?? ['*'],
        method: 'jwt',
      })
      return next()
    } catch {
      throw new HTTPException(401, { message: 'Invalid token' })
    }
  }

  // API key 검증 (B2B)
  if (authHeader.startsWith('ApiKey ')) {
    const apiKey = authHeader.slice(7)
    const userId = await verifyApiKey(apiKey, c.env)
    if (!userId) throw new HTTPException(401, { message: 'Invalid API key' })
    c.set('auth', { userId, scopes: ['*'], method: 'api_key' })
    return next()
  }

  throw new HTTPException(401, { message: 'Unsupported auth scheme' })
}

async function verifyApiKey(key: string, env: Env['Bindings']): Promise<string | null> {
  // API key format: lf_<kid>_<secret>
  // KV lookup by kid for O(1) resolution
  const parts = key.split('_')
  if (parts.length < 3 || parts[0] !== 'lf') return null
  const kid = parts[1]
  const storedHash = await env.KV_SESSIONS.get(`api_key:${kid}`)
  if (!storedHash) return null
  // argon2 hash verify (edge: use SubtleCrypto HMAC as approximation)
  // ...
  return null  // 구현 시 채울 것
}
```

## 세션 스토어 (KV 기반)

```typescript
// src/storage/session.ts
export interface SessionPort {
  get(sessionId: string): Promise<SessionData | null>
  set(sessionId: string, data: SessionData, ttlSeconds?: number): Promise<void>
  delete(sessionId: string): Promise<void>
}

export interface SessionData {
  userId: string
  history: Message[]
  createdAt: number
  updatedAt: number
}

// Workers KV 구현
export function createKVSessionStore(kv: KVNamespace): SessionPort {
  return {
    async get(sessionId) {
      const raw = await kv.get(sessionId, 'json')
      return raw as SessionData | null
    },
    async set(sessionId, data, ttlSeconds = 86400) {
      await kv.put(sessionId, JSON.stringify(data), { expirationTtl: ttlSeconds })
    },
    async delete(sessionId) {
      await kv.delete(sessionId)
    },
  }
}
```

## Rate Limit Middleware

```typescript
// src/middleware/rate-limit.ts
// Workers KV 기반 토큰 버킷 구현
// run-policy-presets invariant 의 rate limit 상수 참조

export const rateLimitMiddleware: MiddlewareHandler<{ Bindings: Env['Bindings'] }> = async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const key = `rate_limit:${ip}`
  const now = Date.now()

  const raw = await c.env.KV_SESSIONS.get(key, 'json') as { count: number; resetAt: number } | null
  const windowMs = 60_000   // 1분
  const maxRequests = 60    // run-policy-presets 참조

  if (raw && now < raw.resetAt) {
    if (raw.count >= maxRequests) {
      c.header('Retry-After', String(Math.ceil((raw.resetAt - now) / 1000)))
      return c.json({ error: { code: 'rate_limit_exceeded', message: 'Too many requests', retry_after_ms: raw.resetAt - now } }, 429)
    }
    await c.env.KV_SESSIONS.put(key, JSON.stringify({ count: raw.count + 1, resetAt: raw.resetAt }), { expirationTtl: 120 })
  } else {
    await c.env.KV_SESSIONS.put(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), { expirationTtl: 120 })
  }

  return next()
}
```

## Scope 검증

```typescript
export function requireScope(required: string) {
  return async (c: HonoContext, next: Next) => {
    const auth = c.get('auth')
    if (!auth.scopes.includes('*') && !auth.scopes.includes(required)) {
      // 403 아닌 leak-safe 404 사용
      throw new HTTPException(404, { message: 'resource not found' })
    }
    return next()
  }
}
```

## 시크릿 누락 에러 처리

```typescript
// src/utils/env.ts — 시작 시점 필수 시크릿 검증
export function assertRequiredSecrets(env: Env['Bindings']): void {
  const required: (keyof Env['Bindings'])[] = ['AUTH_SECRET', 'OPENROUTER_API_KEY']
  for (const key of required) {
    if (!env[key]) {
      throw new Error(`Missing required secret: ${key}. Set via wrangler secret put or .dev.vars`)
    }
  }
}

// src/index.ts 에서 app startup 시
app.use('*', async (c, next) => {
  try {
    assertRequiredSecrets(c.env)
  } catch (err) {
    console.error('configuration_error', { err: String(err) })
    return c.json({ error: { code: 'configuration_error', message: 'service misconfigured' } }, 500)
  }
  return next()
})
```

## c.env undefined 디버깅

Workers 환경에서 `c.env` 가 `undefined` 인 경우:

1. `wrangler.toml` 에 binding 선언 확인
2. `.dev.vars` 에 로컬 값 설정 확인
3. `wrangler dev` 재시작 (환경변수 변경 후 반드시 재시작)
4. TypeScript `Env` type 에 binding 추가 확인 — type 안 선언하면 `c.env.KEY` 타입 에러
5. `debug-session` skill 의 Workers-specific 단서 참조

## 검증 체크리스트

- [ ] `authMiddleware` 가 JWT + API key 두 경로 처리
- [ ] 모든 시크릿이 `c.env.<KEY>` 접근 (`process.env` 사용 없음)
- [ ] `assertRequiredSecrets()` 로 시작 시점 누락 시크릿 검출
- [ ] rate limit middleware 가 `run-policy-presets` invariant 상수 참조
- [ ] 세션 스토어가 `SessionPort` interface 구현 (KV 또는 교체 가능)
- [ ] scope 불일치 → leak-safe 404 (403 아님)
- [ ] `.dev.vars` 가 `.gitignore` 에 포함됨
- [ ] `wrangler.toml` 에 실제 시크릿 값 없음 (바인딩 이름만)
