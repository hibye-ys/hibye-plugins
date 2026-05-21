---
name: debug-session
description: Use when something is broken and you don't know why — pytest failures, agent loop hangs, "tool not firing", "context window exceeded", "the dev server returns 500", or anywhere the user says "왜 안 돼" / "stuck" / "debug me". Load this skill to walk a deterministic 5-step debug workflow including verbose logging, log grep, pytest traceback parsing, request log lookup, and rule index checks. Also use when you need to enable App debug logging or find canonical log file paths.
allowed-tools: Read, Grep, Glob, Bash
---

# debug-session — 디버그 워크플로우

## 이 skill은 언제 로드되는가

- pytest 실패 (단일 또는 여러)
- agent loop hang / 무한 루프 / 5초 넘게 응답 없음
- "tool not firing" / "tool 결과가 안 옴" / action_completed 이벤트 누락
- "context window exceeded" / `max_tokens` 초과
- dev 서버 5xx (특히 `POST /run/<name>` 500)
- 사용자가 "왜 안 돼" / "stuck" / "debug me" / "디버깅 좀" 라고 함
- `/agent-debug` command 실행 시점

## Debug Session의 정체성

App 디버그는 **5단계로 표준화**돼 있다. 순서 지키기. 순서 건너뛰면 잘못된 가설로
시간 낭비하고, 증상-원인이 뒤엉켜서 나중에 누구도 재현 못한다.

1. **디버그 로깅이 켜져 있는지** 확인 (또는 env var로 임시 켜기)
2. **로그 파일 tail** (마지막 20줄 + ERROR/WARN grep)
3. **pytest 실패면 traceback 파싱** (`pytest --lf -x --tb=short`)
4. **FastAPI 요청/응답 로그 위치** 확인 (session_id 추적)
5. **설계 문서 조회** 로 의도된 동작 확인 (증상→서브시스템 매핑)

"어디서 막혔는지 먼저 파악한 다음에 추측한다." 역순으로 하면 안 된다. 증상 → 로그 →
재현 → 설계 대조 순.

## Step 1 — 디버그 로깅 활성화 확인

```bash
# .env 에 LOG_LEVEL / DEBUG 가 설정돼 있는가
grep -E "^(LOG_LEVEL|DEBUG)" .env 2>/dev/null || echo "no .env LOG_LEVEL/DEBUG"

# 현재 런타임의 실제 LOG_LEVEL
python -c "import os; print('LOG_LEVEL=', os.getenv('LOG_LEVEL', 'INFO'))"
```

기본 `LOG_LEVEL=INFO` 면 디버그 정보 부족 — Stage 전환, tool_use delta, provider retry 같은
중요한 흐름이 찍히지 않는다. 필요 시 **일시적으로** ENV로만 활성화:

```bash
# 한 세션만 DEBUG 레벨로 실행 (재부팅 시 원상 복귀)
LOG_LEVEL=DEBUG uvicorn backend.main:app --reload
```

> **`.env` 파일은 절대 수정 금지** (보안 정책 + pre_write_guard hook 차단).
> 환경변수로 임시 override만 사용한다. 디버그가 끝나면 새 shell을 열어 되돌린다.

## Step 2 — 로그 파일 tail

App 표준 로그 위치:

| 상황 | 경로 | 접근 |
|---|---|---|
| dev 서버 stdout | terminal | uvicorn 실행 창 |
| 파일 출력 (plain) | `logs/ai_backend.log` | `tail -n 20 logs/ai_backend.log` |
| structured JSON | `logs/ai_backend.jsonl` | `tail -n 50 logs/ai_backend.jsonl \| jq .` |
| pytest stdout | terminal | `pytest -v` |
| pytest junit (CI) | `reports/junit.xml` | parse with `xmllint` or read directly |

기본 3개 명령:

```bash
# 1) 마지막 20줄 — 가장 먼저 눈으로 훑기
tail -n 20 logs/ai_backend.log

# 2) ERROR / WARN 만 — 신호만 뽑기
grep -nE "(ERROR|WARN)" logs/ai_backend.log | tail -n 30

# 3) JSON 로그면 level 필터로 구조화된 에러만
tail -n 100 logs/ai_backend.jsonl | jq 'select(.level == "ERROR" or .level == "WARNING")'
```

로그 파일 자체가 없으면 dev 서버가 한 번도 쓴 적이 없다는 뜻. `uvicorn` 먼저 올리고
한 번 요청을 쏘고 와야 이 step에서 얻을 게 있다.

## Step 3 — pytest 실패 traceback 파싱

