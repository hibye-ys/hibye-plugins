---
name: red-green-fix
description: Use when fixing a bug in apps/api/ — especially the first time you're touching that subsystem after a regression. Load this skill to walk a strict 5-step red-green-fix workflow covering a failing test, failure confirmation, minimal production fix, subsystem test run, and refactor after green. Also use when the user says "fix this bug", "this is broken", or "regression".
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/skills/red-green-fix
allowed-tools: Read, Write, Edit, Bash
---

# red-green-fix — 버그 수정 TDD 워크플로우

## 이 skill은 언제 로드되는가

- **버그 수정** — "fix this bug", "이거 고쳐", "broken", "this is broken"
- **회귀(regression)** — "regression", "다시 깨졌다", "원래 됐는데 안 된다"
- **TDD 시작** — "TDD로 가자", "테스트 먼저", "red-green"
- **테스트 먼저 강제** — "테스트 먼저 짜", "failing test 부터", "먼저 재현해"

## red-green-fix 의 정체성

버그 수정은 5단계로 진행한다. **순서 변경 금지, 단계 건너뛰기 금지.**

1. **RED** — 버그를 정확히 재현하는 실패 테스트를 작성한다
2. **CONFIRM RED** — 테스트를 실행해서 올바른 이유로 실패하는지 확인한다
3. **GREEN** — 테스트를 통과시키는 최소 코드를 작성한다
4. **CONFIRM GREEN + NO REGRESSION** — 새 테스트 + 기존 테스트가 모두 통과하는지 확인
5. **REFACTOR (optional)** — 테스트가 여전히 통과하는 상태에서만 코드를 정리한다

"production 코드를 먼저 고치고 나중에 테스트를 추가" 하는 순서는 **명시적 금지**.
테스트가 먼저 실패해야만 수정이 의미 있다.

## Step 1 — RED

버그를 정확히 재현하는 실패 테스트를 작성한다.

```ts
// apps/api/src/<module>/__tests__/<module>.regression.test.ts
import { describe, it, expect } from 'vitest'
import { apiRequest } from '../../test/helpers'  // Hono in-process

describe('<Module> regression', () => {
  it('<functionName> — <bug description>', async () => {
    /**
     * Regression: <버그 1줄 요약>.
     * 버그 원인: <왜 실패하는지>. 기대 동작: <수정 후 기대값>.
     */
    // Arrange — 버그 트리거 조건을 정확히 세팅
    const input = { ... }
    // Act — 버그를 트리거하는 호출
    const res = await apiRequest('/api/route', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    // Assert — 기대 동작 (현재는 실패해야 함)
    expect(res.status, `Expected 200 but got ${res.status}: <버그 설명>`).toBe(200)
  })
})
```

비-route 단위 테스트:

```ts
it('<functionName> — <bug description>', async () => {
  const result = await functionUnderTest(input)
  expect(result, `Expected ${expected} but got ${result}: <버그 설명>`).toEqual(expected)
})
```

### RED 3원칙

1. **버그 재현 정확도** — 테스트 입력은 실제 버그가 발생한 조건과 동일해야 한다.
   "비슷한 케이스" 가 아니라 "정확히 그 케이스". 추상화하지 말 것.
2. **assertion message 필수** — bare `expect(x).toBe(y)` 에 두 번째 인수로 메시지 추가.
   실패 시 무엇이 기대였고 무엇이 실제였는지 즉시 파악 가능해야 한다.
3. **단일 assertion** — 한 테스트에 한 버그. 여러 expect 를 넣으면 첫 번째에서
   실패하고 나머지 상태를 알 수 없다.

테스트 파일: 기존 `__tests__/<module>.test.ts` 에 추가하거나, 회귀 전용
`__tests__/<module>.regression.test.ts` 로 분리.

## Step 2 — CONFIRM RED

테스트를 실행해서 **올바른 이유로 실패**하는지 확인한다.

```bash
npx vitest run apps/api/src/<module>/__tests__/<module>.regression.test.ts \
  --reporter=verbose --bail=1
```

확인 기준:

- **AssertionError / expect 실패** — 정상. 버그가 재현됐다. Step 3 진행.
- **TypeError / ImportError / SyntaxError** — 테스트 코드 자체 오류. Step 1 재작성.
- **테스트가 통과** — 최악. 버그 미재현. 조건이 잘못됐거나 이미 수정됨. Step 1 재검토.

> "올바른 이유" 가 핵심. `AssertionError: Expected 42 but got undefined` 는
> 올바른 실패. `TypeError: cannot read property of undefined` 는 테스트 코드 버그.

