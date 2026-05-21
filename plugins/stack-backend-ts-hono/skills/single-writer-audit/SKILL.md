---
name: single-writer-audit
description: 동시 쓰기 위험 코드 변경 후. apps/api 안 동일 리소스 (DB row, KV key, R2 object) 에 lock/transaction 없이 다중 writer 접근하는 패턴 grep.
metadata:
  role: audit
  scope: apps/api
  source: (신규 — invariant 기반)
  pair_invariant: single-writer
---

# single-writer-audit

## 검증 대상 invariant
[single-writer/SKILL.md](../single-writer/SKILL.md)

## 실행

```bash
# 패턴 1: KV put / R2 put 호출이 lock 없이
grep -rEn '\.(put|delete)\(' apps/api/src/ | grep -v 'lock\|mutex\|transaction'

# 패턴 2: UPDATE SQL 이 advisory lock 없이
grep -rEn 'UPDATE\s+\w+\s+SET' apps/api/src/ | grep -v 'pg_advisory_lock\|FOR UPDATE'
```

## 위반 시 조치
1. KV/R2 put 중 경쟁 위험 경로 → mutex 또는 serialization queue (async-mutex / p-queue) 패턴. Durable Objects ✕ (spec §1.2 절대 금지)
2. UPDATE 쿼리 → `BEGIN; SELECT ... FOR UPDATE; UPDATE ...; COMMIT;` 트랜잭션 감싸기

## 통과 기준
- 모든 match 가 *명시적 lock/transaction* 안에 있거나 사유 주석
