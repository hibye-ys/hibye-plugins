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
| External Domain Access | backend/tools/_iyaki_db.py, tools/iyaki_query.py, tools/iyaki/ (block/entity/category/episode/section/group/graph/timeline/worldbuilding/note/rollback + _shared), tools/iyaki_mutate.py (compat shim), tools/iyaki_project.py (project lifecycle — lock_project exception). 이 instance 의 외부 도메인 사례 = `iyaki` 웹서비스 | (rule: database-patterns + data-layer-patterns) |
| User Skills      | backend/routes/skills.py, services/skills/, state/user_skill.py, state/db_user_skill.py, db/models/user_skill.py | (rule: user-skill-patterns) |

## 작업 규율
해당 서브시스템 작업을 시작하기 전에 담당 skill을 먼저 로드한다.
Python 관용(asyncio, pydantic v2, async generator, context manager)을 준수한다.

## Build / Test / Run
- 의존성 설치 (개발): `uv sync`
- **의존성 설치 (CI/배포): `uv sync --frozen`** — `uv.lock` 정확 버전만 허용, version drift 차단
- 타입체크: `ty check backend/`
- 린트: `ruff check .`
- 포맷: `ruff format .`
- 테스트 (빠른 로컬 루프): `uv run pytest -m unit` (외부 I/O 0, skip 0 보장)
- 테스트 (전체): `uv run pytest` (~1,900 items — 2026-04-26 §1-(4) Jailbreak Detection Phase 1 후 +~80 tests, 2026-04-26 §1-(3) Content Moderation Phase 1 +85 tests, 2026-04-25 §7 SSE Resilience Phase 1 +49 tests)
- 테스트 (단일 파일): `uv run pytest backend/tests/test_<module>.py -v`
- 테스트 분류 상세: `docs/runbook/test-hygiene.md`
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

## 진행 상태 판단 — Code-First (문서 우선 금지)

**규율:** 어떤 항목이 "구현되었나 / 남았나" 판단 시 **반드시 코드부터 검증**한다. roadmap / INDEX.md / spec 텍스트만 읽고 결론 내리지 않는다. 문서가 stale 일 가능성을 항상 가정한다.

**검증 순서 (필수):**
1. **코드 grep** — 핵심 식별자 (함수명, 클래스명, route path, env var) 를 `backend/` 전체에서 검색
2. **파일 존재 확인** — 예상 모듈 경로 `ls`, 예상 테이블/모델 직접 확인
3. **commit 로그 확인** — `git log --oneline | grep -i <topic>` 으로 실제 머지 이력 검증
4. **그 다음에야 문서 비교** — 코드 사실과 문서 주장을 대조해 drift 식별

**판단 카테고리 — 4단계로 명시:**

| 라벨 | 의미 |
|------|------|
| ✅ done | 코드 + commit + 호출 흐름 모두 작동, 사용자 시나리오 검증됨 |
| 🟡 부분 구현 | 코드 일부 (예: Port / flag / 저장 layer) 작동, 사용자 노출 / 호출 hook / UI 미연결 |
| ❌ 미구현 | grep 0건 + 별도 cycle 필요 |
| 📝 주석 only | "Phase 2", "future-proofing" 류 docstring 만 존재 — cycle 약속 아님 |

**금지 사항:**
- roadmap §X 헤더의 "Status: planned" 만 보고 미구현이라고 결론
- spec 의 "Phase 2" 단어만 보고 별도 cycle 약속이라고 결론
- 구현이 어느 layer (Port / flag / store / route / UI) 에 있는지 구분 없이 binary done/not-done 판단
- 코드 검증 없이 사용자에게 "남은 작업" 목록 제시

**문서 drift 발견 시:** 그 자리에서 코드 사실에 맞춰 문서를 갱신한다 (별도 task 로 미루지 않음). drift 가 큰 경우 별도 commit 으로 분리.

## 운영 규율
Layer 2 policy는 `.claude/skills/backend-overview` 로드 시 주입됨.
불변식 준수, 경로 권한, Python 공통 규약은 Layer 2 영역.

## (Layer 2) 확장 섹션

### 활성 불변식 경고
- **Single writer path**: `backend/data/media/**` 쓰기는 WriteCoordinator 싱글턴 경유 (media 전용 scope — user-state overlay 는 제거됨)
- **external domain boundary** (이 instance = `iyaki` 웹서비스): 도메인 데이터는 외부 application 소유. AI 백엔드는 자체 엔티티 테이블 미보관. 동일 Postgres 인스턴스의 `public.*` 스키마에 **직접 SELECT/UPDATE 허용**하되, 쓰기는 `lock_project` advisory lock + `ai_backend.iyaki_mutations` 감사 append 필수. 접근은 전용 pool (`backend/tools/_iyaki_db.py`) 경유
- **StoragePort abstraction**: `data/writer.py` 와 `state/session.py` 는 Port Protocol 로 추상화 — 호출자는 Protocol 에만 의존
- **3-layer input safety gate** (§1-(2) PII Redaction + §1-(3) Content Moderation + §1-(4) Jailbreak Detection): `dispatch_run` 본문에서 V3 ordering 으로 sequential 게이트 — `tombstone → jailbreak heuristic → jailbreak classifier (opt-in) → moderation → _stream_agent`. 세 layer 모두 `enabled=False` 시 `run_policy.no_safety_layer` WARNING (3-layer validator). 두 게이트 (jailbreak + moderation) 는 직교 — `X-App-Jailbreak-Status` 와 `X-App-Moderation-Status` 헤더 분리

### 경로 권한 (Layer 2)
- backend/** : 자유
- backend/runs/*.yaml : 변경 시 /spec-diff 권유 (현재 hook 미등록 — 리뷰어 수동 체크)
- backend/data/media/** : `data/writer.py` 경유 외 쓰기 금지 (single writer 불변식)
- backend/data/skills/user/** : `data/writer.py::write_user_skill` 경유 외 쓰기 금지 (single writer 불변식)

### Python 백엔드 규약
`.claude/rules/python_agent_rules/` 에서 자동 로드 (Claude Code 내장 `rules/` 기능).

**Tier 1 — 항상 로드** (횡단 원칙):
- `design-principles.md` — 7 핵심 원칙 (safe defaults, cheapest first, cache stability, isolation, structured errors, dynamic context, partial loading)
- `coding-standards.md` — PEP 8, SOLID, 타입 힌트, async, 구조화 로깅
- `error-handling.md` — 4 패턴 + 4 예외 유형
- `architecture.md` — 단방향 import + 단일 작성자
- `commit-rules.md` — conventional commits
- `core-infrastructure.md` — 타입 경계 + Protocol DI + ContextVar + 예외 계층 + 캐시 안정성 + SSE lifecycle

**Tier 2 — `paths:` frontmatter 매칭 시 조건부 로드**:
`ai-provider-patterns` · `ai-agent-patterns` · `config-management` · `context-assembly-patterns` · `sse-streaming-patterns` · `data-layer-patterns` · `run-policy` · `media-pipeline-patterns` · `api-routing-patterns` · `database-patterns` · `agent-loop-patterns` · `tool-system-patterns` · `compaction-patterns` · `sub-agent-patterns` · `mcp-patterns` · `user-skill-patterns`

### Layer 2 sub-agent / command 가용
- `/spec-diff <subsystem>` (spec-diff-auditor)
