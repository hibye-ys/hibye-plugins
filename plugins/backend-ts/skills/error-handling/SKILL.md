---
name: error-handling
description: <api-app> 의 에러 처리 4 표준 패턴 분류 + 예외 계층 (TypeScript) + Tool 에러 wrap 패턴 + Tool result 절단 + SSE 에러 emit. 전역 핸들러의 sentinel 매핑 / envelope shape / route-edge 발신 매트릭스는 [[http-error-sentinels]] invariant 가 정본 — 본 workflow 는 구현 분류만.
metadata:
  role: workflow
  scope: project
---

# error-handling — 에러 처리 4 패턴 + 예외 계층

> **정본 분리** — sentinel ↔ HTTP code 매핑 / envelope shape / route-edge 발신 매트릭스는 [[http-error-sentinels]] invariant 가 단일 source. 본 workflow 는 **패턴 분류 + 구현 코드** 만.

## 이 skill 은 언제 invoke 되는가

- 새 에러 종류 추가 시 어느 패턴에 속하는지 분류
- 예외 계층 (`AppError` 하위) 신규 클래스 작성
- Tool / Provider / Storage 내부 에러를 어떻게 처리할지 결정
- "에러가 외부에 그대로 노출됨" 사고 분석

## 4 표준 패턴 (분류 매트릭스)

| # | 패턴 | 경계 | 동작 | 응답 |
|---|------|------|------|------|
| 1 | 공개 API | HTTP/SSE 엔드포인트 | 내부 예외를 외부에 노출 ✕ | SSE → error 이벤트, JSON → sentinel envelope ([[http-error-sentinels]]) |
| 2 | 내부 서비스 | engine, tools, providers | typed exception throw | 호출자 (engine / route) 가 복구 판단 |
| 3 | 초기화 / 부팅 | startup | `ConfigurationError` throw + 프로세스 종료 | fail-fast ([[config-env-validation]]) |
| 4 | 선택적 / best-effort | 캐시, 메타데이터 | return null + `console.warn` | 메인 흐름 계속 |

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
  constructor(message: string) {
    super(message, 'validation_error')
    this.name = 'ValidationError'
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'configuration_error')
    this.name = 'ConfigurationError'
  }
}

export class ResourceError extends AppError {
  constructor(message: string, public readonly resourceCode?: string) {
    super(message, resourceCode ?? 'resource_error')
    this.name = 'ResourceError'
  }
}

export class InternalError extends AppError {
  constructor(message: string) {
    super(message, 'internal_error')
    this.name = 'InternalError'
  }
}
```

| 클래스 | 의미 | 복구 |
|---|---|---|
| `ValidationError` | 입력/설정 형식 오류 | 클라이언트 수정 후 재시도 |
| `ConfigurationError` | env / 시크릿 누락 | 재시작 필요 ([[config-env-validation]]) |
| `ResourceError` | 미존재 / 접근 불가 | 재시도 가능 (leak-safe 404) |
| `InternalError` | 내부 불변식 위반 | 재시도 무의미 (버그) |

## 전역 에러 핸들러 — 정본 참조

전역 에러 핸들러의 sentinel 매핑 / HTTP code / envelope shape 는 **[[http-error-sentinels]] invariant** 가 단일 source. 구체 framework API 는 [[api-routing]] workflow. 본 workflow 는 매핑 표 미보유 — 정본 갱신 시 한 곳만 수정.

### Pass-through 룰 (구현 시 의무)

전역 핸들러는 **이미 HTTP 포맷인 예외** (`<framework HTTP error class>` 인스턴스) 를 **그대로 통과**시킨다 — envelope 가 이미 채워져 있으므로 재포장 ✕. 이 분기가 누락되면 framework 가 던진 라이브러리 예외가 `internal_error` 로 둔갑하여 디버깅 불가.

```typescript
// 의사코드
<framework error handler>((err, ctx) => {
  // 1. framework-native HTTP exception — 그대로 통과
  if (err instanceof <framework HTTP error class>) return err.toResponse?.() ?? <framework json response>(ctx, err)
  // 2. 이후 ZodError / ValidationError / ResourceError / ConfigurationError / InternalError 분기 ...
})
```

framework 별 매핑은 instance 측 CLAUDE.md ([[placeholder-vocabulary]] 참조). 패턴은 동일 — *"framework 가 던진 envelope 형식 예외는 재포장 ✕"*.

## Pattern 2 — Tool 에러 wrap (내부 서비스)

```typescript
// Tool 내부 에러는 throw ✕ — ToolResult(isError: true) wrap
async function executeTool(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    const result = await someOperation(args)
    return { content: result, isError: false }
  } catch (err) {
    // Agent Loop 가 LLM 에 결과 전달, 자동 retry ✕ (모델 판단 위임)
    return {
      content: `Error: ${scrubText(String(err))}`,
      isError: true,
    }
  }
}
```

핵심:
- Tool 내부 에러는 `{ isError: true }` 로 wrap → LLM 다음 turn 복구 (`design-principles` §5)
- 서버 자동 retry ✕ (LLM 의사결정)
- Provider call 에러는 별도 — `provider-retry-matrix` invariant 의 분류된 retry 적용

## Tool result 절단 패턴

```typescript
const TOOL_PREVIEW_MAX_CHARS = 4000

