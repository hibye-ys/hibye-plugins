---
name: http-error-sentinels-audit
description: route handler 또는 error path 수정 후. http-error-sentinels invariant 의 status ↔ sentinel 매핑 따르는지.
metadata:
  role: audit
  scope: project
  pair_invariant: http-error-sentinels
---

# http-error-sentinels-audit

## 검증 대상 invariant
[http-error-sentinels/SKILL.md](../http-error-sentinels/SKILL.md)

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 모든 패턴은 *file-level grep* — block-level / AST 검증 의무 ✕. PASS 출력은 *부분 신뢰* 만 의미. 정확한 invariant 준수 검증은 paired invariant SKILL.md 의 ## 실행 섹션 + 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: throw new Error (framework HTTP error class 가 아닌 일반 Error)
grep -rEn 'throw\s+new\s+Error\(' <api-app>/src/routes/ <api-app>/src/services/

# 패턴 2: 응답 helper 직접 호출로 sentinel 우회 (envelope shape 우회)
#   - framework JSON response helper 호출에 inline `{ error: ... }` body 작성 패턴 검출
#   - 정본 helper (`errorBody(code, message, details?)`) 미경유
grep -rEn '<framework json response>.*\{\s*error' <api-app>/src/routes/
```

> 패턴 2 의 `<framework json response>` 는 instance 측 framework 별 JSON 응답 헬퍼 이름으로 치환.

## 위반 시 조치
1. 일반 `Error` throw → framework HTTP error class + sentinel `code` + scrubbed message 로 교체
2. inline `{ error: ... }` 직접 작성 → `errorBody(code, message, details?)` helper 또는 전역 에러 핸들러 (`onError`) 경유

## 통과 기준
- 패턴 1 — 모든 throw 는 framework HTTP error class (envelope 자동 변환). 일반 `Error` 는 *internal* (catch 안에서 sentinel envelope 으로 변환)
- 패턴 2 — 에러 응답은 `errorBody()` helper 또는 전역 onError 핸들러 경유
