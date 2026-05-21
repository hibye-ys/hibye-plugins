---
name: runtime-verify
description: Use after any code change in backend/, before claiming a task is "done", or whenever the user says "verify", "확인", "실행해봐", or "테스트해봐". Load this skill to walk a self-contained verification workflow including unit tests, integration tests, FastAPI boot, health checks, named run POST scenarios, SSE event order checks, and log scans. Defines the 3-tier execution standard and enforces that type checks alone do not prove features work.
allowed-tools: Read, Bash, Grep, Glob
---

# runtime-verify — 실제 실행 검증 워크플로우

## 이 skill은 언제 로드되는가

- `backend/` 의 코드 변경 직후
- "완료" / "done" 주장 직전
- 사용자가 "verify", "확인", "실행해봐", "테스트해봐" 라고 함
- `/agent-verify` command 실행 시점
- 새 endpoint 또는 새 tool 추가 후
- SSE stream 동작 변경 후
- provider layer 변경 후 (mock 동작과 production 동작이 다를 수 있음)

## 핵심 원칙

> **타입 체크 / 테스트 통과 ≠ 기능 검증.**
> 실제로 기능을 써봐야 완료를 주장할 수 있다.

ruff pass + ty pass + pytest pass 는 **필요 조건**이지 충분 조건이 아니다. 이 셋이
모두 통과해도 다음 중 하나가 발생할 수 있다:

- mock fixture가 production과 다른 동작을 한다 (App 에서 `AsyncMock` 이 implausible
  response shape 를 반환하는 경우가 흔함)
- 실제 환경 변수 / 외부 서비스 의존이 빠져 있다 (`.env` 에 `ANTHROPIC_API_KEY` 없음 등)
- 통합 지점 (endpoint, SSE, stream) 에서 silent fail — exception 이 swallow 되어 pytest
  는 통과하지만 실제 요청에서는 빈 응답
- 사용자 시나리오 측면의 회귀 — 기능은 동작하지만 의도와 다름 (예: 같은 tool 을 2번 호출)

따라서 본 skill은 **3단계 실행 기준**을 강제한다. Tier 1 만 통과시키고 done 을 선언하는
것은 skill 위반.

## 3-tier Execution Standard

| Tier | 이름 | 통과 조건 | 강제 시점 |
|---|---|---|---|
| 1 | Static | ruff + ty + pytest unit + pytest integration | 모든 코드 변경 |
| 2 | Boot | dev 서버 부팅 + `/health` 200 응답 | endpoint 변경, 새 import 추가, 의존성 변경, 설정 파일 수정 |
| 3 | E2E scenario | 실제 시나리오 1개 end-to-end 동작 + SSE 이벤트 순서 검증 + ERROR/CRITICAL 로그 0개 | 새 기능 추가, 사용자 흐름 변경, provider 변경 |

**Tier 1 통과만으로는 done 결정 안 한다.** 변경 영향에 따라 Tier 2, Tier 3 까지 도달해야
한다. 아래 "변경 영향 → Tier 결정" 표로 어느 Tier 까지 가야 하는지 선택한다.

## 7-step self-contained checklist

아래 bash 블록은 **복사-붙여넣기 실행 가능**. 단계 건너뛰기 금지. 단계마다 실패 시 즉시
종료. `trap` 으로 background 프로세스 정리.

