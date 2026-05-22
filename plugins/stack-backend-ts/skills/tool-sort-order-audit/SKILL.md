---
name: tool-sort-order-audit
description: tool 등록 코드 변경 후. tools/registry.ts 안 tool 정렬 순서가 invariant tool-sort-order 따르는지.
metadata:
  role: audit
  scope: project
  source: stack-backend-python/skills/tool-audit (sort 부분)
  pair_invariant: tool-sort-order
---

# tool-sort-order-audit

## 검증 대상 invariant
[tool-sort-order/SKILL.md](../tool-sort-order/SKILL.md)

## 실행

```bash
# tools/registry.ts 안 등록 순서 추출
grep -nE 'register\([^)]*\)|tools\.set\(' <api-app>/src/tools/registry.ts
```

## 위반 시 조치
1. grep 결과를 invariant 명시 순서와 수동 비교
2. 순서 불일치 → registry.ts 등록 순서 수정

## 통과 기준
- 등록 순서가 invariant 명시 순서 (예: alphabetical, 또는 importance) 와 일치
- (수동 비교 — grep 결과 ↔ invariant 본문)
