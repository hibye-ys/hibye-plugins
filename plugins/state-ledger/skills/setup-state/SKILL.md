---
name: setup-state
description: 현재 프로젝트에 STATE 원장 시스템(1줄 인덱스, docs/state lazy loading, warn-only lifecycle)을 설치하거나 기존 프로젝트 복사형 훅을 전역 state-ledger 플러그인으로 이관할 때 사용한다.
---

# Setup State Ledger

정본과 작성 규칙은 플러그인 루트 `README.md`를 따른다. 플러그인 루트 = 설치 캐시 `~/.claude/plugins/cache/hibye-plugins/state-ledger/<version>/`(Codex는 `~/.codex/plugins/cache/hibye-plugins/state-ledger/<version>/`) 또는 소스 checkout의 `plugins/state-ledger/`. 아래 `scripts/...` 명령은 그 루트 기준 경로다.

1. `state-ledger@hibye-plugins`가 현재 Codex 또는 Claude Code의 user scope에 설치·활성화됐는지 확인한다. 두 host의 lifecycle은 공통 `hooks/hooks.json`과 `$CLAUDE_PLUGIN_ROOT`의 dispatcher가 소유하며, Codex의 `$PLUGIN_ROOT` 유무로 host를 구분한다. Claude manifest에 중복 hook binding을 두거나 사용자 `hooks.json`에 STATE command를 복사하지 않는다.
2. 프로젝트 루트에 없을 때만 `templates/STATE.md`를 `STATE.md`로, `templates/staterc`를 `.staterc`로 복사한다. 모노레포 영역은 `STATE_INDEXES`에 `<영역>/STATE.md` 형식으로 추가하고 `docs/state/<area>/`를 만든다.
3. `.codex/hooks.json`, `.codex/config.toml`, `.claude/settings*.json`의 기존 프로젝트 복사형 STATE lifecycle 네 이벤트를 제거한다. 다른 훅은 보존한다. `templates/wiring/state-ledger-runner.mjs`만 `scripts/hooks/`에 두고 기존 STATE lifecycle·checker·baseline 구현 복사본과 그 테스트를 제거한다.
4. opencode를 함께 쓰는 프로젝트만 runner와 `templates/wiring/opencode-harness.ts`를 각각 `scripts/hooks/`, `.opencode/plugins/`에 두고, `opencode.json` instructions에 STATE 인덱스를 추가한다.
5. commit-msg 훅은 프로젝트의 Git hook manager에서 `if [ ! -f scripts/hooks/state-ledger-runner.mjs ]; then :; elif command -v node >/dev/null 2>&1; then node scripts/hooks/state-ledger-runner.mjs commit-msg "$1"; else echo "WARN: node가 PATH에 없어 STATE commit-msg 검사를 건너뜁니다." >&2; fi`를 호출한다. shared hook을 보는 이전 checkout에는 runner가 없을 수 있고 Git GUI PATH에는 node가 없을 수 있으므로 두 guard를 유지한다. lint-staged checker는 runner의 `check-wip` action을 쓴다. 기본은 warn-only다. README 0.5.0의 정리 강제 opt-in을 켠 프로젝트는 새 runner·cleanup capability를 요구한다.
6. 플러그인 정본에서 `node --test scripts/hooks/state-hooks.test.mjs scripts/hooks/state-cleanup.test.mjs scripts/hooks/rules-skill.test.mjs templates/wiring/state-ledger-runner.test.mjs`를 실행하고, runner의 `validate`를 `HOOK_PROJECT_DIR=<repo>`로 실행해 두 checker 경고를 확인한다. 새 Codex 스레드에서 plugin-bundled SessionStart 주입과 UserPromptSubmit 기준점 저장을 확인한다.
7. 대상 프로젝트의 `AGENTS.md` 또는 `CLAUDE.md`에는 규칙 본문을 붙이지 않고 라우팅 한 줄만 둔다: "진행 상태·소유는 `STATE.md`, 작성 규칙은 `.agents/skills/state-ledger-rules`". 이전 버전이 붙인 STATE 규칙 블록(README 스키마 블록이나 0.3.x 블록)이 있으면 사용자에게 보여 주고 그 한 줄로 바꾼다. 블록에 프로젝트만의 차이가 있으면 지우지 말고 스킬 사본으로 옮긴다.
8. 규칙 스킬 사본을 둔다: 플러그인 루트에서 `HOOK_PROJECT_DIR=<repo> node scripts/hooks/rules-skill.mjs install`. `templates/skills/state-ledger-rules/`가 `.agents/skills/state-ledger-rules/SKILL.md`(프로젝트가 고치는 사본)와 `.template-base.md`(병합 기준, 고치지 않음)로 복사되고 `.claude/skills/state-ledger-rules` 심링크가 생긴다(`.claude/skills`가 이미 `.agents/skills` 심링크면 그대로 둔다). 이미 사본이 있으면 덮어쓰지 않고 링크만 확인한다. 출력에 `WARN:`이 있으면 `.claude/skills/state-ledger-rules` 자리의 기존 폴더·링크 때문에 Claude가 사본을 못 읽는 것이니 사용자에게 알린다. 은하처럼 같은 역할의 프로젝트 고유 스킬이 이미 있으면 설치하지 말고 사용자에게 묻는다.
9. 기존 프로젝트를 0.4.0으로 올리면 SessionStart에 `## 현재` 4KB·detail 8KB 경고가 뜰 수 있다. 완료 경과는 이미 커밋 메시지·git log에 있으므로 detail에는 남은 일·결정·WHY만 남기도록 바꿔 쓴다.

