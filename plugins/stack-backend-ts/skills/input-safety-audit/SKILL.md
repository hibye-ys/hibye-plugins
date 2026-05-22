---
name: input-safety-audit
description: route handler 추가/수정 후. input-safety-gate-ordering invariant (입력측 안전 게이트 chain — tombstone → jailbreak → moderation) 위반 검출. middleware 등록 순서는 [[api-routing]] invariant 가 정본.
metadata:
  role: audit
  scope: project
  source: stack-backend-python/skills/prompt-audit (safety 부분)
  pair_invariant: input-safety-gate-ordering
---

# input-safety-audit

## 검증 대상 invariant
[input-safety-gate-ordering/SKILL.md](../input-safety-gate-ordering/SKILL.md)

## 실행

```bash
# 패턴 1: zod 검증 없이 framework request body accessor 사용
#   - `<framework request accessor>.json()` 호출 파일에서 같은 파일 안
#     `parse` / `safeParse` / `z.` 부재 검출
for f in $(grep -rlE '<framework request accessor>\.json\(\)' <api-app>/src/routes/); do
  grep -qE 'parse|safeParse|z\.' "$f" || echo "no-zod: $f"
done

# 패턴 2: middleware 순서 (auth before parse before handler)
#   - framework middleware registration 호출 순서 추출
grep -nE '<framework middleware registration>' <api-app>/src/middleware/index.ts <api-app>/src/index.ts
```

> 패턴 1/2 의 `<framework request accessor>` / `<framework middleware registration>` 은 instance 측에서
> framework 별 호출 패턴으로 치환 (각 framework 의 요청 접근자 / 미들웨어 등록 헬퍼 이름).

## 위반 시 조치
1. body parse 후 zod 검증 없음 → `z.parse()` 또는 `z.safeParse()` (또는 framework integrated validator) 추가
2. middleware 순서 오류 → [[api-routing]] invariant 의 "Middleware 등록 순서 원칙" 표 (requestId → rateLimit → cors → auth → schema → handler) 와 일치하도록 재배치

## 통과 기준
- 패턴 1 match 0건 (모든 body 는 zod 검증)
- 패턴 2 — middleware 등록 순서가 [[api-routing]] invariant 의 정본 순서와 일치
