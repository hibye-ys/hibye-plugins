# state-ledger — live coordination ledger

멀티 에이전트·멀티 툴(Claude Code / Codex / Antigravity / Muse / opencode) 프로젝트의 작업 상태 원장.
EUNHA 에서 실운영으로 검증된 시스템의 일반화판 — EUNHA 는 테스트베드이며 정본 스키마는 이 README 다.

## 철학

- **STATE = 공유 상태판, 작업 기록 장치가 아니다** — 지금 누가 무엇을 하고, 무엇이 남았고, 무엇을 결정해야 하는지만 여러 에이전트가 공유한다. 상태가 바뀌면 그 줄과 `## 현재`를 바꿔 쓰고 덧붙이지 않는다.
- **작업 기록은 커밋 메시지, 완료 사실은 git log 가 정본** — 커밋 메시지에 `[id=<id>]`, archive 시 `archive [id=...]`. STATE 는 완료 로그·작업 경과를 누적하지 않는다.
- **인덱스는 싸고, 상세는 lazy** — 세션 시작에 주입되는 것은 1줄/항목 인덱스뿐. 작업을 잡을 때만 `docs/state/<area>/<id>.md` 를 읽는다.
- **게이트는 전부 warn-only** — 막지 않고 알린다. warn 은 0 으로 수렴시켜야 채널이 살아있다 (방치하면 배경소음).
- **턴 귀속은 기준점 이후 커밋으로 판정** — UserPromptSubmit 때 repo 밖에 HEAD·dirty hash·STATE 의미 digest를 저장하고, Stop에서 기준점 이후 작업 파일을 바꾼 커밋의 메시지에 유효 `[id=<id>]`가 있는지 본다. 미커밋 작업은 커밋될 때 판정한다. STATE 갱신을 매 턴 요구하지 않는다.
- **goal-run과 무관한 전역 lifecycle** — STATE는 live ownership만 담당한다. goal TRACK·item branch 같은 파이프라인 규칙은 해당 스킬이 소유한다.

## 스키마 (대상 프로젝트 AGENTS.md 에 붙여 넣는 작성규칙)

```
- `STATE.md`는 공유 상태판이다. live ownership·진행·미래·미해결 결정과 WHY만 담는다. 남은 일·소유·결정이 바뀌면 그 줄과 `## 현재`를 바꿔 쓰고 덧붙이지 않는다. 작업 기록(완료 사실·경과)은 커밋 메시지 `[id=<id>]`가 맡으며 git log가 정본이다.
- 카테고리 4개와 WIP cap: §1 활성 ≤6 (owner 필수) · §2 다음 ≤6 · §3 미래 placeholder ≤5 · §4 미해결 결정 ≤8. cap 초과는 분류 실패 신호 — 가장 오래 움직이지 않은 항목을 archive한다.
- 항목 = 1줄 인덱스: `- [<id>] <제목> — <짧은 상태·조건>` (≤200자). 상세 정본 = docs/state/<area>/<id>.md.
  frontmatter: id·area·owner·branch·touched·hash (+depends/blocks/handoff/expires)
  본문: ## 현재 (필수, ≤4KB — 요약·남은 것·WHY, 바꿔 쓰기) + ## 원장 (선택 — WHY·실측 기록만, 완료 서사는 커밋 메시지로). detail 전체 ≤8KB.
