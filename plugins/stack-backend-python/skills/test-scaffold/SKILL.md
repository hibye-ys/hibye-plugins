---
name: test-scaffold
description: Template-driven test file generation for `backend/tests/`. Creates unit + integration skeletons following the project's conftest patterns (isolate_tool_registry, FACTORY mocks). Load this skill when a new module needs tests or test-cleanup identifies coverage gaps.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# test-scaffold — 테스트 스캐폴딩 가이드

## 이 skill은 언제 로드되는가

- `test-manager` sub-agent 호출 시 (scaffold 모드)
- 새 모듈 생성 후 대응 테스트 필요 시
- `test-cleanup` 이 coverage gap 을 보고한 후

## 이 skill은 언제 로드되지 않는가

- 기존 테스트 정리 (→ `test-cleanup` skill)
- conftest 패턴 이해 (→ `testing-infra` skill)
- 버그 수정용 테스트 (→ `red-green-fix` skill)

## 원칙은 Rule 에 있다

`testing-infra` skill 의 conftest 규약, `red-green-fix` skill 의 5-step 워크플로우 참조.

## 테스트 파일 템플릿

```python
"""Tests for backend/<module>.py"""
from __future__ import annotations

import pytest

# --- fixtures 는 conftest.py 의 autouse fixture 로 자동 적용 ---
# isolate_tool_registry: ToolRegistry snapshot/restore
# reset_connected_providers_cache: provider cache_clear()


class TestModuleName:
    """<module> 핵심 기능 테스트."""

    # === 성공 시나리오 ===

    async def test_happy_path(self):
        """정상 입력 → 기대 출력."""
        ...

    # === 실패 시나리오 ===

    async def test_invalid_input_raises(self):
        """잘못된 입력 → ValidationError."""
        with pytest.raises(Exception):  # 구체 예외로 교체
            ...

    # === 권한/경계 시나리오 ===

    async def test_permission_denied(self):
        """권한 없는 접근 → 적절한 에러."""
        ...
```

## 생성 절차

### Step 1: 대상 모듈 파악
```bash
# 테스트할 모듈의 public 심볼 확인
rg -n "^def \|^class \|^async def " backend/<module>.py | rg -v "^_"
```

### Step 2: 기존 conftest fixture 확인
```bash
# 사용 가능한 fixture 목록
rg -n "@pytest.fixture" backend/tests/conftest.py | head -20
```

### Step 3: Mock 패턴 결정
```bash
# FACTORY 패턴 사용 예시
rg -n "FACTORY\|mock_anthropic\|mock_openai" backend/tests/conftest.py | head -10

# AsyncMock 패턴 (provider shape 매칭)
rg -n "AsyncMock" backend/tests/ | head -10
```

### Step 4: 파일 생성
- 경로: `backend/tests/test_<module>.py`
- 최소 3 시나리오: happy_path + invalid_input + permission/boundary
- provider 모듈이면: streaming + 4 error types + circuit breaker
- tool 모듈이면: validate + permissions + call 성공/실패

### Step 5: 실행 검증
```bash
pytest backend/tests/test_<module>.py -v --tb=short
```

## 모듈 타입별 최소 시나리오

| 모듈 타입 | 최소 테스트 |
|-----------|-----------|
| Provider | normal_call, streaming, rate_limit_retry, auth_error, circuit_breaker |
| Tool | validate_ok, validate_fail, permissions_deny, call_success, call_error |
| Engine | stage_입력→출력, error_recovery, state_transition |
| Route | 200_ok, 401_unauth, 422_validation, 404_not_found |
| Data | WriteCoordinator media write, cache invalidation, Port (SessionPort/MediaJobPort) usage via Protocol |

## 검증 체크리스트

- [ ] 파일 생성 후 pytest 통과
- [ ] conftest autouse fixture 와 충돌 없음
- [ ] AsyncMock shape 이 실제 구현과 일치
- [ ] 테스트 이름이 test_<behavior> 패턴

## 구현 중 막히면

- conftest.py 없음 → 기본 fixture 없이 standalone 작성
- 모듈 구조 복잡 → `get_symbols_overview` 로 먼저 파악
- Mock 어떻게 → `rg "AsyncMock\|MagicMock" backend/tests/` 로 기존 패턴 참조
