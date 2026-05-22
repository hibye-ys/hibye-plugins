---
name: migration-rollback
description: DB migration rollback workflow — forward-only vs reversible 결정, blue/green 호환 schema 변경 6단계 (add nullable → deploy → backfill → constraint → read-remove → drop), 사고 시 forward fix vs PITR 결정.
metadata:
  role: workflow
  scope: project
  source: stack-backend-ts/skills/migration-rollback
---

# Migration Rollback — Workflow

## 전제 — Forward-only vs Reversible

| 전략 | 장점 | 단점 |
|------|------|------|
| forward-only | 단순, 운영 부담 ↓ | 롤백 시 새 migration 작성 필요 |
| reversible (up/down) | 즉시 rollback | down migration 유지 비용 |

권장: **forward-only + blue/green 호환 schema 변경** (drop 은 다음 deploy 까지 deprecation).

## Blue/Green 호환 schema 변경 — 6 단계

1. **add column nullable** — 신/구 코드 양쪽 동작
2. **deploy 신코드** — write 양쪽 (이전 + 신규 column)
3. **backfill** — 기존 row 의 신규 column 채우기 (batch + idempotent)
4. **constraint 추가** — NOT NULL 등 (이 시점 모든 row 채워짐)
5. **이전 column read 제거** — 코드만 변경 (DB schema 변화 없음)
6. **drop 이전 column** — 다음 release cycle (rollback 윈도우 확보)

같은 패턴이 column rename / type change / table split 에 적용.

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
