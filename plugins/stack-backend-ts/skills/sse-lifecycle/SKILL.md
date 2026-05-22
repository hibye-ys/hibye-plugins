---
name: sse-lifecycle
description: SSE 12 이벤트 집합 + lifecycle 순서 + 종료 보장 4 제약 invariant. 이벤트 타입 추가/순서 변경은 클라이언트 상태머신 breaking change.
metadata:
  role: invariant
  scope: project
---

> **정본** — App backend SSE 이벤트 lifecycle / 12 이벤트 집합 / 종료 보장 제약.
> 언어/프레임워크 무관 (Python / TS 공통). 양쪽 `*_agent_rules/sse-streaming-patterns.md`,
> `*_agent_rules/core-infrastructure.md`, 그리고 `frontend-contract.md` 에서 본 파일을
> 단일 source of truth 로 참조한다.

# SSE Lifecycle — 12 이벤트 정본

## 12 이벤트 집합 (고정)

```
session, agent, text, thinking, tool_call, tool_result, action, notification,
suggestions, usage, done, error
```

새 이벤트가 필요하다고 느껴지면 **대부분 기존 페이로드 확장으로 해결** 한다. 이벤트 타입 추가는 클라이언트 상태머신과 frontend-contract 모두 호환성 영향을 주므로 신중히 검토.

## Lifecycle 순서

```
session → agent → (text | thinking | tool_call | tool_result | action | notification | agent)*
        → suggestions? → usage → done | error
```

- `session` 1회로 시작
- `agent` **1회 이상** (스트림 시작 직후 1회 + sub-agent spawn 시마다 추가 emit — 현재 active agent 메타 갱신)
- 본문 이벤트 (text/thinking/tool_call/tool_result/action/notification) + 후속 `agent` 0회 이상 반복
- `suggestions` 선택 (0 또는 1회)
- `usage` 1회
- `done` 또는 `error` 1회로 종료

## 종료 보장 4 제약

1. **`session` 이후 반드시 `done` 또는 `error` 로 종료.** 연결 drop 만으로 끝나면 안 됨 (서버측에서 의도적 종료 이벤트 emit 필수).
2. **`done` 과 `error` 는 배타.** 한 스트림에서 둘 다 보내지 않음.
3. **`usage` 는 `done` 직전에 전송** (token 수 / 비용 메타 누적치를 done 전 fence-line 으로 emit).
4. **SSE payload 에 session-wide 불변 메타 (token 수, 비용, model, session_id) 혼합 금지.**
   별도 `usage` 이벤트 또는 HTTP 헤더 (`X-App-*`) 로만 전달.

## 백그라운드 태스크 / 프로세스 분리

본 lifecycle 은 in-stream 이벤트 순서만 정의한다. 스트림 응답 이후에도 살아남아야 하는 부수 작업 (예: 로깅 flush, 비동기 DB 커밋, 백그라운드 spawn 알림) 은 런타임 특화 메커니즘으로 처리한다:

> 백그라운드 태스크 스케줄링은 `<runtime>` 특화 (예: Node `setImmediate`, edge runtime 의 background task helper, Bun 등 — instance 측 project-local skill 에서 정의)

별도 OS 프로세스 분리 (subprocess) 는 일부 런타임에서 지원되지 않으므로 instance 측에서 런타임 가용성을 확인하고 폴백 경로를 명시할 것.

## 이벤트 카테고리 + payload field

| 이벤트 | 카테고리 | 빈도 | payload 주요 필드 |
|--------|---------|------|-------------------|
| `session` † | lifecycle | 1 | `session_id`, `request_id` |
| `agent` † | lifecycle | 1+ | `agent`, `model` (sub-agent spawn 시 추가 emit) |
| `text` | content | * | `text: string` (assistant text delta) |
| `thinking` | content | * | `text: string` (reasoning trace — provider 지원 시) |
| `tool_call` | content | * | `id`, `name`, `final_input: object` |
| `tool_result` | content | * | `tool_use_id`, `content`, `is_error: boolean` |
| `action` | content | * | `result_summary: string` (UI 사용자 visible action — `<tool_output>` 등) |
| `notification` | content | * | free-form object (background spawn 완료, queued media job 등) |
| `suggestions` | content | 0\|1 | `prompts: string[]` (사용자 후속 입력 제안) |
| `usage` | meta | 1 | `input_tokens`, `output_tokens`, `cost_usd`, `cache_creation_input_tokens`, `cache_read_input_tokens` |
| `done` | terminal | 0\|1 | `turn_count` 등 (정상 종료, `error` 와 배타) |
| `error` | terminal | 0\|1 | `code: string`, `message: string` (scrubbed; 다른 필드 ✕) |

**† lifecycle 이벤트 (`session` 1회 / `agent` 1회 이상 — sub-agent spawn 시 추가 emit) 의 payload 는 HTTP 헤더 (`X-App-Session-Id` / `X-Request-Id` / `X-App-Agent` / `X-App-Model`) 와 *의도적 중복*** — primary 전달 경로는 HTTP 헤더 (CORS expose 의무, [[cors-policy]] / [[http-error-sentinels]]). SSE payload 는 클라이언트 상태머신이 lifecycle transition 시점 (스트림 시작 + sub-agent spawn) 에 메타를 read 하기 위한 echo. 이는 §"종료 보장 4 제약" 의 *"session-wide 불변 메타 혼합 금지"* (token 수 / 비용 / 다른 이벤트에서의 session_id 재첨부) 와 [[sse-streaming]] §"헤더 분리" 의 *"content/meta/terminal payload 혼합 ✕"* 와 충돌하지 않음 — 금지는 **lifecycle 이외** 이벤트 (text / tool_call / usage / done / error 등) 에 session-wide 메타가 끼어드는 경우.

scrub 대상 분류 (7 SCAN events vs 5 non-scan) 는 [[sse-streaming]] workflow §"SCAN_EVENTS — scrub 대상 7개" 참조.

## 변경 영향

12 이벤트 집합 또는 lifecycle 순서 변경은 **클라이언트 상태머신 파괴 = breaking change**. 변경 시:

- 본 `skills/sse-lifecycle/SKILL.md` 갱신
- `*_agent_rules/sse-streaming-patterns.md` (양 언어) 추가 갱신 (wire format / 인코딩)
- `*_agent_rules/core-infrastructure.md` (양 언어) 추가 갱신
- `docs/api/frontend-contract.md` §5.2 갱신
- 프론트엔드 SSE 파서 (앱 측) 호환성 검증

## 금지 사항

- SSE payload 에 session-wide 메타 (token 수, cost, model, session_id) 혼합
- `done` 또는 `error` 누락 (연결 drop 만으로 종료)
- `usage` 를 `done` 이후에 전송
- 새 이벤트 타입을 본 12 집합 외부에 추가 (호환성 영향 평가 없이)
- Lifecycle 순서 변경 (예: `agent` 를 `session` 이전에)
