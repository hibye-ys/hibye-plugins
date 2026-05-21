> App backend-overview capsule. Source: harness build plans ..

# Subsystem 18 — Settings (harness)

## 목적 (1줄)

Claude Code harness의 `.claude/settings.json`. 훅 등록, 허용 도구, 환경 변수 등
harness 전역 설정.

## 파일

- `.claude/settings.json` — harness 설정 단일 파일

## 주요 섹션

| 섹션 | 역할 |
|---|---|
| `hooks` | PreToolUse/PostToolUse/Stop/SessionEnd 이벤트 훅 등록 |
| `env` | harness 환경 변수 주입 |
| `permissions` | 허용/금지 도구 목록 |
| `includeCoAuthoredBy` | git 커밋 메타 |
| `statusLine` | 상태바 표시 |

## 편집 원칙

- **절대 직접 편집 금지** → `update-config-harness` skill 6-step flow 적용
- **dedup**: 동일 command를 중복 등록하지 않기
- **pipe-test simulation**: hook 추가 전 stdin JSON payload로 실제 실행 테스트
- **merge-not-replace**: 기존 훅을 덮어쓰지 말고 append

## 담당 skill

`update-config-harness` — 이 파일을 건드리는 유일한 경로.
`settings-hooks-maintainer` — 훅 무결성 검증.

## 범위

- 기본 permissions allow / deny 정의
- `hooks` 키는 빈 오브젝트 (`{}`) — `.claude/hooks/` 디렉토리는 2026-04-26 폐기 (subsystem-17 retired)
- 새 권한 정책 조정 시 settings.json 업데이트 (settings-hooks-maintainer 경유)
- 향후 hook 재도입 시 `update-config-harness` skill 의 6-step HOOK_VERIFICATION_FLOW 적용

## Gotchas

- **jsonc 주석 금지**: settings.json은 strict JSON. 주석 포함 시 harness 파싱 실패.
- **trailing comma 금지**: 동일 이유.
- **본 capsule은 설명만**: 실제 수정은 update-config-harness 스킬로만.

## 관련 AD

- 전반 — harness 설정은 AD 위반 방지 경계 일부
