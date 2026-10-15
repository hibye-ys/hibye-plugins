# state-ledger — live coordination ledger

멀티 에이전트·멀티 툴(Claude Code / Codex / Antigravity / Muse / opencode) 프로젝트의 작업 상태 원장.
EUNHA 에서 실운영으로 검증된 시스템의 일반화판 — EUNHA 는 테스트베드이며 정본 스키마는 이 README 다.

## 철학

- **STATE = 공유 상태판, 작업 기록 장치가 아니다** — 지금 누가 무엇을 하고, 무엇이 남았고, 무엇을 결정해야 하는지만 여러 에이전트가 공유한다. 상태가 바뀌면 그 줄과 `## 현재`를 바꿔 쓰고 덧붙이지 않는다.
- **작업 기록은 커밋 메시지, 완료 사실은 git log 가 정본** — 커밋 메시지에 `[id=<id>]`(STATE 항목과 무관한 작업은 `[id=-]`), archive 시 `archive [id=...]`. STATE 는 완료 로그·작업 경과를 누적하지 않는다.
- **인덱스는 싸고, 상세는 lazy** — 세션 시작에 주입되는 것은 1줄/항목 인덱스뿐. 작업을 잡을 때만 `docs/state/<area>/<id>.md` 를 읽는다.
- **게이트는 전부 warn-only** — 막지 않고 알린다. warn 은 0 으로 수렴시켜야 채널이 살아있다 (방치하면 배경소음).
- **턴 귀속은 커밋 메시지로 판정** — UserPromptSubmit 때 repo 밖에 HEAD·dirty hash·detail 본문 크기를 저장하고, Stop에서 기준점 이후 만든 커밋 중 작업 파일을 바꾼 커밋의 메시지에 유효 `[id=<id>]`가 있는지 본다. 미커밋 작업은 커밋될 때(턴 사이 커밋 포함) 판정한다. STATE 갱신은 매 턴 요구하지 않으며 STATE 수정으로 알림이 풀리지도 않는다.
- **goal-run과 무관한 전역 lifecycle** — STATE는 live ownership만 담당한다. goal TRACK·item branch 같은 파이프라인 규칙은 해당 스킬이 소유한다.

## 스키마 (대상 프로젝트 AGENTS.md 에 붙여 넣는 작성규칙)

```
- `STATE.md`는 공유 상태판이다. live ownership·진행·미래·미해결 결정과 WHY만 담는다. 남은 일·소유·결정이 바뀌면 그 줄과 detail을 바꿔 쓰고 덧붙이지 않는다. 작업 기록(완료 사실·경과)은 커밋 메시지가 맡으며 git log가 정본이다.
- 카테고리 4개와 WIP cap: §1 활성 ≤6 (owner 필수) · §2 다음 ≤6 · §3 미래 placeholder ≤5 · §4 미해결 결정 ≤8. cap 초과는 분류 실패 신호 — 가장 오래 움직이지 않은 항목을 archive한다.
- 항목 = 1줄 인덱스: `- [<id>] <제목> — <짧은 상태·조건>` (≤200자). 상세 정본 = docs/state/<area>/<id>.md.
  frontmatter: id·area·owner·branch·touched·hash (+depends/blocks/handoff/expires)
  본문: ## 현재 (필수, ≤4KB — 요약·남은 것·WHY) + ## 원장 (선택 — 결정 WHY만). detail 전체 ≤8KB.
- `id`는 3–12자 stable identifier다. id 없는 줄은 §3 placeholder만 허용한다. meta는 detail frontmatter가 정본 — hook이 touched·hash만 스탬프하고 owner·branch는 수동 claim이다.
- 작업 커밋 메시지에는 `[id=<인덱스 id>]`를 붙인다. `[id=-]`는 STATE 항목과 정말 무관한 잡무에만 쓴다(§1·§2 항목의 일에는 쓰지 않는다). 착수한 항목은 §1로 옮기고 owner를 claim한다.
- id를 빠뜨렸으면 다음 커밋 메시지에 그 sha와 `[id=<id>]`를 함께 적는다(`git commit --allow-empty -m "<sha> [id=<id>]"` 가능). STATE 내용을 고치거나 덧붙여서는 Stop 알림이 풀리지 않는다(인덱스에 없던 id는 그 항목을 정식 등재하면 풀린다).
- `expires`가 지난 항목은 갱신하거나 archive한다. archive = 인덱스 줄 + detail 파일 삭제, commit message에 `archive [id=...]`.
- 멀티 에이전트 작업은 branch·worktree를 분리한다. 같은 worktree에 활성 세션이 둘이면 Stop의 새 커밋 판정이 보류된다.
```

