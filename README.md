# hibye-plugins

Claude Code·Codex·Muse Code용 개인 에이전트 플러그인 원본 저장소.

## Plugins

| 이름 | 목적 |
|---|---|
| `backend-ts` | EUNHA TypeScript API의 agent, context, provider, tool, MCP, HTTP, SSE 런타임 스킬 10개와 검증 하네스 |
| `agent-results` | 실제 실행 결과·하네스 버전 보존, 근거 있는 개선 권고와 사용자 지시 후 개선 (Codex·Claude 공통) |
| `muse-delegate` | muse를 언급할 때만 Orca 또는 Orca 없는 headless `muse exec`(`muse-exec.sh`)로 muse 워커에 구현을 위임하고 검증 (Claude·Codex 전역 설치) |
| `verification-setup` | 진입점 기준으로 꼭 필요한 테스트만 쓰고, 테스트 지도·대조로 빠짐과 넘침을 보이며, 빌드 도구의 패키지 그래프로 관련 테스트만 다시 돌리는 문장 스킬 (Claude·Codex 전역 설치) |
| `orch` | Claude 모델·effort 배정 원칙 `claude-models`와 역할 기반 최상위 관리 세션 `lead`(구현·검증 하위 세션 배분). 수동 호출 `/orch:lead`·`/orch:claude-models` (Claude 전용) |
| `work-context` | 계획 폴더(스펙·계획·주입 파일·진행 표)로 목표·지시·진행을 이어 가고, 세션 시작·압축 뒤·주입 파일이나 진행 표 머리가 바뀐 직후 전체를, 그 사이 턴에는 목표 한 줄과 체크리스트를 주입. 옛 하네스 셋을 대신한다 (Claude·Codex·Muse) |

## 공통 하네스 설치·업데이트

공통 하네스 `work-context`·`agent-results`는 Codex와 Claude 모두 설치 스냅샷을
실행한다. macOS/Linux의 Python **3.11 이상**과 두 native CLI가 필요하며, Codex에는 로컬 `hibye-plugins`
marketplace를 먼저 등록한다. 이 저장소에서 다음 명령 하나로 두 호스트를 함께 갱신한다.

```bash
python3 scripts/sync-plugins.py --harness
```

설치 전 확인과 설치 후 진단은 같은 명령에 읽기 전용 옵션을 붙인다.

```bash
python3 scripts/sync-plugins.py --harness --preview
python3 scripts/sync-plugins.py --harness --check
```

이 명령은 프로젝트 setup을 다시 실행하지 않으며 제거한 backend-ts·Playwright·Tailwind를
설치하지 않는다. 기존 프로젝트의 memory·intent·STATE 데이터도 복사하거나 덮어쓰지 않는다.
코드를 갱신한 뒤에는 새 세션에서 사용한다. 이미 열린 세션까지 새 코드로 전환됐다고 보지 않는다.
현재 Codex CLI는 비활성 설치를 그대로 갱신하는 옵션이 없어, 선택한 Codex 하네스가 꺼져 있으면
updater는 쓰기 전에 중단하고 해당 이름을 알린다. 업데이트를 이유로 임의로 켜지 않는다.

Claude는 local-path marketplace의 상대경로 plugin을 개발 원본에서 직접 로드한다.
따라서 캐시 `installPath`의 파일이 같다는 검사만으로 설치본 실행을 보장할 수 없다.
updater는 선택한 payload를 고정된 로컬 Git 배포본으로 만들고, 선택 entry만 그 배포본을
가리키는 전용 배포 폴더의 `.claude-plugin/marketplace.json`을 생성한다. 이 폴더는 유저 데이터에
두는 머신별 생성물이며 Git에 넣지 않는다. 정식 marketplace CLI로 같은 `hibye-plugins` ID를 이 catalog에
연결하고 목록을 새로 읽은 뒤, native 설치·업데이트 CLI로 설치 캐시를 갱신한다.
개발 원본을 편집해도 다음 명시적 업데이트 전까지 그 배포본은 바뀌지 않는다.
Claude native CLI가 만드는 shallow clone의 `.git`은 설치 메타데이터로 검증한다. 캐시의 HEAD·origin이
고정 배포본과 같아야 하며 전체 payload의 바이트·실행 모드와 로컬 Git blob을 대조한다. 외부 object store,
promisor·실행형 Git 설정·활성 Git hook·symlink는 거부한다. 소스와 배포 payload의 `.git` 금지는 유지한다.
Claude의 목록 조회에는 `--json`을 사용하고 marketplace·plugin 설치/갱신에는 해당 CLI의 native 옵션만 쓴다.
선택하지 않은 catalog entry는 원래 필드를 보존하고, 기존 상대경로는 개발 원본으로 연결해
그 plugin의 기존 개발 흐름을 유지한다. 공통 하네스 두 plugin에는 이 연결을 만들지 않는다.

