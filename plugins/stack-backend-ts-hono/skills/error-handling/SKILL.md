---
name: error-handling
description: apps/api 에서 에러 sentinel 매핑 / 전역 onError 핸들러 / structured logging 추가 수정 시 invoke. HTTPException (hono/http-exception), 4 표준 패턴, 예외 계층, tool result 에러 반환 패턴 안내. "에러가 노출됨", "에러 처리 패턴 불일치" 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/rules/error-handling.md
---

**적용된 §4.4 매트릭스 행**: `raise HTTPException(404, "not found")` (FastAPI) → `throw new HTTPException(404, { message: "not found" })` (hono/http-exception), `try/except` → `try/catch`, `@app.exception_handler(*)` → `app.onError((err, c) => ...)`, `except Exception:` (HTTP 경계) → `app.onError` 전역 핸들러, `ToolResult(is_error=True)` → `ToolResult({ isError: true })`, `structlog.warning(...)` → `console.warn(JSON.stringify({...}))`, `scrub_text` → `scrubText` (동일 의미)

# error-handling — 에러 처리 표준

## 이 skill은 언제 invoke 되는가

- `src/middleware/error.ts` 또는 `app.onError` 핸들러 작성/수정
- 새 에러 코드 추가 (`http-error-sentinels` invariant 확장)
- "에러가 외부에 그대로 노출됨" 사고
- "에러 처리 패턴이 4 가지 중 어떤 것인지 헷갈림" 분류 필요

## 4 표준 패턴

| 패턴 | 경계 | 동작 | 응답 |
|------|------|------|------|
| 1. 공개 API | HTTP/SSE 엔드포인트 | 내부 예외를 외부에 노출하지 않음 | SSE → error 이벤트, JSON → HTTPException |
| 2. 내부 서비스 | engine, tools, providers | typed exception throw | 호출자가 복구 판단 |
| 3. 초기화/부팅 | startup | throw + 프로세스 종료 | fail-fast |
| 4. 선택적/best-effort | 캐시, 메타데이터 | return null + console.warn | 메인 흐름 계속 |

## 예외 계층 (TypeScript)

```typescript
// src/errors.ts
export class AppError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  // 입력/설정 형식 오류 → 클라이언트 수정 후 재시도
  constructor(message: string) {
    super(message, 'validation_error')
    this.name = 'ValidationError'
  }
}

export class ConfigurationError extends AppError {
  // 환경변수/시크릿 누락 → 재시작 필요
  constructor(message: string) {
    super(message, 'configuration_error')
    this.name = 'ConfigurationError'
  }
}

export class ResourceError extends AppError {
  // 리소스 미존재/접근 불가 → 재시도 가능
  constructor(message: string, public readonly resourceCode?: string) {
    super(message, resourceCode ?? 'resource_error')
    this.name = 'ResourceError'
  }
}

export class InternalError extends AppError {
  // 내부 불변식 위반 → 재시도 무의미 (버그)
  constructor(message: string) {
    super(message, 'internal_error')
    this.name = 'InternalError'
  }
}
```

## 전역 onError 핸들러 (Pattern 1)

```typescript
// src/index.ts
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { scrubText } from './sse/scrub.ts'
import { ValidationError, ConfigurationError, ResourceError, InternalError, AppError } from './errors.ts'

app.onError((err, c) => {
  // HTTPException — 라우트가 직접 발신 (이미 HTTP 포맷)
  if (err instanceof HTTPException) {
    return err.getResponse()
  }

  // ZodError — 요청 검증 실패
  if (err instanceof ZodError) {
    return c.json(
      { error: { code: 'validation_error', message: scrubText(err.message) } },
      422
    )
  }

  // ValidationError
  if (err instanceof ValidationError) {
    return c.json(
      { error: { code: 'validation_error', message: scrubText(err.message) } },
      422
    )
  }

  // ResourceError
  if (err instanceof ResourceError) {
    const status = err.resourceCode === 'user_data_pending_deletion' ? 410 : 404
    return c.json(
      { error: { code: err.resourceCode ?? 'resource_error', message: scrubText(err.message) } },
      status
    )
  }

  // ConfigurationError — 상세 숨김
  if (err instanceof ConfigurationError) {
    console.error('configuration_error', { err: err.message, path: c.req.path })
    return c.json(
      { error: { code: 'configuration_error', message: 'service misconfigured' } },
      500
    )
  }

  // InternalError — 상세 숨김
  if (err instanceof InternalError) {
    console.error('internal_error', { err: err.message, path: c.req.path })
    return c.json(
      { error: { code: 'internal_error', message: 'internal server error' } },
      500
    )
  }

  // Fallback — 알 수 없는 에러
  console.error('unhandled_error', { err: String(err), path: c.req.path })
  return c.json(
    { error: { code: 'internal_error', message: 'internal server error' } },
    500
  )
})
```

