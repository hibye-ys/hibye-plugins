---
name: compaction-thresholds-audit
description: compaction 코드 변경 후. compaction-thresholds invariant (CompactAt%, EmergencyCompactAt% 등) 상수 import 검증.
metadata:
  role: audit
  scope: apps/api
  source: (신규)
  pair_invariant: compaction-thresholds
---

# compaction-thresholds-audit

## 검증 대상 invariant
[compaction-thresholds/SKILL.md](../compaction-thresholds/SKILL.md)

## 실행

```bash
# 패턴 1: 0.7 / 0.9 등 threshold 매직 넘버
grep -rEn '\b(0\.[5-9]|0\.95)\b.*token|token.*\b(0\.[5-9]|0\.95)\b' apps/api/src/

# 패턴 2: invariant 상수 import 안 함
grep -rL 'COMPACT_AT\|EMERGENCY_COMPACT_AT' apps/api/src/context/compaction*
```

## 위반 시 조치
1. threshold 매직 넘버 → `compaction-thresholds` 상수 import 로 교체
2. 상수 import 없는 compaction 파일 → invariant 상수 추가 import

## 통과 기준
- 패턴 1 매직 넘버 0건
- 패턴 2 — compaction 파일이 상수 import
