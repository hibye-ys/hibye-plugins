---
name: spawn-limits
description: Sub-agent spawn 상한 (`MAX_SPAWN_DEPTH=3`), 3 mode, coordinator/worker 분리, state isolation, CacheSafeParams invariant.
metadata:
  role: invariant
  scope: project
  source: stack-backend-python/_shared/spawn-limits.md
---

**적용된 §4.4 매트릭스 행**: 동시성 (asyncio.gather → Promise.all), 프로세스 분리 (runtime-specific background task helper — 한계 명시), 큐 (BackgroundTasks → Promise + runtime background task 동등 패턴). Runtime 제약 (CPU 시간 / background task 길이) 은 instance 측 project-local skill 참조. `p-limit` 라이브러리 권장.

> Language-neutral invariants — Sub-agent spawn limits, isolation, cache discipline.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/sub-agent-patterns.md`, `ts_agent_rules/sub-agent-patterns.md`.

# Sub-Agent Spawn Limits — 언어 무관 불변식

## 핵심 상수

| 상수 | 값 | 의미 |
|------|----|------|
| `MAX_SPAWN_DEPTH` | **3** | 코드 하드 천장. 어떤 RunPolicy 도 이 값을 초과 불가. `policy.ts` 가 `GLOBAL_MAX_SPAWN_DEPTH` 라는 별칭으로 re-export |
| `policy.max_spawn_depth` | YAML, `ge=0` | per-run cap. 유효 상한 = `Math.min(MAX_SPAWN_DEPTH, policy.max_spawn_depth)` |

`max_spawn_depth: 0` 선언 시 spawn 시도가 코드 수준에서도 거부.

## spawn_agent 도구의 3 Mode (사용자 API)

| Mode | 동작 | 현재 구현 | 사용 시점 |
|------|------|----------|----------|
| `foreground` | blocking spawn — 결과까지 await | `runForeground()` | 짧은 위임 (< timeout_seconds) |
| `in_process` | 별도 mailbox 로 병렬 실행 목표 | **foreground 의 alias (현재)** — mailbox/병렬 TBD | 미래 병렬 워크로드 |
| `background` | non-blocking, 부모 즉시 다음 턴 진행 | `scheduleBackground()` — 같은 프로세스 내 Promise + runtime background task helper (**별도 프로세스 아님**) | 장시간 작업 (분 단위) |

`in_process` 는 rule 에 선언되어 있지만 **아직 구현 미완** — 사용자는 현재 foreground 와 동일 결과를 얻음. 별도 mailbox / 병렬 실행은 미래 작업.

**Runtime 제약**: 일부 runtime 의 background task helper 는 CPU time limit 및 실행 시간 한계 있음. 장시간 background 작업은 long-running process 전용이거나 외부 큐 위임 검토 필요 (구체 한계는 instance 측 project-local skill 참조).

병렬 실행 시 concurrency 제어: `p-limit` 라이브러리 권장.

```ts
import pLimit from 'p-limit';
const limit = pLimit(5); // 최대 5개 동시
const results = await Promise.all(tasks.map((t) => limit(() => runAgent(t))));
```

## Forked Agent (엔진 내부, spawn_agent 와 별개)

Compaction summarizer / memory extraction 등 **엔진이 내부용으로 임시 에이전트를 fork** 하는 경로. 사용자 API `spawn_agent` 와 **다른 개념**:

- 부모 state 를 복제 + `CacheSafeParams` 로 자식 실행
- 결과는 엔진이 소비 (user-facing tool 반환 아님)
- depth counter 는 여전히 적용됨 — `checkDepth()` 공유
- 혼용 금지: "forked mode" 라는 spawn_agent 옵션은 없음

## Coordinator vs Worker 분리

- **Coordinator** 는 오케스트레이션 도구만 사용 (`spawn_agent`, `send_message`, `task_stop`)
- **Worker** 는 실행 도구만 사용 — **`spawn_agent` 호출 금지**
- Worker 가 `spawn_agent` 호출 시 reject (메시지: `"worker agents cannot invoke spawn_agent"`)
- 이유: worker 가 sub-agent 생성하면 무한 재귀 — depth limit 만으로는 비용 통제 불가

## RunPolicy 와의 cross-field 충돌 (startup fail-fast)

- `spawn_enabled=true` + `max_spawn_depth=0` → startup `ValidationError` (모순)
- `spawn_enabled=true` + `allowed_tools` 에 `spawn_agent` 없음 → startup `ValidationError`
- `max_spawn_depth > MAX_SPAWN_DEPTH (=3)` → startup 실패

## Deterministic Child ID

- 형식: `{name}@{team}`
- 같은 입력 → 같은 ID (결정론적)
- `@` 를 name/team 구성요소에 사용 금지 (파싱 충돌)

## State Isolation

- messages, tool decisions, file cache 는 **자식에게 deep copy** 로 전달 (TS: `structuredClone()`)
- 자식의 상태 변이가 부모에 보이면 버그 — 격리 불변 (design-principles §4)
- **예외 (공유 허용)**:
  - **abort signal**: 부모 → 자식 cascade (자식 즉시 중단), TS `AbortController` 전파
  - **trace 필드 10개** (`request_id`, `trace_id`, `span_id`, `session_id`, `user_id`, `run_name`, `agent`, `model`, `turn_count`, `spawn_depth`): read-only 관측용. spawn 시 fresh context 복제 + `spawn_depth + 1` rebind (부모 오염 방지)

## CacheSafeParams (fork agent 전용)

Fork agent 는 부모의 다음 항목을 **byte-identical** 로 상속:

- `system_prompt` — 변경 시 prefix cache miss
- `tools` 목록 — 정렬·필터 모두 동일
- `message_prefix` — 첫 N 메시지 동일
- `model` — 부모 모델 그대로 (override 무시)

→ prompt cache hit → 비용 절감 (design-principles §3).

해석 헬퍼: `resolveCacheSafeParams(ctx)` — 컨텍스트의 metadata 에서 read-only 로 꺼냄.

## `use_exact_tools` 플래그 (사용자 API)

| 값 | 동작 | 결과 |
|----|------|------|
| `true` | 자식이 부모의 tool pool 을 **필터링 없이 그대로** 사용 | parent tool cache 보존 |
| `false` | 자식 agent 의 own `allowed_tools` 로 재필터링 | parent tool cache 무효화 (`reason="use_exact_tools=false invalidates parent tool cache"`) |

기본값은 보수적 (false 또는 명시 필수) — 캐시 보존이 필요한 경우 명시적 opt-in.

## Model Override Priority

1. `spawn_agent` explicit `model` 파라미터 (worker 대상)
2. 자식 agent definition (`agents/{name}.yaml::model_preference`)
3. 부모 model (fork agent 는 무조건 이것)
4. system default

**Fork agent 는 모든 override 무시하고 부모 모델 고정** — `CacheSafeParams` 가 의존.

## Background 완료 Notification

- 완료 시 부모 session 에 구조화된 알림 inject
- Notification event: `{"kind": "background_agent_completed", "status": ..., "summary": ..., "result": ..., "usage": {...}}`
- 전달 경로: SSE notification event 또는 session inbox (mpsc / queue, 추후 확장 포인트)
- 부모가 turn 진행 중이면 다음 turn 시작 시 inbox 에서 수확

## 공통 금지 사항 (언어 무관)

- Worker 에게 `spawn_agent` / `spawn_*` 도구 허용 (무한 재귀 위험)
- `checkDepth()` 생략 후 spawn
- Sub-agent state 를 부모와 mutable 하게 공유 (abort + trace 필드만 예외)
- Fork agent 에서 `CacheSafeParams` 깨기 (model / prompt / tools 부모와 다르게)
- Fork agent 에 model override 적용 (부모 모델 고정 — cache 안정성 필수)
- `in_process` mode 를 "현재 병렬 실행 가능" 으로 문서화 (실제는 foreground alias)
- Background spawn 을 "별도 프로세스" 로 문서화 (실제는 같은 프로세스 task)
- Sub-agent ID 에 `@` 외 구분자 사용
- Background agent 완료 알림 생략
- 레지스트리 runtime mutate 로 sub-agent 추가/제거
- `spawn_agent` tool 에 `forked` 같은 엔진 내부 mode 노출 (사용자 API 와 내부 fork 분리)
