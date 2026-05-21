> App backend rules — Core infrastructure invariants (type boundary, DI, stateless, logging, exception hierarchy).
> **정본:** `_shared/sse-lifecycle.md` (12 이벤트 / 종료 보장 — 언어 무관),
>           `_shared/tool-sort-order.md` (cache-stable tools 배열 — 언어 무관). 본 파일은 Python 측 적용 지점.
> 관련: `error-handling.md` (예외 계층 정의 원본), `sse-streaming-patterns.md` (SSE wire format 상세),
>       `context-assembly-patterns.md` (AttachmentType 상세), `design-principles.md` (§3 캐시 안정성)

# core-infrastructure — 핵심 인프라 규약

> **Scope:** 타입 경계 / Protocol DI / stateless / ContextVar 로깅 / 예외 계층 / 캐시 안정성.
> SSE wire format, Attachment 순서 등 상세는 전용 rule 참조.

## 불변식 (Invariants)

### 타입 경계

- 서브시스템 간 경계는 통일된 내부 타입 (pydantic v2 `BaseModel`) 으로만 통신. 외부 SDK 타입은 경계에서 즉시 변환
- 외부 타입은 `TYPE_CHECKING` 블록에서만 import — 런타임 전파 금지
- 이중 변환 금지 — 각 provider 의 `_convert_to/from()` 단일 지점 (`ai-provider-patterns.md` §단일 변환)

### Protocol 기반 DI

- ABC 보다 `typing.Protocol` + `@runtime_checkable` 우선
- 호출자는 Protocol 타입 힌트로 받음. 구체 클래스 이름에 의존 금지
- 정의 위치:
  - `ToolProtocol` → `tool-system-patterns.md`
  - `ProviderProtocol` → `ai-provider-patterns.md`
  - `SessionPort` / `SessionHistoryPort` / `MediaJobPort` → `database-patterns.md`

### Stateless 서비스

- `services/*` 는 요청 간 mutable state 금지
- 상태가 필요하면 (1) 요청 인자로 전달, (2) 외부 저장소 위임, (3) TTL 명시 Cache 주입
- 글로벌 mutable dict 금지 (config-management.md §Settings 인스턴스화 와 정합)

### ContextVar 로깅 (10 필드 고정)

`backend/observability/contextvars.py::ALL_FIELDS` — 10개 고정:

```
request_id, trace_id, span_id, session_id, user_id,
run_name, agent, model, turn_count, spawn_depth
```

- `structlog.contextvars.merge_contextvars` 가 자동 주입
- bind/unbind 는 반드시 `bind_log_context` / `clear_log_context` 경유 — 화이트리스트 검증 (오타 시 `ValueError`). 직접 `structlog.contextvars.bind_contextvars` 호출 금지
- 값이 없으면 OMITTED — `None` 주입 금지 (`merge_contextvars` 가 자동 제외)
- ContextVar 는 요청 범위 상태에만 (부팅 설정 금지)
- Sub-agent spawn: `contextvars.copy_context()` + 자식 안에서 `spawn_depth+1` rebind (부모 오염 방지, design-principles §4)
- 테스트: `contextvars.copy_context().run()` 으로 fresh context 실행

### 예외 계층

`backend/exceptions.py` — 4종만:

```
AppError
├── ValidationError       # 입력/설정 형식
├── ConfigurationError    # 환경변수/시크릿 누락. 부팅 실패
├── ResourceError         # 미존재/접근불가. 재시도 가능
└── InternalError         # 불변식 위반. 재시도 무의미
```

상세 (4 패턴 + 복구 전략) 는 `error-handling.md` 참조 (정의 원본).

### 캐시 안정성 (prefix 보호)

prompt cache 무효화는 세션 전체 토큰 비용이 수 배 상승 (design-principles §3). 아래 불변이 prefix 를 고정:

