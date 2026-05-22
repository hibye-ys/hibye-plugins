---
name: codex-commands
description: Codex 환경에서 stack-backend-ts-hono plugin 의 slash command 호출 시 invoke. `.codex-plugin/commands/` 카탈로그 + arg 파싱 + 출력 포맷. Claude Code 의 `.claude/commands/` 와 contract 호환 — Codex 측 mirror.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/skills/codex-commands
---

**적용된 §4.4 매트릭스 행**: Python `click` → TS `commander` 또는 `yargs` (또는 marker md 만 — implementation 별도), `os.getenv` (Python host) → `process.env` (Codex CLI host), `pydantic` arg validation → `zod`, `pytest` smoke → `vitest`, `print` → `console.log` (`JSON.stringify` for structured)

# codex-commands — Codex slash command adapter

> 본 skill = Codex 환경에서 stack-backend-ts-hono plugin 의 command harness adapter. canonical command 정의는 `references/commands/<command>.md` (marker md 의 frontmatter) 에 있고, Claude Code 의 `.claude/commands/` 를 `.codex-plugin/commands/` 로 mirror 한 결과다.

## 이 skill 은 언제 invoke 되는가

- 사용자가 Codex 안에서 plugin slash command 호출 (`/agent-debug`, `/agent-test`, `/audit-all` 등)
- "Codex 에서 이 command 어떻게 부르지?" 질문
- 새 command 추가 (marker md + TS implementation 동시)
- `.codex-plugin/commands/` 디렉토리 동기화 검토

## Dispatch 절차

1. 사용자 요청에서 command 이름 파싱. `/agent-verify foo` 와 `agent-verify foo` 동치 처리
2. `references/commands/<command>.md` 읽기 (Codex 측 mirror)
3. 해당 command 의 dispatch 룰 따라 실행 — `$ARGUMENTS` 자리에 사용자 남은 텍스트 치환
4. command 가 manager / auditor 를 가리키면 `codex-subagents` skill 로드 후 agent reference 읽기. **사용자가 명시적으로 sub-agent 위임을 요청한 경우에만** Codex sub-agent spawn — 그 외에는 reference 만 local 적용
5. `.claude/` 파일은 read-only — Codex 측 편집은 `.agents/` / `.codex/` / 일반 소스 파일에서만

## Command Map

Claude Code `.claude/commands/` ↔ Codex `.codex-plugin/commands/` 동등 매핑:

| Command | Primary route (Codex 측 reference) |
|---|---|
| `/help` | 본 map + reference 치트시트 노출 |
| `/agent-debug` | `debug-session` |
| `/agent-test` | `testing-infra` + command reference 의 vitest 플래그 |
| `/agent-verify` | `runtime-verify` (audit) |
| `/audit-all` | `app-domain-boundary-audit` + 13 audit batch (scripts/audit-all.sh) |
| `/incident` | `incident-triage` (workflow — 09d 대상, 미존재 시 reference 만) |
| `/new-agent` | `new-agent` skill |
| `/new-run` | `new-run` skill |
| `/new-tool` | command reference + `tool-system` skill |
| `/pre-deploy` | `pre-deploy-check` skill |
| `/spec-diff` | command reference + spec-diff-auditor reference (agents/) |
| `/sse-trace` | command reference + 로컬 SSE curl trace (서버 실행 중일 때) |
| `/test-coverage` | command reference + `test-cleanup` / `test-scaffold` |

## Argument Handling

- `/agent-verify` 의 quoted JSON 인자는 그대로 보존 (escape 변환 ✕)
- `/sse-trace` 와 `/incident` 의 free-form message 텍스트도 그대로 보존
- scaffold 계열 command (`/new-agent`, `/new-run`, `/new-tool`) 는 이름 검증 후 진행 — 기존 파일 덮어쓰기 ✕
- write/scaffold 동작 전 의도된 파일 경로를 먼저 보여주기 — silent edit ✕

## TS implementation 패턴

Codex command 정의 = marker md 한 파일 (frontmatter + 본문). 실제 실행 코드는 별도:

```
plugins/stack-backend-ts-hono/
├── .codex-plugin/
│   └── commands/
│       └── <command>.md       # marker (frontmatter: name/description/dispatch)
└── scripts/
    └── <command>.ts            # TS implementation (tsx 또는 bun 으로 실행)
```

marker md frontmatter 예시:

```markdown
---
name: agent-verify
description: Verify agent definition against schema + boot smoke
args: <agent-name> [--strict]
dispatch: scripts/agent-verify.ts
---

# /agent-verify

<본문 = 사용자 가이드 + 예시>
```

TS implementation 스켈레톤:

