# Placeholder 어휘 사양

본 plugin 의 모든 SKILL.md 본문은 framework / runtime / 도메인 중립이다. 아래 placeholder 어휘를 사용하며, instance 측 CLAUDE.md 가 실제 값으로 매핑한다.

## 기본 placeholder

| Placeholder | 의미 | 사용 예시 |
|-------------|------|-----------|
| `<framework>` | HTTP framework 명 (general) | "`<framework>` 미들웨어 등록 시 …" |
| `<framework env binding>` | request handler context 의 환경 변수 접근 | "`<framework env binding>` 으로 secret 읽기" |
| `<framework HTTP error class>` | framework 의 HTTP 에러 throwable 클래스 | "`throw new <framework HTTP error class>(401, ...)`" (예: `HTTPException`) |
| `<framework SSE helper>` | SSE 응답 헬퍼 함수 | "`<framework SSE helper>(c, async (stream) => { ... })`" |
| `<framework json response>` | JSON 응답 헬퍼 | "`return <framework json response>({ ok: true })`" |
| `<framework route definition>` | 라우트 정의 호출 | "`<framework route definition>('/health', handler)`" |
| `<framework middleware registration>` | 미들웨어 등록 호출 | "`<framework middleware registration>('*', authMw)`" |
| `<framework context store>` | request-scoped context 의 set/get | `c.set / c.get` 등 |
| `<framework request accessor>` | 요청 본문/헤더 접근 | `c.req.json()` 등 |
| `<runtime>` | JS 런타임 (Node / Bun / Workers / Deno) | "`<runtime>` 의 fetch API …" |
| `<runtime env binding>` | runtime 의 env 변수 접근 패턴 | `process.env`, `c.env`, `Deno.env` 등 instance 별 |
| `<api-app>` | API 어플리케이션 모듈 경로 | "`<api-app>/src/routes/...`" (예: `apps/api`) |
| `<domain>` | 비즈니스 도메인 명 (소문자) | "`<domain>` 데이터베이스 …" |
| `<DOMAIN>` | 도메인 명 (대문자) | "`<DOMAIN>` 환경변수 prefix" |
| `<domain entity>` | 도메인 엔티티 명 (e.g. user, post, order) | "`<domain entity>` 테이블 …" |
| `<DOMAIN_VOCAB>` | forbidden-scan 환경변수 — \| 구분 도메인 어휘 집합 | `writer\|author\|scenario\|...` |

## 본문에서 사용되는 확장 placeholder

기본 placeholder 의 파생 또는 더 좁은 의미. 본 표는 본문에서 실제 등장하는 모든 `<...>` 토큰을 망라.

| Placeholder | 의미 | iyaki-rebuild 예시 매핑 |
|-------------|------|-------------------------|
| `<framework router>` | 라우터 인스턴스 (`Hono`, `Express Router` 등) | `new Hono()` |
| `<framework zod validator>` | 스키마 검증 middleware (`@hono/zod-validator`) | `zValidator('json', schema)` |
| `<framework zod-validator package>` | zod validator npm 패키지명 | `@hono/zod-validator` |
| `<framework validated body>` | 스키마 검증 후 typed body 접근 | `c.req.valid('json')` |
| `<framework test client>` / `<framework in-process request helper>` | 라우트 직접 호출 (test) | `app.request('/path')` (Hono), `supertest(app)` (Express) |
| `<framework background task helper>` | request 후 백그라운드 작업 | `c.executionCtx.waitUntil(...)` (Workers) |
| `<framework request abort signal>` | request abort signal 접근자 | `c.req.raw.signal` |
| `<runtime dev CLI>` | runtime 의 dev 서버 명령 | `wrangler dev`, `npm run dev` |
| `<runtime background task>` | runtime-level 백그라운드 task | runtime SDK 의 deferred execution |
| `<runtime config>` / `<runtime-config>` / `<runtime config 파일>` | runtime 설정 (binding, env, deploy target) | `wrangler.toml`, `vercel.json`, `serverless.yml` |
| `<runtime cron 설정>` | runtime 의 정기 실행 설정 | `wrangler.toml [[triggers.crons]]`, GH Actions schedule |
| `<runtime-emulator-package>` | runtime emulator npm 패키지명 | `miniflare`, `@cloudflare/workers-types` |
| `<runtime-test-env>` / `<runtime-test-package>` | runtime 호환 vitest 환경 / 패키지 | `miniflare`, `@cloudflare/vitest-pool-workers` |
| `<runtime deployment id>` | runtime 배포 단위 id | wrangler deployment id, vercel deployment id |
| `<HTTP test client>` | framework 무관 HTTP 테스트 client | `fetch`, `supertest`, `axios` test |
| `<local-secret-file>` | 로컬 개발 시 secret 주입 파일 | `.dev.vars`, `.env.local` |
| `<ml-worker-app>` | ML/worker 어플리케이션 경로 | `apps/ml-worker` |
| `<web-app>` | 웹 frontend 어플리케이션 경로 | `apps/web` |
| `<backend-root>` | TS 백엔드 root 경로 | `apps/api`, `services/backend` |
| `<workspace-entity>` | LSP / editor 도메인 엔티티 | prose-editor mention, code symbol, blog tag |
| `<server-name>` / `<source-name>` | MCP server / 외부 소스 이름 | `github`, `postgres`, `slack` |
| `<version-id>` | 배포 / artifact 버전 식별자 | git sha, semver tag |
| `<agent-name>` / `<agent>` / `<test-args>` | 일반 인자 / 파일명 placeholder | scaffold / command args, `agents/prompts/<agent>.md` |
| `<other dependent skills>` | 의존 skill 목록 (frontmatter) | `architecture-invariants, sub-agent` |
| `<bug description>` / `<one-sentence>` / `<describe>` / `<desc>` | 자유 서술 placeholder | 사용자 작성 |