## 구성

| 파일 | 역할 |
| --- | --- |
| `scripts/check-state-wip-cap.sh` | WIP cap·섹션 존재·줄 200자·인덱스 4KB·인덱스↔detail 양방향·id 3–12자·문자집합·§1·§2·§4 id 필수·frontmatter(id/area/owner/branch/touched/hash/expires/§1 owner)·`## 현재` 필수. 크기 경고 `## 현재` 4KB·detail 8KB는 strict 모드에서도 구조 실패로 세지 않음 |
| `scripts/check-state-branch-sync.sh` | §1·§2 branch 포인터 소멸/기머지 (빈 예약 브랜치 오탐 제외) + 유령 브랜치 (frontmatter `branch:` 만 등재로 인정, 제외 glob = `STATE_BRANCH_EXCLUDE`) |
| `scripts/hooks/session-start-state-inject.sh` | SessionStart — 원칙 한 줄 + 인덱스 전문 + 위 두 체커의 warn 주입 + 기준점이 없을 때만 생성 |
| `scripts/hooks/commit-msg-state-check.sh` | commit-msg — 인덱스/detail에서 실제 바뀐 모든 id별 `[id=<id>]` / detail 삭제 파일별 `archive [id=<id>]` 검사 |
| `scripts/hooks/state-config.mjs` | `.staterc` 공통 파서 — 인덱스 상대경로·정규화·repo 경계·symlink·개수와 설정 크기를 읽기 전에 검증 |
| `scripts/hooks/turn-start-state-snapshot.sh` | UserPromptSubmit/chat.message — repo 밖 세션별 턴 기준점 저장, 동시 세션 경고, 이월 debt를 additionalContext로 에이전트에게 알림 |
| `scripts/hooks/state-turn-baseline.mjs` | 판정 엔진 — 기준점 이후 만든 커밋의 `[id=]` 태그·커밋별 debt와 해제, detail 본문 덧붙임, §1 밖 id, 동시 세션 보류. git plumbing(rev-list·diff-tree --stdin·cat-file)만 쓴다 |
| `scripts/hooks/post-edit-state-stamp.sh` | PostToolUse — detail 본문 hash 변경 시 touched·hash 스탬프 (다중 파일 apply_patch 지원, owner·branch 불변, 프로젝트 밖 경로 거부) |
| `scripts/hooks/stop-state-reminder.sh` | Stop — 엔진 결과를 표시만 한다: id 없음·인덱스에 없는 id 커밋(커밋 단위)과 새 debt의 해제 방법, detail 본문 덧붙임, §1 밖 id claim 권고, 동시 세션 보류, 이번 턴에 바뀐 STATE 경로의 구조 재검 |
| `hooks/claude-hooks.json` + `global-state-hook.sh` | Claude Code user-scope plugin lifecycle. STATE 미사용 repo는 no-op, 이행 중 실제 로컬 command만 구조적으로 감지해 이벤트별 중복 억제 |
| `hooks/hooks.json` | Codex plugin-bundled global lifecycle. `$PLUGIN_ROOT`의 설치 버전을 실행하며 사용자 `hooks.json` 복사본을 만들지 않음 |
| `hooks/antigravity-hooks.json` + `antigravity-*.sh` | Antigravity(Google Antigravity / AGY) lifecycle. PreInvocation·PostToolUse·Stop JSON 계약 변환. Stop은 이번 턴에 새로 생긴 항목(새 debt·덧붙임·크기 외 구조 경고)이 있을 때만 1회 `continue`, 이월 debt·크기 경고만 남으면 `allow` |
| `state-ledger-contract.json` | project adapter와 plugin runtime 사이의 독립 계약 버전. v6 미만 설치본은 runner가 실행하지 않음 |
| `templates/wiring/state-ledger-runner.mjs` | Git/opencode용 얇은 프로젝트 adapter. 활성화된 Codex version cache 또는 Claude user install을 검증해 plugin-owned script를 실행 |

## 설정 — `.staterc` (선택)

형식 고정: `KEY="value"` 한 줄씩. 스크립트는 source 하지 않고 고정 형식만 파싱한다. `STATE_INDEXES`는 공백 구분이며 각 항목은 repo 내부의 정규화된 상대경로이고 반드시 `STATE.md`로 끝나야 한다. 절대경로·`..`·glob·공백·repo 밖 symlink는 읽기 전에 거부한다.

