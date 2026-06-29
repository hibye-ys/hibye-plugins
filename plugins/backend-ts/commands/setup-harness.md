---
description: 현재 프로젝트에 backend-ts 하네스를 Claude Code / Codex / OpenCode 세 도구 모두로 배선한다 (install 직후 1회 실행).
---

현재 작업 디렉토리(`$PWD`)에 backend-ts 하네스를 **세 코딩툴 모두**에서 쓸 수 있게 배선하세요.

## 절차

1. **hibye-plugins 마켓플레이스 루트를 찾으세요.**
   - Claude Code: `${CLAUDE_PLUGIN_ROOT}/../..` (이 플러그인이 설치된 소스의 상위).
   - Codex / OpenCode: 이 플러그인을 설치한 hibye-plugins 디렉토리 (사용자에게 경로를 물어도 됨. 보통 `~/Desktop/workplace/hibye-plugins`).

2. **배선 스크립트를 실행하세요:**
   ```bash
   bash <marketplace>/scripts/setup-project.sh "$PWD" --plugin backend-ts
   ```
   - 특정 스킬만: `--skills auth,api-routing`
   - 특정 도구만: `--tools claude,codex` (기본은 셋 다)

3. **결과를 요약 보고하세요** — 생성된 `.agents/skills`, `.claude|.codex|.opencode/agents`, hook 설정(`.claude/settings.json`, `.codex/hooks.json`, `.opencode/plugins/`), `AGENTS.backend-ts.md`.

## 참고
- 멱등합니다 — 이미 배선돼 있으면 안전하게 재실행됩니다(중복 없음).
- 배선 후 `cd $PWD` 한 프로젝트는 claude / codex / opencode 어느 도구로 열어도 동일한 skill·subagent·hook 을 봅니다.
- `AGENTS.backend-ts.md` 는 Codex/OpenCode 가 읽도록 프로젝트 `AGENTS.md` 에서 참조(또는 import)하는 것을 권장합니다.
