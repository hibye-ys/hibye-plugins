---
name: pre-deploy-check
description: Use before a release to run a composite pre-deploy gate. Defines the tier structure (Tier 1 static / Tier 2 --integration / Tier 3 --live-openai / Tier 3b --live-anthropic), pass/fail semantics, exit codes, and output format. `/pre-deploy` command is the entry point; this skill is the authoritative spec. Do NOT confuse with `/agent-verify` (runtime-verify skill, 7-step post-code-change check) — this skill is release-gate scope.
allowed-tools: Read, Bash, Grep, Glob
---

# pre-deploy-check — 배포 전 종합 게이트

## 이 skill은 언제 로드되는가

- `/pre-deploy` command 실행 시
- 릴리스 체크리스트 작성 / 수정 시
- 사용자가 "배포 전 검증" / "release gate" / "pre-deploy" 언급

## 경계 (vs `/agent-verify`)

| 측면 | `/agent-verify` (runtime-verify) | `/pre-deploy` (this skill) |
|------|-------------------------------|---------------------------|
| 시점 | 코드 변경 직후 | 릴리스 직전 |
| 범위 | 개별 모듈 (7-step: ruff/ty/pytest/boot/health/E2E/logs) | 전체 시스템 (deps/lint/boot + 외부 도메인 + provider) |
| Tier | 고정 3-tier (Static/Boot/E2E) | 가변 3-tier (default + 2 opt-in) |
| 비용 | 항상 local only | `--live-openai` 과 `--live-anthropic` 은 실 토큰 소비 |
| 실패 시 | 해당 모듈 debug | 릴리스 blocker |
| 포트 | 8001 | 8001 (상호 배타) |

## 3-Tier 구조

### Tier 1: `default/static` (인프라 의존 0, 항상 실행)

