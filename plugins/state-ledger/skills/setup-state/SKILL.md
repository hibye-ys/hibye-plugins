---
name: setup-state
description: 현재 프로젝트에 STATE 원장 시스템(1줄 인덱스, docs/state lazy loading, warn-only lifecycle)을 설치하거나 기존 프로젝트 복사형 훅을 전역 state-ledger 플러그인으로 이관할 때 사용한다.
---

# Setup State Ledger

정본과 작성 규칙은 플러그인 루트 `README.md`를 따른다.

1. `state-ledger@hibye-plugins`가 현재 Codex 또는 Claude Code의 user scope에 설치·활성화됐는지 확인한다. Codex lifecycle은 플러그인의 `hooks/hooks.json`과 `$PLUGIN_ROOT`가 소유한다. 사용자 `hooks.json`에 STATE command를 복사하지 않는다.
2. 프로젝트 루트에 없을 때만 `templates/STATE.md`를 `STATE.md`로, `templates/staterc`를 `.staterc`로 복사한다. 모노레포 영역은 `STATE_INDEXES`에 `<영역>/STATE.md` 형식으로 추가하고 `docs/state/<area>/`를 만든다.
3. `.codex/hooks.json`, `.codex/config.toml`, `.claude/settings*.json`의 기존 프로젝트 복사형 STATE lifecycle 네 이벤트를 제거한다. 다른 훅은 보존한다. 프로젝트 `scripts/hooks/` 복사본은 Git hook 등 다른 참조가 없는지 확인한 후 정리한다.
4. opencode를 함께 쓰는 프로젝트만 `templates/wiring/opencode-harness.ts`를 `.opencode/plugins/`에 두고, `opencode.json` instructions에 STATE 인덱스를 추가한다.
5. commit-msg 훅은 프로젝트의 Git hook manager에서 플러그인 스크립트를 명시적으로 호출한다. 이 훅은 warn-only다.
6. 플러그인 정본에서 `node scripts/hooks/state-hooks.test.mjs`를 실행하고, 두 checker를 `HOOK_PROJECT_DIR=<repo>`로 실행해 경고를 확인한다. 새 Codex 스레드에서 plugin-bundled SessionStart 주입과 UserPromptSubmit 기준점 저장을 확인한다.
7. 대상 프로젝트의 `AGENTS.md` 또는 `CLAUDE.md`에 README의 작성 규칙을 추가한다.

Codex 업데이트는 manifest cachebuster를 갱신한 뒤 현재 `CODEX_HOME`에서 플러그인을 다시 설치한다. 설치 캐시를 소스 심볼릭 링크로 바꾸지 않는다. Claude 로컬 개발 링크와 Codex 명시적 개발 링크는 `scripts/link-cache.sh`의 안내를 따른다.
