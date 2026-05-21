> App backend-overview capsule. Source: design doc §3.23, §5 tests/.

# Subsystem 14 — Testing Infra

## 목적 (1줄)

pytest 기반 테스트 인프라. conftest fixtures + mock provider + VCR cassette().

## 파일 / 모듈

- `backend/tests/conftest.py` — 공통 fixture
- `backend/tests/test_loop.py` — agent loop 단위 테스트
- `backend/tests/test_tools.py` — 도구 단위 테스트
- `backend/tests/test_providers.py` — provider adapter 테스트
- `backend/tests/test_data.py` — data layer 테스트
- `backend/tests/test_routes.py` — FastAPI TestClient 엔드포인트 테스트
- `backend/tests/vcr_cassettes/` — VCR 녹화 파일

## 주요 fixture

실제 fixture 목록은 `backend/tests/conftest.py` 가 정본 — 아래는 자주 쓰는 목록.

| 이름 | 역할 |
|---|---|
| `mock_anthropic_stream` | FACTORY 패턴 (async generator callable, NOT AsyncMock) — stream event 시퀀스를 반환 |
| `isolate_tool_registry` | autouse=True, `_tools` 스냅샷 + 복원 |
| `reset_connected_providers_cache` | autouse=True, `cache_clear()` 호출 |
| `_isolate_data_dir` | `APP_DATA_DIR` 을 임시 경로로 rebind + Settings 캐시 클리어 |
| `session_factory` | `LoopState` 기반 세션 생성 |
| `client` | FastAPI TestClient |

## 모드 (agent-test)

| 모드 | 설명 | Phase |
|---|---|---|
| `--replay` | mock_provider + 고정 시나리오 fixture | 2a |
| `--record` | 실제 provider 호출 + cassette 저장 | 2b |
| `--live` | 실제 provider 호출, cassette 미사용 | 2b |

## 담당 skill

`testing-infra`

## 범위

- conftest.py 전체 fixture
- test_loop/test_tools/test_data/test_routes 기본 커버리지
- `--replay` 모드만 (VCR은 )

## Gotchas

- **fixture 격리**: `tmp_data_dir`은 function-scoped여야 테스트 간 상태가 섞이지
  않는다. session-scoped 금지.
- **mock_provider의 tool_use 순서**: 실제 LLM처럼 tool_use 블록을 여러 round에
  걸쳐 나눠 반환하도록 설계. 한 번에 전부 반환하면 루프 테스트가 불가능.
- **Async fixture**: pytest-asyncio의 `@pytest_asyncio.fixture` 사용. 일반
  `@pytest.fixture`는 async 함수에 적용 안 됨.

## 관련 rule / skill

- `ai-provider-patterns.md` — mock provider 는 ProviderProtocol 을 구현해야 함
- `testing-infra` skill — fixture 이름/사용 패턴 상세
