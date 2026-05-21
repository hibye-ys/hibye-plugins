# VCR Cassette 인프라 — Deep-dive Reference

> testing-infra Chapter B 상세 참조 문서. SKILL.md Chapter B 의 요약을 보완한다.
>  에서 활성화.

---

## 1. vcrpy vs 자체 cassette engine 비교

### 결정: vcrpy 채택

| 기준 | vcrpy | 자체 구현 |
|---|---|---|
| 성숙도 | 10년+ OSS, 활발한 유지보수 | 0 — 처음부터 작성 필요 |
| httpx 지원 | `pytest-recording` + `vcrpy` 조합으로 httpx async 지원 | httpx transport layer 직접 패치 필요 |
| cassette 포맷 | YAML (사람이 읽기 쉬움, diff 가능) | 자유이나 직접 설계/문서화 필요 |
| redact 기능 | `before_record_request` / `before_record_response` 콜백 | 직접 구현 |
| 재생 정확도 | request matching (URI, method, headers, body) | 직접 matcher 작성 |
| 유지 비용 | 낮음 — 업스트림이 호환성 유지 | 높음 — 모든 edge case 직접 처리 |
| 커스터마이징 | 콜백 + custom matcher 로 충분 | 무제한이지만 개발 비용 과다 |

**결론**: vcrpy 의 콜백 시스템이 App 의 요구사항(httpx async, 시크릿 redact,
provider별 cassette 분리)을 커버한다. 자체 구현은 YAGNI 원칙 위반이며 
타임라인에 맞지 않는다.

### 의존성 설치

```bash
# pyproject.toml [project.optional-dependencies]
test = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "pytest-recording>=0.13",
    "vcrpy>=6.0",
]
```

```bash
uv sync --extra test
```

---

## 2. REDACT_PATTERNS 전체 목록

`backend/services/vcr.py` 에 정의되는 패턴 목록.

```python
REDACT_PATTERNS: list[RedactRule] = [
    # --- 헤더 redact ---
    RedactRule(
        target="header",
        key="Authorization",
        replacement="Bearer [REDACTED]",
    ),
    RedactRule(
        target="header",
        key="X-Api-Key",
        replacement="[REDACTED]",
    ),
    RedactRule(
        target="header",
        key="x-api-key",
        replacement="[REDACTED]",
    ),
    # --- body 필드 redact ---
    RedactRule(
        target="body_field",
        key="api_key",
        replacement="[REDACTED]",
    ),
    RedactRule(
        target="body_field",
        key="password",
        replacement="[REDACTED]",
    ),
    # --- Bearer token 패턴 (body 텍스트 내 정규식) ---
    RedactRule(
        target="body_regex",
        pattern=r"Bearer\s+[A-Za-z0-9\-._~+/]+=*",
        replacement="Bearer [REDACTED]",
    ),
    # --- session token 패턴 ---
    RedactRule(
        target="body_regex",
        pattern=r"session_token\"?\s*[:=]\s*\"?[A-Za-z0-9\-._]{16,}",
        replacement='session_token": "[REDACTED]',
    ),
    # --- Anthropic sk- prefix key ---
    RedactRule(
        target="body_regex",
        pattern=r"sk-ant-[A-Za-z0-9\-]{20,}",
        replacement="sk-ant-[REDACTED]",
    ),
    # --- OpenAI sk- prefix key ---
    RedactRule(
        target="body_regex",
        pattern=r"sk-[A-Za-z0-9]{20,}",
        replacement="sk-[REDACTED]",
    ),
]
```

### RedactRule 타입

```python
from pydantic import BaseModel


class RedactRule(BaseModel):
    target: str          # "header" | "body_field" | "body_regex"
    key: str | None = None
    pattern: str | None = None
    replacement: str
```

### 확장 방법

새 패턴이 필요하면 `REDACT_PATTERNS` 리스트에 `RedactRule` 을 추가한다.
vcrpy 의 `before_record_request` / `before_record_response` 콜백에서
이 리스트를 순회하며 적용한다.

---

## 3. Cassette YAML 포맷 예시

vcrpy 가 생성하는 YAML 구조.

