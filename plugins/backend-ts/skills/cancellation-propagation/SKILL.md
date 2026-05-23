---
name: cancellation-propagation
description: <api-app> 의 모든 비동기 호출 체인에 적용되는 정본 invariant. 라우트 → engine → provider/tool/storage 까지 AbortSignal end-to-end 전파, 자식 sub-agent 로 cascade (AbortSignal.any), AbortError graceful 처리 (error 이벤트 emit 금지), 외부 SDK 가 signal 미지원 시 timeout 보강. 누락 시 클라이언트 disconnect 후에도 비용 발생.
metadata:
  role: invariant
  scope: project
---

# Cancellation Propagation — 언어 무관 불변식

> Language-neutral invariants — AbortSignal end-to-end propagation, AbortError 처리 규약.
> 정본 (single source of truth) — 분산된 abort 룰을 한 곳으로.

## 핵심 원칙

**클라이언트 disconnect = 즉시 모든 하위 작업 abort**. signal 이 전파되지 않으면 (1) 토큰 비용 누수 (2) DB connection 점유 (3) 외부 API rate limit 소모.

## 1. 진입점 — 라우트가 signal 생성

```typescript
// src/routes/run.ts (framework-neutral pseudo)
app.post('/run/:name', async (ctx) => {
  const abortController = new AbortController()

  // 클라이언트 disconnect → controller.abort()
  // framework 별 abort signal 리스너 등록 (instance 측 project-local skill 참조)
  // 예: `<framework request abort signal>(ctx).addEventListener('abort', () => abortController.abort())`
  //     또는 stream.onAbort(() => abortController.abort())

  for await (const event of runAgentLoop({
    // ...
    signal: abortController.signal,  // 의무
  })) { /* emit */ }
})
```

- abort signal 은 **항상 첫 번째 또는 명시적 named 인자** (`signal: AbortSignal`)
- 라우트가 signal 을 만들지 *않고* 외부에서 받는 경우도 가능 (Cron / scheduled trigger 등)

## 2. 전파 의무 — engine → provider/tool/storage

`runAgentLoop` 가 받은 signal 은 **모든 하위 호출에 인자로 전달**:

```typescript
async function runAgentLoop(opts: { signal: AbortSignal; ... }) {
  // provider call
  await provider.callStream({ ..., signal: opts.signal })

  // tool execution
  await dispatchToolCalls(toolUses, registry, {
    ...ctx,
    cancelSignal: opts.signal,
  })

  // storage write
  await writeCoordinator.write({ ..., signal: opts.signal })
}
```

**금지**: signal 받지 않고 자체 생성 (`new AbortController()`) 후 사용 — 부모 abort 전파 끊김.

## 3. Sub-agent cascade — AbortSignal.any

자식 sub-agent 는 부모 signal + 자체 timeout signal 결합:

```typescript
// src/engine/subagent.ts
async function runChildAgent(opts: { parentSignal: AbortSignal; timeoutMs: number }) {
  const combined = AbortSignal.any([
    opts.parentSignal,
    AbortSignal.timeout(opts.timeoutMs),
  ])
  return runAgentLoop({ signal: combined, ... })
}
```

- `AbortSignal.any([...])` 는 ES2024+ — 일부 runtime 에서 polyfill 필요 (runtime-specific, instance 측 project-local skill 참조)
- `spawn-limits` invariant 의 "abort signal cascade" 와 동일

## 4. AbortError graceful 처리

abort 는 **에러가 아닌 정상 종료**. error 이벤트 emit ✕, error 로그 ✕:

```typescript
try {
  await operation({ signal })
} catch (err) {
  if (isAbortError(err)) {
    // graceful — 정상 종료
    deps.trace({ transition: 'aborted' })
    return
  }
  // 진짜 에러만 처리
  throw err
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError'
      || (err as { code?: string }).code === 'ABORT_ERR'
      || (err as { code?: string }).code === 'ERR_CANCELED'
  }
  return false
}
```

