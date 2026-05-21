---
name: debug-session
description: "apps/api 에서 무언가 깨졌는데 원인을 모를 때 invoke. Vitest 실패 / agent loop hang / tool not firing / context window exceeded / wrangler dev 500 / 사용자가 '왜 안 돼' · 'stuck' · 'debug me' 라고 할 때. Hono+Workers 특화 단서 포함 5단계 디버깅 워크플로를 제공한다."
metadata:
  role: workflow
  scope: apps/api
  shadows: core/debug-session
  source: stack-backend-python/skills/debug-session/SKILL.md
---

**적용된 §4.4 매트릭스 행**: `LOG_LEVEL=DEBUG uvicorn ...` → `wrangler dev --log-level debug`, `pytest --lf -x --tb=short` → `vitest run --reporter=verbose` / `vitest run <file> -t <name>`, `logs/ai_backend.log` (파일 경로) → `wrangler dev` stderr + `console.error/warn` JSON 라인, `FastAPI POST /run/<name>` 요청 로그 → `wrangler dev` 요청 로그 + `X-Request-Id` 헤더, `python -c "import os..."` 환경변수 확인 → `wrangler types` + `.dev.vars` 확인, `asyncio.CancelledError` 패턴 → AbortError + `signal.aborted` 체크

# debug-session — Hono + Workers 디버깅 워크플로

## 이 skill은 언제 invoke 되는가

- Vitest 실패 (단일 또는 여러)
- agent loop hang / 무한 루프 / 5초 넘게 응답 없음
- "tool not firing" / "tool 결과가 안 옴" / action_completed 이벤트 누락
- "context window exceeded" / max_tokens 초과
- `wrangler dev` 5xx (특히 `POST /run/<name>` 500)
- 사용자가 "왜 안 돼" / "stuck" / "debug me" / "디버깅 좀" 라고 함

## Debug Session의 정체성

Hono + Workers 디버그는 **5단계로 표준화**돼 있다. 순서 지키기. 역순으로 하면 안 된다. 증상 → 로그 → 재현 → 설계 대조 순.

1. **디버그 로깅이 켜져 있는지** 확인 (`wrangler dev` 로그 레벨)
2. **로그 tail** (wrangler dev stderr + JSON 라인 grep)
3. **Vitest 실패면 traceback 파싱** (`vitest run --reporter=verbose`)
4. **요청/응답 로그 위치** 확인 (`X-Request-Id` 추적)
5. **설계 문서 조회** 로 의도된 동작 확인 (증상 → 서브시스템 매핑)

## Step 1 — 디버그 로깅 활성화 확인

```bash
# .dev.vars 에 LOG_LEVEL 설정 여부 확인
grep -E "^LOG_LEVEL" apps/api/.dev.vars 2>/dev/null || echo "no LOG_LEVEL in .dev.vars"

# wrangler dev 를 verbose 모드로 재시작
wrangler dev --log-level debug
```

> **`.dev.vars` 파일은 직접 수정 가능** — Workers 환경변수 확인은 `wrangler types`로. `process.env` 접근은 Workers에서 동작하지 않음 — 항상 `c.env.<KEY>` 사용. `verify-workers-compat` invariant 참조.

기본 `LOG_LEVEL` 미설정이면 디버그 정보 부족 — Stage 전환, tool_use delta, provider retry 같은 중요한 흐름이 찍히지 않는다.

## Step 2 — 로그 tail

Workers 환경에서 로그는 파일이 아닌 stdout/stderr 스트림으로 출력된다.

| 상황 | 접근 |
|---|---|
| `wrangler dev` 실행 중 | 터미널 stdout/stderr 직접 확인 |
| JSON 로그 라인 | `console.error(JSON.stringify({...}))` — wrangler dev stderr |
| Vitest 테스트 | `vitest run -r verbose` 터미널 출력 |

```bash
# wrangler dev 를 파이프로 로그 필터링 (별도 터미널)
wrangler dev 2>&1 | grep -E '"level":"(error|warn)"'

# JSON 로그 라인 파싱
wrangler dev 2>&1 | grep '^{' | jq 'select(.level == "error" or .level == "warn")'
```