```yaml
version: 1
interactions:
  - request:
      body: |
        {"model": "claude-sonnet-4-6", "max_tokens": 1024,
         "messages": [{"role": "user", "content": "hello"}]}
      headers:
        Authorization: "Bearer [REDACTED]"
        Content-Type: "application/json"
        X-Api-Key: "[REDACTED]"
        anthropic-version: "2023-06-01"
      method: POST
      uri: https://api.anthropic.com/v1/messages
    response:
      body:
        string: |
          {"id": "msg_abc123", "type": "message", "role": "assistant",
           "content": [{"type": "text", "text": "Hello! How can I help?"}],
           "model": "claude-sonnet-4-6", "stop_reason": "end_turn",
           "usage": {"input_tokens": 12, "output_tokens": 8}}
      headers:
        Content-Type: "application/json"
        x-request-id: "req_abc123"
      status:
        code: 200
        message: OK

  - request:
      body: |
        {"model": "claude-sonnet-4-6", "max_tokens": 1024,
         "messages": [{"role": "user", "content": "use the echo tool"}]}
      headers:
        Authorization: "Bearer [REDACTED]"
        Content-Type: "application/json"
      method: POST
      uri: https://api.anthropic.com/v1/messages
    response:
      body:
        string: |
          {"id": "msg_def456", "type": "message", "role": "assistant",
           "content": [{"type": "tool_use", "id": "tu_001", "name": "echo",
                        "input": {"text": "hello"}}],
           "model": "claude-sonnet-4-6", "stop_reason": "tool_use",
           "usage": {"input_tokens": 25, "output_tokens": 18}}
      headers:
        Content-Type: "application/json"
      status:
        code: 200
        message: OK
```

### 포맷 요점

- `version: 1` — vcrpy cassette 스키마 버전
- `interactions` — request/response 쌍 리스트, 순서대로 재생
- `body.string` — 문자열화된 JSON (vcrpy 기본)
- 헤더는 redact 적용 후 저장됨
- 여러 interaction 이 순서대로 매칭 (FIFO)

---

## 4. 3-tier 마이그레이션 가이드 (mock -> VCR replay -> live)

###  (현재): mock-only

모든 테스트가 `AsyncMock` 기반 fixture 를 사용한다 (Chapter A).
외부 호출 0건.

### : VCR replay 도입

1. **기존 mock 테스트는 유지** — Tier 1/2 는 그대로 `pytest -m unit` 으로 실행
2. **새 통합 테스트에 VCR 적용** — `@pytest.mark.vcr("provider/test_name")` 추가
3. **최초 녹화** — `VCR_RECORD_MODE=record pytest -m vcr -v` 로 cassette 생성
4. **redact 확인** — cassette 파일에서 시크릿 노출 여부 수동 검사
5. **CI 에서 replay** — `VCR_RECORD_MODE=replay` 로 cassette 기반 재생

```python
# 마이그레이션 예: mock → VCR
# Before ( mock)
@pytest.mark.unit
async def test_provider_call(mock_anthropic_stream):
    provider = mock_anthropic_stream([{"type": "text_delta", ...}])
    result = await provider.call_stream(...)
    ...

# After ( VCR) — mock 테스트는 삭제하지 않고 VCR 버전을 추가
@pytest.mark.vcr("anthropic/test_provider_call")
async def test_provider_call_vcr():
    provider = AnthropicProvider(settings)
    result = await provider.call_stream(...)  # cassette 재생
    ...
```

### : live 테스트 (선택적)

- 특정 시나리오만 `--live` 로 실제 호출
- 비용 발생하므로 CI nightly 또는 수동 트리거만
- cassette 갱신이 필요한 경우에도 `--record` 사용

### 마이그레이션 원칙

- mock 테스트는 삭제하지 않는다 (Tier 1/2 는 항상 필요)
- VCR 테스트는 mock 의 상위 집합이 아니라 보완 — 실제 API 응답 형식 검증 목적
- live 테스트는 VCR record 의 전제 조건 — cassette 이 없으면 live 로 녹화해야 한다

---

## 5. httpx 통합 상세

### vcrpy + httpx (async)

vcrpy 는 기본적으로 `urllib3` 를 패치한다. httpx 를 사용하는 App 에서는
추가 설정이 필요하다.