- `id`는 3–12자 stable identifier다. commit message에서 `[id=<id>]`로 참조한다. id 없는 줄은 §3 placeholder만 허용한다.
- meta는 detail frontmatter가 정본 — post-edit hook이 touched·hash만 자동 스탬프한다. owner·branch는 수동 claim이다.
- SessionStart는 원칙 한 줄과 인덱스만 주입하고 기준점이 없을 때만 생성한다. UserPromptSubmit은 턴마다 repo 밖 세션별 기준점(HEAD·작업 파일 status/hash/mtime·STATE 의미 digest)을 저장한다.
- `expires`가 지난 항목은 갱신하거나 archive한다.
- archive = 인덱스 줄 + detail 파일 삭제, commit message에 `archive [id=...]`.
- Stop은 기준점 이후 작업 파일을 바꾼 커밋의 메시지에 유효 `[id=<id>]`(기준점·현재 STATE 인덱스의 id, archive된 id 포함)가 있는지 본다. 한 경로를 바꾼 커밋 중 하나라도 id가 없으면 debt로 남기고, 이후 같은 경로를 바꾸는 `[id=]` 커밋 또는 대응 영역 STATE의 의미 있는 committed 차분(상태가 실제로 바뀐 경우)이 해제한다. 미커밋 작업은 debt가 아니며 커밋될 때 판정한다. 이번 턴에 바뀐 detail의 `## 현재`가 기준점 HEAD보다 1KB 넘게 늘면 덧붙임으로 경고한다. 같은 worktree의 다른 활성 세션이 감지되면 새 귀속 판정을 보류한다.
- 정합은 warn-only 세 겹: 인덱스↔detail 존재·자수·크기(`## 현재` ≤4KB·detail ≤8KB)·frontmatter(id·area·owner·branch·touched·hash·expires·§1 유효 owner) = check-state-wip-cap.sh, 브랜치 포인터·유령 브랜치 = check-state-branch-sync.sh, 실제 변경 id와 일치하는 [id=]·archive 커밋 규약 = commit-msg 훅. 앞 둘은 SessionStart 주입에 표면화된다.
- 멀티 에이전트 작업은 branch·worktree를 분리하고 같은 파일을 같은 worktree에서 동시에 편집하지 않는다.
```

## 구성

| 파일 | 역할 |
| --- | --- |
| `scripts/check-state-wip-cap.sh` | WIP cap·섹션 존재·줄 200자·인덱스 4KB·인덱스↔detail 양방향·id 3–12자·문자집합·§1·§2·§4 id 필수·frontmatter(id/area/owner/branch/touched/hash/expires/§1 owner)·`## 현재` 필수. 크기 경고 `## 현재` 4KB·detail 8KB는 strict 모드에서도 구조 실패로 세지 않음 |
| `scripts/check-state-branch-sync.sh` | §1·§2 branch 포인터 소멸/기머지 (빈 예약 브랜치 오탐 제외) + 유령 브랜치 (frontmatter `branch:` 만 등재로 인정, 제외 glob = `STATE_BRANCH_EXCLUDE`) |
| `scripts/hooks/session-start-state-inject.sh` | SessionStart — 원칙 한 줄 + 인덱스 전문 + 위 두 체커의 warn 주입 + 기준점이 없을 때만 생성 |
| `scripts/hooks/state-config.mjs` | `.staterc` 공통 파서 — 인덱스 상대경로·정규화·repo 경계·symlink·개수와 설정 크기를 읽기 전에 검증 |
| `scripts/hooks/turn-start-state-snapshot.sh` | UserPromptSubmit/chat.message — repo 밖 세션별 턴 기준점 저장, 동시 세션 경고 |
| `scripts/hooks/state-turn-baseline.mjs` | HEAD·dirty content·STATE 의미 digest 차분, 기준점 이후 커밋의 `[id=]` 태그·STATE committed 차분 순서·debt·`## 현재` 덧붙임·동시 세션 판정 엔진 |
| `scripts/hooks/post-edit-state-stamp.sh` | PostToolUse — detail 본문 hash 변경 시 touched·hash 스탬프 (다중 파일 apply_patch 지원, owner·branch 불변, 프로젝트 밖 경로 거부) |
| `scripts/hooks/stop-state-reminder.sh` | Stop — 엔진 결과를 표시만 한다: id 없는 커밋 debt, `## 현재` 덧붙임, 동시 세션 보류, STATE가 바뀐 턴의 구조 재검 |
| `scripts/hooks/commit-msg-state-check.sh` | commit-msg — 인덱스/detail에서 실제 바뀐 모든 id별 `[id=<id>]` / detail 삭제 파일별 `archive [id=<id>]` 검사 |
| `hooks/claude-hooks.json` + `global-state-hook.sh` | Claude Code user-scope plugin lifecycle. STATE 미사용 repo는 no-op, 이행 중 실제 로컬 command만 구조적으로 감지해 이벤트별 중복 억제 |
| `hooks/hooks.json` | Codex plugin-bundled global lifecycle. `$PLUGIN_ROOT`의 설치 버전을 실행하며 사용자 `hooks.json` 복사본을 만들지 않음 |
| `hooks/antigravity-hooks.json` + `antigravity-*.sh` | Antigravity(Google Antigravity / AGY) lifecycle. PreInvocation·PostToolUse·Stop JSON 계약 변환 및 안전한 1회성 stop reminder |
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

