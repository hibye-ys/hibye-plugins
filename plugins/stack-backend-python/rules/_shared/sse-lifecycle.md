> **정본** — App backend SSE 이벤트 lifecycle / 12 이벤트 집합 / 종료 보장 제약.
> 언어 무관 (Python / Rust 공통). 양쪽 `*_agent_rules/sse-streaming-patterns.md`,
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
session → agent → (text | thinking | tool_call | tool_result | action | notification)*
        → suggestions? → usage → done | error
```

- `session` 1회로 시작
- `agent` 1회 (현재 active agent 메타)
- 본문 이벤트 (text/thinking/tool_call/tool_result/action/notification) 0회 이상 반복
- `suggestions` 선택 (0 또는 1회)
- `usage` 1회
- `done` 또는 `error` 1회로 종료

## 종료 보장 4 제약

1. **`session` 이후 반드시 `done` 또는 `error` 로 종료.** 연결 drop 만으로 끝나면 안 됨 (서버측에서 의도적 종료 이벤트 emit 필수).
2. **`done` 과 `error` 는 배타.** 한 스트림에서 둘 다 보내지 않음.
3. **`usage` 는 `done` 직전에 전송** (token 수 / 비용 메타 누적치를 done 전 fence-line 으로 emit).
4. **SSE payload 에 session-wide 불변 메타 (token 수, 비용, model, session_id) 혼합 금지.**
   별도 `usage` 이벤트 또는 HTTP 헤더 (`X-App-*`) 로만 전달.

## 이벤트 카테고리

| 이벤트 | 카테고리 | 빈도 | 설명 |
|--------|---------|------|------|
| `session` | lifecycle | 1 | 스트림 시작 — session_id, request_id 발행 |
| `agent` | lifecycle | 1+ | 현재 turn 의 agent 메타 (sub-agent spawn 시 추가 emit) |
| `text` | content | * | assistant text delta |
| `thinking` | content | * | reasoning trace (provider 가 지원하는 경우) |
| `tool_call` | content | * | tool 호출 시작 marker (id + name + input) |
| `tool_result` | content | * | tool 결과 (id + content + is_error) |
| `action` | content | * | UI 측 사용자 visible action (`<tool_output>` 등) |
| `notification` | content | * | 비동기 알림 (background agent 완료, queued media job 등) |
| `suggestions` | content | 0\|1 | 사용자 후속 입력 제안 |
| `usage` | meta | 1 | input_tokens / output_tokens / cost / cache_creation / cache_read |
| `done` | terminal | 0\|1 | 정상 종료 |
| `error` | terminal | 0\|1 | 에러 종료 (`error_code` + 사용자 메시지) |

## 변경 영향

12 이벤트 집합 또는 lifecycle 순서 변경은 **클라이언트 상태머신 파괴 = breaking change**. 변경 시:

- 본 `_shared/sse-lifecycle.md` 갱신
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
