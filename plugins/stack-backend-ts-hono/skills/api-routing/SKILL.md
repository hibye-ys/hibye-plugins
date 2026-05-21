---
name: api-routing
description: apps/api 에 새 Hono route / middleware / 전역 onError 핸들러 추가 시 invoke. route 그룹화 + middleware 순서 + auth middleware 패턴, HTTPException (hono/http-exception) 변환, CORS expose_headers 규약 안내.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/rules/api-routing-patterns.md
---

**적용된 §4.4 매트릭스 행**: `FastAPI @router.get("/x")` → `app.get("/x", (c) => c.json({...}))`, `Depends(get_session)` → `app.use("/*", sessionMiddleware)` + `c.get("session")`, middleware 순서 = `app.use` 호출 순서 (Hono FIFO), `app.include_router(router)` → `app.route("/api", apiRouter)`, `@app.exception_handler(*)` → `app.onError((err, c) => ...)`, `HTTPException(404, "not found")` (FastAPI) → `throw new HTTPException(404, { message: "not found" })` (hono/http-exception), pydantic 요청 스키마 → zod + `c.req.json()` + `.parse()`

# api-routing — API 라우팅 규약

## 이 skill은 언제 invoke 되는가

- `src/routes/` 에 새 Hono route 추가
- middleware 순서 결정
- 전역 `app.onError` 핸들러 등록
- CORS `exposeHeaders` 변경
- "route 가 안 매칭된다", "middleware 가 잘못된 순서로 실행된다" 디버깅

## 최상위 prefix 규약

```typescript
// src/routes/index.ts
import { Hono } from 'hono'

const routes = new Hono<{ Bindings: Env }>()

routes.route('/health', healthRouter)     // 인증 제외
routes.route('/run', runRouter)           // POST /run/:name — LLM 기반 실행
routes.route('/sessions', sessionsRouter) // 세션 조회/취소
routes.route('/media', mediaRouter)       // 미디어 파이프라인

export default routes
```

- 중첩 prefix 금지 (`/ai/run/foo` 같은 구조 사용 안 함)
- 새 최상위 prefix 추가는 설계 문서 검토 후

## Hono App + Middleware 등록

```typescript
// src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import routes from './routes/index.ts'
import { authMiddleware } from './middleware/auth.ts'
import { rateLimitMiddleware } from './middleware/rate-limit.ts'
import { requestIdMiddleware } from './middleware/request-id.ts'

export type Env = {
  Bindings: {
    AUTH_SECRET: string
    OPENROUTER_API_KEY: string
    // ... other bindings
  }
}

const app = new Hono<Env>()

// Middleware 등록 순서 = 실행 순서 (Hono FIFO — FastAPI 와 달리 add 순서가 곧 실행 순서)
app.use('*', requestIdMiddleware)       // 1. X-Request-Id
app.use('*', rateLimitMiddleware)       // 2. Rate limit
app.use('*', cors({                     // 3. CORS
  origin: ['https://app.example.com'],
  exposeHeaders: [
    'X-App-Session-Id',
    'X-App-Agent',
    'X-App-Model',
    'X-Request-Id',
  ],
}))
app.use('/run/*', authMiddleware)       // 4. 인증 (health 제외)
app.use('/sessions/*', authMiddleware)
app.use('/media/*', authMiddleware)

// 전역 에러 핸들러
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse()
  }
  console.error('unhandled_error', { err: String(err), path: c.req.path })
  return c.json(
    { error: { code: 'internal_error', message: 'internal server error' } },
    500
  )
})

app.route('/', routes)

export default app
```

## Route 구현 패턴

