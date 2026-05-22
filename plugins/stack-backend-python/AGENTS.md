# App AI Backend — Core Instructions

## 프로젝트
- Python FastAPI AI 에이전트 백엔드

## 서브시스템 매핑 (Layer 1 core)
App 내부 서브시스템과 각각의 Python 구현 경로, 담당 skill.

| 서브시스템       | Python 구현                                                                | 담당 skill          |
|------------------|----------------------------------------------------------------------------|---------------------|
| Agent Loop       | backend/engine/loop.py, recovery.py                                        | agent-loop          |
| Tool System      | backend/tools/base.py, tools/registry.py                                   | tool-system         |
| Provider Layer   | backend/providers/, backend/services/model_resolution.py                   | provider-layer      |
| Context Assembly | backend/engine/context.py                                                  | context-assembly    |
| SSE Streaming    | backend/engine/stream.py, routes/run.py                                    | sse-streaming       |
| Data Layer       | backend/data/                                                              | data-layer          |
| Run Dispatcher   | backend/routes/run.py, engine/policy.py, engine/run_registry.py, runs/     | (rule: run-policy + api-routing) |
| Media Pipeline   | backend/routes/media.py, services/media/, data/media/                      | (rule: media-pipeline-patterns) |
| Compaction       | backend/engine/compaction.py                                               | compaction          |
| Sub-agent Spawn  | backend/tools/agents.py, engine/subagent.py                                | sub-agent-spawn     |
| LSP Server       | backend/lsp/ (pygls)                                                       | lsp-server          |
| MCP Integration  | backend/services/mcp/                                                      | mcp-integration     |
| External Domain Access | backend/tools/_<domain>_db.py, tools/<domain>_query.py, tools/<domain>_mutate.py, tools/<domain>/, tools/<domain>_project.py (project lifecycle — lock_project exception). 이 instance 의 외부 도메인 사례 = `<domain>` 웹서비스 | (rule: database-patterns + data-layer-patterns) |

## 작업 규율
해당 서브시스템 작업을 시작하기 전에 담당 skill을 먼저 로드한다.
Python 관용(asyncio, pydantic v2, async generator, context manager)을 준수한다.

## 하네스 원본 구조
- `.agents/skills/` — Codex + Claude 공용 skill 원본
- `.agents/rules/` — Codex + Claude 공용 rule 원본
- `.codex/skills` → `.agents/skills` symlink
- `.codex/rules` → `.agents/rules` symlink
- `.claude/skills`, `.claude/rules` 는 Claude Code 가 직접 읽는 별도 사본 — `.agents/` 와 양쪽 모두 active 로 운영한다.

## Codex command / sub-agent adapter
- Claude slash command 호환: `codex-commands` skill이 `/agent-test`, `/agent-verify`, `/audit-all`, `/spec-diff`, `/new-tool`, `/pre-deploy` 등 command reference를 라우팅한다.
- Claude sub-agent 호환: `codex-subagents` skill이 `provider-manager`, `spec-diff-auditor`, `architecture-validator` 등 sub-agent prompt reference를 라우팅한다.
- `.claude/commands`, `.claude/agents` 는 Claude Code 가 직접 읽는 active 사본. Codex-facing 변경은 `.agents/skills/codex-commands` 또는 `.agents/skills/codex-subagents` 아래에 두고, 양쪽 동등하게 유지한다.

## Build / Test / Run
- 의존성 설치 (개발): `uv sync`
- **의존성 설치 (CI/배포): `uv sync --frozen`** — `uv.lock` 정확 버전만 허용, version drift 차단
- 타입체크: `ty check backend/`
- 린트: `ruff check .`
- 포맷: `ruff format .`
- 테스트: `pytest` (전체) 또는 `pytest backend/tests/test_<module>.py -v` (단일)
- 개발 서버: `uvicorn backend.main:app --reload`
- 헬스체크: `curl -s http://localhost:8000/health`
- 의존성 감사 (주간 + 릴리스 전): `uv run pip-audit`