```bash
# 마지막 실패한 테스트 1개만, 짧은 traceback
pytest --lf -x --tb=short 2>&1 | tail -n 60
```

`--lf` (last failed) + `-x` (fail fast) + `--tb=short` 3개가 핵심 조합. 전체 suite 다시
돌리지 마라. 한 케이스만 보고 패턴을 파악한 뒤에 다른 실패들을 같은 렌즈로 읽는다.

traceback에서 반드시 봐야 할 3가지:

1. **첫 번째 user code 프레임** — 라이브러리 내부 traceback 은 무시하고 `backend/` 안의
   첫 줄로 점프. 거기가 진짜 실패 지점. 라이브러리 스택에 끌려 들어가면 시간 낭비.
2. **assertion 메시지** — `assert expected == actual` 에서 무엇이 어떻게 다른지.
   `-vv` 를 써서 repr diff 를 보고 싶을 수 있지만, 그 전에 `-tb=short` 로 위치 파악 먼저.
3. **fixture 에러 vs test body 에러** — fixture 안에서 raise 면 **setup 문제** (conftest
   수정 대상), test body 에서 raise 면 **implementation 문제** (production 코드 수정 대상).
   이 구분을 안 하면 testing-infra 문제를 production 코드 변경으로 덮는 최악의 패턴이 생긴다.

모든 fixture가 `autouse` 인 경우 (testing-infra 규약) 한 test의 실패가 바로 옆 test로
전파될 수 있다. 의심되면 실패 케이스 이름을 직접 지정해서 단독 실행:

```bash
pytest backend/tests/test_loop.py::test_single_turn_echo -x --tb=long
```

## Step 4 — FastAPI 요청/응답 로그 위치

dev 서버 5xx 나 `/run/<name>` 이상 동작은 요청 단위로 추적한다. FastAPI + 내장 로거는 요청마다
session_id 를 찍고, 이후 모든 단계 (context 조립, loop stage, tool 실행, stream emit) 가
같은 session_id 로 묶인다.

```bash
# 가장 최근 /run/<name> 요청 한 줄
grep -nE "POST /run/[a-z0-9_]+" logs/ai_backend.log | tail -n 1

# 해당 session_id 추출 → 후속 로그 전부 추적
SESSION_ID=$(grep -E "POST /run/[a-z0-9_]+" logs/ai_backend.log \
    | tail -n 1 \
    | grep -oE 'session=[a-z0-9-]+' \
    | cut -d= -f2)
echo "tracking session=$SESSION_ID"
grep "session=$SESSION_ID" logs/ai_backend.log
```

`/run/<name>` (policy.sse=true) 은 SSE 스트림이라서 **한 요청 = 여러 이벤트**. 이벤트 순서가 의심스러우면:

```bash
grep "session=$SESSION_ID" logs/ai_backend.log \
    | grep -oE 'event=[a-z_]+' \
    | awk '{print NR":"$0}'
```

이 순서가 `session → agent → (text | thinking | tool_call | tool_result | action | notification)* → (usage)? → (done | error)` (SSE 12 이벤트 정본 — `backend/engine/stream.py::SSEEventType`) 를 벗어나면 SSE streaming 버그 의심. `sse-streaming` skill 로 넘어간다.

## Step 5 — 설계 문서 조회

증상이 어느 서브시스템에 속하는지 식별한 뒤, 해당 설계 문서 섹션을 조회한다.
**증상 → 서브시스템 → skill** 매핑표:

| 증상 | 의심 서브시스템 | 참고 skill / 문서 |
|---|---|---|
| tool_use 무한 루프 / 같은 tool 반복 호출 | Agent Loop Stage 5/6 | `agent-loop` skill, design §3.1 |
| context window exceeded / 토큰 폭증 | Context Assembly | `context-assembly` skill, design §3.6 |
| SSE stream 끊김 / `done` 이벤트 누락 | SSE Streaming | `sse-streaming` skill, design §3.7 |
| stale data / 저장 후 안 보임 | Data Layer cache invalidation | `data-audit` skill, `data-layer-patterns.md` |
| 429 / 529 / provider retry 폭주 | Provider Layer | `provider-layer` skill, design §3.5 |
| AsyncMock not awaited / fixture leak | Testing Infra | `testing-infra` skill |

> 권위있는 spec 은 `.agents/rules/python_agent_rules/*.md` 16 파일. 설계 문서
> (docs/design/…) 는 2026-04 에 폐기됨 — rule 파일이 불변식 정의의 정본.
> 의심스러우면 해당 서브시스템의 rule 파일을 먼저 읽고, rule 에 명시된 동작이면
> 버그가 아닌 사양.

## 자주 보는 증상별 first move

