---
name: incident-triage
description: 배포 후 incident 1차 진단 dispatch. 사용자 증상 ("느림", "응답 이상", "tool 실패") → 7 symptom class 분류 → 1차 진단 도구 / 증거 수집 체크리스트로 dispatch. Workers tail / Sentry / Logflare 라이브 로그 + AsyncLocalStorage 10 필드 상관관계.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/incident-triage
---

**적용된 §4.4 매트릭스 행**: `loguru` / `structlog` → `pino` (Node) 또는 `console.log(JSON.stringify(...))` (Workers, Logflare 적재), `structlog.contextvars` ContextVar 10 필드 → `AsyncLocalStorage<RequestContext>` 10 필드, `prometheus` 메트릭 → **Cloudflare Analytics Engine** 또는 **Sentry**, alerting `pagerduty` / `opsgenie` → **PagerDuty** / **Sentry Issue Alert**, `os.getenv` → `c.env.<NAME>`, 라이브 로그 tail → `wrangler tail` (Workers) / `pino-tail` (Node), DB raw SQL → Drizzle `db.execute(sql\`...\`)`

# incident-triage — 배포 후 incident 1차 진단 dispatch

## 이 skill 은 언제 invoke 되는가

- `/incident` command 실행
- 사용자가 "이런 문제가 나는데" / "왜 이런 증상이 있지" / "customer reports X" 언급
- 배포 후 모니터링 대시보드 / 로그 이상 발견

## 범위 (vs debug-session vs agent-loop debug)

| 측면 | `debug-session` skill | `agent-loop` (debug 모드) | **incident-triage** (this) |
|------|---------------------|----------------------------|---------------------------|
| 시점 | 개발 중 bug | 개발/운영 모두 loop 내부 | 배포 후 실 사용자 incident |
| 범위 | 단일 테스트/함수 | 6-stage loop 내부 | **전체 시스템** (어디부터 파야 할지) |
| 입력 | 구체 에러 메시지 | 로그 + loop state | 사용자 증상 서술 ("느리다", "답변 이상") |
| 출력 | 버그 원인 가설 | loop stage fix | 1차 진단 경로 (어느 도구로 dispatch) |

## 1차 진단 체크리스트 (Workers 환경 특화)

배포 후 incident → 가장 먼저 5분 안에 확보:

```bash
# 1. wrangler tail — Workers 라이브 로그
pnpm exec wrangler tail --format pretty
# 또는 특정 deployment 만
pnpm exec wrangler tail --status error

# 2. Sentry / Logflare 에러 burst 확인
#    Sentry → Issues → Last 1 hour → frequency spike
#    Logflare → query: severity:error AND timestamp:[now-1h TO now]

# 3. LLM provider status (외부 의존)
curl -sI https://openrouter.ai/api/v1/auth/key   # OpenRouter
#    https://status.openai.com / https://status.anthropic.com 대시보드

# 4. Neon DB status
#    https://neon.tech/status 또는 wrangler tail 안 'NEON_' 에러 grep

# 5. R2 / KV 가용성
pnpm exec wrangler r2 bucket list
pnpm exec wrangler kv:namespace list
```

> Workers 는 stdout 이 즉시 사라진다 (per-request scope). 영속 적재는 **Logflare**
> (또는 Workers Logpush → R2) 필수. `loguru` / `structlog` Python 패턴 대신
> `console.log(JSON.stringify({...}))` 구조화 출력 → Logflare 가 자동 파싱.

## AsyncLocalStorage 10 필드 상관관계

`ts-agent-rules` §AsyncLocalStorage 10 필드 — incident 시 request 추적에 필수:

```
requestId, traceId, spanId, sessionId, userId,
runName, agent, model, turnCount, spawnDepth
```

**기본 correlation 경로**:

1. 고객 리포트에서 **`requestId` 또는 session URL 확보** (프론트 CORS expose 헤더 `X-Request-Id`, `X-App-Session-Id`)
2. `requestId` 로 해당 요청의 전체 로그 추출:
   ```bash
   # Logflare query (예시)
   #   project:apps-api AND request_id:"<id>"
   pnpm exec wrangler tail --search "<request_id>"
   ```
3. `turnCount` + `spawnDepth` 로 loop 상태 추적, `model` 로 provider 파악
4. 증상 class 매핑 후 해당 도구로 dispatch

## 격리 / 빠른 복구 (5분 안)

1. **wrangler rollback** — 직전 deployment 으로 즉시 복구
   ```bash
   pnpm exec wrangler rollback   # 인터랙티브
   # 또는 특정 version id:
   pnpm exec wrangler rollback --version-id <id>
   ```
2. **Feature flag off** — KV / env 의 feature flag 즉시 비활성
   ```bash
   pnpm exec wrangler kv:key put --binding=CACHE "flag:<name>" "false"
   ```
