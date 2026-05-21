---
name: infra-audit
description: Consolidated checklist for auditing asyncio concurrency primitives, blocking I/O detection, connection pool sizing, and resource leak risks in `backend/`. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/core-infrastructure.md`.
allowed-tools: Read, Bash, Grep, Glob
---

# infra-audit — 인프라/동시성 통합 감사 가이드

## 이 skill은 언제 로드되는가

- `infra-performance-manager` sub-agent 호출 시 (concurrency / resource 모드)
- asyncio 관련 코드 변경 후 정합성 점검
- 리소스 누수 / 연결 풀 문제 의심 시

## 이 skill은 언제 로드되지 않는가

- 성능 벤치마크 측정 (→ `performance-profiling` skill)
- 런타임 디버깅 (→ `debug-session` skill)
- 아키텍처 계층 감사 (→ `architecture-invariants` skill)

## 원칙은 Rule 에 있다

`.agents/rules/python_agent_rules/core-infrastructure.md` — stateless, async, ContextVar 규약

## Part A: 동시성 감사

### A1. asyncio.Lock 사용 패턴

```bash
# Lock 인스턴스 확인 (per-category 여야 함)
rg -n "asyncio\.Lock\|Lock()" backend/ -g '!backend/tests/*'

# 글로벌 Lock (VIOLATION — per-resource 여야 함)
rg -n "^_lock\s*=\|^lock\s*=" backend/ -g '!backend/tests/*'
```

### A2. asyncio.gather exception 전파

```bash
# gather 호출 시 return_exceptions 여부
rg -n "asyncio\.gather" backend/ -A 1

# return_exceptions=True 인 경우 결과에서 Exception 체크 여부
rg -n "return_exceptions" backend/ -A 5 | rg "isinstance.*Exception\|raise"
```

### A3. Blocking I/O in async

```bash
# async 함수 내 blocking 호출 (VIOLATION 후보)
rg -n "def.*async\|async def" backend/ -A 20 | rg "time\.sleep\|\.read()\|\.write()\|requests\.\|urllib" | head -20

# to_thread 래핑 확인
rg -n "to_thread\|run_in_executor" backend/
```

### A4. asyncio.Queue 사용

```bash
# Queue 인스턴스와 worker 동시성
rg -n "asyncio\.Queue\|Queue()" backend/

# worker 동시성 상수
rg -n "max_workers\|concurrent\|semaphore\|Semaphore" backend/
```

## Part B: 리소스 감사

### B1. 파일 핸들 누수

```bash
# context manager 없이 open (VIOLATION 후보)
rg -n "open(" backend/ -g '!backend/tests/*' | rg -v "with \|async with\|#"
```

### B2. ContextVar 범위

```bash
# ContextVar 선언
rg -n "ContextVar" backend/

# ContextVar 가 요청 범위에서만 설정되는지 (부팅 설정에 사용하면 VIOLATION)
rg -n "ContextVar" backend/ -B 2 | rg "settings\|config\|startup"
```

### B3. 글로벌 mutable state

```bash
# 모듈 레벨 mutable dict/list (VIOLATION)
rg -n "^[a-z_]*:\s*dict\s*=\|^[a-z_]*:\s*list\s*=\|^[a-z_]*\s*=\s*\{\}\|^[a-z_]*\s*=\s*\[\]" backend/ -g '!backend/tests/*' -g '!backend/__init__.py'
```

### B4. Rate Limit 설정

```bash
# rate limit 구현
rg -n "rate_limit\|RateLimit\|Semaphore\|throttle" backend/

# media 별도 rate limit
rg -n "rate.*media\|media.*limit" backend/
```

## 리포트 템플릿

```markdown
## Infra Audit — <date>

### Part A: Concurrency
- [OK/FAIL] Locks are per-resource, not global
- [OK/FAIL] gather exceptions properly propagated
- [OK/FAIL] No blocking I/O in async paths
- [OK/FAIL] Queue workers have bounded concurrency

### Part B: Resources
- [OK/FAIL] All file opens use context manager
- [OK/FAIL] ContextVar only for request-scoped data
- [OK/FAIL] No global mutable state
- [OK/FAIL] Rate limiting configured
```

## 검증 체크리스트

- [ ] Part A + B 모든 블록 실행
- [ ] blocking I/O 발견 시 CRITICAL 표시 (이벤트 루프 차단)
- [ ] `core-infrastructure.md` rule 참조로 근거 제시

## 구현 중 막히면

- asyncio 코드 적음 → 간단 보고
- Queue 없음 → "no async queue infrastructure"
- 블로킹 의심 코드 → `rg "time\.sleep"` 으로 확인
