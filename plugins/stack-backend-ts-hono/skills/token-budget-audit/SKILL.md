---
name: token-budget-audit
description: context-assembly 또는 prompt 코드 변경 후. apps/api 안 token-budget-constants 상수 (MAX_HISTORY_TOKENS 등) 우회·하드코딩 검출.
metadata:
  role: audit
  scope: apps/api
  source: (신규)
  pair_invariant: token-budget-constants
---

# token-budget-audit

## 검증 대상 invariant
[token-budget-constants/SKILL.md](../token-budget-constants/SKILL.md)

## 실행

```bash
# 패턴 1: 8000/16000/32000 등 매직 넘버 (token 상수 우회)
grep -rEn '\b(8000|16000|32000|128000)\b' apps/api/src/context/ apps/api/src/ai/

# 패턴 2: invariant 의 상수 import 안 함
grep -rL 'TOKEN_BUDGET\|MAX_HISTORY_TOKENS' apps/api/src/context/
```

## 위반 시 조치
1. 매직 넘버 발견 → `token-budget-constants` 에서 상수 import 로 교체
2. 상수 import 없는 파일 → invariant 정의 상수 사용 추가

## 통과 기준
- 패턴 1 match 0건 (모든 token 수치는 invariant 상수 import)
- 패턴 2 match 0건