`STATE_WORK_INCLUDE_RE`와 `STATE_WORK_EXCLUDE_RE`는 JavaScript `RegExp` 문법이다. include에 맞고 exclude에 맞지 않는 경로만 턴 작업으로 본다. 문서형 prompt, 이미지·폰트·SVG, hook/config 등 운영 변경을 모두 포함해야 한다. 여러 영역의 작업이 한 턴에 섞이면 root STATE가 대응 영역이다.

알려진 한계: 커밋 태그 검사는 id가 STATE 인덱스에 있는지만 확인하고, 그 id가 커밋 내용과 관련 있는지까지 이해하지는 못한다. 의미 digest도 metadata-only 눈속임만 막는다. 최종 의미 관련성은 리뷰 대상이다. 턴 중 다른 브랜치를 체크아웃하거나 rebase·pull로 남의 커밋이 범위에 들어오면 그 커밋도 판정 대상이 된다(머지 커밋 자체는 판정하지 않는다). opencode는 SessionStart를 instructions 방식으로 대신하므로 정합 warn이 세션 시작에 표면화되지 않는다.

## 설치

Codex와 Claude Code에는 `state-ledger@hibye-plugins`를 user scope로 한 번 설치한다. 두 도구 모두 plugin-bundled hooks를 사용하며 프로젝트나 사용자 `hooks.json`에 lifecycle command를 복사하지 않는다. Codex는 `hooks/hooks.json`의 `$PLUGIN_ROOT`, Claude는 `hooks/claude-hooks.json`의 `$CLAUDE_PLUGIN_ROOT`로 설치 버전을 실행한다. Antigravity는 `~/.gemini/config/hooks.json` 또는 프로젝트 `.agents/hooks.json`에 `hooks/antigravity-hooks.json` 스니펫을 병합해 `antigravity-pre-invocation.sh`, `antigravity-post-tool-use.sh`, `antigravity-stop.sh`를 실행한다. Orca처럼 계정별 `CODEX_HOME`을 쓰는 환경은 각 홈에서 플러그인을 별도로 활성화한다. 프로젝트에는 `STATE.md`·`docs/state/**`·`.staterc`와, Git/opencode를 쓰는 경우 얇은 `scripts/hooks/state-ledger-runner.mjs` adapter만 둔다. STATE lifecycle·checker·baseline 구현은 복사하지 않는다. `STATE.md`와 `.staterc`가 모두 없는 저장소에서는 전역 훅이 조용히 no-op 한다.

Codex 업데이트는 `.codex-plugin/plugin.json` cachebuster를 갱신한 뒤 `codex plugin add state-ledger@hibye-plugins`로 재설치한다. 운영 설치 캐시는 소스 링크로 바꾸지 않는다. `scripts/link-cache.sh`는 기본적으로 Claude 및 Antigravity 개발 캐시만 연결하며, Codex 소스 링크는 격리된 로컬 개발에서 `--codex-dev-links`를 명시한 경우에만 만든다.

`/state-ledger:setup-state`는 프로젝트 데이터·작성 규칙·필요한 adapter만 온보딩한다. runner는 `STATE_LEDGER_PLUGIN_ROOT` 명시 override → Codex의 enabled plugin catalog와 정확한 version cache → Claude의 enabled user install 순으로 정본을 찾고 plugin name/version·`state-ledger-contract.json` v6·대상 파일을 검증한다. Codex CLI를 실행할 수 없거나 제한 시간 안에 응답하지 않으면 v6 계약을 가진 물리 cache directory로만 fallback하며, CLI가 정상 응답해 disabled 상태를 보고한 경우 cache를 임의 활성화하지 않는다. lifecycle stdin과 child stdout/stderr는 runner가 명시적으로 전달하며 설치본을 못 찾거나 실행에 실패해도 경고 후 0으로 끝난다.

