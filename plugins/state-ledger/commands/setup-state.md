---
description: 현재 프로젝트에 STATE 원장 시스템(1줄 인덱스 + docs/state lazy loading + warn-only 게이트)을 설치한다.
---

현재 프로젝트에 state-ledger 하네스를 설치하세요. 정본과 규칙은 플러그인 `README.md`.

1. hibye-plugins 마켓플레이스에서 플러그인 루트를 찾습니다: `<marketplace>/plugins/state-ledger`.

2. 스크립트를 프로젝트로 복사합니다 (프로젝트가 소유 — git 에 커밋되어 worktree·CI 에서도 동작):

```bash
P="$(ls -d "$HOME"/.claude/plugins/cache/hibye-plugins/state-ledger/*/ 2>/dev/null | head -1)"
[ -n "$P" ] || P="<marketplace>/plugins/state-ledger"  # 캐시 미설치 시 수동 지정
command -v git >/dev/null && command -v jq >/dev/null && command -v python3 >/dev/null \
  || echo "의존성 부족: git·jq·python3 필수 — 없으면 훅이 조용히 비활성화된다"
mkdir -p scripts/hooks docs/state/root
cp "$P"/scripts/check-state-wip-cap.sh "$P"/scripts/check-state-branch-sync.sh scripts/
cp "$P"/scripts/hooks/*.sh scripts/hooks/
chmod +x scripts/*.sh scripts/hooks/*.sh
```

3. 인덱스·설정을 만듭니다 (이미 있으면 건너뜀):

- `STATE.md` ← `templates/STATE.md` (프로젝트명 치환)
- `.staterc` ← `templates/staterc` — 모노레포 영역이 있으면 `STATE_INDEXES` 에 추가하고 각 `docs/state/<area>/` 디렉토리 생성

4. 도구별 배선 — `templates/wiring/` 스니펫을 기존 설정에 **병합** (통째 덮어쓰기 금지):

- Claude Code: `claude-settings.json` → `.claude/settings.json` 의 `hooks`
- Codex: `codex-config.toml` → `.codex/config.toml`
- opencode(선택): `opencode-harness.ts` → `.opencode/plugins/`, STATE 주입은 `opencode.json` instructions 에 인덱스 파일 추가

5. commit-msg 훅(warn-only)을 프로젝트의 git hook 매니저에 연결합니다. simple-git-hooks 계열이면:

```json
"commit-msg": "[ ! -f scripts/hooks/commit-msg-state-check.sh ] || bash scripts/hooks/commit-msg-state-check.sh \"$1\""
```

6. 검증: `bash scripts/check-state-wip-cap.sh && bash scripts/check-state-branch-sync.sh` 가 warn 0 으로 통과하고, 새 세션 시작 시 STATE 인덱스가 주입되는지 확인합니다.

7. 대상 프로젝트의 AGENTS.md(또는 CLAUDE.md)에 README 의 "작성규칙" 블록을 붙여 넣습니다 — 에이전트가 스키마를 알아야 게이트가 의미를 가집니다.

업데이트: 플러그인 스크립트가 갱신되면 2번 복사를 다시 실행합니다 (정본 = 플러그인, 프로젝트 복사본은 배포물).
