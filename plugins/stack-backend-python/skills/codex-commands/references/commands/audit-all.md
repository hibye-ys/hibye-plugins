---
description: Run all audit coordinators (architecture + security + test + provider + prompt + tool + stream + loop + subagent + api + data + session + infra) in sequence and produce a unified health report. One-shot full project audit. Default = 13 static phases. `--live` opts into Phase 14 (pre-deploy smoke subset).
argument-hint: [--skip=<category>] [--live]
---

Run a comprehensive project audit across all subsystems.

## Usage

`/audit-all`                        # 전체 감사 (13 phase, 정적만)
`/audit-all --skip=security`        # 보안 제외
`/audit-all --skip=test,infra`      # 테스트+인프라 제외
`/audit-all --live`                 # 13 phase + Phase 14 (live boot/health/runs 정합)

## Audit Sequence (13 phases + 1 opt-in)

순서는 의존성 기반 — 앞 단계 결과가 뒤 단계 판단에 참고됨.

| # | 카테고리 | 로드 스킬 | 핵심 체크 |
|---|---------|----------|----------|
| 1 | **Architecture** | `full-architecture-audit` | import 방향, rule 불변식, spec drift, rule 구조 |
| 2 | **Security** | `security-audit-check` + `security-runtime` | 시크릿, OWASP, auth, CORS, rate limit, scrub |
| 3 | **Provider** | `provider-audit` | fallback chain, circuit breaker, retry 정책, 단일 변환 |
| 4 | **Prompt** | `prompt-audit` | TokenBudget, 3-Layer, cache 안정성, dedup |
| 5 | **Loop** | `loop-audit` | 6-stage 순서, LoopTransition, LoopDeps sync |
| 6 | **Tool** | `tool-audit` | build_tool, concurrency, 정렬, MCP naming |
| 7 | **Stream** | `stream-audit` | SSE lifecycle, scrub_secrets, ping, wire format |
| 8 | **Sub-agent** | `subagent-audit` | depth 제한, coordinator/worker, CacheSafeParams |
| 9 | **API** | `api-audit` | thin-layer, auth 커버리지, RunPolicy, 스키마 |
| 10 | **Data** | `data-audit` | single writer, StoragePort Protocol, cache |
| 11 | **Session** | `session-audit` | SessionPort, LRU, user_id, storage port |
| 12 | **Test** | `test-cleanup` | orphan, skip, 중복, coverage gap |
| 13 | **Infra** | `infra-audit` | asyncio Lock, blocking I/O, 리소스 누수 |
| **14** | **Pre-deploy smoke** (*SKIPPED unless `--live`*) | `pre-deploy-check` (Tier 1 subset) | `uv run uvicorn` boot + `/health` polling + `GET /runs` 파일수/API수 정합 + `alembic current` 도달성. Tier 2 (`--integration`) / Tier 3 (`--live-openai`) 는 `/pre-deploy` 전용, `/audit-all --live` 범위 밖 |

## Dispatch rule

1. **Parse `--skip`** — 쉼표로 구분된 카테고리 목록. 해당 phase skip.

2. **각 phase 순차 실행**:
   - 해당 스킬 로드
   - 스킬의 grep 체크리스트 전체 실행
   - 결과를 OK / VIOLATION / WARNING 분류
   - phase 종료 시 소계 출력: `Phase N (<category>): X violations, Y warnings`

3. **Phase 실패해도 다음 계속** — 한 phase 에서 에러가 나면 SKIPPED 표시 후 계속.

4. **통합 리포트 생성**:

```markdown
## Full Audit Report — <date>

### Executive Summary
| Category | Violations | Warnings | Status |
|----------|-----------|----------|--------|
| Architecture | N | N | OK/FAIL |
| Security | N | N | OK/FAIL |
| ... | | | |
| **Total** | **N** | **N** | |

### Critical Findings (immediate action)
1. [CRITICAL] <category> — <file:line> — <description>

### High Findings (next sprint)
1. [HIGH] ...

### Detailed Results
(각 phase 의 상세 리포트 append)
```

5. **Stop.** 리포트만 제시. 자동 수정 안 함.

## What this command does NOT do

- 자동 수정하지 않음 — 리포트만 제시, 사용자가 판단
- 개별 phase 의 deep analysis 안 함 — 해당 에이전트 직접 호출 필요
  - 예: Architecture deep → `architecture-validator` (full 모드)
  - 예: Security deep → `security-manager` (deep-audit 모드)
- 성능 벤치마크 안 함 — `/audit-all` 은 정적 분석만 (live opt-in 시 Phase 14 의 boot/health probe 만 추가). 성능은 `infra-performance-manager` (benchmark 모드)
- 테스트 실행 안 함 — 테스트 파일 상태만 검사. 실행은 `/agent-test`
- 배포 전 종합 게이트는 `/pre-deploy` 전용 — `/audit-all --live` 는 Tier 1 subset (boot+health) 만, `--integration` 이나 `--live-openai` 은 없음

## When to use

- 대규모 리팩터링 후 — 규칙 위반 없는지 일괄 점검
- PR merge 전 — 코드 리뷰 보완으로 자동화된 규칙 검증
- 주간 정기 점검 — 프로젝트 건강 상태 추적

## When to escalate

- 특정 카테고리에서 CRITICAL 다수 → 해당 coordinator 에이전트 직접 호출
- Architecture 위반 많음 → `architecture-validator` (full 모드)
- Security CRITICAL → `security-manager` (deep-audit 모드)
- 테스트 커버리지 갭 → `/test-coverage`