`commit-msg`는 agent lifecycle이 아니라 Git hook이므로 기존 hook manager에서 `if [ ! -f scripts/hooks/state-ledger-runner.mjs ]; then :; elif command -v node >/dev/null 2>&1; then node scripts/hooks/state-ledger-runner.mjs commit-msg "$1"; else echo "WARN: node가 PATH에 없어 STATE commit-msg 검사를 건너뜁니다." >&2; fi`를 호출한다. shared Git hooks를 쓰는 이전 checkout에 runner가 없거나 Git GUI PATH에 node가 없어도 commit을 막지 않기 위한 guard다. lint-staged에서 구조 검사를 유지하려면 `node scripts/hooks/state-ledger-runner.mjs check-wip`을 사용한다. opencode는 runner와 `templates/wiring/opencode-harness.ts`를 함께 복사하고 `opencode.json` instructions에 인덱스를 지정한다. 기존 `.codex/hooks.json`·`.codex/config.toml`·`.claude/settings*.json`에 복사형 STATE lifecycle이 남아 있으면 제거한다. 이행 중인 브랜치에서는 전역 dispatcher가 JSON/TOML의 실제 로컬 command를 감지해 중복 실행을 피하며, 주석이나 단순 문자열은 로컬 훅으로 취급하지 않는다.

정본 회귀 검사는 `node --test scripts/hooks/state-hooks.test.mjs templates/wiring/state-ledger-runner.test.mjs`로 실행한다.

## 검증된 설계 근거 (2026-07-28 교차 리뷰 라운드)

- stamp 가 owner·branch 를 덮어쓰지 않는 이유: 스치는 편집이 소유권을 바꾸는 사고 방지 — 소유는 claim, 기록은 touched·hash.
- hash 를 게이트가 재검산하는 이유: 훅을 우회한 편집(외부 편집기·heredoc)을 커밋 전에 감지.
- 유령 브랜치를 frontmatter 로만 판정하는 이유: 본문 서사의 substring 매치는 경고를 조용히 삼킨다.
- 작업 기록을 커밋 메시지로 옮긴 이유 (0.4.0): 0.3.x는 코드를 바꾼 턴마다 대응 영역 STATE의 의미 있는 차분으로만 debt를 풀었다. 에이전트는 매 턴 detail에 결과 문단을 덧붙여 debt를 해제했고 `## 현재`가 단계별 경과 기록으로 불어나 detail이 14–16KB까지 찼다(EUNHA 실측: tprune 16KB·perfmon 14KB). "완료 로그를 누적하지 않는다"는 철학과 장치가 모순됐다.
- 미커밋 작업을 판정하지 않는 이유: 같은 변경은 커밋될 때 태그로 판정된다. dirty 작업에 dirty STATE 갱신을 요구하면 기록 덧붙이기만 강요한다. 0.3.x 스냅샷에 남은 working·legacy debt는 평가 때 버린다.
- 태그 없는 committed 작업에 committed STATE만 인정하는 이유: 이미 커밋된 구현을 뒤늦은 미커밋 STATE가 덮었다고 오판하지 않게 한다. 다만 이 경고는 debt가 실제로 남을 때만 낸다.
- 머지 커밋을 판정하지 않는 이유: 머지된 쪽 커밋은 범위에 함께 들어와 따로 판정되거나 이전 턴에 이미 판정됐고, 기본 머지 메시지에는 id가 없다.
- 크기 cap을 strict 구조 실패로 세지 않는 이유: strict 검사는 STATE 차분으로 debt를 풀 수 있는지 가르는 구조 판정이다. 크기 초과까지 실패로 치면 큰 detail이 있는 영역에서는 상태가 실제로 바뀌어도 debt가 풀리지 않는다.
- `## 현재` 덧붙임을 기준점 HEAD와 비교하는 이유: 커밋하지 않고 여러 턴에 걸쳐 조금씩 덧붙여도 누적량이 보인다. 새 detail은 생성이므로 덧붙임으로 보지 않고 4KB cap만 적용한다.
- 동시 세션에서 판정을 보류하는 이유: 같은 worktree의 파일 mtime과 HEAD만으로 어느 세션이 변경했는지 확정할 수 없다.
- Codex CLI 는 Claude 호환 훅 스키마(`hookSpecificOutput`·`additionalContext`·`stop_hook_active`)를 내장한다 — 바이너리 실측 확인. 같은 스크립트가 두 도구에서 그대로 동작한다.
