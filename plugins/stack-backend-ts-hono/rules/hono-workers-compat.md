# Hono Backend — Web 표준 (Workers 호환) 룰

본 디렉토리 안 모든 파일 작업 시 적용. 공통 invariant 는 root `AGENTS.md` 참고.

## 런타임

Node (`@hono/node-server`) — 로컬 dev 편의. 단 **Cloudflare Workers 호환 코드 룰** 을 처음부터 지킨다.

## OK (Web 표준)

- `fetch`, `Request`, `Response`, `ReadableStream`, `URL`, `URLSearchParams`, `crypto.subtle`
- Hono `Context`, `c.req`, `c.json`, `c.env`
- `streamText` / `streamUI` 등 Vercel AI SDK
- `zod` 검증

## NG (Node-only API, Workers 부정합)

- `fs` / `fs/promises` — 파일 시스템 접근 X
- `child_process` — 외부 프로세스 호출 X
- `path` — Web 표준 `URL` 사용
- `Buffer` — `Uint8Array` 또는 `ArrayBuffer` 사용
- `process.env.X` 직접 read — 대신 Hono `c.env.X` 패턴 (양쪽 호환)
- Node Stream API (`stream` 모듈) — `ReadableStream` / `WritableStream` 사용
- `http` / `https` 모듈 — `fetch` 사용

## 환경변수

`c.env.OPENROUTER_API_KEY` 패턴. Node 에선 어댑터가 `process.env` 채워주고, Workers 에선 wrangler 가 채워줌.

## Escape hatch (격리 어댑터 안에서만 Node API OK)

- `apps/api/src/storage/provider.ts` 의 LocalFsProvider → R2 swap 시 통째 교체될 어댑터라 `fs` 사용 OK
- `apps/api/src/env.ts` → dotenv 로딩 (Node only, 부트스트랩)
- 그 외 일반 서버 코드에선 위 NG 룰 그대로 적용

## LLM 추상화 가이드

OpenRouter default 자체는 root `AGENTS.md`. 본 디렉토리 구현 시 추가 룰:

- **얇은 provider swap 어댑터 OK** — chain / agent / memory 자체 추상화는 ✕
- 추상화 부풀림 신호 = 12 개월 후 LangChain 닮은 자체 layer 가 자라남