```python
# conftest.py 또는 services/vcr.py
import vcr

my_vcr = vcr.VCR(
    cassette_library_dir="backend/tests/vcr_cassettes",
    record_mode="none",  # replay only (CI default)
    decode_compressed_response=True,
    before_record_request=_redact_request,
    before_record_response=_redact_response,
    # httpx 통합을 위한 custom_patches
    custom_patches=(
        (vcr.stubs, "VCRHTTPSConnection", vcr.stubs.VCRHTTPSConnection),
    ),
)
```

### pytest-recording 플러그인

`pytest-recording` 은 vcrpy 를 pytest marker 로 감싸준다.

```python
# pyproject.toml
[tool.pytest.ini_options]
vcr_cassette_dir = "backend/tests/vcr_cassettes"
```

```python
@pytest.mark.vcr("anthropic/test_basic_call")
async def test_basic_call():
    # httpx 호출이 자동으로 cassette 에서 재생됨
    async with httpx.AsyncClient() as client:
        resp = await client.post("https://api.anthropic.com/v1/messages", ...)
    assert resp.status_code == 200
```

### httpx Transport 패치 방식

vcrpy 가 httpx 를 직접 지원하지 않는 경우, `httpx.MockTransport` 를 사용하여
cassette 데이터를 주입하는 커스텀 어댑터를 작성한다.

```python
import httpx
import yaml


class CassetteTransport(httpx.AsyncBaseTransport):
    """Replay cassette interactions via httpx transport layer."""

    def __init__(self, cassette_path: str) -> None:
        with open(cassette_path) as f:
            self._data = yaml.safe_load(f)
        self._index = 0

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if self._index >= len(self._data["interactions"]):
            raise CassetteMissing(f"No more interactions in cassette")
        interaction = self._data["interactions"][self._index]
        self._index += 1
        resp = interaction["response"]
        return httpx.Response(
            status_code=resp["status"]["code"],
            headers=resp.get("headers", {}),
            content=resp["body"]["string"].encode(),
        )
```

이 방식은 vcrpy 의 httpx 지원이 불충분할 때 fallback 으로 사용한다.

---

## 6. CI 파이프라인 설정 (replay-only)

### GitHub Actions 예시

```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: uv sync --extra test
      - run: pytest -m unit --tb=short
        env:
          VCR_RECORD_MODE: replay

  vcr-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: uv sync --extra test
      - run: pytest -m vcr --tb=short
        env:
          VCR_RECORD_MODE: replay
          # API key 는 불필요 — cassette 재생이므로
          # ANTHROPIC_API_KEY 를 secrets 에 넣지 않아도 됨
```

### CI 에서 record 방지

```python
# conftest.py
import os

def pytest_configure(config):
    mode = os.environ.get("VCR_RECORD_MODE", "replay")
    if os.environ.get("CI") == "true" and mode == "record":
        raise SystemExit(
            "ERROR: VCR_RECORD_MODE=record is forbidden in CI. "
            "Use 'replay' to avoid unexpected API costs."
        )
```

### cassette 누락 감지

CI 에서 `replay` 모드로 실행 시 cassette 파일이 없으면 `CassetteMissing` 예외가
발생하여 테스트가 실패한다. 이는 의도된 동작이다 — silent skip 이 아닌 명시적
실패로 cassette 누락을 즉시 감지한다.

---

## 7. 트러블슈팅 가이드

### 7.1 Stale cassette (오래된 cassette)

**증상**: 테스트가 통과하지만 실제 API 응답 형식이 변경됨. 또는 테스트가 갑자기
실패하며 "response body mismatch" 오류.

**원인**: provider API 가 응답 스키마를 업데이트했는데 cassette 가 이전 형식을
반환하고 있음.

**해결**:
1. `VCR_RECORD_MODE=record pytest -k test_name -v` 로 해당 cassette 재녹화
2. `git diff` 로 변경된 응답 필드 확인
3. redact 검사 후 commit

**예방**: 월 1회 또는 provider SDK 업그레이드 시 cassette 일괄 재녹화 스크립트 실행.

```bash
VCR_RECORD_MODE=record pytest -m vcr --tb=short 2>&1 | tee cassette-refresh.log
```