```bash
set -euo pipefail

# Step 1: ruff (Static)
ruff check backend/ || { echo "FAIL: ruff"; exit 1; }

# Step 2: ty (Static)
ty check backend/ || { echo "FAIL: ty"; exit 1; }

# Step 3: pytest unit + integration (Static)
pytest -m "unit or integration" --tb=short || { echo "FAIL: pytest"; exit 1; }

# Step 4: dev 서버 부팅 시도 (Boot)
# 백그라운드로 띄우고 5초 대기 + trap 으로 자동 정리
# uv run uvicorn (settings.json allow 의 Bash(uv *) 가 커버. bare uvicorn 은 allow 없음)
uv run uvicorn backend.main:app --port 8001 > /tmp/uvicorn.log 2>&1 &
UVICORN_PID=$!
trap "kill $UVICORN_PID 2>/dev/null || true" EXIT
sleep 5

# Step 5: /health 응답 확인 (Boot)
curl -fs http://localhost:8001/health > /dev/null \
  || { echo "FAIL: /health"; tail /tmp/uvicorn.log; exit 1; }

# Step 6: E2E POST /run/chat 시나리오 (E2E)
# 가장 작은 시나리오: {"message": "hello"} → done 이벤트 수신
# RunRequest 스키마: backend/routes/schemas.py::RunRequest (message: str, session_id?: str)
# APP_AUTH_REQUIRED=false 전제 (dev 기본값). prod 환경은 Authorization 헤더 필요 — 본 skill 범위 밖
curl -N -X POST http://localhost:8001/run/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}' \
  --max-time 30 \
  | tee /tmp/sse.log \
  | grep -q "event: done" \
  || { echo "FAIL: no done event in SSE"; tail /tmp/sse.log; exit 1; }

# Step 7: ERROR/CRITICAL 로그 검사 (E2E)
if grep -nE "(ERROR|CRITICAL)" /tmp/uvicorn.log; then
    echo "FAIL: errors in dev log"
    exit 1
fi

echo "OK: 7 steps passed"
```

## SSE 이벤트 순서 검증 (E2E 추가)

**정본: `backend/engine/stream.py::SSEEventType` (12 이벤트 고정).** core-infrastructure.md §SSE Lifecycle 이 원칙을 정의:

```
session → agent → (text | thinking | tool_call | tool_result | action | notification)* → suggestions? → usage → done | error
```

규칙:

- `session` 이 첫 이벤트, `agent` 가 두 번째 (예외 없음)
- `done` 또는 `error` 가 마지막 — 둘은 **상호 배타** (둘 다 오지 않음)
- `usage` 는 `done` 직전에 전송
- `error` 가 발생하면 그 이후 terminal event 없음 (이미 terminal)
- 과거 이름 `metadata`, `text_chunk`, `text_complete`, `tool_call_start/delta/end`, `action_started/completed`, `start`, `ping` 은 **현재 미구현 — 사용 금지**

이벤트 순서만 뽑는 awk 한 줄:

```bash
awk '/^event:/ { print substr($0, 8) }' /tmp/sse.log
```

예상 출력 (정상 — tool 사용 없는 단순 응답):

```
session
agent
text
text
text
usage
done
```

예상 출력 (정상 — tool 1회 사용):

```
session
agent
tool_call
tool_result
action
text
usage
done
```

`session` 또는 `agent` 가 없거나, `done`/`error` 둘 다 누락되거나, `done`+`error` 가 함께 오면 E2E fail.

## 선택적 superpowers 통합

`superpowers` 플러그인이 설치돼 있으면 `superpowers:verification-before-completion`
skill 과 병용 가능. 본 skill은 **superpowers를 의존하지 않는다** — 단독으로 동작.

```bash
# 선택적 추가 단계 (superpowers 설치 시에만 실행)
if [ -d "$HOME/.claude/plugins/cache/claude-plugins-official/superpowers" ]; then
    echo "(optional) superpowers detected — consider also running"
    echo "           superpowers:verification-before-completion for"
    echo "           the evidence-before-assertion discipline."
fi
```

superpowers 가 **없어도** 본 skill 의 7-step 은 완전히 실행된다. 의존성 0.

## 변경 영향 범위 → Tier 결정

| 변경 유형 | Static | Boot | E2E |
|---|:-:|:-:|:-:|
| 단일 함수 내부 로직 수정 | 필수 | - | - |
| 새 import / 모듈 분리 | 필수 | 필수 | - |
| 새 endpoint 추가 | 필수 | 필수 | 필수 |
| 새 기능 (사용자 가시) | 필수 | 필수 | 필수 |
| 설정 파일 (pyproject, settings.json) | 필수 | 필수 | - |
| 테스트만 변경 | 필수 | - | - |
| 문서만 변경 | - | - | - |

"이번엔 작은 변경이라 boot 는 생략" 식의 우회는 **거부한다.** 이 표의 기준에 맞춰라.
애매하면 한 Tier 위로 올린다 (안전한 쪽). 예를 들어 "설정 파일 수정 같은데 사실상 새
import 추가" 면 두 행 모두 해당되므로 더 높은 Tier (Boot + E2E가 포함된 쪽) 를 택한다.