Workers 환경에서 로그 파일은 없다. `tail -f` 대신 `wrangler dev` 터미널을 직접 본다.

## Step 3 — Vitest 실패 traceback 파싱

```bash
# 마지막 실패한 테스트, verbose 출력
vitest run --reporter=verbose 2>&1 | tail -n 80

# 특정 파일 단독 실행
vitest run apps/api/src/engine/loop.test.ts --reporter=verbose

# 특정 테스트 이름 매칭
vitest run -t "single turn echo" apps/api/src/engine/loop.test.ts
```

traceback에서 반드시 봐야 할 3가지:

1. **첫 번째 user code 프레임** — `apps/api/src/` 안의 첫 줄로 점프. 라이브러리 내부 스택에 끌려 들어가면 시간 낭비.
2. **assertion 메시지** — `expect(actual).toBe(expected)` diff.
3. **fixture 에러 vs test body 에러** — `beforeEach`/`beforeAll` 안에서 throw이면 **setup 문제**, test body에서 throw이면 **implementation 문제**.

```bash
# Workers 호환 테스트 환경 (Miniflare 기반)
vitest run --environment miniflare

# 단독 테스트 케이스
vitest run apps/api/src/engine/loop.test.ts -t "tool_use loop"
```

## Step 4 — 요청/응답 로그 위치 (X-Request-Id 추적)

`wrangler dev` 5xx 또는 `/run/<name>` 이상 동작은 요청 단위로 추적한다. `requestIdMiddleware`가 모든 요청에 `X-Request-Id`를 붙이고, 이후 모든 단계 로그가 같은 ID로 묶인다.

```bash
# wrangler dev 터미널에서 최근 POST /run/<name> 요청 확인
# (터미널 스크롤 또는 tee 로 파일 캡처)
wrangler dev 2>&1 | tee /tmp/wrangler-dev.log

# 별도 터미널에서 request-id 추적
REQUEST_ID="<X-Request-Id 값>"
grep "$REQUEST_ID" /tmp/wrangler-dev.log
```

`/run/<name>` (SSE 스트림)은 한 요청 = 여러 이벤트. 이벤트 순서가 의심스러우면:

```bash
grep "$REQUEST_ID" /tmp/wrangler-dev.log | grep -oE '"event":"[a-z_]+"'
```

순서가 `session → agent → (text | thinking | tool_call | tool_result | action | notification)* → (usage)? → (done | error)` 를 벗어나면 SSE streaming 버그 의심. `sse-streaming` skill 참조.

## Step 5 — 설계 문서 조회

증상이 어느 서브시스템에 속하는지 식별한 뒤, 해당 skill을 참조한다. **증상 → 서브시스템 → skill** 매핑표:

| 증상 | 의심 서브시스템 | 참고 skill |
|---|---|---|
| tool_use 무한 루프 / 같은 tool 반복 호출 | Agent Loop Stage 5/6 | `agent-loop` skill |
| context window exceeded / 토큰 폭증 | Context Assembly | `context-assembly` skill |
| SSE stream 끊김 / `done` 이벤트 누락 | SSE Streaming | `sse-streaming` skill |
| 429 / 529 / provider retry 폭주 | Provider Layer | `provider-layer` skill |
| `c.env undefined` / 시크릿 누락 | Workers 환경변수 | `auth` skill + `verify-workers-compat` invariant |
| MCP tool not registered / MCP server disconnected | MCP Integration | `mcp-integration` skill |
| spawn depth exceeded / 무한 agent 재귀 | Sub-agent | `sub-agent` skill + `spawn-limits` invariant |
| Vitest mock/fixture 누수 | Test 인프라 | `workers-compat` invariant |

## Hono + Workers 특화 단서

일반적인 Node.js/Python 경험으로는 잡히지 않는 Workers 고유 패턴:

### c.env undefined

- `wrangler.toml`에 binding 선언 확인
- `.dev.vars`에 로컬 값 설정 확인
- `wrangler dev` 재시작 (환경변수 변경 후 반드시)
- TypeScript `Env` type에 binding 추가 확인