## HTTPException throw 패턴 (라우트 내)

```typescript
import { HTTPException } from 'hono/http-exception'

// 404 — resource not found (leak-safe)
throw new HTTPException(404, { message: 'resource not found' })

// 422 — validation
throw new HTTPException(422, { message: 'invalid request body' })

// 401 — unauthorized
throw new HTTPException(401, { message: 'Authorization required' })

// http_error 헬퍼 (envelope 자동 래핑)
function httpError(status: number, code: string, message: string): HTTPException {
  return new HTTPException(status, {
    res: new Response(
      JSON.stringify({ error: { code, message } }),
      { status, headers: { 'Content-Type': 'application/json' } }
    )
  })
}
```

## Tool 에러 — Pattern 2 (내부 서비스)

```typescript
// tools 에서 에러는 throw 금지 — ToolResult(isError: true) 로 wrap
// Agent Loop 가 LLM 에게 에러 결과를 전달하고 다음 turn 에서 복구 시도

async function executeTool(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    const result = await someOperation(args)
    return { content: result, isError: false }
  } catch (err) {
    // Pattern 2: typed exception throw → 호출자 wrap
    return {
      content: `Error: ${String(err)}`,
      isError: true,
    }
  }
}
```

## Tool result 절단 패턴

```typescript
const TOOL_PREVIEW_MAX_CHARS = 4000

export function truncateToolResult(content: string): string {
  if (content.length <= TOOL_PREVIEW_MAX_CHARS) return content
  return content.slice(0, TOOL_PREVIEW_MAX_CHARS) + `\n[truncated, ${content.length - TOOL_PREVIEW_MAX_CHARS} more chars]`
}
```

> head-truncate 한계: Python traceback 의 실제 예외 메시지는 끝줄. head-only 절단 시 핵심 이유를 잃을 수 있음. 스택 트레이스 전용 head+tail 패턴은 미래 개선.

## Structured Logging

```typescript
// Workers 환경에서 structlog 대신 console + JSON
console.error(JSON.stringify({
  level: 'error',
  event: 'provider_error',
  session_id: sessionId,
  model: model,
  err: scrubText(String(err)),
  path: c.req.path,
}))
```

> 시크릿/API key 포함 금지 — `scrubText` = `scrubPII(scrubSecrets(text))` 적용.

## SSE 에러 이벤트

SSE 엔드포인트 에러는 `error` SSE 이벤트로 전달 (`sse-lifecycle` invariant + `sse-streaming` skill 참조):

```typescript
// SSE stream 내부에서 에러 발생 시
yield ['error', { code: 'ProviderError', message: scrubText(String(err)) }]
```

## 금지 사항

- `catch (err) { }` (bare catch — 에러 묻힘)
- `catch (err) { console.log(err) }` 만 하고 아무 조치 없음
- 에러 메시지에 시크릿/API key 포함
- `throw` 없이 조용히 `return undefined`
- HTTP 경계 밖에서 `try/catch (err: any)` bare catch
- engine/tools 내부에서 `HTTPException` throw (반드시 `AppError` 하위 → routes 에서 변환)

## 검증 체크리스트

- [ ] `app.onError` 에 5 예외 유형 분기 (Zod, Validation, Resource, Configuration, Internal)
- [ ] ConfigurationError / InternalError 상세 숨김 (메시지 "service misconfigured" / "internal server error")
- [ ] 에러 JSON 포맷 고정 (`{ error: { code, message } }`) — `http-error-sentinels` invariant
- [ ] tool execute 에서 에러 → `ToolResult(isError: true)` wrap (throw 금지)
- [ ] 에러 메시지에 `scrubText` 적용
- [ ] SSE 에러 → `error` 이벤트 emit (`done` 합성 금지)
- [ ] engine/tools 내부 → `AppError` 하위 클래스, routes 에서 변환
