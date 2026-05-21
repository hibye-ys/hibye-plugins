---
name: session-audit
description: Checklist for auditing `backend/state/session.py` SessionPort compliance, LRU capacity, session store Protocol migration readiness, and user_id propagation. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/data-layer-patterns.md` and `database-patterns.md`.
allowed-tools: Read, Bash, Grep, Glob
---

# session-audit — 세션 관리 감사 가이드

## 이 skill은 언제 로드되는가

- `data-state-manager` sub-agent 호출 시 (session 모드)
- `backend/state/session.py` 변경 후 정합성 점검
- session store Protocol Postgres 이관 준비 상태 확인 시

## 이 skill은 언제 로드되지 않는가

- 데이터 레이어 감사 (→ `data-audit` skill)
- 마이그레이션 계획 (→ `migration-planning` skill)
- DB 구현 작업 (→ `database-patterns` rule)

## 원칙은 Rule 에 있다

- `.agents/rules/python_agent_rules/database-patterns.md` §SessionPort 시그니처
- `.agents/rules/python_agent_rules/data-layer-patterns.md` §단일 작성자

## 1. SessionPort Protocol 준수

```bash
# SessionPort 정의
rg -n "class SessionPort\|class.*Session.*Protocol" backend/data/ports.py

# 구현체가 Protocol 메서드를 모두 구현하는지
rg -n "def get\|def ensure_session\|def record_turn\|def delete" backend/state/session.py
```

## 2. LRU 상한 확인

```bash
# LRU 크기 / maxlen / 상한 상수
rg -n "maxlen\|max_size\|LRU\|OrderedDict\|10000\|10_000" backend/state/session.py
```

## 3. user_id 전파 검증

```bash
# session 생성 시 user_id 주입 확인
rg -n "user_id" backend/state/session.py

# routes 에서 auth → session 으로 user_id 전달
rg -n "user_id\|auth\[.user_id" backend/routes/run.py backend/routes/sessions.py 2>/dev/null
```

## 4. 단일 작성자 (state/session.py 만 write)

```bash
# session 상태를 다른 곳에서 직접 수정 (VIOLATION)
rg -n "session.*\[.*\]\s*=\|sessions\.\|_sessions\." backend/ -g '!backend/state/*' -g '!backend/tests/*'
```

## 5. StoragePort 추상화 (StoragePort)

```bash
# 호출자가 구체 구현체 이름에 의존하는지 (VIOLATION)
rg -n "InMemorySession\|FileSession\|DbSession" backend/engine/ backend/routes/ backend/tools/

# Protocol 타입으로만 참조하는지
rg -n "SessionPort\|session.*Port" backend/engine/ backend/routes/
```

## 6. session store Protocol 이관 준비

```bash
# ensure_session / record_turn 이 atomic 패턴인지
rg -n "ensure_session\|record_turn" backend/state/session.py -A 5

# DB 구현체 skeleton 존재 여부 ( 준비)
rg -rn "DbSession\|PostgresSession" backend/state/ backend/db/ 2>/dev/null
```

## 리포트 템플릿

```markdown
## Session Audit — <date>

### SessionPort compliance
- [OK/FAIL] All Protocol methods implemented

### LRU capacity
- [OK/FAIL] Max size defined (expect ~10K)

### user_id propagation
- [OK/FAIL] user_id flows from auth → session

### Single writer
- [OK/FAIL] Only state/session.py writes session state

### StoragePort abstraction (StoragePort)
- [OK/FAIL] Callers use SessionPort, not concrete class

### session store Protocol readiness
- [INFO] DB implementation: <exists/not_yet>
```

## 검증 체크리스트

- [ ] 6개 체크 블록 실행
- [ ] 위반 사항 분류
- [ ] session store Protocol / StoragePort 준수 여부 명시

## 구현 중 막히면

- session.py 없음 → NOT_YET_IMPLEMENTED
- ports.py 없음 → StoragePort 미구현 경고
- LRU 상한 없음 → 메모리 누수 위험 경고