export function truncateToolResult(content: string): string {
  if (content.length <= TOOL_PREVIEW_MAX_CHARS) return content
  return content.slice(0, TOOL_PREVIEW_MAX_CHARS) + `\n[truncated, ${content.length - TOOL_PREVIEW_MAX_CHARS} more chars]`
}
```

> head-truncate 한계: 스택 트레이스의 핵심 이유는 끝줄 — head-only 절단 시 손실. head+tail 유틸은 미래 개선 (`design-principles` §5).

## Pattern 4 — 선택적 / best-effort

```typescript
// 캐시 lookup 실패는 main flow 차단 ✕
async function getCachedProfile(userId: string): Promise<Profile | null> {
  try {
    return await kv.get(`profile:${userId}`, 'json')
  } catch (err) {
    console.warn(JSON.stringify({
      event: 'cache.get_failed',
      err: scrubText(String(err)),
    }))
    return null  // 호출자가 DB fallback
  }
}
```

## SSE 에러 이벤트

SSE 엔드포인트 에러는 `error` SSE 이벤트로 전달 ([[sse-lifecycle]] invariant + [[sse-streaming]] workflow):

- payload `message` 는 반드시 `scrubText` 적용
- `done` 이벤트로 에러 은폐 ✕ — 명시적 `error` 이벤트 emit
- abort 시는 예외 — `error` 이벤트도 emit ✕ ([[cancellation-propagation]] invariant)

## Structured Logging

`structured-log-schema` invariant — 로그 필수 필드 + scrub 정책 단일 source. 본 workflow 미보유.

- 모든 로그는 line-delimited JSON
- `scrubText = scrubPii(scrubSecrets(text))` — 응답 + 로그 양쪽 적용
- 시크릿 / API key / PII / 스택 trace raw 포함 ✕

## 금지 사항

- `catch (err) { }` (bare catch — 에러 묻힘)
- `catch (err) { console.log(err) }` 만 하고 아무 조치 없음 (`structured-log-schema` 위반)
- 에러 메시지에 시크릿 / API key 포함 (`scrubText` 의무)
- `throw` 없이 조용히 `return undefined`
- HTTP 경계 밖 (`engine` / `tools` / `services`) 에서 framework-specific HTTP exception throw — 반드시 `AppError` 하위 + routes 에서 변환
- `try/catch (err: any)` bare catch — `unknown` + type guard 또는 `instanceof` 분기
- Tool 내부 에러를 throw — `ToolResult({ isError: true })` wrap 의무
- AbortError 를 일반 error 로 처리 (`error` 이벤트 emit) — [[cancellation-propagation]] invariant
- envelope shape 임의 변경 (`{ error: { code, message } }` 고정 — [[http-error-sentinels]])

## 검증 체크리스트

- [ ] 새 에러가 4 패턴 중 어디 속하는지 분류 명확
- [ ] 예외 클래스가 `AppError` 하위 + `code` 필드 보유
- [ ] Tool 내부 에러 → `ToolResult(isError: true)` wrap (throw ✕)
- [ ] 모든 외부 노출 메시지에 `scrubText` 적용
- [ ] engine / tools / services 안에서 framework HTTP exception throw ✕
- [ ] sentinel 매핑 / envelope shape 는 `http-error-sentinels` 가 정본 (본 workflow 에 매핑 표 ✕)

## Cross-ref

- `http-error-sentinels` invariant — sentinel ↔ HTTP code 매핑 + envelope shape + route-edge 매트릭스 **정본**
- `api-routing` workflow — 전역 핸들러 구체 framework API
- `config-env-validation` invariant — `ConfigurationError` startup 검증
- `cancellation-propagation` invariant — AbortError graceful 처리
- `structured-log-schema` invariant — 로그 + scrub 정본
- `sse-lifecycle` invariant — SSE error 이벤트 종료 보장
- `provider-retry-matrix` invariant — Provider 호출의 자동 retry 분류 (Tool 에러와 다름)
