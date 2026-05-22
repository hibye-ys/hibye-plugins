---
name: spawn-limits-audit
description: sub-agent / parallel call 코드 변경 후. spawn-limits invariant 의 max-parallel 상수 + MAX_SPAWN_DEPTH depth 가드 우회 검출.
metadata:
  role: audit
  scope: project
  pair_invariant: spawn-limits
---

# spawn-limits-audit

## 검증 대상 invariant
[spawn-limits/SKILL.md](../spawn-limits/SKILL.md)

세 가지 안전망 모두 강제:
1. **max-parallel** — `Promise.all` 직접 사용 ✕ (`p-limit` 또는 chunk)
2. **MAX_SPAWN_DEPTH** — sub-agent spawn 전 depth 가드 (`checkDepth()` 또는 `SpawnDepthExceeded` throw) 필수
3. **상수 import** — magic number ✕

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 모든 패턴은 *file-level grep* — block-level / AST 검증 의무 ✕. PASS 출력은 *부분 신뢰* 만 의미. 정확한 invariant 준수 검증은 paired invariant SKILL.md 의 ## 실행 섹션 + 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: Promise.all / allSettled 사용처에 limit 없음
for f in $(grep -rlE 'Promise\.(all|allSettled)\(' <api-app>/src/ai/sub-agents/); do
  grep -qE 'limit|MAX_PARALLEL|p-limit' "$f" || echo "no-limit: $f"
done

# 패턴 2: invariant 상수 import 안 함
grep -rL 'SPAWN_LIMIT\|MAX_PARALLEL_SUBAGENTS' <api-app>/src/ai/sub-agents/

# 패턴 3: MAX_SPAWN_DEPTH 상수 정의 누락
rg -nP 'MAX_SPAWN_DEPTH' <api-app>/src/ai/sub-agents/ <api-app>/src/tools/spawn.ts 2>/dev/null \
  || echo "no MAX_SPAWN_DEPTH constant defined"

# 패턴 4: spawn 전 depth 가드 호출 누락 (VIOLATION)
# spawn / fork / createSubAgent 호출하는데 같은 함수 안 checkDepth / SpawnDepthExceeded 없음
for f in $(grep -rlE '(spawn|fork|createSubAgent)\(' <api-app>/src/ai/sub-agents/ <api-app>/src/tools/spawn.ts 2>/dev/null); do
  grep -qE 'checkDepth|SpawnDepthExceeded|depth\s*>=|depth\s*>' "$f" \
    || echo "depth-guard-missing: $f"
done

# 패턴 5: parent depth 상속 누락 — 자식 agent context 가 parent.depth + 1 미사용
rg -nP 'createSubAgent\(|spawnAgent\(' <api-app>/src/ai/sub-agents/ 2>/dev/null \
  | rg -v 'depth:\s*(parent|this|ctx)\.depth\s*\+\s*1' \
  || true
```

## 위반 시 조치
1. `Promise.all` 직접 사용 → `p-limit` 또는 chunk 분할 적용
2. 상수 import 없는 파일 → `SPAWN_LIMIT` / `MAX_PARALLEL_SUBAGENTS` 상수 import 추가
3. depth 가드 누락 → `if (parent.depth >= MAX_SPAWN_DEPTH) throw new SpawnDepthExceeded(parent.depth)` spawn 직전 삽입
4. parent depth 상속 누락 → `createSubAgent({ ...args, depth: parent.depth + 1 })` 명시

## 통과 기준
- 모든 parallel 호출이 limit 적용 (`p-limit` 또는 chunk 분할)
- 모든 spawn 경로에 depth 가드 + parent depth 상속
