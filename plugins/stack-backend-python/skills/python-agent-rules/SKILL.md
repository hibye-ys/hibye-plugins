---
name: python-agent-rules
description: Use when writing or reviewing Python code in backend/, especially when adding new modules, error handling, providers, or commit messages. Load this skill to access the App-adapted Python agent rule catalog — 8 rules files covering PEP 8 + SOLID coding standards, conventional commit format, four error handling patterns, AI provider abstraction principles (CircuitBreaker, retry policy), AI agent template-method patterns, core infrastructure (Protocol DI, stateless services, SSE lifecycle), layered import architecture, and configuration management. Excludes Memory 3-Tier (conflicts with tool-use 기반), AsyncConnectionPool (), and prompts YAML versioning (App uses single-file prompts). This is a reference catalog — read the relevant rules file directly when you have a specific question.
allowed-tools: Read, Grep, Glob
---

# python-agent-rules — Python 백엔드 공통 규약 카탈로그

## 이 skill은 언제 로드되는가

- `backend/` 안에서 새 모듈 작성 시
- 에러 처리 패턴 결정 시 (어떤 계층에서 raise 할지)
- 새 commit 메시지 작성 시
- AI provider 추상화 설계 / 새 provider 추가 시
- 코드 리뷰 준비 시
- "이게 App 규약에 맞는지" 의문이 들 때

본 카탈로그는 정적 reference skill이다. 로드는 항상 cheap (thin index ~150줄).
실제 규약 본문은 `.agents/rules/python_agent_rules/` 아래의 8 파일에 분산돼 있으며,
필요한 파일만 lazy load 한다 (progressive disclosure).

## 카탈로그 구조

8개 rules 파일이 `.agents/rules/python_agent_rules/` 아래에 있다.
이 skill은 "어디에 무엇이 있는지" 만 안내하고, 실제 규약 본문은 해당 파일을 직접 읽는다.

| 파일 | 차용 방식 | 핵심 주제 |
|---|---|---|
| `coding-standards.md` | native (App-authored) | PEP 8, SOLID, DRY/KISS/YAGNI, 타입 힌트, async, 구조화 로깅, 시크릿 |
| `commit-rules.md` | native (App-authored) | Conventional commits 7 접두사, 명령형, 소문자, 마침표 없음 |
| `error-handling.md` | native (App-authored) | 4 패턴 (공개 Dict / 내부 raise / 초기화 raise / 선택적 None+warning) + 4 예외 (Validation/Configuration/Resource/Internal) |
| `ai-provider-patterns.md` | native (App-authored) | 추상화 5원칙, CircuitBreaker, 재시도 4종, 파라미터 매트릭스, Thinking/Reasoning |
| `ai-agent-patterns.md` | native (App-authored) | 템플릿 메서드(handle/_do_handle), 레지스트리, 가드레일 체인 fail-open |
| `core-infrastructure.md` | native (App-authored) | 타입 경계, Protocol DI, 무상태, ContextVar 로깅, SSE 라이프사이클 |
| `architecture.md` | native (App-authored) | 계층 단방향 import, 단일 작성자, App `backend/{routes,engine,services,...}` 매핑 |
| `config-management.md` | native (App-authored) | 코드로서 설정, `${VAR}` 시크릿, 안전 기본값, 시작 검증, 핫 리로드 |

총 8 파일. 각 50-100줄. 본 skill frontmatter는 모든 파일이 존재한다고 가정하고
설계됐다. 하나라도 빠지면 "아래 규약 카탈로그 불완전" 상태로 간주.

## 본 카탈로그가 다루지 않는 것 (의도적 제외)

아래 항목은 일반 Python/AI 에이전트 rules 세트에서 자주 보이지만, App 설계와
직접 충돌하거나 현 Phase 범위 밖이므로 본 카탈로그에 포함하지 않는다.

| 제외 항목 | 이유 |
|---|---|
| Memory 3-Tier 아키텍처 (session/long-term/episodic) | tool-use 기반 (tool_use 기반, RAG 아님) + session store Protocol (단일 영속층) 와 직접 충돌 |
| `AsyncConnectionPool` / DB pool 패턴 | 현재는 file-based file-based layout.  이후만 의미 있음 |
| LangChain 추상화 / OpenRouter 게이트웨이 | App는 직접 provider SDK 호출 (`backend/providers/{name}.py`) |
| 500/300줄 등 문서 길이 강제 제한 | App는 단일 집중 문서 철학 (이 build plan + 설계 doc) 유지 |
| `prompts/*.yaml current` 버전 관리 | App는 `backend/agents/prompts/*.md` 단일 파일 + `backend/agents/*.yaml` 사용 |

이 5 항목이 코드에 들어가려는 신호(예: 새 `memory/` 디렉토리, `ConnectionPool` import,
`langchain_core` import)가 발견되면 즉시 사용자 확인 후 진행.

## 사용 패턴