```sh
STATE_INDEXES="STATE.md apps/api/STATE.md apps/web/STATE.md"  # 기본 "STATE.md"
STATE_DEFAULT_BRANCH="main"
STATE_WORK_INCLUDE_RE="(^|/)\.staterc$|(^|/)Dockerfile$|\.(ts|tsx|js|jsx|mjs|cjs|sh|py|css|html|svg|ya?ml|json|sql|toml|go|rs|java|kt|swift|c|cc|cpp|h|hpp|png|jpe?g|webp|gif|avif|woff2?|ttf|otf)$|(^|/)(prompts?|agents?|skills?|commands?)/.*\.md$"
STATE_WORK_EXCLUDE_RE="(^|/)(node_modules|dist|build|coverage|vendor)/"
STATE_BRANCH_EXCLUDE="task-loop/*"  # 유령 검사 제외 glob (공백 구분)
```

area 는 경로에서 유도한다: 루트 `STATE.md` → `root`, 그 외 → 부모 디렉토리 이름 (`apps/api/STATE.md` → `api`). detail 은 항상 `docs/state/<area>/<id>.md`.

`STATE_WORK_INCLUDE_RE`와 `STATE_WORK_EXCLUDE_RE`는 JavaScript `RegExp` 문법이다. include에 맞고 exclude에 맞지 않는 경로만 턴 작업으로 본다. 문서형 prompt, 이미지·폰트·SVG, hook/config 등 운영 변경을 모두 포함해야 한다.

## Stop 판정 규칙

- 판정 대상 = 현재 HEAD에서 닿는 커밋 중 기준 시각 이후에 만든 커밋(committer 시각). 이번 턴 커밋(턴 시작 HEAD에서 닿지 않음)은 모든 작업 경로를, 턴 사이 커밋(마지막 Stop 이후)은 그 Stop 때 미커밋이던 경로만 debt 후보로 본다. 기준 시각 전에 만든 커밋(pull·merge·checkout으로 들어온 커밋)과 머지 커밋은 판정하지 않는다. 한 범위가 1000커밋을 넘으면 판정을 건너뛰고 알린다.
- 유효 id = 작업 트리(미커밋 등재 포함)·턴 시작 HEAD·현재 HEAD·기본 브랜치(`STATE_DEFAULT_BRANCH`)·범위 안에서 인덱스를 바꾼 커밋·그 커밋 자신의 STATE 인덱스에 있는 id, 그리고 `[id=-]`. 커밋은 오래된 순서로 보며 한 경로의 마지막 커밋에 유효 id가 없으면 그 커밋이 debt다.
- debt 해제: 원 커밋 sha(7자 이상)와 유효 태그를 함께 적은 이후 커밋(빈 커밋·`[id=-]` 포함), 같은 경로를 바꾼 이후의 실제 id 태그 커밋(`[id=-]` 커밋은 앞선 작업의 기록이 아니므로 풀지 않는다), 원 커밋이 HEAD·로컬 브랜치에서 사라짐(amend·rebase·reset·브랜치 삭제 — push된 커밋도 같다), 원 커밋의 id가 나중에 인덱스에 등재됨. 해제는 턴 안·턴 사이·동시 세션 보류 중 어디서 일어나도 반영된다.
- Stop 없이 끝난 턴(사용자 중단)은 30분 안에 온 다음 프롬프트와 한 턴으로 판정한다.
- detail 본문(frontmatter 제외)이 덧붙임 기준보다 1KB 넘게 늘면 알린다. 기준은 처음 본 크기에서 시작해 이 세션의 턴이 그 detail을 바꿀 때만 움직인다(줄면 내려가고, 알린 뒤에는 그 크기로 올라가 같은 증가를 한 번만 알린다). pull·checkout·턴 사이 편집은 기준을 그 크기로 다시 잡는다. 이번 턴에 처음 생긴 detail은 크기 cap만 본다.
- §1 밖 id로 작업 커밋을 만들면 세션당 id별 한 번 claim을 권한다. 작업 트리나 기본 브랜치 어느 쪽에서든 §1이면 알리지 않는다.
- Stop 구조 재검은 이번 턴에 바뀐 STATE 경로를 언급하는 경고만 보인다. Antigravity는 새 debt·덧붙임·크기 외 구조 경고가 있을 때만 continue한다.
- debt는 세션별 기준점에만 있다. 새 세션(Claude Code `/clear` 포함)에서는 이전 세션의 debt가 알림 없이 사라지며 git log의 태그 없는 커밋은 그대로 남는다 — Stop 알림은 놓친 태그를 잡는 백스톱이다.