### 7.2 스키마 변경 (API 응답 구조 변경)

**증상**: `KeyError` 또는 `ValidationError` — cassette 응답에 새 필드가 없거나
필드 이름이 변경됨.

**원인**: Anthropic/OpenAI 등 provider 가 API 버전을 올리면서 응답 구조가 달라짐.

**해결**:
1. provider SDK 버전과 cassette 녹화 시점의 SDK 버전 비교
2. 해당 provider cassette 전체 재녹화
3. 내부 타입 변환 코드 (`providers/<name>.py`) 도 함께 업데이트

### 7.3 타임아웃 차이

**증상**: cassette replay 는 즉시 반환하므로 타임아웃 관련 코드 경로가 테스트되지
않음.

**원인**: vcrpy replay 는 네트워크 지연을 시뮬레이션하지 않음.

**해결**:
- 타임아웃 로직은 별도 unit test 에서 `asyncio.wait_for` + mock 으로 테스트
- VCR 테스트는 "정상 응답 경로" 검증 목적으로만 사용
- 타임아웃/재시도 경로는 Tier 1 (mock) 에서 커버

### 7.4 request matching 실패

**증상**: `CannotSendRequest` 또는 "cassette does not contain a matching request"

**원인**: 코드 변경으로 request body/headers/URL 이 cassette 와 달라짐.

**해결**:
1. cassette YAML 의 `request.uri`, `request.body` 와 실제 요청 비교
2. request body 에 timestamp/nonce 같은 동적 값이 포함되어 있는지 확인
3. 동적 값은 custom matcher 에서 무시하도록 설정:

```python
my_vcr = vcr.VCR(
    match_on=["method", "scheme", "host", "port", "path"],
    # body matching 은 제외 (동적 필드 때문)
)
```

### 7.5 streaming (SSE) cassette 처리

**증상**: SSE 응답이 단일 body 로 녹화되어 streaming 동작을 테스트할 수 없음.

**원인**: vcrpy 는 HTTP 응답을 통째로 녹화함. SSE 이벤트 단위 재생이 기본 지원되지
않음.

**해결**:
- SSE streaming 테스트는 Tier 1 (mock, Chapter A `mock_anthropic_stream` fixture) 로 커버
- VCR 은 non-streaming endpoint (단일 JSON 응답) 에만 적용
- streaming 통합 테스트가 필요하면 Tier 4 (live) 또는 커스텀 SSE replay 어댑터 작성

### 7.6 cassette 파일이 너무 큰 경우

**증상**: git diff 가 수천 줄, review 불가능.

**원인**: 긴 대화 / 큰 응답 body 가 cassette 에 포함됨.

**해결**:
- 테스트 시나리오를 최소화 (짧은 프롬프트, 짧은 응답)
- 불필요한 interaction 제거 (cassette YAML 수동 편집 가능)
- `.gitattributes` 에 cassette 파일을 `linguist-generated` 로 표시하여 PR diff 에서
  기본 접기 처리

```gitattributes
backend/tests/vcr_cassettes/** linguist-generated=true
```

---

## 부록: pytest marker 와 VCR 모드 매핑

| marker | VCR 모드 | API 호출 | cassette 필요 |
|---|---|---|---|
| `@pytest.mark.unit` | N/A (mock) | No | No |
| `@pytest.mark.integration` | N/A (mock) | No | No |
| `@pytest.mark.vcr(name)` | replay (default) | No | Yes |
| `@pytest.mark.vcr(name)` + `record` env | record | Yes | No (생성됨) |
| `@pytest.mark.live` | live | Yes | No |

---

## 부록: cassette 파일 관리 규칙

1. cassette 파일은 `backend/tests/vcr_cassettes/<provider>/` 에 provider 별로 분리
2. 파일명은 테스트 함수명과 일치 (`test_foo.yaml` → `test_foo`)
3. cassette 은 git 에 commit (재현성 보장)
4. `.gitignore` 에 cassette 를 추가하지 말 것 — replay 모드에서 필요
5. cassette 수정 시 반드시 PR review 포함 (시크릿 redact 확인)
6. 불필요해진 cassette 는 테스트 삭제 시 함께 삭제 (orphan cassette 방지)
