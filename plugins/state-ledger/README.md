# state-ledger — live coordination ledger

멀티 에이전트·멀티 툴(Claude Code / Codex / Antigravity / Muse / opencode) 프로젝트의 작업 상태 원장.
EUNHA 에서 실운영으로 검증된 시스템의 일반화판 — EUNHA 는 테스트베드이며 정본 스키마는 이 README 다.

## 철학

- **STATE = 공유 상태판, 작업 기록 장치가 아니다** — 지금 누가 무엇을 하고, 무엇이 남았고, 무엇을 결정해야 하는지만 여러 에이전트가 공유한다. 상태가 바뀌면 그 줄과 `## 현재`를 바꿔 쓰고 덧붙이지 않는다.
- **작업 기록은 커밋 메시지, 완료 사실은 git log 가 정본** — 커밋 메시지에 `[id=<id>]`(STATE 항목과 무관한 작업은 `[id=-]`), archive 시 `archive [id=...]`. STATE 는 완료 로그·작업 경과를 누적하지 않는다.
- **인덱스는 싸고, 상세는 lazy** — 세션 시작에 주입되는 것은 1줄/항목 인덱스뿐. 작업을 잡을 때만 `docs/state/<area>/<id>.md` 를 읽는다.
- **게이트는 전부 warn-only** — 막지 않고 알린다. warn 은 0 으로 수렴시켜야 채널이 살아있다 (방치하면 배경소음).
- **턴 귀속은 커밋 메시지로 판정** — UserPromptSubmit 때 repo 밖에 HEAD·dirty STATE hash·detail 본문 크기를 저장하고, Stop에서 이번 턴에 만든 커밋 중 작업 파일을 바꾼 커밋의 메시지에 유효 `[id=<id>]`가 있는지 본다. 알림은 이번 턴 것만 한 번 내고 다음 턴으로 넘기지 않는다. STATE 갱신은 매 턴 요구하지 않는다.
- **goal-run과 무관한 전역 lifecycle** — STATE는 live ownership만 담당한다. goal TRACK·item branch 같은 파이프라인 규칙은 해당 스킬이 소유한다.

## 스키마 (대상 프로젝트 AGENTS.md 에 붙여 넣는 작성규칙)

```
- `STATE.md`는 공유 상태판이다. live ownership·진행·미래·미해결 결정과 WHY만 담는다. 남은 일·소유·결정이 바뀌면 그 줄과 detail을 바꿔 쓰고 덧붙이지 않는다. 작업 기록(완료 사실·경과)은 커밋 메시지가 맡으며 git log가 정본이다.
- 카테고리 4개와 WIP cap: §1 활성 ≤6 (owner 필수) · §2 다음 ≤6 · §3 미래 placeholder ≤5 · §4 미해결 결정 ≤8. cap 초과는 분류 실패 신호 — 가장 오래 움직이지 않은 항목을 archive한다.
- 항목 = 1줄 인덱스: `- [<id>] <제목> — <짧은 상태·조건>` (≤200자). 상세 정본 = docs/state/<area>/<id>.md.
  frontmatter: id·area·owner·branch·touched·hash (+depends/blocks/handoff/expires)
  본문: ## 현재 (필수, ≤4KB — 요약·남은 것·WHY) + ## 원장 (선택 — 결정 WHY만). detail 전체 ≤8KB.
- `id`는 3–12자 stable identifier다. id 없는 줄은 §3 placeholder만 허용한다. meta는 detail frontmatter가 정본 — hook이 touched·hash만 스탬프하고 owner·branch는 수동 claim이다. 착수한 항목은 §1로 옮기고 owner를 claim한다.
- 작업 커밋 메시지에는 `[id=<인덱스 id>]`를 붙인다. `[id=-]`는 STATE 항목과 정말 무관한 잡무에만 쓴다. id를 빠뜨렸으면 직접 만든 미push 직전 커밋은 `git commit --amend`로 붙이고, 아니면 다음 커밋부터 붙인다. STATE에 경과를 적어 대신하지 않는다.
- `expires`가 지난 항목은 갱신하거나 archive한다. archive = 인덱스 줄 + detail 파일 삭제, commit message에 `archive [id=...]`.
- 멀티 에이전트 작업은 branch·worktree를 분리한다.
```

## 구성

