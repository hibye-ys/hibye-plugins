---
name: database
description: TS 백엔드 DB 선택 / ORM 선택 / runtime 호환성 / StoragePort 추상 결정 시 invoke. DB·ORM·driver 선택 trade-off matrix + Port 추상 원칙. 구체 DB/driver는 instance 측 결정.
metadata:
  role: workflow
  scope: project
---

# database — TS DB 선택 가이드 + Port 추상

TS 백엔드에서 **DB 엔진 / ORM / driver 선택**과 **StoragePort 추상화** 원칙. 구체 호스팅/driver/금지 DB 룰은 instance 측 결정 (이 가이드는 DB-agnostic 원칙만 다룬다).

---

## KV (cache) vs DB (durable) 분리 원칙

| 용도 | 스토리지 | 이유 |
|------|----------|------|
| 단기 캐시 (세션 TTL, rate limit 카운터) | KV (Redis / runtime KV / in-memory) | eventual consistency OK, 낮은 지연, 높은 처리량 |
| Durable 상태 (세션 identity, 메시지 이력, jobs, 감사) | RDBMS (Postgres / MySQL / SQLite) | strong consistency, transaction, ACID |
| Blob 파일 (미디어, 대용량 본문) | Object Storage (S3 / R2 / GCS) | 대용량 바이너리, 전역 분산 |

**KV 에 durable 상태 저장 금지** — 데이터 손실 위험 (eventual consistency + TTL 만료).

---

## TS 백엔드 DB 선택 매트릭스

| DB | 강점 | 약점 | 적합 |
|----|------|------|------|
| **Postgres** | 가장 풍부한 기능 (JSON / arrays / window / CTE), strong ecosystem, jsonb | 운영 부담 약간 ↑ | 복잡한 도메인, AI/agent state (jsonb), analytics |
| **MySQL** | 운영 단순, 광범위 호스팅 | 일부 SQL 기능 미흡 (e.g., FULL OUTER JOIN) | 단순 OLTP, 광범위 클라우드 호환성 |
| **SQLite** | embed, zero-config | concurrent write 약함, single-node | local dev, edge replicas, embedded apps |

**Hosting 옵션 (Postgres 기준)**: Neon (serverless / branching) / Supabase (full BaaS) / PlanetScale (MySQL 변형) / AWS RDS / GCP Cloud SQL / self-hosted.

선택 기준은 instance 측 결정 — 이 가이드는 trade-off 만 제시.

---

## ORM 선택 매트릭스

| ORM | 강점 | 약점 | 적합 |
|-----|------|------|------|
| **Drizzle** | typesafe, light, raw SQL escape hatch | 비교적 새것 (ecosystem 작음), 일부 dialect 미숙 | 신규 프로젝트, type-safety + SQL closeness 원함 |
| **Kysely** | 가장 SQL-close, 타입 안전 query builder | ORM 추상화 부족 (DAO 직접 작성) | raw SQL 선호 + type safety |
| **Prisma** | full ORM, schema-first, migration ergonomics | 런타임 obfuscation, generated client 의존 | 대규모 팀, schema-first 워크플로 |

선택은 trade-off — *typesafety 정도* vs *추상화 정도* vs *마이그레이션 도구 성숙도*.

---

## Runtime 호환성 고려사항

런타임 별 driver 선택 *원칙*:

- **Node**: 거의 모든 driver 호환. native binary (e.g., pg) / pure JS 선택.
- **Edge runtime**: HTTP-fetch 기반 driver 만 (native binary X). 예: HTTP-based Postgres drivers (serverless / branching 제공자).
- **Bun**: Node-compat 대부분 동작. native binding 검증 권장.

구체 driver 이름은 instance 측 결정. invariant 는 **"runtime 호환성 검증 의무"** 만 강제 — target runtime 에서 동작하지 않는 driver 선택 시 deploy 차단.

마이그레이션 절차는 [[migration-rollback]] workflow 참조.

---

## StoragePort 추상화 — data-layer 정본 참조

