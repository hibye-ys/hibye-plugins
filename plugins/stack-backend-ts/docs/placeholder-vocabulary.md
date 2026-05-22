# Placeholder 어휘 사양

본 plugin 의 모든 SKILL.md 본문은 framework / runtime / 도메인 중립이다. 아래 placeholder 어휘를 사용하며, instance 측 CLAUDE.md 가 실제 값으로 매핑한다.

## 기본 placeholder

| Placeholder | 의미 | 사용 예시 |
|-------------|------|-----------|
| `<framework>` | HTTP framework 명 (general) | "`<framework>` 미들웨어 등록 시 …" |
| `<framework env binding>` | request handler context 의 환경 변수 접근 | "`<framework env binding>` 으로 secret 읽기" |
| `<framework HTTP error class>` | framework 의 HTTP 에러 throwable 클래스 | "`throw new <framework HTTP error class>(401, ...)`" |
| `<framework SSE helper>` | SSE 응답 헬퍼 함수 | "`<framework SSE helper>(c, async (stream) => { ... })`" |
| `<framework json response>` | JSON 응답 헬퍼 | "`return <framework json response>({ ok: true })`" |
| `<framework route definition>` | 라우트 정의 호출 | "`<framework route definition>('/health', handler)`" |
| `<framework middleware registration>` | 미들웨어 등록 호출 | "`<framework middleware registration>('*', authMw)`" |
| `<framework context store>` | request-scoped context 의 set/get | `c.set / c.get` 등 |
| `<framework request accessor>` | 요청 본문/헤더 접근 | `c.req.json()` 등 |
| `<runtime>` | JS 런타임 (Node / Bun / Workers / Deno) | "`<runtime>` 의 fetch API …" |
| `<runtime env binding>` | runtime 의 env 변수 접근 패턴 | `process.env`, `c.env`, `Deno.env` 등 instance 별 |
| `<api-app>` | API 어플리케이션 모듈 경로 | "`<api-app>/src/routes/...`" |
| `<domain>` | 비즈니스 도메인 명 (소문자) | "`<domain>` 데이터베이스 …" |
| `<DOMAIN>` | 도메인 명 (대문자) | "`<DOMAIN>` 환경변수 prefix" |
| `<domain entity>` | 도메인 엔티티 명 (e.g. user, post, order) | "`<domain entity>` 테이블 …" |
| `<DOMAIN_VOCAB>` | forbidden-scan 환경변수 — \| 구분 도메인 어휘 집합 | `writer\|author\|scenario\|...` |

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