```typescript
// scripts/agent-verify.ts — tsx run target
import { z } from 'zod'

const ArgSchema = z.object({
  agentName: z.string().regex(/^[a-z0-9_]+$/),
  strict: z.boolean().default(false),
})

async function main() {
  // 1. parse process.argv (Codex CLI 가 $ARGUMENTS 를 argv 로 전달)
  const raw = parseArgs(process.argv.slice(2))
  const args = ArgSchema.parse(raw)

  // 2. env access — process.env (Codex CLI host)
  const apiUrl = process.env.APPS_API_URL ?? 'http://localhost:8787'

  // 3. 작업 실행
  const result = await runVerify(args.agentName, { strict: args.strict, apiUrl })

  // 4. 출력 — JSON 한 줄 (Codex parsing 용이) + human-readable 별도
  console.log(JSON.stringify({ ok: result.ok, errors: result.errors }))
  process.exit(result.ok ? 0 : 1)
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err) }))
  process.exit(2)
})
```

실행:

```bash
# Codex CLI 가 자동 dispatch:
# /agent-verify chat_test
# → tsx scripts/agent-verify.ts chat_test
npx tsx scripts/agent-verify.ts chat_test --strict
```

## 출력 포맷 규약

| 출력 채널 | 용도 |
|---|---|
| stdout JSON 한 줄 | machine-readable 결과 — Codex 가 parse |
| stderr human text | progress / 디버그 메시지 |
| exit code 0 | 성공 |
| exit code 1 | command 의 도메인 실패 (검증 실패 등 — 정상적인 negative result) |
| exit code 2 | 예외 (인자 파싱 실패, env 누락 등) |

마지막 stdout 라인이 JSON 이어야 함 — Codex 의 result handler 가 그 라인만 본다. 중간 progress 는 stderr 로.

## 신규 command 추가 절차

1. `.codex-plugin/commands/<name>.md` marker 작성 (frontmatter + 사용 가이드 본문)
2. `scripts/<name>.ts` 작성 (zod arg 검증 + 도메인 로직 + JSON 출력)
3. Claude Code 측 `.claude/commands/<name>.md` 동시 생성 (Claude 측은 frontmatter 만, Bash invocation 으로 동일 `scripts/<name>.ts` 호출)
4. 본 SKILL.md 의 Command Map 표에 1행 추가
5. smoke: `npx tsx scripts/<name>.ts <test-args>` → JSON exit 0 확인
6. `vitest` 로 scripts/<name>.test.ts 작성 (선택)

## 자주 보는 함정

- **`.claude/commands/` 와 `.codex-plugin/commands/` drift** — 같은 command 가 두 곳에서 다르게 동작. 양쪽 marker md 의 frontmatter 동기 유지 (특히 `dispatch` 경로)
- **`$ARGUMENTS` quoting 파괴** — JSON 인자에 escape 시도. Codex CLI 가 이미 그대로 전달하므로 추가 변환 ✕
- **`process.env` 누락 — runtime 시 undefined** — zod env schema 미리 적용 (`scripts/_env.ts` 공통)
- **Claude `.claude/commands/` 파일 편집** — Codex 측 작업 중 실수로 Claude mirror 갱신. `.claude/` 는 read-only 로 취급 — Codex 측 변경은 항상 `.agents/` 또는 marker md 만

## reference 사용

특정 command 의 본문만 빠르게 읽기:

```bash
sed -n '1,220p' .codex-plugin/commands/<command>.md
```

전체 카탈로그 확인:

```bash
ls .codex-plugin/commands/
```

## 검증 체크리스트

- [ ] 본 SKILL.md Command Map 의 모든 행에 대응 `.codex-plugin/commands/<name>.md` 존재
- [ ] 모든 command 의 `scripts/<name>.ts` (또는 marker 의 `dispatch:` 경로) 가 실재
- [ ] Codex 측 marker md 와 Claude Code 측 `.claude/commands/<name>.md` 의 frontmatter `name` / `description` / `dispatch` 일치 (drift ✕)
- [ ] 모든 TS implementation 이 JSON-line 출력 + exit code 규약 준수
- [ ] 스캐폴드 command 는 이름 검증 (`/^[a-z0-9_]+$/`) + 기존 파일 덮어쓰기 ✕

## 구현 중 막히면

- Codex 가 command 못 찾음 → `.codex-plugin/commands/` 디렉토리 위치 확인 (plugin root 기준 상대경로)
- `npx tsx` 실패 → `package.json` 의 devDependencies 에 tsx 또는 bun 포함 확인
- argument parsing 깨짐 → 인자 quoting 보존 확인. `process.argv.slice(2)` 가 raw 인지 검증
- Claude 측은 동작하는데 Codex 측은 실패 → marker md 의 `dispatch:` 경로 vs `.claude/commands/<name>.md` 의 Bash invocation 차이 비교
