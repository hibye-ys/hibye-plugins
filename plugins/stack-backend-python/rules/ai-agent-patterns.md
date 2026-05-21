---
paths:
  - "backend/agents/**"
---

> App backend rules — Agent definition + loader/discover invariants.
> 관련: `sub-agent-patterns.md` (spawn + depth + CacheSafeParams),
>       `tool-system-patterns.md` (allowed_tools filtering),
>       `context-assembly-patterns.md` (3-Layer prompt + memory),
>       `run-policy.md` (`/run/<name>` 엔드포인트 정의 대비)

# ai-agent-patterns — 에이전트 정의 + 로더

> **Scope:** `backend/agents/` 만. 에이전트가 **YAML + markdown prompt** 로 선언되고 `AgentDefinition` pydantic 모델로 적재되는 구조 규약. 스폰/깊이/캐시 세이프 파라미터는 `sub-agent-patterns.md`, 도구 필터링은 `tool-system-patterns.md`, 프롬프트 조립은 `context-assembly-patterns.md`, `/run/<name>` 라우팅은 `run-policy.md` 가 담당.

## 불변식 (Invariants)

### 파일 레이아웃

```
backend/agents/
├── loader.py              # AgentDefinition + load_agent() + load_agent_prompt()
├── discover.py            # discover_agents() / discover_runs() — UI용 스캔
├── prompts/
│   ├── base.md            # Layer 1 (모든 에이전트 공통 base prompt)
│   ├── chat.md            # agent-specific
│   └── <name>.md          # agent-specific (각 agent YAML 의 system_prompt_file 이 가리킴)
└── <name>.yaml            # 에이전트 선언 파일 — name 과 파일 stem 일치
```

- **Agent YAML 파일 이름 = `AgentDefinition.name`** 와 동일해야 함 (`load_agent()` 가 `<name>.yaml` 을 찾음)
- prompt 파일은 `prompts/` 하위 — YAML 의 `system_prompt_file` 로 상대 경로 명시

### `AgentDefinition` 스키마 (`loader.py::AgentDefinition`)

```python
class AgentDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str              # pattern=r"^[a-z0-9_]+$", 1~64자
    description: str | None
    system_prompt_file: str           # prompts/ 하위 상대 경로 (e.g. "writing_assistant.md")
    tools: list[str] | None = None    # None = 전체 허용, []= 도구 없음, list = 화이트리스트
    model_preference: str = "default" # fallback chain 이름
    max_tool_rounds: int = 10         # ge=1, le=100
    temperature: float | None         # ge=0.0, le=2.0
```

- `extra="forbid"` — 오타 필드는 load-time 에 `ValidationError`
- `frozen=True` — 인스턴스 mutate 차단
- 필드 추가/변경 시 **이 rule + 기존 YAML 전부 동시 업데이트**

### Loader 규약

`backend/agents/loader.py` 가 정본:

- `load_agent(name: str) -> AgentDefinition` — `@lru_cache(maxsize=64)`. 같은 이름 재호출 시 디스크 I/O skip
- `load_agent_prompt(spec) -> str` — `_read_agent_prompt(path)` 도 `@lru_cache` — prompt 파일 I/O 도 캐시됨
- `reset_cache_for_tests()` — 두 캐시 clear (테스트 fixture 용)
- **에러 매핑**:
  - YAML 파일 없음 → `ResourceError`
  - YAML 파싱 실패 / schema 불일치 / 이름 패턴 위반 → `ValidationError`
- 캐시 무효화는 **프로세스 재시작** 또는 테스트용 reset. hot-reload 는 미지원 (의도된 YAGNI — agent YAML 은 빈번히 바뀌지 않음)

### Discover 규약 (UI 전용)

`backend/agents/discover.py` 는 **canonical loader 와 별개**:

- `discover_agents() -> list[DiscoveredSpec]` — 디렉토리 스캔으로 `(name, kind, description, model_preference, tools, session_enabled)` 6-tuple 만 뽑음. `session_enabled` 은 RunPolicy-only field — runs (`kind="run"`) 는 YAML 키 또는 default `True`, agents (`kind="agent"`) 는 항상 `None` (ZDR UI 계약 add-on, 2026-04-26 — `/debug/agents` 응답이 이를 surface 해서 프론트엔드가 "Zero Data Retention" 인디케이터 렌더링 가능)
- 용도: `/debug/agents`, `/debug/providers/fallback-chains` 등 UI tree view
- **절대 실행 경로에서 쓰지 말 것** — 스키마 검증을 건너뛰고 malformed YAML 에 WARNING 만 찍음
- 실행 시 agent 로드가 필요하면 반드시 `loader.load_agent()` 경유

### 레지스트리 / 가드레일 (현재 미구현)

- **현재 없음**: `@register("name")` 같은 데코레이터, `AgentRegistry` 싱글턴, `GuardrailProtocol` / 가드레일 체인 모두 **미구현**
- `loader.py:14-17` 주석이 이를 "future enhancements" 로 명시
- 현재 에이전트는 `load_agent(name)` 으로 on-demand 로드 + `@lru_cache` 가 사실상 레지스트리 역할
- 향후 필요 시 추가 체크리스트는 아래 §미래 확장 참조

### Memory 시스템은 백엔드가 관리하지 않음

중요 분리:

