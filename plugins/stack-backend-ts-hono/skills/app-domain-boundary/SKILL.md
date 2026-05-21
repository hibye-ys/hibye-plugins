---
name: app-domain-boundary
description: 앱 도메인 경계 invariant — 백엔드 (ai_backend.*) 와 웹서비스 도메인 (public.*) 사이 데이터 소유권 + 쓰기 3 조건 규약. 도메인 row 를 ORM 모델로 매핑 금지.
metadata:
  role: invariant
  scope: apps/api
  source: stack-backend-python/_shared/iyaki-domain-boundary.md (renamed)
---

**적용된 §4.4 매트릭스 행**: 거의 ✕ (protocol-level). 본문 안 `iyaki_*` 식별자 → `app_*` / `domain_*` 로 치환.

> **정본** — App backend ↔ 웹서비스 도메인 경계 규약.
> 언어 무관 (Python / TS 공통). 양쪽 `*_agent_rules/architecture.md` 와
> `*_agent_rules/database-patterns.md` 에서 본 파일을 단일 source of truth 로 참조한다.
> 구체적인 ORM / migration 도구 / pool 라이브러리 차이는 각 언어 룰에 명시.

# 앱 도메인 경계 — 데이터 소유권 / 쓰기 규약

## 핵심 원칙

**도메인 엔티티 ground truth 는 웹서비스 소유.** AI 백엔드는 자체 도메인 테이블을
보관하지 않는다. 동일 Postgres 인스턴스를 공유하되 스키마로 분리:

| 스키마 | 소유자 | 내용 |
|--------|--------|------|
| `public.*` | **웹서비스** | 도메인 엔티티 (entity / block / episode / category / character / note / graph_edge / project / app_state 등) — AI 가 소유 안 함 |
| `ai_backend.*` | **AI 백엔드** | 세션 / 메시지 / media job / user_skills 메타 / domain_mutations 감사 / governance jobs / audit_log |

## 접근 경로 — 언어별 분리된 pool

`public.*` (웹서비스 도메인) 접근은 ORM/메인 엔진과 **분리된 전용 pool** 경유. 이유:

- 웹서비스가 raw SQL 중심 (ORM 모델 없음)
- advisory lock / jsonb codec 같은 PostgreSQL 고유 기능 필요
- DSN 분리 (`DOMAIN_DATABASE_URL`) — 누락 시 startup fail (`APP_DATABASE_URL` fallback 없음)

언어별 pool 구현 위치는 각 언어 룰에 명시 (예: TS `src/tools/_domain_db.ts`).

## 도메인 row 쓰기 — 3 조건

`public.*` 의 도메인 row (entity / block / episode / category / graph_edge / character / note 등) 를
INSERT / UPDATE / DELETE 할 때 **반드시 다음 3 조건을 동일 트랜잭션 안에서** 만족:

1. **`lockProject(projectId)` advisory lock**
   - `pg_advisory_xact_lock(bigint)` — lock key 는 `SHA-256("app:project:<id>")` 의 앞 8바이트
   - 프로젝트 단위 직렬화 — 웹서비스 사용자 쓰기 / AI 쓰기 interleave 방지
2. **`ai_backend.domain_mutations` 감사 append**
   - prev / new 값 raw SQL `INSERT` (ORM 모델 **없음** — 테이블 스키마는 migration 에서 직접 관리)
   - 트랜잭션 내부에서 도메인 변경과 함께 atomic
3. **`ToolResult.metadata["resource_updated"]` 신호**
   - 도구 결과에 명시적 변경 신호 — UI 측 캐시 invalidation 트리거

## 예외 — project lifecycle 메타 작업

`public.project` row 자체의 INSERT, `public.app_state` 의 `active_project_id` 키 UPSERT
같은 **project 메타 작업** 에는 위 3 조건 비적용:

- `lockProject` 적용 불가 (project_id 가 아직 없거나 — create / 글로벌 key — switch)
- audit 는 `ai_backend.domain_mutations` 가 아니라 구조화 로깅 (`console.log` / `structuredLog`) 으로 대체
- 적용 도구: `domain_create_project`, `domain_switch_project` (V0 신규)

## 마이그레이션 격리

마이그레이션 도구는 `ai_backend.*` 스키마만 관리해야 한다. `public.*` 은 웹서비스가
소유하므로 AI 백엔드의 migration 으로 절대 변경하지 않음.

언어별 구현:
- TS (drizzle / kysely migrate): `include_object` 필터로 `public.*` 제외, 또는 `SET search_path TO ai_backend`

migration autogenerate 가 `public.*` row 를 보면 잘못된 결과 — 필터 검증 필수.

## DSN 분리

| Env var | 사용처 | 누락 시 |
|---------|--------|---------|
| `APP_DATABASE_URL` | `ai_backend.*` (메인 ORM/엔진) | startup fail (production), SQLite fallback (local) |
| `DOMAIN_DATABASE_URL` | `public.*` (웹서비스 도메인 pool) | 즉시 `RuntimeError("DOMAIN_DATABASE_URL is not set")` (production+local 모두) |

`DOMAIN_DATABASE_URL` 은 fallback 없음 — `.env.example` 에 별도 항목 유지.

## 변경 영향

| 변경 | 영향 |
|------|------|
| 새 도메인 엔티티 INSERT 도구 추가 | 3 조건 (lockProject + domain_mutations + resource_updated) 모두 적용 + 테스트 |
| project lifecycle 도구 추가 | 예외 패턴 적용 + audit 로깅 (3 조건 아님) |
| `lockProject` 키 알고리즘 변경 (SHA-256 앞 8바이트) | 기존 lock 호환성 깨짐 — 웹서비스 측과 동시 배포 필요 |
| `ai_backend.domain_mutations` 스키마 변경 | migration + 감사 로그 호환성 + governance 보존 정책 |
| 마이그레이션 격리 필터 누락 | autogenerate 가 `public.*` 변경 — 웹서비스 데이터 파괴 위험 |
| `DOMAIN_DATABASE_URL` fallback 추가 | DSN 혼동 — 도메인 분리 원칙 깨짐 |

## 금지 사항

- `public.*` 도메인 row 를 ORM 모델로 매핑 (raw SQL + domain_mutations 만)
- AI 백엔드 자체의 도메인 데이터 사본 보관 (예: `ai_backend.entity_cache`) — ground truth 는 웹서비스 만
- `lockProject` 없이 `public.*` row 쓰기 (race condition + audit 누락)
- `ai_backend.domain_mutations` 누락 (audit trail 누수)
- AI migration 이 `public.*` 건드리기 (스키마 격리 깨짐)
- `DOMAIN_DATABASE_URL` 누락을 silent fallback 으로 무시 (DSN 분리 원칙)
- 도메인 도구가 domain_mutations 쓰지 않고 구조화 로깅으로만 audit 갈음 (예외는 project lifecycle 메타 작업만)

(legacy 이름: `iyaki-domain-boundary`)
