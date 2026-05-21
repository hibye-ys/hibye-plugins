---
paths:
  - "backend/engine/subagent.py"
  - "backend/tools/agents.py"
---

> App backend rules — Sub-Agent invariants, extension guide, impact map.
> **정본:** `_shared/spawn-limits.md` (3-mode / depth / isolation / CacheSafeParams / use_exact_tools — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `design-principles.md` (§3 캐시 안정성, §4 격리),
>       `tool-system-patterns.md` (allow/deny), `ai-provider-patterns.md` (model resolution),
>       `run-policy.md` (spawn_enabled + max_spawn_depth cross-field validation)

# sub-agent-patterns — 서브 에이전트

## 불변식 (Invariants)

### spawn_agent 도구의 3 Mode (사용자 API)

`spawn_agent` tool 의 `mode` 필드 — `SpawnMode = Literal["foreground", "in_process", "background"]` (`backend/tools/agents.py:71`):

| Mode | 동작 | 현재 구현 | 사용 시점 |
|------|------|----------|----------|
| `foreground` | blocking spawn — 결과까지 await | `SpawnRunner.run_foreground()` | 짧은 위임 (< timeout_seconds) |
| `in_process` | 별도 mailbox 로 병렬 실행 목표 | **foreground 의 alias (현재)** — mailbox/병렬 TBD | 미래 병렬 워크로드 |
| `background` | non-blocking, 부모 즉시 다음 턴 진행 | `SpawnRunner.schedule_background()` — `asyncio.Task` 기반 (**별도 프로세스 아님**) | 장시간 작업 (분 단위) |

**`in_process` 현재 상태**: `agents.py:97` 주석 `"alias of foreground today (separate mailbox TBD)"`. Rule 에 선언되어 있지만 **아직 구현 미완** — 사용자는 현재 foreground 와 동일 결과를 얻음. 별도 mailbox / 병렬 실행은 미래 작업.

### Forked Agent (엔진 내부, spawn_agent 와 별개)

Compaction summarizer / memory extraction 등 **엔진이 내부용으로 임시 에이전트를 fork** 하는 경로. 사용자 API `spawn_agent` 와 **다른 개념**:

- deepcopy 한 부모 state + CacheSafeParams 로 자식 실행
- 결과는 엔진이 소비 (user-facing tool 반환 아님)
- depth counter 는 여전히 적용됨 — `check_depth()` 공유
- 혼용 금지: "forked mode" 라는 spawn_agent 옵션은 없음

### Coordinator vs Worker 분리

- **Coordinator** 는 오케스트레이션 도구만 사용 (`spawn_agent`, `send_message`, `task_stop`)
- **Worker** 는 실행 도구만 사용 — **`spawn_agent` 호출 금지**
- Worker 가 `spawn_agent` 호출 시 `agents.py:194` 에서 reject (`"worker agents cannot invoke spawn_agent"`)
- 이유: worker 가 sub-agent 생성하면 무한 재귀 — depth limit 만으로는 비용 통제 불가

### Depth 제한

- spawn 전 `check_depth(ctx)` 호출 의무 (`_spawn_contract.py:52`)
- 유효 상한 = `min(MAX_SPAWN_DEPTH, policy.max_spawn_depth)`:
  - **`MAX_SPAWN_DEPTH = 3`** — 코드 하드 천장 (`_spawn_contract.py:39`). `policy.py:14` 가 `GLOBAL_MAX_SPAWN_DEPTH` 이름으로 re-export하여 `RunPolicy` cross-field validator 에서 참조
  - **`policy.max_spawn_depth`** — `RunPolicy` YAML 필드, per-run cap (engine 이 `ctx.metadata["policy_max_spawn_depth"]` 로 주입)
- YAML 에서 `max_spawn_depth: 0` 선언하면 spawn 시도가 코드 수준에서도 거부
- `spawn_enabled=True + max_spawn_depth=0` 모순 조합은 `RunPolicy` cross-field validator 가 **startup 에서 reject** (fail-fast)

### Deterministic Child ID

- 형식: `{name}@{team}`
- 같은 입력 → 같은 ID (결정론적)
- `@` 를 name/team 구성요소에 사용 금지 (파싱 충돌)

### State Isolation

- messages, tool decisions, file cache 는 **deepcopy** 로 자식에게 전달
- 자식의 상태 변이가 부모에 보이면 버그 — 격리 불변 (design-principles §4)
- **예외 (공유 허용)**:
  - abort signal: 부모 → 자식 cascade (자식 즉시 중단)
  - ContextVar trace 필드 (request_id, trace_id, span_id 등 10개): read-only 관측용, spawn 시 `copy_context()` + `spawn_depth+1` rebind

### CacheSafeParams (fork agent 전용)

- 클래스: `CacheSafeParams` (`backend/engine/subagent.py:89`)
- Fork agent 는 부모의 `system_prompt` + `tools` + `message_prefix` 를 **byte-identical** 로 상속
- 모델도 부모 모델 그대로 사용 → prompt cache hit → 비용 절감 (design-principles §3)
- 해석 헬퍼: `resolve_cache_safe_params(ctx)` — `ctx.metadata` 에서 read-only 로 꺼냄

### `use_exact_tools` 플래그

- `SpawnAgentInput.use_exact_tools: bool` (`agents.py:107`) — snake_case (Python 관례)
- `True`: 자식이 부모의 tool pool 을 **필터링 없이 그대로** 사용 (캐시 안정성 확보)
- `False`: 자식 agent 의 own allowed_tools 로 재필터링 — 부모 tool cache 무효화 (`agents.py:203` `reason="use_exact_tools=False invalidates parent tool cache"`)
- 구현: `backend/engine/child_runner.py:73`

### Model Override Priority

1. `spawn_agent` explicit `model` 파라미터 (worker 대상)
2. 자식 agent definition (`agents/{name}.yaml::model_preference`)
3. 부모 model (fork agent 는 무조건 이것)
4. system default

**Fork agent 는 모든 override 무시하고 부모 모델 고정** — CacheSafeParams 가 depends on it.

### Background 완료 Notification

- 완료 시 부모 session 에 구조화된 알림 inject
- Notification event 예: `{"kind": "background_agent_completed", ...}` (`loop.py:1348`)
- 전달 경로: SSE notification event 또는 session inbox (추후 확장 포인트)
- Payload: status, summary, result, usage(토큰/비용)
- 부모가 turn 진행 중이면 다음 turn 시작 시 inbox 에서 수확

## 새 에이전트 타입 추가하기

1. `agents/{name}.yaml` 생성 (필수 필드: `name`, `description`, `system_prompt_file`)
2. `agents/prompts/{name}.md` 에 system prompt 작성
3. `tools` 리스트에 허용 도구 명시 (미명시 시 전체 허용)
4. `model_preference` 에 선호 모델 순서 지정
5. Coordinator 역할이면 도구를 **오케스트레이션 도구** 로 제한 (`spawn_agent`, `send_message`, `task_stop`), worker 역할이면 `spawn_agent` 를 allowed_tools 에서 **반드시 제외**
6. 테스트: 해당 에이전트로 1회 실행 + 도구 호출 검증

## 새 spawn mode 추가 시 체크리스트

1. `SpawnMode` Literal (`agents.py:71`) 에 새 값 추가
2. `SpawnRunner` 에 실행 함수 추가 (run_foreground / schedule_background 와 동등)
3. 격리 수준 정의 (state clone 방식)
4. 통신 방식 정의 (직접 반환 / mailbox / notification)
5. abort cascade 방식 정의
6. CacheSafeParams 적용 여부 결정
7. `check_depth()` 경유 보장
8. shutdown coordination 방식 정의 (특히 장기 실행 mode)

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| `MAX_SPAWN_DEPTH` 변경 | 너무 낮으면 유용한 위임 불가, 너무 높으면 자원 고갈 + RunPolicy validator reject 경계 |
| `SpawnMode` Literal 변경 | tool input schema, client (spawn_agent 호출 측), test fixture 동시 업데이트 |
| `in_process` 실제 구현 (mailbox) | 별도 worker queue + message passing 프로토콜 설계 — 큰 작업 |
| `CacheSafeParams` 구조 변경 | 모든 fork agent 의 cache hit 여부 전면 재검증 |
| `use_exact_tools` 기본값 변경 | 기존 spawn 호출의 tool 범위 바뀜 → 예기치 않은 도구 사용 가능 |
| Coordinator 허용 도구 변경 | coordinator 가 직접 작업하거나 필요 오케스트레이션 못할 수 있음 |
| State isolation 방식 변경 | 격리 깨지면 sub-agent 간 오염 → 디버깅 불가능 |
| agent YAML schema 변경 | 모든 기존 YAML + loader 동시 업데이트 |
| Notification 구조/`kind` 변경 | SSE 클라이언트 파서 + session inbox 처리 로직 |
| `spawn_enabled` + `max_spawn_depth=0` 모순 허용 | startup validator 약화 — runtime 에 뒤늦게 실패 |

## 금지 사항

- Worker 에게 `spawn_agent` / `spawn_*` 도구 허용 (무한 재귀 위험 — coordinator-only)
- `check_depth()` 생략 후 spawn
- Sub-agent state 를 부모와 mutable 하게 공유 (abort signal + ContextVar trace 필드만 예외)
- Fork agent 에서 CacheSafeParams 깨기 (model / prompt / tools 부모와 다르게)
- Fork agent 에 model override 적용 (부모 모델 고정 — cache 안정성 필수)
- `in_process` mode 를 "현재 병렬 실행 가능" 으로 문서화 (실제는 foreground alias — 미래 TBD)
- Background spawn 을 "별도 프로세스" 로 문서화 (실제는 `asyncio.Task`)
- Sub-agent ID 에 `@` 외 구분자 사용 (deterministic ID 규칙 위반)
- Background agent 완료 알림 생략 (silent finish → session inbox 비어있음)
- 레지스트리 runtime mutate 로 sub-agent 추가/제거
- `spawn_agent` tool 에 `forked` 같은 엔진 내부 mode 노출 (사용자 API 와 내부 fork 분리)