| 증상 | 첫 명령 | 다음 단계 |
|---|---|---|
| pytest 1개 실패 | `pytest --lf -x --tb=short` | Step 3 traceback 파싱 → user frame 점프 |
| pytest 다수 실패 | `pytest --lf -v 2>&1 \| head -100` | 패턴 식별 (공통 fixture? 공통 import? autouse pollution?) |
| dev 서버 500 | `tail -n 50 logs/ai_backend.log` | Step 2 → Step 4 (session 추적) |
| agent hang / 응답 없음 | `ps aux \| grep uvicorn` + `tail -f logs/ai_backend.log` | Step 1 (DEBUG 켜고 재현) → Stage 로그 확인 |
| tool not firing | `grep -n "tool_use" logs/ai_backend.log` | Step 5 (`agent-loop` Stage 4 tool discovery) |

이 표의 "첫 명령"은 절대 건너뛰지 않는다. 머릿속 가설로 바로 코드 열면 안 된다.

## 디버그 종료 기준

다음 **3개 모두** 를 만족하면 디버그 종료 (ANY 가 아니라 ALL):

1. **근본 원인을 1문장으로 설명할 수 있다.** "Stage 5가 tool_use 블록을 content 배열로
   flatten 하지 않아서 provider가 빈 input 으로 두 번째 호출을 만들고 무한 루프" 같은 식.
2. **재현 가능한 최소 케이스** — pytest 명령 1줄 또는 curl 명령 1줄. 다른 사람이 그대로
   돌려서 같은 에러를 볼 수 있어야 한다.
3. **fix 또는 workaround 가 코드로 표현돼 있다** — diff 로 볼 수 있거나 적어도 파일 +
   라인 번호로 특정돼 있다.

위 3개 중 하나라도 안 되면 디버그 더 진행. **"고친 것 같다" 는 종료 사유가 아니다.**
증상이 사라진 것만으로는 해결이 아니고, 증상이 사라진 이유를 설명 못하면 다시 나온다.

## 재현 케이스 만드는 법

디버그의 중간 산출물은 **재현 케이스**다. 종료 기준 #2 가 이걸 요구한다.

- **pytest 재현**: 실패한 테스트 1개를 `-xvs` 로 단독 실행한 명령 한 줄.
  예: `pytest backend/tests/test_loop.py::test_tool_use_loop -xvs`
- **curl 재현**: dev 서버 상대로 쏘는 curl 한 줄 + 기대 응답 한 줄.
  예: `curl -N -X POST http://localhost:8000/run/chat -H 'Content-Type: application/json' -d '{"message":"hi"}'` → `event: done` 을 기다리는데 5초 뒤 stream 종료
- **script 재현**: 위 둘로 안 되면 Python script 5줄 이하로 축약.
  `asyncio.run(main())` 로 agent loop 를 직접 호출해서 에러 지점 포착.

세 재현 방식 중 **가장 작은 것** 을 고른다. fixture 문제면 pytest, endpoint 문제면 curl,
library 문제면 script. 재현 없이 "그냥 고쳐봄" 은 금지 — 버그가 다시 나온다.

## 절대 하지 말 것

- **`.env` 수정** — 보안 정책 (pre_write_guard hook가 차단). 디버그를 위한 임시 env는
  shell export 나 `LOG_LEVEL=DEBUG uvicorn ...` 같은 one-liner로만. 디버그 끝나면 새 shell
  을 열어서 override를 깨끗이 버린다.
- **`git reset --hard` 로 상태 되돌리기** — dangerous_shell_guard hook가 차단. 실패한
  상태도 디버그 증거다. 되돌리지 말고 별도 branch로 옮기거나 `git stash` 로 보존한다.
  "일단 돌려놓고 다시 재현" 은 원인 파악 기회를 날리는 최악의 습관.
- **pytest fixture 에러를 production 코드 변경으로 회피** — 증상은 사라지지만 실제 버그는
  숨는다. fixture 문제는 fixture 에서, production 문제는 production 에서 고친다.
  Step 3의 "fixture vs test body" 구분을 잊지 말 것. `testing-infra` skill 의 autouse
  규약을 어기면 한 test 의 실패가 다음 test 로 전염될 수 있으니, fixture 의심 시 단독
  실행 먼저.
- **디버그 로그를 production 에 영구 활성화** — 성능 저하 + 로그 폭증 + 민감 정보 leak
  위험. 디버그가 끝나면 `LOG_LEVEL=INFO` 로 돌아가고, 필요하면 특정 모듈만 DEBUG 로 남기는
  것도 설계 문서에 먼저 기록한 뒤 진행한다.
