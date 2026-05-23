---
name: media-job-lifecycle-audit
description: media job 코드 변경 후 또는 새 op 추가 후 invoke. media-job-lifecycle invariant 의 4 invariant (monotone 전이 / jobId idempotency / terminal immutable / soft cancel) 위반을 grep 으로 검출. <api-app>/src/media/ + <api-app>/src/services/media/ 대상.
metadata:
  role: audit
  scope: project
  pair_invariant: media-job-lifecycle
---

# media-job-lifecycle-audit

## 검증 대상 invariant
[media-job-lifecycle/SKILL.md](../media-job-lifecycle/SKILL.md)

4 invariant 강제:
1. 상태 전이 monotone — terminal → pending / processing → pending (reaper 제외) / 점프 (pending → succeeded) 금지
2. `jobId` = idempotency key — 동일 jobId 로 신규 row insert 금지
3. terminal 후 `result` / `error` immutable
4. `canceled` = soft signal — handler 강제 kill 금지

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 8 패턴 모두 PASS 라도 invariant 4건 *완전 준수* ✕. 모든 패턴은 *file-level grep* — block-level / AST 검증 (transition wrap 안에서 mutation 발생 여부, helper 호출 vs 정의 구분) 은 별도 lint tool 또는 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: terminal status 직접 set (transition function 우회)
# 정상: transitionJob(jobId, from, to) 또는 markCompleted/markFailed/markDlq helper
# 위반: db.update(...).set({ status: 'succeeded' }) 같은 직접 set
grep -rEn "\.set\(\{[^}]*status:\s*['\"](?:succeeded|failed|canceled|dlq|processing|pending)" \
  <api-app>/src/media/ <api-app>/src/services/media/ 2>/dev/null \
  | grep -v "transitionJob\|markCompleted\|markFailed\|markDlq\|markCanceled\|markProcessing"

# 패턴 2: terminal 후 result / resultPath / resultMetadata / error 변경 시도
# 정상: transitionJob 또는 markCompleted/markFailed/markDlq 안에서만 mutate (transition 과 atomic)
# 위반: 직접 .set({ result: ..., resultPath: ..., resultMetadata: ..., error: ... }) — terminal guard 없음
#
# NOTE: `.where()` (Drizzle 메서드 호출) 와 `WHERE` (SQL keyword) 구분 — TS 에서는 .where() 가 정상이므로
#       grep -v "WHERE" 는 false positive. 대신 transition helper 안에 있는지 검증.
for f in $(grep -rlE "\.set\(\{[^}]*(result|resultPath|resultMetadata|error)\s*:" \
            <api-app>/src/media/ <api-app>/src/services/media/ 2>/dev/null); do
  # 같은 파일 안 transitionJob / markCompleted / markFailed / markDlq 호출 또는 정의 없으면 위반
  grep -qE "transitionJob|markCompleted|markFailed|markDlq" "$f" \
    || echo "$f: direct result/error mutate without transition guard"
done

# 패턴 3: jobId 직접 생성 (newPrefixedId 우회)
# 정상: newPrefixedId('job') 또는 crypto.randomUUID 기반 helper
# 위반: 순차 카운터 / Date.now() / 평문 user id
grep -rEn "jobId\s*[:=]\s*['\"]" <api-app>/src/media/ <api-app>/src/services/media/ 2>/dev/null \
  | grep -vE "test|fixture|mock"

# 패턴 4: handler 강제 kill — canceled 즉시 종료 시도 (soft signal 위반)
grep -rEn "killWorkerHandler|forceKill|child_process.*kill|process\.kill" \
  <api-app>/src/media/ <api-app>/src/services/media/ 2>/dev/null

# 패턴 5: 동일 jobId 신규 row 생성 — createIfCapacity 우회 직접 insert
grep -rEn "db\.insert\(mediaJobs\)" <api-app>/src/media/ <api-app>/src/services/media/ 2>/dev/null \
  | grep -v "createIfCapacity\|tryGet\|getOrCreate"

# 패턴 6: handler 등록 시 같은 op 두 번 다른 callable (idempotent registry 위반)
grep -rhoE "registerHandler\(['\"]([^'\"]+)['\"]" \
  <api-app>/src/media/ <api-app>/src/services/media/ 2>/dev/null \
  | sed -E "s/.*['\"]([^'\"]+)['\"].*/\1/" | sort | uniq -d

# 패턴 7: worker idempotency 위반 — 같은 jobId 재처리 시 외부 부작용 (예: 결제 / 외부 메일 발송) 가드 없음
# 정상: handler 본문 시작부에 `if (job.status === 'succeeded') return` 또는 idempotency key 검증
# 위반: handler 안에서 외부 API call 전 status 체크 없음
for f in $(find <api-app>/src/services/media/ -name '*.ts' -type f 2>/dev/null); do
  # handler 정의가 있고 (registerHandler 호출자) 외부 SDK 호출 (fetch / sdk.*) 가 있는데
  # job.status 체크가 없으면 위반 후보
  if grep -qE "fetch\(|sdk\." "$f" && ! grep -qE "job\.status|isTerminal\(|alreadyProcessed" "$f"; then
    echo "$f: handler has external call without idempotency guard (job.status check)"
  fi