### setInterval / setTimeout 폭주

Workers는 요청 단위로 런타임이 생성된다. `setInterval`을 전역 레벨에서 호출하면 요청마다 새 interval이 생성되어 누수. **SSE heartbeat는 `stream.sleep(ms)` 사용** (`sse-streaming` skill 참조).

### AbortError 처리

클라이언트 연결 끊김 = `AbortError`. `stream.onAbort(() => ...)` 로 cleanup. `try/catch`에서 `err instanceof DOMException && err.name === 'AbortError'` 분기.

```typescript
// AbortError 확인
function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR')
  )
}
```

### CPU time limit 초과

Workers는 CPU time 50ms/요청 (default). 무거운 동기 계산이 있으면 `await scheduler.yield()` (Cloudflare 전용) 또는 Durable Objects(비권장) 이외의 방법을 검토. **대부분의 경우 외부 API 호출(await) + 결과 처리면 CPU time 안에 들어온다**.

### process.env 접근

`process.env.X`는 Workers에서 `undefined` 반환. `c.env.X` 사용. `verify-workers-compat` invariant 위반.

## 자주 보는 증상별 first move

| 증상 | 첫 명령 | 다음 단계 |
|---|---|---|
| Vitest 1개 실패 | `vitest run -t "<name>" --reporter=verbose` | Step 3 traceback 파싱 → user frame 점프 |
| Vitest 다수 실패 | `vitest run --reporter=verbose 2>&1 \| head -100` | 패턴 식별 (공통 fixture? import?) |
| wrangler dev 500 | `wrangler dev 2>&1 \| tee /tmp/wrangler-dev.log` | Step 2 → Step 4 (request-id 추적) |
| agent hang / 응답 없음 | `wrangler dev --log-level debug` 재시작 | Stage 로그 확인 → AbortError 체크 |
| tool not firing | JSON 로그에서 `"event":"tool_call"` 검색 | Step 5 (`agent-loop` Stage 4 tool discovery) |
| c.env undefined | `.dev.vars` + `wrangler.toml` binding 확인 | `wrangler dev` 재시작 |

## 디버그 종료 기준

다음 3개 모두를 만족하면 디버그 종료 (ANY가 아니라 ALL):

1. **근본 원인을 1문장으로 설명할 수 있다.** "Stage 5가 tool_use 블록을 content 배열로 flatten하지 않아서 provider가 빈 input으로 두 번째 호출을 만들고 무한 루프" 같은 식.
2. **재현 가능한 최소 케이스** — `vitest run` 명령 1줄 또는 `curl` 명령 1줄.
3. **fix 또는 workaround가 코드로 표현돼 있다** — diff로 볼 수 있거나 적어도 파일 + 라인 번호로 특정됨.

"고친 것 같다"는 종료 사유가 아니다. 증상이 사라진 이유를 설명 못하면 다시 나온다.

## 재현 케이스 만드는 법

- **Vitest 재현**: `vitest run apps/api/src/engine/loop.test.ts -t "tool_use loop"`
- **curl 재현**: `curl -N -X POST http://localhost:8787/run/chat -H 'Content-Type: application/json' -d '{"message":"hi"}'` → `event: done` 을 기다리는데 5초 뒤 stream 종료
- **script 재현**: 위 둘로 안 되면 TypeScript 파일 10줄 이하로 축약

세 재현 방식 중 **가장 작은 것** 을 고른다. 재현 없이 "그냥 고쳐봄"은 금지 — 버그가 다시 나온다.

## 절대 하지 말 것

- **`.dev.vars` 에 시크릿 커밋** — `.gitignore`에 반드시 포함. `auth` skill 체크리스트 참조
- **`process.env` 접근** — Workers에서 undefined 반환. `c.env.<KEY>` 사용
- **전역 `setInterval`** — Workers 요청마다 누수. `stream.sleep()` 또는 Cron Trigger 사용
- **디버그 로그를 production에 영구 활성화** — 성능 저하 + 민감 정보 leak 위험
- **Vitest fixture 에러를 production 코드 변경으로 회피** — fixture 문제는 fixture에서 고친다
