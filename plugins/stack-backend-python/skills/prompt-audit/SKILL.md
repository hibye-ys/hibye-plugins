---
name: prompt-audit
description: Operational checklist + grep patterns for auditing `backend/engine/context.py` prompt assembly health. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/context-assembly-patterns.md`. Load this skill to detect TokenBudget drift, dynamic values in static layers, attachment order violations, and dual-dedup bypasses.
allowed-tools: Read, Bash, Grep, Glob
---

# prompt-audit — 프롬프트 조립 감사 실행 가이드

## 이 skill은 언제 로드되는가

- `prompt-context-manager` sub-agent 호출 시 (audit 모드)
- `backend/engine/context.py` 또는 `backend/agents/prompts/` 변경 후 정합성 점검
- prompt cache 적중률 저하 원인 추적 시

## 이 skill은 언제 로드되지 않는가

- context.py 내부 구현 상세 이해 (→ `context-assembly` skill)
- compaction 로직 디버깅 (→ `compaction` skill)
- 새 에이전트 프롬프트 작성 (→ `new-agent` skill)

## 원칙은 Rule 에 있다

**불변식 / TokenBudget / attachment 순서 / dual dedup** 는 모두
`.agents/rules/python_agent_rules/context-assembly-patterns.md` 에 정의됨.

## 1. TokenBudget 상수 합계 검증

```bash
# TokenBudget 클래스에서 6개 영역 상수 확인
rg -n "BASE|AGENT|HINT|MEMORY|CONVERSATION|RESERVED" backend/engine/context.py | head -20

# 합계가 effective_window 와 일치하는지 (코드 내 assert 존재 여부)
rg -n "effective_window|total_input" backend/engine/context.py
```

## 2. System Prompt Layer 1/2 동적 값 금지

```bash
# base.md / agent prompts 에 동적 패턴이 있는지
rg -n "datetime|time\.|turn_count|session_id|random\.|uuid" backend/agents/prompts/
rg -n "datetime|time\.|turn_count|session_id|random\.|uuid" backend/runs/prompts/ 2>/dev/null

# context.py 의 build_system_prompt 에서 동적 값 삽입 여부
rg -n "datetime|time\(\)|random|uuid" backend/engine/context.py
```

## 3. Attachment 수집 순서 안정성

```bash
# attachment collector 에서 수집 순서 확인 (함수 호출 순서)
rg -n "attach|collect|append.*attachment" backend/engine/context.py

# 순서 변경 감지: git diff 로 최근 변경
git diff HEAD~5 -- backend/engine/context.py | rg "attach|collect" || echo "no recent changes"
```

## 4. Dual Dedup 우회 탐지

```bash
# 직접 append 패턴 (dedup 우회 = VIOLATION)
rg -n "\.append\(|\.extend\(" backend/engine/context.py | rg -i "memory|rule|inject"

# dedup set/LRU 사용 확인
rg -n "dedup|seen_set|lru" backend/engine/context.py
```

## 5. Memory > History 보존 우선순위

```bash
# truncate 로직에서 memory_prefix_len 참조 확인
rg -n "memory_prefix|truncat" backend/engine/context.py

# memory 구간이 history 보다 먼저 삭제되는 경로 (VIOLATION)
rg -n "def.*truncat|def.*trim" backend/engine/context.py -A 10
```

## 6. Context Hint 길이 제한

```bash
# 2000자 컷 로직 존재 확인
rg -n "2000|hint.*cut|hint.*truncat|hint.*limit" backend/engine/context.py
```

## 7. AssembledContext 불변성

```bash
# AssembledContext 가 dataclass(slots=True) 또는 frozen 인지
rg -n "AssembledContext|@dataclass" backend/engine/context.py | head -5

# Stage 2+ 에서 system_prompt / messages 수정 시도 (VIOLATION)
rg -n "assembled.*system_prompt\s*=|assembled.*messages\s*=" backend/engine/loop.py
```

## 8. 프롬프트 간 중복 탐지

```bash
# agents/prompts/ 와 runs/prompts/ 에서 동일 문구 반복
for f in backend/agents/prompts/*.md; do
  name=$(basename "$f")
  rg -c "$(head -3 "$f" | tail -1)" backend/runs/prompts/ 2>/dev/null && echo "DUP candidate: $name"
done
```

## 리포트 템플릿

```markdown
## Prompt Audit — <date>

### TokenBudget
- [OK/FAIL] 6 영역 합계 == effective_window

### Static layers
- [OK/FAIL] Layer 1/2 에 동적 값 없음
- [VIOLATION] <file:line> dynamic value in static prompt

### Attachment order
- [OK/FAIL] 수집 순서 변경 없음

### Dual dedup
- [OK/FAIL] 직접 append 없음, dedup 경유 확인

### Memory priority
- [OK/FAIL] memory > history truncate 순서

### Context hint
- [OK/FAIL] 2000자 제한 적용

### AssembledContext
- [OK/FAIL] Stage 2+ 에서 수정 시도 없음
```

## 의존 파일

- `.agents/rules/python_agent_rules/context-assembly-patterns.md` — 불변식 원본
- `.agents/skills/context-assembly/` — 구현 가이드
- `backend/engine/context.py` — 메인 구현
- `backend/agents/prompts/` — system prompt 파일들

## 검증 체크리스트

- [ ] 8개 grep 블록 모두 실행
- [ ] 위반 사항을 리포트 카테고리에 배치
- [ ] `context-assembly-patterns.md` rule 참조로 근거 제시
- [ ] cache 안정성 영향 여부 명시 (prefix 무효화 위험 항목 표시)

## 구현 중 막히면

- `backend/engine/context.py` 없음 → NOT_YET_IMPLEMENTED
- TokenBudget 클래스 없음 → 초기 구현으로 보고
- prompts/ 디렉토리 비어있음 → 에이전트 미등록 상태