1. **새 모듈 작성 전**: `coding-standards.md` + `architecture.md` 를 한 번 훑어본다
   (계층 경계 + 네이밍 + async 규약). 이 단계에서 해당 모듈이 어느 계층에
   속하는지 + 어떤 모듈만 import 해도 되는지 결정.
2. **새 provider 추가 전**: `ai-provider-patterns.md` 의 추상화 5원칙 + CircuitBreaker
   섹션. 그 후 L1-S06 `provider-layer` skill 로드해서 Protocol 계약 + unified
   Message/ContentBlock 요구사항 확인.
3. **에러 처리 결정 시**: `error-handling.md` 의 4 패턴 매트릭스 — 공개 API인지 내부
   인지부터 분류, 그에 맞는 패턴 선택. 공개 HTTP 경계면 Dict 반환, 내부 service
   면 typed exception raise.
4. **commit 작성 시**: `commit-rules.md` 의 7 접두사 + 형식 규칙 (명령형, 소문자,
   마침표 없음, body 는 why-중심). Co-Authored-By 트레일러 허용.
5. **코드 리뷰 시**: 전체 카탈로그를 grep 대상으로 사용
   (`grep -r "절대 하지 말 것" .agents/rules/python_agent_rules/`). 금지 패턴이
   PR에 들어있는지 빠르게 확인 가능.

## rules 파일 간 관계

8 파일은 서로 다음과 같이 참조 관계를 가진다 (중복 최소화 원칙):

- `coding-standards.md` 는 **base** — 나머지 모든 파일이 암묵적으로 의존
- `architecture.md` 는 **계층** — `core-infrastructure.md` 가 구체 구현 규약
- `ai-provider-patterns.md` + `ai-agent-patterns.md` 는 **도메인 특화** —
  coding-standards + core-infrastructure 를 AI layer에 적용
- `error-handling.md` 는 **cross-cutting** — 모든 파일에서 참조
- `config-management.md` 는 **boot/runtime 경계** — 시작 시 1회 검증
- `commit-rules.md` 는 **independent** — 코드가 아닌 git 워크플로우 규칙

특정 규약이 애매하면 base → 도메인 순으로 역추적.

## 다른 skill 과의 관계

본 skill 은 **Layer 2 (L2) reference** 카탈로그다. Layer 1 구현 skill 과 역할이
다르다:

| Layer | skill 예 | 역할 |
|---|---|---|
| L1 구현 | `agent-loop`, `tool-system`, `provider-layer`, `context-assembly`, `sse-streaming` 등 | 특정 파일/모듈을 작성할 때 로드. 서브시스템별 계약 + 불변식 |
| L2 정책 (본 skill) | `python-agent-rules` | Python/에이전트 공통 규약. 어느 파일을 작성하든 참고 |
| L2 index | `backend-overview` | "어디에 무엇이 있는지" thin index |

**로딩 순서 권장**:
1. 세션 시작 시: `backend-overview` (어디에 무엇이 있는지) + `python-agent-rules`
   (어떻게 작성해야 하는지)
2. 특정 작업 시작 시: 해당 L1 skill (예: provider 추가 → `provider-layer`)
3. 작업 중 규약 의문 시: 본 카탈로그의 관련 rules 파일 lazy load

본 skill 은 L1 skill 과 **중복 금지** — L1 이 서브시스템 특정 계약을 다루면
본 카탈로그는 Python 공통만 다룬다. (예: Tool Protocol 계약은 `tool-system` skill
에만 있고, 본 카탈로그에는 없다.)

## 자주 보는 함정

- **"이 패턴이 App에 맞는지 모르겠다"** → 본 카탈로그의 "절대 하지 말 것" 섹션을
  먼저 본다. rules 파일마다 금지 사항 리스트가 있다.
- **"Memory 시스템이 필요한 것 같다"** → tool-use 기반 + session store Protocol 재확인. tool_use 기반 외부
  호출(read_*, write_*)로 충분한지 검토 후 결정. 필요 시 사용자 승인 필수.
- **"AsyncConnectionPool 같은 게 필요한 것 같다"** → 이미 SQLAlchemy async 엔진이
  pool 을 관리함 (`backend/db/engine.py` + `database-patterns.md`). 별도 pool 클래스
  도입 금지. 의심되면 `data-audit` skill + `database-patterns.md` 확인 후 사용자 보고.
- **"이 rules 파일과 skill 설명이 다르다"** → rules 파일이 우선. 이 SKILL.md는 index,
  실 규약은 rules body.

## 검증 체크리스트

이 skill 자체는 정적 카탈로그라 lint 의무는 없지만, 8 rules 파일이 존재하고 본
카탈로그가 동기화돼야 한다:

- [ ] `.agents/rules/python_agent_rules/` 아래 8 파일 모두 존재
- [ ] 각 파일 상단에 App native attribution 헤더 블록
- [ ] 본 SKILL.md가 8 파일 이름을 모두 카탈로그 표에 명시
- [ ] "본 카탈로그가 다루지 않는 것" 5 항목 명시 (Memory / AsyncConnectionPool /
      LangChain / 문서 길이 제한 / prompts YAML)
