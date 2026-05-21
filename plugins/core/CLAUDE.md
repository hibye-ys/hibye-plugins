# core (hibye-plugins)

**1줄 요약**: Universal LLM backend principles + workflows.
**같이 install 권장**: 모든 프로젝트에 기본 install
**대상 스택**: 무관 (language·surface 무관)
**책임 범위**:
- 워크플로 스킬 (debug-session, using-marketplace)
- 상시 룰 (이 파일 + `rules/*.md` 임포트)

## 진입점 스킬

- `using-marketplace` — 본 마켓플레이스 사용 안내. SessionStart 시 자동 로드 기대.
- `debug-session` — 디버깅 작업 시 trigger.

## 상시 룰 (`rules/` 임포트)

@./rules/example-invariant.md
