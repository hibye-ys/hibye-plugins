---
name: codex-commands
description: Codex CLI 에서 backend-ts plugin 의 slash command / 명령 호출 방식 질문 시 invoke. Codex 공식 plugin spec 은 commands 를 plugin component 로 인식 ✕ — Claude Code `.claude/commands/` 동등 시스템 부재. 본 skill 은 Codex 의 built-in slash commands 활용 + backend-ts plugin skill 의 정상 발견 경로 안내. Do NOT use for 개별 skill 정의 (해당 skill 직접 invoke).
metadata:
  role: workflow
  scope: project
---

# codex-commands — Codex CLI 의 commands 모델 (부정 안내)

> **본 skill 은 *부정 안내* skill**. 사용자가 Claude Code 의 `.claude/commands/<name>.md` 같은 *plugin 이 번들로 제공하는 custom slash command* 가 Codex 에도 있다고 가정하고 디렉토리 / dispatch / spawn API 를 찾을 때, **Codex 의 실재 메커니즘** 으로 redirect 한다.

## 이 skill 은 언제 invoke 되는가

- Codex CLI 에서 backend-ts plugin 의 *slash command* 호출 시도가 동작 안 함
- "Claude Code 의 `/agent-debug` 같은 게 Codex 에도 있는가?" 질문
- backend-ts 의 84 skill 이 Codex 에서 정상 발견되는지 확인 필요
- `.codex-plugin/commands/` 디렉토리를 만들지 결정 (→ 만들지 마라)

## 핵심 사실 (Codex 공식 spec 직접 인용)

> *"Only `plugin.json` belongs in `.codex-plugin/`. Keep `skills/`, `hooks/`, `assets/`, `.mcp.json`, and `.app.json` at the plugin root."*
> — [`developers.openai.com/codex/plugins/build`](https://developers.openai.com/codex/plugins/build) (fetched 2026-05-25, verbatim)

공식 plugin component **4개** — `commands` / `agents` 는 component 가 **아님**:

| Component | 위치 | backend-ts 사용 |
|---|---|---|
| `skills` | `./skills/` (plugin root) | ✅ 84 skill (`plugin.json` 의 `"skills": "./skills/"`) |
| `mcpServers` | `./.mcp.json` | ✕ 미사용 |
| `apps` | `./.app.json` | ✕ 미사용 |
| `hooks` | `./hooks/hooks.json` | ✕ 미사용 |

## Codex 의 slash commands

- Codex CLI 는 *built-in* slash commands (`/help`, `/init` 등) 만 spec 으로 보장. 자세한 list 는 [`developers.openai.com/codex/cli/slash-commands`](https://developers.openai.com/codex/cli/slash-commands).
- *Custom* slash command 의 디렉토리 discovery spec 은 공식 docs 에 미공개 (2026-05-25 fetch 시점).
- **결론**: Claude Code `.claude/commands/<name>.md` 같은 *plugin 이 번들로 제공하는 custom slash command* 메커니즘은 Codex plugin spec 에 부재. backend-ts 가 제공할 만한 `/agent-debug` 등의 슬래시 명령은 **Codex 에서 직접 부를 수 없음** — Claude Code 환경에서만 동작.

## Codex 에서 backend-ts 를 *제대로* 쓰는 방법

1. **Plugin manifest 등록 확인** — [`plugins/backend-ts/.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json) 의 `"skills": "./skills/"`.
2. **Skill discovery 경로** (Codex 공식 — [`developers.openai.com/codex/skills`](https://developers.openai.com/codex/skills)):
   - `$CWD/.agents/skills`
   - `$CWD/../.agents/skills`
   - `$REPO_ROOT/.agents/skills`
   - `$HOME/.agents/skills`
   - `/etc/codex/skills`
3. **84 skill 은 description trigger 로 자동 활성** — Codex 가 task 컨텍스트 따라 lazy load. **이유**: agentskills.io cross-vendor 표준의 progressive disclosure 모델 (metadata → SKILL.md body → resources) 이 Codex / Claude Code 양쪽에서 동작.
4. **Claude Code `/agent-debug` 같은 명령이 필요하면** — 사용자가 자연어로 요청 (예: "agent loop 디버그 해줘") → Codex 가 해당 skill (예: [[debug-session]]) trigger.

## 자주 보는 함정

- **`.codex-plugin/commands/` 디렉토리 만들기** — Codex 가 인식 ✕ (공식 spec 명시적으로 *"All other components reside at the plugin root level"*). 디렉토리를 만들어도 작동 ✕.
- **Claude Code `.claude/commands/` 의 marker md 를 Codex 에 복붙** — 같은 이유로 작동 ✕. mirror 시스템 부재.
- **`@codex/cli-host` 또는 `spawnAgent` API 검색** — 실재 npm 패키지 ✕. 가공의 API.
- **AGENTS.md 에 slash command 정의** — AGENTS.md 는 단일 프로젝트 인스트럭션 파일이지 command catalog 가 아님 (자세한 건 [[codex-subagents]]).

## 향후 변경 감지

Codex CLI 가 custom slash command 또는 `commands` plugin component 를 추가하면 본 skill 갱신 필요:

- [`developers.openai.com/codex/plugins/build`](https://developers.openai.com/codex/plugins/build) 의 manifest fields 표에 `commands` 추가 확인
- [`developers.openai.com/codex/cli/slash-commands`](https://developers.openai.com/codex/cli/slash-commands) 의 *Custom commands* 섹션 추가 확인
