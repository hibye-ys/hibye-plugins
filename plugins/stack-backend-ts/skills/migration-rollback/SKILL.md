---
name: migration-rollback
description: DB migration rollback workflow — forward-only vs reversible 결정, blue/green 호환 schema 변경 6단계 (add nullable → deploy → backfill → constraint → read-remove → drop), 사고 시 forward fix vs PITR 결정.
metadata:
  role: workflow
  scope: project
---

# Migration Rollback — Workflow

## 전제 — Forward-only vs Reversible

| 전략 | 장점 | 단점 |
|------|------|------|
| forward-only | 단순, 운영 부담 ↓ | 롤백 시 새 migration 작성 필요 |
| reversible (up/down) | 즉시 rollback | down migration 유지 비용 |

권장: **forward-only + blue/green 호환 schema 변경** (drop 은 다음 deploy 까지 deprecation).

## Online migration 관측성

Blue/green 또는 expand-contract migration 중 다음 메트릭 / 로그 필수:

- [ ] **Lock timeout 명시**: `SET statement_timeout = '5s'`, `SET lock_timeout = '2s'` — 무한 대기 방지
- [ ] **Batched backfill 진행률**: `migration_backfill_progress{migration_id, table}` gauge — 배치 마다 increment
- [ ] **CONCURRENTLY 인덱스 사용**: Postgres 의 경우 `CREATE INDEX CONCURRENTLY` (read 차단 없음). 실패 시 INVALID 상태 cleanup 필요
- [ ] **Long-running query 알람**: `>30s` 쿼리 감지 시 즉시 알람
- [ ] **Replication lag 모니터링**: read replica lag > 임계 시 migration pause

## 6 단계 Blue/Green 절차 (expand-contract)

```
1. Expand: 신규 컬럼 추가 (NULL 허용 또는 default)
2. Backfill: 배치 UPDATE (`WHERE id BETWEEN ? AND ?`)
3. Dual-write: 코드가 old + new 둘 다 write
4. Switch read: 코드가 new 에서 read (fallback to old)
5. Stop dual-write: new 만 write
6. Contract: old 컬럼 제거 (별도 release)
```

각 단계 사이 monitoring window (최소 24h, 트래픽 보고 결정).

같은 패턴이 column rename / type change / table split 에 적용.

## Rollback 가능 조건

- [ ] **Step 1-3**: 즉시 rollback (코드 revert + 신규 컬럼 NULL 유지)
- [ ] **Step 4-5**: 데이터 일관성 확인 후 rollback (dual-write 재활성)
- [ ] **Step 6**: 불가 (column drop 후) — backup restore 만 가능

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| Lock timeout 없는 ALTER TABLE | production traffic 차단 | statement_timeout 강제 |
| 배치 없는 한 번에 UPDATE | long lock + replication lag 폭증 | LIMIT/BETWEEN 배치 강제 |
| Step 6 (drop) 를 monitoring 없이 진행 | rollback 불가 상태 진입 | step 6 별도 release + 7일 이상 monitoring |
| `CREATE INDEX` (non-concurrent) on production | read 차단 | CONCURRENTLY 강제 lint |

## Rollback 절차 (사고 시)

1. 사고 인지 → migration 실행 후 영향 row 식별
2. **데이터 백업 확인** — daily snapshot + WAL ranges 가용성 확인
3. **forward fix** vs **point-in-time restore** 결정
   - forward fix: 데이터 손실 없음, 코드 변경으로 보정 가능 시
   - PITR: 데이터 손실 있음, schema 가 이미 비호환 변형 시
4. forward fix 경로: 새 migration 으로 보정 + 재배포
5. PITR 경로: dump → 신규 DB 복원 → traffic switch (downtime 발생, 사용자 공지 필수)

## 공통 금지

- 검토 없는 destructive migration (DROP TABLE, DROP COLUMN, ALTER TYPE) 의 즉시 배포 (반드시 blue/green 6단계)
- backup 미확인 상태에서 migration apply (rollback 옵션 부재)
- production migration 을 application boot 시 자동 실행 (별도 step 으로 격리 — 부팅 실패 시 traffic 차단 가능)
- migration 파일 mtime 으로 순서 결정 (반드시 sequential numbering 또는 timestamp prefix)
- migration 실행 후 rollback 절차 미문서화 (incident response 시 즉답 불가)
- backfill 을 single transaction 으로 (대용량에서 lock + WAL 폭증)
