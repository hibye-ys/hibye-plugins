---
name: compaction-thresholds-audit
description: compaction 코드 변경 후. compaction-thresholds invariant (CompactAt%, EmergencyCompactAt% 등) 상수 import 검증.
metadata:
  role: audit
  scope: project
  pair_invariant: compaction-thresholds
---

# compaction-thresholds-audit

## 검증 대상 invariant
[compaction-thresholds/SKILL.md](../compaction-thresholds/SKILL.md)

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 모든 패턴은 *file-level grep* — block-level / AST 검증 의무 ✕. PASS 출력은 *부분 신뢰* 만 의미. 정확한 invariant 준수 검증은 paired invariant SKILL.md 의 ## 실행 섹션 + 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: 0.7 / 0.9 등 threshold 매직 넘버
grep -rEn '\b(0\.[5-9]|0\.95)\b.*token|token.*\b(0\.[5-9]|0\.95)\b' <api-app>/src/

# 패턴 2: invariant 상수 import 안 함
for f in $(find <api-app>/src/context -name '*compaction*' -type f 2>/dev/null); do
  grep -qE 'COMPACT_AT|EMERGENCY_COMPACT_AT' "$f" || echo "no-const: $f"
done
```

## 위반 시 조치
1. threshold 매직 넘버 → `compaction-thresholds` 상수 import 로 교체
2. 상수 import 없는 compaction 파일 → invariant 상수 추가 import

## 통과 기준
- 패턴 1 매직 넘버 0건
- 패턴 2 — compaction 파일이 상수 import
