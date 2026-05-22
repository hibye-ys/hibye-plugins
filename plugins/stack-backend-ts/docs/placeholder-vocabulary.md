# Placeholder 어휘 사양

본 plugin 의 모든 SKILL.md 본문은 framework / runtime / 도메인 중립이다. 아래 placeholder 어휘를 사용하며, instance 측 CLAUDE.md 가 실제 값으로 매핑한다.

> **카테고리 구분 — Codex Round 3 권고 반영**
>
> Placeholder 는 두 종류로 분리한다:
>
> - **카테고리 1 (Instance mapping 대상)**: instance 측 CLAUDE.md 의 매핑 표에서 *반드시* 정의해야 하는 토큰. 코드 / config / 라이브러리 등 framework / runtime / domain 의존 값.
> - **카테고리 2 (Generic token / 의사코드)**: 본 plugin SKILL.md 본문이 추상 의사코드 / 자유 서술에 사용. context 로 의미가 명확 — instance 측 매핑 표에 등재 불필요.
>
> `instance-claude-md-template.md` 의 매핑 표는 **카테고리 1 만** cover.

---

## 카테고리 1: Instance mapping 대상

instance 측 CLAUDE.md 의 매핑 표에서 *반드시* 정의해야 하는 placeholder. 코드 / config 등 framework / runtime / 도메인 의존 값.

### 1-A. 기본 framework / runtime placeholder

| Placeholder | 의미 | iyaki-rebuild 예시 매핑 |
|-------------|------|-------------------------|
| `<framework>` | HTTP framework 명 (general) | `Hono` |
| `<framework env binding>` | env 변수 접근 — **두 형태 모두 의도됨** (사용 컨텍스트에 따라). 자세한 형태별 매핑은 §"`<framework env binding>` 두 형태" 참조 | `c.env` (Hono) |
| `<framework HTTP error class>` | framework 의 HTTP 에러 throwable 클래스 | `HTTPException` |
| `<framework SSE helper>` | SSE 응답 헬퍼 함수 | `streamSSE` |
| `<framework json response>` | JSON 응답 헬퍼 | `c.json` |
| `<framework route definition>` | 라우트 정의 호출 | `app.get` / `app.post` / `app.put` / `app.delete` |
| `<framework middleware registration>` | 미들웨어 등록 호출 | `app.use` |
| `<framework context store>` | request-scoped context 의 set/get | `c.set` / `c.get` |
| `<framework request accessor>` | 요청 본문/헤더 접근 | `c.req.*` |
| `<runtime>` | JS 런타임 (Node / Bun / Workers / Deno) | `Cloudflare Workers` |
| `<runtime env binding>` | runtime 의 env 변수 접근 패턴 | `c.env` |
| `<api-app>` | API 어플리케이션 모듈 경로 | `apps/api` |
| `<domain>` | 비즈니스 도메인 명 (소문자) | `iyaki` |
| `<DOMAIN>` | 도메인 명 (대문자) | `IYAKI` |
| `<DOMAIN_VOCAB>` | forbidden-scan / audit 환경변수 — `|` 구분 도메인 어휘 집합 | `writer\|author\|scenario\|novel\|character\|persona` |

### 1-B. 확장 framework / runtime placeholder