- `.agents/rules/` + `AGENTS.md` 는 **agent harness** 가 로드 — AI 백엔드 런타임과 무관
- 사용자 대화 맥락 / 세션 이력은 `context-assembly-patterns.md` (Stage 1 조립) + `state/session.py` (SessionHistoryPort) 가 담당
- 파일 접근 시점의 nested rule 주입, dual dedup 등은 **agent harness 의 메모리 시스템**이지 이 백엔드의 기능이 아님

### Memory 3-Tier 금지 (tool-use 원칙)

향후 설계 시 `session / long-term / episodic` 같은 **3-Tier memory** 구조 도입 금지:

- 이유: AI 가 **도구 호출로 직접 메모리 조회/기록** 하는 것이 이 프로젝트의 원칙. 백엔드가 미리 "이건 session memory, 이건 long-term" 으로 분류해두는 구조는 tool-use 중심 설계와 충돌
- 메모리 관련 요구가 생기면 **도구로 노출** (e.g. `memory_search`, `memory_write`) — 백엔드는 저장소만 제공

## 새 에이전트 추가하기

1. `backend/agents/<name>.yaml` 생성
   - `name` 은 `^[a-z0-9_]+$` 패턴 + 파일 stem 과 일치
   - `description` 권장 (UI `/debug/agents` 에 노출됨)
   - `system_prompt_file: "<name>.md"` — prompts/ 하위 경로
2. `backend/agents/prompts/<name>.md` 작성
   - Layer 2 agent prompt (`context-assembly-patterns.md` §3-Layer)
   - 동적 값 (timestamp, session_id 등) 삽입 금지 — prompt cache prefix 무효화
3. `tools` 필드 설정
   - **Coordinator 역할**: `spawn_agent`, `send_message`, `task_stop` 만 허용
   - **Worker 역할**: `spawn_agent` **반드시 제외** (무한 재귀 방지 — `sub-agent-patterns.md` §Coordinator vs Worker)
   - 미지정 시 전체 도구 허용 (개발/실험용)
4. `model_preference` 지정 — `providers.yaml` 의 fallback chain 이름
5. 테스트: `load_agent("<name>")` 이 성공하는지 + 해당 에이전트로 `/run/chat` 또는 spawn 경로 실행
6. `/debug/agents` 엔드포인트에서 UI 에 노출되는지 확인 (discover 가 picking up 하는지)

## 새 conditional rule 추가하기 (Claude Code 쪽)

(백엔드 관심사 아님 — Claude Code 가 소비. 이 rule 에 기록은 호환성 이유)

1. `.agents/rules/` 에 `.md` 파일 생성
2. frontmatter `paths: ["pattern/**"]` — 없으면 항상 로드
3. glob 패턴은 좁게 — 너무 넓으면 토큰 낭비

상세는 `context-assembly-patterns.md` §새 Nested Rule 추가하기.

## 미래 확장 (현재 미구현)

구현 시 체크리스트 스케치:

- **Agent Registry**: `load_agent()` 의 `@lru_cache` 를 명시 레지스트리 클래스로 교체. runtime mutate 금지 원칙 (부팅 시에만 등록)
- **가드레일 체인**: `GuardrailProtocol` + 블로킹/논블로킹 분리 + fail-open 처리 (가드레일 에러 → pass through + ERROR 로그)
- **Hot-reload**: `POST /agents/reload` 엔드포인트 (`/runs/reload` 와 대칭). 진행 중 spawn 은 이전 definition 유지

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `AgentDefinition` 필드 추가/삭제 | 모든 기존 YAML + `loader.py` + `discover.py` + 이 rule 동시 업데이트. `extra="forbid"` 이므로 기존 YAML 에 새 필드 없으면 통과하지만 타입 변경 시 전부 재검증 |
| `name` 정규식 변경 | 기존 에이전트 YAML 의 이름이 매칭 안 되면 load-time `ValidationError` |
| `load_agent` 캐시 정책 변경 | hot-reload 동작 + 테스트 fixture 에서 `reset_cache_for_tests()` 호출 지점 |
| `discover_agents` 필드 추가 | `/debug/agents` UI 클라이언트 파서 동시 업데이트 |
| Coordinator 허용 도구 변경 | 기존 coordinator YAML 들의 tools 리스트 재검토 |
| Agent prompt 파일 공백 편집 | 세션 전체 prompt cache 무효화 (`context-assembly-patterns.md` §프롬프트 .md 파일 관리) |

## 금지 사항

- Memory 3-Tier (session/long-term/episodic) 도입 — tool-use 기반 원칙 충돌
- `AgentDefinition` 필드를 `extra="allow"` 로 완화 (오타 감지 상실)
- `frozen=True` 해제 (런타임 mutate 허용 시 레이스 / 캐시 오염 위험)
- `discover.*` 를 실행 경로에서 사용 (스키마 검증 없음 — 반드시 `load_agent()` 경유)
- Worker agent 의 `tools` 에 `spawn_agent` 포함 (무한 재귀 — `sub-agent-patterns.md` §Coordinator vs Worker)
- Agent prompt 에 동적 값 (timestamp / session_id / turn_count) 삽입 (prompt cache prefix 무효화)
- `.agents/rules/` 의 conditional rule 을 백엔드 런타임이 읽으려 시도 (이건 Claude Code CLI 소관)
- `loader.py` 캐시 우회한 직접 YAML 파싱 (캐시 일관성 / 검증 우회)
- 레지스트리 / 가드레일 / hot-reload 를 미래 구현하면서 기존 불변식 (Coordinator 도구 제한, Memory 3-Tier 금지) 우회