`--check`는 실제 marketplace 배포 source, 선택 entry의 고정 Git 경로·revision, 유효한 기존
설치 scope, 전체 설치 파일과 원본의 동일성을 함께 확인한다. 개발 원본을 실행하는 등록이나
source link, payload 누락·변조를 성공으로 처리하지 않는다. `--preview`·`--check`는 배포본·
catalog·버전을 쓰거나 설치하지 않는다. 두 호스트는 순서대로 갱신하므로 중간 실패 시 일부만
갱신됐을 수 있다. 오류를 해결하고 같은 명령을 다시 실행하며 부분 반영을 완료로 보고하지 않는다.

버전 파일 묶음과 개발 source 연결은 복구 기록을 남겨 갱신한다. 쓰기 도중 중단되면 다음 업데이트가
미완료 기록부터 복구한다. 완성한 임시 파일만 교체하고, publication은 내용·Git 기록·읽기 전용 권한을
검증한 뒤 공개한다. 이전 실행이 봉인 전에 남긴 publication도 내용과 Git 기록이 맞을 때만 봉인을
완료한다. 동시 updater는 쓰기를 조정하며, 기록과 다른 외부 편집은 덮어쓰지 않고 중단한다.
`--preview`·`--check`는 복구를 위해서도 파일을 수정하지 않는다.

같은 version의 설치 캐시와 실제 payload 또는 배포 출처가 달라지면 `--harness`가 필요한 공통 build version을
갱신해 두 호스트에 반영한다. 변경 없는 재실행에서 불필요하게 version을 올리지 않는다.
선택 범위를 직접 지정하는 기존 명령도 유지한다.

```bash
python3 scripts/sync-plugins.py --plugin work-context --host codex --host claude --check
```

명시 선택 모드에서는 필요할 때 `--build-marker`로 선택 plugin의 양 manifest·Muse manifest·
Claude 원본 catalog version을 함께 갱신한다. `--harness`에는 별도 plugin/host 선택을 섞지 않는다.

`link-cache.sh`와 `--codex-dev-links`는 위 두 하네스를 개발 원본 링크로 바꾸지 않는다.
다른 plugin의 기존 개발 링크 흐름은 별도이며, 배포 경계 회귀는 다음으로 확인한다.

```bash
python3 scripts/test-plugin-sync-recovery.py
python3 scripts/test-plugin-publication.py
```

## muse-delegate 전역 설치

원본은 `plugins/muse-delegate/skills/muse-delegate/`(SKILL.md와 `scripts/muse-run.sh`·`muse-settle.sh`·`muse-resume.sh`·`muse-exec.sh`)이다.
`muse-exec.sh`는 Orca 없이 `muse exec --json`을 세션별 worktree(`<repo>/.muse/worktrees/`, 브랜치 `muse/session-<id>`)에서 돌려 한 줄 JSON을 낸다. `--session`으로 같은 세션·worktree에서 후속 지시를 잇고, 세션당 동시 실행은 잠금으로 막으며 timeout이면 프로세스를 종료한다.
사용자가 muse를 언급할 때만 로드되도록 description에 트리거를 둔다. Muse 자신에게는 설치하지 않는다.

```bash
claude plugin install muse-delegate@hibye-plugins --scope user
codex plugin add muse-delegate@hibye-plugins
```

Claude 캐시는 SessionStart의 `link-cache.sh`가 원본으로 연결하므로 수정이 바로 반영된다.
Codex는 설치 사본을 쓰므로 원본 수정 후 두 manifest의 `version`을 올리고 `codex plugin add`를 다시 실행한다.
스크립트 수정 후에는 `bash plugins/muse-delegate/tests/run-tests.sh`(가짜 orca·가짜 muse로 실패 경로 회귀 검증)를 실행한다.

## backend-ts 배선

```bash
bash scripts/setup-project.sh /path/to/EUNHA-main --plugin backend-ts --tools claude,codex
```

- Codex는 프로젝트 `.codex/skills/backend-ts`가 플러그인 `skills`를 직접 가리킨다.
- Claude Code는 `scripts/link-cache.sh`가 글로벌 플러그인 캐시를 같은 소스로 연결한다. 프로젝트 전용 plugin은 해당 프로젝트의 `.claude/settings.json`에서만 활성화한다.
- skill 복사본은 만들지 않는다. 소스 변경이 두 도구에 함께 반영된다.
- 스킬이나 hook 목록이 바뀐 뒤에는 새 세션을 시작한다.

## 검증

```bash
bash plugins/backend-ts/scripts/acceptance-check.sh --project /path/to/EUNHA-main --tools claude,codex
node plugins/backend-ts/skills/backend-audit/scripts/audit.mjs --project /path/to/EUNHA-main
```

전체 API 테스트와 knip까지 실행하려면 `--full`을 추가한다.

## Scripts

- `scripts/link-cache.sh`: 기존 플러그인의 개발용 Claude cache 연결 (native snapshot 두 플러그인은 제외).
- `scripts/setup-project.sh`: 기존 asset 배선.
- `scripts/sync-plugins.py`: 명시한 plugin/host만 native 설치하고 전체 payload·version·activation을 검증.
- `scripts/merge-project-hooks.py`: 기존 asset setup의 같은 이벤트 배열을 보존하며 hook 등록을 합친다.