| Placeholder | 의미 | iyaki-rebuild 예시 매핑 |
|-------------|------|-------------------------|
| `<framework router>` | 라우터 인스턴스 (`Hono`, `Express Router` 등) | `new Hono()` |
| `<framework zod validator>` | 스키마 검증 middleware (`@hono/zod-validator`) | `zValidator('json', schema)` |
| `<framework zod-validator package>` | zod validator npm 패키지명 | `@hono/zod-validator` |
| `<framework validated body>` | 스키마 검증 후 typed body 접근 | `c.req.valid('json')` |
| `<framework test client>` / `<framework in-process request helper>` | 라우트 직접 호출 (test) | `app.request('/path')` (Hono), `supertest(app)` (Express) |
| `<framework background task helper>` | request 후 백그라운드 작업 | `c.executionCtx.waitUntil(...)` (Workers) |
| `<framework request abort signal>` | request abort signal 접근자 | `c.req.raw.signal` |
| `<runtime dev CLI>` | runtime 의 dev 서버 명령 | `wrangler dev` |
| `<runtime background task>` | runtime-level 백그라운드 task | Workers Durable Object alarm / Queue |
| `<runtime config>` / `<runtime-config>` / `<runtime config 파일>` | runtime 설정 (binding, env, deploy target) | `wrangler.toml` |
| `<runtime cron 설정>` | runtime 의 정기 실행 설정 | `wrangler.toml [[triggers.crons]]` |
| `<runtime-emulator-package>` | runtime emulator npm 패키지명 | `miniflare` |
| `<runtime-test-env>` / `<runtime-test-package>` | runtime 호환 vitest 환경 / 패키지 | `@cloudflare/vitest-pool-workers` |
| `<runtime deployment id>` | runtime 배포 단위 id | wrangler deployment id |
| `<HTTP test client>` | framework 무관 HTTP 테스트 client | `app.request(...)` 또는 `fetch` |
| `<local-secret-file>` | 로컬 개발 시 secret 주입 파일 | `.dev.vars` |
| `<ml-worker-app>` | ML/worker 어플리케이션 경로 | `apps/ml-worker` |
| `<web-app>` | 웹 frontend 어플리케이션 경로 | `apps/web` |
| `<backend-root>` | TS 백엔드 root 경로 | `apps/api` |
| `<workspace-entity>` | LSP / editor 도메인 엔티티 | prose-editor mention — character / scenario / persona |
| `<domain entity>` | 도메인 엔티티 명 (e.g. user, post, order) | (도메인별) writer / scenario / character / persona |

> 위 표의 모든 토큰은 instance 측 매핑 표에서 정의 의무. 누락 시 SKILL.md 본문이 모호 → 코드 작성 불가능.

---

## 카테고리 2: Generic token (의사코드)

본 plugin SKILL.md 본문이 추상 의사코드 / 자유 서술에 사용. **instance 측 매핑 불필요** — context 로 의미가 명확하거나, instance 와 무관한 generic 식별자 / 자유 서술.

### 2-A. 외부 식별자 placeholder

본 plugin 안에서 사용자 / agent / MCP 서버 / 외부 자원 이름을 추상 표기. 실제 값은 instance 의 자체 정의 (mapping 표 ✕).

| Placeholder | 의미 |
|-------------|------|
| `<server-name>` / `<source-name>` | MCP server / 외부 데이터 소스 이름 (예: `github`, `postgres`, `slack`) |
| `<agent-name>` / `<agent>` | 일반 agent 이름 (scaffold / command args, `agents/prompts/<agent>.md`) |
| `<test-args>` | 테스트 / scaffold 인자 |
| `<version-id>` | 배포 / artifact 버전 식별자 (git sha, semver tag) |
| `<other dependent skills>` | 의존 skill 목록 (frontmatter — 예: `architecture-invariants, sub-agent`) |

### 2-B. 자유 서술 placeholder

본 plugin SKILL.md 본문이 *사용자가 자유 작성* 할 부분을 표기 (의사코드 슬롯).

| Placeholder | 의미 |
|-------------|------|
| `<bug description>` | 버그 / 회귀 한 줄 설명 (사용자 작성) |
| `<one-sentence>` | 일반 한 줄 설명 |
| `<describe>` / `<desc>` | 일반 서술 슬롯 |
| `<constraint N>` | constraint 목록 항목 |
| `<expected response shape>` | agent 응답 형식 서술 |
| `<topic>` / `<task>` | 작업 / 토픽 자유 서술 |

### 2-C. 표준 의사코드 토큰 (placeholder ✕)

다음은 *placeholder 가 아니라* 표준 의사코드 — 일반 프로그래밍 어휘. mapping 표 등재 불필요.

`<bool>`, `<int>`, `<string>`, `<number>`, `<dict>`, `<list>`, `<void>`, `<never>`, `<unknown>`, `<boolean>`, `<json>`, `<uuid>`, `<url>`, `<email>`, `<jwt>`, `<kid>`, `<secret>`, `<scope>`, `<id>`, `<key>`, `<name>`, `<file>` / `<files>` / `<filename>` / `<dir>` / `<module>` / `<package>` / `<symbol>` / `<route>` / `<handler>` / `<tool>` / `<event>` / `<entity>` / `<team>` / `<user>` / `<port>` / `<command>` / `<phase>` / `<level>` / `<area>` / `<subsystem>` / `<surface>` / `<category>` / `<cat>` / `<action>` / `<op>` / `<ms>` / `<seconds>` / `<date>` / `<typeof>` / `<sentinel>` / `<scrubbed>` / `<prefix>` / `<server>` / `<idempotency-key>` / `<kebab-case>` / `<table>` / `<behavior>` / `<invariant>` 등.