Codex 업데이트는 manifest cachebuster를 갱신한 뒤 현재 `CODEX_HOME`에서 플러그인을 다시 설치한다. Claude Code는 version이 바뀌면 `claude plugin update state-ledger@hibye-plugins`로 설치 기록 version을 맞춘다(runner의 Claude fallback은 version 일치를 요구한다). 설치 캐시를 소스 심볼릭 링크로 바꾸지 않는다. Claude 로컬 개발 링크와 Codex 명시적 개발 링크는 `scripts/link-cache.sh`의 안내를 따른다. runner는 plugin의 `state-ledger-contract.json` v6를 요구하며 Codex CLI 탐색에는 제한 시간을 둔다. runner 템플릿과 대상 프로젝트 adapter가 byte-identical한지도 확인한다.

## 규칙 스킬 템플릿 갱신

공통 규칙은 플러그인 `templates/skills/state-ledger-rules/SKILL.md`를 고치고 `metadata.template_version`을 올린 뒤 플러그인 version과 함께 재설치한다. 버전을 올리지 않은 템플릿 변경은 프로젝트에 전파되지 않는다.

프로젝트 사본의 기준 버전이 템플릿보다 낮으면 SessionStart가 `=== STATE 규칙 스킬 ===`으로 알린다. 갱신은 대상 저장소에서 플러그인 루트의 `scripts/hooks/rules-skill.mjs`를 `HOOK_PROJECT_DIR=<repo>`로 실행한다.

1. `status`로 기준·템플릿 버전과 로컬 수정 여부를 본다. `diff`로 이번 공통 변경(기준 → 새 템플릿)을 사용자에게 보여 준다.
2. 사용자가 반영을 정하면 `update`. 기준·프로젝트 사본·새 템플릿을 3-way 병합해 사본에 쓰고 기준을 새 템플릿으로 바꾼다.
3. 충돌이 나면 사본에 `<<<<<<< 프로젝트 / ||||||| 템플릿 vN / ======= / >>>>>>> 템플릿 vM` 구간이 남고, 기준은 그대로 둔 채 새 템플릿을 `.template-pending.json`에 보류한다. 어느 쪽을 쓸지 사용자와 정해 푼 뒤 `update`를 다시 실행하면 기준이 새 버전으로 오른다. 표시가 남아 있으면 `update`는 거부한다. 사본을 병합 전으로 되돌렸으면 `update`가 보류를 버리고 다시 병합한다.
4. 사본·기준(보류 파일이 남았으면 그것까지) 함께 커밋한다(`[id=-]` 또는 관련 항목 id).

정리 정책은 README의 0.5.0 절차를 따른다. 구현만 끝났다고 archive하지 않는다. 사용자가 확인 후 정리 지시한 대상·원문을 기존 STATE에 기록하고 검증 뒤 마무리한다.
