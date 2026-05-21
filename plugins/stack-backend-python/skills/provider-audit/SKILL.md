---
name: provider-audit
description: Operational checklist + grep patterns for auditing `backend/providers/` module health. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/ai-provider-patterns.md`. Load this skill to get executable commands for detecting fallback chain gaps, CircuitBreaker misconfigurations, retry policy violations, and single-conversion principle breaches.
allowed-tools: Read, Bash, Grep, Glob
---

# provider-audit — 프로바이더 감사 실행 가이드

## 이 skill은 언제 로드되는가

- `provider-manager` sub-agent 호출 시 (audit 모드)
- `backend/providers/` 파일 변경 후 빠른 정합성 점검
- 새 provider 추가 후 등록/fallback/circuit breaker 검증 필요 시

## 이 skill은 언제 로드되지 않는가

- 새 provider 생성 (→ `provider-scaffold` skill)
- 런타임 디버깅 (→ `debug-session` skill)
- 모델 capabilities 해석 자체 (→ `provider-layer` skill 직접 참조)

## 원칙은 Rule 에 있다

**불변식 / 5원칙 / 금지 사항 / 영향도** 는 모두
`.agents/rules/python_agent_rules/ai-provider-patterns.md` 에 정의됨. 본 skill 은
**그 rule 을 기계적으로 체크하는 커맨드** 만 제공한다.

## 1. PROVIDER_REGISTRY 등록 완전성

```bash
# base.py 의 PROVIDER_REGISTRY 에 등록된 타입 키 목록
rg -n "PROVIDER_REGISTRY" backend/providers/base.py

# 각 provider 구현 파일이 존재하는지
for f in anthropic openai google openrouter; do
  test -f "backend/providers/$f.py" && echo "OK: $f" || echo "MISSING: $f"
done
```

## 2. Fallback Chain 커버리지

```bash
# fallback chain 설정에서 참조하는 모델들
rg -n "fallback" backend/providers/router.py backend/providers/config.py

# chain 내 모든 모델이 capabilities 해석 가능한지 (bundled snapshot 존재)
rg -n "model_id\|model_name" backend/providers/bundled_models.json | head -30
```

## 3. CircuitBreaker 상태 전이

```bash
# CircuitBreaker 구현 확인
rg -n "CLOSED|OPEN|HALF_OPEN" backend/providers/circuit_breaker.py

# provider별 독립 인스턴스 확인 (공유 = VIOLATION)
rg -n "CircuitBreaker" backend/providers/ -g '!circuit_breaker.py'
```

## 4. Retry 정책 준수 (4종만 재시도)

```bash
# retryable 에러 분류 확인: RATE_LIMIT, TIMEOUT, SERVER_ERROR, CONNECTION_ERROR
rg -n "retryable|retry|RATE_LIMIT|TIMEOUT|SERVER_ERROR|CONNECTION_ERROR" backend/providers/

# non-retryable 에러를 재시도하는 위반 탐지
rg -n "auth.*retry|validation.*retry|quota.*retry" backend/providers/
```

## 5. 단일 변환 원칙 (Single Conversion)

```bash
# _convert_to / _convert_from 이 각 provider 내부에만 존재하는지
rg -n "_convert_to\|_convert_from" backend/providers/

# converter.py 에 실제 변환 로직이 아닌 dispatch 만 있는지
rg -n "def _convert" backend/providers/converter.py
```

## 6. SDK 타입 경계 누출

```bash
# provider 외부에서 SDK 타입 직접 사용 (VIOLATION)
rg -n "anthropic\.types|openai\.types|google\.generativeai" backend/engine/ backend/routes/ backend/tools/

# TYPE_CHECKING 블록 안에서만 SDK import
rg -n "from anthropic|from openai|from google" backend/ -g '!backend/providers/*' | rg -v "TYPE_CHECKING"
```

## 7. 리포트 템플릿

```markdown
## Provider Audit — <date>

### Registry completeness
- [OK/FAIL] PROVIDER_REGISTRY has N entries, M provider files found

### Fallback chain
- [OK/FAIL] All chain models have capabilities resolution

### CircuitBreaker
- [OK/FAIL] Per-provider independent instances
- [OK/FAIL] CLOSED→OPEN→HALF_OPEN transitions covered

### Retry policy
- [OK/FAIL] Only 4 retryable error types
- [VIOLATION] <file:line> retries non-retryable error

### Single conversion
- [OK/FAIL] _convert_to/_convert_from only in provider files
- [VIOLATION] converter.py contains conversion logic

### SDK type boundary
- [VIOLATION] <file:line> SDK type leaked to <layer>
```

## 의존 파일

- `.agents/rules/python_agent_rules/ai-provider-patterns.md` — 불변식 원본
- `.agents/skills/provider-layer/` — 구현 가이드
- `backend/providers/base.py` — PROVIDER_REGISTRY
- `backend/providers/circuit_breaker.py` — CircuitBreaker

## 검증 체크리스트

- [ ] 7개 grep 블록 모두 실행
- [ ] 매치된 모든 line 을 리포트 카테고리에 배치
- [ ] `ai-provider-patterns.md` rule 참조로 위반 근거 제시
- [ ] No-op 인 경우에도 "0 violations, X items checked" 로 coverage 증명
- [ ] 원칙 설명 반복 금지 (rule 링크로 대체)

## 구현 중 막히면

- `backend/providers/` 디렉토리 없음 → NOT_YET_IMPLEMENTED
- circuit_breaker.py 없음 → 미구현으로 보고
- bundled_models.json 형식 모름 → 파일 head 20줄 읽고 판단
