> App backend-overview capsule. Source: `runtime-verify` skill (본 skill 의 운영 파트너) + 실 운영 체크리스트.

# Subsystem 16 — Verify

## 목적 (1줄)

런타임 검증 체크리스트. 코드 변경 후 "done" 주장 전에 Static + Boot + E2E 단계를
통과시킨다.

## 파일 / 모듈

- 별도 코드 없음 — `runtime-verify` skill + `/agent-verify` command 가 workflow 제공
- `backend/tests/` — "Static" 단계에서 pytest 실행
- `backend/main.py` — "Boot" 단계에서 `uv run uvicorn backend.main:app --port 8001` 기동
- `curl -fs http://localhost:8001/health` — "E2E" 1차 증거

## 체크리스트

### Static
1. `ruff check .` — lint 통과
2. `ruff format --check .` — 포맷 통과
3. `ty check backend/` — 타입 체크 통과 (프로젝트 표준 — `mypy` 아님)
4. `pytest backend/tests/test_<changed_module>.py -v` — 변경된 모듈 단위 테스트

### Boot
5. `uv run uvicorn backend.main:app --port 8001 &` — 부팅 성공 + 에러 로그 없음.
   `/agent-verify` 는 port 8001 사용 (dev 8000 과 분리). `/pre-deploy` 도 8001 — 둘은 상호 배타

### E2E
6. `curl -fs http://localhost:8001/health` — 200 OK
7. 기능에 따라 `curl` 시나리오 또는 `POST /run/<name>` SSE 스트림 확인
   (dev 에서 `APP_AUTH_REQUIRED=false` 전제; body `{"message": "..."}` = `RunRequest`)

## 담당 skill / command

- `runtime-verify` skill — verify workflow 상세 스크립트
- `/agent-verify` command — 7-step 자동 실행 (port 8001)
- `/pre-deploy` command — 릴리스 게이트 (Tier 1 static / Tier 2 `--integration` / Tier 3 `--live-openai`, port 8001)

## 범위

- 코드 변경 직후 "done" 주장 전 증거 수집
- `/agent-verify` 는 harness 에서 자동 실행 (port 8001, 상호 배타)
- 릴리스 게이트는 별도 — `/pre-deploy` 가 담당 (같은 port 8001 이므로 동시 실행 금지)

## Gotchas

- **"타입체크 통과 == 기능 동작" 아님**: 반드시 E2E 단계까지 수행. AGENTS.md 완료 기준 참조
- **uvicorn `--reload` 금지**: verify 시 reload 은 부팅 불안정. `--port 8001` 만
- **포트 충돌**: 8001 점유 시 `/agent-verify` 와 `/pre-deploy` 가 서로 kill 가능 — `lsof -i :8001` 로 선점자 확인 후 중단
- **ty vs mypy**: 이 프로젝트는 `ty check backend/` 가 표준. `mypy` 는 사용하지 않음 (rule 파일에 mypy 언급 있으면 drift)

## 관련 rule

- `.agents/rules/python_agent_rules/*` — 어떤 rule 위반도 verify 단계에서 노출되어야 함 (특히 architecture, sse-streaming, tool-system)