3. **Cloudflare WAF 일시 차단** (DDoS / 악의적 입력 의심 시) — `vercel:vercel-firewall` 와 별개로 CF dashboard Attack Mode

## Symptom Class Matrix (7 classes)

각 class 는 **증상 keyword → 1차 진단 도구 → 증거 수집 체크리스트** 3 요소.

### Class 1: SSE stream 이상

- **키워드**: "SSE 끊김", "응답 중간에 멈춤", "stream hang", "done 이벤트 안 옴", "connection dropped"
- **1차 도구**:
  1. `sse-streaming` workflow + `sse-lifecycle-audit` — 로컬 재현
  2. `wrangler tail --status error --search 'sse'` — Workers SSE 에러
- **증거 수집**:
  - [ ] 마지막으로 수신된 이벤트 type (text / tool_call / done / error?)
  - [ ] `doneSeen` 로그 (`loop.terminal_missing` WARN 있는지 — stream finally 안전망)
  - [ ] keepalive heartbeat (15s) 정상 수신 여부 (Cloudflare 100s idle timeout?)
  - [ ] `stream.onAbort` 발생 여부 (클라이언트가 먼저 끊었는지 서버가?)
  - [ ] `scrubSecrets` 미통과로 PII 포함 의심?

### Class 2: Latency 이상

- **키워드**: "응답 느림", "timeout", "10초 이상", "slow response"
- **1차 도구**:
  1. `performance-profiling` workflow — `wrangler tail` + Server-Timing 헤더
  2. `provider-layer` workflow — circuit breaker / fallback chain 상태
- **증거 수집**:
  - [ ] provider circuit breaker state (CLOSED / OPEN / HALF_OPEN)
  - [ ] `toolCall` 수 + tool 실행 시간
  - [ ] blocking I/O 의심 (`await` 누락? sync `JSON.stringify` of huge object?)
  - [ ] DB connection (Neon HTTP / WebSocket) 응답 시간
  - [ ] MCP 서버 응답 지연 (`mcp-integration` workflow)

### Class 3: Quality degradation

- **키워드**: "답변 이상", "품질 저하", "엉뚱한 답", "hallucination"
- **1차 도구**:
  1. `context-assembly` + `token-budget-constants` — 3-Layer / cache miss
  2. `provider-layer` (debug 모드) — 모델 변경? fallback 진입?
- **증거 수집**:
  - [ ] 해당 요청의 **resolved `model`** (fallback chain 소진으로 다른 모델 사용?)
  - [ ] prompt cache hit 여부 (`cacheReadInputTokens` 값)
  - [ ] 3-Layer prompt 에 동적 값 유입? (recent commit 검사)
  - [ ] Attachment 순서 변경? (cache prefix 무효화)
  - [ ] Compaction 발생 여부 + strategy (snip / micro / auto / reactive 중 무엇)

### Class 4: Cost spike

- **키워드**: "비용 급증", "token 폭증", "cost spike", "billing alert"
- **1차 도구**:
  1. `usage-tracking` workflow — usage 이벤트 emission 정합성
  2. `provider-catalog-sync` workflow — 모델 가격 변경 여부 + 카탈로그 정합
- **증거 수집**:
  - [ ] 급증 시점 전후 24h 의 `usage` 이벤트 집계 (input / output / cacheRead / cacheCreation)
  - [ ] `DEFAULT_UNKNOWN_COSTS` WARNING 로그 다수 (pricing lookup 실패)
  - [ ] fallback chain 진입 빈도 증가? (비싼 모델 fallback)
  - [ ] compaction AUTO 전략 폭증? (요약 LLM 호출 비용)
  - [ ] 특정 `userId` 에 집중된 요청?

### Class 5: DB / 데이터 레이어 이상

- **키워드**: "DB 에러", "data 저장 안 됨", "엔티티 변경 반영 안 됨", "session 사라짐"
- **1차 도구**:
  1. `single-writer` invariant + `data-governance` — WriteCoordinator, StoragePort, 단일 writer
  2. raw SQL 확인 (Drizzle):
     ```typescript
     await db.execute(sql`
       SELECT * FROM ai_backend.mutations ORDER BY created_at DESC LIMIT 50
     `)
     ```
- **증거 수집**:
  - [ ] 최근 `ai_backend.mutations` append 성공/실패 기록
  - [ ] advisory lock 정상 획득? (Postgres `pg_advisory_lock` 또는 KV 기반 분산 락)
  - [ ] `DATABASE_URL` / `APP_DATABASE_URL` 분리 유지?
  - [ ] `SessionPort` vs `SessionHistoryPort` 분리 — 어느 쪽에서 누락?
  - [ ] Drizzle migration revision 과 실 DB schema 일치?

### Class 6: MCP 연결 이상

- **키워드**: "MCP tool 안 보임", "외부 도구 실패", "MCP disconnected"
- **1차 도구**:
  1. `mcp-integration` workflow + `mcp-namespace-audit` — 5-state 전이 감사
  2. `GET /debug/tools/mcp` (debug mount 활성 시) — 실시간 ConnectionState
