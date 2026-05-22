---
name: security-runtime
description: <api-app> 런타임 보안 감사 + 통합 보고서 작성 시 invoke. CORS / rate limit / auth 경로 커버리지 / leak-safe 404 / secret scanner / 요청 크기 제한 / 세션 TTL / CSRF / audit log retention. zod input parse 게이트 / runtime secret store / WAF 연동.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/security-runtime
---

**적용된 §4.4 매트릭스 행**: `pydantic BaseModel.parse_obj` → `zSchema.parse(input)` (모든 입력 → 게이트), Python ASGI CORS middleware → framework CORS middleware (예: `cors({ origin, ... })`), `slowapi` / Python rate-limiter → KV + sliding window 또는 framework rate-limiter, `python-jose` JWT → framework JWT 또는 `jose` (npm), Python secret manager SDK / `.env` → runtime secret store (`<framework env binding>.<NAME>`), Python CSRF middleware → framework CSRF + double-submit cookie, audit log (Postgres trigger) → Drizzle insert + object storage immutable retention, `os.getenv` → `<framework env binding>.<NAME>`, `pip-audit` / `safety` → `npm audit` / `pnpm audit`

# security-runtime — 런타임 보안 감사 + 보고서 가이드

## 이 skill 은 언제 invoke 되는가

- `security-manager` sub-agent 호출 시 (runtime / deep-audit 모드)
- 런타임 보안 점검 (CORS, rate limit, auth) 필요 시
- 통합 보안 보고서 작성 시
- 새 라우트 추가 후 인증 커버리지 확인
- 시크릿 노출 사고 후 secret scanner 확장

## 이 skill 은 언제 invoke 되지 않는가

- 빠른 pre-merge 체크 → deploy 전 체크 (instance 측 project-local skill 참조)
- 의존성 CVE 감사 → 별도 `pnpm audit` / Snyk 워크플로
- 코드 구현 작업 → 해당 서브시스템 workflow

## 절대 원칙 (모든 입력 → zod 게이트)

```typescript
// 모든 외부 입력 (req body / query / header / KV value / object storage metadata) =
// 라우트 진입 직후 zod parse 통과만 통과
import { z } from 'zod'
// framework-specific zod validator middleware import (instance 측 project-local skill 참조)

const RunInputSchema = z.object({
  input: z.string().max(50_000),
  agent: z.string().regex(/^[a-z0-9-]+$/).optional(),
})

// <framework route definition>('/run/chat', <framework zod validator>('json', RunInputSchema), async (ctx) => {
//   const body = <framework validated body>(ctx)
//   // ...
// })
```

> `input-safety-gate-ordering` invariant 의 V3 순서 (tombstone → jailbreak heuristic → jailbreak classifier → moderation → `_streamAgent`) 와 결합. zod parse 는 **0번 게이트** (가장 싸고 항상 가장 먼저).

## 1. CORS 설정 검증

```bash
# CORS middleware 등록 확인 (framework-specific — 예: cors 미들웨어 import)
rg -n "cors|import.*cors" <api-app>/src/middleware/ <api-app>/src/index.ts

# wildcard origin (VIOLATION in production)
rg -n "origin:\s*'\*'|origin:\s*\"\*\"|allowAllOrigins" <api-app>/src/
```

```typescript
// ✅ 올바른 CORS 패턴 (framework-neutral pseudo)
// <framework middleware registration>('/api/*', cors({
//   origin: (origin, ctx) => {
//     const allowed = [<framework env binding>.APP_WEB_ORIGIN]
//     return allowed.includes(origin) ? origin : null
//   },
//   credentials: true,
//   allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
//   exposeHeaders: ['X-Request-Id', 'X-App-Session-Id', 'X-App-Usage'],
//   maxAge: 3600,
// }))
```

## 2. Rate Limiting 설정

