# backend-ts

TypeScript backend skills — **SessionStart hook 으로 자동 감지**, 수동 placeholder 매핑 불필요.

## 자동 감지 (수동 작업 0)

plugin install 직후, `hooks/session-start-profiler.mjs` 가 매 session 시작 시 다음을 자동 감지:

1. **Framework** — `package.json` dependencies 에서 `hono` / `express` / `fastify` / `koa` / `@nestjs/core` / `elysia` 탐색
2. **Runtime** — `wrangler` (workers) / `bun-types` (bun) / `@types/deno` (deno) / 기본 `node`
3. **Layout** — `apps/api` / `packages/api` 등 모노레포 vs single
4. **Domain vocab** — `src/domain/` / `src/models/` / `src/db/schema/` 파일명에서 도메인 어휘 추출

감지 결과는 `${CLAUDE_PLUGIN_DATA}/instance-config.json` 에 저장 + 매 session 시작 시 컨텍스트 inject.

TypeScript backend 프로젝트 (typescript + framework dependency) 가 아니면 silent skip — 다른 프로젝트에서는 plugin 이 노출되지 않음.

## Skill 84 종

본 plugin 의 84 skill 은 **description trigger 로 lazy load** (Claude Code 표준 plugin 패턴). 작업 컨텍스트에 맞는 skill 만 자동 로드 — `@import` 강제 로드 ✕.

- **Invariants 20** — 지속 강제 룰 (single-writer, sse-lifecycle, provider-retry-matrix 등)
- **Workflows 39** — 작업 절차 + 구현 가이드 (agent-loop, sse-streaming, new-route 등)
- **Audits 25** — grep 기반 점검 (audit-all.sh 일괄 실행 가능)

전체 카탈로그: `skills/backend-overview/SKILL.md` (디렉토리 인덱스) + `skills/architecture-invariants/SKILL.md` (invariant 카탈로그).

## 사용자 매핑 작업

**필요한 것 0**. 표준 plugin 동작:
- `claude plugins enable backend-ts@hibye-plugins` 만 실행 → 즉시 동작
- backend TypeScript 프로젝트 안에서 session 시작 → 자동 감지 결과 inject
- 다른 프로젝트 (frontend / data science / 기타) → silent skip, 노출 0

## 정공법 실험 — 본 plugin 의 의도

`stack-backend-ts` (이전 v1 plugin — commit 91bf02c 에서 삭제) 의 v2 정공법 fork. 차이:

| 측면 | `stack-backend-ts` (v1) | `backend-ts` (v2 — 본 plugin) |
|------|--------|----------|
| Setup | 사용자가 placeholder 매핑 / env preset / DOMAIN_VOCAB 수동 작성 | hook 가 자동 감지, 사용자 작업 0 |
| Skill 로딩 | `@import` 84줄 강제 (~15-20KB 매 turn) | description trigger lazy load (Claude Code 표준) |
| 다른 프로젝트 노출 | 모든 프로젝트에서 description 로드 | TypeScript backend 만 활성, 다른 프로젝트는 silent |
| Cache | manual symlink (link-cache.sh) | 공식 `${CLAUDE_PLUGIN_DATA}` directory |

v1 은 7 라운드 review 의 결과물 (skill 본문 자체는 검증됨). v2 는 *로딩 메커니즘* 만 표준화 — skill 본문은 동일 hardlink.

## Migration 이력 (instance 측 영향)

### 2026-05-25 — `STACK_BACKEND_TS_PRESET` → `BACKEND_TS_PRESET` rename

**배경**: v2 plugin rename (`stack-backend-ts` → `backend-ts`) 의 후속 일관성 작업. v5 audit turn (`docs/harness_bestpractice/audit/backend-ts-audit.md`) 에서 일괄 적용.

**instance 측 영향**:

- 기존 CI 파이프라인에서 `STACK_BACKEND_TS_PRESET=hono-workers bash ...` 를 사용 중인 경우 → `BACKEND_TS_PRESET=hono-workers bash ...` 로 갱신 필수
- 자동 fallback ✕ — env var 미인식 시 silent skip (preset 자동 로드 안 됨)
- 갱신 방법:
  1. `docs/ci-template.md` 재 가져오기 + 기존 CI 와 diff
  2. 또는 GitHub Actions / GitLab CI / Jenkins 의 env 정의 검색 후 수동 치환
- forbidden-terms.txt 의 `\bstack-backend-ts-hono\b` 는 *legacy plugin name 검출용* 으로 유지 — 새 rename 대상 ✕

**rename 의 *legacy reference 의도된 보존* 위치** (sed 일괄 치환 대상 ✕):

- 본 CLAUDE.md L37 / L39 — v1 historical reference (commit 91bf02c 에서 v1 plugin 삭제 사실 기록)
- `scripts/forbidden-terms.txt` L18-19 — `stack-backend-ts-hono` legacy term 검출 패턴