- **도구 정렬**: built-in (이름순) → MCP (이름순). 순서 변경 금지 → `tool-system-patterns.md`
- **3-Layer system prompt**: base → agent → context_hint. 동적 값 금지 → `context-assembly-patterns.md`
- **Attachment 수집 순서**: 고정 ordinal. 기존 순서 변경 금지 (append-only) → `context-assembly-patterns.md` §Attachment 순서
- **CacheSafeParams (sub-agent fork)**: 부모의 prompt + tools + model byte-identical 상속 → `sub-agent-patterns.md`
- **도구 정의**: system prompt 에 inline 금지. API `tools` 파라미터로 별도 전달

### SSE Lifecycle (12 이벤트)

> **정본:** `_shared/sse-lifecycle.md` (12 이벤트 집합 + 순서 + 종료 보장 4 제약 — 언어 무관).
> 본 섹션은 Python 백엔드에서의 적용 지점만 명시.

12 이벤트 집합 / lifecycle 순서 / 종료 4 제약 (`done` 미누락 / `done`+`error` 배타 / `usage`
direct-before-`done` / payload 메타 혼합 금지) 은 `_shared/sse-lifecycle.md` 가 정본이며 본 rule
은 **Python 구현 측 제약만** 추가:

- `SSEEventType` Literal 과 `SSE_EVENT_TYPES` tuple 동기화 (`backend/engine/stream.py`)
- pydantic `BaseModel` 로 각 이벤트 data schema 정의
- `serialize_sse()` 단일 함수 (engine layer) 가 wire format 책임

wire format / keepalive / secret scrub 은 `sse-streaming-patterns.md` 가 정본.

## 새 SSE 이벤트 타입 추가하기

1. `SSEEventType` Literal + `SSE_EVENT_TYPES` tuple 에 새 값 추가 (`backend/engine/stream.py`)
2. lifecycle 위치 결정 — `done`/`error` 이전 배치
3. data schema 정의 (pydantic BaseModel)
4. stream.py 에 emit 로직 추가
5. 클라이언트 파서가 unknown event 무시하는지 확인 (하위 호환)
6. 문서 동시 업데이트: 본 rule lifecycle + `sse-streaming-patterns.md` 12 이벤트 집합 + `docs/api/frontend-contract.md` §5.2

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| SSE 이벤트 타입 추가/삭제 | `SSEEventType` + stream.py + 클라이언트 파서 + sse-streaming-patterns.md + frontend-contract.md §5.2 |
| SSE lifecycle 순서 변경 | 클라이언트 상태 머신 파괴 — 사실상 breaking change |
| 내부 타입 (Message / ContentBlock) 변경 | 모든 provider 의 `_convert_to/from` + engine + tools |
| ContextVar 필드 추가/삭제 | `ALL_FIELDS` + 미들웨어 + 로깅 설정 + 테스트 fixture + `bind_log_context` 화이트리스트 |
| 예외 계층 변경 | `error-handling.md` 의 4 패턴 / 4 예외 맵 + 모든 catch 블록 매칭 |
| 캐시 prefix 불변 3종 (도구 정렬 / Attachment 순서 / CacheSafeParams) 변경 | 모든 세션의 prompt cache 즉시 무효화 |

## 금지 사항

- SSE payload 에 session-wide 불변 메타 (token 수, cost, model, session_id) 혼합 — HTTP 헤더 또는 별도 이벤트
- 글로벌 mutable dict 로 요청 상태 관리
- 서브시스템 경계에서 외부 SDK 타입 반환 (반드시 내부 타입으로 변환)
- Protocol 대신 ABC 강제 (특별 이유 없으면 Protocol)
- `asyncio.sleep(0)` 이벤트 루프 양보 꼼수 — proper await 사용
- `structlog.contextvars.bind_contextvars` 직접 호출 (화이트리스트 우회)
- ContextVar 에 None 명시 bind (OMITTED 원칙 위반)
