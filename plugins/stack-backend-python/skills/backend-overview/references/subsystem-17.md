> App backend-overview capsule. Source: harness build plans ..

# Subsystem 17 — Hooks (harness) [RETIRED]

## 상태

폐기됨 — 2026-04-26 `eb8e9b9 chore(harness): remove disabled .claude/hooks/ scaffolding`.
`.claude/hooks/` 디렉토리 자체가 삭제되었다.

## 폐기 배경

과거에 두 훅이 있었으나 **장기간 disable 상태**로 방치되어 실제 게이팅 동작이 없었다:

- `project_path_policy.py` — PreToolUse(Edit/Write) 경로 화이트리스트 검증 의도
- `stop_verification.py` — Stop 시 verify 상태 강제 확인 의도

스캐폴딩만 남기면 "동작하지 않는 가드" 라는 drift 위험이 있어 디렉토리째 삭제. `.claude/settings.json` 의 `hooks` 키는 빈 오브젝트 (`{}`) 로만 존재.

## 대체 수단

| 과거 훅 의도 | 현재 대체 |
|---|---|
| `project_path_policy` (경로 화이트리스트) | AGENTS.md "최소 금지" 섹션 + 리뷰어 판단 |
| `stop_verification` (verify 강제) | `runtime-verify` skill + `/agent-verify` 명령 (수동 호출) |

## 향후 hook 재도입 시

`update-config-harness` skill 의 6-step HOOK_VERIFICATION_FLOW 를 따른다. 본 capsule 을 활성 상태로 되돌리고 SKILL.md row 17 도 함께 갱신.
