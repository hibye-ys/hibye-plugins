---
description: 현재 프로젝트에 STATE 원장 시스템(1줄 인덱스 + docs/state lazy loading + warn-only 게이트)을 설치한다.
---

현재 프로젝트에 state-ledger 하네스를 설치하세요. 정본과 규칙은 플러그인 `README.md`.

1. `state-ledger@hibye-plugins`가 Codex와 Claude Code에 user scope로 설치되어 있는지 확인합니다. `scripts/link-cache.sh`로 두 캐시의 `current` 링크를 갱신하고, Codex는 `hooks/codex-user-hooks.json`을 활성 `$CODEX_HOME/hooks.json`에 병합합니다 (`CODEX_HOME` 미지정 시 `~/.codex/hooks.json`). lifecycle 스크립트는 전역 플러그인에서 실행하며 프로젝트로 복사하지 않습니다.

2. 인덱스·설정을 만듭니다 (이미 있으면 건너뜀):

- `STATE.md` ← `templates/STATE.md` (프로젝트명 치환)
- `.staterc` ← `templates/staterc` — 모노레포 영역이 있으면 `STATE_INDEXES` 에 추가하고 각 `docs/state/<area>/` 디렉토리 생성

3. 기존 프로젝트 복사형 lifecycle 배선이 있으면 `.codex/config.toml`·`.claude/settings.json`에서 STATE 네 이벤트만 제거합니다. 다른 프로젝트 훅은 보존합니다. `scripts/hooks/`의 STATE 복사본은 Git hook 등 다른 참조가 없는지 확인한 뒤 별도 정리합니다.

4. opencode를 함께 쓰는 프로젝트만 `templates/wiring/opencode-harness.ts`를 `.opencode/plugins/`에 두고, STATE 주입은 `opencode.json` instructions에 인덱스 파일을 추가합니다.

5. commit-msg 훅(warn-only)을 프로젝트의 git hook 매니저에 연결합니다. simple-git-hooks 계열이면:

```json
"commit-msg": "[ ! -f scripts/hooks/commit-msg-state-check.sh ] || bash scripts/hooks/commit-msg-state-check.sh \"$1\""
```

6. 검증: 플러그인 정본에서 `node scripts/hooks/state-hooks.test.mjs`를 통과시킨 뒤, 플러그인 경로의 두 checker를 `HOOK_PROJECT_DIR=<repo>`로 실행해 warn 0인지 확인합니다. 새 세션에서는 STATE 인덱스 주입과 UserPromptSubmit 기준점 저장을 함께 확인합니다.

7. 대상 프로젝트의 AGENTS.md(또는 CLAUDE.md)에 README 의 "작성규칙" 블록을 붙여 넣습니다 — 에이전트가 스키마를 알아야 게이트가 의미를 가집니다.

업데이트: 전역 플러그인을 업데이트하면 모든 온보딩 프로젝트가 같은 runtime을 사용합니다. 프로젝트에는 runtime 복사본을 다시 만들지 않습니다.