done

# 패턴 8: stale-lease reaper 외 monotone 예외 시도 — `processing → pending` 또는 `succeeded → processing` 같은 역전
# reaper 예외는 src/media/reaper.ts 또는 동등 파일에 격리되어야 함
grep -rEn "status:\s*['\"](pending|queued)['\"]" <api-app>/src/media/ <api-app>/src/services/media/ 2>/dev/null \
  | grep -vE "reaper|resetStaleLeases|test|fixture"
```

## 통과 기준

- 패턴 1: 출력 0줄 (terminal 직접 set 금지 — transition function 경유)
- 패턴 2: 출력 0줄 (모든 `result/resultPath/resultMetadata/error` mutate 는 transition helper 안에서만)
- 패턴 3: 출력 0줄 (또는 명시적 helper / test fixture 사유)
- 패턴 4: 출력 0줄 (`canceled` 는 soft signal — `AbortController.abort()` 외 외부 SDK 중단 ✕)
- 패턴 5: 출력 0줄 (`createIfCapacity` / 동등 idempotent helper 경유)
- 패턴 6: 출력 0줄 (같은 op 의 handler 는 동일 callable 만 재등록 OK)
- 패턴 7: 출력 0줄 (worker handler 가 외부 SDK 호출 전 idempotency 가드 보유)
- 패턴 8: 출력 0줄 (단, `reaper.ts` / `resetStaleLeases` 는 monotone 예외로 허용)

## 위반 시 조치

### 패턴 1 — terminal status 직접 set

```typescript
// 위반
await db.update(mediaJobs).set({ status: 'succeeded', result }).where(eq(mediaJobs.id, jobId))

// 조치 — transitionJob 경유 (monotone 검증 내장)
await transitionJob(db, jobId, 'processing', 'succeeded')
await completeJob(db, jobId, result)  // status + result atomic
```

### 패턴 2 — terminal 후 result 변경

```typescript
// 위반
if (job.status === 'succeeded') {
  await db.update(mediaJobs).set({ result: newResult }).where(eq(mediaJobs.id, jobId))
}

// 조치 — terminal 후 result 변경 필요하면 **새 job 생성**
const newJob = await enqueueJob(/* same op */, request, { userId })
```

### 패턴 3 — jobId 직접 생성

```typescript
// 위반
const jobId = `job_${Date.now()}_${counter++}`

// 조치 — UUID 기반 prefixed id helper
import { newPrefixedId } from '../utils/ids.ts'
const jobId = newPrefixedId('job')  // 'job_<uuid>'
```

### 패턴 4 — handler 강제 종료

```typescript
// 위반
killWorkerHandler(jobId)  // 외부 SDK 호출은 중간에 끊기지 않음

// 조치 — soft signal + checkpoint
await cancelJob(db, jobId)  // status = 'canceled' set
// worker 가 다음 checkpoint 에서 status 확인 후 cooperative exit
```

### 패턴 5 — 직접 insert

```typescript
// 위반
await db.insert(mediaJobs).values({ id: jobId, ... })

// 조치 — idempotent helper 경유 (cap check + insert atomic)
const job = await createIfCapacity(op, request, { category, cap, userId })
if (job === null) throw new ResourceError('queue_full')
```

## audit 이 커버하지 않는 것

- **stale-lease reaper** 의 `running → queued` 복원 (monotone 예외) → reaper 로직 자체는 별도 통합 테스트
- **DB CHECK constraint** 가 transition 보호하는지 → schema 검증 (별도 `data-audit`)
- **worker idempotency** (handler 재실행 시 같은 결과) → 단위 테스트
- **AbortController.abort()** 의 정당한 사용 (외부 SDK 중간 중단 가능한 경우) → 케이스별 사유 주석
- **block-level 정밀도** — 패턴 2 의 transition helper 검증은 *file-level* (같은 파일 안 helper 호출 또는 정의 존재). 같은 파일 안 mutation 이 helper *밖* 또는 helper 호출 *전* 에 발생하는 경우는 검출 ✕. block-level 검증은 AST 분석 필요 — `tsc` plugin / `eslint-plugin-local` 또는 수동 review 로 보강
- **패턴 7 의 idempotency guard 정확도** — `job.status` / `isTerminal` 키워드가 같은 파일에 있으면 통과. 실제로 호출되는지는 검증 ✕

## Cross-ref

- `media-job-lifecycle` invariant — 정본 4 invariant
- `media-pipeline-patterns` workflow — 6-state 내부 매핑 + handler 등록 절차
- `single-writer-audit` — 바이너리 쓰기 single-writer (별도 audit)
- `data-audit` — DB schema CHECK constraint