이 표는 단순히 "어느 커맨드를 돌릴 것인가" 의 가이드가 아니라, **어느 Tier 에 도달하지
않으면 done 을 주장할 수 없는가** 의 가이드다. Tier 미달로 done 주장 시 skill 위반.

## 자주 보는 함정

1. **mock fixture 와 production 차이**
   `AsyncMock` 이 스트리밍 generator 대신 단일 return_value 를 반환하도록 잘못 설정돼
   있으면 unit test 는 통과하지만 실제 provider 호출은 async iterator 를 돌리지 못해
   silent hang. Tier 3 E2E 가 잡는다 — Tier 1 으로는 영영 못 잡는다. 이 이유 때문에
   `testing-infra` skill 은 factory-fixture 패턴을 강제한다 (scripted ProviderEvent
   list → async generator yield). 그래도 production 과 1:1 동치는 아니므로 E2E 필수.

2. **dev 서버가 겉보기엔 부팅하지만 첫 요청에 죽음**
   `/health` 는 import 시점 / app 초기화 에러만 잡는다. Tool registry 나 provider 는
   lazy init 일 수 있어서 첫 `/run/<name>` 호출 때 처음 로드된다. Tier 3 E2E
   (`/run/chat` 호출) 까지 가야 발견된다. Tier 2 통과만으로 done 선언 금지. `/health`
   는 "import breakage 없음" 만 증명할 뿐, "기능 작동" 을 증명하지 않는다.

3. **SSE 종료 이벤트 누락**
   `done` 또는 `error` 가 안 오면 클라이언트는 stream 이 살아 있다고 믿고 hang. curl
   `--max-time 30` + `grep -q "event: done"` 이 이 케이스를 잡는다. awk 이벤트 순서
   검증 없이는 "metadata 만 오고 끝났다" 같은 더 미묘한 버그는 못 잡는다. tool 을 쓴
   응답이라면 `action_completed` 가 `action_started` 와 페어링 되는지도 반드시 확인.

## 보고 형식 (사용자에게 결과 전달)

7-step 실행 후 결과 보고는 다음 형식으로:

```
Tier 1 Static:
  ruff: PASS
  ty: PASS
  pytest unit+integration: PASS (N tests)

Tier 2 Boot:
  uv run uvicorn --port 8001: PASS (booted in 5s)
  /health: PASS (200)

Tier 3 E2E:
  POST /run/chat: PASS (done event received)
  SSE order: session → agent → text*N → usage → done (valid)
  ERROR/CRITICAL log scan: PASS (0 occurrences)

Verdict: done-eligible.
```

실패 시 어느 Tier / 어느 Step 에서 실패했는지 명시하고, 관련 로그 tail 을 첨부한다.
"대충 Boot 는 통과" 같은 모호한 보고 금지.

## 절대 금지

- **"타입체크 / pytest 통과했으니 done" 주장** (Static-only). 이 skill 의 존재 이유가
  바로 이 주장을 거부하는 것.
- **E2E 를 mock 으로 대체** — 그건 integration test 다. E2E 는 실제 uvicorn + 실제
  curl + 실제 SSE 여야 한다.
- **ERROR 로그를 "원래 그런 것" 으로 무시** — Step 7 에서 잡힌 ERROR/CRITICAL 은 반드시
  원인 규명. "무해한 로그" 라는 주장은 근거 없이 받지 않는다.
- **`/health` 만 보고 boot 통과 선언** — health 는 lazy init 를 타지 않는다. 반드시
  `POST /run/<name>` 1회 까지 도달.

## 종료 조건

위 7-step + (필요 시) SSE 순서 검증을 모두 통과하면 done 선언 가능. 하나라도 실패하면
원인 식별 후 재실행. 같은 실패가 **3회 연속** 이면 `/agent-debug` 로 전환 — 그 이상
반복해도 같은 정보만 나온다.

"통과" 기준은 위 7단계의 stdout 이 `OK: 7 steps passed` 로 끝나는 것. 부분 통과 (예:
Step 1~5 통과, Step 6 에서 `done` 이벤트 누락) 는 통과가 아니다.
