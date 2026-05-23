---
name: run-policy-presets-audit
description: AI run / job 설정 코드 변경 후. run-policy-presets invariant 의 timeout / max-turn / retry preset 우회 검출.
metadata:
  role: audit
  scope: project
  pair_invariant: run-policy-presets
---

# run-policy-presets-audit

## 검증 대상 invariant
[run-policy-presets/SKILL.md](../run-policy-presets/SKILL.md)

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 모든 패턴은 *file-level grep* — block-level / AST 검증 의무 ✕. PASS 출력은 *부분 신뢰* 만 의미. 정확한 invariant 준수 검증은 paired invariant SKILL.md 의 ## 실행 섹션 + 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: timeout / max_turns 등 매직 넘버
grep -rEn 'timeout:\s*\d+|max.turns?:\s*\d+|maxTurns:\s*\d+' <api-app>/src/ai/

# 패턴 2: invariant preset 안 import
grep -rL 'RUN_POLICY\|POLICY_PRESET' <api-app>/src/ai/runs/
```

## 위반 시 조치
1. timeout/maxTurns 매직 넘버 → `run-policy-presets` 상수 import 로 교체
2. preset import 없는 runs/ 파일 → invariant preset 사용 추가

## 통과 기준
- 패턴 1 — preset 상수 import (매직 넘버 ✕)
- 패턴 2 — runs/ 디렉토리에 preset 사용