Port (interface) 격리 원칙 + 새 Port 추가 절차 + 구체 코드 예시 (`SessionPort` / `MediaJobPort` / `SessionHistoryPort`) 는 **[[data-layer]] workflow** 가 단일 source. 본 workflow 는 *선택 가이드* 만 보유 — DB / ORM / driver 결정.

핵심 원칙만 (자세한 코드: data-layer §"Port / Interface 패턴"):
- 각 도메인 영속 자원당 Port 1개
- 구현체 ≥ 2개 (InMemory + DB) — 테스트 격리
- 호출자는 interface 만 참조, 구체 구현체 import ✕

---

## 트랜잭션 / 일관성 원칙

| 원칙 | 이유 |
|------|------|
| 쓰기는 트랜잭션 안에서 (BEGIN/COMMIT) | ACID 보장, 부분 실패 → rollback |
| 트랜잭션 안에서 예외 → 자동 rollback | 데이터 일관성 |
| Long-running 트랜잭션 금지 (SSE 스트리밍 중 open 유지 ✕) | 연결 풀 고갈, 타임아웃 |
| 시각은 항상 UTC | 시간대 혼동 방지 |
| Parametrized query 강제 (string interpolation ✕) | SQL injection 방지 |
| 단일 mutation 은 단일 트랜잭션 안에 | 부분 적용 방지 |

구체 트랜잭션 API (e.g., `db.transaction(...)` vs `BEGIN/COMMIT`) 는 ORM/driver 결정사항.

---

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| DB 엔진 교체 (Postgres ↔ MySQL 등) | driver, ORM dialect, 모든 raw SQL, migration 도구 — **전 범위 재검증** |
| Hosting 제공자 변경 (e.g., self-host → managed) | 연결 문자열, CI/CD secrets, connection pool 설정 |
| Schema 컬럼 추가/삭제 | migration 파일 생성 + 검토 + downgrade 계획 |
| ORM 교체 | 모든 query 코드, 타입 정의, migration 재생성 — **대규모 작업** |
| KV → DB durable 상태 이전 | Port 구현체 교체 + 기존 KV 데이터 migration 계획 |
| Runtime 변경 (Node ↔ edge ↔ Bun) | driver 호환성 재검증 (native binary 여부) |
| Blob bucket 이름 / 제공자 변경 | 설정 + 기존 객체 migration |

---

## 금지 사항 (DB-agnostic)

- **KV 에 durable 상태 저장** — eventual consistency + TTL = 데이터 손실 위험
- **Port 우회한 직접 raw SQL** — single writer + StoragePort 위반
- **트랜잭션 밖에서 write** — 부분 실패 시 일관성 깨짐
- **Long-running 트랜잭션** — SSE 스트리밍 중 open 유지 → 연결 풀 고갈
- **SQL injection 패턴** — string interpolation 사용 시 즉시 차단, parametrized 강제
- **Migration 도구 우회한 스키마 변경** — schema drift 발생, 환경 간 불일치
- **외부 도메인 엔티티 테이블 복제** — source-of-truth 위반
- **감사 없는 mutation** — 7년 보존 요구 위반 (해당 도메인 한정)
- **연결 문자열 / DB credential 미설정 시 silent fallback** — fallback 없음, 즉시 실패 (fail-fast)
- **Target runtime 비호환 driver 사용** — 예: edge runtime 에서 native binary driver

> 구체 금지 DB / driver / API 룰 (e.g., 특정 cloud product 금지) 은 **instance 측 audit skill 에서 enforce**. 이 가이드는 일반 원칙만 다룬다.

---

*Port 추상화 / 단일 writer / KV-DB 분리 / 트랜잭션 일관성 — 4대 원칙 준수.*

## Cross-ref

- [[data-layer]] — Port / interface 구체 코드 (`SessionPort` / `MediaJobPort` 등) 정본
- [[single-writer]] — write 단일 진입점 invariant
- [[migration-rollback]] — schema 변경 절차
- [[app-domain-boundary]] — `public.*` vs `ai_backend.*` 분리
