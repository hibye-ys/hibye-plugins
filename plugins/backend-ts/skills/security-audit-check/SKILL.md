---
name: security-audit-check
description: 배포 전 또는 외부 입력 처리 코드 변경 후 invoke. secret 하드코딩 / eval / new Function / 동적 require / SQL injection / SSRF 6가지 패턴을 grep 으로 일괄 검출.
metadata:
  role: audit
  scope: project
---

# security-audit-check — 보안 통합 audit

## 검증 대상 invariant

`<api-app>/src/` 안 6가지 보안 안티패턴:

1. **secret 하드코딩** — `sk-...`, `AKIA...`, `ghp_...` 같은 토큰 prefix
2. **eval / new Function** — 동적 코드 실행 (runtime + 일반 보안 양쪽 위험)
3. **동적 require** — `require(variable)` (Node-only + 코드 인젝션 면)
4. **SQL injection** — raw template string 안 `${...}` 보간 (Drizzle / neon tagged template 안전 사용 제외)
5. **SSRF** — 사용자 입력 URL 로 직접 fetch (예: `fetch(req.url)` / `fetch(body.url)` 형태)

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 모든 패턴은 *file-level grep* — block-level / AST 검증 의무 ✕. PASS 출력은 *부분 신뢰* 만 의미. 정확한 invariant 준수 검증은 paired invariant SKILL.md 의 ## 실행 섹션 + 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: 하드코딩 secret prefix
rg -nP "(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]+)" <api-app>/src/ 2>/dev/null

# 패턴 2: eval / new Function
rg -nP "\beval\(|new\s+Function\(" <api-app>/src/ 2>/dev/null

# 패턴 3: 동적 require
rg -nP "require\([^'\"\`]+\)" <api-app>/src/ 2>/dev/null

# 패턴 4: raw SQL 보간 (sql.identifier / sql.placeholder 안전 케이스 제외)
rg -nP 'sql\s*`[^`]*\$\{[^}]+\}' <api-app>/src/ 2>/dev/null \
  | grep -v "sql\.identifier\|sql\.placeholder"

# 패턴 5: SSRF — framework request accessor / body 변수를 fetch 인자로
#   - 구체 grep 정규식은 instance 측 framework 별 accessor 패턴으로 치환
rg -nP "fetch\(\s*<framework request accessor>\." <api-app>/src/ 2>/dev/null
```

## 통과 기준

- 5가지 패턴 모두 출력 **0줄**

## 위반 시 조치

### 패턴 1 위반 — 하드코딩 secret

```typescript
// 위반
const OPENROUTER_KEY = 'sk-or-v1-abc123...'
```

조치 — runtime secret store 에 등록 후 framework env binding 으로 접근:

```typescript
// runtime-specific secret store CLI 로 등록 후 binding 사용 (instance 측 project-local skill 참조)
// const key = <framework env binding>.OPENROUTER_API_KEY
```

### 패턴 2 위반 — eval / new Function

```typescript
// 위반
const f = new Function('return ' + userInput)
```

조치:
- 동적 평가 대신 화이트리스트 dispatch 사용
- 어쩔 수 없으면 `vm2` (Node) 또는 sandboxed 격리 환경

### 패턴 3 위반 — 동적 require

```typescript
// 위반
const mod = require(modulePath)
```

조치:
- 정적 import 로 교체 (ES module)
- 또는 미리 등록한 모듈 map 에서 lookup

### 패턴 4 위반 — SQL injection

```typescript
// 위반 (Drizzle/neon 도 raw template 안 보간은 위험)
const rows = await sql`SELECT * FROM users WHERE name = ${name}`  // ← safe iff sql is tagged template
const rows2 = await client.query(`SELECT * FROM users WHERE name = '${name}'`)  // ← 위험
```

조치:
- Drizzle / neon tagged template 사용 시 `sql.placeholder` 또는 query builder 만
- raw query 가 필요하면 prepared statement + parameter binding

### 패턴 5 위반 — SSRF

```typescript
// 위반 — framework-neutral pseudo
// <framework route definition>('/proxy', async (ctx) => {
//   const { url } = await <framework request accessor>(ctx).json()
//   return await fetch(url)  // ← 사용자 입력 URL 로 직접 fetch
// })
```

조치:
- 허용 host 화이트리스트 검증
- private IP / metadata endpoint (169.254.169.254 등) 차단
- redirect follow 제한 (`redirect: 'manual'`)

---

## audit 이 커버하지 않는 것

- 의존성 CVE → `dependency-scanning`
- input schema 검증 (zod) → `input-safety-audit`
- auth middleware 누락 → `api-audit`
- 금지 DB (instance 별) 사용 검출 → instance 측 project-local audit 참조
