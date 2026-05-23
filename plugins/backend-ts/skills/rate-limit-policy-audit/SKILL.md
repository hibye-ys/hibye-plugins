---
name: rate-limit-policy-audit
description: rate limit middleware / 새 라우트 추가 후 invoke. rate-limit-policy invariant 의 3-axis 강제 / Retry-After 헤더 / 멀티 인스턴스 in-memory 금지 / anonymous DDoS 가드를 grep 으로 검증.
metadata:
  role: audit
  scope: project
  pair_invariant: rate-limit-policy
---

# rate-limit-policy-audit

## 검증 대상 invariant
[rate-limit-policy/SKILL.md](../rate-limit-policy/SKILL.md)

코드 패턴 부분만 audit (알고리즘 / 한계값 선택은 product policy):
1. 429 응답에 `Retry-After` 헤더 누락 금지
2. 멀티 인스턴스 환경에서 in-memory rate limit 금지 — Redis / KV / DB 등 외부 backend 강제
3. rate limit bypass 가 user-controllable header 로 가능하면 위반 (예: `X-Skip-Ratelimit`)
4. 인증 전 라우트 (login / register / password-reset) 에 IP 축 rate limit 누락 금지

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 8 패턴 모두 PASS 라도 invariant 완전 준수 ✕ — IP keyword 셋 (envoy / fly / 신규 CDN proxy 헤더 등) 은 instance 측 patterns env 로 보강 필요, 3-axis 가 *적용* 됐어도 *실제 한계값 / 알고리즘 정합성* 은 별도 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: 429 응답인데 Retry-After 헤더 없음
# 정상: response 에 'Retry-After' 또는 'retry-after' 헤더 + body 에 retry_after_ms
for f in $(grep -rlE "(status\(429\)|429|rate_limited)" <api-app>/src/middleware/ <api-app>/src/routes/ 2>/dev/null); do
  grep -qiE "retry.?after" "$f" || echo "$f: 429 without Retry-After header"
done

# 패턴 2: in-memory rate limit 사용 (Map / 모듈 레벨 변수)
# 위반: const counters = new Map() / let counter = 0 같은 module-scoped mutable
grep -rEn "new Map\(\)|new Set\(\)" <api-app>/src/middleware/rate-limit* <api-app>/src/rate-limit/ 2>/dev/null \
  | grep -v "test\|fixture"

# 패턴 3: user-controllable bypass header
grep -rEn "X-Skip-Ratelimit|X-Bypass-Rate|skipRateLimit.*header" <api-app>/src/ 2>/dev/null

# 패턴 4: 인증 전 라우트 (login/register/password-reset) 에 rate limit 누락
# 정상: 해당 라우트 정의 위/같은 파일에 rate limit middleware 적용
for f in $(grep -rlE "/(login|register|signup|password.reset|forgot.password)" <api-app>/src/routes/ 2>/dev/null); do
  grep -qE "rateLimit|rate_limit|kvRateLimit" "$f" || echo "$f: anonymous route without rate limit"
done

# 패턴 5: rate limit envelope shape 위반 — body 에 retry_after_ms 누락
# 정상: { error: { code: 'rate_limited', retry_after_ms: N } }
grep -rEn "rate_limited" <api-app>/src/middleware/ <api-app>/src/routes/ 2>/dev/null \
  | grep -v "retry_after_ms\|Retry-After"

# 패턴 6: rate limit 카운터를 응답 body 에 상세 노출
# 위반: { error: ..., used_today: 73, limit: 100 } 같은 enumeration 위험
grep -rEn "current_count|used_today|hits_count" <api-app>/src/routes/ 2>/dev/null

