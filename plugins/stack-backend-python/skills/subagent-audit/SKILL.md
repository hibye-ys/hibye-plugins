---
name: subagent-audit
description: Operational checklist + grep patterns for auditing `backend/engine/subagent.py` and `backend/tools/agents.py` sub-agent spawn health. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/sub-agent-patterns.md`. Load this skill to detect depth-limit bypasses, coordinator/worker role violations, CacheSafeParams drift, and state isolation failures.
allowed-tools: Read, Bash, Grep, Glob
---

# subagent-audit — 서브에이전트 감사 실행 가이드

## 이 skill은 언제 로드되는가

- `sub-agent-manager` sub-agent 호출 시 (spawn-audit 모드)
- `backend/engine/subagent.py` 또는 `backend/tools/agents.py` 변경 후 정합성 점검
- 무한 재귀 / state 오염 의심 시

## 이 skill은 언제 로드되지 않는가

- sub-agent 구현 작업 (→ `sub-agent-spawn` skill)
- 새 에이전트 YAML 작성 (→ `new-agent` skill)
- 에이전트 루프 디버깅 (→ `agent-loop` skill + `debug-session` skill)

## 원칙은 Rule 에 있다

**3 execution modes / depth 제한 / CacheSafeParams / state isolation** 은
`.agents/rules/python_agent_rules/sub-agent-patterns.md` 에 정의됨.

## 1. Depth 제한 준수

```bash
# MAX_SPAWN_DEPTH 상수 정의
rg -n "MAX_SPAWN_DEPTH\|max_spawn_depth" backend/engine/subagent.py backend/tools/agents.py

# check_depth() 호출이 spawn 전에 반드시 존재
rg -n "check_depth\|SpawnDepthExceeded" backend/engine/subagent.py backend/tools/agents.py

# spawn 경로에서 depth 검증 없이 생성 (VIOLATION)
rg -n "spawn\|fork\|create.*agent" backend/engine/subagent.py | rg -v "check_depth\|depth"
```

## 2. Coordinator / Worker 역할 분리

```bash
# coordinator 도구 제한 (agent, send_message, task_stop 만)
rg -n "coordinator\|orchestrat" backend/agents/*.yaml backend/engine/subagent.py 2>/dev/null

# worker 에 AgentTool 노출 (VIOLATION — 무한 재귀)
rg -n "agent.*tool\|spawn_agent" backend/agents/*.yaml | rg -iv "coordinator"
```

## 3. CacheSafeParams byte-identical 상속

```bash
# CacheSafeParams 클래스/사용처
rg -n "CacheSafeParams\|cache_safe\|use_exact_tools" backend/engine/subagent.py

# fork agent 에서 parent model/prompt/tools 와 다른 값 설정 (VIOLATION)
rg -n "fork.*model\|fork.*prompt\|fork.*tools" backend/engine/subagent.py | rg -v "parent\|inherit\|same"
```

## 4. State Isolation (deepcopy)

```bash
# deepcopy 사용 확인
rg -n "deepcopy\|copy\(\)" backend/engine/subagent.py

# abort signal 만 공유 (유일한 예외)
rg -n "abort\|cancel\|signal" backend/engine/subagent.py | rg "share\|parent\|cascade"

# mutable state 공유 경로 (VIOLATION)
rg -n "\.messages\s*=\|\.state\s*=\|\.tools\s*=" backend/engine/subagent.py | rg -v "deepcopy\|clone\|copy"
```

## 5. Deterministic ID 형식

```bash
# ID 생성 패턴: {name}@{team}
rg -n "agent_id\|deterministic.*id\|@" backend/engine/subagent.py | head -10

# @ 구분자가 name/team 에 포함되지 않는지
rg -n "name.*@\|team.*@" backend/agents/*.yaml 2>/dev/null
```

## 6. Background Agent 완료 알림

```bash
# task notification 구현
rg -n "notification\|task_complete\|background.*done" backend/engine/subagent.py

# silent finish (VIOLATION — inbox 비어있음 버그)
rg -n "return\|finish\|complete" backend/engine/subagent.py | rg -v "notification\|notify\|inbox"
```

## 리포트 템플릿

```markdown
## Sub-agent Audit — <date>

### Depth limit
- [OK/FAIL] MAX_SPAWN_DEPTH defined, check_depth() called before every spawn

### Role separation
- [OK/FAIL] Coordinators: orchestration tools only
- [OK/FAIL] Workers: no AgentTool exposure
- [VIOLATION] <agent.yaml> worker has spawn_agent

### CacheSafeParams
- [OK/FAIL] Fork agents inherit parent model/prompt/tools byte-identical

### State isolation
- [OK/FAIL] deepcopy on messages, tool decisions, file cache
- [OK/FAIL] Only abort signal shared (cascade)

### Deterministic ID
- [OK/FAIL] {name}@{team} format, no @ in name/team

### Completion notification
- [OK/FAIL] Background agents emit structured notification
```

## 의존 파일

- `.agents/rules/python_agent_rules/sub-agent-patterns.md` — 불변식 원본
- `.agents/skills/sub-agent-spawn/` — 구현 가이드
- `backend/engine/subagent.py` — 메인 구현
- `backend/tools/agents.py` — AgentTool
- `backend/agents/*.yaml` — 에이전트 정의

## 검증 체크리스트

- [ ] 6개 grep 블록 모두 실행
- [ ] 위반 사항을 리포트 카테고리에 배치
- [ ] `sub-agent-patterns.md` rule 참조로 근거 제시
- [ ] 무한 재귀 위험은 CRITICAL 표시

## 구현 중 막히면

- subagent.py 없음 → NOT_YET_IMPLEMENTED
- agents.py 에 AgentTool 없음 → spawn 미구현으로 보고
- backend/agents/*.yaml 없음 → 에이전트 미등록 상태
