---
name: agent-verify-def
description: 새 agent YAML 추가 후 또는 배포 전 invoke. <api-app>/src/agents/<name>.yaml 이 [[ai-agent-patterns]] AgentDefinitionSchema 의 필수 필드 (name 정규식 `^[a-z0-9_]+$` / systemPromptFile) + name == 파일 stem 일치 + name 중복 ✕ 를 grep 으로 검증. 정본 zod schema 가 AgentDefinitionSchema 변경 시 본 audit + audit-all.sh #14 동시 갱신 의무.
metadata:
  role: audit
  scope: project
pair_invariant: ai-agent-patterns
---

# agent-verify-def — agent 정의 정합성 audit

## 검증 대상 invariant

[[ai-agent-patterns]] 의 `AgentDefinitionSchema` 가 정본. backend-ts 의 agent 정의는 **YAML + markdown prompt** 분리:

- `<api-app>/src/agents/<name>.yaml` — `AgentDefinitionSchema` 인스턴스
- `<api-app>/src/agents/prompts/<name>.md` — `systemPromptFile` 이 가리키는 prompt

정본 schema (zod `.strict()` — [[ai-agent-patterns]] L60-75):

| 필드 | 필수 | zod 타입 | 제약 |
|---|---|---|---|
| `name` | ✅ | `z.string().regex(/^[a-z0-9_]+$/).min(1).max(64)` | regex + length + *파일 stem 과 일치* (`loadAgent()` 의 convention) |
| `systemPromptFile` | ✅ | `z.string()` | zod 자체 제약 ✕. `loadAgentPrompt()` 가 `prompts/` 하위에서 resolve 하는 *project invariant* — zod 스키마에는 없음 |
| `modelPreference` | default `'default'` | `z.string().default('default')` | provider fallback chain 이름 ([[provider-retry-matrix]]) |
| `maxToolRounds` | default `10` | `z.number().int().min(1).max(100).default(10)` | int 1-100 |
| `description` | optional | `z.string().nullable().optional()` | null 허용 |
| `tools` | optional | `z.array(z.string()).nullable().optional()` | null = 전체 허용 / `[]` = 도구 없음 / list = 화이트리스트 |
| `temperature` | optional | `z.number().min(0).max(2).nullable().optional()` | 0 ≤ x ≤ 2 |

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 모든 패턴은 *file-level grep* — block-level / AST 검증 의무 ✕. PASS 출력은 *부분 신뢰* 만 의미. 정확한 invariant 준수 검증은 [[ai-agent-patterns]] 의 `.strict()` zod parse (`loadAgent()` 호출 시) + runtime 통합 테스트 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: 필수 필드 누락 (name / systemPromptFile)
for f in <api-app>/src/agents/*.yaml; do
  [[ -f "$f" ]] || continue
  for field in name systemPromptFile; do
    grep -q "^${field}:" "$f" || echo "$f: missing $field"
  done
done

# 패턴 2: name regex 위반 (^[a-z0-9_]+$, 1-64 chars)
grep -hE "^name:" <api-app>/src/agents/*.yaml 2>/dev/null \
  | sed -E "s/^name:[[:space:]]*['\"]?([^'\"[:space:]]+)['\"]?.*/\1/" \
  | grep -vE '^[a-z0-9_]{1,64}$' \
  | while read bad; do echo "name regex violation: $bad"; done

# 패턴 3: name != 파일 stem 불일치
for f in <api-app>/src/agents/*.yaml; do
  [[ -f "$f" ]] || continue
  stem=$(basename "$f" .yaml)
  name=$(grep -hE "^name:" "$f" | head -1 \
    | sed -E "s/^name:[[:space:]]*['\"]?([^'\"[:space:]]+)['\"]?.*/\1/")
  [[ -n "$name" && "$stem" != "$name" ]] && echo "$f: name '$name' != file stem '$stem'"
done

