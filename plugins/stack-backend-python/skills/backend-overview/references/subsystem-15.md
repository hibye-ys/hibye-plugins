
# Subsystem 15 — Observability

## 목적 (1줄)

구조화 로깅 foundation + Sink Protocol 경계. stdlib 핸들러가 stdout/file 을 소유하고, Sink 는 외부 목적지(Sentry/OTel/ring-buffer)를 위한 확장 포인트.

## 파일 / 모듈

- `backend/observability/config.py` — `LoggingSettings` (pydantic BaseSettings, `APP_` prefix, `${VAR}` 치환)
- `backend/observability/configure.py` — `configure_logging(settings) -> SinkRegistry` (startup 1회 호출, idempotent)
- `backend/observability/contextvars.py` — `ALL_FIELDS` + `bind_log_context` / `clear_log_context`
- `backend/observability/processors.py` — validator / scrubber / dispatch processor 팩토리
- `backend/observability/secrets.py` — `scrub_secrets()` + `_scrub_dict()` 정규식 기반 scrubber
- `backend/observability/sinks.py` — `LogSink` / `MetricSink` / `AlertSink` Protocol + Null 구현 + `SinkRegistry`
- `backend/observability/events.py` — `EVENT_SCHEMA` (event_name → required/optional 필드)
- `backend/observability/errors.py` — `LoggingConfigurationError`
- `backend/middleware/request_id.py` / `backend/middleware/trace_context.py` — ContextVar bind/clear 미들웨어
- `logs/ai_backend.log` — `TimedRotatingFileHandler` 기본 출력 (midnight UTC rotation, JSONL)

## Public API (`backend/observability/__init__.py`)

| 이름 | 역할 |
|---|---|
| `configure_logging(settings)` | startup 1회. structlog processor chain + stdout/file 핸들러 설치 |
| `get_logger(name=None)` | structlog BoundLogger 얻기 (thin alias) |
| `bind_log_context(**fields)` | ALL_FIELDS 화이트리스트 검증 후 ContextVar bind (오타 → ValueError) |
| `clear_log_context(*fields)` | 인자 없으면 ALL_FIELDS 전체 unbind, 인자 주면 해당만 |
| `ALL_FIELDS` | 10개 frozenset (아래 참조) |
| `SinkRegistry` | `log_sinks` / `metric_sinks` / `alert_sinks` 리스트 보관 |
| `LoggingSettings` | env-driven 로깅 설정 |
| `LoggingConfigurationError` | 설정/부팅 실패 |

## ContextVar 필드 (ALL_FIELDS — 10개 고정)

항상 bound: `request_id`, `spawn_depth` (기본 0).
조건부 bound: `trace_id`, `span_id`, `session_id`, `user_id`, `run_name`, `agent`, `model`, `turn_count`.

- bind/unbind 는 **반드시 `bind_log_context` / `clear_log_context` 경유**. 직접 `structlog.contextvars.bind_contextvars` 호출 금지 (오타 감지 우회)
- 알려지지 않은 키 → `ValueError` raise (startup 또는 test 시점 fail-fast)
- 값이 없으면 로그 라인에서 **OMITTED** (None 주입 금지 — `merge_contextvars` 가 자동 제외)

## Processor Chain (structlog configure)

```
contextvars.merge_contextvars
stdlib.add_logger_name
stdlib.add_log_level
processors.TimeStamper(fmt="iso", utc=True)
make_validator_processor(strict=...)
scrub_log_values
processors.StackInfoRenderer
dev.set_exc_info
make_dispatch_processor(registry)
stdlib.ProcessorFormatter.wrap_for_formatter   ← 렌더링은 핸들러 측에서
```

- stdlib handler 2개: stdout(StreamHandler, Console/JSON) + file(TimedRotatingFileHandler, JSON always)
- foreign (비-structlog) 로그도 `foreign_pre_chain` 으로 같은 shared processor + scrub 적용
- 재구성 시 `_observability_handler` 센티넬로 이전 핸들러 식별 → `close()` + `removeHandler`

## LoggingSettings (env `APP_` prefix)

| 필드 | 기본값 | 메모 |
|---|---|---|
| `log_level` | `INFO` | Literal 타입 — 오타 시 startup fail |
| `log_level_overrides` | `{}` | CSV `mod:LEVEL,mod:LEVEL` — dropped names 는 NOTSET 으로 reset |
| `log_format` | `auto` | prod → json, 그 외 → console |
| `log_file_path` | `logs/ai_backend.log` | 부모 디렉토리 자동 생성 |
| `log_file_retention_days` | `7` | `TimedRotatingFileHandler.backupCount` |
| `log_schema_strict` | `False` | True → EVENT_SCHEMA 불일치 시 raise |
| `otel_endpoint` / `sentry_dsn` / `slack_webhook_url` | None | Axis 2/3 reservation (foundation 미사용) |

## 미들웨어 bind 패턴

```python
# routes/run.py, middleware/request_id.py 등
bind_log_context(request_id=rid, session_id=sid, agent=policy.name, spawn_depth=0)
try:
    ...
finally:
    clear_log_context("request_id", "session_id", "agent", "spawn_depth")
```

Sub-agent spawn (`engine/subagent.py`):
- 부모 ContextVar 오염 방지 위해 `contextvars.copy_context()` 후 자식 안에서 `spawn_depth+1` bind
- 자식은 `turn_count` 를 clear (부모와 별개 루프)

## Gotchas

- **Literal 타입 + mode="before" validator**: `log_level` 에 `UPPER()` 정규화를 `mode="before"` 로 걸어야 Literal 검증 전에 대문자화됨
- **Handler FD 누수**: `removeHandler` 만 호출하면 파일 핸들 + rotation timer 가 GC 전까지 남음 → `close()` 먼저 호출
- **Per-module override shrink**: `log_level_overrides` 에서 키가 사라지면 해당 logger 를 `NOTSET` 으로 reset 해야 함 (`_PREVIOUS_OVERRIDES` 추적)
- **DotEnv JSON parse 우회**: pydantic-settings 가 `dict[str, str]` 을 JSON 으로 먼저 파싱하려고 함 → `_NoJsonParseOverridesMixin` 으로 두 source (env + dotenv) 모두 bypass
- **민감 정보 금지**: API key, PII, session token 로깅 금지. 누출 시 `scrub_log_values` 가 fail-safe 로 차단 (알려진 패턴만)
- **부팅 설정 ContextVar 금지**: ContextVar 는 요청 범위 상태에만. `LoggingSettings` 는 일반 singleton

## 담당 skill

`debug-session` — "왜 안 돼" 상황에서 로드.
`agent-debug` command — 최근 pytest 실패 + 로그 tail.

## Debug workflow

1. 증상 파악 (에러 메시지, 스트림 끊김 등)
2. 관련 로그 조회 (`logs/ai_backend.log` — JSONL, `request_id` 로 grep)
3. 재현 가능한 fixture 작성 (`conftest.py`)
4. pytest 로 격리 재현
5. 원인 수정 + 테스트 추가

## 관련 AD / Spec

- dual auth (프로바이더 키 암호화) — 로그에 키 값 절대 금지
