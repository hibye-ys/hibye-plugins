---
name: provider-scaffold
description: 7-step recipe for adding a new LLM provider to `backend/providers/`. Extracts the creation workflow from the former `new-provider-scaffolder` agent into a reusable skill. Load this skill when scaffolding a direct SDK provider (Anthropic/OpenAI/Google style) or registering an OpenAI-compatible self-hosted endpoint.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# provider-scaffold — 새 프로바이더 추가 가이드

## 이 skill은 언제 로드되는가

- `provider-manager` sub-agent 호출 시 (scaffold 모드)
- 사용자가 "새 provider 추가" 를 요청할 때
- OpenAI-compatible 셀프 호스팅 엔드포인트 등록 시

## 이 skill은 언제 로드되지 않는가

- 기존 provider 감사 (→ `provider-audit` skill)
- fallback chain / circuit breaker 디버깅 (→ `provider-layer` skill)
- 모델 capabilities 설정만 변경 (→ `provider-layer` skill)

## 원칙은 Rule 에 있다

`.agents/rules/python_agent_rules/ai-provider-patterns.md` §새 provider 추가하기 참조.

## Case A: 직접 SDK Provider (7-step)

### Step 1: 구현 파일 생성
```bash
# backend/providers/{name}.py 생성
# ProviderProtocol 구현 + _convert_to() / _convert_from()
```

### Step 2: PROVIDER_REGISTRY 등록
```bash
# backend/providers/base.py 의 PROVIDER_REGISTRY 에 {type_key: NewProviderClass} 추가
rg -n "PROVIDER_REGISTRY" backend/providers/base.py
```

### Step 3: Credentials 스키마
```bash
# backend/providers/config.py 에 필요 시 credentials 키 추가
# 예: {"api_key": str} 또는 {"api_key": str, "api_version": str}
```

### Step 4: .env.example 업데이트
```bash
# 새 API key 항목 추가
rg -n "API_KEY\|SECRET" .env.example
```

### Step 5: Fallback chain 등록 (선택)
```bash
# config/providers.yaml 의 fallback_chains 에 필요 시 포함
```

### Step 6: 테스트 scaffold
```bash
# backend/tests/test_provider_{name}.py 생성
# 최소 테스트 시나리오:
# - 정상 호출 (non-streaming)
# - 정상 스트리밍
# - RATE_LIMIT (429) → 재시도
# - TIMEOUT → 재시도
# - SERVER_ERROR (5xx) → 재시도
# - AUTH_ERROR → 즉시 실패
# - CircuitBreaker CLOSED→OPEN→HALF_OPEN 전이
```

### Step 7: 검증
```bash
# 부팅 테스트
python -c "from backend.providers.{name} import {ClassName}; print('OK')"
# PROVIDER_REGISTRY 에 등록 확인
rg -n "{type_key}" backend/providers/base.py
```

## Case B: OpenAI-compatible 셀프 호스팅 (설정만)

**코드 변경 없음** — `_openai_base.py` 가 공통 구현 제공.

### Step 1: config/providers.yaml 에 entry 추가
```yaml
my_model:
  type: openai_compatible
  base_url: http://vllm.internal:8000/v1
  credentials: { api_key: ${VLLM_KEY} }
  custom_models:
    - id: my-model-v1
      context_window: 32000
      supports_tools: true
```

### Step 2: .env 에 키 추가
```bash
echo "VLLM_KEY=your-key-here" >> .env
```

### Step 3: 부팅 확인
```bash
# 재시작 후 자동 등록 확인
curl -s http://localhost:8000/models | python -m json.tool
```

## 검증 체크리스트

- [ ] ProviderProtocol 의 모든 메서드 구현
- [ ] _convert_to / _convert_from 이 provider 파일 내에만 존재
- [ ] PROVIDER_REGISTRY 에 등록
- [ ] .env.example 에 API key 항목
- [ ] 테스트 7개 시나리오 작성
- [ ] 부팅 시 import 성공

## 구현 중 막히면

- ProviderProtocol 정의 모름 → `rg "class.*Protocol" backend/providers/base.py`
- _openai_base.py 구조 모름 → `get_symbols_overview backend/providers/_openai_base.py`
- credentials 패턴 모름 → `rg "credentials" backend/providers/config.py`
