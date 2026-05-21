---
name: usage-tracking
description: Checklist for auditing usage event emission, per-turn token accounting, and cost metadata in `backend/engine/stream.py`. Does NOT restate SSE invariants — those live in `.agents/rules/python_agent_rules/sse-streaming-patterns.md`. Load this skill to verify usage event correctness and cost tracking integrity.
allowed-tools: Read, Bash, Grep, Glob
---

# usage-tracking — 비용/사용량 추적 감사 가이드

## 이 skill은 언제 로드되는가

- `output-stream-manager` sub-agent 호출 시 (usage 모드)
- usage 이벤트 누락 / 비용 집계 불일치 의심 시
- 새 provider 추가 후 토큰 카운팅 정합성 확인 시

## 이 skill은 언제 로드되지 않는가

- SSE 전반 감사 (→ `stream-audit` skill)
- 스트리밍 구현 작업 (→ `sse-streaming` skill)
- 프로바이더 자체 디버깅 (→ `provider-layer` skill)

## 원칙은 Rule 에 있다

**usage 이벤트는 `done` 직전 전송**, **payload 에 동적 메타 혼합 금지** —
`.agents/rules/python_agent_rules/sse-streaming-patterns.md` §HTTP 헤더 분리 참조.

## 1. Usage 이벤트 존재 확인

```bash
# usage 이벤트 emit 지점
rg -n "usage\|UsageEvent\|SSEEventType.*usage" backend/engine/stream.py backend/routes/run.py

# done 직전에 usage 가 발송되는지
rg -n "usage|done" backend/engine/stream.py -A 2 | head -20
```

## 2. 토큰 카운팅 정합성

```bash
# input_tokens / output_tokens 필드 존재
rg -n "input_tokens\|output_tokens\|prompt_tokens\|completion_tokens" backend/engine/ backend/providers/

# count_tokens 또는 토큰 추정 유틸리티
rg -n "count_tokens\|token_count\|_token_utils" backend/
```

## 3. 비용 메타데이터 구조

```bash
# cost 관련 필드/모델
rg -n "cost\|price\|billing" backend/engine/ backend/providers/ backend/routes/

# usage 이벤트의 data schema (pydantic 모델)
rg -n "class.*Usage\|usage.*BaseModel" backend/engine/types.py backend/engine/stream.py
```

## 4. Provider별 토큰 응답 파싱

```bash
# 각 provider 에서 usage 정보 추출
for p in anthropic openai google openrouter; do
  echo "--- $p ---"
  rg -n "usage\|token" "backend/providers/$p.py" 2>/dev/null | head -5
done
```

## 5. HTTP 헤더 vs SSE Payload 분리

```bash
# X-App-Usage 헤더 (정본)
rg -n "X-App-Usage" backend/routes/run.py

# usage 정보가 다른 이벤트 payload 에 혼입되는지 (VIOLATION)
rg -n "input_tokens\|output_tokens" backend/engine/stream.py | rg -v "usage\|Usage"
```

## 리포트 템플릿

```markdown
## Usage Tracking Audit — <date>

### Usage event
- [OK/FAIL] usage SSE event emitted before done
- [OK/FAIL] usage data schema has input_tokens + output_tokens

### Token counting
- [OK/FAIL] count_tokens utility exists
- [OK/FAIL] All providers extract usage from response

### Cost metadata
- [OK/FAIL] Cost calculation present (or N/A if )

### Header separation
- [OK/FAIL] X-App-Usage header set
- [OK/FAIL] No usage data in non-usage SSE events
```

## 의존 파일

- `.agents/rules/python_agent_rules/sse-streaming-patterns.md` — SSE 불변식
- `backend/engine/stream.py` — usage 이벤트 emit
- `backend/engine/types.py` — Usage 모델
- `backend/providers/*.py` — 토큰 응답 파싱

## 검증 체크리스트

- [ ] 5개 체크 블록 실행
- [ ] provider별 usage 파싱 확인
- [ ] 헤더/payload 분리 확인

## 구현 중 막히면

- usage 이벤트 자체가 없음 → 미구현으로 보고
- _token_utils.py 없음 → 토큰 카운팅 미구현 경고