- **증거 수집**:
  - [ ] 해당 MCP 서버의 `connectionState` (disabled / pending / connected / needsAuth / failed)
  - [ ] `_toolsCache` memoized 상태 (lazy reconnect 대상?)
  - [ ] `${VAR}` 치환 실패 (env var 누락으로 empty string → auth 실패?)
  - [ ] `mcp.state_transition` 로그 최근 기록
  - [ ] `mcp__<server>__<tool>` 네이밍 정합

### Class 7: Tool 반복 실패

- **키워드**: "tool X 항상 실패", "같은 에러 반복", "tool_error"
- **1차 도구**:
  1. `tool-system` workflow + `tool-sort-order-audit` — 도구 등록 + 권한 + concurrency
  2. `agent-loop` debug 모드 — `LoopTransition=tool_error` 여부
- **증거 수집**:
  - [ ] 해당 tool 의 `validateInput` / `checkPermissions` 통과 여부
  - [ ] `isConcurrencySafe(args)` 가 parallel batch 오분류?
  - [ ] `toolResult` 의 `isError: true` 메시지 (`design-principles` §5)
  - [ ] tool preview max chars 초과로 head-truncate 된 중요 정보?
  - [ ] MCP tool 이면 Class 6 과 병행 조사

## 증거 수집 → 가설 → 검증 3단계 플로우

모든 class 공통 원칙:

1. **증거 수집 (Collect)**: 위 체크리스트로 로그/메트릭/상태 스냅샷 확보. **추측 금지** — 증거가 부족하면 수집으로 돌아감
2. **가설 (Hypothesize)**: 수집된 증거로부터 가능한 원인 1-3 개 열거. 가장 증거가 뒷받침하는 것을 primary hypothesis 로
3. **검증 (Verify)**: primary hypothesis 를 검증하는 실험 1개 설계 (로컬 재현 / 로그 추가 / 특정 설정 변경 / `wrangler rollback` 이전 비교). 확인되지 않으면 다른 가설로

## Incident Report 템플릿

incident 마무리 시 작성 — 팀 공유 / 재발 방지:

```markdown
# Incident Report — YYYY-MM-DD HH:MM

## Summary (1줄)
<한 줄로 무슨 일이 있었는지>

## Impact
- 영향받은 `userId` / `sessionId` 범위:
- 기간: YYYY-MM-DD HH:MM UTC ~ HH:MM UTC
- 심각도: P0 / P1 / P2
- 증상 class: <1-7 중>
- Deployment id: <wrangler deployment id>

## Reproduction
- 요청: POST /run/<name> body `{...}`
- 예상: ...
- 실제: ...

## Root Cause
(증거 수집 + 가설 + 검증 결과)

## Mitigation
(즉시 완화 조치 — `wrangler rollback` / KV feature flag off / Cloudflare WAF / restart)

## Timeline
- HH:MM 증상 보고 수신
- HH:MM /incident 실행 → class N 로 분류
- HH:MM 증거 수집 완료 (wrangler tail + Sentry)
- HH:MM root cause 확인
- HH:MM mitigation 적용 (wrangler rollback to <version-id>)
- HH:MM 정상 복구 확인

## Prevention
(재발 방지 — invariant 추가 / audit 추가 / test 추가 / monitoring alert 추가 / specific playbook 승격)

## Related Artifacts
- `requestId`: <...>
- `sessionId`: <...>
- 관련 PR / commit:
- Logflare query:
- Sentry issue:
```

## 새 symptom class 추가하기

위 7 class 로 분류 안 되는 증상이 반복 발생하면:

1. 새 class 정의 (키워드 + 1차 도구 + 증거 수집 체크리스트)
2. 기존 class 와 중복 최소화 — 증거 수집 항목이 50% 이상 겹치면 기존 class 확장으로
3. 1차 도구는 **기존 자산 조합** 을 우선 (신규 도구는 별도 설계 필요)
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
- 고객 데이터 / API key 를 incident report 에 포함 (`scrubSecrets` 원칙 유지)
- 사용자 로그 파일 직접 조작 / 수정 (read-only)
- `/incident` 가 자동으로 다음 도구 실행 (반드시 사용자 승인 후 dispatch)
- 운영 DB 에 직접 DML (read-only `SELECT` 만; 변경은 PR / migration 경유)

## Cross-ref

- `performance-profiling` — Class 2 (latency) 깊이 진단
- `usage-tracking` — Class 4 (cost spike) 정합성 점검
- `provider-layer` — Class 3 / Class 2 (fallback / circuit breaker)
- `single-writer` — Class 5 (DB 정합성)
- `mcp-integration` — Class 6 (MCP 상태)
- `tool-system` — Class 7 (tool 반복 실패)
- `sse-streaming` — Class 1 (SSE 끊김)