| 단계 | 검증 내용 | 실패 기준 |
|------|----------|----------|
| 1 | `uv sync --frozen` | `uv.lock` 과 `pyproject.toml` 불일치 |
| 2 | `uv run pip-audit` | CVE 발견 |
| 3 | `ruff check .` | lint 에러 |
| 4 | `ty check backend/` | type 에러 |
| 5 | `uv run uvicorn backend.main:app --port 8001 &` | import error / startup error |
| 6 | `curl -fs http://localhost:8001/health` (최대 10초 polling) | /health 응답 없음 |
| 7 | `GET /runs` file-count ↔ API-count 일치 | runs/*.yaml 의 startup 검증 실패 (pydantic extra="forbid") |
| 8 | `uv run alembic -c backend/db/alembic.ini current` + `heads` | DB 미도달 (connection error). **revision 불일치는 WARN만, FAIL 아님** (배포 직전 migration 대기 상태는 정상) |
| 9 | `GET /debug/tools/mcp` (조건부) | debug mount 활성 시 MCP ConnectionState 확인. 미활성 시 SKIP+WARN |

**중요**:
- `APP_AUTH_REQUIRED=false` (또는 `app_env != prod`) 전제 — dev anonymous 허용 경로. prod 환경에서는 이 tier 가 맞지 않음 (별도 CI)
- `/runs/reload` 는 Tier 1 에서 **호출 안 함** — `runs:admin` scope 필요 + 배포 직전에는 파일 정적 확인으로 충분

### Tier 2: `--integration` (외부 도메인 Postgres (예: <domain>) + 테스트 DB 환경에서만)

- **Precondition**: 외부 도메인 Postgres (예: <domain>) 기동 + `APP_DATABASE_URL` + `<DOMAIN>_DATABASE_URL` 설정
- **실행**: `bash scripts/integration-smoke.sh` orchestrate
- 이 스크립트는 full boot + integration pytest + cleanup 수행
- 외부 도메인 pool 실동작 (`SELECT 1` from `<DOMAIN>_DATABASE_URL`) 포함
- Tier 1 의 uvicorn 은 kill 하고 이 스크립트가 자체 boot

### Tier 3: `--live-openai` (OpenAI API key 있는 환경에서만, OpenAI 한정)

- **Precondition**: `OPENAI_API_KEY` env 설정
- **실행**: `uv run python scripts/smoke_real_provider.py`
- 이 스크립트는 **OpenAI 전용** — `openai` provider 등록 assert, 다른 provider 이면 skip
- `--live-openai` 를 명시했는데 `OPENAI_API_KEY` unset 이면 **NO-GO (FAIL)** — opt-in gate semantics: "요청했는데 precondition 불충족" 은 실패. 해당 환경에서 의도적으로 스킵하고 싶으면 `--live-openai` 플래그 자체를 생략하면 됨
- 외부 도메인 DB probe 는 여기서 제외 — `--integration` 담당
- 각 provider fallback chain 첫 모델 live ping 은 range 밖 (future: `--live-google`)

### Tier 3b: `--live-anthropic` (ANTHROPIC_API_KEY 있는 환경에서만, Anthropic 한정)

- **Precondition**: `ANTHROPIC_API_KEY` env 설정
- **실행**: `uv run python scripts/smoke_anthropic_cache.py`
- 이 스크립트는 **Anthropic prompt-cache 전용** — 동일 요청 2회로 `cache_read_input_tokens > 0` 을 확인하여 `cache_control` breakpoint 가 실제 라이브 API 에서 honor 되는지 검증 (spec `docs/completed/superpowers/specs/2026-04-24-anthropic-prompt-cache-control-design.md`)
- `--live-anthropic` 를 명시했는데 `ANTHROPIC_API_KEY` unset 이면 **NO-GO (FAIL)** — `--live-openai` 과 동일 gate semantic
- Tier 1 실패 시 SKIP — 의존성 깨진 상태에서 live API 호출 안 함
- 비용: 호출당 ~1-2 cents (2회 합산). 명시적 opt-in 시에만 실행

## 출력 형식

```
== Tier 1: static ==
[1/9] uv sync --frozen: PASS
[2/9] pip-audit: PASS (0 vulnerabilities)
[3/9] ruff: PASS
[4/9] ty: PASS
[5/9] uvicorn boot: PASS (5s)
[6/9] /health: PASS (200)
[7/9] /runs count: PASS (3 files / 3 API)
[8/9] alembic: PASS (current=abc123 heads=abc123 aligned)
[9/9] MCP state: SKIP (debug routes disabled)
== Tier 1: PASS ==

[SKIP] Tier 2: --integration flag not provided
== Tier 3: live-openai ==
[1/1] smoke_real_provider.py: PASS (openai gpt-4o 200ms)
== Tier 3: PASS ==

=== pre-deploy: GO ===
Time: 47s (Tier 1: 30s, Tier 3: 17s)
```

실패 시:

```
[4/9] ty: FAIL
<ty output>
=== pre-deploy: NO-GO ===
Failed at: Tier 1 step 4 (ty)
```

## 의도적 고장 시나리오 (self-test)

새 pre-deploy 배포 전에 검증용:

1. **Provider key 오타**: `OPENAI_API_KEY=sk-invalid` → Tier 3 실패 감지
2. **DB unreachable**: `APP_DATABASE_URL=postgresql://wrong-host/...` → Tier 1 step 8 실패
3. **runs/ YAML 문법 오류**: `backend/runs/chat.yaml` 에 `compaction: true` (full form 아닌 짧은 형) → startup 에서 pydantic `extra="forbid"` fail → `/runs` count 불일치 감지
4. **Port conflict**: `/agent-verify` 실행 중 → lsof 감지, 즉시 abort

## 반드시 재사용 (중복 구현 금지)

- `scripts/integration-smoke.sh` — Tier 2 의 실행 주체
- `scripts/smoke_real_provider.py` — Tier 3 의 실행 주체
- `runtime-verify` skill 의 boot + /health polling 로직은 Tier 1 step 5-6 에 재사용 가능
- `/audit-all` 13 phase 는 **별도 실행 권장** (pre-deploy 는 live 경로 담당, audit-all 은 정적 경로 담당)

## Non-Goals

- 자동 수정 금지 (사용자가 실패 원인 판단)
- staging/prod 서버에 직접 호출 금지 (이건 CI 파이프라인 소관)
- `/runs/reload` 호출 금지 (runs:admin scope 필요)
- 외부 헤더 기반 curl 금지 (harness allow 에 header-bearing curl 미포함)
- 전체 pytest 실행 금지 (Tier 2 의 integration-smoke 만 integration pytest 호출)

## 확장 체크리스트

새 tier / 새 체크 추가 시:

1. 비용 tier 분류: 항상 실행 (Tier 1) vs 인프라 필요 (Tier 2) vs 실 API 비용 (Tier 3)
2. 실패 기준 명시: 어떤 exit code, 어떤 로그 패턴이면 FAIL
3. skip vs fail 의미 분리 (opt-in tier gate semantics):
   - **flag 미제공** (tier 자체가 비활성) → SKIP + WARN, FAIL 아님 (의도적 비실행)
   - **flag 제공 + precondition 누락** (예: `--live-openai` 인데 `OPENAI_API_KEY` unset) → **NO-GO (FAIL)** — "요청했는데 불가능" 은 실패
   - Tier 1 내부 optional 체크 (MCP `/debug` mount 등) 은 flag 개념 없음 → SKIP + WARN
   - 정본: `/pre-deploy` command 의 Tier 3 분기 (flag+key 없음 = FAIL; flag 없음 = SKIP)
4. 재사용 자산 식별: 기존 스크립트 / skill 을 orchestrate 하는지 신규 구현인지
5. 출력 형식 유지: `[N/M] <name>: PASS|FAIL|SKIP`
6. `/audit-all --live` 와 정합: audit-all 이 Tier 1 의 일부를 커버하므로 중복 실행 방지

## 절대 금지

- Tier 2/3 를 default 로 활성 (비용 + flaky 리스크)
- `/runs/reload` 를 gate 에 포함 (runs:admin scope 필요)
- `alembic current` 만으로 migration 정합성 선언 (반드시 `heads` 와 비교, 단 차이는 WARN)
- 실패 시 자동 재시도
- staging/prod 서버에 직접 smoke
- OpenAI 이외 provider 를 Tier 3 로 assert (현재 smoke_real_provider.py 는 OpenAI 전용)