```bash
# rate limit 미들웨어
rg -n "rateLimit|rate-limiter|kvRateLimit" <api-app>/

# /media/* 별도 rate limit (비용 프로파일 다름)
rg -n "media.*rate|rate.*media" <api-app>/src/routes/media.ts
```

```typescript
// ✅ KV + sliding window rate limit (runtime-neutral)
async function kvSlidingWindowRateLimit(
  kv: { get(k: string): Promise<string | null>; put(k: string, v: string, opts?: { expirationTtl?: number }): Promise<void> },
  key: string,
  windowSec: number,
  maxRequests: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const nowSec = Math.floor(Date.now() / 1000)
  const windowStart = nowSec - windowSec
  const raw = (await kv.get(key)) ?? ''
  const timestamps = raw.split(',').filter(Boolean).map(Number).filter((t) => t > windowStart)
  if (timestamps.length >= maxRequests) {
    return { allowed: false, remaining: 0 }
  }
  timestamps.push(nowSec)
  await kv.put(key, timestamps.join(','), { expirationTtl: windowSec + 60 })
  return { allowed: true, remaining: maxRequests - timestamps.length }
}
```

## 3. Auth 경로 커버리지

```bash
# 인증 미들웨어 사용 현황 (framework context store accessor 포함)
rg -n "authMiddleware|requireAuth|<framework context store>.*auth" <api-app>/src/routes/

# 인증 없는 엔드포인트 (health / metrics 만 OK)
for f in <api-app>/src/routes/*.ts; do
  routes=$(rg -c "<framework route definition>" "$f" 2>/dev/null || echo 0)
  auths=$(rg -c "authMiddleware|requireAuth" "$f" 2>/dev/null || echo 0)
  echo "$(basename $f): routes=$routes auths=$auths"
done
```

## 4. Leak-safe 404 패턴

```bash
# 403 반환 경로 (VIOLATION — 모두 404 여야 함)
rg -n "403" <api-app>/src/routes/

# 소유권 검증 후 404 반환 패턴
rg -n "throw new ResourceError|assertOwner|assertOwnership" <api-app>/src/routes/
```

```typescript
// ✅ Leak-safe — 권한 부재든 미존재든 동일 404 (존재 정보 leak ✕)
const entity = await reader.findById(id)
if (entity === null || entity.ownerId !== auth.userId) {
  throw new FrameworkHttpError(404, { message: 'not found' })  // <framework HTTP error class>
}
```

## 5. Secret Scanner 커버리지

```bash
# SCRUB_PATTERNS 목록 (최소 4종: sk-, AKIA, ghp_, PEM)
rg -n "SCRUB_PATTERNS|scrubSecrets|SCAN_EVENTS" <api-app>/src/sse/

# scrub 함수가 SSE 7 이벤트 전부에 호출되는지
rg -n "scrubText|scrubDict|scrubSecrets" <api-app>/src/sse/ | wc -l
```

```typescript
// 최소 4종 (보강 시 추가)
export const SCRUB_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}\b/g,           // OpenAI / Anthropic
  /\bAKIA[0-9A-Z]{16}\b/g,              // AWS Access Key
  /\bghp_[A-Za-z0-9]{20,}\b/g,          // GitHub PAT
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
]
```

## 6. 요청 크기 제한

```bash
# max body size / content length 제한
rg -n "bodyLimit|maxBodySize|content.length|contentLengthLimit" <api-app>/src/middleware/ <api-app>/src/index.ts
```

```typescript
// ✅ framework body-limit (framework-specific import)
// <framework middleware registration>('*', bodyLimit({
//   maxSize: 5 * 1024 * 1024,  // 5 MB
//   onError: (ctx) => <framework json response>({ error: 'payload too large' }, 413),
// }))

// /media/upload 만 더 크게
// <framework middleware registration>('/media/upload', bodyLimit({ maxSize: 100 * 1024 * 1024 }))
```

## 7. 세션 TTL / CSRF