알려진 한계: 커밋 태그 검사는 id가 STATE 인덱스에 있는지만 확인하고, 그 id가 커밋 내용과 관련 있는지까지 이해하지는 못한다(`[id=-]` 남용도 리뷰 대상이다). 턴 중 rebase·cherry-pick·amend로 새로 만든 커밋은 원본이 남의 커밋이어도 이번 턴 커밋으로 판정한다. archive된 id는 archive가 반영된 HEAD 이후의 새 커밋에서는 유효하지 않다 — 후속 작업은 살아 있는 id를 쓴다. Claude Code의 Stop systemMessage는 사용자에게만 보이므로 에이전트는 이월 debt를 다음 턴 UserPromptSubmit 주입으로 받는다. Antigravity PreInvocation은 그 주입을 싣지 않고 Stop `continue`(새 debt)로만 알린다. opencode는 SessionStart를 instructions 방식으로 대신하므로 정합 warn이 세션 시작에 표면화되지 않는다.

## 설치

Codex와 Claude Code에는 `state-ledger@hibye-plugins`를 user scope로 한 번 설치한다. 두 도구 모두 plugin-bundled hooks를 사용하며 프로젝트나 사용자 `hooks.json`에 lifecycle command를 복사하지 않는다. Codex는 `hooks/hooks.json`의 `$PLUGIN_ROOT`, Claude는 `hooks/claude-hooks.json`의 `$CLAUDE_PLUGIN_ROOT`로 설치 버전을 실행한다. Antigravity는 `~/.gemini/config/hooks.json` 또는 프로젝트 `.agents/hooks.json`에 `hooks/antigravity-hooks.json` 스니펫을 병합해 `antigravity-pre-invocation.sh`, `antigravity-post-tool-use.sh`, `antigravity-stop.sh`를 실행한다. Orca처럼 계정별 `CODEX_HOME`을 쓰는 환경은 각 홈에서 플러그인을 별도로 활성화한다. 프로젝트에는 `STATE.md`·`docs/state/**`·`.staterc`와, Git/opencode를 쓰는 경우 얇은 `scripts/hooks/state-ledger-runner.mjs` adapter만 둔다. STATE lifecycle·checker·baseline 구현은 복사하지 않는다. `STATE.md`와 `.staterc`가 모두 없는 저장소에서는 전역 훅이 조용히 no-op 한다.

Codex 업데이트는 `.codex-plugin/plugin.json` cachebuster를 갱신한 뒤 `codex plugin add state-ledger@hibye-plugins`로 재설치한다. Claude Code는 `.claude-plugin/plugin.json` version을 올리면 `claude plugin update state-ledger@hibye-plugins`(또는 재설치)로 `~/.claude/plugins/installed_plugins.json`의 version을 맞추고, 로컬 개발 링크를 쓰면 `scripts/link-cache.sh`로 새 version 링크를 만든다 — runner의 Claude fallback은 설치 기록 version과 manifest version이 같을 때만 실행한다. 운영 설치 캐시는 소스 링크로 바꾸지 않는다. `scripts/link-cache.sh`는 기본적으로 Claude 및 Antigravity 개발 캐시만 연결하며, Codex 소스 링크는 격리된 로컬 개발에서 `--codex-dev-links`를 명시한 경우에만 만든다.

`/state-ledger:setup-state`는 프로젝트 데이터·작성 규칙·필요한 adapter만 온보딩한다. runner는 `STATE_LEDGER_PLUGIN_ROOT` 명시 override → Codex의 enabled plugin catalog와 정확한 version cache → Claude의 enabled user install 순으로 정본을 찾고 plugin name/version·`state-ledger-contract.json` v6·대상 파일을 검증한다. Codex CLI를 실행할 수 없거나 제한 시간 안에 응답하지 않으면 v6 계약을 가진 물리 cache directory로만 fallback하며, CLI가 정상 응답해 disabled 상태를 보고한 경우 cache를 임의 활성화하지 않는다. lifecycle stdin과 child stdout/stderr는 runner가 명시적으로 전달하며 설치본을 못 찾거나 실행에 실패해도 경고 후 0으로 끝난다.

