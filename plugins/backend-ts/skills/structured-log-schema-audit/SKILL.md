---
name: structured-log-schema-audit
description: 로깅 코드 / middleware 변경 후 invoke. structured-log-schema invariant 의 필수 3 필드 (timestamp/level/event) / request_id 자동 주입 / PII 필터 / JSON 단일 라인 / level enum 일치를 grep 으로 검증.
metadata:
  role: audit
  scope: project
  pair_invariant: structured-log-schema
---

# structured-log-schema-audit

## 검증 대상 invariant
[structured-log-schema/SKILL.md](../structured-log-schema/SKILL.md)

5가지 강제:
1. **필수 3 필드** (`timestamp`, `level`, `event`) — logger wrapper 가 미공급 시 throw
2. **`request_id` 자동 주입** — HTTP middleware 가 AsyncLocalStorage 에 set
3. **PII 필터링** — `email`/`password`/`token`/`secret`/`key` 패턴 redact
4. **JSON 단일 라인** — `console.log(JSON.stringify({...}))` (newline 포함 ✕)
5. **`level` enum 일치** — `debug` / `info` / `warn` / `error` / `fatal` (대소문자 혼재 ✕)

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 10 패턴 모두 PASS 라도 invariant *완전 준수* ✕. spread/computed payload (`{...base, [k]: v}`) 는 file-level grep 으로 검증 불가 — runtime logger wrapper schema parse 가 더 신뢰성. timestamp UTC 도 `toISOString()` 외 라이브러리 (date-fns / Luxon) 패턴 미커버. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: console.log / console.error 직접 사용 (구조화 logger 우회)
# 정상: logger.info(...) 또는 wrapper 경유
# 위반: 디버그 잔여 console.log
grep -rEn "console\.(log|error|warn|info|debug)\(" <api-app>/src/ 2>/dev/null \
  | grep -v "test\|fixture\|JSON\.stringify"

# 패턴 2: 자유 문자열 메시지 안에 user_id / email / token 보간 (구조화 context 우회)
# 위반: console.log(`user ${userId} logged in`) — userId 가 자유 텍스트 안
grep -rEn "log[a-zA-Z]*\(\s*\`[^\`]*\\\$\{[^}]*(userId|user_id|email|token|secret|password)" \
  <api-app>/src/ 2>/dev/null

# 패턴 3: level 자유 문자열 ("INFO" / "Info" 같은 대소문자 혼재)
# 정상: 'info' (소문자) 또는 5-enum 중 하나
grep -rEn "level:\s*['\"]([A-Z][A-Z]*|[A-Z][a-z]+)['\"]" <api-app>/src/ 2>/dev/null

# 패턴 4: 화이트리스트 외 trace 필드 추가 (ad-hoc context 키)
# 정상 10 필드: request_id, trace_id, span_id, session_id, user_id, run_name, agent, model, turn_count, spawn_depth
# bindLogContext 외부에서 직접 ALS set 하는 경우 검출
grep -rEn "asyncLocalStorage\.run\(|storage\.run\(" <api-app>/src/ 2>/dev/null \
  | grep -v "bindLogContext\|src/observability/contextvars"

# 패턴 5: scrub 적용 누락 — error.stack / err.message 가 raw 로 로깅
# 정상: scrubText(String(err)) 또는 logger 가 내부에서 scrub
grep -rEn "err\.stack|error\.stack|String\(err\)" <api-app>/src/ 2>/dev/null \
  | grep -v "scrubText\|scrubSecrets\|test"

# 패턴 6: multi-line JSON / pretty-print (parser 호환 ✕)
grep -rEn "JSON\.stringify\([^,]+,\s*(null|undefined),\s*[0-9]" <api-app>/src/ 2>/dev/null \
  | grep -v "test\|fixture"

# 패턴 7: 필수 3 필드 (timestamp / level / event) 누락 — logger wrapper 검증
# 정상: logger wrapper 가 미공급 시 throw 또는 자동 주입
# 위반: `console.log(JSON.stringify({...}))` 패턴 안에 timestamp / level / event 셋 다 없음
for f in $(grep -rlE "console\.(log|error|warn)\(JSON\.stringify\(" <api-app>/src/ 2>/dev/null \
            | grep -vE "test|fixture"); do
  # JSON.stringify({...}) 안에 세 키 모두 등장하는지 (대략적 - 같은 파일 안)
  for field in timestamp level event; do
    grep -qE "$field\s*:" "$f" || echo "$f: structured log missing required field '$field'"
  done
done

# 패턴 8: request_id 자동 주입 middleware 등록 확인
# 정상: src/middleware/ 또는 src/index.ts 에서 bindLogContext / requestIdMiddleware 등록
# 위반: 등록 없으면 모든 후속 로그가 request_id 누락
REQUEST_ID_MIDDLEWARE_REGISTERED=$(grep -rlE "requestIdMiddleware|bindLogContext|AsyncLocalStorage" \
  <api-app>/src/middleware/ <api-app>/src/index.ts 2>/dev/null | head -1)
