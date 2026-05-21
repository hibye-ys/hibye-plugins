---
name: sse-streaming
description: Hono route 에서 SSE 응답 추가 / 기존 SSE 핸들러 수정 시 invoke. streamSSE() 헬퍼 + ReadableStream + waitUntil 패턴, secret scrub, done/error 종료 보장 가이드. SSE stream 끊김, done 이벤트 누락, 시크릿 노출 증상 디버깅 시에도 invoke.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/skills/sse-streaming + rules/sse-streaming-patterns.md
---

**적용된 §4.4 매트릭스 행**: `EventSourceResponse(ping=15)` → `streamSSE(c, async (stream) => { ... })` (hono/streaming), `async generator yield event` → `await stream.writeSSE({ data, event, id })`, heartbeat = `stream.sleep(15_000)` + `stream.writeSSE({ event: 'heartbeat' })` loop (Workers `setInterval` ✕), close = `stream.onAbort(() => ...)`, `pydantic BaseModel` → `z.object` / TypeScript 타입, `asyncio.CancelledError` → `stream.onAbort` callback, `structlog` → `console.error` + JSON, `os.getenv` → `c.env`

# sse-streaming — SSE 응답 청사진

## 이 skill은 언제 invoke 되는가

- `src/routes/run.ts` 의 SSE 핸들러 최초 작성 / 이벤트 타입 추가 / scrub 패턴 튜닝
- "SSE stream 이 중간에 끊어진다" 증상
- "클라이언트가 `done` 이벤트를 못 받는다" 증상
- "text 이벤트에 시크릿이 노출됐다" 사고
- "tool_use 가 SSE forward 는 되는데 tool executor 에서 empty"

## SSE Streaming 의 정체성

`/run/:name` 엔드포인트 중 `policy.sse=true` 인 run 은 Agent Loop 의 진행 상황을 SSE 로 전송한다. 이 계층의 4가지 책임:

1. **이벤트 변환** — Agent Loop 가 yield 하는 내부 Event 를 SSE wire format (`event: <name>\ndata: <json>\n\n`) 으로 직렬화
2. **flush 타이밍** — `stream.writeSSE` 는 즉시 flush. 느린 클라이언트는 `stream.onAbort` 로 감지
3. **secret scanning** — `SCAN_EVENTS` (7 이벤트) 발신 전 `scrubDict()` 통과 의무
4. **종료 보장** — `done` 또는 `error` 이벤트가 반드시 마지막에 단 한 번 전송

## 12 SSE 이벤트 집합

| event | 시점 | 주요 payload 필드 | scrub 대상? |
|---|---|---|---|
| `session` | 스트림 시작 첫 이벤트 | `session_id: string` | ✗ |
| `agent` | resolved agent/model 메타 | `agent: string, model: string` | ✗ |
| `text` | LLM text delta | `text: string` | ✅ |
| `thinking` | extended-thinking block | `text: string` | ✅ |
| `tool_call` | tool_use block (이름 + 최종 input) | `name: string, final_input: object` | ✅ (dict 재귀) |
| `tool_result` | 도구 실행 완료 | `tool_name, result, is_error` | ✅ (dict 재귀) |
| `action` | 구조화된 action 요약 | `result_summary: string` | ✅ |
| `notification` | background spawn 완료 등 | free-form object | ✅ (dict 재귀) |
| `suggestions` | 후속 제안 | `prompts: string[]` | ✗ |
| `usage` | 토큰 / 비용 — `done` 직전 | `input_tokens, output_tokens, cost_usd` | ✗ |
| `done` | 정상 종료 (error 와 배타) | `turn_count` 등 | ✗ |
| `error` | 비정상 종료 (done 과 배타) | `code: string, message: string` | ✅ (message only) |

```typescript
// src/sse/stream.ts
export type SSEEventType =
  | 'session' | 'agent' | 'text' | 'thinking'
  | 'tool_call' | 'tool_result' | 'action' | 'notification'
  | 'suggestions' | 'usage' | 'done' | 'error'

export const SCAN_EVENTS = new Set<SSEEventType>([
  'text', 'thinking', 'tool_call', 'tool_result',
  'action', 'error', 'notification',
])
```

## streamSSE — Hono 핸들러 패턴

```typescript
// src/routes/run.ts
import { streamSSE } from 'hono/streaming'
import { serializeSSE, scrubEventPayload } from '../sse/stream.ts'

app.post('/run/:name', async (c) => {
  const runName = c.req.param('name')
  const sessionId = c.req.header('X-Session-Id') ?? newHexId()

  // HTTP 헤더로 session-wide 메타 전달 (SSE payload 혼합 금지)
  c.header('X-App-Session-Id', sessionId)
  c.header('X-App-Agent', runName)

  return streamSSE(c, async (stream) => {
    let doneSeen = false

    stream.onAbort(() => {
      // 클라이언트 disconnect — error 발송 금지 (받을 대상 없음)
    })

    try {
      for await (const [eventType, payload] of runAgentLoop({ sessionId, runName, env: c.env })) {
        if (eventType === 'done' || eventType === 'error') doneSeen = true

        const data = SCAN_EVENTS.has(eventType as SSEEventType)
          ? scrubEventPayload(eventType, payload)
          : payload

        await stream.writeSSE({
          event: eventType,
          data: JSON.stringify(data, null, 0),
        })
      }
    } catch (err) {
      doneSeen = true
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ code: 'InternalError', message: 'loop terminated' }),
      })
    } finally {
      if (!doneSeen) {
        // 비정상 종료 — error 합성 (done 합성 아님)
        try {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ code: 'InternalError', message: 'loop terminated without done/error' }),
          })
        } catch {
          // 이미 disconnect — silent swallow
        }
      }
    }
  })
})
```

