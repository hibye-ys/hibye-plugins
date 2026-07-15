# scripts

- `acceptance-check.sh`: 10개 스킬, 4개 named agent, UI 메타데이터, 매니페스트, 생성물과 선택적 프로젝트 배선 정합성 검사.
- `validate-metadata.mjs`: 의존성 없이 SKILL frontmatter, `openai.yaml`, Claude/Codex manifest 구조 검사.
- `generate-agents-md.sh`: `skills/*/SKILL.md`에서 Codex용 `AGENTS.md` 생성.
- `audit-all.sh`: `backend-audit`의 결정론적 API 검증 실행기.
- `gen-subagents.mjs`: Codex TOML 정본에서 Claude/OpenCode subagent 생성하고 제거된 agent 산출물 정리.
- `gen-hooks.mjs`: SessionStart 훅의 도구별 설치 아티팩트 생성.