```bash
# 세션 만료 설정
rg -n "expirationTtl|sessionTtl|maxAge|JWT.*expiresIn|exp:" <api-app>/src/

# CSRF 보호 (SSE GET 엔드포인트는 별도)
rg -n "csrf|csrfMiddleware|X-CSRF" <api-app>/src/
```

```typescript
// ✅ framework CSRF — POST/PATCH/DELETE 만 적용 (SSE GET 제외)
// <framework middleware registration>('*', csrf({
//   origin: (origin, ctx) => origin === <framework env binding>.APP_WEB_ORIGIN,
// }))
```

## 8. Runtime Secrets / 환경변수 분리

```bash
# 로컬 secret 파일 (.env / .dev.vars 등) 이 .gitignore 에 있는지
grep -qE "\.dev\.vars|\.env" .gitignore && echo OK || echo VIOLATION

# runtime secret 등록 목록 확인 (runtime-specific CLI — instance 측 project-local skill 참조)

# 코드에서 process.env 사용 (VIOLATION in some runtimes)
rg -n "process\.env\." <api-app>/src/
```

```typescript
// ❌ 일부 runtime 에서 process.env 사용 ✕ (런타임 undefined — runtime-specific, instance 측 project-local skill 참조)
const key = process.env.API_KEY

// ✅ <framework env binding>.<NAME> + Bindings 타입
export type Env = {
  Bindings: {
    OPENROUTER_API_KEY: string     // runtime secret store 에 등록
    AUTH_SECRET: string
    DATABASE_URL: string
  }
}
// const key = <framework env binding>.OPENROUTER_API_KEY
```

## 9. Audit log retention

```bash
# 인증/권한 변경 audit 호출 지점
rg -n "emitAuditEvent|auditLog\.(write|insert)" <api-app>/src/routes/auth/ <api-app>/src/services/

# object storage immutable (Object Lock 또는 prefix retention)
rg -n "auditLog.*storage|writeAudit.*storage" <api-app>/src/
```

> 데이터 거버넌스 invariant (instance 측 project-local skill 참조) — audit log 는 6 event taxonomy 고정, append-only, 7년 retention. 인증/권한 변경은 별도 object storage immutable prefix (Object Lock).

## 통합 보안 보고서 템플릿

```markdown
## Security Audit Report — <date>

### Executive Summary
- Audit scope: <api-app>/ (Phase <N>)
- Critical: <N> | High: <N> | Medium: <N> | Low: <N>

### 1. Input safety
- [OK/FAIL] All routes use framework zod validator or manual `Schema.parse`
- [OK/FAIL] Input safety gate V3 순서 유지 (tombstone → jailbreak → moderation → agent)

### 2. Supply Chain
- [OK/FAIL] `pnpm audit` clean (또는 ignore 사유 명시)
- License risks: <list>
- Stale dependencies: <list>

### 3. Runtime Security (this skill)
- CORS: [OK/FAIL] — wildcard 없음, allow-list 기반
- Rate limiting: [OK/FAIL] — 라우트별 적용 여부
- Auth coverage: [OK/FAIL] — <N>/<M> routes protected
- Leak-safe 404: [OK/FAIL] — 403 사용 0건
- Secret scanner: [OK/FAIL] — <N> patterns, <M> events covered
- Request size limits: [OK/FAIL] — bodyLimit 적용
- Session TTL / CSRF: [OK/FAIL]
- Runtime Secrets: [OK/FAIL] — `process.env` 사용 0건 (runtime 비호환 시)
- Audit log retention: [OK/FAIL] — append-only / object storage immutable

### 4. Top 5 Attack Surfaces
1. <surface> — risk: <level>, mitigation: <action>
2. ...

### 5. Remediation Priority
| # | Finding | Severity | Effort | Recommendation |
|---|---------|----------|--------|---------------|
| 1 | ... | CRITICAL | Low | Fix immediately |
```

## core-infrastructure 흡수 보충 — 보안 측 △

### 예외 계층 (보안 측 매핑)

