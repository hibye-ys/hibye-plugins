# hibye-plugins

Claude Code·Codex·Muse Code용 개인 에이전트 플러그인 원본 저장소.

## Plugins

| 이름 | 목적 |
|---|---|
| `backend-ts` | EUNHA TypeScript API의 agent, context, provider, tool, MCP, HTTP, SSE 런타임 스킬 10개와 검증 하네스 |
| `state-ledger` | 전역 STATE 원장 lifecycle; 프로젝트 context와 독립된 native snapshot |
| `project-context` | 프로젝트 opt-in에 따라 primary 공유 메모리와 현재 checkout intent를 host별로 연결 |
| `spec-plan` | 간결한 스펙·구현 계획, 모델 배정, 순차·병렬 실행과 작업 인계 (Claude·Codex·Muse 전역 설치) |
| `agent-results` | 실제 실행 결과·하네스 버전 보존, 근거 있는 개선 권고와 사용자 지시 후 개선 (Codex·Claude 공통) |
| `muse-delegate` | muse를 언급할 때만 Orca로 muse 워커에 구현을 위임하고 검증 (Claude·Codex 전역 설치) |

## spec-plan 전역 설치

원본은 `plugins/spec-plan/skills/spec-plan/`이다. Claude·Codex에 이 로컬
`hibye-plugins` marketplace가 등록된 환경에서 저장소 루트 기준으로 실행한다.

```bash
codex plugin add spec-plan@hibye-plugins
claude plugin install spec-plan@hibye-plugins --scope user
muse plugins install "$PWD/plugins/spec-plan" --scope user
```

Muse는 Claude 호환 manifest를 읽으며 별도 Muse용 스킬 복사본을 관리하지 않는다.
세 도구 모두 원본에서 생성된 전역 설치 캐시를 사용한다. 기존 standalone
`~/.codex/skills/spec-plan`·`~/.claude/skills/spec-plan`과 중복 설치하지 않는다.
`spec-plan`은 SessionStart의 자동 source link 대상에서 제외한다. 원본 변경 후
아래 명령 하나로 공통 설치 버전을 갱신하고 세 도구를 업데이트한다.

```bash
python3 scripts/sync-spec-plan.py
python3 scripts/sync-spec-plan.py --check  # 수정 없이 현재 설치 상태만 확인
```

Python 3와 세 CLI가 설치된 환경에서 사용한다. 공통 build 버전은 이 저장소의
스크립트가 직접 생성하므로 Codex 번들 helper에 의존하지 않는다.
버전·활성화·전체 배포 payload(manifest·hook·runtime·skills·참조 설정) 내용·source link 부재가 모두 확인돼야 성공한다.
도구별 설치는 순차 실행이므로 중간 실패 시 일부만 갱신될 수 있으며, 이 경우
실패를 알리고 중단한다. 원인을 해결한 뒤 같은 명령을 다시 실행한다.
설치·갱신 뒤 새 세션에서 사용한다.

## 공통 하네스 설치·업데이트

