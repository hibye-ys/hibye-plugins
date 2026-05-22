---
name: error-handling
description: <api-app> 에서 에러 sentinel 매핑 / 전역 에러 핸들러 / structured logging 추가 수정 시 invoke. 4 표준 패턴, 예외 계층, tool result 에러 반환 패턴 안내. "에러가 노출됨", "에러 처리 패턴 불일치" 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/rules/error-handling.md
---

# error-handling — 에러 처리 표준

## 이 skill은 언제 invoke 되는가

- 전역 에러 핸들러 / 미들웨어 작성·수정
- 새 에러 코드 추가 (`http-error-sentinels` invariant 확장)
- "에러가 외부에 그대로 노출됨" 사고
- "에러 처리 패턴이 4 가지 중 어떤 것인지 헷갈림" 분류 필요

## 4 표준 패턴

| 패턴 | 경계 | 동작 | 응답 |
|------|------|------|------|
| 1. 공개 API | HTTP/SSE 엔드포인트 | 내부 예외를 외부에 노출하지 않음 | SSE → error 이벤트, JSON → sentinel envelope |
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

## Pattern 1 — 전역 에러 핸들러 원칙 (프레임워크 무관)

전역 에러 핸들러는 다음 분기를 가져야 함 (구체 framework API 는 [[api-routing]] 참조):

1. **이미 HTTP 포맷인 예외** (framework-native HTTP exception) — envelope 가 이미 채워져 있으면 그대로 통과
2. **요청 검증 실패** (Zod 등 schema error) → `422 validation_error` + `scrubText(message)`
3. **`ValidationError`** → `422 validation_error` + `scrubText(message)`
4. **`ResourceError`** → `resourceCode === 'user_data_pending_deletion'` 이면 410, 아니면 404 + `scrubText(message)`
5. **`ConfigurationError`** → 500 + 메시지 `"service misconfigured"` (상세 숨김, 내부 로그만 기록)
6. **`InternalError`** → 500 + 메시지 `"internal server error"` (상세 숨김, 내부 로그만 기록)
7. **Fallback** (알 수 없는 에러) → 500 + `internal_error` + `"internal server error"`. 내부 로그에 `String(err)` + path 기록

응답 body 는 항상 envelope shape `{ error: { code, message, details? } }` ([[http-error-sentinels]]).

## Route-edge 발신 패턴 (라우트 내)

라우트가 sentinel 을 직접 발신할 때:

- 401 — 인증 실패 (`Authorization required`)
- 404 — leak-safe not found (소유권 mismatch 도 동일)
- 410 — tombstone (`user_data_pending_deletion`)
- 422 — validation / policy / moderation / jailbreak
- 413 — `payload_too_large`
- 411 — `length_required`
- 429 — rate limit (middleware 발신; `Retry-After` + `retry_after_ms`)
- 409 — idempotency conflict (같은 `Idempotency-Key` + 다른 body hash; [[idempotency-key]] workflow)

route-edge helper 는 `errorBody(code, message, details?)` 만 사용 — 인라인 JSON 작성 금지. 자세한 매트릭스는 [[http-error-sentinels]].

## Tool 에러 — Pattern 2 (내부 서비스)

```typescript
// tools 에서 에러는 throw 금지 — ToolResult(isError: true) 로 wrap
// Agent Loop 가 LLM 에게 에러 결과를 전달하고 다음 turn 에서 복구 시도

async function executeTool(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    const result = await someOperation(args)
    return { content: result, isError: false }
  } catch (err) {
    // Pattern 2: 호출자 (Agent Loop) 가 결과를 LLM 에 전달, 자동 retry 안 함
    return {
      content: `Error: ${String(err)}`,
      isError: true,
    }
  }
}
```

핵심 원칙:

- Tool 내부 에러는 throw 대신 `{ isError: true }` 로 wrap 하여 LLM 에 반환
- Agent Loop 는 받은 에러 결과를 모델 컨텍스트에 추가 — 모델이 다음 turn 에서 복구 전략을 선택
- 서버는 자동 retry 하지 않음 (LLM 판단에 위임)

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

[[structured-log-schema]] invariant 참조 — 로그 레코드 필수 필드 (level / event / session_id / model / err / path 등) 와 scrub 정책의 단일 source.

원칙:

- 구조화 로그는 단일 JSON 객체 한 줄 (line-delimited JSON)
- 모든 외부에 노출되는 메시지·로그는 `scrubText` 적용 (`scrubText = scrubPii(scrubSecrets(text))`)
- 시크릿 / API key / PII / 스택 트레이스 raw 포함 금지

## SSE 에러 이벤트

SSE 엔드포인트 에러는 `error` SSE 이벤트로 전달 (`sse-lifecycle` invariant + `sse-streaming` skill 참조):

```
event: error
data: { "code": "ProviderError", "message": "<scrubbed>" }
```

- payload 의 `message` 는 반드시 `scrubText` 적용
- `done` 이벤트로 에러를 은폐하지 않음 — 명시적 `error` 이벤트 emit
- 구체 emit API 는 framework 별 SSE adapter 에 위임 ([[sse-streaming]])

## 금지 사항

- `catch (err) { }` (bare catch — 에러 묻힘)
- `catch (err) { console.log(err) }` 만 하고 아무 조치 없음
- 에러 메시지에 시크릿/API key 포함
- `throw` 없이 조용히 `return undefined`
- HTTP 경계 밖에서 `try/catch (err: any)` bare catch
- engine/tools 내부에서 HTTP-specific exception throw (반드시 `AppError` 하위 → routes 에서 변환)

## 검증 체크리스트

- [ ] 전역 핸들러에 5 예외 유형 분기 (Zod, Validation, Resource, Configuration, Internal)
- [ ] ConfigurationError / InternalError 상세 숨김 (메시지 "service misconfigured" / "internal server error")
- [ ] 에러 JSON 포맷 고정 (`{ error: { code, message } }`) — `http-error-sentinels` invariant
- [ ] tool execute 에서 에러 → `ToolResult(isError: true)` wrap (throw 금지)
- [ ] 에러 메시지에 `scrubText` 적용
- [ ] SSE 에러 → `error` 이벤트 emit (`done` 합성 금지)
- [ ] engine/tools 내부 → `AppError` 하위 클래스, routes 에서 변환