```typescript
// src/routes/run.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'

const RunRequestSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  context_hint: z.string().max(2000).optional(),
})

const runRouter = new Hono<{ Bindings: Env }>()

runRouter.post('/:name',
  zValidator('json', RunRequestSchema),
  async (c) => {
    const runName = c.req.param('name')
    const body = c.req.valid('json')
    const auth = c.get('auth')  // authMiddleware 주입

    // route 는 thin layer — 도메인 로직은 engine/ 경유
    const policy = getRunPolicy(runName)
    if (!policy) throw new HTTPException(404, { message: `run '${runName}' not found` })

    if (policy.sse) {
      return streamSSE(c, async (stream) => {
        // ... SSE 핸들러 (sse-streaming skill 참조)
      })
    }

    // non-SSE: 단일 JSON 응답
    const result = await runAgentLoopSync({ runName, ...body, env: c.env })
    return c.json({ events: result })
  }
)

export default runRouter
```

## Route 그룹화

```typescript
// src/routes/index.ts — app.route() 로 그룹화
app.route('/api/v1', v1Routes)   // prefix 추가 시
// 또는 중첩 Hono 인스턴스
const api = new Hono()
api.route('/run', runRouter)
api.route('/sessions', sessionsRouter)
app.route('/api', api)
```

## Leak-safe 404

소유권 불일치 시 403 금지 — 존재/미존재/권한없음 을 모두 404 로 응답. 존재 여부를 권한으로 추론 불가.

```typescript
// 리소스 소유자 확인
if (resource.userId !== auth.userId && !auth.scopes.includes('*')) {
  throw new HTTPException(404, { message: 'resource not found' })  // 403 아님
}
```

## HTTP 에러 변환

```typescript
// src/middleware/error.ts
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse()
  }
  if (err instanceof ZodError) {
    return c.json(
      { error: { code: 'validation_error', message: err.message } },
      422
    )
  }
  // ConfigurationError, InternalError 등 → 상세 숨김
  console.error('app_error', { err: String(err), path: c.req.path })
  return c.json(
    { error: { code: 'internal_error', message: 'internal server error' } },
    500
  )
})
```

에러 JSON 포맷 고정: `{ error: { code: string, message: string, details?: unknown } }`

## CORS `exposeHeaders` 규약

브라우저 JS 가 읽어야 하는 헤더 — CORS expose 필수:

| 헤더 | 용도 |
|---|---|
| `X-App-Session-Id` | FE의 session id 추출 |
| `X-App-Agent` | 현재 dispatch 된 run 이름 |
| `X-App-Model` | 해석된 모델 |
| `X-Request-Id` | 디버깅 / 서버 로그 correlation |

`exposeHeaders` 목록 변경은 FE contract breaking — 프론트엔드 코드 동시 검토 필수.

## middleware 순서 주의

Hono middleware 는 **FIFO** — `app.use` 호출 순서가 곧 실행 순서. FastAPI 의 `add_middleware` (LIFO wrap) 와 반대.

```typescript
// Hono FIFO 예시
app.use('*', A)  // 먼저 실행
app.use('*', B)  // 나중 실행

// 요청: A → B → route handler
// 응답: route handler → B.next → A.next
```

## Routes 계층 원칙

| 책임 | 위치 |
|---|---|
| HTTP 파라미터 파싱 / zod 검증 | `src/routes/*.ts` |
| 인증 / request_id 주입 | `src/middleware/` |
| SSE / JSON 응답 포맷 결정 | `src/routes/*.ts` |
| 도메인 로직 | ❌ 금지 — `src/engine/` 또는 `src/ai/` 경유 |
| DB/파일 쓰기 | ❌ 금지 — `src/storage/writer.ts` 경유 |
| Provider 직접 호출 | ❌ 금지 — `src/engine/loop.ts` 경유 |

## 검증 체크리스트

- [ ] 모든 보호 엔드포인트에 `authMiddleware` 적용 (health 제외)
- [ ] `app.onError` 전역 핸들러 등록
- [ ] 에러 JSON 포맷 고정 (`{ error: { code, message } }`)
- [ ] CORS `exposeHeaders` 에 X-App-* 4종 포함
- [ ] zod schema 로 요청 body 검증 (`zValidator`)
- [ ] 리소스 소유권 불일치 → 404 (403 아님)
- [ ] routes 에 도메인 로직 없음 (thin layer)
- [ ] `http-error-sentinels` invariant 의 envelope shape 준수
