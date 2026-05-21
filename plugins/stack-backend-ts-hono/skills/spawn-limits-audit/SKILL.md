---
name: spawn-limits-audit
description: sub-agent / parallel call 코드 변경 후. spawn-limits invariant 의 max-parallel 상수 우회 검출.
metadata:
  role: audit
  scope: apps/api
  source: (신규)
  pair_invariant: spawn-limits
---

# spawn-limits-audit

## 검증 대상 invariant
[spawn-limits/SKILL.md](../spawn-limits/SKILL.md)

## 실행

```bash
# 패턴 1: Promise.all / allSettled 사용처에 limit 없음
grep -rEn 'Promise\.(all|allSettled)\(' apps/api/src/ai/sub-agents/ -A 3 | grep -B 3 -v 'limit\|MAX_PARALLEL\|p-limit'

# 패턴 2: invariant 상수 import 안 함
grep -rL 'SPAWN_LIMIT\|MAX_PARALLEL_SUBAGENTS' apps/api/src/ai/sub-agents/
```

## 위반 시 조치
1. `Promise.all` 직접 사용 → `p-limit` 또는 chunk 분할 적용
2. 상수 import 없는 파일 → `SPAWN_LIMIT` / `MAX_PARALLEL_SUBAGENTS` 상수 import 추가

## 통과 기준
- 모든 parallel 호출이 limit 적용 (`p-limit` 또는 chunk 분할)