# 패턴 7: 3-axis 적용 검증 — rate limit middleware 가 user / IP / endpoint **세 축 모두** 보유
# invariant 본문 §"3-axis 기본" 은 세 축 OR 결합 — *체크* 는 OR 이지만 *적용* 은 3축 모두 권장.
# 1축만 있으면 다른 두 축 abuse 가능 (예: IP 만 → 같은 IP 다수 사용자 / 다양한 endpoint 무차별)
for f in $(find <api-app>/src/middleware/ <api-app>/src/rate-limit/ -name '*.ts' 2>/dev/null); do
  grep -qE "rateLimit|kvRateLimit" "$f" || continue
  # framework-neutral keyword 만 — 구체 accessor 는 instance 측 patterns env 로 보강
  has_user=$(grep -qE "userId|user_id|sub:\s*['\"]" "$f" && echo 1 || echo 0)
  has_ip=$(grep -qiE "clientIp|client_ip|\.ip\b|requestIp|remoteAddress|x-forwarded-for|cf-connecting-ip|true-client-ip|x-real-ip|\bForwarded\b|x-envoy-external-address|fly-client-ip" "$f" && echo 1 || echo 0)
  has_endpoint=$(grep -qE "pathname|endpoint|\broute\b|routePath|requestPath|urlPath|originalUrl|req\.path|req\.url|request\.url|\.url\b" "$f" && echo 1 || echo 0)
  total=$((has_user + has_ip + has_endpoint))
  if [ "$total" -eq 0 ]; then
    echo "$f: rate limit has NO dimension key (user=0 ip=0 endpoint=0)"
  elif [ "$total" -lt 3 ]; then
    echo "$f: rate limit only ${total}/3 axes (user=$has_user ip=$has_ip endpoint=$has_endpoint) — invariant '3-axis 기본' 권장 위반"
  fi
done

# 패턴 8: disable flag (`enabled: false` / env override) 가 user-controllable
# 위반: env 'RATE_LIMIT_DISABLED=true' 또는 'disable: req.header(...)' 같은 외부 input 기반
grep -rEn "RATE_LIMIT_DISABLED|rateLimitDisabled|disable.*req\.|enabled:\s*false" \
  <api-app>/src/ 2>/dev/null | grep -vE "test|fixture|//\s*dev-only"
```

## 통과 기준

- 패턴 1: 출력 0줄 (모든 429 응답이 `Retry-After` 헤더 동반)
- 패턴 2: 출력 0줄 (또는 단일 인스턴스 명시 사유 주석)
- 패턴 3: 출력 0줄 (user-controllable bypass ✕)
- 패턴 4: 출력 0줄 (anonymous endpoint 에 IP 축 rate limit 적용)
- 패턴 5: 출력 0줄 (envelope shape 일관)
- 패턴 6: 출력 0줄 (enumeration 위험 정보 노출 ✕)
- 패턴 7: 출력 0줄 (모든 rate limit middleware 가 user / IP / endpoint 3축 **모두** 보유). `<3/3` 출력은 warning — 단일 axis abuse 위험. anonymous endpoint 면 IP+endpoint 만 OK 명시적 사유 주석 필요
- 패턴 8: 출력 0줄 (또는 명시적 `// dev-only` 주석 + production 비활성 가드)

## 위반 시 조치

### 패턴 1 — Retry-After 누락

```typescript
// 위반
return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })

// 조치
return new Response(
  JSON.stringify({ error: { code: 'rate_limited', retry_after_ms: 60_000 } }),
  { status: 429, headers: { 'Retry-After': '60' } },
)
```

### 패턴 2 — in-memory backend

```typescript
// 위반 (멀티 인스턴스에서 카운터 분리 → 우회 가능)
const counters = new Map<string, number>()

// 조치 — KV / Redis / DB
await kvSlidingWindowRateLimit(env.KV, key, 60, 30)
```

### 패턴 4 — anonymous DDoS 가드 누락

```typescript
// 위반
app.post('/login', loginHandler)

// 조치 — IP 축 rate limit (auth middleware 앞)
app.use('/login', ipRateLimit({ window: 60, max: 5 }))
app.post('/login', loginHandler)
```

## audit 이 커버하지 않는 것

- **알고리즘 선택** (token bucket vs sliding window vs fixed window) → product policy
- **구체 한계값** (`max: 30` vs `max: 60`) → product policy
- **per-user vs per-tenant 축 결정** → product policy
- **storage backend 선택** (Redis vs Upstash KV vs DB) → instance 측 결정

## Cross-ref

- `rate-limit-policy` invariant — 정본
- `http-error-sentinels` invariant — 429 envelope shape
- `api-routing` workflow — middleware 등록 순서 (rate limit → auth)
