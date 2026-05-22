---
name: api-audit
description: 새 framework route 추가 후 또는 배포 전 invoke. POST/PUT/PATCH 핸들러가 schema validator 미들웨어 없음 / 보호 path 가 authMiddleware 없음 / handler 응답 명시 부재를 grep 으로 검증. input-safety-gate-ordering + auth 가 함께 동작하는지 정합성 체크.
metadata:
  role: audit
  scope: project
  source: stack-backend-python/skills/api-audit
---

# api-audit — framework route thin-layer audit

## 검증 대상 invariant

framework route 는 *thin layer* — 입력 검증 + 인증 + 핸들러 호출만. 위반 시 보안·계약 안정성 동시 손상.

1. **mutation (POST/PUT/PATCH)** 은 반드시 `<framework zod validator>` (instance 측 framework 별 schema validator 미들웨어 — placeholder 어휘는 `docs/placeholder-vocabulary.md` 참조) 로 body schema 검증
2. **보호 path** (`src/routes/protected/`) 는 반드시 `authMiddleware` 적용
3. 핸들러는 framework JSON response helper 명시 응답 (raw `Response` 직접 반환 ✕)
4. **middleware 등록 순서**: [[api-routing]] invariant 의 순서표 (`requestId → rateLimit → cors → auth → schema → handler`) 와 일치. 본 audit 는 순서를 자체 정의하지 않음 — SoT 는 `api-routing` 단일.

> 본 audit 는 middleware *순서* 를 자체 정의하지 않는다. 순서 정본은 [[api-routing]] 의 "Middleware 등록 순서 원칙" 섹션. 입력측 안전 게이트 (jailbreak / moderation 등) 의 *내부* 순서는 [[input-safety-gate-ordering]] invariant 참조 — middleware registration 순서와는 다른 개념.

## 실행

> 아래 패턴의 `<framework route definition>` / `<framework request accessor>` / `<framework json response>`
> 는 instance 측 framework 별 호출 패턴으로 치환 (각 framework 의 라우트 정의 / 요청 접근자 / JSON 응답 헬퍼 이름).

```bash
# 패턴 1: POST/PUT/PATCH 핸들러 안 schema validator 누락 — file-level awk block scan
#   instance 측 framework 패턴은 env var 로 주입 (구체 default 는 docs/ci-template.md 참조):
#     ROUTE_MUTATION_PATTERN — 라우터의 POST/PUT/PATCH handler 정의 정규식
#     ZOD_VALIDATOR_PATTERN  — schema validator 미들웨어 함수 정규식
ROUTE_MUTATION_PATTERN="${ROUTE_MUTATION_PATTERN:?set via docs/ci-template.md}"
ZOD_VALIDATOR_PATTERN="${ZOD_VALIDATOR_PATTERN:?set via docs/ci-template.md}"

for f in <api-app>/src/routes/*.ts <api-app>/src/routes/**/*.ts; do
  [[ -f "$f" ]] || continue
  awk -v mutation_re="$ROUTE_MUTATION_PATTERN" -v validator_re="$ZOD_VALIDATOR_PATTERN" '
       $0 ~ mutation_re {flag=1; start=NR}
       flag && $0 ~ validator_re {flag=0}
       flag && /\)\s*$/{print FILENAME":"start": missing schema validator"; flag=0}' "$f"
done

# 패턴 2: 보호 path 안 authMiddleware 누락 — grep -L (no match files)
grep -L "authMiddleware" <api-app>/src/routes/protected/*.ts 2>/dev/null

# 패턴 3: handler 가 raw Response 직접 반환 (framework json response helper 우회)
grep -nE 'return\s+new\s+Response\(' <api-app>/src/routes/
```

## 통과 기준

- 패턴 1 출력 **0줄** (모든 mutation route 가 schema validator 보유 — instance framework 별 패턴은 ZOD_VALIDATOR_PATTERN env 로 override)
- 패턴 2 출력 **0줄** (모든 protected route 가 authMiddleware 보유)
- 패턴 3 출력 **0줄** (또는 SSE / file download 등 명시적 사유 주석 포함)

## 위반 시 조치

### 패턴 1 위반 — schema validator 누락

```typescript
// 위반 예시 — framework-neutral pseudo
// <framework route definition>.post('/users', async (ctx) => {
//   const body = await <framework request accessor>(ctx).json()  // unsafe — schema 검증 없음
//   return <framework json response>(ctx, { id: ... })
// })
```

조치 — schema validator 미들웨어 추가 (framework 별 zod 통합 사용 — placeholder `<framework zod validator>`):

```typescript
// framework-neutral pseudo
// import { <framework zod validator> } from '<framework zod-validator package>'
// import { z } from 'zod'
//
// const UserCreate = z.object({ email: z.string().email(), name: z.string().min(1) })
//
// <framework route definition>.post('/users', <framework zod validator>('json', UserCreate), async (ctx) => {
//   const body = <framework request accessor>(ctx).valid('json')  // typed + validated
//   return <framework json response>(ctx, { id: ... })
// })
```

### 패턴 2 위반 — authMiddleware 누락

```typescript
// 위반 예시 — src/routes/protected/billing.ts 에 auth 없음 (framework-neutral pseudo)
// const router = new <framework router>()
// <framework route definition>.get('/invoices', async (ctx) => { ... })
```

조치:

```typescript
// framework-neutral pseudo
// import { authMiddleware } from '@/middleware/auth'
//
// const router = new <framework router>()
// <framework middleware registration>('*', authMiddleware)  // 또는 라우터 부모에서 mount
// <framework route definition>.get('/invoices', async (ctx) => { ... })
```

### 패턴 3 위반 — raw Response 직접 반환

- 일반 JSON 응답 → framework JSON response helper 로 교체 (sniff·status·content-type 자동)
- SSE / streaming / file download 같은 의도된 경우는 `// raw-response-ok: <사유>` 주석 추가

---

## audit 이 커버하지 않는 것

- RunPolicy / preset 검증 → `run-policy-presets-audit`
- error sentinel (`throw new Error` in routes) → `http-error-sentinels-audit`
- input schema 의 *내용* 검증 (예: 비밀번호 정책) → 별도 product audit
