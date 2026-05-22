---
name: agent-verify-def
description: 새 agent 정의 추가 후 또는 배포 전 invoke. apps/api/src/agents/*.ts 의 default export 가 AgentDef 인터페이스 필수 필드 (name / version / step / modelMix) 를 모두 채우는지 + name 중복 ✕ 를 grep 으로 검증.
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/agent-verify-def
---

# agent-verify-def — agent 정의 정합성 audit

## 검증 대상 invariant

`apps/api/src/agents/*.ts` 의 default export = `AgentDef` 구현. 필수 필드 4개 (`name`, `version`, `step`, `modelMix`) 모두 채워야 하며, 같은 `name` 값을 가진 정의가 둘 이상 존재하면 등록 충돌이 발생한다.

- `name` — registry key. 중복 ✕
- `version` — semver string, 호환성 추적
- `step` — agentic loop step 구현 함수
- `modelMix` — provider 선택 정책 (provider-retry-matrix 와 짝)

## 실행

```bash
# 패턴 1: 필수 필드 누락 — file-level loop
for f in apps/api/src/agents/*.ts; do
  [[ -f "$f" ]] || continue
  for field in name version step modelMix; do
    grep -q "$field" "$f" || echo "$f: missing $field"
  done
done

# 패턴 2: name 중복 — sed extract (awk -F'"' 단일 quote 손실 회피)
grep -hE "^\s*name:\s*['\"]" apps/api/src/agents/*.ts 2>/dev/null \
  | sed -E "s/.*name:\s*['\"]([^'\"]+)['\"].*/\1/" \
  | sort | uniq -d
```

## 통과 기준

- 패턴 1 출력 **0줄** (모든 agent 가 4 필수 필드 보유)
- 패턴 2 출력 **0줄** (중복 name ✕)

## 위반 시 조치

### 패턴 1 위반 — 필드 누락

```typescript
// 위반 예시
const agent = {
  name: 'writer',
  // version 누락
  // step 누락
  modelMix: { ... },
}
export default agent
```

조치 — `AgentDef` 인터페이스에 맞춰 누락된 필드 채움:

```typescript
import type { AgentDef } from '@/agents/types'

const agent: AgentDef = {
  name: 'planner',
  version: '1.0.0',
  step: async (ctx) => { /* ... */ },
  modelMix: { primary: 'gpt-4o', fallback: 'claude-3-5-sonnet' },
}
export default agent
```

### 패턴 2 위반 — name 중복

같은 `name` 을 가진 agent 정의가 둘 이상이면 registry 가 마지막 import 한 정의로 silent overwrite 한다. 조치:

- 한쪽의 `name` 을 의미 차이가 드러나는 값으로 변경
- 또는 한쪽의 파일 자체를 제거 (의도치 않은 사본인 경우)

---

## audit 이 커버하지 않는 것

- 런타임 검증 (실제 step 실행 시 동작 정합) → `runtime-verify` 가 담당
- registry import 누락 (정의는 있는데 registry 에 등록 안 됨) → 별도 통합 테스트
