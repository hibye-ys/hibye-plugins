---
name: input-safety-audit
description: route handler 추가/수정 후. input-safety-gate-ordering invariant (auth → schema → rate-limit → handler) 위반 검출.
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/prompt-audit (safety 부분)
  pair_invariant: input-safety-gate-ordering
---

# input-safety-audit

## 검증 대상 invariant
[input-safety-gate-ordering/SKILL.md](../input-safety-gate-ordering/SKILL.md)

## 실행

```bash
# 패턴 1: zod 검증 없이 c.req.json() 사용
for f in $(grep -rlE 'await\s+c\.req\.json\(\)' apps/api/src/routes/); do
  grep -qE 'parse|safeParse|z\.' "$f" || echo "no-zod: $f"
done

# 패턴 2: middleware 순서 (auth before parse before handler)
grep -nE 'app\.use\(' apps/api/src/middleware/index.ts apps/api/src/index.ts
```

## 위반 시 조치
1. `c.req.json()` 후 zod parse 없음 → `z.parse()` 또는 `z.safeParse()` 추가
2. middleware 순서 오류 → auth → schema → rate-limit → handler 순으로 재배치

## 통과 기준
- 패턴 1 match 0건 (모든 body 는 zod 검증)
- 패턴 2 = auth → schema → rate-limit → ... 순서
