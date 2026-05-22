---
name: incident-triage
description: Use when a user reports a post-deploy incident — classifies the symptom and dispatches to the correct first-line diagnostic asset. Generic framework (matrix-based) — not a playbook library. Defines the 7 symptom classes, structlog ContextVar correlation, evidence collection checklist, and incident report template. `/incident` command is the entry point; this skill is the authoritative matrix. When specific incidents recur, grow the "Specific playbooks" section at the bottom.
allowed-tools: Read, Bash, Grep, Glob
---

# incident-triage — 배포 후 incident 1차 진단 dispatch

## 이 skill은 언제 로드되는가

- `/incident` command 실행
- 사용자가 "이런 문제가 나는데" / "왜 이런 증상이 있지" / "customer reports X" 언급
- 배포 후 모니터링 대시보드 / 로그 이상 발견

## 범위 (vs debug-session vs agent-loop-manager debug)

| 측면 | `debug-session` skill | `agent-loop-manager` (debug mode) | **incident-triage** (this) |
|------|---------------------|----------------------------------|---------------------------|
| 시점 | 개발 중 bug | 개발/운영 모두 loop 내부 | 배포 후 실 사용자 incident |
| 범위 | 단일 테스트/함수 | 6-stage loop 내부 | **전체 시스템** (어디부터 파야 할지) |
| 입력 | 구체 에러 메시지 | 로그 + loop state | 사용자 증상 서술 ("느리다", "답변이 이상") |
| 출력 | 버그 원인 가설 | loop stage fix | 1차 진단 경로 (어느 도구로 dispatch) |

## structlog ContextVar 상관관계 (10 필드)

`core-infrastructure.md` §ContextVar 10 필드 — incident 시 request 추적에 필수:

```
request_id, trace_id, span_id, session_id, user_id,
run_name, agent, model, turn_count, spawn_depth
```

**기본 correlation 경로**:
1. 고객 리포트에서 **`request_id` 또는 session URL 확보** (프론트 CORS expose 헤더 `X-Request-Id`, `X-App-Session-Id`)
2. `request_id` 로 해당 요청의 전체 로그 추출:
   ```bash
   # 예시 (harness allow 에는 없음, 실 서버에서만)
   grep '"request_id":"<id>"' logs/ai_backend.log | jq .
   ```
3. `turn_count` + `spawn_depth` 로 loop 상태 추적, `model` 로 provider 파악
4. 증상 class 매핑 후 해당 도구로 dispatch

## Symptom Class Matrix (7 classes)

각 class 는 **증상 keyword → 1차 진단 도구 → 증거 수집 체크리스트** 3요소.

### Class 1: SSE stream 이상

- **키워드**: "SSE 끊김", "응답 중간에 멈춤", "stream hang", "done 이벤트 안 옴", "connection dropped"
- **1차 도구**:
  1. `/sse-trace <message...>` — 로컬 재현 (실 서버 재현 전제). 엔드포인트 override 는 `APP_SSE_TRACE_RUN` env 로 주입
  2. `output-stream-manager` (stream-audit 모드) — SSE lifecycle + scrub_secrets 감사
- **증거 수집**:
  - [ ] 마지막으로 수신된 이벤트 type (text / tool_call / done / error?)
  - [ ] `done_seen` 로그 (`loop.terminal_missing` WARN 있는지 — stream.py finally 안전망)
  - [ ] ping=15 keepalive 정상 수신 여부 (nginx/cloudflare timeout?)
  - [ ] ClientDisconnect 발생 여부 (클라이언트가 먼저 끊었는지 서버가?)
  - [ ] `scrub_secrets` fast-path anchor 미포함으로 통과된 payload 에 PII 포함 의심?

### Class 2: Latency 이상

- **키워드**: "응답 느림", "timeout", "10초 이상", "slow response"
- **1차 도구**:
  1. `infra-performance-manager` (resource 모드) — concurrency, blocking I/O, 리소스 고갈
  2. `provider-manager` (debug 모드) — circuit breaker 상태, fallback chain 진입