Step 2 를 통과해야만 Step 3 으로 진행. 잘못된 이유로 실패하거나 통과하면 Step 1 복귀.

## Step 3 — GREEN

실패하는 테스트를 통과시키는 **최소 코드**를 작성한다.

### GREEN 3원칙

1. **최소 변경** — 테스트 통과에 필요한 코드만. "이왕 이 파일 열었으니 다른 것도"
   금지. 추가 수정은 Step 5 REFACTOR 에서.
2. **새 모듈 / 새 파일 생성 지양** — 버그 수정에서 새 아키텍처가 나와야 할 이유는
   거의 없다. 새 파일이 필요하면 REFACTOR 단계에서 추출.
3. **하드코딩도 OK** — GREEN 의 목표는 "테스트 통과" 뿐. 일반화는 REFACTOR 에서.

수정 대상 참고 (서브시스템 매핑):

| 증상 | 수정 대상 |
|---|---|
| agent loop 이상 | `apps/api/src/engine/loop.ts` |
| tool 실행 실패 | `apps/api/src/tools/base.ts`, `registry.ts` |
| provider 응답 변환 오류 | `apps/api/src/providers/<name>.ts` |
| context 조립 오류 | `apps/api/src/engine/context.ts` |
| SSE 이벤트 누락/순서 오류 | `apps/api/src/engine/stream.ts`, `apps/api/src/routes/run.ts` |
| 데이터 읽기/쓰기 오류 | `apps/api/src/data/reader.ts`, `writer.ts` |
| route 응답 오류 | `apps/api/src/routes/<route>.ts` — Hono handler |
| DB 쿼리 오류 | `apps/api/src/db/<table>.ts` — Drizzle query |

## Step 4 — CONFIRM GREEN + NO REGRESSION

3단계 확인을 **순서대로** 실행. 하나라도 실패하면 Step 3 복귀.

```bash
# 4-1. 새 테스트만 — GREEN 확인
npx vitest run apps/api/src/<module>/__tests__/<module>.regression.test.ts \
  --reporter=verbose --bail=1

# 4-2. 해당 모듈 전체 — 모듈 내 regression 확인
npx vitest run apps/api/src/<module>/__tests__/ --reporter=verbose

# 4-3. 서브시스템 전체 — 크로스 모듈 regression 확인
npx vitest run apps/api/src/ --reporter=verbose
```

> **4-2 에서 기존 테스트가 깨지면 — 깨진 테스트를 수정하는 게 아니라 Step 3 의
> production 코드 수정을 재검토한다.** 테스트를 약화해서 GREEN 을 만드는 것은 위반.

## Step 5 — REFACTOR (optional)

Step 4 를 **모두 통과한 상태에서만** 리팩터링 진행. GREEN 아닌 상태에서 시작 금지.

허용되는 리팩터링: 중복 제거, 이름 개선, 매직 넘버 상수화, 하드코딩 일반화, 함수 분리.

규칙:
- **한 번에 하나만 변경** — 리팩터링 1건마다 `npx vitest run apps/api/src/<module>/` 재실행
- 테스트가 깨지면 리팩터링 취소 (undo) 후 원인 파악
- 리팩터링 중 새 기능 추가 금지

## Watch 모드 (개발 중 연속 피드백)

```bash
# 전체 watch — 파일 변경 시 자동 재실행
npx vitest --watch

# 특정 파일 watch
npx vitest --watch apps/api/src/<module>/__tests__/

# 첫 실패에서 중단 (RED 확인용)
npx vitest run --reporter=verbose --bail=1

# 상세 출력 + 1번 실패 시 중단
npx vitest run --reporter=verbose --bail=1 apps/api/src/<module>/
```

> `vitest --watch` 는 RED-GREEN 사이클을 빠르게 돌릴 때 필수. Step 1~3 구간에서
> 항상 watch 모드로 진행 권장.

## 절대 금지

1. **RED 없이 GREEN** — production 코드를 먼저 수정하고 "테스트 나중에 추가" 금지.
   실패하는 테스트가 없으면 변경이 버그를 고쳤는지 증명 불가.
2. **실패하는 테스트를 수정해서 GREEN 만들기** — 기존 테스트 약화 금지. production
   코드 수정을 재검토한다.
3. **한 테스트에 여러 버그** — 버그 1개 = 테스트 1개.
4. **CONFIRM RED 건너뛰기** — 테스트가 올바른 이유로 실패하는지 확인 안 하면,
   GREEN 이 진짜 수정인지 우연인지 알 수 없다.
5. **GREEN 아닌 상태에서 REFACTOR** — Step 4 미통과 상태에서 리팩터링 시작 금지.
6. **regression test 를 `it.skip` 으로 무력화** — 회귀 테스트는 영구
   보호망. skip 이 필요하면 사용자에게 보고 후 승인.