공통 하네스 `state-ledger`·`project-context`·`spec-plan`·`agent-results`는 Codex와 Claude 모두 설치 스냅샷을
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
선택하지 않은 catalog entry는 원래 필드를 보존하고, 기존 상대경로는 개발 원본으로 연결해
그 plugin의 기존 개발 흐름을 유지한다. 공통 하네스 세 plugin에는 이 연결을 만들지 않는다.

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
python3 scripts/sync-plugins.py --plugin project-context --host codex --host claude --check
```

명시 선택 모드에서는 필요할 때 `--build-marker`로 선택 plugin의 양 manifest·Muse manifest·
Claude 원본 catalog version을 함께 갱신한다. `--harness`에는 별도 plugin/host 선택을 섞지 않는다.

`link-cache.sh`와 `--codex-dev-links`는 위 세 하네스를 개발 원본 링크로 바꾸지 않는다.
다른 plugin의 기존 개발 링크 흐름은 별도이며, 배포 경계 회귀는 다음으로 확인한다.

```bash
python3 scripts/test-project-context-distribution.py
python3 scripts/test-spec-plan-sync.py
python3 scripts/test-plugin-sync-recovery.py
python3 scripts/test-plugin-publication.py
```

## 프로젝트 opt-in

먼저 프로젝트의 실제 메모리 index와 intent 디렉터리를 준비한다. setup은 문서 내용을 만들거나
덮어쓰지 않는다. 대상 프로젝트만 선택하며 전역 설정·전역 hooks·설치 캐시를 변경하지 않는다.

```bash
bash scripts/setup-project.sh /path/to/project --plugin project-context --tools codex,claude --preview
bash scripts/setup-project.sh /path/to/project --plugin project-context --tools codex,claude
bash scripts/setup-project.sh /path/to/project --plugin project-context --tools codex,claude --check
```

기본 opt-in은 `.project-context.json`의 memory=`docs/memory/MEMORY.md`, intent=`intent/`다.
`--memory-directory`, `--memory-index`, `--intent-directory`, `--no-memory`, `--no-intent`로
선택한다. 기존 opt-in이 있고 새 선택을 주지 않으면 그대로 재사용한다. 하나 이상 활성화해야 한다.
v1 Claude native memory는 directory 안의 `MEMORY.md`만 지원한다. 기본 setup이나 Claude를 포함한
선택에서 custom index는 `CLAUDE_NATIVE_MEMORY_UNSUPPORTED`로 쓰기 전에 실패한다.
custom index는 `--tools codex`를 명시한 setup에서 지원한다. 자동 index 복사본은 만들지 않는다.
memory를 켠 프로젝트에서만 Codex `use_memories`·`generate_memories`를 false로 두고,
Claude `autoMemoryDirectory`는 Git primary checkout의 절대 경로로 맞춘다. linked worktree의
intent는 현재 checkout에서 읽는다. linked setup의 memory 설정은 primary opt-in과 같아야 한다.
primary opt-in이 없거나 memory를 사용하지 않으면 `PRIMARY_MEMORY_CONFIG_REQUIRED`,
linked memory directory/index가 다르면 `PRIMARY_MEMORY_CONFIG_MISMATCH`로 쓰기 전에 실패한다.
linked 설정을 primary에 붙여 새 native 경로를 만들거나 다른 사용자 설정으로 임의 교체하지 않는다.
native plugin hooks가 runtime을 제공하며 project에 이를 복제하지 않는다.

기존 은하 소유 context 등록은 코드에 고정한 완전한 canonical command 문자열만 제거한다.
여기에는 원본 EUNHA의 정확한 Git 환경 정리 wrapper와 단일 Node context/intent 명령만 포함한다.
사용자 prefix/suffix·조건·파이프·새 명령 치환을 가진 변형은 자동으로 추출하거나 재작성하지 않고
예약 진입점 참조 실패로 남긴다.
같은 이벤트의 사용자 hooks, knip, MCP, 다른 JSON/TOML 값과 비소유 TOML 주석은 보존한다.
예전 경로를 출력하거나 다른 스크립트에 인수로 넘기는 hook은 임의로 제거하지 않는다.
project SessionStart에서 `session-start-context.mjs`, `intent-ledger.mjs`, `project-context.cjs`,
`project-context.mjs`, `project-context-runner.mjs`는 native context용 예약 진입점이다.
자동 이관 대상 이외의 참조가 남으면 실행·echo·인수·check 여부와 무관하게
`PROJECT_CONTEXT_RESERVED_REGISTRATION`으로 쓰기 전에 실패한다. 사용자 hook은 그대로 보존하므로
해당 등록을 검토한 뒤 명시적으로 정리해야 한다. 다른 일반 사용자 hook은 허용한다.
JSON/TOML 오류·미지원 레이아웃·경로 탈출·symlink는 쓰기 전에 실패하며, 쓰기 실패는
이미 쓴 파일을 되돌리고 완료로 보고하지 않는다. 일반/linked Git checkout을 지원하며
bare·non-Git·`--separate-git-dir` 및 inline/dotted `memories` TOML 레이아웃은 안전 실패한다.
필요하면 먼저 명시적인 `[memories]` table로 정리한다. `--check`는 변경이 필요하면 exit 1이다.

## muse-delegate 전역 설치

원본은 `plugins/muse-delegate/skills/muse-delegate/`(SKILL.md와 `scripts/muse-run.sh`·`muse-settle.sh`·`muse-resume.sh`)이다.
사용자가 muse를 언급할 때만 로드되도록 description에 트리거를 둔다. Muse 자신에게는 설치하지 않는다.

```bash
claude plugin install muse-delegate@hibye-plugins --scope user
codex plugin add muse-delegate@hibye-plugins
```

Claude 캐시는 SessionStart의 `link-cache.sh`가 원본으로 연결하므로 수정이 바로 반영된다.
Codex는 설치 사본을 쓰므로 원본 수정 후 두 manifest의 `version`을 올리고 `codex plugin add`를 다시 실행한다.
스크립트 수정 후에는 `bash plugins/muse-delegate/tests/run-tests.sh`(가짜 orca로 실패 경로 회귀 검증)를 실행한다.

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

- `scripts/link-cache.sh`: 기존 플러그인의 개발용 Claude cache 연결 (native snapshot 세 플러그인은 제외).
- `scripts/sync-spec-plan.py`: spec-plan의 세 전역 설치본을 함께 갱신하고 내용 일치 검증.
- `scripts/setup-project.sh`: 기존 asset 배선 및 `--plugin project-context`의 target-only opt-in setup.
- `scripts/sync-plugins.py`: 명시한 plugin/host만 native 설치하고 전체 payload·version·activation을 검증.
- `scripts/setup-project-context.py`: preview/check와 JSON/TOML 비소유 설정 보존이 있는 프로젝트 setup.
- `scripts/merge-project-hooks.py`: 기존 asset setup의 같은 이벤트 배열을 보존하며 hook 등록을 합친다.
