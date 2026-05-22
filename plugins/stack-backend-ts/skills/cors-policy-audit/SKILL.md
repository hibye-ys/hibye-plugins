---
name: cors-policy-audit
description: CORS middleware / route 응답 변경 후 invoke. cors-policy invariant 의 wildcard origin 금지 / credentials+wildcard 금지 / expose_headers FE contract / Vary 헤더 / preflight cache TTL 강제를 grep 으로 검증.
metadata:
  role: audit
  scope: project
  pair_invariant: cors-policy
---

# cors-policy-audit

## 검증 대상 invariant
[cors-policy/SKILL.md](../cors-policy/SKILL.md)

5가지 강제:
1. `Access-Control-Allow-Origin: *` 금지 (production)
2. `Allow-Credentials: true` + `Allow-Origin: *` 조합 금지 (브라우저 거부)
3. `expose_headers` 에 X-App-* / X-Request-Id 7종 포함 (FE contract)
4. `Vary: Origin` 헤더 (CDN 캐시 오염 방지)
5. preflight cache TTL (`Access-Control-Max-Age`) 명시

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 7 패턴 모두 PASS 라도 invariant 완전 준수 ✕ — 모든 패턴은 *file-level grep*, allowlist 안 실제 origin 값 / 운영 환경 dynamic origin reflection 은 별도 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: wildcard origin (production)
# 위반: origin: '*' 또는 origin: true (모든 origin 허용)
grep -rEn "origin:\s*['\"]?\*['\"]?|origin:\s*true|allowAllOrigins" \
  <api-app>/src/middleware/ <api-app>/src/index.ts 2>/dev/null

# 패턴 2: credentials true + wildcard 조합
# 정상: origin 화이트리스트 + credentials true
# 위반: 같은 cors 설정에 둘 다 등장
for f in $(grep -rlE "cors|Cors" <api-app>/src/middleware/ <api-app>/src/index.ts 2>/dev/null); do
  if grep -qE "credentials:\s*true" "$f" && grep -qE "origin:\s*['\"]?\*" "$f"; then
    echo "$f: credentials:true + origin:* (browser rejects)"
  fi
done

# 패턴 3: expose_headers 에 X-App-* / X-Request-Id 7종 모두 명시
# 정본 7개 (FE contract — http-error-sentinels invariant):
#   X-App-Session-Id / X-App-Agent / X-App-Model / X-App-Run-Id /
#   X-App-Moderation-Status / X-App-Jailbreak-Status / X-Request-Id
for f in $(grep -rlE "exposeHeaders|expose_headers" <api-app>/src/middleware/ <api-app>/src/index.ts 2>/dev/null); do
  for header in X-App-Session-Id X-App-Agent X-App-Model X-App-Run-Id X-App-Moderation-Status X-App-Jailbreak-Status X-Request-Id; do
    grep -qE "$header" "$f" || echo "$f: expose_headers missing $header"
  done
done

# 패턴 4: Vary: Origin 헤더 누락 (CORS 응답에서)
for f in $(grep -rlE "Allow-Origin|allowOrigin" <api-app>/src/middleware/cors* <api-app>/src/middleware/ 2>/dev/null); do
  grep -qE "Vary.*Origin" "$f" || echo "$f: missing Vary: Origin header"
done

# 패턴 5: preflight cache TTL 누락
for f in $(grep -rlE "preflight|OPTIONS" <api-app>/src/middleware/ 2>/dev/null); do
  grep -qE "Max-Age|maxAge" "$f" || echo "$f: preflight without Max-Age TTL"
done

# 패턴 6: origin 입력값 그대로 reflect (allowlist 검증 ✕)
# 위반: `<framework request accessor>('origin')` 을 그대로 응답 헤더에 set (allowlist 검증 ✕)
grep -rEn "header\(.Origin.\)|req\.header.*['\"]origin" <api-app>/src/middleware/ 2>/dev/null \
  | grep -v "allowlist\|includes\|allowed"

# 패턴 7: Allow-Methods 가 wildcard
grep -rEn "Allow-Methods:\s*['\"]?\*|allowMethods:\s*['\"]?\*" <api-app>/src/middleware/ 2>/dev/null
```

## 통과 기준

- 패턴 1: 출력 0줄 (production 에서 wildcard origin ✕)
- 패턴 2: 출력 0줄 (credentials + wildcard 조합 ✕)
- 패턴 3: 출력 0줄 (필수 X-App-* / X-Request-Id 헤더 노출)
- 패턴 4: 출력 0줄 (모든 CORS 응답에 Vary: Origin)
- 패턴 5: 출력 0줄 (preflight 응답에 Max-Age 명시 — 권장 3600s)
- 패턴 6: 출력 0줄 (origin 은 allowlist 매치 후에만 echo)
- 패턴 7: 출력 0줄 (명시적 method 열거)

## 위반 시 조치

### 패턴 1/2 — wildcard origin / credentials

```typescript
// 위반
app.use('*', cors({ origin: '*', credentials: true }))

// 조치 — env 화이트리스트
const ALLOWED_ORIGINS = [env.APP_WEB_ORIGIN, env.APP_ADMIN_ORIGIN]
app.use('*', cors({
  origin: (origin) => ALLOWED_ORIGINS.includes(origin) ? origin : null,
  credentials: true,
}))
```

### 패턴 3 — expose_headers 누락

```typescript
// 조치 — FE contract 7종 명시
cors({
  exposeHeaders: [
    'X-App-Session-Id', 'X-App-Agent', 'X-App-Model', 'X-App-Run-Id',
    'X-App-Moderation-Status', 'X-App-Jailbreak-Status', 'X-Request-Id',
  ],
})
```

### 패턴 4 — Vary 헤더 누락

```typescript
// 조치 — origin 별 CDN 캐시 분리
ctx.header('Vary', 'Origin')
```

### 패턴 5 — preflight TTL

```typescript
cors({
  // ...
  maxAge: 3600,  // 1h — 환경별 조정
})
```

## audit 이 커버하지 않는 것

- **origin allowlist 값** 자체 (어느 도메인 허용) → instance 측 env 결정
- **OPTIONS preflight 응답 body** (`204 No Content` 강제) → 일반적으로 framework 가 처리
- **bot detection** (CORS 와 직교) → `security-runtime` workflow

## Cross-ref

- `cors-policy` invariant — 정본
- `http-error-sentinels` invariant — X-App-* 7 헤더 정의 (FE contract)
- `api-routing` workflow — middleware 순서 (cors 는 auth 이전)
