---
name: agent-verify-def
description: Checklist for validating agent YAML definitions (`backend/agents/*.yaml`) and system prompts. Distinct from `/agent-verify` command (which runs runtime-verify). Load this skill to check YAML schema, tool allowlist existence, prompt template conformance, and coordinator/worker role correctness.
allowed-tools: Read, Bash, Grep, Glob
---

# agent-verify-def — 에이전트 정의 검증 가이드

## 이 skill은 언제 로드되는가

- `new-agent-builder` sub-agent 호출 시 (verify 모드)
- 새 에이전트 YAML 생성 후 정합성 확인
- 기존 에이전트 정의 수정 후 검증

## 이 skill은 언제 로드되지 않는가

- 런타임 검증 (→ `/agent-verify` command → `runtime-verify` skill)
- 새 에이전트 YAML 처음 생성 (→ `new-agent` skill)
- 서브에이전트 spawn 로직 (→ `sub-agent-spawn` skill)

## 원칙은 Rule 에 있다

`.agents/rules/python_agent_rules/ai-agent-patterns.md` §새 에이전트 추가하기,
`.agents/rules/python_agent_rules/sub-agent-patterns.md` §coordinator/worker 참조.

## 1. YAML 스키마 필수 필드

```bash
# 모든 agent YAML 에서 필수 필드 존재 확인
for f in backend/agents/*.yaml; do
  name=$(basename "$f")
  has_name=$(rg -c "^name:" "$f" 2>/dev/null || echo 0)
  has_desc=$(rg -c "^description:" "$f" 2>/dev/null || echo 0)
  has_prompt=$(rg -c "system_prompt_file:" "$f" 2>/dev/null || echo 0)
  echo "$name: name=$has_name desc=$has_desc prompt=$has_prompt"
done
```

## 2. System Prompt 파일 존재

```bash
# YAML 의 system_prompt_file 이 가리키는 파일 존재 확인
for f in backend/agents/*.yaml; do
  prompt_file=$(rg "system_prompt_file:" "$f" 2>/dev/null | sed 's/.*: *//')
  if [ -n "$prompt_file" ]; then
    test -f "backend/agents/prompts/$prompt_file" && echo "OK: $prompt_file" || echo "MISSING: $prompt_file (from $f)"
  fi
done
```

## 3. Tool Allowlist 존재 검증

```bash
# YAML 의 tools 리스트에서 각 도구가 registry 에 존재하는지
for f in backend/agents/*.yaml; do
  rg "^  - " "$f" 2>/dev/null | sed 's/^  - //' | while read tool; do
    rg -q "\"$tool\"\|'$tool'" backend/tools/registry.py 2>/dev/null || echo "UNKNOWN tool: $tool (in $f)"
  done
done
```

## 4. Prompt 내 동적 값 금지

```bash
# system prompt 에 동적 패턴 (Layer 1/2 금지)
rg -n "datetime\|time\.\|turn_count\|session_id\|random\.\|uuid\." backend/agents/prompts/ 2>/dev/null
```

## 5. Coordinator/Worker 역할 검증

```bash
# coordinator 에이전트: tools 에 spawn_agent 또는 agent 도구 포함해야 함
for f in backend/agents/*.yaml; do
  is_coord=$(rg -c "coordinator\|role.*coord" "$f" 2>/dev/null || echo 0)
  has_agent_tool=$(rg -c "spawn_agent\|agent" "$f" 2>/dev/null || echo 0)
  if [ "$is_coord" -gt 0 ] && [ "$has_agent_tool" -eq 0 ]; then
    echo "WARN: $(basename $f) is coordinator but lacks agent tools"
  fi
done

# worker 에이전트: spawn_agent 금지
for f in backend/agents/*.yaml; do
  is_worker=$(rg -c "worker\|role.*worker" "$f" 2>/dev/null || echo 0)
  has_spawn=$(rg -c "spawn_agent" "$f" 2>/dev/null || echo 0)
  if [ "$is_worker" -gt 0 ] && [ "$has_spawn" -gt 0 ]; then
    echo "VIOLATION: $(basename $f) is worker but has spawn_agent"
  fi
done
```

## 6. Model Preference 유효성

```bash
# model_preference 가 존재하는 fallback chain 을 참조하는지
for f in backend/agents/*.yaml; do
  pref=$(rg "model_preference:" "$f" 2>/dev/null | sed 's/.*: *//')
  [ -n "$pref" ] && echo "$(basename $f): model_preference=$pref"
done
```

## 리포트 템플릿

```markdown
## Agent Definition Audit — <date>

### Schema completeness
- [OK/FAIL] All YAMLs have name, description, system_prompt_file

### Prompt files
- [OK/FAIL] All referenced prompt files exist
- [MISSING] <prompt_file> referenced by <yaml>

### Tool allowlist
- [OK/FAIL] All listed tools exist in registry
- [UNKNOWN] <tool_name> in <yaml>

### Dynamic values
- [OK/FAIL] No dynamic values in system prompts

### Role correctness
- [OK/FAIL] Coordinators have agent tools
- [OK/FAIL] Workers lack spawn_agent
```

## 의존 파일

- `backend/agents/*.yaml` — 에이전트 정의
- `backend/agents/prompts/*.md` — system prompt 파일
- `backend/tools/registry.py` — 도구 등록 목록

## 검증 체크리스트

- [ ] 6개 체크 블록 실행
- [ ] 모든 YAML 검증 완료
- [ ] 위반 사항 분류 (MISSING / UNKNOWN / VIOLATION)

## 구현 중 막히면

- backend/agents/*.yaml 없음 → 에이전트 미등록 상태
- registry.py 구조 모름 → `rg "register\|_tools" backend/tools/registry.py`
