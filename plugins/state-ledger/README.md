# state-ledger — live coordination ledger

멀티 에이전트·멀티 툴(Claude Code / Codex / opencode) 프로젝트의 작업 상태 원장.
EUNHA 에서 실운영으로 검증된 시스템의 일반화판 — EUNHA 는 테스트베드이며 정본 스키마는 이 README 다.

## 철학

- **완료 사실은 git log 가 정본** — STATE 는 완료 로그를 누적하지 않는다. 커밋 메시지에 `[id=<id>]`, archive 시 `archive [id=...]`.
- **인덱스는 싸고, 상세는 lazy** — 세션 시작에 주입되는 것은 1줄/항목 인덱스뿐. 작업을 잡을 때만 `docs/state/<area>/<id>.md` 를 읽는다.
- **게이트는 전부 warn-only** — 막지 않고 알린다. warn 은 0 으로 수렴시켜야 채널이 살아있다 (방치하면 배경소음).

## 스키마 (대상 프로젝트 AGENTS.md 에 붙여 넣는 작성규칙)

```
- `STATE.md`는 live ownership·진행·미래·미해결 결정과 WHY만 기록한다. 완료 사실은 git log가 정본이며 완료 로그를 누적하지 않는다.
- 카테고리 4개와 WIP cap: §1 활성 ≤6 (owner 필수) · §2 다음 ≤6 · §3 미래 placeholder ≤5 · §4 미해결 결정 ≤8. cap 초과는 분류 실패 신호 — 가장 오래 움직이지 않은 항목을 archive한다.
- 항목 = 1줄 인덱스: `- [<id>] <제목> — <짧은 상태·조건>` (≤200자). 상세 정본 = docs/state/<area>/<id>.md.
  frontmatter: id·area·owner·branch·touched·hash (+depends/blocks/handoff/expires)
  본문: ## 현재 (필수 — 요약·남은 것·WHY) + ## 원장 (선택 — WHY·실측 기록만, 완료 서사는 커밋 메시지로)
- `id`는 3–12자 stable identifier다. commit message에서 `[id=<id>]`로 참조한다. id 없는 줄은 §3 placeholder만 허용한다.
- meta는 detail frontmatter가 정본 — post-edit hook이 touched·hash만 자동 스탬프한다. owner·branch는 수동 claim이다.
- SessionStart는 인덱스만 주입한다. 작업을 잡으면 해당 docs/state/<area>/<id>.md를 읽는다.
- `expires`가 지난 항목은 갱신하거나 archive한다.
- archive = 인덱스 줄 + detail 파일 삭제, commit message에 `archive [id=...]`.
- 정합은 warn-only 세 겹: 인덱스↔detail 존재·자수·크기·frontmatter(id·area·hash·expires·§1 owner) = check-state-wip-cap.sh, 브랜치 포인터·유령 브랜치 = check-state-branch-sync.sh, [id=]·archive 커밋 규약 = commit-msg 훅. 앞 둘은 SessionStart 주입에 표면화된다.
- 멀티 에이전트 작업은 branch·worktree를 분리하고 같은 파일을 같은 worktree에서 동시에 편집하지 않는다.
```

## 구성

| 파일 | 역할 |
| --- | --- |
| `scripts/check-state-wip-cap.sh` | WIP cap·섹션 존재·줄 200자·인덱스 4KB·인덱스↔detail 양방향·id 3–12자·문자집합·§1·§2·§4 id 필수·frontmatter(id/area/owner/branch/touched/hash/expires/§1 owner)·`## 현재` 필수·detail 16KB |
| `scripts/check-state-branch-sync.sh` | §1·§2 branch 포인터 소멸/기머지 (빈 예약 브랜치 오탐 제외) + 유령 브랜치 (frontmatter `branch:` 만 등재로 인정, 제외 glob = `STATE_BRANCH_EXCLUDE`) |
| `scripts/hooks/session-start-state-inject.sh` | SessionStart — 인덱스 전문 + 위 두 체커의 warn 주입 |
| `scripts/hooks/post-edit-state-stamp.sh` | PostToolUse — detail 본문 hash 변경 시 touched·hash 스탬프 (다중 파일 apply_patch 지원, owner·branch 불변, 프로젝트 밖 경로 거부) |
| `scripts/hooks/stop-state-reminder.sh` | Stop — staged·unstaged·untracked 코드 변경 있는데 STATE 미갱신이면 알림 (코드 판정 = `STATE_CODE_RE`) |
| `scripts/hooks/commit-msg-state-check.sh` | commit-msg — docs/state 변경인데 완결 `[id=<id>]` 토큰 없음 / detail 삭제인데 파일별 `archive [id=<그 id>]` 없음 |

## 설정 — `.staterc` (선택)

형식 고정: `KEY="value"` 한 줄씩. 스크립트는 source 하지 않고 sed 로 파싱한다 (다른 문법·명령 치환 무시). 경로 목록은 공백 구분 — 공백 포함 경로 미지원.

```sh
STATE_INDEXES="STATE.md apps/api/STATE.md apps/web/STATE.md"  # 기본 "STATE.md"
STATE_DEFAULT_BRANCH="main"
STATE_CODE_RE="\.(ts|tsx|js|jsx|sh|py|css|ya?ml|json|sql|toml)$|(^|/)Dockerfile"  # 스택에 맞게 조정
STATE_BRANCH_EXCLUDE="task-loop/*"  # 유령 검사 제외 glob (공백 구분)
```

area 는 경로에서 유도한다: 루트 `STATE.md` → `root`, 그 외 → 부모 디렉토리 이름 (`apps/api/STATE.md` → `api`). detail 은 항상 `docs/state/<area>/<id>.md`.

알려진 한계: opencode 는 SessionStart 를 instructions 방식으로 대신하므로 정합 warn 이 세션 시작에 표면화되지 않는다 — 필요하면 체커 2종을 수동 실행한다.

## 설치

`/state-ledger:setup-state` 명령을 따른다 (스크립트 복사 → 인덱스·`.staterc` 생성 → 도구별 배선 병합 → 검증). 스크립트는 프로젝트가 소유한다 — 플러그인이 정본이고 프로젝트 복사본은 배포물이므로, 플러그인 갱신 시 복사를 다시 실행한다.

## 검증된 설계 근거 (2026-07-28 교차 리뷰 라운드)

- stamp 가 owner·branch 를 덮어쓰지 않는 이유: 스치는 편집이 소유권을 바꾸는 사고 방지 — 소유는 claim, 기록은 touched·hash.
- hash 를 게이트가 재검산하는 이유: 훅을 우회한 편집(외부 편집기·heredoc)을 커밋 전에 감지.
- 유령 브랜치를 frontmatter 로만 판정하는 이유: 본문 서사의 substring 매치는 경고를 조용히 삼킨다.
- Codex CLI 는 Claude 호환 훅 스키마(`hookSpecificOutput`·`additionalContext`·`stop_hook_active`)를 내장한다 — 바이너리 실측 확인. 같은 스크립트가 두 도구에서 그대로 동작한다.