## 최소 금지
- reference/** : 외부 read-only (쓰기 금지)
- .env, *.key, *.pem, *secret* : 금지
- rm -rf, sudo, curl * api_key* : 금지

## Git safety
- 사용자 요청 없이 자동 커밋 금지
- `git push --force`, `git reset --hard` 금지 (hook가 차단하지만 명시)
- 새 커밋 생성 원칙 — amend 금지 (특히 hook 실패 후 amend 절대 금지: 이전 커밋을 덮어 쓰게 되어 작업 손실 위험)

## 완료 기준
- 변경된 파일에 대한 pytest 통과
- ruff check + ty check 통과
- 엔드포인트/UI 변경 시: 서버 부팅 + 실제 시나리오 curl 테스트
- "타입체크/테스트 통과 ≠ 기능 검증" — 실제로 기능을 써봐야 완료 주장 가능

## 운영 규율
Layer 2 policy는 `.agents/skills/backend-overview` 로드 시 주입됨.
불변식 준수, 경로 권한, Python 공통 규약은 Layer 2 영역.

## (Layer 2) 확장 섹션

### 활성 불변식 경고
- **Single writer path**: `backend/data/media/**` 쓰기는 WriteCoordinator 싱글턴 경유 (media 전용 scope — user-state overlay 는 제거됨)
- **external domain boundary** (이 instance = `<domain>` 웹서비스): 도메인 데이터는 외부 application 소유. AI 백엔드는 자체 엔티티 테이블 미보관. 동일 Postgres 인스턴스의 `public.*` 스키마에 **직접 SELECT/UPDATE 허용**하되, 쓰기는 `lock_project` advisory lock + `ai_backend.<domain>_mutations` 감사 append 필수. 접근은 전용 pool (`backend/tools/_<domain>_db.py`) 경유
- **StoragePort abstraction**: `data/writer.py` 와 `state/session.py` 는 Port Protocol 로 추상화 — 호출자는 Protocol 에만 의존

### 경로 권한 (Layer 2)
- backend/** : 자유
- backend/runs/*.yaml : 변경 시 /spec-diff 권유 (project_path_policy hook warn)
- backend/data/media/** : `data/writer.py` 경유 외 쓰기 금지 (single writer 불변식)

### Python 백엔드 규약 (L2-R01 주입)
Python 코드 작성/수정 시 다음 규약을 준수. 상세는 각 파일 참조.

- @.agents/rules/python_agent_rules/coding-standards.md — PEP 8, SOLID, 타입 힌트, async, 구조화 로깅
- @.agents/rules/python_agent_rules/error-handling.md — 4 패턴 + 4 예외 유형
- @.agents/rules/python_agent_rules/commit-rules.md — conventional commits
- @.agents/rules/python_agent_rules/ai-provider-patterns.md — 추상화 + CircuitBreaker
- @.agents/rules/python_agent_rules/ai-agent-patterns.md — 템플릿 메서드 + 레지스트리 (Memory 3-Tier 제외)
- @.agents/rules/python_agent_rules/core-infrastructure.md — Protocol DI + 무상태 + SSE (AsyncConnectionPool 제외)
- @.agents/rules/python_agent_rules/architecture.md — 단방향 import + 단일 작성자 (App 평면 매핑)
- @.agents/rules/python_agent_rules/config-management.md — `${VAR}` 시크릿 + 시작 검증
- @.agents/rules/python_agent_rules/context-assembly-patterns.md — 3-layer prompt + TokenBudget + memory>history + attachment 순서
- @.agents/rules/python_agent_rules/sse-streaming-patterns.md — wire format + ping=15 + scrub_secrets + 종료 보장
- @.agents/rules/python_agent_rules/data-layer-patterns.md — 미디어 파이프라인 단일 작성자 (`WriteCoordinator`). external 도메인 접근은 database-patterns.md, session/history 도 database-patterns.md
- @.agents/rules/python_agent_rules/run-policy.md — `/run/<name>` RunPolicy + runs/*.yaml 선언
- @.agents/rules/python_agent_rules/media-pipeline-patterns.md — `/media/*` job 큐 + data/media/ 저장
- @.agents/rules/python_agent_rules/api-routing-patterns.md — thin routes + 인증 + 에러 변환 + prefix 규약
- @.agents/rules/python_agent_rules/database-patterns.md — Postgres + StoragePort 추상화 + external domain 경계
- @.agents/rules/python_agent_rules/design-principles.md — 7 핵심 원칙 (safe defaults, cheapest first, cache stability, isolation, structured errors, dynamic context, partial loading)
- @.agents/rules/python_agent_rules/agent-loop-patterns.md — 6-stage 루프 + LoopState + LoopTransition + error recovery
- @.agents/rules/python_agent_rules/tool-system-patterns.md — build_tool() + validateInput/checkPermissions + 도구 정렬 캐시 안정성
- @.agents/rules/python_agent_rules/compaction-patterns.md — 4-stage escalation (SNIP→MICRO→SESSION→AUTO) + post-compact 재주입
- @.agents/rules/python_agent_rules/sub-agent-patterns.md — 3 execution modes + coordinator/worker + CacheSafeParams + depth 제한
- @.agents/rules/python_agent_rules/mcp-patterns.md — mcp__<server>__<tool> 네이밍 + 5-state 연결 + delta instructions

### Layer 2 sub-agent / command 가용
- `/spec-diff <subsystem>` (spec-diff-auditor)
