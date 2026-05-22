> **정본** — App backend ↔ 외부 application 도메인 경계 규약 (이 instance 의 사례 = `<domain>` 웹서비스).
> 언어 무관 (Python / Rust / TS 공통). 양쪽 `*_agent_rules/architecture.md` 와
> `*_agent_rules/database-patterns.md` 에서 본 파일을 단일 source of truth 로 참조한다.
> 구체적인 ORM / migration 도구 / pool 라이브러리 차이는 각 언어 룰에 명시.
>
> **다른 product 에 적용 시:** 본 plugin 본문의 placeholder (`<domain>` 소문자 식별자, `<DOMAIN>` 대문자 환경변수) 를 자기 도메인 이름으로 `sed` 치환. 이 plugin 의 reference 사례 = `iyaki` product (`<domain>` → `iyaki`, `<DOMAIN>` → `IYAKI`).

# 외부 도메인 경계 — 데이터 소유권 / 쓰기 규약

## 핵심 원칙

**도메인 엔티티 ground truth 는 외부 application 웹서비스 소유** (이 instance 의 사례 = `<domain>`). AI 백엔드는 자체 도메인 테이블을
보관하지 않는다. 동일 Postgres 인스턴스를 공유하되 스키마로 분리:

| 스키마 | 소유자 | 내용 |
|--------|--------|------|
| `public.*` | **외부 application 웹서비스** (예: <domain>) | 도메인 엔티티 (entity / block / episode / category / character / note / graph_edge / project / app_state 등) — AI 가 소유 안 함 |
| `ai_backend.*` | **AI 백엔드** | 세션 / 메시지 / media job / user_skills 메타 / `<domain>_mutations` 감사 (이 instance = `<domain>_mutations`) / governance jobs / audit_log |

## 접근 경로 — 언어별 분리된 pool

`public.*` (외부 도메인) 접근은 ORM/SQLAlchemy 메인 엔진과 **분리된 전용 pool** 경유. 이유:

- 외부 도메인이 raw SQL 중심 (ORM 모델 없음 — 이 instance 의 사례 = `<domain>`)
- advisory lock / jsonb codec 같은 PostgreSQL 고유 기능 필요
- DSN 분리 (`<DOMAIN>_DATABASE_URL`, 이 instance = `<DOMAIN>_DATABASE_URL`) — 누락 시 startup fail (`APP_DATABASE_URL` fallback 없음)

언어별 pool 구현 위치는 각 언어 룰에 명시 (예: Python `backend/tools/_<domain>_db.py`,
Rust `crates/ai-data/src/<domain>/pool.rs`).

## 도메인 row 쓰기 — 3 조건

`public.*` 의 도메인 row (entity / block / episode / category / graph_edge / character / note 등) 를
INSERT / UPDATE / DELETE 할 때 **반드시 다음 3 조건을 동일 트랜잭션 안에서** 만족:

1. **`lock_project(project_id)` advisory lock**
   - `pg_advisory_xact_lock(bigint)` — lock key 는 `SHA-256("<domain>:project:<id>")` 의 앞 8바이트 (이 instance = `"<domain>:project:..."`)
   - 프로젝트 단위 직렬화 — 외부 application 쓰기 / AI 쓰기 interleave 방지
2. **`ai_backend.<domain>_mutations` 감사 append** (이 instance = `<domain>_mutations`)
   - prev / new 값 raw SQL `INSERT` (ORM 모델 **없음** — 테이블 스키마는 migration 에서 직접 관리)
   - 트랜잭션 내부에서 도메인 변경과 함께 atomic
3. **`ToolResult.metadata["resource_updated"]` 신호**
   - 도구 결과에 명시적 변경 신호 — UI 측 캐시 invalidation 트리거

## 예외 — project lifecycle 메타 작업

`public.project` row 자체의 INSERT, `public.app_state` 의 `active_project_id` 키 UPSERT
같은 **project 메타 작업** 에는 위 3 조건 비적용:

- `lock_project` 적용 불가 (project_id 가 아직 없거나 — create / 글로벌 key — switch)
- audit 는 `ai_backend.<domain>_mutations` 가 아니라 구조화 로깅 (Python `structlog.info`, Rust `tracing::info!`) 으로 대체
- 적용 도구 (이 instance 의 식별자): `<domain>_create_project`, `<domain>_switch_project` (V0 신규)

## 마이그레이션 격리

마이그레이션 도구는 `ai_backend.*` 스키마만 관리해야 한다. `public.*` 은 외부 application 이
소유하므로 AI 백엔드의 migration 으로 절대 변경하지 않음.

언어별 구현:
- Python (Alembic): `env.py` 의 `include_object` 필터로 `public.*` 제외
- Rust (sqlx::migrate! / refinery): `SET search_path TO ai_backend` 또는 명시적 스키마 prefix

migration autogenerate 가 `public.*` row 를 보면 잘못된 결과 — 필터 검증 필수.

## DSN 분리

| Env var | 사용처 | 누락 시 |
|---------|--------|---------|
| `APP_DATABASE_URL` | `ai_backend.*` (메인 ORM/엔진) | startup fail (production), SQLite fallback (local) |
| `<DOMAIN>_DATABASE_URL` (이 instance = `<DOMAIN>_DATABASE_URL`) | `public.*` (외부 도메인 pool) | 즉시 `RuntimeError("<DOMAIN>_DATABASE_URL is not set")` (production+local 모두) |

`<DOMAIN>_DATABASE_URL` 은 fallback 없음 — `.env.example` 에 별도 항목 유지.

## 변경 영향

| 변경 | 영향 |
|------|------|
| 새 도메인 엔티티 INSERT 도구 추가 | 3 조건 (lock_project + `<domain>_mutations` + resource_updated) 모두 적용 + 테스트 |
| project lifecycle 도구 추가 | 예외 패턴 적용 + audit 로깅 (3 조건 아님) |
| `lock_project` 키 알고리즘 변경 (SHA-256 앞 8바이트) | 기존 lock 호환성 깨짐 — 외부 application 측과 동시 배포 필요 |
| `ai_backend.<domain>_mutations` 스키마 변경 | migration + 감사 로그 호환성 + governance 보존 정책 |
| 마이그레이션 격리 필터 누락 | autogenerate 가 `public.*` 변경 — 외부 도메인 데이터 파괴 위험 |
| `<DOMAIN>_DATABASE_URL` fallback 추가 | DSN 혼동 — 도메인 분리 원칙 깨짐 |

## 금지 사항

- `public.*` 도메인 row 를 ORM 모델로 매핑 (raw SQL + `<domain>_mutations` 만)
- AI 백엔드 자체의 도메인 데이터 사본 보관 (예: `ai_backend.entity_cache`) — ground truth 는 외부 application 만
- `lock_project` 없이 `public.*` row 쓰기 (race condition + audit 누락)
- `ai_backend.<domain>_mutations` 누락 (audit trail 누수)
- AI migration 이 `public.*` 건드리기 (스키마 격리 깨짐)
- `<DOMAIN>_DATABASE_URL` 누락을 silent fallback 으로 무시 (DSN 분리 원칙)
- 외부 도메인 도구가 `<domain>_mutations` 쓰지 않고 `structlog/tracing` 으로만 audit 갈음 (예외는 project lifecycle 메타 작업만)
