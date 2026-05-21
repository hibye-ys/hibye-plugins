> App backend-overview capsule. Source: `.agents/rules/python_agent_rules/agent-loop-patterns.md` + live implementation under `backend/engine/`.

# Subsystem 01 — Agent Loop

## 목적 (1줄)

App의 메인 에이전트 루프. 사용자 메시지를 받아 LLM 호출과 tool_use 실행을
반복하며 최종 응답을 만든다.

## 파일 / 모듈

- `backend/engine/loop.py` — 메인 루프 구현. `while tool_use: execute → re-query`
- `backend/engine/recovery.py` — 에러 복구 (rate limit, prompt-too-long, max-output-tokens)
- `backend/engine/tool_executor.py` — 도구 실행 오케스트레이션 (병렬/순차)

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `run_agent_loop(request, session, context)` | 루프 엔트리포인트. SSE stream 반환 |
| `execute_round(agent, messages, tools)` | 한 라운드 (LLM 호출 → tool_use 실행) |
| `handle_provider_error(err, state)` | 에러 분류 및 복구 전략 선택 |
| `LoopState` | 루프-로컬 상태 (round, input_tokens, output_tokens, chain_depth) |
| `AbortSignal` | 외부 취소 시그널 (graceful shutdown + `/sessions/{id}/cancel`) |

## 루프 7 스테이지

1. 요청 수신 (message, context_hint, agent_name?, session_id?)
2. 에이전트 resolve (agent_name → 에이전트 정의 로드)
3. 모델 resolve (에이전트의 model_preference + 사용자 설정 + fallback)
4. system_prompt 조립 (Base + Agent + Context injection + 세션 메모리)
5. `while True`:
   a. 컴팩션 필요 여부 체크 → 필요 시 압축
   b. LLM API 호출 (stream=True)
   c. 스트리밍 중 text → SSE text 이벤트
   d. tool_use 블록 수집
   e. if no tool_use → break
   f. 도구 실행 (병렬 가능한 도구는 동시 실행)
   g. 결과를 messages에 추가
   h. action 추출 → SSE action 이벤트
6. 세션 상태 저장
7. SSE done 이벤트

## 담당 skill

`agent-loop` — `backend/engine/loop.py` 작성 전 반드시 로드.

## 범위

- 단일 에이전트 루프 (서브에이전트 없음 — )
- Compaction은 reactive fallback만 (에서 4 전략 풀세트)
- 에러 복구: rate_limit 재시도 + fallback provider 전환 기본형
- Abort signal은 graceful shutdown 수준 (유저 취소는  세션 API에서 확장)

## Gotchas

- **tool_use 순서 보존 필수**: LLM이 반환한 tool_use 블록의 id 순서를 그대로
  tool_result에 대응시켜야 한다. 병렬 실행 결과를 섞어 보내면 LLM이 혼란.
- **loop-local state vs session state**: round counter, chain_depth는 루프 한 번에
  국한되고 세션에 저장하지 않는다. 세션에 저장되는 것은 messages + cost 누적만.
- **취소 처리**: AbortSignal은 현재 라운드 완료 후에만 루프 종료 (중간에 쓰기가
  반 정도만 커밋된 상태를 만들지 않기 위해).

## 관련 rule

- `agent-loop-patterns.md` — 6-stage 구조 + LoopTransition enum (루프 진입점은 `/run/<name>` 기반)
- `ai-provider-patterns.md` — Provider Protocol + fallback chain (하드코딩 금지)
- `error-handling.md` — recovery.py 의 4 표준 패턴 (prompt-too-long, max-output-tokens 등)