## 종료 기준

다음 **4개 모두** 만족 시 종료:

1. **실패 테스트 존재** — Step 1 에서 작성, Step 3 수정 전에 실패했다는 기록 있음
2. **해당 테스트 통과** — Step 4-1 GREEN 확인
3. **기존 테스트 전체 통과** — Step 4-2, 4-3 regression 0건
4. **타입 체크 통과** — `npx tsc --noEmit` (프로젝트 표준)

4개 중 하나라도 미달이면 해당 Step 복귀. "거의 다 됐다" 는 종료 사유가 아니다.

## 자주 보는 함정

### 1. RED 없이 GREEN ("일단 고치고 테스트는 나중에")

가장 흔한 위반. 테스트 없이 고치면: (a) 수정이 버그를 고쳤는지 증명 불가,
(b) 같은 버그 재발 시 감지 불가. 테스트 작성에 3분이면 된다 — 그 3분이 나중에
2시간짜리 재발 디버깅을 막는다.

### 2. 한 테스트에 여러 버그 ("관련 있으니까 한꺼번에")

첫 `expect` 에서 실패하면 이후 assertion 이 실행되지 않는다. 관련 있어
보여도 assertion 이 독립적이면 테스트를 분리. `test_validate_and_format_and_save`
같은 이름이 되면 SRP 위반 신호.

### 3. Flaky test (실행할 때마다 결과 변동)

원인: (a) 시간 의존 (`Date.now()`), (b) 순서 의존 (Map/Set 순회), (c) 외부 상태
의존 (파일, 네트워크). 해결: `vi.useFakeTimers()` / `vi.setSystemTime()` 로
결정적 입력 주입. flaky 테스트로 RED 를 확인했다고 주장 금지 — 재현 가능해야 RED 다.

### 4. CI/local 불일치 ("내 로컬에서는 통과하는데")

Node 버전, OS, 환경변수 차이. `process.platform` 분기를 테스트에서 피하고,
불가피하면 `it.skipIf(process.platform === 'win32')(...)` + 사유 기록.
`engines.node` 와 CI Node 버전을 일치.

### 5. Workers 비호환 패턴이 unit test 를 통과

`setInterval`, `Buffer`, `fs` 는 Node 환경 단위 테스트에서 동작하지만
Workers runtime 배포 시 실패. 이런 패턴은 `vi.mock` 으로 격리하거나
`miniflare` 통합 테스트로 검증.

## 사용 예시 — maxTurns 버그

시나리오: agent loop 가 `maxTurns=1` 일 때 2회 반복하는 버그.

**Step 1 RED**: `test_agentLoop_respects_maxTurns_one` 작성 — `makeMockProvider`
로 1-turn 시나리오 구성, `expect(turnCount, '...').toBe(1)` 에 off-by-one 설명 메시지 포함.

**Step 2 CONFIRM RED**:
```bash
npx vitest run apps/api/src/engine/__tests__/loop.regression.test.ts \
  --reporter=verbose --bail=1
# FAIL — AssertionError: Expected exactly 1 turn with maxTurns=1, but got 2 turns
```
AssertionError 확인. 올바른 이유.

**Step 3 GREEN**: `apps/api/src/engine/loop.ts` 에서 `turns++` 위치를 루프 끝으로 이동.
최소 1줄 변경. 새 모듈/함수 없음.

**Step 4 CONFIRM GREEN + NO REGRESSION**:
```bash
npx vitest run apps/api/src/engine/__tests__/loop.regression.test.ts --reporter=verbose --bail=1
# PASS

npx vitest run apps/api/src/engine/__tests__/ --reporter=verbose
# 10 passed

npx vitest run apps/api/src/ --reporter=verbose
# 42 passed, 0 failed
```

**Step 5 REFACTOR**: 1줄 수정이므로 불필요. 종료.

## 구현 중 막히면

- "재현 테스트를 못 만들겠다" → 사용자에게 재현 절차 구체적 질문 (입력, 환경, 이전 상태)
- "AssertionError 가 아닌 다른 에러" → 테스트 코드 버그. import/mock 확인 후 Step 1 재작성
- "수정했는데 다른 테스트가 깨진다" → 최소 변경 원칙 재적용. 깨진 테스트가 아닌 production 코드 수정 방법 변경
- "Workers 에서만 실패" → `miniflare` 통합 테스트로 재현 후 `testing-infra` skill 의 Workers 환경 테스트 패턴 적용
- 위 가이드로 안 풀리면: `debug-session` skill 로 전환
