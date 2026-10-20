---
name: setup-state
description: 현재 프로젝트에 STATE 원장 시스템(1줄 인덱스, docs/state lazy loading, warn-only lifecycle)을 설치하거나 기존 프로젝트 복사형 훅을 전역 state-ledger 플러그인으로 이관할 때 사용한다.
---

# Setup State Ledger

정본과 작성 규칙은 플러그인 루트 `README.md`를 따른다.

1. `state-ledger@hibye-plugins`가 현재 Codex 또는 Claude Code의 user scope에 설치·활성화됐는지 확인한다. 두 host의 lifecycle은 공통 `hooks/hooks.json`과 `$CLAUDE_PLUGIN_ROOT`의 dispatcher가 소유하며, Codex의 `$PLUGIN_ROOT` 유무로 host를 구분한다. Claude manifest에 중복 hook binding을 두거나 사용자 `hooks.json`에 STATE command를 복사하지 않는다.
2. 프로젝트 루트에 없을 때만 `templates/STATE.md`를 `STATE.md`로, `templates/staterc`를 `.staterc`로 복사한다. 모노레포 영역은 `STATE_INDEXES`에 `<영역>/STATE.md` 형식으로 추가하고 `docs/state/<area>/`를 만든다.
3. `.codex/hooks.json`, `.codex/config.toml`, `.claude/settings*.json`의 기존 프로젝트 복사형 STATE lifecycle 네 이벤트를 제거한다. 다른 훅은 보존한다. `templates/wiring/state-ledger-runner.mjs`만 `scripts/hooks/`에 두고 기존 STATE lifecycle·checker·baseline 구현 복사본과 그 테스트를 제거한다.
4. opencode를 함께 쓰는 프로젝트만 runner와 `templates/wiring/opencode-harness.ts`를 각각 `scripts/hooks/`, `.opencode/plugins/`에 두고, `opencode.json` instructions에 STATE 인덱스를 추가한다.
5. commit-msg 훅은 프로젝트의 Git hook manager에서 `if [ ! -f scripts/hooks/state-ledger-runner.mjs ]; then :; elif command -v node >/dev/null 2>&1; then node scripts/hooks/state-ledger-runner.mjs commit-msg "$1"; else echo "WARN: node가 PATH에 없어 STATE commit-msg 검사를 건너뜁니다." >&2; fi`를 호출한다. shared hook을 보는 이전 checkout에는 runner가 없을 수 있고 Git GUI PATH에는 node가 없을 수 있으므로 두 guard를 유지한다. lint-staged checker는 runner의 `check-wip` action을 쓴다. 둘 다 warn-only다.
6. 플러그인 정본에서 `node --test scripts/hooks/state-hooks.test.mjs templates/wiring/state-ledger-runner.test.mjs`를 실행하고, runner의 `validate`를 `HOOK_PROJECT_DIR=<repo>`로 실행해 두 checker 경고를 확인한다. 새 Codex 스레드에서 plugin-bundled SessionStart 주입과 UserPromptSubmit 기준점 저장을 확인한다.
7. 대상 프로젝트의 `AGENTS.md` 또는 `CLAUDE.md`에 README의 작성 규칙을 추가한다. 0.3.x 블록("Stop은 대응 영역의 의미 있는 STATE 차분만 인정한다…")이 이미 있으면 README의 새 블록으로 교체한다. STATE는 공유 상태판이다: 남은 일·소유·결정이 바뀌면 그 줄을 바꿔 쓰고, 작업 기록은 커밋 메시지 `[id=<id>]`(STATE 항목과 정말 무관한 잡무만 `[id=-]`)로 남긴다. id를 빠뜨렸으면 직접 만든 미push 직전 커밋은 `git commit --amend`로 붙이고 아니면 다음 커밋부터 붙인다. STATE에 경과를 적어 대신하지 않는다. Stop은 이번 턴 커밋만 한 번 알린다.
8. 기존 프로젝트를 0.4.0으로 올리면 SessionStart에 `## 현재` 4KB·detail 8KB 경고가 뜰 수 있다. 완료 경과는 이미 커밋 메시지·git log에 있으므로 detail에는 남은 일·결정·WHY만 남기도록 바꿔 쓴다.

Codex 업데이트는 manifest cachebuster를 갱신한 뒤 현재 `CODEX_HOME`에서 플러그인을 다시 설치한다. Claude Code는 version이 바뀌면 `claude plugin update state-ledger@hibye-plugins`로 설치 기록 version을 맞춘다(runner의 Claude fallback은 version 일치를 요구한다). 설치 캐시를 소스 심볼릭 링크로 바꾸지 않는다. Claude 로컬 개발 링크와 Codex 명시적 개발 링크는 `scripts/link-cache.sh`의 안내를 따른다. runner는 plugin의 `state-ledger-contract.json` v6를 요구하며 Codex CLI 탐색에는 제한 시간을 둔다. runner 템플릿과 대상 프로젝트 adapter가 byte-identical한지도 확인한다.
