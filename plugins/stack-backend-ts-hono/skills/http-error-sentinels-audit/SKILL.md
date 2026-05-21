---
name: http-error-sentinels-audit
description: route handler 또는 error path 수정 후. http-error-sentinels invariant 의 status ↔ sentinel 매핑 따르는지.
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/api-audit (error 부분)
  pair_invariant: http-error-sentinels
---

# http-error-sentinels-audit

## 검증 대상 invariant
[http-error-sentinels/SKILL.md](../http-error-sentinels/SKILL.md)

## 실행

```bash
# 패턴 1: throw new Error (HTTPException 아닌 일반 Error)
grep -rEn 'throw\s+new\s+Error\(' apps/api/src/routes/ apps/api/src/services/

# 패턴 2: c.json({error: ...}) 직접 — sentinel 우회
grep -rEn 'c\.json\(\{\s*error' apps/api/src/routes/
```

## 위반 시 조치
1. `throw new Error(...)` → `throw new HTTPException(status, { message: ... })` 로 교체
2. `c.json({error: ...})` 직접 사용 → onError 핸들러 또는 HTTPException 통해서 응답

## 통과 기준
- 패턴 1 — 모든 throw 는 `HTTPException` (`hono/http-exception`). 일반 `Error` 는 *internal* (catch 안에서 변환)
- 패턴 2 — 에러 응답은 onError 또는 HTTPException 통해서