| 파일 | 역할 |
| --- | --- |
| `scripts/check-state-wip-cap.sh` | WIP cap·섹션 존재·줄 200자·인덱스 4KB·인덱스↔detail 양방향·id 3–12자·문자집합·§1·§2·§4 id 필수·frontmatter(id/area/owner/branch/touched/hash/expires/§1 owner)·`## 현재` 필수. 크기 경고 `## 현재` 4KB·detail 8KB는 strict 모드에서도 구조 실패로 세지 않음 |
| `scripts/check-state-branch-sync.sh` | §1·§2 branch 포인터 소멸/기머지 (빈 예약 브랜치 오탐 제외) + 유령 브랜치 (frontmatter `branch:` 만 등재로 인정, 제외 glob = `STATE_BRANCH_EXCLUDE`) |
| `scripts/hooks/session-start-state-inject.sh` | SessionStart — 원칙 한 줄 + 인덱스 전문 + 위 두 체커의 warn 주입 + 같은 worktree 동시 세션 경고(읽기만, 기준점은 만들지 않음) |
| `scripts/hooks/commit-msg-state-check.sh` | commit-msg — 인덱스/detail에서 실제 바뀐 모든 id별 `[id=<id>]` / detail 삭제 파일별 `archive [id=<id>]` 검사 |
| `scripts/hooks/state-config.mjs` | `.staterc` 공통 파서 — 인덱스 상대경로·정규화·repo 경계·symlink·개수와 설정 크기를 읽기 전에 검증 |
| `scripts/hooks/turn-start-state-snapshot.sh` | UserPromptSubmit/chat.message — repo 밖 세션별 턴 기준점(HEAD·dirty STATE hash·detail 본문 크기) 저장. 오류만 출력 |
| `scripts/hooks/state-turn-baseline.mjs` | 판정 엔진 — 이번 턴 커밋의 `[id=]` 태그, detail 본문 덧붙임, 동시 세션 보류. 턴을 넘는 상태는 저장하지 않는다. git plumbing(rev-list·diff-tree --stdin --cc·cat-file)만 쓴다 |
| `scripts/hooks/post-edit-state-stamp.sh` | PostToolUse — detail 본문 hash 변경 시 touched·hash 스탬프 (다중 파일 apply_patch 지원, owner·branch 불변, 프로젝트 밖 경로 거부) |
| `scripts/hooks/stop-state-reminder.sh` | Stop — 엔진 결과를 표시만 한다: 이번 턴의 태그 없는 커밋·인덱스에 없는 id 커밋, detail 본문 덧붙임, 동시 세션 보류, 이번 턴에 바뀐 STATE 경로의 구조 재검 |
| `hooks/claude-hooks.json` + `global-state-hook.sh` | Claude Code user-scope plugin lifecycle. STATE 미사용 repo는 no-op, 이행 중 실제 로컬 command만 구조적으로 감지해 이벤트별 중복 억제 |
| `hooks/hooks.json` | Codex plugin-bundled global lifecycle. `$PLUGIN_ROOT`의 설치 버전을 실행하며 사용자 `hooks.json` 복사본을 만들지 않음 |
| `hooks/antigravity-hooks.json` + `antigravity-*.sh` | Antigravity(Google Antigravity / AGY) lifecycle. PreInvocation·PostToolUse·Stop JSON 계약 변환. Stop은 이번 턴 알림(태그·덧붙임·크기 외 구조 경고)이 있을 때만 1회 `continue`, 없으면 `allow` |
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

- 이번 턴 커밋 = 턴 시작 HEAD에서 닿지 않고 현재 HEAD에서 닿는, 턴 시작 이후에 만들고(committer 시각) 작성한(author 시각) 커밋. 이 중 작업 파일을 바꾼 머지가 아닌 커밋의 메시지에 유효 태그가 없으면 `<sha7> <제목>`으로 알린다(6개 + 외 N개). 1000개를 넘으면 판정을 건너뛰고 알린다.
- 유효 태그 = `[id=X]`·`archive [id=X]`(X는 작업 트리·턴 시작 HEAD·현재 HEAD·`STATE_DEFAULT_BRANCH`·그 커밋 자신의 STATE 인덱스 id) 또는 `[id=-]`. 태그는 있는데 X가 인덱스에 없으면 '알 수 없는 id'로 따로 알린다.
- 이번 턴에 바뀐 detail의 본문(frontmatter 제외)이 턴 시작보다 1024B 넘게 늘면 덧붙임으로 알린다. 턴 시작에 없던 detail은 크기 cap만 본다.
- 구조 재검은 이번 턴에 바뀐 STATE 경로(머지 충돌 해결 포함)를 언급하는 checker 경고만 보인다. 같은 worktree에 다른 활성 세션이 보이면 태그·덧붙임 판정을 보류하고 그 사실만 알린다.
- 알림은 이번 턴 것만 한 번 내고 다음 턴으로 넘기지 않는다. 미커밋 작업과 턴 사이 커밋은 판정하지 않는다. Antigravity는 태그·덧붙임·크기 외 구조 경고가 있을 때만 1회 continue한다.

