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

예시 project-local skills (iyaki-rebuild):

- `workers-compat/` — Cloudflare Workers 호환성 가드
- `verify-workers-compat/` — Workers API 비호환 사용 검증
- `pre-deploy-check/` — wrangler deploy 전 체크리스트
- `runtime-verify/` — 실제 Workers 환경 health check
- `d1-forbidden-audit/` — D1 스키마 forbidden 패턴
- `data-governance/` — 도메인 데이터 거버넌스 (CCv3, SillyTavern 등 구체)
- `update-config-runtime/` — runtime-specific config 동기화
- `infra-audit/` — infrastructure 감사