- **증거 수집**:
  - [ ] provider circuit breaker state (CLOSED / OPEN / HALF_OPEN)
  - [ ] tool_call 수 + tool 실행 시간 (agent-loop-manager debug 보조)
  - [ ] blocking I/O 의심 (asyncio.to_thread 누락?)
  - [ ] DB connection pool 고갈? (`/debug/*` mount 활성 시 확인)
  - [ ] MCP 서버 응답 지연 (tools-manager mcp-audit)

### Class 3: Quality degradation

- **키워드**: "답변 이상", "품질 저하", "엉뚱한 답", "hallucination"
- **1차 도구**:
  1. `prompt-context-manager` (audit 모드) — TokenBudget, 3-Layer, cache miss
  2. `provider-manager` (debug 모드) — 모델 변경? fallback 진입?
- **증거 수집**:
  - [ ] 해당 요청의 **resolved `model`** (fallback chain 소진으로 다른 모델 사용?)
  - [ ] prompt cache hit 여부 (Anthropic `cache_read_input_tokens` 값)
  - [ ] 3-Layer prompt 에 동적 값 유입? (recent commit 검사)
  - [ ] Attachment 순서 변경? (cache prefix 무효화)
  - [ ] Compaction 발생 여부 + strategy (snip/micro/auto/reactive 중 뭐였는지)

### Class 4: Cost spike

- **키워드**: "비용 급증", "token 폭증", "cost spike", "billing alert"
- **1차 도구**:
  1. `usage-tracking` skill — usage 이벤트 emission 정합성
  2. `provider-manager` (catalog-sync 모드) — 모델 가격 변경 여부 + `MODEL_COSTS` 정합
- **증거 수집**:
  - [ ] 급증 시점 전후 24h 의 `usage` 이벤트 집계 (input / output / cache_read / cache_creation)
  - [ ] `DEFAULT_UNKNOWN_COSTS` WARNING 로그 다수 (pricing lookup 실패)
  - [ ] fallback chain 진입 빈도 증가? (비싼 모델 fallback)
  - [ ] compaction AUTO 전략 폭증? (요약 LLM 호출 비용)
  - [ ] 특정 user_id 에 집중된 요청?

### Class 5: DB / 외부 도메인 이상

- **키워드**: "DB 에러", "data 저장 안 됨", "외부 도메인 변경 반영 안 됨", "session 사라짐"
- **1차 도구**:
  1. `data-state-manager` (data-audit 모드) — WriteCoordinator, StoragePort, 단일 writer
  2. raw SQL 확인: `SELECT ... FROM ai_backend.<domain>_mutations ORDER BY created_at DESC LIMIT 50`
- **증거 수집**:
  - [ ] 최근 `ai_backend.<domain>_mutations` append 성공/실패 기록
  - [ ] `lock_project(project_id)` advisory lock 정상 획득?
  - [ ] `<DOMAIN>_DATABASE_URL` 과 `APP_DATABASE_URL` 분리 유지?
  - [ ] `SessionPort` vs `SessionHistoryPort` 분리 — 어느 쪽에서 누락?
  - [ ] Alembic revision 과 실 DB schema 일치?

### Class 6: MCP 연결 이상

- **키워드**: "MCP tool 안 보임", "외부 도구 실패", "MCP disconnected"
- **1차 도구**:
  1. `tools-manager` (mcp-audit 모드) — 5-state 전이 감사
  2. `GET /debug/tools/mcp` (debug mount 활성 시) — 실시간 ConnectionState
- **증거 수집**:
  - [ ] 해당 MCP 서버의 `ConnectionState` (disabled/pending/connected/needs_auth/failed)
  - [ ] `_tools_cache` memoized 상태 (lazy reconnect 대상?)
  - [ ] `${VAR}` 치환 실패 (env var 누락으로 empty string → auth 실패?)
  - [ ] `mcp.state_transition` 로그 최근 기록
  - [ ] `mcp__<server>__<tool>` 네이밍 정합

### Class 7: Tool 반복 실패

- **키워드**: "tool X 항상 실패", "같은 에러 반복", "tool_error"
- **1차 도구**:
  1. `tools-manager` (tool-audit 모드) — 도구 등록 + 권한 + concurrency
  2. `agent-loop-manager` (debug 모드) — `LoopTransition=tool_error` 여부