알려진 한계: 태그 검사는 id가 STATE 인덱스에 있는지만 확인하고 커밋 내용과의 관련성은 보지 않는다(`[id=-]` 남용은 리뷰 대상). rebase·cherry-pick·amend는 author 시각을 유지하므로 이전 턴 커밋을 다시 쓴 커밋은 다시 알리지 않고, 그때 이전 턴 커밋에 섞어 넣은 새 작업도 판정하지 않는다. 턴 시작 이후에 만든 남의 커밋은 이번 턴 커밋으로 본다. 사용자 중단처럼 Stop 없이 끝난 턴의 커밋은 판정하지 않는다. Claude Code의 Stop systemMessage는 사용자에게만 보인다. opencode는 SessionStart를 instructions 방식으로 대신하므로 정합 warn이 세션 시작에 표면화되지 않는다.

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
- 턴을 넘는 debt를 두지 않는 이유 (0.4.0): warn-only 장치가 debt를 턴 너머로 들고 다니면 해제 수단(sha 참조 커밋·같은 경로 후속 태그·도달 불가·늦은 등재)과 턴 사이 판정·중단 턴 이어 붙이기가 따라붙어 엔진이 그 상태를 관리하느라 커진다. 놓친 태그는 git log에 그대로 남고 다음 커밋부터 붙이면 되므로 알림은 이번 턴 것만 한 번 낸다.
- 미커밋 작업을 판정하지 않는 이유: 같은 변경은 커밋될 때 태그로 판정된다. dirty 작업에 dirty STATE 갱신을 요구하면 기록 덧붙이기만 강요한다.
- 턴 시작 전에 만든 커밋을 판정하지 않는 이유: pull·merge·checkout으로 들어온 팀원 커밋은 이 세션의 작업이 아니고, 이미 push된 커밋은 amend할 수 없다. committer 시각이 턴 시작보다 이르면 이 턴이 만든 커밋일 수 없다. author 시각만 이르면 이전 턴 커밋을 rebase·pull --rebase로 다시 쓴 커밋이므로, 이미 알린 커밋을 rebase할 때마다 다시 알리지 않는다.
- STATE 수정이 알림과 무관한 이유: 0.3.x 습관대로 코드는 id 없이 커밋하고 STATE에 경과를 덧붙이면 같은 문제가 되풀이된다. 태그 없는 커밋은 커밋 기록의 결함이므로 amend나 다음 커밋으로 고친다. STATE 항목과 무관한 작업에는 `[id=-]`라는 명시 탈출구를 둬 STATE에 무언가 써서 알림을 끄는 길을 없앤다.
- 유효 id를 넓게 잡는 이유: 새 항목을 등재하고 STATE를 아직 커밋하지 않았거나(작업 트리), worktree를 나눠 기본 브랜치에만 등재했거나(STATE_DEFAULT_BRANCH), 이번 턴에 archive한 경우(턴 시작 HEAD), 한 턴 안에 등재하고 archive까지 끝낸 경우(그 커밋 자신의 트리)를 '알 수 없는 id'로 오판하지 않는다.
- 머지 커밋을 판정하지 않는 이유: 머지된 쪽 커밋은 따로 판정되거나 턴 전에 만든 커밋이고, 기본 머지 메시지에는 id가 없다. 단 머지에서 직접 고친 경로(충돌 해결, `diff-tree --cc`)는 이번 턴 STATE 변경으로 보고 구조 재검한다.
- 크기 cap을 strict 구조 실패로 세지 않는 이유: 큰 detail은 구조 결함이 아니라 바꿔 쓰기 대상이다. 같은 이유로 크기 경고만으로는 Antigravity를 강제 continue하지 않는다 — 큰 detail에 owner만 바꾼 claim 턴이 축약 작업으로 끌려가면 STATE를 건드리지 않는 쪽이 조용해진다. 이번 턴의 증가는 덧붙임 알림이 맡는다.
- 덧붙임을 본문 전체로 재는 이유: `## 현재`만 재면 경과가 `## 원장`으로 옮겨 간다. 턴 시작 크기와만 비교해 같은 증가를 다음 턴에 다시 알리지 않는다.
- Stop 구조 재검을 이번 턴에 바뀐 STATE 경로로 좁히는 이유: 다른 detail의 기존 크기·구조 경고가 STATE를 건드리는 턴마다 반복되면 배경소음이 되고 Antigravity는 강제 continue한다. 기존 경고는 SessionStart 주입이 맡는다.
- git plumbing만 쓰는 이유: `git log`는 `log.showSignature` 같은 사용자 설정이 출력에 섞여 sha 파싱이 깨진다. rev-list·diff-tree --stdin·cat-file --batch는 설정에 흔들리지 않고, 커밋 수와 무관하게 spawn 몇 번으로 끝나 Stop timeout(30초)을 넘지 않는다.
- 동시 세션에서 판정을 보류하는 이유: 같은 worktree의 파일과 HEAD만으로 어느 세션이 커밋했는지 확정할 수 없다.
- Codex CLI 는 Claude 호환 훅 스키마(`hookSpecificOutput`·`additionalContext`·`stop_hook_active`)를 내장한다 — 바이너리 실측 확인. 같은 스크립트가 두 도구에서 그대로 동작한다.