# 패턴 4: name 중복
grep -hE "^name:" <api-app>/src/agents/*.yaml 2>/dev/null \
  | sed -E "s/^name:[[:space:]]*['\"]?([^'\"[:space:]]+)['\"]?.*/\1/" \
  | sort | uniq -d
```

## 통과 기준

- 패턴 1 출력 **0줄** (모든 agent YAML 이 `name` + `systemPromptFile`)
- 패턴 2 출력 **0줄** (name regex 준수 — `.strict()` 가 어차피 reject 하지만 grep 이 fast-fail)
- 패턴 3 출력 **0줄** (name == 파일 stem — `loadAgent("<name>")` 가 `<name>.yaml` 찾으므로 일치 필수)
- 패턴 4 출력 **0줄** (중복 name ✕ — `Map` 캐시 silent overwrite 위험)

## 위반 시 조치

### 패턴 1 위반 — 필수 필드 누락

```yaml
# 위반 예시
name: writer
# systemPromptFile 누락 — loadAgent() 가 ZodError throw
modelPreference: claude-3-5-sonnet
```

조치 — 정본 schema 따라 모든 필수 필드 채움:

```yaml
name: writer
description: Long-form writing agent
systemPromptFile: writer.md
modelPreference: claude-3-5-sonnet
maxToolRounds: 10
tools: [search, fileRead]
```

### 패턴 2 위반 — name regex

정본 regex: `^[a-z0-9_]+$`. 대문자 / 하이픈 / 특수문자 모두 거부 (zod `.strict()` 가 ZodError throw).

```yaml
# 위반: 대문자
name: WriterAgent

# 위반: 하이픈
name: writer-agent
```

→ snake_case 또는 lowercase: `name: writer`, `name: writer_agent`.

### 패턴 3 위반 — 파일 stem 불일치

`<api-app>/src/agents/writer.yaml` 의 `name: assistant` → `loadAgent("writer")` 가 *assistant* 정의 로딩 → registry confusion.

조치: 둘 중 하나 일치시킴. `loadAgent()` 가 `<name>.yaml` 을 찾는 규약이므로 *파일명 기준 name 갱신* 권장.

### 패턴 4 위반 — name 중복

같은 `name` 을 가진 정의 둘 이상 → `loadAgent()` 의 `Map<string, AgentDefinition>` 캐시가 마지막 로딩 정의로 silent overwrite. 조치:

- 한쪽의 `name` 을 의미 차이가 드러나는 값으로 변경
- 또는 한쪽의 YAML 자체를 제거 (의도치 않은 사본)

---

## audit 이 커버하지 않는 것

- **zod parse 자체** — `loadAgent()` 호출 시 `.strict()` 가 ZodError throw (block-level 검증은 runtime 의 책임)
- **prompt 파일 존재 확인** — `systemPromptFile` 이 가리키는 `prompts/<file>.md` 실재는 `loadAgentPrompt()` 시점에 결정 (`ResourceError` throw)
- **Coordinator vs Worker 도구 화이트리스트** — [[ai-agent-patterns]] §"Tool 선택 휴리스틱" + 별도 통합 테스트
- **registry 등록** — `discoverAgents()` 가 picking up 하는지 (`/debug/agents` 응답 + UI tree view)

## 본 audit + audit-all.sh sync 의무

같은 패턴이 [`scripts/audit-all.sh`](../../scripts/audit-all.sh) 의 `agent_verify_def_check()` 함수에 mirror. 본 SKILL.md 의 패턴 변경 시 *동시 갱신* 필수 — drift 시 fast-fail audit (audit-all.sh) 와 manual audit (본 skill) 가 서로 다른 검증.

[[ai-agent-patterns]] `AgentDefinitionSchema` 필드 추가 / 변경 시 다음 *3 곳 동시 갱신*:

1. [[ai-agent-patterns]] §"`AgentDefinition` 스키마" — 정본
2. 본 SKILL.md 의 §검증 대상 / §실행 패턴 1
3. `audit-all.sh` 의 `agent_verify_def_check()` 함수의 `for field in ...` 라인