> 정본 = `error-handling` workflow §예외 계층. 본 SKILL.md 는 **보안 매핑만** 추가.

| 예외 (정본 = `error-handling`) | 보안 측 행동 |
|---|---|
| `ValidationError` (zod 실패) | 422, 사용자 input scrub 후 반환 — stack ✕ |
| `ConfigurationError` (env 누락) | 500 "service misconfigured" — 어떤 env 누락인지 ✕ |
| `ResourceError` (권한/미존재) | **항상 404** (leak-safe), 403 ✕ |
| `InternalError` (불변식 위반) | 500 "internal server error" — 상세 메시지 ✕ |

### 영향도 — 보안 정책 변경 시

| 변경 | 영향받는 곳 |
|---|---|
| CORS allow-list 변경 | 프론트엔드 빌드 + 모바일 (web view), CSRF origin 동시 갱신 |
| Rate limit threshold 변경 | KV cost, 정당 사용자 차단 risk — Sentry alert 임계값도 동시 갱신 |
| Secret 회전 | runtime secret store 갱신 → 모든 인스턴스 즉시 반영 (재배포 불필요) — 단 캐시된 client 인스턴스 (`p-retry` 등) reset 필요 |
| Auth middleware 순서 변경 | `input-safety-gate-ordering` 게이트 순서와 충돌 가능 — V3 순서 유지 검증 |
| 새 secret 추가 | (1) runtime secret store 등록 (2) `Env.Bindings` 타입 추가 (3) runtime types 재생성 |

### 영향도 — 보안 정책 금지사항

- CORS `origin: '*'` (production)
- 403 반환 (404 leak-safe 위반)
- `process.env.<NAME>` 사용 (runtime undefined 가능성 — runtime-specific, instance 측 project-local skill 참조)
- 로컬 secret 파일 (.env / .dev.vars 등) 을 git 에 commit
- Audit log 의 update / delete (append-only 위반)
- Secret 을 KV 에 저장 (KV 는 평문) — 반드시 runtime secret store
- JWT 에 PII 포함 (payload 는 base64, encryption ✕)

## 의존 자산

- `input-safety-gate-ordering` invariant — V3 게이트 순서
- `error-handling` workflow — 4 예외 / 4 패턴 (정본)
- `http-error-sentinels` invariant — sentinel 매핑
- `auth` workflow — JWT / runtime secrets / KV 세션
- 데이터 거버넌스 invariant (instance 측 project-local skill 참조) — audit log 6 event taxonomy
- `ts-agent-rules` workflow — AsyncLocalStorage 10 필드 (requestId / userId)

## 검증 체크리스트

- [ ] 9개 런타임 체크 블록 실행
- [ ] 보고서 템플릿의 모든 섹션 채움
- [ ] CRITICAL 항목은 즉시 보고
- [ ] 403 사용 경로는 모두 VIOLATION 으로 분류
- [ ] `process.env` 사용 0건 (runtime 비호환 시 — runtime-specific, instance 측 project-local skill 참조)
- [ ] `pnpm audit` 결과 첨부

## 구현 중 막히면

- auth middleware 미구현 → 인증 미구현 경고 (CRITICAL)
- rate limit 미구현 → KV sliding window 패턴 (위 §2) 적용
- CORS 미설정 → 개발 환경이라도 경고
- runtime secret store 미사용 → 로컬 secret 파일 → runtime secret store 마이그
- `process.env` 사용 발견 → runtime 호환성 (instance 측 project-local skill 참조) + `<framework env binding>.<NAME>` 마이그

## Cross-ref

- `error-handling` (정본 — 예외 4종 정의)
- `input-safety-gate-ordering` (V3 게이트 순서)
- `auth` (시크릿 / JWT / KV 세션)
- 데이터 거버넌스 (audit log — instance 측 project-local skill)
- runtime 호환성 (instance 측 project-local skill — `process.env` ✕ 여부)
- `ts-agent-rules` (AsyncLocalStorage / 영향도 표 정본)
