---
name: loop-audit
description: Operational checklist + grep patterns for auditing `backend/engine/loop.py` and `recovery.py` agent loop health. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/agent-loop-patterns.md`. Load this skill to detect stage-order violations, missing LoopTransition records, LoopDeps mock drift, and recovery constant mismatches.
allowed-tools: Read, Bash, Grep, Glob
---

# loop-audit — 에이전트 루프 감사 실행 가이드

## 이 skill은 언제 로드되는가

- `agent-loop-manager` sub-agent 호출 시 (loop-audit 모드)
- `backend/engine/loop.py` 또는 `recovery.py` 변경 후 정합성 점검
- LoopTransition 누락 / compaction 트리거 불일치 의심 시

## 이 skill은 언제 로드되지 않는가

- loop.py 내부 구현 작업 (→ `agent-loop` skill)
- compaction 로직 상세 (→ `compaction` skill)
- 런타임 디버깅 (→ `debug-session` skill)

## 원칙은 Rule 에 있다

**6-stage 순서 / LoopState / LoopTransition / Error Recovery** 는
`.agents/rules/python_agent_rules/agent-loop-patterns.md` 에 정의됨.

## 1. 6-Stage 순서 불변 검증

```bash
# 각 stage 메서드 정의 순서 확인
rg -n "def.*stage_[1-6]\|def.*_context_prep\|def.*_model_call\|def.*_error_recovery\|def.*_tool_exec\|def.*_context_merge\|def.*_loop_decision" backend/engine/loop.py

# 호출 순서가 1→2→3→4→5→6 인지 (메인 루프 내)
rg -n "stage\|_context_prep\|_model_call\|_error_recovery\|_tool_exec\|_context_merge\|_loop_decision" backend/engine/loop.py | head -30
```

## 2. LoopTransition 기록 누락

```bash
# LoopTransition enum 값 목록
rg -n "class LoopTransition\|completed\|aborted\|max_turns\|prompt_too_long\|model_error\|hook_stopped" backend/engine/types.py backend/engine/loop.py

# 루프 종료 지점에서 transition 기록 없는 경로 (VIOLATION)
rg -n "return\|break" backend/engine/loop.py | rg -v "transition\|LoopTransition"
```

## 3. LoopDeps Protocol ↔ Mock 동기화

```bash
# LoopDeps Protocol 메서드 목록
rg -n "class LoopDeps\|def " backend/engine/deps.py | head -20

# 테스트 mock 에서 동일 메서드 구현 여부
rg -n "LoopDeps\|mock.*deps\|FakeDeps\|MockDeps" backend/tests/ | head -20

# Protocol 메서드 수 vs mock 메서드 수 비교
echo "--- Protocol methods ---"
rg -c "def " backend/engine/deps.py
echo "--- Mock methods ---"
rg -c "def " backend/tests/_loop_fakes.py 2>/dev/null || echo "no _loop_fakes.py"
```

## 4. Partition ↔ is_concurrency_safe 정합

```bash
# partition 로직에서 is_concurrency_safe 호출
rg -n "is_concurrency_safe\|partition\|concurrent\|parallel\|sequential" backend/engine/loop.py

# gather 병렬 실행 시 exception 전파 확인
rg -n "gather\|asyncio\.gather" backend/engine/loop.py -A 3
```

## 5. Error Recovery 상수 ↔ Compaction Threshold

```bash
# recovery 상수 (재시도 횟수, 토큰 확대 등)
rg -n "MAX_RECOVERY\|max_retri\|token.*expand\|nudge" backend/engine/recovery.py backend/engine/loop.py

# compaction threshold 상수
rg -n "threshold\|RESERVED\|effective_window" backend/engine/compaction.py backend/engine/context.py
```

## 6. 도구 에러 자동 재시도 금지

```bash
# Stage 4 에서 도구 에러 후 자동 재시도 경로 (VIOLATION)
rg -n "retry.*tool\|tool.*retry" backend/engine/loop.py

# 올바른 패턴: is_error=True 로 모델에 반환
rg -n "is_error\|tool_result.*error" backend/engine/loop.py
```

## 리포트 템플릿

```markdown
## Loop Audit — <date>

### 6-Stage order
- [OK/FAIL] Stages defined and called in 1→2→3→4→5→6 order

### LoopTransition coverage
- [OK/FAIL] All exit paths record a LoopTransition
- [MISSING] <file:line> exit without transition record

### LoopDeps sync
- [OK/FAIL] Protocol has N methods, mock has N methods
- [DRIFT] <method> in Protocol but missing in mock

### Partition logic
- [OK/FAIL] is_concurrency_safe checked before parallel batch
- [OK/FAIL] gather propagates exceptions

### Recovery constants
- [OK/FAIL] Recovery limits consistent with compaction threshold

### Tool error policy
- [OK/FAIL] No automatic tool retry — errors returned to model
```

## 의존 파일

- `.agents/rules/python_agent_rules/agent-loop-patterns.md` — 불변식 원본
- `.agents/skills/agent-loop/` — 구현 가이드
- `backend/engine/loop.py` — 메인 루프
- `backend/engine/recovery.py` — error recovery
- `backend/engine/deps.py` — LoopDeps Protocol
- `backend/tests/_loop_fakes.py` — mock 구현

## 검증 체크리스트

- [ ] 6개 grep 블록 모두 실행
- [ ] 위반 사항을 리포트 카테고리에 배치
- [ ] `agent-loop-patterns.md` rule 참조로 근거 제시
- [ ] LoopDeps drift 발견 시 CRITICAL 표시

## 구현 중 막히면

- loop.py 없음 → NOT_YET_IMPLEMENTED
- LoopDeps 가 Protocol 이 아닌 ABC → 경고 보고 (core-infrastructure.md 위반)
- _loop_fakes.py 없음 → mock 파일 탐색 (`rg "LoopDeps" backend/tests/`)