[ -z "$REQUEST_ID_MIDDLEWARE_REGISTERED" ] \
  && echo "request_id auto-injection middleware not registered"

# 패턴 9: timestamp 가 UTC 아닌 local TZ
# 정상: `new Date().toISOString()` 또는 `+Z` suffix
# 위반: `new Date().toString()` / `Date.now().toString()` 같은 local TZ
grep -rEn "timestamp:\s*new Date\(\)\.toString\(\)|timestamp:\s*Date\(\)\.toLocaleString\(\)" \
  <api-app>/src/ 2>/dev/null

# 패턴 10: event 명명이 snake_case 가 아닌 경우 (`<subsystem>.<event>` 패턴)
# 정상: 'request_started', 'provider.call_failed', 'compaction.triggered'
# 위반: CamelCase / kebab-case / 공백 포함
grep -rEn "event:\s*['\"]([^'\"]*)['\"]" <api-app>/src/ 2>/dev/null \
  | grep -vE "['\"][a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?['\"]" \
  | grep -vE "test|fixture"
```

## 통과 기준

- 패턴 1: 출력 0줄 (또는 production-safe 구조화 logger 경유)
- 패턴 2: 출력 0줄 (user 입력은 context 필드로 분리 — log injection 방어)
- 패턴 3: 출력 0줄 (level 은 항상 소문자 5-enum)
- 패턴 4: 출력 0줄 (`bindLogContext` 화이트리스트 경유)
- 패턴 5: 출력 0줄 (모든 error 로깅이 scrub 통과)
- 패턴 6: 출력 0줄 (single-line JSON 만)
- 패턴 7: 출력 0줄 (모든 구조화 로그가 `timestamp` / `level` / `event` 3 필드 보유)
- 패턴 8: 출력 0줄 (`request_id` 자동 주입 middleware 등록 확인)
- 패턴 9: 출력 0줄 (timestamp 는 항상 UTC ISO 8601 — `toISOString()` 또는 `+Z` suffix)
- 패턴 10: 출력 0줄 (event 명명은 snake_case `<subsystem>.<event>` 패턴)

## 위반 시 조치

### 패턴 1 — console.log 잔여물

```typescript
// 위반
console.log('user logged in', { userId })

// 조치
logger.info({ userId }, 'auth.login_succeeded')
// 또는 edge runtime
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'info',
  event: 'auth.login_succeeded',
  userId,
  request_id: getLogContext().request_id,
}))
```

### 패턴 2 — log injection

```typescript
// 위반 — userId 가 message 본문에 보간 → \r\n 주입 시 fake log entry 가능
console.log(`User ${userId} performed ${action}`)

// 조치 — 구조화 context
logger.info({ userId, action }, 'user.action_performed')
```

### 패턴 4 — ad-hoc ALS

```typescript
// 위반 — bindLogContext 우회로 임의 키 set
storage.run({ userId, customField: 'xyz' }, fn)

// 조치 — 화이트리스트 helper
bindLogContext({ user_id: userId }, fn)  // customField 는 throw
```

### 패턴 5 — scrub 누락

```typescript
// 위반
logger.error({ err: String(err) }, 'provider.failed')

// 조치
logger.error({ err: scrubText(String(err)) }, 'provider.failed')
```

## audit 이 커버하지 않는 것

- **AsyncLocalStorage 10 필드 정의** 자체 → `ts-agent-rules` workflow 정본
- **scrubText 패턴 집합** (7 secret + 5 PII) → `sse-streaming` workflow + `http-error-sentinels`
- **log level alerting throttle** → 운영 정책 (별도)
- **log collector / aggregator 설정** → instance 측
- **패턴 7 의 spread/computed payload** — `console.log(JSON.stringify({...base, [k]: v}))` 같이 base object 가 별도 변수에 정의된 경우 file-level 검색이 부정확. base 객체 정의에 3 필드가 있어야 통과 — block-level 검증은 AST 또는 logger wrapper 로 강제 (runtime 시점 schema 검증이 더 신뢰성 ↑)
- **패턴 9 의 timestamp UTC 검증** — `toISOString()` 외 다른 ISO 8601 생성 방법 (Date-fns `formatISO`, Luxon `toUTC().toISO()` 등) 은 패턴에 ✕. 운영자가 사용하는 라이브러리 패턴은 instance 측 audit env 로 보강

## Cross-ref

- `structured-log-schema` invariant — 정본
- `ts-agent-rules` workflow — AsyncLocalStorage 10 필드 + bindLogContext
- `http-error-sentinels` invariant — scrubText 정본
- `incident-triage` workflow — request_id 추적 의존
