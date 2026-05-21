---
name: stream-audit
description: Operational checklist + grep patterns for auditing `backend/engine/stream.py` and `backend/routes/run.py` SSE health. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/sse-streaming-patterns.md`. Load this skill to detect secret-scanner gaps, done/error termination failures, keepalive misconfig, and HTTP header pollution.
allowed-tools: Read, Bash, Grep, Glob
---

# stream-audit — SSE 스트리밍 감사 실행 가이드

## 이 skill은 언제 로드되는가

- `output-stream-manager` sub-agent 호출 시 (stream-audit 모드)
- `backend/engine/stream.py` 또는 `backend/routes/run.py` 변경 후 정합성 점검
- SSE 연결 drop / 시크릿 유출 의심 시

## 이 skill은 언제 로드되지 않는가

- stream.py 내부 구현 작업 (→ `sse-streaming` skill)
- 실시간 SSE 이벤트 트레이싱 (→ `/sse-trace` command)
- 비용/usage 메타데이터 로직 (→ `usage-tracking` skill)

## 원칙은 Rule 에 있다

**11 이벤트 / wire format / 종료 보장 / secret scanner** 는
`.agents/rules/python_agent_rules/sse-streaming-patterns.md` 에 정의됨.

## 1. scrub_secrets 커버리지 (정본 `_SCAN_EVENTS` 7 이벤트)

정본: `backend/engine/stream.py::_SCAN_EVENTS = frozenset({"text", "thinking", "tool_call", "tool_result", "action", "error", "notification"})`. 과거 `text_chunk`, `tool_call_end`, `action_completed` 는 **현재 미구현 — 대신 `text`, `tool_call`, `tool_result`, `action` 으로 매핑**. 감사 grep 도 현재 이름 기준으로:

```bash
# scrub 함수 정의/호출 지점
rg -n "scrub_secrets|_scrub_dict|_SCAN_EVENTS" backend/engine/stream.py

# 7 이벤트 중 발신 경로가 _scrub_dict 를 경유하는지 확인
rg -n "\"text\"|\"thinking\"|\"tool_call\"|\"tool_result\"|\"action\"|\"error\"|\"notification\"" backend/engine/stream.py -A 3 | rg "scrub"
```

## 2. _SECRET_PATTERNS 최소 4종

```bash
# 패턴 목록 확인: sk-, AKIA, ghp_, PEM
rg -n "_SECRET_PATTERNS\|secret.*pattern" backend/engine/stream.py -A 10
```

## 3. done/error 배타적 종점

```bash
# done 과 error 가 모두 발송되는 경로 (VIOLATION)
rg -n "done_seen\|error_seen" backend/engine/stream.py backend/routes/run.py

# finally 안전망에서 합성 done 로직
rg -n "finally" backend/routes/run.py -A 5 | rg "done"
```

## 4. ping=15 keepalive 설정

```bash
# EventSourceResponse 에 ping 파라미터
rg -n "EventSourceResponse\|ping=" backend/routes/run.py
```

## 5. HTTP 헤더 분리 (payload 오염 금지)

```bash
# X-App- 헤더 설정
rg -n "X-App-\|X-Accel-Buffering" backend/routes/run.py

# SSE payload 에 session_id, model, agent 가 혼입되는지 (VIOLATION)
rg -n "session_id\|model.*=\|agent.*=" backend/engine/stream.py | rg -v "header\|log\|#"
```

## 6. Wire Format 정합성

```bash
# serialize_sse 단일 함수 존재
rg -n "def serialize_sse\|def _serialize" backend/engine/stream.py

# json.dumps + ensure_ascii=False
rg -n "json\.dumps" backend/engine/stream.py | rg "ensure_ascii"
```

## 7. Stream Tee 패턴

```bash
# provider call_stream 에서 tee 사용 (forward + collect Queue 분리)
rg -n "tee_stream\|forward.*queue\|collect.*queue" backend/providers/ backend/engine/
```

## 리포트 템플릿

```markdown
## Stream Audit — <date>

### Secret scanner
- [OK/FAIL] scrub_secrets covers `_SCAN_EVENTS` 7 targets (text, thinking, tool_call, tool_result, action, error, notification)
- [OK/FAIL] _SECRET_PATTERNS has ≥4 patterns (sk-, AKIA, ghp_, PEM)

### Termination
- [OK/FAIL] done/error mutually exclusive
- [OK/FAIL] finally safety net emits synthetic done

### Keepalive
- [OK/FAIL] ping=15 in EventSourceResponse

### Header separation
- [OK/FAIL] X-App-* headers set on response
- [VIOLATION] <file:line> session metadata in SSE payload

### Wire format
- [OK/FAIL] serialize_sse centralized, json.dumps(ensure_ascii=False)

### Stream tee
- [OK/FAIL] tee_stream pattern applied to provider streaming
```

## 의존 파일

- `.agents/rules/python_agent_rules/sse-streaming-patterns.md` — 불변식 원본
- `.agents/skills/sse-streaming/` — 구현 가이드
- `backend/engine/stream.py` — serialize, scrub, event types
- `backend/routes/run.py` — EventSourceResponse, 헤더, _stream_agent

## 검증 체크리스트

- [ ] 7개 grep 블록 모두 실행
- [ ] 위반 사항을 리포트 카테고리에 배치
- [ ] `sse-streaming-patterns.md` rule 참조로 근거 제시
- [ ] 보안 관련 위반은 CRITICAL 으로 표시

## 구현 중 막히면

- stream.py 없음 → NOT_YET_IMPLEMENTED
- EventSourceResponse import 없음 → sse-starlette 미설치 확인
- scrub_secrets 함수 없음 → 보안 취약점으로 즉시 보고