- **증거 수집**:
  - [ ] 해당 tool 의 `validate_input` / `check_permissions` 통과 여부
  - [ ] `is_concurrency_safe(args)` 가 parallel batch 오분류?
  - [ ] `tool_result` 의 `is_error=True` 메시지 (design-principles §5 — 모델에 반환되는 구조화 에러)
  - [ ] `TOOL_PREVIEW_MAX_CHARS` (4000자) 초과로 head-truncate 된 중요 정보?
  - [ ] MCP tool 이면 Class 6 과 병행 조사

## 증거 수집 → 가설 → 검증 3단계 플로우

모든 class 공통 원칙:

1. **증거 수집 (Collect)**: 위 체크리스트로 로그/메트릭/상태 스냅샷 확보. **추측 금지** — 증거가 부족하면 수집으로 돌아감
2. **가설 (Hypothesize)**: 수집된 증거로부터 가능한 원인 1-3 개 열거. 가장 증거가 뒷받침하는 것을 primary hypothesis 로
3. **검증 (Verify)**: primary hypothesis 를 검증하는 실험 1개 설계 (로컬 재현 / 로그 추가 / 특정 설정 변경). 확인되지 않으면 다른 가설로

## Incident Report 템플릿 (report-template)

incident 마무리 시 작성 — 팀 공유 / 재발 방지:

```markdown
# Incident Report — YYYY-MM-DD HH:MM

## Summary (1줄)
<한 줄로 무슨 일이 있었는지>

## Impact
- 영향받은 user_id / session_id 범위:
- 기간: YYYY-MM-DD HH:MM UTC ~ HH:MM UTC
- 심각도: P0 / P1 / P2
- 증상 class: <1-7 중>

## Reproduction
(재현 가능한 경우 최소 재현 시나리오)
- 요청: POST /run/<name> body `{...}`
- 예상: ...
- 실제: ...

## Root Cause
(증거 수집 + 가설 + 검증 결과)

## Mitigation
(즉시 완화 조치 — rollback / config toggle / restart 등)

## Timeline
- HH:MM 증상 보고 수신
- HH:MM /incident 실행 → class N 로 분류
- HH:MM 증거 수집 완료
- HH:MM root cause 확인
- HH:MM mitigation 적용
- HH:MM 정상 복구 확인

## Prevention
(재발 방지 — rule 변경 / test 추가 / 모니터링 추가 / specific playbook 승격 등)

## Related Artifacts
- request_id: <...>
- session_id: <...>
- 관련 PR / commit:
- 관련 로그 파일:
```

## 새 symptom class 추가하기

위 7 class 로 분류 안 되는 증상이 반복 발생하면:

1. 새 class 정의 (키워드 + 1차 도구 + 증거 수집 체크리스트)
2. 기존 class 와 중복 최소화 — 증거 수집 항목이 50% 이상 겹치면 기존 class 확장으로
3. 1차 도구는 **기존 자산 조합**을 우선 (신규 도구는 별도 설계 필요)
4. 실 incident 1건 이상 근거로 추가 (추측 기반 class 팽창 방지)

## Specific playbooks (향후 축적)

현재 비어있음. 실 incident 누적 시 추가:

```
### [YYYY-MM-DD] "<증상 요약>"
- 해당 class: N
- 특이점: <generic matrix 로 못 잡은 부분>
- 빠른 진단: <이 시나리오 전용 단축 경로>
- 해결: <구체 조치>
```

## 절대 금지

- 추측 기반 처방 (증거 없이 "이게 원인일 것" 제시)
- Incident report 없이 incident 종결 (재발 방지 학습 누락)
- 외부 모니터링 툴 (Datadog, Sentry) 에 직접 질의 (structlog 출력만 대상)
- 고객 데이터 / API key 를 incident report 에 포함 (scrub_secrets 원칙 유지)
- 사용자 로그 파일 직접 조작 / 수정 (read-only)
- `/incident` 가 자동으로 다음 도구 실행 (반드시 사용자 승인 후 dispatch)