---

## 사용 규칙

1. **본문은 placeholder 만 사용**: Hono, Workers, wrangler, apps/api, c.env 등 framework / runtime / 경로 구체 명사 금지
2. **instance 측 CLAUDE.md 가 매핑 표 제공**: 카테고리 1 의 모든 토큰을 매핑 표에 등재
3. **카테고리 2 는 매핑 불필요**: instance 측 매핑 표에 등재해도 OK 지만, 의무 ✕
4. **예시 코드는 추상 의사코드**: 실제 framework API 호출이 필요하면 placeholder 함수명 사용
5. **forbidden-scan 이 위반 차단**: `scripts/forbidden-scan.sh` 가 모든 SKILL.md 에 framework / runtime 어휘 등장 시 fail
6. **acceptance-check 가 alignment 검증**: scope = `project`, frontmatter 검증

---

## 비 placeholder (그대로 사용 가능)

다음 어휘는 framework / runtime 무관 표준이므로 placeholder 화하지 않음:

- HTTP 표준 (GET, POST, 200, 401, 429, SSE, headers 명)
- 일반 디자인 패턴 (middleware, router, handler, schema, retry, circuit breaker)
- JS/TS 언어 (async, await, Promise, Buffer, ReadableStream)
- 표준 라이브러리 (fetch API, AbortController, console)
- 일반 도구 (pnpm, npm, vitest, eslint, prettier, tsc)
- 일반 클라우드 추상 (Postgres, Redis, S3-compatible)

---

## `<framework env binding>` 두 형태

본 placeholder 는 사용 컨텍스트에 따라 **두 형태** 가 의도됨. instance 측에서 framework 에 맞게 매핑:

| 형태 | 사용처 | Hono 예시 매핑 | 의미 |
|---|---|---|---|
| **Callable** `<framework env binding>(ctx).X` | request handler 안 (ctx 보유) | `c.env.X` | request-scoped env binding 접근 |
| **값** `<framework env binding>.X` | middleware setup / lifespan / 모듈 레벨 | `env.X` (별도 주입) | bootstrap 시점 env 접근 (ctx 없음) |

| 구분 | callable form | 값 form |
|---|---|---|
| 호출 시점 | 매 request 마다 | 부팅 / 첫 요청 / 모듈 로드 |
| ctx 의존 | 있음 | 없음 (별도 주입) |
| 예시 | `const apiKey = <framework env binding>(ctx).OPENROUTER_API_KEY` | `assertRequiredSecrets(<framework env binding>)` |
| Hono 매핑 | `c.env.X` | middleware 의 `c.env` 를 lifespan 객체에 한 번 set 후 사용 |

**framework 별 매핑 가이드** (instance 측 CLAUDE.md 에서 두 형태 모두 매핑):

- **Hono**: 둘 다 `c.env.X` — callable 은 `c` 가 ctx 역할, 값은 setup 시 1회 read 후 module-scoped const 보관 (runtime 별 binding 객체 = `c.env`)
- **Express**: callable = `req.app.locals.env.X` (lifespan 시점에 `app.locals.env = parseEnv()` 로 주입). 값 form = lifespan 안에서 한 번 read 한 `env` 변수 (module-scoped const). **`process.env.X` 직접 ✕** — `parseEnv()` 같은 명시적 zod-validated env 객체 경유
- **Fastify**: callable = `request.server.env.X` (단, `@fastify/env` plugin 또는 `fastify.decorate('env', ...)` 등록 의무 — Fastify 는 default 로 `server.env` 미보유). 값 form = lifespan 의 `fastify.env` (decoration 후)

원칙:
- request handler 안에서는 항상 **callable form** (ctx 경유). 모듈 레벨 캐시 ✕
- bootstrap / lifespan 안에서는 **값 form**. 1회 read 후 module-scoped const 에 보관
- **`process.env.X` 직접 사용 ✕** — 모든 framework 에서 부팅 시 1회 zod-validated env 객체 (`parseEnv()` 등) 경유. 일부 runtime (예: edge function) 은 `process.env` 가 undefined — `<framework env binding>` 으로만 접근 (runtime-specific, instance 측 project-local skill 참조). [[config-env-validation]] invariant 의 `getSecret` / `assertRequiredSecrets` 와 연계

자세한 startup 검증 패턴은 [[config-env-validation]] invariant.

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