`commit-msg`는 agent lifecycle이 아니라 Git hook이므로 기존 hook manager에서 `if [ ! -f scripts/hooks/state-ledger-runner.mjs ]; then :; elif command -v node >/dev/null 2>&1; then node scripts/hooks/state-ledger-runner.mjs commit-msg "$1"; else echo "WARN: node가 PATH에 없어 STATE commit-msg 검사를 건너뜁니다." >&2; fi`를 호출한다. shared Git hooks를 쓰는 이전 checkout에 runner가 없거나 Git GUI PATH에 node가 없어도 commit을 막지 않기 위한 guard다. lint-staged에서 구조 검사를 유지하려면 `node scripts/hooks/state-ledger-runner.mjs check-wip`을 사용한다. opencode는 runner와 `templates/wiring/opencode-harness.ts`를 함께 복사하고 `opencode.json` instructions에 인덱스를 지정한다. 기존 `.codex/hooks.json`·`.codex/config.toml`·`.claude/settings*.json`에 복사형 STATE lifecycle이 남아 있으면 제거한다. 이행 중인 브랜치에서는 전역 dispatcher가 JSON/TOML의 실제 로컬 command를 감지해 중복 실행을 피하며, 주석이나 단순 문자열은 로컬 훅으로 취급하지 않는다.

정본 회귀 검사는 `node --test scripts/hooks/state-hooks.test.mjs templates/wiring/state-ledger-runner.test.mjs`로 실행한다.

## 검증된 설계 근거 (2026-07-28 교차 리뷰 라운드)