> Step 1 의 grep 결과에서 추출된 모든 placeholder 가 본 두 표 (기본 + 확장) 합해서 100% 커버해야 함. 추가 발견 시 본 표 갱신.
>
> 일반 의사코드 token (`<bool>`, `<int>`, `<string>`, `<number>`, `<dict>`, `<list>`, `<void>`, `<never>`, `<unknown>`, `<boolean>`, `<json>`, `<uuid>`, `<url>`, `<email>`, `<jwt>`, `<kid>`, `<secret>`, `<scope>`, `<id>`, `<key>`, `<name>`, `<file>` / `<files>` / `<filename>` / `<dir>` / `<module>` / `<package>` / `<symbol>` / `<route>` / `<handler>` / `<tool>` / `<event>` / `<entity>` / `<team>` / `<user>` / `<port>` / `<command>` / `<phase>` / `<level>` / `<area>` / `<subsystem>` / `<surface>` / `<category>` / `<cat>` / `<action>` / `<op>` / `<ms>` / `<seconds>` / `<date>` / `<typeof>` / `<sentinel>` / `<scrubbed>` / `<prefix>` / `<server>` / `<idempotency-key>` / `<kebab-case>` / `<table>` / `<behavior>` / `<invariant>` 등) 은 placeholder 가 아닌 표준 의사코드 토큰 — 본 vocab 의 매핑 대상이 아님.

## 사용 규칙

1. **본문은 placeholder 만 사용**: Hono, Workers, wrangler, apps/api, c.env 등 framework/runtime/경로 구체 명사 금지
2. **instance 측 CLAUDE.md 가 매핑 표 제공**: `<framework>` → `Hono`, `<runtime>` → `Cloudflare Workers` 등
3. **예시 코드는 추상 의사코드**: 실제 framework API 호출이 필요하면 placeholder 함수명 사용
4. **forbidden-scan 이 위반 차단**: `scripts/forbidden-scan.sh` 가 모든 SKILL.md 에 framework/runtime 어휘 등장 시 fail
5. **acceptance-check 가 alignment 검증**: scope = `project`, frontmatter 검증

## 비 placeholder (그대로 사용 가능)

다음 어휘는 framework/runtime 무관 표준이므로 placeholder 화하지 않음:

- HTTP 표준 (GET, POST, 200, 401, 429, SSE, headers 명)
- 일반 디자인 패턴 (middleware, router, handler, schema, retry, circuit breaker)
- JS/TS 언어 (async, await, Promise, Buffer, ReadableStream)
- 표준 라이브러리 (fetch API, AbortController, console)
- 일반 도구 (pnpm, npm, vitest, eslint, prettier, tsc)
- 일반 클라우드 추상 (Postgres, Redis, S3-compatible)

## Forbidden 어휘 (재유입 차단 대상)

| 어휘 | 대체 |
|------|------|
| `Hono` / `hono` | `<framework>` |
| `Workers` / `workers runtime` / `Cloudflare Workers` | `<runtime>` |
| `wrangler` / `wrangler.toml` | 제거 또는 `<runtime config>` |
| `c.env` / `c.req` / `c.json` / `c.set` | `<framework env binding>` 등 |
| `streamSSE` | `<framework SSE helper>` |
| `HTTPException` | `<framework HTTP error class>` |
| `app.use` / `app.get` / `app.post` / `app.all` | `<framework middleware registration>` / `<framework route definition>` |
| `Cloudflare` | 제거 또는 `<runtime>` |
| `apps/api` | `<api-app>` |
| `c.executionCtx` | 제거 (runtime-specific) |
