# hibye-plugins

Claude Code와 Codex가 같은 로컬 소스를 읽는 개인용 에이전트 플러그인 마켓플레이스.

## Plugins

| 이름 | 목적 |
|---|---|
| `backend-ts` | EUNHA TypeScript API의 agent, context, provider, tool, MCP, HTTP, SSE 런타임 스킬 10개와 검증 하네스 |
| `muse-delegate` | muse를 언급할 때만 Orca로 muse 워커에 구현을 위임하고 검증 (Claude·Codex 전역 설치) |

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

- `scripts/link-cache.sh`: Claude plugin cache를 marketplace source로 연결.
- `scripts/setup-project.sh`: 프로젝트에 skill, named agent, hook, command, AGENTS 참조를 배선.