- SSE 응답에서 abort 시 `error` SSE 이벤트 emit ✕ (이미 클라이언트가 끊은 상태)
- `sse-lifecycle` invariant 의 "done 누락" 검증은 abort 케이스 제외 (transition='aborted' 기록만)

## 5. 외부 SDK signal 미지원 시 — 보호 패턴

일부 외부 SDK (legacy) 가 `AbortSignal` 인자를 받지 않으면 두 가지 우회:

### Option A: Promise.race + timeout
```typescript
const result = await Promise.race([
  legacySdk.call(args),
  new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  }),
])
```

### Option B: timeout wrapper
```typescript
const timeoutMs = 60_000
const result = await Promise.race([
  legacySdk.call(args),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
])
```

**SDK 가 중간 cancel 불가능한 경우** (예: 진행 중인 외부 미디어 변환):
- best-effort 표시 — `media-job-lifecycle` invariant 의 "canceled = soft signal" 패턴 따름
- `canceled` 상태만 set, 외부 호출은 자연 완료 또는 timeout 까지 진행

## 6. Storage write 의 abort 처리

`single-writer` invariant 의 atomic write 와 결합:

- abort 가 atomic rename **전** → tmp 파일 unlink 후 throw
- abort 가 atomic rename **후** → 이미 commit. 정상 처리 (revert ✕)
- DB transaction 안 abort → automatic rollback (`db.transaction` 내부)

```typescript
await db.transaction(async (tx) => {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError')
  // ... mutations
})  // signal aborted 면 자동 rollback
```

## 7. Background task (spawn) 의 abort

`background` mode sub-agent 는 부모 signal 과 **분리** (의도적):
- 부모가 abort 되어도 background spawn 은 계속 실행
- background 자체의 timeout 또는 명시적 cancel API 로만 중단

`foreground` / `in_process` mode 는 부모 signal cascade (위 §3).

## 공통 금지 사항

- 비동기 함수가 signal 인자를 받지 않음 (engine → provider/tool/storage 체인 어느 곳도 signal 끊김 ✕)
- signal 받았는데 하위 호출에 전달 안 함 (전파 끊김)
- `new AbortController()` 자체 생성 후 부모 signal 무시 (cascade 끊김 — Cron 등 진입점 예외)
- AbortError 를 일반 error 로 처리 (error 이벤트 emit / error 로그)
- SSE `error` 이벤트로 abort 표시 (transition='aborted' + done 미emit 으로)
- 외부 SDK signal 미지원 인데 timeout 보호 없음 (무한 대기 위험)
- `signal.aborted` 체크 누락 후 무거운 동기 연산 진행
- background task helper (runtime-specific) 안에서 부모 signal 받음 (background 는 의도적 분리)
- abort 발생 시 partial result 를 외부 storage 에 commit (atomic rename 전 unlink 의무)

## 영향도

| 변경 | 영향받는 곳 |
|---|---|
| signal 인자 시그니처 변경 | 모든 provider / tool / storage 호출 체인 동시 갱신 |
| `AbortSignal.any` 사용 | runtime polyfill 필요 여부 검증 (instance 측 project-local skill) |
| `isAbortError` 패턴 변경 | engine / SSE / sub-agent 의 catch 블록 일괄 갱신 |
| background mode signal 분리 정책 변경 | `sub-agent` workflow + `spawn-limits` invariant 동시 갱신 |

## Cross-ref

- `agent-loop-invariants` invariant — LoopTransition `aborted` 값
- `sse-lifecycle` invariant — abort 시 종료 (done/error 미emit, 연결 drop 만 허용 예외)
- `sse-streaming` workflow — `stream.onAbort` 리스너 등록
- `sub-agent` workflow — foreground/in_process/background mode 의 signal 처리
- `spawn-limits` invariant — abort cascade (AbortSignal.any)
- `media-job-lifecycle` invariant — soft cancel (외부 SDK 중단 불가 케이스)
- `single-writer` invariant — atomic write 와 abort 결합