- stamp 가 owner·branch 를 덮어쓰지 않는 이유: 스치는 편집이 소유권을 바꾸는 사고 방지 — 소유는 claim, 기록은 touched·hash.
- hash 를 게이트가 재검산하는 이유: 훅을 우회한 편집(외부 편집기·heredoc)을 커밋 전에 감지.
- 유령 브랜치를 frontmatter 로만 판정하는 이유: 본문 서사의 substring 매치는 경고를 조용히 삼킨다.
- 작업 기록을 커밋 메시지로 옮긴 이유 (0.4.0): 0.3.x는 코드를 바꾼 턴마다 대응 영역 STATE의 의미 있는 차분으로만 debt를 풀었다. 에이전트는 매 턴 detail에 결과 문단을 덧붙여 debt를 해제했고 `## 현재`가 단계별 경과 기록으로 불어나 detail이 14–16KB까지 찼다(EUNHA 실측: tprune 16KB·perfmon 14KB). "완료 로그를 누적하지 않는다"는 철학과 장치가 모순됐다.
- 미커밋 작업을 판정하지 않는 이유: 같은 변경은 커밋될 때 태그로 판정된다. dirty 작업에 dirty STATE 갱신을 요구하면 기록 덧붙이기만 강요한다. 대신 Stop 때 미커밋이던 작업 경로를 기준점에 넘겨, 턴 사이에 사람이 터미널·IDE에서 커밋해도 다음 Stop에서 판정한다. 0.3.x 스냅샷의 debt(sha 없는 working·legacy·committed)는 다른 규칙의 결과이므로 평가 때 버린다.
- 기준 시각 전에 만든 커밋을 판정하지 않는 이유: pull·merge·checkout으로 들어온 팀원 커밋은 이 세션의 작업이 아니고, 이미 push된 커밋은 amend할 수 없어 빈 커밋만 공유 히스토리에 쌓인다. 커밋을 만든 시각(committer 시각)이 기준점보다 이르면 이 세션이 만든 커밋일 수 없다. 해제를 볼 때도 같은 범위를 쓰되 경로는 가리지 않는다 — 사람이 턴 사이에 남긴 빈 해제 커밋도 놓치지 않는다.
- STATE 수정으로 debt를 풀지 않는 이유: 0.3.x 습관대로 코드는 id 없이 커밋하고 STATE에 경과를 덧붙여 커밋하면 알림이 조용히 사라져 같은 문제가 되풀이된다. debt는 커밋 기록의 결함이므로 커밋으로만(amend·sha 기록 커밋·같은 경로를 바꾸는 실제 id 태그 커밋) 해제한다. STATE 항목과 무관한 작업에는 `[id=-]`라는 명시 탈출구를 둬 STATE에 무언가 써서 알림을 끄는 길을 없앤다. 다만 `[id=-]`는 '무관하다'는 선언이라 같은 경로의 앞선 기능 커밋을 대신 기록하지 못한다.
- 한 경로의 마지막 커밋이 판정하는 이유: 턴 안이든 턴을 넘든 같은 커밋 이력이면 같은 결과가 나와야 한다. id 없이 커밋한 뒤 같은 경로를 `[id=]`로 마무리하면 그 경로의 기록은 이어진다.
- debt에 원 커밋 sha를 두는 이유: 삭제·rename된 경로나 이미 지난 커밋은 같은 경로를 다시 커밋할 수 없다. sha와 id를 적은 빈 커밋으로 git log에 기록을 보충하면 무의미한 코드 수정이나 STATE 수정 없이 풀린다. amend·rebase·reset으로 버려진 커밋의 debt는 대상이 사라졌으므로 버린다.
- 유효 id를 넓게 잡는 이유: 새 항목을 등재하고 STATE를 아직 커밋하지 않았거나(작업 트리), worktree를 나눠 기본 브랜치에만 등재했거나(STATE_DEFAULT_BRANCH), 커밋 당시 유효했던 id가 머지 상대에서 archive된 경우(커밋 자신의 트리)를 'id 없음'으로 오판하지 않는다. 등재가 늦어도 이후 Stop에서 다시 검사해 풀린다.
- 머지 커밋을 판정하지 않는 이유: 머지된 쪽 커밋은 범위에 함께 들어와 따로 판정되거나 이전 턴에 이미 판정됐고, 기본 머지 메시지에는 id가 없다.
- 크기 cap을 strict 구조 실패로 세지 않는 이유: 큰 detail은 구조 결함이 아니라 바꿔 쓰기 대상이다. 같은 이유로 크기 경고만으로는 Antigravity를 강제 continue하지 않는다 — 큰 detail에 owner만 바꾼 claim 턴이 축약 작업으로 끌려가면 STATE를 건드리지 않는 쪽이 조용해진다. 이번 턴의 증가는 덧붙임 알림이 맡는다.
- 덧붙임을 본문 전체로 재고 세션 기준과 비교하는 이유: `## 현재`만 재면 경과가 `## 원장`으로 옮겨 간다. 턴마다 1KB 미만씩 덧붙이거나 아직 커밋하지 않은 새 detail에 여러 턴 덧붙여도 누적량이 보이되, 알린 증가·이 세션이 만들지 않은 크기 변화(pull·checkout·턴 사이 편집)로는 다시 알리지 않는다.
- Stop 구조 재검을 이번 턴에 바뀐 STATE 경로로 좁히는 이유: 다른 detail의 기존 크기·구조 경고가 STATE를 건드리는 턴마다 반복되면 배경소음이 되고 Antigravity는 강제 continue한다. 기존 경고는 SessionStart 주입이 맡는다.
- §1 밖 id로 한 작업을 알리는 이유: 공유 상태판의 핵심은 '지금 누가 무엇을 하는가'다. STATE 갱신을 강제하지 않으므로, §2·§3·§4 항목 id로 작업을 커밋하면 세션당 id별 한 번 그 줄의 §1 이동과 owner claim(덧붙임이 아닌 바꿔 쓰기)을 권한다. 매 턴 반복하면 `[id=-]`로 바꿔 알림을 피하는 쪽이 조용해진다.
- 이월 debt를 UserPromptSubmit에서 알리는 이유: Claude Code의 Stop systemMessage는 사용자에게만 보인다. 다음 턴 시작에 additionalContext로 커밋 목록과 해제 방법을 주입해야 에이전트가 처리할 수 있다. Stop은 새 debt가 생긴 때만 해제 방법을 보여 사용자 화면의 반복을 줄인다.
- git plumbing만 쓰는 이유: `git log`는 `log.showSignature` 같은 사용자 설정이 출력에 섞여 sha 파싱이 깨진다. rev-list·diff-tree --stdin·cat-file --batch는 설정에 흔들리지 않고, 커밋 수와 무관하게 spawn 몇 번으로 끝나 Stop timeout(30초)을 넘지 않는다.
- 동시 세션에서 판정을 보류하는 이유: 같은 worktree의 파일 mtime과 HEAD만으로 어느 세션이 변경했는지 확정할 수 없다. 해제는 귀속과 무관하므로 보류 중에도 반영한다 — 그러지 않으면 보류 동안 지나간 해제 커밋을 다시 볼 수 없다.
- Codex CLI 는 Claude 호환 훅 스키마(`hookSpecificOutput`·`additionalContext`·`stop_hook_active`)를 내장한다 — 바이너리 실측 확인. 같은 스크립트가 두 도구에서 그대로 동작한다.
