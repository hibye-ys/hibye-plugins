# state-ledger — live coordination ledger

멀티 에이전트·멀티 툴(Claude Code / Codex / Antigravity / Muse / opencode) 프로젝트의 작업 상태 원장.
EUNHA 에서 실운영으로 검증된 시스템의 일반화판 — EUNHA 는 테스트베드이며 정본 스키마는 이 README 다.

## 철학

- **STATE = 공유 상태판, 작업 기록 장치가 아니다** — 지금 누가 무엇을 하고, 무엇이 남았고, 무엇을 결정해야 하는지만 여러 에이전트가 공유한다. 상태가 바뀌면 그 줄과 `## 현재`를 바꿔 쓰고 덧붙이지 않는다.
- **작업 기록은 커밋 메시지, 완료 사실은 git log 가 정본** — 커밋 메시지에 `[id=<id>]`(STATE 항목과 무관한 작업은 `[id=-]`), archive 시 `archive [id=...]`. STATE 는 완료 로그·작업 경과를 누적하지 않는다.
- **인덱스는 싸고, 상세는 lazy** — 세션 시작에 주입되는 것은 1줄/항목 인덱스뿐. 작업을 잡을 때만 `docs/state/<area>/<id>.md` 를 읽는다.
- **기본 게이트는 warn-only** — 명시적 opt-in 정리 요청은 아래 별도 검증을 적용한다. warn 은 0 으로 수렴시켜야 채널이 살아있다 (방치하면 배경소음).
- **턴 귀속은 커밋 메시지로 판정** — UserPromptSubmit 때 repo 밖에 HEAD·dirty STATE hash·detail 본문 크기를 저장하고, Stop에서 이번 턴에 만든 커밋 중 작업 파일을 바꾼 커밋의 메시지에 유효 `[id=<id>]`가 있는지 본다. 알림은 이번 턴 것만 한 번 내고 다음 턴으로 넘기지 않는다. STATE 갱신은 매 턴 요구하지 않는다.
- **goal-run과 무관한 전역 lifecycle** — STATE는 live ownership만 담당한다. goal TRACK·item branch 같은 파이프라인 규칙은 해당 스킬이 소유한다.

## 스키마 (작성 규칙 요약 — 프로젝트에서는 `.agents/skills/state-ledger-rules` 사본이 이 내용을 담고, `AGENTS.md`에는 그 위치만 적는다)

```
- `STATE.md`는 공유 상태판이다. 누가 무엇을 하는지(owner)·남은 일·미해결 결정과 WHY만 담는다. 남은 일·소유·결정이 바뀌면 그 줄과 detail을 바꿔 쓰고 덧붙이지 않는다. 작업 기록(완료 사실·경과)은 커밋 메시지가 맡으며 git log가 정본이다.
- 카테고리 4개와 WIP cap: §1 활성 ≤6 (owner 필수) · §2 다음 ≤6 · §3 미래 placeholder ≤5 · §4 미해결 결정 ≤8. cap 초과는 분류 실패 신호 — 사용자와 남길 작업을 정한다. 나이·cap만으로 자동 archive하지 않는다.
- 항목 = 1줄 인덱스: `- [<id>] <제목> — <짧은 상태·조건>` (≤200자). 상세 정본 = docs/state/<area>/<id>.md.
  frontmatter: id·area·owner·branch·touched·hash (+depends/blocks/handoff/expires, 긴 다단계 작업은 +goal·step·next_step 한 줄씩 ≤200자 — 0.9.0)
  본문: ## 현재 (필수, ≤4KB — 요약·남은 것·WHY) + ## 원장 (선택 — 결정 WHY만). detail 전체 ≤8KB.
- `id`는 3–12자 stable identifier다. id 없는 줄은 §3 placeholder만 허용한다. meta는 detail frontmatter가 정본 — hook이 touched·hash만 스탬프하고 owner·branch는 수동 claim이다. 착수한 항목은 §1로 옮기고 owner를 claim한다.
- 작업 커밋 메시지에는 `[id=<인덱스 id>]`를 붙인다. `[id=-]`는 STATE 항목과 정말 무관한 잡무에만 쓴다. id를 빠뜨렸으면 직접 만든 미push 직전 커밋은 `git commit --amend`로 붙이고, 아니면 다음 커밋부터 붙인다. STATE에 경과를 적어 대신하지 않는다.
- `expires`가 지난 항목은 사용자 확인 뒤 갱신하거나 archive한다. archive = 인덱스 줄 + detail 파일 삭제, commit message에 `archive [id=...]`.
- 멀티 에이전트 작업은 branch·worktree를 분리한다.
```

## 구성

| 파일 | 역할 |
| --- | --- |
| `scripts/check-state-wip-cap.sh` | WIP cap·섹션 존재·줄 200자·인덱스 4KB·인덱스↔detail 양방향·id 3–12자·문자집합·§1·§2·§4 id 필수·frontmatter(id/area/owner/branch/touched/hash/expires/§1 owner)·`## 현재` 필수. 크기 경고 `## 현재` 4KB·detail 8KB는 strict 모드에서도 구조 실패로 세지 않음 |
| `scripts/check-state-branch-sync.sh` | §1·§2 branch 포인터 소멸/기머지 (빈 예약 브랜치 오탐 제외) + 유령 브랜치 (frontmatter `branch:` 만 등재로 인정, 제외 glob = `STATE_BRANCH_EXCLUDE`) |
| `scripts/hooks/session-start-state-inject.sh` | SessionStart — 인덱스 전문 유지, 두 checker 경고의 유형·건수·대표·원본 조회 경로 요약, 같은 worktree 동시 세션 경고(읽기만, 기준점은 만들지 않음) |
| `scripts/hooks/commit-msg-state-check.sh` | commit-msg — 인덱스/detail에서 실제 바뀐 모든 id별 `[id=<id>]` / detail 삭제 파일별 `archive [id=<id>]` 검사 |
| `scripts/hooks/state-config.mjs` | `.staterc` 공통 파서 — 인덱스 상대경로·정규화·repo 경계·symlink·개수와 설정 크기를 읽기 전에 검증 |
| `scripts/hooks/turn-start-state-snapshot.sh` | UserPromptSubmit/chat.message — repo 밖 세션별 턴 기준점(HEAD·dirty STATE hash·detail 본문 크기) 저장, 이어서 `state-focus.mjs` 알림을 `additionalContext` 로 주입. 현재 브랜치 소유 항목이 없으면 오류만 출력 |
| `scripts/hooks/state-focus.mjs` | 현재 작업 재주입 엔진 — 현재 브랜치가 `branch:` 로 소유한 §1·§2 항목(최대 3개)의 `goal`·`step`·`next_step`·`handoff` 를 약 3KB 이내 텍스트로 만든다. 기본 브랜치·detached HEAD 는 출력 없음. `reminder` 서브커맨드 |
| `scripts/hooks/state-verify.mjs` | 여러 턴 독립 검증 엔진(opt-in, 0.10.0; 0.10.1 부터 사용자 허용 필요 — `allow`·`disallow`·`status`) — `turn-start`(턴 카운트·단계 기준점, 미전달 판정 주입)·`session-start`(compaction 예약)·`stop`(판정 수거·차단/보고, 계기가 있으면 검사 세션 시작)·`run`(분리된 worker 가 headless `claude -p`/`codex exec` 를 실행). `.staterc` `STATE_VERIFY="1"` 이 아니면 아무것도 하지 않는다 |
| `scripts/hooks/state-turn-baseline.mjs` | 판정 엔진 — 이번 턴 커밋의 `[id=]` 태그, detail 본문 덧붙임, 동시 세션 보류. 턴을 넘는 상태는 저장하지 않는다. git plumbing(rev-list·diff-tree --stdin --cc·cat-file)만 쓴다 |
| `scripts/hooks/post-edit-state-stamp.sh` | PostToolUse — detail 본문 hash 변경 시 touched·hash 스탬프 (다중 파일 apply_patch 지원, owner·branch 불변, 프로젝트 밖 경로 거부) |
| `scripts/hooks/stop-state-reminder.sh` | Stop — 엔진 결과를 표시만 한다: 이번 턴의 태그 없는 커밋·인덱스에 없는 id 커밋, detail 본문 덧붙임, 동시 세션 보류, 이번 턴에 바뀐 STATE 경로의 구조 재검 |
| `hooks/hooks.json` + `global-state-hook.sh` | Codex·Claude 공통 plugin lifecycle. 두 host의 `$CLAUDE_PLUGIN_ROOT`로 설치 버전을 실행하며 `$PLUGIN_ROOT` 유무로 host를 구분한다. STATE 미사용 repo는 no-op, 이행 중 실제 로컬 command만 구조적으로 감지해 이벤트별 중복 억제 |
| `hooks/antigravity-hooks.json` + `antigravity-*.sh` | Antigravity(Google Antigravity / AGY) lifecycle. PreInvocation·PostToolUse·Stop JSON 계약 변환. Stop은 이번 턴 알림(태그·덧붙임·크기 외 구조 경고)이 있을 때만 1회 `continue`, 없으면 `allow` |
| `scripts/hooks/state-index.mjs` | 인덱스 원천 선택(`STATE_INDEX_SOURCE`). frontmatter 원천의 렌더·로컬 생성 인덱스 쓰기·구조 검사·리비전별 등재 판정 |
| `state-ledger-contract.json` | project adapter와 plugin runtime 사이의 독립 계약 버전. v6 미만 설치본은 runner가 실행하지 않음. capability: `cleanup_version`(정리 강제), `index_source_version`(frontmatter 원천) |
| `templates/skills/state-ledger-rules/` + `scripts/hooks/rules-skill.mjs` | 규칙 스킬 템플릿과 `status`·`install`·`diff`·`update`·`notice`. SessionStart는 프로젝트 사본 기준 버전이 템플릿보다 낮을 때만 한 줄 알린다 |
| `templates/wiring/state-ledger-runner.mjs` | Git/opencode용 얇은 프로젝트 adapter. 활성화된 Codex version cache 또는 Claude user install을 검증해 plugin-owned script를 실행 |

