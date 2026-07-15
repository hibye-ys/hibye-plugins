# backend-ts

EUNHA TypeScript API의 비자명한 런타임 계약만 제공하는 로컬 플러그인.

## 정본

- 실제 코드와 테스트가 최우선 정본이다.
- 프로젝트 규칙은 `AGENTS.md`와 `apps/api/AGENTS.md`를 따른다.
- 스킬은 일반 TypeScript 지식을 반복하지 않고, 현재 EUNHA 구현에서 실수하기 쉬운 경계만 설명한다.
- 오래된 구현을 호환하는 alias, fallback, legacy skill은 두지 않는다.

## Skill 10종

- `agent-loop-runtime`
- `context-runtime`
- `agent-definition`
- `subagent-runtime`
- `provider-runtime`
- `tool-runtime`
- `mcp-runtime`
- `http-contract`
- `stream-contract`
- `backend-audit`

각 스킬은 description trigger로 lazy load한다. `@import`로 본문을 강제 주입하지 않는다.

## Named agent 4종

- `architecture_reviewer` — 구조·transaction·write path 리뷰
- `security_manager` — 인증·입력·외부 호출 보안 리뷰
- `test_manager` — focused test와 backend audit 조율
- `settings_hooks_maintainer` — shared-source 링크·manifest·hook 생성물 유지

Claude의 두 review agent는 `Read, Grep, Glob, Bash`를 허용한다. Bash 기반 진단은 가능하지만 파일 수정 금지는 agent 본문 규칙으로 유지한다. Codex의 동일 review agent는 `sandbox_mode = "read-only"`를 사용하므로 두 도구의 강제 수준은 의도적으로 다르다.

## 세션 훅

`hooks/session-start-profiler.mjs`는 EUNHA형 API 구조를 감지한 세션에 API 경로와 정본 규칙만 주입한다. 훅은 스킬을 숨기거나 등록하는 로더가 아니다.

## Claude와 Codex 공유

두 도구는 복사본이 아니라 이 플러그인 소스를 가리키는 심볼릭 링크를 사용한다.

- Claude 활성화 범위: EUNHA `.claude/settings.json`의 project scope만 사용하고 user scope는 금지
- Codex 프로젝트 링크: `.codex/skills/backend-ts -> <plugin>/skills`
- Claude 캐시 링크: `~/.claude/plugins/cache/hibye-plugins/backend-ts/<version> -> <plugin>`
- Claude skills 링크: `~/.claude/plugins/cache/hibye-plugins/backend-ts/skills -> <plugin>/skills`

링크가 깨지면 마켓플레이스의 `scripts/link-cache.sh`를 실행하고 새 세션을 시작한다.

## 검증

- `bash scripts/acceptance-check.sh --project /path/to/EUNHA-main --tools claude,codex`
- `node skills/backend-audit/scripts/audit.mjs --project /path/to/EUNHA-main`
- 전체 게이트: 위 명령에 `--full` 추가
