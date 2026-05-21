---
name: api-audit
description: Consolidated checklist for auditing `backend/routes/` thin-layer compliance, `runs/*.yaml` RunPolicy schema, and pydantic-to-OpenAPI schema synchronization. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/api-routing-patterns.md` and `run-policy.md`. Load this skill for route, run-policy, and schema auditing.
allowed-tools: Read, Bash, Grep, Glob
---

# api-audit — API 라우팅 통합 감사 가이드

## 이 skill은 언제 로드되는가

- `api-manager` sub-agent 호출 시 (모든 모드)
- `backend/routes/` 또는 `runs/*.yaml` 변경 후 정합성 점검
- OpenAPI 스키마 ↔ pydantic 모델 불일치 의심 시

## 이 skill은 언제 로드되지 않는가

- SSE 스트리밍 감사 (→ `stream-audit` skill)
- 인증 구현 작업 (→ `api-routing-patterns` rule)
- 도메인 로직 구현 (→ 해당 서브시스템 skill)

## 원칙은 Rule 에 있다

- `.agents/rules/python_agent_rules/api-routing-patterns.md` — 라우팅 불변식
- `.agents/rules/python_agent_rules/run-policy.md` — RunPolicy 필드/검증

## Part A: Route Thin-Layer 검증

### A1. 도메인 로직 누출 탐지

```bash
# routes 에서 직접 provider / tool / writer 호출 (VIOLATION)
rg -n "from backend\.providers\|from backend\.tools\|from backend\.data\.writer" backend/routes/

# routes 에서 직접 DB/파일 쓰기
rg -n "\.write_text\|\.write_bytes\|json\.dump" backend/routes/
```

### A2. 인증 의존성 검증

```bash
# Depends(require_auth) 사용 현황 (health 제외 모든 엔드포인트 필수)
for f in backend/routes/*.py; do
  name=$(basename "$f" .py)
  [ "$name" = "__init__" ] || [ "$name" = "_common" ] && continue
  routes=$(rg -c "@router\.\|@app\." "$f" 2>/dev/null || echo 0)
  auths=$(rg -c "require_auth" "$f" 2>/dev/null || echo 0)
  [ "$routes" -gt "$auths" ] && echo "MISSING AUTH: $name ($routes routes, $auths auth deps)"
done
```

### A3. 에러 변환 패턴

```bash
# HTTPException 이 engine 내부에서 raise (VIOLATION — routes/_common.py 만 허용)
rg -n "HTTPException" backend/engine/ backend/providers/ backend/tools/ backend/services/

# 에러 JSON 포맷 고정 {error: {code, message, details}}
rg -n "JSONResponse\|HTTPException" backend/routes/ | head -20
```

### A4. response_model 명시

```bash
# response_model 없는 엔드포인트 (경고)
rg -n "@router\." backend/routes/ | rg -v "response_model"
```

## Part B: RunPolicy 검증

### B1. YAML 스키마 파싱

```bash
# 모든 runs/*.yaml 에 필수 필드 존재
for f in backend/runs/*.yaml; do
  name=$(basename "$f")
  has_name=$(rg -c "^name:" "$f" 2>/dev/null || echo 0)
  has_prompt=$(rg -c "system_prompt_file:" "$f" 2>/dev/null || echo 0)
  echo "$name: name=$has_name prompt=$has_prompt"
done
```

### B2. Cross-field 검증

```bash
# spawn_enabled=true 인데 allowed_tools 에 spawn_agent 없는 경우
for f in backend/runs/*.yaml; do
  spawn=$(rg -c "spawn_enabled.*true\|spawn_enabled.*True" "$f" 2>/dev/null || echo 0)
  has_spawn_tool=$(rg -c "spawn_agent" "$f" 2>/dev/null || echo 0)
  allowed_null=$(rg -c "allowed_tools.*null\|allowed_tools.*None" "$f" 2>/dev/null || echo 0)
  if [ "$spawn" -gt 0 ] && [ "$has_spawn_tool" -eq 0 ] && [ "$allowed_null" -eq 0 ]; then
    echo "VIOLATION: $(basename $f) spawn_enabled but no spawn_agent in tools"
  fi
done
```

### B3. 중복 name 탐지

```bash
# 같은 name 으로 2개 YAML
rg -h "^name:" backend/runs/*.yaml 2>/dev/null | sort | uniq -d
```

### B4. Prompt 파일 존재

```bash
# system_prompt_file 참조 검증
for f in backend/runs/*.yaml; do
  prompt=$(rg "system_prompt_file:" "$f" 2>/dev/null | sed 's/.*: *//')
  [ -n "$prompt" ] && {
    test -f "backend/runs/prompts/$prompt" || echo "MISSING: $prompt (from $f)"
  }
done
```

## Part C: Schema Sync 검증

### C1. routes/schemas.py ↔ engine/types.py 중복

```bash
# 양쪽에 같은 이름의 클래스
comm -12 \
  <(rg -o "class \w+" backend/routes/schemas.py 2>/dev/null | sort) \
  <(rg -o "class \w+" backend/engine/types.py 2>/dev/null | sort)
```

### C2. OpenAPI 노출 확인

```bash
# response_model 로 지정된 모델이 schemas.py 에 존재하는지
rg -o "response_model=\w+" backend/routes/ | sed 's/.*=//' | sort -u | while read model; do
  rg -q "class $model" backend/routes/schemas.py 2>/dev/null || \
  rg -q "class $model" backend/engine/types.py 2>/dev/null || \
  echo "MISSING SCHEMA: $model"
done
```

## 리포트 템플릿

```markdown
## API Audit — <date>

### Part A: Route compliance
- [OK/FAIL] No domain logic in routes
- [OK/FAIL] All routes have auth dependency
- [OK/FAIL] HTTPException only in routes layer
- [OK/FAIL] response_model specified

### Part B: RunPolicy
- [OK/FAIL] All YAMLs have required fields
- [OK/FAIL] Cross-field validation (spawn/tools)
- [OK/FAIL] No duplicate names
- [OK/FAIL] All prompt files exist

### Part C: Schema sync
- [OK/FAIL] No class duplication between schemas.py and types.py
- [OK/FAIL] All response_model classes exist
```

## 검증 체크리스트

- [ ] Part A~C 모든 블록 실행
- [ ] VIOLATION 을 카테고리별 분류
- [ ] rule 참조로 근거 제시

## 구현 중 막히면

- runs/*.yaml 없음 → "no run policies defined"
- schemas.py 없음 → "response schemas not yet extracted"
- routes/ 파일 1개뿐 → 그 파일만 검사