## Heartbeat (Workers 환경)

Workers 에서 `setInterval` 은 지원되지 않는다. heartbeat 는 `streamSSE` 내부에서 `stream.sleep()` + inline 패턴으로 구현:

```typescript
// SSE 라우트 안 inline heartbeat 패턴 (별도 generator wrapper 불필요)
return streamSSE(c, async (stream) => {
  const heartbeatIntervalMs = 15_000

  // 장기 streaming 이 예상되는 경우 Promise.race 로 heartbeat 삽입
  // (단순한 경우 — 이벤트 흐름이 heartbeat 간격보다 빠르면 생략 가능)
  for await (const [eventType, payload] of runAgentLoop({ ... })) {
    await stream.writeSSE({ event: eventType, data: JSON.stringify(payload) })
  }

  // heartbeat 가 별도로 필요한 경우 (producer 중단 가능성 있을 때):
  // Promise.race([nextEvent(), stream.sleep(heartbeatIntervalMs)]) 패턴 사용
  // stream.sleep() 은 Workers-safe (setInterval ✕)
})
```

> **`withHeartbeat` generator wrapper 는 사용하지 않는다** — passthrough 만 하는 stub 은 동작 보장 ✕. `stream.sleep()` 직접 패턴이 명확하고 안전.

## Secret Scanner

```typescript
// src/sse/scrub.ts
const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9]{20,}/g, '[REDACTED-SK]'],
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED-AKIA]'],
  [/ghp_[A-Za-z0-9]{36,}/g, '[REDACTED-GHP]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED-PEM]'],
  [/AIza[0-9A-Za-z\-_]{35}/g, '[REDACTED-AIKEY]'],
  [/xox[baprs]-[0-9A-Za-z\-]{10,}/g, '[REDACTED-SLACK]'],
  [/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, '[REDACTED-JWT]'],
]

export function scrubSecrets(text: string): string {
  let result = text
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

export function scrubDict(obj: unknown): unknown {
  if (typeof obj === 'string') return scrubSecrets(obj)
  if (Array.isArray(obj)) return obj.map(scrubDict)
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = scrubDict(v)
    }
    return out
  }
  return obj
}

export function scrubEventPayload(eventType: string, payload: unknown): unknown {
  if (eventType === 'error') {
    // message 필드만 scrub
    const p = payload as Record<string, unknown>
    return { ...p, message: typeof p.message === 'string' ? scrubSecrets(p.message) : p.message }
  }
  return scrubDict(payload)
}
```

## HTTP 헤더 분리 원칙

세션 수명 동안 불변인 메타 정보는 HTTP response 헤더로 전달. SSE payload 혼합 금지.

| 헤더 | 값 | 시점 |
|---|---|---|
| `X-App-Session-Id` | session_id | 스트림 시작 |
| `X-App-Model` | resolved model id | 스트림 시작 |
| `X-App-Agent` | agent_spec.name | 스트림 시작 |

CORS `expose_headers` 에 위 헤더 + `X-Request-Id` 포함 필수 (프론트엔드 JS 에서 읽기 위해).

## 동시성 함정

1. **stream tee 누락** → tool_use 가 SSE 에는 흐르지만 tool executor 는 empty. `provider-layer` skill §tee 참조.
2. **`scrubDict` 없이 tool_call/tool_result payload 직접 write** → dict 안쪽 시크릿 통과.
3. **Workers에서 setInterval** → `setInterval` Workers compat 위반. `stream.sleep()` + loop 사용.
4. **`onAbort` 후 writeSSE** → abort 된 stream 에 쓰기 → error throw. `onAbort` 콜백에서 상태 플래그 세팅 후 guard.
5. **종료 경로 중복 합성** → engine 와 route 양쪽에서 `done`/`error` 합성 → 이중 종료.

## 검증 체크리스트

- [ ] 12 이벤트 타입 모두 `SSEEventType` union 에 명시
- [ ] `SCAN_EVENTS` 가 정확히 7개
- [ ] `stream.writeSSE({ event, data })` 로 wire format 생성
- [ ] `stream.onAbort` 로 disconnect 처리 (setInterval 사용 안 함)
- [ ] `scrubSecrets` 가 7 패턴 커버
- [ ] `scrubDict` 로 `tool_call.final_input` + `tool_result` + `notification` 재귀 스캔
- [ ] HTTP 헤더로 session_id / model / agent 분리
- [ ] CORS `expose_headers` 에 X-App-* 헤더 포함
- [ ] `doneSeen` 플래그 + finally 안전망으로 **error 합성** (done 합성 금지)
- [ ] `sse-lifecycle` invariant 의 12 이벤트 순서 준수

## 구현 중 막히면

- "stream 이 중간에 끊긴다" → Workers 15초 CPU time 한계 확인. `waitUntil` 또는 Durable Object 고려
- "tool_use 가 SSE 에는 흐르는데 executor empty" → stream tee 패턴 누락. `provider-layer` skill §tee 참조
- "client 가 done 못 받음" → finally 안전망 확인. engine 밖에서 terminal 이벤트 합성 중인지 확인
- "시크릿이 payload 에 노출됨" → `SCAN_EVENTS` 중 하나에 누락. `scrubDict` 재귀 경로 확인
- "session_id / model 을 payload 에 넣고 싶다" → HTTP 헤더 분리 원칙 위반
