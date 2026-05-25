---
name: database
description: TS 백엔드 DB 선택 / ORM 선택 / runtime 호환성 / KV vs durable 분리 결정 시 invoke. 본 plugin 의 *채택 결정 원칙* + 영향도 + 금지만 담당. DB·ORM trade-off 매트릭스는 native 지식 → 1줄 선택 가이드로 압축. Port 추상화 / 구체 코드는 [[data-layer]] 정본.
metadata:
  role: workflow
  scope: project
---

# database — TS DB 채택 결정 가이드

TS 백엔드의 **DB / ORM / driver 선택 원칙**. 구체 호스팅 / driver / 금지 DB 룰은 instance 측 결정 (본 가이드는 DB-agnostic 원칙). Port 추상화 구체 코드 (`SessionPort` / `MediaJobPort` 등) 는 [[data-layer]] 정본.

## 1. KV vs DB vs Object Storage — 분리 원칙

| 용도 | 스토리지 | 이유 |
|------|----------|------|
| 단기 캐시 (세션 TTL, rate limit 카운터) | KV (Redis / runtime KV) | eventual consistency OK, 낮은 지연 |
| Durable 상태 (세션 identity, 메시지 이력, jobs, 감사) | RDBMS (Postgres / MySQL / SQLite) | ACID transaction |
| Blob 파일 (미디어, 대용량 본문) | Object Storage (S3 / R2 / GCS) | 대용량 바이너리 |

**KV 에 durable 상태 저장 ✕** — eventual consistency + TTL = 데이터 손실 위험.

## 2. DB / ORM 선택

엔진 (Postgres / MySQL / SQLite) 과 ORM (Drizzle / Kysely / Prisma) 의 trade-off 매트릭스는 native 지식. 본 plugin 의 *채택 결정 원칙*:

- **DB**: AI/agent state 의 jsonb 빈도 + analytics 요구 + window/CTE 필요 시 → **Postgres** 권장. 단순 OLTP + 광범위 호환 → MySQL. edge replica / local dev → SQLite. 구체 hosting 은 instance 결정.
- **ORM**: typesafe + raw SQL escape hatch 가 본 plugin 의 핵심 요구 → **Drizzle** 권장. SQL-close + DAO 직접 작성 선호 → Kysely. schema-first 워크플로 + 대규모 팀 → Prisma. 본 plugin 의 audit (sql tagged template injection 패턴, [[security-audit-check]] 4a) 는 Drizzle / neon style 가정.

## 3. Runtime 호환성 — invariant

| Runtime | driver 제약 |
|---|---|
| Node | 거의 모든 driver 호환 |
| Edge runtime | HTTP-fetch 기반 driver 만 (native binary ✕) |
| Bun | Node-compat 대부분. native binding 검증 권장 |

**invariant**: target runtime 에서 동작하지 않는 driver 선택 시 deploy 차단 — 구체 driver 이름은 instance 측 결정.

마이그레이션 절차는 [[migration-rollback]] 정본.

## 4. 트랜잭션 / 일관성 — 본 plugin 원칙

- 쓰기는 트랜잭션 안 (ACID). 트랜잭션 안 예외 → 자동 rollback
- **Long-running 트랜잭션 ✕** — SSE 스트리밍 중 open 유지 시 연결 풀 고갈 → [[sse-lifecycle]] 와 충돌
- 시각은 항상 UTC ([[structured-log-schema]] timestamp 일관)
- **Parametrized query 강제** — string interpolation ✕ ([[security-audit-check]] 4a/4b 정본)
- 단일 mutation = 단일 트랜잭션 (부분 적용 방지)

구체 트랜잭션 API (`db.transaction(...)` vs `BEGIN/COMMIT`) 는 ORM/driver 결정.

## 5. Port 추상화 → [[data-layer]] 일임

각 도메인 영속 자원당 Port 1개 / 구현체 ≥ 2개 (InMemory + DB) / 호출자는 interface 만 참조. 구체 코드 예시 (`SessionPort` / `MediaJobPort` / `SessionHistoryPort`) 는 [[data-layer]] §"Port / Interface 패턴" 정본.

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| DB 엔진 교체 (Postgres ↔ MySQL) | driver / ORM dialect / 모든 raw SQL / migration 도구 — **전 범위 재검증** |
| Hosting 제공자 변경 (self-host → managed) | 연결 문자열 / CI/CD secrets / connection pool 설정 |
| ORM 교체 | 모든 query 코드 / 타입 정의 / migration 재생성 — **대규모 작업** |
| KV → DB durable 이전 | Port 구현체 교체 + 기존 KV 데이터 migration 계획 |
| Runtime 변경 (Node ↔ edge ↔ Bun) | driver 호환성 재검증 (§3 invariant) |
| Schema 컬럼 추가/삭제 | [[migration-rollback]] 정본 절차 |
| Blob bucket 변경 | 설정 + 기존 객체 migration |

## 금지 사항 (DB-agnostic)

- **KV 에 durable 상태 저장** — eventual consistency + TTL 위험
- **Port 우회한 직접 raw SQL** — [[single-writer]] / StoragePort 위반
- **트랜잭션 밖에서 write** — 부분 실패 시 일관성 깨짐
- **Long-running 트랜잭션** — SSE 스트리밍 중 open 유지 ✕
- **SQL injection 패턴** — string interpolation ✕ ([[security-audit-check]] 4a/4b 정본)
- **Migration 도구 우회한 스키마 변경** — schema drift
- **외부 도메인 엔티티 테이블 복제** — source-of-truth 위반 ([[app-domain-boundary]])
- **감사 없는 mutation** — 데이터 거버넌스 7년 보존 위반 (해당 도메인 한정)
- **연결 문자열 / DB credential 미설정 silent fallback** — fail-fast 강제
- **Target runtime 비호환 driver** — 예: edge runtime 에서 native binary

> 구체 금지 DB / driver / API 룰 (e.g., 특정 cloud product 금지) 은 **instance 측 audit skill 에서 enforce**.

## Cross-ref

- [[data-layer]] — Port / interface 구체 코드 정본
- [[single-writer]] — write 단일 진입점 invariant
- [[migration-rollback]] — schema 변경 절차
- [[app-domain-boundary]] — `public.*` vs `ai_backend.*` 분리
- [[security-audit-check]] — SQL injection 패턴 4a/4b 정본