## 설정 — `.staterc` (선택)

형식 고정: `KEY="value"` 한 줄씩. 스크립트는 source 하지 않고 고정 형식만 파싱한다. `STATE_INDEXES`는 공백 구분이며 각 항목은 repo 내부의 정규화된 상대경로이고 반드시 `STATE.md`로 끝나야 한다. 절대경로·`..`·glob·공백·repo 밖 symlink는 읽기 전에 거부한다.

```sh
STATE_INDEXES="STATE.md apps/api/STATE.md apps/web/STATE.md"  # 기본 "STATE.md"
STATE_DEFAULT_BRANCH="main"
STATE_WORK_INCLUDE_RE="(^|/)\.staterc$|(^|/)Dockerfile$|\.(ts|tsx|js|jsx|mjs|cjs|sh|py|css|html|svg|ya?ml|json|sql|toml|go|rs|java|kt|swift|c|cc|cpp|h|hpp|png|jpe?g|webp|gif|avif|woff2?|ttf|otf)$|(^|/)(prompts?|agents?|skills?|commands?)/.*\.md$"
STATE_WORK_EXCLUDE_RE="(^|/)(node_modules|dist|build|coverage|vendor)/"
STATE_BRANCH_EXCLUDE="task-loop/*"  # 유령 검사 제외 glob (공백 구분)
STATE_INDEX_SOURCE="manual"         # manual(기본) | frontmatter — 아래 0.8.0
STATE_VERIFY="1"                    # 독립 검증 요청 (기본 꺼짐) — 사용자가 이 저장소를 허용해야 돈다, 아래 0.10.0·0.10.1
# 0.10.1: STATE_VERIFY_EVERY·RUNNER·MODEL·STEP_MODEL 은 .staterc 에서 받지 않는다 — 사용자 허용 파일(아래 0.10.1)
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

## 스킬

- `setup-state`: 프로젝트 설치·이관.
- `state-ledger-rules`(템플릿): STATE 사용 규칙(항목 추가·갱신·claim·`awaiting_user`, 경고 대응, 사용자 확인 뒤 정리, 브랜치 보존·폐기). 전역 스킬이 아니다. `templates/skills/state-ledger-rules/`에 있고 `setup-state`가 프로젝트 `.agents/skills/state-ledger-rules/`로 복사한다. 프로젝트는 그 사본을 직접 고친다. 공통 개선은 템플릿의 `metadata.template_version`을 올려 배포하고, 각 프로젝트는 SessionStart 알림을 보고 `scripts/hooks/rules-skill.mjs update`로 3-way 병합한다(`.template-base.md` = 병합 기준, 충돌이 풀릴 때까지 새 템플릿은 `.template-pending.json`에 보류).

## 설치

Codex와 Claude Code에는 `state-ledger@hibye-plugins`를 user scope로 한 번 설치한다. 두 도구 모두 기본 `hooks/hooks.json` 하나를 로딩하고 `$CLAUDE_PLUGIN_ROOT`로 같은 dispatcher를 실행한다. Codex도 이 호환 변수를 제공하며 `$PLUGIN_ROOT` 유무로 dispatcher가 host를 구분한다. Claude manifest에 별도 `hooks`를 선언하면 기본 파일에 추가 병합되므로 중복 binding을 두지 않는다. 프로젝트나 사용자 `hooks.json`에 lifecycle command를 복사하지 않는다. Antigravity는 `~/.gemini/config/hooks.json` 또는 프로젝트 `.agents/hooks.json`에 `hooks/antigravity-hooks.json` 스니펫을 병합해 `antigravity-pre-invocation.sh`, `antigravity-post-tool-use.sh`, `antigravity-stop.sh`를 실행한다. Orca처럼 계정별 `CODEX_HOME`을 쓰는 환경은 각 홈에서 플러그인을 별도로 활성화한다. 프로젝트에는 `STATE.md`·`docs/state/**`·`.staterc`, 규칙 스킬 사본 `.agents/skills/state-ledger-rules/`(+ `.claude/skills/state-ledger-rules` 링크)와, Git/opencode를 쓰는 경우 얇은 `scripts/hooks/state-ledger-runner.mjs` adapter만 둔다. STATE lifecycle·checker·baseline 구현은 복사하지 않는다. `STATE.md`와 `.staterc`가 모두 없는 저장소에서는 전역 훅이 조용히 no-op 한다.

Codex 업데이트는 `.codex-plugin/plugin.json` cachebuster를 갱신한 뒤 `codex plugin add state-ledger@hibye-plugins`로 재설치한다. Claude Code는 `.claude-plugin/plugin.json` version을 올리면 `claude plugin update state-ledger@hibye-plugins`(또는 재설치)로 `~/.claude/plugins/installed_plugins.json`의 version을 맞추고, 로컬 개발 링크를 쓰면 `scripts/link-cache.sh`로 새 version 링크를 만든다 — runner의 Claude fallback은 설치 기록 version과 manifest version이 같을 때만 실행한다. 운영 설치 캐시는 소스 링크로 바꾸지 않는다. `scripts/link-cache.sh`는 기본적으로 Claude 및 Antigravity 개발 캐시만 연결하며, Codex 소스 링크는 격리된 로컬 개발에서 `--codex-dev-links`를 명시한 경우에만 만든다.

`/state-ledger:setup-state`는 프로젝트 데이터·작성 규칙·규칙 스킬 사본·필요한 adapter만 온보딩한다. runner는 `STATE_LEDGER_PLUGIN_ROOT` 명시 override → Codex의 enabled plugin catalog와 정확한 version cache → Claude의 enabled user install 순으로 정본을 찾고 plugin name/version·`state-ledger-contract.json` v6·대상 파일을 검증한다. Codex CLI를 실행할 수 없거나 제한 시간 안에 응답하지 않으면 v6 계약을 가진 물리 cache directory로만 fallback하며, CLI가 정상 응답해 disabled 상태를 보고한 경우 cache를 임의 활성화하지 않는다. lifecycle stdin과 child stdout/stderr는 runner가 명시적으로 전달하며 일반 검사는 설치·실행 실패를 경고한다. 정리 opt-in 프로젝트의 필수 검사는 실패로 닫는다.

`commit-msg`는 agent lifecycle이 아니라 Git hook이므로 기존 hook manager에서 `if [ ! -f scripts/hooks/state-ledger-runner.mjs ]; then :; elif command -v node >/dev/null 2>&1; then node scripts/hooks/state-ledger-runner.mjs commit-msg "$1"; else echo "WARN: node가 PATH에 없어 STATE commit-msg 검사를 건너뜁니다." >&2; fi`를 호출한다. shared Git hooks를 쓰는 이전 checkout에 runner가 없거나 Git GUI PATH에 node가 없어도 commit을 막지 않기 위한 guard다. lint-staged에서 구조 검사를 유지하려면 `node scripts/hooks/state-ledger-runner.mjs check-wip`을 사용한다. opencode는 runner와 `templates/wiring/opencode-harness.ts`를 함께 복사하고 `opencode.json` instructions에 인덱스를 지정한다. 기존 `.codex/hooks.json`·`.codex/config.toml`·`.claude/settings*.json`에 복사형 STATE lifecycle이 남아 있으면 제거한다. 이행 중인 브랜치에서는 전역 dispatcher가 JSON/TOML의 실제 로컬 command를 감지해 중복 실행을 피하며, 주석이나 단순 문자열은 로컬 훅으로 취급하지 않는다.

정본 회귀 검사는 `node --test scripts/hooks/state-hooks.test.mjs scripts/hooks/state-frontmatter.test.mjs scripts/hooks/state-focus.test.mjs scripts/hooks/state-cleanup.test.mjs scripts/hooks/state-verify.test.mjs scripts/hooks/rules-skill.test.mjs templates/wiring/state-ledger-runner.test.mjs`로 실행한다.

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

### 0.4.1 호스트 경계

Muse·Antigravity adapter는 STATE session inject, turn baseline, detail stamp, warn-only stop만 실행한다. 프로젝트 memory·intent 초기화는 독립 등록된 `project-context`가 소유하고, `post-edit-knip.sh` 같은 프로젝트 검사는 프로젝트의 native hook 등록이 소유한다. STATE adapter가 프로젝트 hook 파일을 찾아 대신 실행하지 않는다. 기존 Muse의 세션 ID·파일 경로 정규화와 16KB 출력 제한은 유지한다. 연결 API는 바뀌지 않아 `state-ledger-contract.json` v6를 유지한다.


### 0.5.0 사용자 확인 뒤 정리 (Codex·Claude Code)

기존 v6 계약은 유지하고 `cleanup_version: 1` capability를 더한다. 기본값은 off다. 정리 원장 쓰기에는 BSD `lockf`(macOS 기본 제공)이 필요하며 없거나 잠금 중이면 요청을 보존하고 실패한다. OS 임시 경로의 0바이트 파일에 운영체제 잠금을 잡으며 프로세스가 죽으면 자동 해제된다. 요청은 기존 STATE에만 기록한다. 프로젝트가 `.staterc`에 `STATE_CLEANUP_ENFORCE="1"`을 넣고 새 runner를 설치하면 다음 절차를 쓴다. 일반 cap·브랜치·태그 경고는 그대로다.

1. 구현·검증 후 `node scripts/hooks/state-ledger-runner.mjs cleanup await-user --target root/example --session SESSION`으로 detail을 `lifecycle: awaiting_user`로 두고 정상 커밋한다. 이 단계에서는 지우지 않는다.
2. 실제 사용자 확인·정리 지시를 받으면 `cleanup request --session SESSION --instruction-ref USER_MESSAGE_REF --instruction '정리해줘'`를 호출한다. 기본 대상은 그 세션의 커밋된 확인 대기 작업이다. 명시적으로 지정한 타 세션 작업만 `--scope explicit --target area/id`를 쓴다. 도구가 사용자 지시의 진위를 판별할 수 없으므로 원문·출처를 에이전트가 정확히 기록한다.
3. 첫 configured STATE 인덱스의 `STATE_CLEANUP_V1` JSON 주석에 요청·대상·원문·기준 커밋을 저장한다. 별도 요청 원장은 없다. 요청을 보존한 채 인덱스 줄·detail을 함께 제거하고 `archive [id=example]` 정상 커밋한다. 요청 뒤 바뀐 detail은 삭제를 거부한다.
4. `cleanup check --request REQUEST_ID --session SESSION`은 worktree·index·HEAD, 실제 삭제 커밋과 현재 참조를 확인한다. 역사 참조는 존재를 검증한 전체 SHA의 `SHA:docs/state/...` 좌표로 고친다. 통과 후 `cleanup finish`(같은 옵션)로 요청을 제거하고 마무리 커밋한다. 그 커밋까지 끝난 뒤 완료라고 보고한다.
5. 미완료 Stop은 원장에 횟수를 먼저 저장하고 요청별 자동 보완을 한 번만 이어간다. 또 실패하면 구체적 이유·요청을 남기고 미완료로 종료한다. `cleanup block --request ID --session SESSION --reason '실제 장애'`도 가능하다. 새 세션은 `cleanup resume --request ID --session NEW_SESSION --instruction-ref NEW_USER_MESSAGE_REF`로 명시적 인계를 기록한다. 기존 대상·원문·예산은 바뀌지 않는다.

SessionStart는 미완료 요청을 다시 주입한다. 삭제/요청 제거의 Git 검사와 bounded Stop이 강제 범위이며, 훅이 이미 출력된 자연어 답변을 취소할 수는 없다. 새 설치의 lifecycle은 새 세션에서 로드한다. Codex·Claude 두 호스트의 native 훅 프로토콜은 실제 fixture로 검증한다.

### 0.8.0 frontmatter 인덱스 원천 (병렬 PR 충돌 제거)

손으로 쓰는 인덱스 줄은 PR 마다 같은 섹션 끝에 추가되고 인접 줄이 archive 로 지워져 git 3-way 병합에서 충돌한다. GitHub PR 병합·mergeability 판정은 저장소 `.gitattributes`의 `merge=union`을 적용하지 않으므로(2026년 사용자 보고 다수) 병합 드라이버로는 풀 수 없다. 그래서 공유 줄 자체를 없앤다.

`.staterc`에 `STATE_INDEX_SOURCE="frontmatter"`를 두면:

- 항목 정본 = `docs/state/<area>/<id>.md` frontmatter의 `section`(`active|next|future|unresolved`)·`title`·`status`. 등록·상태 변경·archive 모두 그 파일 하나만 만들고·고치고·지운다. 다른 항목끼리는 파일이 달라 충돌하지 않는다.
- `STATE_INDEXES` 경로의 인덱스는 git 미추적 생성물이다(`.gitignore`). SessionStart·detail stamp·Stop·`state-ledger-runner.mjs render`가 작업 트리에 다시 쓰며, git 이 추적 중인 파일은 덮어쓰지 않는다. 렌더 줄은 `- [id] title — owner=<owner>; status`, 섹션 안에서 `touched` 최근순.
- 검사: cap·줄 200자·렌더 4KB·§1 owner·hash·크기·expires 는 그대로. `section`·`title`·`status` 누락·잘못된 section 은 `(라우팅 끊김)`, 추적 중인 인덱스의 손 줄도 `(라우팅 끊김)` — 0.7.x 의 인덱스↔detail 단절과 같은 분류어라 adapter 의 blocking 분류가 유지된다. 고아·섹션 heading 검사는 원천이 하나라 없다.
- 정리 요청: 요청 하나 = `docs/state/.cleanup/<request-id>.json`(`{"version":1,"request":{...}}`). 같은 잠금·CAS·검증·지문 규칙을 쓰고, archive = detail 삭제 커밋(+`archive [id=]`)이다.
- 리비전마다 그 시점 `.staterc`로 원천을 판정한다. 이전 전(manual) 커밋의 요청 기준점·archive 증거는 인덱스 줄 규칙으로 계속 읽힌다. 이전 커밋에서 기존 `STATE_CLEANUP_V1` 요청을 내용 그대로 파일로 옮기면 `REQUEST_CHANGED` 없이 통과한다.
- 계약 v6 은 그대로이고 `index_source_version: 1` capability 를 더한다. 새 runner 는 프로젝트가 frontmatter 원천일 때만 이 capability 를 요구한다 — 0.7.x 설치본은 unavailable(정리 강제면 fail-closed). 옛 runner·manual 프로젝트는 0.8.0 설치본을 그대로 쓴다(설정이 없으면 0.7.x 와 같은 동작). 그래서 0.8.0 을 먼저 개발 머신·CI runner 에 설치하고, 그다음 프로젝트를 전환한다.

### 0.8.1 정리 참조 검사 속도

`referencesTo`가 index·커밋 스냅샷에서 후보 파일마다 `git show`를 띄워, markdown 이 많은 저장소(EUNHA 약 17초/스냅샷)에서 정리 검사·`validate-staged`가 runner timeout(30초)을 넘었다. 후보 파일을 `git cat-file --batch` 한 번으로 읽는다(같은 결과, 1초 미만).

### 0.8.2 Linux·macOS 정리 잠금

정리 요청 쓰기는 Linux의 util-linux `flock`, macOS의 BSD `lockf`를 사용한다. 설치 호스트에 해당 명령이 필요하며, 없거나 잠금을 얻지 못하면 STATE를 쓰지 않고 실패한다. 두 경로 모두 같은 빈 잠금 파일을 보존하고 비차단 배타 잠금·프로세스 종료 시 해제·기존 내용 대조 후 원자 교체를 유지한다. Linux는 `flock -F`로 writer를 직접 실행해 writer의 종료와 잠금 수명을 맞춘다. macOS 실행 검증은 macOS에서 별도로 수행해야 한다.

### 0.9.0 세션 자기 checkout (git worktree 세션)

Claude 데스크톱 앱은 git worktree 세션에도 `CLAUDE_PROJECT_DIR`를 primary checkout 으로 넘긴다. 0.8.x dispatcher 는 그것을 `$PWD`보다 먼저 써서 worktree 세션이 primary(보통 `main`)의 STATE 를 주입받았다 — 브랜치에서 바꾼 `status`가 아니라 main 의 옛 상태가 compaction 마다 들어가 에이전트가 계획을 잃었다(EUNHA `[testmod]` 실측). 같은 원인으로 detail 스탬프는 worktree 경로를 프로젝트 밖으로 보고 건너뛰었고(나중에 hash 불일치), 턴 기준점은 모든 worktree 세션을 "같은 worktree 의 동시 세션"으로 묶어 Stop 판정을 보류시킬 수 있었다.

- 루트 선택(`global-state-hook.sh`): adapter 가 명시한 `HOOK_PROJECT_DIR`(Muse·Antigravity·테스트)이 있으면 그대로. 아니면 `here`(hook 입력 `cwd` → `$PWD` 의 첫 git toplevel), `project`(`CLAUDE_PROJECT_DIR` 의 toplevel), `pinned`(이 세션이 앞서 고정한 root)를 두고 `anchor = project || pinned` 로 삼는다. `here` 가 있고 anchor 가 없거나 anchor 와 **같은 저장소**(`git rev-parse --git-common-dir` 를 `pwd -P` 로 푼 값이 같음 — worktree 는 달라도 됨)이면 `here` 를 쓰고 고정하며, 아니면 `pinned` → `project` → `here` 순서다. 이유: worktree 세션은 `CLAUDE_PROJECT_DIR`(primary)보다 자기 worktree 가 정답이지만, hook 입력 `cwd` 는 에이전트가 추가 작업 디렉터리의 다른 저장소로 `cd` 하면 따라 움직여 그 저장소를 건드리거나 원장이 없다며 조용히 멈춘다 — 같은 저장소 가드와 세션 고정이 이를 막는다. 고정은 세션 id(`session_id`·`sessionID`·`sessionId`)의 `git hash-object` 해시로 `${STATE_HOOK_DATA_DIR:-${TMPDIR:-/tmp}/state-ledger-hooks}/root-<hash>.json`(`{"root": "..."}`, 임시 파일 + `mv`)에 쓴다. 턴 기준점 엔진의 같은 디렉터리 리더는 `version` 이 다른 `.json` 을 건너뛰고 7일 지난 `.json` 은 지우므로 충돌 없이 함께 정리된다. jq 나 세션 id 가 없으면 고정 없이 동작한다. 하위 스크립트를 직접 실행할 때와 `projectRoot()`도 git toplevel 을 `CLAUDE_PROJECT_DIR`보다 먼저 본다. primary checkout 세션의 동작은 그대로다.
- 검사별 시야: 구조·예산(`check-state-wip-cap.sh`)과 §1·§2 branch 포인터(`check-state-branch-sync.sh` ①)는 자기 checkout 을 본다 — 그 브랜치가 고치고 머지할 파일이고 commit-msg 검사도 같은 파일을 본다. 유령 브랜치(②)만 저장소 전체 질문이라 공유 시야가 필요하다: 등재는 병렬 브랜치에 흩어져 있으므로 자기 checkout 작업 트리 ∪ `STATE_DEFAULT_BRANCH` 트리 ∪ 그 브랜치 자기 트리 중 어디든 frontmatter `branch:`가 이름을 대면 등재로 본다(본문 언급은 여전히 아님). 트리는 node 한 번(리비전마다 `ls-tree` 1회 + `cat-file --batch` 1회)으로 읽고, 후보가 없으면 node 를 띄우지 않는다. 등재 조회가 실패하면 `WARN: STATE 브랜치 등재 조회 실패` 만 알리고 후보를 유령으로 몰지 않는다. 알려진 한계: 자기 트리에 자신을 등재한 브랜치는 BASE 가 나중에 그 항목을 archive 했어도 유령이 아니다 — archive 절차(사용자 확인을 받은 정리)가 그 브랜치를 폐기하거나 태그로 보존하므로 그 절차에 맡긴다.

### 0.9.0 현재 작업 재주입 (긴 작업의 목표·절차 유지)

긴 다단계 작업은 컨텍스트 압축 뒤 목표와 정해진 단계 순서를 잃고, 에이전트가 계획 순서를 벗어난 작업을 제안한다. 목표와 절차를 매 턴 눈앞에 두는 것이 토큰 비용보다 중요하므로, 비용을 이유로 생략하지 않는다.

- **소유 항목**: detail frontmatter `branch:` 가 체크아웃의 현재 브랜치와 같은 §1 활성·§2 다음 항목이다(frontmatter 원천·manual 원천 모두). 활성 먼저, 같은 섹션은 `touched` 최근순, 최대 3개를 싣고 나머지는 `외 N개` 로 줄인다. 전체 텍스트는 약 3000바이트 이내이고 넘치면 필드를 단계적으로 줄인다.
- **필드(모두 선택, 한 줄, 각 ≤200자)**: `goal`(목표와 완성 기준), `step`(지금 단계), `next_step`(다음 단계와 끝 조건). 계획 문서 경로는 기존 `handoff`(`path` 또는 `path#절`)를 쓴다. 필드가 비어 있거나 200자를 넘거나 콜론 뒤 공백이 없으면(`goal:값`, frontmatter 파서가 무시한다) `check-state-wip-cap.sh` 가 구조 경고를 낸다(없으면 경고 없음). 세 필드가 모두 없으면 `## 현재` 앞부분 발췌(≈600B)를 대신 싣는다. handoff 파일이 없으면 `(파일 없음)` 을 붙이고, handoff 가 없으면 `## 현재` 가 절차 정본이라고 적는다.
- **지시문**: 머리줄 바로 뒤에 한 번(0.10.1 — 그 전에는 알림 끝) — 작업을 제안·시작·전환하기 전에 각 항목의 handoff(없으면 detail `## 현재`)에서 지금·다음 단계 절과 끝 조건을 다시 읽고 인용하며, 계획 순서를 벗어나거나 범위를 바꾸려면 먼저 사용자에게 묻되 이번 턴 사용자의 명시 지시가 우선하고(계획과 어긋나면 그 사실만 한 줄 알리고 따른다), 단계가 바뀌면 `step`·`next_step`(과 `status`)을 바꿔 쓴다.
- **조용한 경우**: 현재 브랜치가 `STATE_DEFAULT_BRANCH`(기본 `main`; `origin/main` 처럼 원격 ref 로 주어도 `refs/remotes/<값>` 이 있으면 `main` 으로 본다)이거나 detached HEAD 이면 아무것도 싣지 않는다. 기본 브랜치를 가리키는 항목은 많아 소유가 모호하다. 소유 항목이 없거나 §3·§4 에만 있어도 출력이 없다.
- **주입 시점**: UserPromptSubmit 마다 `additionalContext` 로, SessionStart(startup/resume/clear/compact)에서는 `additionalContext` 에 정리 요청 → 초기화·설정 경고 → 현재 작업 알림 → 정합·예산 요약 → 규칙 스킬 알림 → 원칙 → 인덱스 순으로 싣는다. Claude 의 SessionStart `additionalContextLimit: 5000` 절단에서 알림이 요약·인덱스보다 오래 살아남되 초기화 오류는 그보다 먼저 전달되게 하기 위해서다. 엔진 실패는 경고로만 표시하고 주입·기준점 저장은 막지 않는다.
- **호스트**: Claude Code·Codex(같은 `hooks.json`), Muse(`muse-turn-start.sh` 가 dispatcher 출력을 그대로 전달, 15KB 이내), Antigravity(`antigravity-pre-invocation.mjs` 가 turn-start 알림을 매 호출 `injectSteps` 에 싣고 첫 호출의 session-start 와 중복되면 한 번만). opencode 는 훅이 아니라 instructions 주입이라 현재 작업 알림을 연결하지 않았다 — `templates/wiring/opencode-harness.ts` 의 `chat.message` 는 turn-start 의 오류(`systemMessage`)만 로그에 남기고 알림(`additionalContext`)은 주입도 로그도 하지 않는다.

### 0.10.0 여러 턴 독립 검증 (opt-in)

0.9.0 은 목표·단계를 매 턴 다시 보여 주지만, 에이전트가 그것을 보고도 순서를 벗어나거나 끝 조건을 채우지 않고 단계를 "끝"으로 적을 수 있다. 에이전트의 자기 점검은 같은 착각을 공유하므로 검증이 아니다. 그래서 **작업 에이전트와 별개인 로컬 headless 에이전트 세션**(모델 API 직접 호출이 아니다)이 목표와 계획 순서를 지키는지 여러 턴에 걸쳐 확인하고, 훅이 그 판정에 따라 움직인다. 토큰 비용은 검사를 생략할 이유가 아니라는 것이 사용자 결정이다. `.staterc` 에 `STATE_VERIFY="1"` 이 없으면 훅은 node 도 띄우지 않고 아무것도 하지 않는다. 0.10.1 부터는 `.staterc` 가 요청해도 사용자가 그 저장소를 허용해야 돈다(아래 0.10.1).

- **언제 도는가**: ① 이번 턴에 소유 항목의 `step`/`next_step` 이 바뀌었거나 새로 소유한 항목에 step 이 있을 때(= "이 단계 끝" 주장, 필수 계기) ② compaction 직후 첫 Stop(SessionStart `source="compact"` 가 예약 — 호스트가 이 값을 보낼 때만 동작한다. Claude Code 는 확인했고 Codex 는 확인하지 않았다) ③ 소유 항목이 있는 사용자 턴 `STATE_VERIFY_EVERY`(기본 5)번마다(`0` 이면 끔; 0 이상의 정수가 아니면 5 로 보고 Stop `systemMessage` 로 한 번 알림). 계기는 Stop 에서 모아 검사 하나로 묶는다. 한 세션에서 검사가 진행 중이면 계기를 대기열에 넣고 판정을 거둔 뒤 시작한다. 모든 세션을 합쳐 동시에 도는 검사는 최대 2개(job 폴더의 worker pid 가 살아 있는 수로 센다, 시작은 짧은 락으로 직렬화)이고, 상한이면 계기를 대기열에 둔 채 아무 말 없이 다음 Stop 에서 다시 시도한다. 검사를 막은 Stop 과 그 턴의 재진입 Stop(`stop_hook_active`) 에서는 검사를 시작하지 않고 계기만 쌓는다 — 아래 "벗어남이 발견되면".
- **누가 검사하는가**: Stop 훅이 분리된(detached) worker 를 띄우고, worker 가 새 세션을 **자기 프로세스 그룹**으로 돌린다. 프롬프트는 stdin 으로 넘기고 cwd 는 저장소 루트이며, PATH 에 `claude` 가 없으면 부모 세션이 알려 주는 `CLAUDE_CODE_EXECPATH` 를 쓴다. 모델은 주기·compaction 점검이 `STATE_VERIFY_MODEL`(기본 `sonnet`), 단계 변경 점검이 `STATE_VERIFY_STEP_MODEL`(기본 `opus`)이고 codex 는 변수를 명시했을 때만 `-m` 을 넘긴다. 검사 세션은 매번 새로 시작한다(직전 판정만 프롬프트에 요약해 넣어 지난 지적이 고쳐졌는지 보게 한다). 격리는 "읽기만 한다"는 부탁이 아니라 명령줄이 보장한다.
  - **claude(기본)**: `claude -p --restricted --strict-mcp-config --tools Read,Grep,Glob --allowedTools Read,Grep,Glob --permission-mode dontAsk --settings '{"disableAllHooks":true}' --no-session-persistence --output-format json --model <m> --add-dir <job 폴더>`.
    - `--restricted`: 명령·코드를 실행하는 내장 도구(Bash 등)와 WebFetch 를 없애고, **사용자·프로젝트·로컬 settings 파일을 무시**하며(허용 규칙·`auto` 같은 권한 모드·훅·플러그인 설정이 검사 세션에 닿지 않는다), 파일 도구를 cwd 와 `--add-dir` 폴더로 가둔다. 그래도 적용되는 설정은 **managed(관리자) settings 와 `--settings` 로 준 JSON 뿐**이다.
    - `--strict-mcp-config`: MCP 서버를 띄우지 않는다. `--tools`·`--allowedTools` 는 `Read,Grep,Glob` 뿐이고 **Bash 는 없다** — 이전 설계의 `Bash(git log:*)` 는 `git log --output=<file>` 로 파일을 쓸 수 있었기에 뺐다. `--permission-mode dontAsk` 는 목록 밖 도구를 묻지 않고 거부하고, `--settings` 의 `disableAllHooks` 는 남은 경로의 훅도 끈다. `--bare` 는 OAuth 구독을 건너뛰므로 쓰지 않는다 — `--restricted` 에서도 OAuth 로그인으로 동작함을 확인했다(API 키 불필요).
    - git 근거는 도구로 받을 수 없으므로 worker 가 프롬프트에 미리 넣는다(아래 "무엇을 읽는가"). 계획이 "테스트를 돌려 통과" 같은 실행을 요구해도 검사 세션은 실행할 수 없고, 그렇게 적어(`missing`/`unclear`) 보고한다.
    - `--add-dir` 는 이 job 의 전용 폴더 하나뿐이다(공유 `verify-jobs/` 를 열지 않는다).
  - **codex**(`STATE_VERIFY_RUNNER="codex"`): `codex exec --sandbox read-only --ephemeral -C <root> -c approval_policy="never" [-m <m>] -o <file> -`. read-only 샌드박스(파일 쓰기 없음)에 승인 정책 `never`(승인 대기로 멈추지 않고 거부)다. codex 0.166.0 에서 `approval_policy` 가 `-c` 로 받아들여지고 `never` 가 유효한 값임은 `--strict-config` 검증으로 확인했지만 codex 검사 한 판을 끝까지 돌려 본 것은 아니다. 격리 강도는 claude 보다 약하다 — 샌드박스 안에서는 읽기 명령(git 포함)을 실행할 수 있다. 0.10.1 에서 notify·hooks·plugins·apps 를 끄고, 켜진 MCP 서버를 모두 끄고, 셸 환경을 core 로 제한했다(아래 0.10.1).
  - **프로세스 위생**: runner 는 `detached` 로 자기 프로세스 그룹에서 돌고, 제한 시간(기본 15분, 환경변수 `STATE_VERIFY_TIMEOUT_MS`)을 넘으면 그룹에 SIGTERM, 5초 뒤에도 남아 있으면 SIGKILL 한다. 종료는 프로세스 `exit` 로 판단하고 stdout 은 2초만 더 기다린 뒤 파이프를 닫으며 남은 자손도 정리한다. 20분이 지났는데 worker 가 살아 있는 job 을 수거할 때는 worker 그룹을 종료한다(명령줄에 `state-verify.mjs` 가 든 pid 만 — pid 재사용 방지; worker 는 SIGTERM 을 받으면 검사 세션 그룹도 죽인다).
  - **작업 파일**: job 마다 `verify-jobs/<jobId>/`(0700)에 `job.json`·`transcript.txt`(0600)·`result.json`·`worker.pid` 를 두고, 판정을 거두면 폴더째 지운다. 남은 것은 7일 뒤 정리한다.
- **무엇을 읽는가**: 소유 항목(최대 3개)의 detail 경로·`goal`·`step`·`next_step`·`status`·`handoff`(각 필드 300자까지 싣는다)와, 검사 세션이 직접 읽을 detail·handoff 계획 문서(`path#절`)의 **끝 조건**, worker 가 미리 만들어 프롬프트에 넣는 git 근거 — 마지막 검사(없으면 세션 첫 소유 턴) 이후 `git log --oneline`(최대 50줄), `git diff --stat`, `git diff`(24KB 까지, 넘으면 `…(N bytes truncated)`; `--no-ext-diff --no-textconv --no-color`, `GIT_OPTIONAL_LOCKS=0`, `GIT_DIR` 류 환경변수 제거), 아직 커밋하지 않은 변경(`git status --short`) — 그리고 hook 입력 `transcript_path` 의 **대화 기록 끝부분**(파일 끝 512KB 에서 사용자·에이전트 텍스트만 최근 약 20KB; 도구 결과·생각·도구 호출은 제외, job 폴더의 0600 파일에 써서 검사 세션이 읽게 하고 끝나면 지운다). 프롬프트 전체는 **64KB(바이트)** 안이다: 역할·계기·항목·질문·출력 스키마는 항상 싣고, 커밋(6KB)·변경 요약(6KB)·diff(24KB)·작업 트리(2KB)·직전 판정(3KB)·대화 기록 안내(1KB)만 바이트 예산으로 글자 경계에서 자른다. 대화 기록이 필요한 이유는 실제 사고가 "계획 밖 작업 제안"이었기 때문이다. 모두 로컬 안에서만 읽는다. 질문은 ① 단계 변경 시 끝 조건이 근거와 함께 충족됐는가 ② 지금 작업·제안이 계획의 단계 순서를 따르는가(사용자의 명시 지시는 계획보다 우선) ③ 범위가 목표에서 벗어나는가.
- **판정**: JSON 하나 `{"verdict":"on_track|drift|unclear","kind":"step_unmet|order|scope|other|none","summary":"…","evidence":[…],"missing":[…]}` (summary ≤800자, evidence·missing 각 ≤8개×300자, 형식이 틀리면 `unclear`; 출력에 JSON 객체가 여럿이면 — 스키마 예시를 되풀이한 것 등 — 형식을 통과한 마지막 것을 쓴다). 러너 실패·형식 오류·결과 없이 끝난 세션(pid 소멸 또는 20분 경과)도 `unclear`(`검사 세션 실패: …`/`검사 세션이 결과 없이 끝남`)로 기록하며 차단하지 않는다. 최근 10개 판정을 repo 밖 `STATE_HOOK_DATA_DIR`(없으면 tmpdir `state-ledger-hooks`)의 `verify-<root>-<session>.json`(0600)에 두고, 작업 파일(`verify-jobs/`)은 7일 뒤 정리한다.
- **벗어남이 발견되면**: 가장 새 판정만 본다. `drift` 이고 `kind` 가 `step_unmet`·`order` 면 **다음 Stop 을 1회 막는다**(`decision:"block"` + 판정 요약·미충족 끝 조건·"handoff 의 해당 단계 절과 끝 조건을 다시 읽고 바로잡거나, 계획을 바꿔야 하면 사용자에게 묻고 끝낸다"). 막는 조건은 모두 맞아야 한다: ① 같은 판정으로 아직 막지 않았다 ② `stop_hook_active` 가 아니다 ③ **이 사용자 턴에 아직 막지 않았다**(`blockedTurn`; `stop_hook_active` 를 주지 않는 호스트도 한 턴에 한 번뿐) ④ **검사를 시작한 뒤 소유 항목의 `step`/`next_step` 이 바뀌지 않았다**(검사 시작 때의 스냅샷과 모두 같을 때만 — 아니면 낡은 판정이므로 막지 않고 보고에 "판정 이후 단계가 바뀌어 막지 않음 — 다음 검사가 새 상태를 본다" 를 붙인다). 막은 Stop 과 그 턴의 재진입 Stop 에서는 새 검사를 시작하지 않고 계기만 대기열에 쌓아 다음 사용자 턴의 Stop 이 시작하므로, check → block → step 수정 → check 가 한 턴 안에서 맴돌지 않는다. 막는 Stop 도 이번 Stop 의 일반 검사(기준점·태그 없는 커밋·덧붙임·구조 알림)를 그대로 하고, 훅 출력은 JSON 하나다 — `reason` 은 판정이고 `systemMessage` 는 판정 줄 다음에 그 알림 줄들이다. 그 밖의 `drift`·`unclear` 는 Stop `systemMessage` 한 줄(사용자에게만 보임)로 보고하고, `on_track` 은 조용히 기록한다. 에이전트는 Stop 사유 외에도 **다음 UserPromptSubmit 의 `additionalContext`** 에 `=== STATE 독립 검증 결과 (<계기>, <모델>) ===` 블록(판정·미충족·근거·"맞으면 바로잡고 틀렸다고 보면 근거를 들어 사용자에게 알린다")으로 `on_track` 이 아닌 미전달 판정을 한 번 받는다. 검사 세션이 틀릴 수 있으므로 에이전트는 근거를 들어 사용자에게 반박해도 된다 — 판정을 피하려고 `step` 갱신을 미루는 것은 규칙 위반이다(rules 템플릿 v5).
- **재귀 방지**: worker 는 검사 세션 환경에 `STATE_LEDGER_VERIFY_CHILD=1` 을 넣고 `CLAUDECODE`·`CLAUDE_CODE_ENTRYPOINT`·`CLAUDE_CODE_SSE_PORT`·`CLAUDE_PROJECT_DIR` 을 지운다. `global-state-hook.sh` 맨 앞이 이 변수가 있으면 즉시 종료하므로 검사 세션 안에서는 주입·기준점·Stop 판정·추가 검사가 모두 없다(claude 검사 세션은 `--restricted`·`disableAllHooks` 로 훅이 아예 돌지 않는다. 가드는 훅을 로드할 수 있는 codex 검사 세션과 엔진을 직접 부르는 경로를 막는다 — 가드를 가진 플러그인 버전이 설치돼 있어야 한다).
- **호스트**: Claude Code·Codex(`STATE_LEDGER_HOST` 비어 있음/`claude`/`codex`). Muse·Antigravity·opencode 는 Stop 계약이 달라 켜져 있어도 no-op. 소유 항목이 없는 세션도 no-op(0.9.0 과 같은 소유 판정을 `state-focus.mjs` 의 `currentOwned` 로 재사용). 기본 브랜치·detached HEAD 에서는 새 검사를 시작하거나 기준점을 비교하지 않지만, 세션의 verify 상태 파일이 있으면 끝난 검사를 거두어 판정을 보고·전달하고 풀린 항목의 미충족 판정은 한 번 막을 수 있다(아래 2차 재검증 수정).
- **테스트·고급**: 환경변수 `STATE_VERIFY_COMMAND` 에 실행 파일을 주면 `claude`/`codex` 대신 그것이 prompt(stdin)를 받아 cwd=저장소 루트, 환경 `STATE_VERIFY_MODEL_SELECTED` 로 실행되고 판정 JSON(또는 그것을 담은 텍스트)을 stdout 으로 낸다. `STATE_VERIFY_TIMEOUT_MS` 는 검사 제한 시간(ms, 기본 15분)을 바꾼다. 둘 다 `.staterc` 가 아니라 환경변수로만 받으므로 저장소 내용만으로 임의 명령이 실행되지 않는다.
- **알려진 한계**: 검사는 비동기라(1회 수십 초~수 분) 판정이 **다음 Stop 또는 다음 사용자 턴**에야 반영된다. 그 사이 에이전트가 이미 바로잡았어도 단계 표기를 바꾸지 않았다면 막힐 수 있다(바꿨다면 낡은 판정이라 막지 않는다). 실제 `claude`/`codex` 호출이라 시간·토큰이 든다. 검사 세션도 틀릴 수 있다. 검사 세션은 코드를 실행할 수 없으므로 "테스트 통과" 같은 끝 조건은 파일·로그·커밋 근거로만 판단하고 `unclear` 로 답할 수 있다. `--restricted` 는 도구를 제한할 뿐이라 CLAUDE.md 같은 맥락 파일이 프롬프트에 들어가는 것까지 막지 않는다. compaction 계기는 호스트가 SessionStart `source="compact"` 를 보내야 동작한다(Claude Code 확인, Codex 미확인). 검사 세션 인증은 부모와 같은 로컬 CLI 로그인을 쓴다.

### 0.10.1 적대적 리뷰 수정

0.10.0 을 4개 영역(root 선택, 알림, 검사기 격리, 검사기 흐름)으로 나눠 적대적으로 리뷰하고 높음 6건·중간 10건과 낮음 일부를 고쳤다.

- **독립 검증은 사용자가 켠다**: `.staterc` 의 `STATE_VERIFY="1"` 은 프로젝트의 요청일 뿐이다. 남이 만든 저장소의 `.staterc` 가 사용자 계정으로 백그라운드 세션을 반복해 띄우지 못하게, 사용자 허용 파일 `${XDG_CONFIG_HOME:-$HOME/.config}/state-ledger/verify.json` 에 그 저장소가 있어야 돈다(키: `git rev-parse --git-common-dir` 의 realpath — 같은 저장소의 모든 worktree 가 공유). runner·모델·주기도 이 파일에서만 받는다. `.staterc` 의 `STATE_VERIFY_EVERY/RUNNER/MODEL/STEP_MODEL` 은 무시하고 세션당 한 번 알린다. 허용 없이 요청만 있으면 세션당 한 번 안내만 낸다. 허용은 그 저장소의 등록된 checkout 에만 적용된다: 메인 checkout(`.git` 디렉터리), `<common>/worktrees/<name>/gitdir` 가 되돌아 가리키는 linked worktree, `core.worktree` 가 가리키는 submodule. `.git` 파일이 허용된 저장소를 가리키기만 하는 폴더는 허용되지 않고 `allow` 도 거부한다. 심볼릭 링크 `.git` 과 `--separate-git-dir` 저장소는 지원하지 않는다.
  ```sh
  # 저장소 안에서 실행 (<plugin> = 설치된 state-ledger 폴더)
  node <plugin>/scripts/hooks/state-verify.mjs allow                          # 기본값: claude, sonnet/opus, 5턴
  node <plugin>/scripts/hooks/state-verify.mjs allow --runner codex --every 3  # 준 값만 바꾼다 (--env 는 목록을 통째로 바꾼다)
  node <plugin>/scripts/hooks/state-verify.mjs allow --env MY_PROVIDER_KEY     # 반복 가능, --env= 는 비움, 생략하면 기존 목록 유지
  node <plugin>/scripts/hooks/state-verify.mjs status                         # 요청·허용 여부와 실제 설정
  node <plugin>/scripts/hooks/state-verify.mjs disallow
  ```
  `status` 는 `env=A,B` 또는 `(없음)` 도 보인다. `verify.json` 항목에는 `"env": ["NAME", ...]` 을 둘 수 있다(이름은 `^[A-Z_][A-Z0-9_]*$`, 최대 32개, 어긋나면 항목 전체가 무효). 이 변수들은 claude/codex 검사 세션에 넘어간다(예: codex 사용자 지정 provider 의 `env_key`).
  파일은 0600·폴더 0700 으로 쓰고, 사용자 소유 일반 파일·64KB 이하·group/other 쓰기 비트 없음일 때만 읽는다.
- **데이터 폴더는 사용자별**: 기본 경로가 `tmpdir/state-ledger-hooks-<uid>` 로 바뀌었다(`STATE_HOOK_DATA_DIR` 우선은 그대로). 데이터 폴더·`verify-jobs`·pin 폴더가 심링크이거나 다른 사용자 소유면 그 안에서 읽기·쓰기·정리를 하지 않는다 — 공유 `/tmp` 에 미리 심어 둔 심링크를 따라 피해자 폴더의 오래된 파일을 지우던 경로를 막았다. 업그레이드 직후 첫 턴은 옛 경로의 기준점을 보지 못해 `missing-baseline` 이 한 번 날 수 있다.
- **검사 세션 격리 강화**: 환경은 허용 목록(PATH·HOME·로캘·프록시·runner 별 인증 변수)으로 새로 만든다. claude runner 는 Foundry·Bedrock·Vertex 인증·엔드포인트·모델 변수도 받는다(아래 2차 재검증 수정). 그 밖의 변수(`ANTHROPIC_CUSTOM_HEADERS`·클라이언트 인증서 변수 등)는 `allow --env` 로 지정해야 한다 — `CLAUDE_CODE_MESSAGING_TOKEN`·`SSH_AUTH_SOCK`·임의 비밀은 넘기지 않는다. codex 는 `notify=[]`, `features.hooks/plugins/apps=false`, `shell_environment_policy.inherit="core"` 를 주고, worker 가 같은 설정으로 `codex mcp list --json` 을 읽어 켜진 MCP 서버를 모두 끈다(목록을 못 읽거나 켜진 서버 이름이 비었거나 제어 문자를 가지면 세션을 띄우지 않고 `unclear`). 판정 텍스트는 제어 문자를 지우고 summary 600자·evidence/missing 5×200자로 줄이며, 차단 사유와 턴 시작 전달은 훅 지시를 먼저 쓰고 판정은 "검증되지 않은 자료" 라벨 아래 `> ` 인용으로 싣는다. 저장소 밖 handoff 는 검사 세션에 경로로 넘기지 않는다.
- **검사 계기를 놓치지 않는다**: 턴 시작이 직전 기준점과 비교해, 완료된 엔진 Stop 으로 끝나지 않은 턴(Esc 중단·API 오류·정리 요청 중 이른 종료)의 단계 변경도 다음 Stop 에서 검사한다(첫 턴·브랜치 전환은 비교하지 않는다. 비교 조건은 아래 2차 재검증 수정). 소유에서 빠진 항목(아카이브·§ 이동·`branch:` 변경·삭제)은 완료 주장으로 검사하고, 소유 항목이 0개가 돼도 진행 중 판정을 거두고 반영한다.
- **차단 규칙**: 사용자 턴당 한 번 차단은 소유 여부와 무관한 사용자 턴 수로 센다(`stop_hook_active` 를 안 주는 Codex 포함). 같은 checkout 에 다른 활성 세션(최근 30분 안, 첫 검증 턴 시작 이후 활동한 세션만 — 아래 2차 재검증 수정)이 있으면 누가 바꿨는지 구분할 수 없으므로 그 턴의 단계 변경·주기 검사를 건너뛰고 알린다. 턴 시작에 이미 전달한 판정과 끝난 지 6시간 넘은 판정은 막지 않고 보고만 한다. 수거는 worker 가 죽은 뒤 결과 파일을 한 번 더 보고, worker 명령줄의 job id 까지 맞추며, 기록해 둔 runner 그룹은 시작 시각이 같을 때만 정리한다.
- **root 는 턴 안에서 고정**: dispatcher 는 SessionStart·UserPromptSubmit 에서만 세션 root 를 다시 고르고 고정한다(유효한 pin 이 있는 SessionStart `source=compact` 는 턴 도중 자동 압축이므로 고정을 옮기지 않는다). stamp·Stop 은 고정된 root 를 쓰므로 primary 세션이 턴 중간에 형제 worktree 로 `cd` 해도 Stop 이 turn-start 의 기준점을 찾는다. EnterWorktree 로 옮긴 세션은 다음 턴부터 새 checkout 을 쓴다. 고정은 `CLAUDE_PROJECT_DIR` 과 같은 저장소일 때만 받아들이고, 저장소 밖에서 시작한 Claude 세션(`CLAUDE_PROJECT_DIR` 이 git 이 아님)은 고정하지 않고 cwd 를 따른다(Codex 처럼 `CLAUDE_PROJECT_DIR` 이 없으면 고정을 계속 쓴다).
- **stamp**: 편집한 파일이 같은 저장소의 다른 worktree 에 있으면 그 checkout 기준으로 스탬프하고 그쪽 로컬 인덱스도 렌더한다. 본문이 같아도 frontmatter(`step`·`next_step`·`status` 등)가 HEAD 와 다르면 `touched` 를 갱신한다(`hash` 는 그대로, 바뀐 게 없으면 다시 쓰지 않는다).
- **브랜치 이름**: 같은 이름의 태그가 있어도 `refs/heads/` 전체 ref 로 읽어 소유 판정·기본 브랜치 침묵·유령 검사가 깨지지 않는다. `STATE_DEFAULT_BRANCH="origin/main"` 이면 로컬 `main` 도 기본 브랜치로 본다. 유령 검사는 `for-each-ref` 의 `%(ahead-behind:)` 한 번과 묶음 tree 읽기로 바꿔 미등재 브랜치 300개에서 약 12초 → 1초 미만이다(git 2.41 미만은 브랜치별 폴백).
- **알림 배치**: 지시문은 머리줄 바로 뒤에 온다. handoff 경로와 `#절` 은 자르지 않는다(300자 초과는 고정 안내). 예산이 모자라면 필드·발췌 → 보이는 항목 수 순으로 줄이고 `외 N개` 줄은 항상 남긴다(id 는 12개까지; 총량 상한은 아래 2차 재검증 수정). YAML 블록·null 표기(`>` `|` `""` `null` `~` 등)는 빈 값으로 보고 `check-state-wip-cap.sh` 가 경고한다. 저장소 밖 handoff 는 `(저장소 밖 경로 — 무시)` 로 표시하고 stat 하지 않는다. SessionStart 의 정리 요청 목록은 4줄로 줄여 알림이 5000바이트 한도 안에 들어오게 한다. Antigravity 는 알림 구간만 비교해 판정 블록이 있어도 알림을 두 번 싣지 않는다.
- **남은 한계**: 저장소 밖에서 시작한 세션은 고정이 없어 한 턴 안에 다른 저장소로 `cd` 하면 Stop 이 기준점을 찾지 못한다. codex 하드닝 키는 `codex sandbox`·`features list`·`mcp list` 로 확인했고 `codex exec` 한 판은 돌려 보지 않았다. Stop 훅이 30초를 넘겨 출력이 버려지면 그 판정의 차단·보고가 사라질 수 있다. PATH 에 상대 경로 항목이 있으면 저장소 cwd 기준으로 runner 를 찾는다(기존 git 호출과 같은 성질). Muse adapter 의 이벤트별 root 선택은 손대지 않았다.

#### 2차 재검증 수정

- **허용 범위**: 사용자 허용은 그 저장소의 등록된 checkout(메인·linked worktree·submodule)에만 적용되고, `.git` 파일이 가리키기만 하는 폴더·심볼릭 `.git`·`--separate-git-dir` 는 허용하지 않는다.
- **`allow --env NAME`**: 반복 가능하고 프로젝트의 `env` 목록을 통째로 바꾼다. `--env=` 는 비우고, 생략하면 기존 목록을 유지한다. `status` 가 `env=` 를 보인다.
- **env 허용 목록 확대**(claude runner): `ANTHROPIC_FOUNDRY_API_KEY`·`ANTHROPIC_FOUNDRY_RESOURCE`·`ANTHROPIC_FOUNDRY_BASE_URL`, `AWS_BEARER_TOKEN_BEDROCK`·`ANTHROPIC_BEDROCK_BASE_URL`·`AWS_CONFIG_FILE`·`AWS_SHARED_CREDENTIALS_FILE`, `ANTHROPIC_VERTEX_BASE_URL`·`VERTEX_REGION_*`, `ANTHROPIC_DEFAULT_*_MODEL`·`ANTHROPIC_SMALL_FAST_MODEL`, `CLAUDE_CODE_SKIP_BEDROCK_AUTH`·`CLAUDE_CODE_SKIP_VERTEX_AUTH`. 그 밖은 `--env` 가 필요하다.
- **codex MCP 이름 검사**: 켜진 MCP 서버 이름이 비었거나 제어 문자를 가지면 검사 세션을 띄우지 않고 `unclear` 로 기록한다(목록을 못 읽을 때와 같다).
- **턴 시작 비교 조건**: 직전 사용자 턴이 소유 브랜치에서 끝까지 돌고 막지 않은 엔진 Stop 으로 끝났으면(그 Stop 이 기준점이 없거나 브랜치가 바뀌어 비교를 못 했어도 같다) 턴 시작은 직전 기준점과 지금을 비교하지 않고 기준점만 옮긴다 — 턴 사이의 손 편집·`git pull`·더 이상 활성이 아닌 다른 세션의 단계 변경은 에이전트 탓으로 보지 않는다. 그 밖에는 비교한다: Stop 이 아예 돌지 못한 턴(Esc·API 오류·정리 요청 조기 종료), Stop 이 막고 이어진 진행이 중단됐을 때(Esc·API 오류), 또는 Stop 이 기본 브랜치·detached HEAD 에서 돌았을 때다. 후자에서는 턴 사이에 사용자가 바꾼 내용도 같이 비교된다(알려진 비용). 한계: 다른 플러그인의 Stop 훅(예: 종료 시 리뷰 게이트)이 막고 그 이어진 진행이 중단되면 그 사이 변경은 검사하지 않는다.
- **동시 세션 판정**: 같은 checkout 의 다른 세션은 최근 활동(그 세션의 턴 기준점 또는 transcript 파일이 쓰인 시각 중 늦은 것)이 최근 30분 안이고 이 세션의 첫 검증 턴 시작 이후일 때만 동시로 본다(기존 알림과 함께 검사 건너뜀). 그래서 30분이 넘는 긴 턴도 transcript 가 계속 쓰이는 한 동시로 남는다. 활동을 알 수 없는 세션(transcript 경로가 없는 0.10.1 이전 기준점·Antigravity adapter)이나 첫 턴 시각이 없는 상태는 예전처럼(30분 안의 활성 기준점이면 모두) 동시로 본다. Esc 뒤 `/clear` 로 "활성"이 남은 세션은, 첫 검증 턴이 그 마지막 활동보다 늦게 시작한 세션(보통 `/clear` 뒤의 새 세션)에는 더 이상 동시로 세지 않는다.
- **기본 브랜치·detached HEAD**: 순수 no-op 이 아니다. verify 상태 파일이 있으면 끝난 검사를 거두어 판정을 보고·전달하고, 풀린 항목의 미충족 판정은 (턴 시작에 이미 전달하지 않았다면) 한 번 막을 수 있다. 새 검사 시작과 기준점 비교는 하지 않는다.
- **허용 해제 기간**: `.staterc` 는 요청하는데 사용자가 허용하지 않은 동안 저장된 기준점을 초기화하므로, 다시 허용해도 꺼져 있던 기간을 가로질러 비교하지 않는다.
- **root pin**: SessionStart 는 턴 경계에서 root 를 다시 고정하되, 유효한 pin 이 있는 `source=compact` 는 예외다. 턴 도중 자동 compaction 이 pin 을 유지하므로 Stop 이 턴을 시작한 checkout 을 판정한다.
- **알림 상한**: 턴당 알림은 항상 3000바이트 이하다. `외 N개` 줄은 정확한 N 을 유지하고, 자리가 모자라면 id 를 더 적게 보여 `…` 로 끝낸다. 머리줄의 브랜치 이름은 200바이트로 자른다. 최후에는 항목 본문을 자른다(handoff 줄이 잘리는 것은 이 극단적인 경우뿐).
- **알려진 한계(의도적으로 고치지 않음)**: 같은 턴에 브랜치를 옮기면서(`git checkout -b` 새 브랜치, main 에 머지한 뒤 main 체크아웃) 한 완료 주장은 검사하지 않는다. 잡으려면 평범한 브랜치 전환에서도 오탐이 나기 때문이다.
- **알려진 한계(추가)**: `.staterc` 에서 `STATE_VERIFY` 를 껐다 켜도 기준점은 초기화되지 않는다(꺼져 있는 동안은 엔진이 돌지 않는다). `extensions.worktreeConfig` 로 `core.worktree` 가 `config.worktree` 에 있는 submodule 은 허용하지 않는다(안전한 쪽으로 거절).
