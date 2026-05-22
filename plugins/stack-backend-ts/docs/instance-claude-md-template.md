# Instance CLAUDE.md 작성 템플릿

stack-backend-ts plugin 사용 instance (예: iyaki-rebuild) 측 프로젝트 root 의 `CLAUDE.md` 작성 가이드.

## 최소 구조

```markdown
@AGENTS.md

## stack-backend-ts plugin placeholder 매핑

| Placeholder | 이 프로젝트의 값 |
|-------------|------------------|
| `<framework>` | Hono |
| `<framework env binding>` | `c.env` |
| `<framework HTTP error class>` | `HTTPException` |
| `<framework SSE helper>` | `streamSSE` |
| `<framework json response>` | `c.json` |
| `<framework route definition>` | `app.get` / `app.post` / `app.put` / `app.delete` |
| `<framework middleware registration>` | `app.use` |
| `<framework context store>` | `c.set` / `c.get` |
| `<framework request accessor>` | `c.req.*` |
| `<runtime>` | Cloudflare Workers |
| `<runtime env binding>` | `c.env` |
| `<api-app>` | `apps/api` |
| `<domain>` | `iyaki` |
| `<DOMAIN>` | `IYAKI` |
| `<DOMAIN_VOCAB>` | `writer|author|scenario|novel|character|persona` |
| `<framework router>` | `Hono` ( `new Hono()` ) |
| `<framework zod validator>` | `@hono/zod-validator` ( `zValidator('json', schema)` ) |
| `<framework zod-validator package>` | `@hono/zod-validator` |
| `<framework validated body>` | `c.req.valid('json')` |
| `<framework test client>` / `<framework in-process request helper>` | `app.request(...)` |
| `<framework background task helper>` | `c.executionCtx.waitUntil(...)` |
| `<framework request abort signal>` | `c.req.raw.signal` |
| `<runtime dev CLI>` | `wrangler dev` |
| `<runtime background task>` | Workers Durable Object alarm / Queue |
| `<runtime config>` / `<runtime-config>` / `<runtime config 파일>` | `wrangler.toml` |
| `<runtime cron 설정>` | `wrangler.toml [[triggers.crons]]` |
| `<runtime-emulator-package>` | `miniflare` |
| `<runtime-test-env>` / `<runtime-test-package>` | `@cloudflare/vitest-pool-workers` |
| `<runtime deployment id>` | wrangler deployment id |
| `<HTTP test client>` | `app.request(...)` (Hono 의 in-process) 또는 `fetch` 직접 호출 |
| `<local-secret-file>` | `.dev.vars` |
| `<backend-root>` | `apps/api` |
| `<ml-worker-app>` | `apps/ml-worker` |
| `<web-app>` | `apps/web` |
| `<workspace-entity>` | prose-editor mention (`@`) — character / scenario / persona |
| `<server-name>` / `<source-name>` | MCP 서버 이름 (예: `github`, `postgres`) |
```

## DOMAIN_VOCAB 환경변수

`scripts/audit-all.sh` 의 `app-domain-boundary` audit 가 사용:

```bash
export DOMAIN_VOCAB="writer|author|scenario|novel|character|persona"
bash plugins/stack-backend-ts/scripts/audit-all.sh
```

CI 에서는 워크플로우 env 섹션에 등록:

```yaml
env:
  DOMAIN_VOCAB: "writer|author|scenario|novel|character|persona"
```

## Project-local skills

이 프로젝트만의 framework/runtime/domain-bound skill 은 `.claude/skills/` 에 둠. plugin SKILL.md 본문에서 project-local 참조가 등장하면 (예: "runtime-specific — instance 측 project-local skill 참조") project 측 `.claude/skills/<name>/SKILL.md` 가 응답해야 함.

> **참고**: 본 plugin 의 round 1 작업에서 다음 skill 들이 plugin → instance 측으로 이전됨. 본 plugin 의 SKILL.md 본문은 더 이상 이들을 *plugin skill 로서* 참조하지 않음 (잔존 ✕). 아래는 *instance 측 project-local skill* 의 **예시 명단** (iyaki-rebuild 의 `.claude/skills/<name>/SKILL.md`) — 다른 instance 는 자체 runtime/domain 에 맞춰 다른 명단을 가져야 함:

- `workers-compat/` — Cloudflare Workers 호환성 가드
- `verify-workers-compat/` — Workers API 비호환 사용 검증
- `pre-deploy-check/` — wrangler deploy 전 체크리스트
- `runtime-verify/` — 실제 Workers 환경 health check
- `d1-forbidden-audit/` — D1 스키마 forbidden 패턴
- `data-governance/` — 도메인 데이터 거버넌스 (CCv3, SillyTavern 등 구체)
- `update-config-runtime/` — runtime-specific config 동기화
- `infra-audit/` — infrastructure 감사

> 즉 위 6+2 개 skill 이 plugin 의 `skills/` 디렉토리에 보이지 않는 것은 *정상* — round 1 의 plugin-→-instance 이전 결과이며, instance 측 `.claude/skills/` 가 정본. plugin 본문이 이들을 *plugin skill 로* 참조하면 lint/audit 가 fail 해야 함 (정확한 패턴 = "instance 측 project-local skill 참조" 문구로만 등장).
