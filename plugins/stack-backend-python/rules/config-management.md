---
paths:
  - "backend/settings_base.py"
  - "backend/server_settings.py"
  - "backend/services/auth/**"
  - ".env*"
---

> App backend rules — Config management invariants, extension guide, impact map.
> 관련: `mcp-patterns.md` (${VAR} 치환 동일 패턴), `ai-provider-patterns.md` (API key 주입)

# config-management — 설정 관리 규약

## 불변식 (Invariants)

**코드로서 설정:**
- 모든 설정은 pydantic `BaseSettings` 타입 클래스로 표현. dict/YAML 값이 직접 돌아다니지 않음
- 오타/누락/형 불일치가 startup 에서 즉시 감지

**시크릿 분리:**
- 시크릿은 반드시 환경변수 / `.env` 에서 로드
- pydantic `BaseSettings` 는 env 를 직접 읽음. **외부 YAML config (MCP servers, providers)** 에서만 `${VAR}` / `${VAR:-default}` 플레이스홀더 치환 지원 (`backend/services/mcp/config.py:49` 참조)
- 시크릿이 repo 에 들어가면 즉시 rotate + history 제거
- `.env.example` 은 키 목록만 (값은 더미)

**안전한 기본값:**
- 개발 환경에서 `.env` 없어도 부팅되도록 안전 기본값 제공
- 기본값 금지 대상: API key, secret, production endpoint URL

**시작 시 검증 (fail-fast):**
- **현재 Settings 클래스 (7)**: `AppSettings` (base) + 서브시스템별 `AuthSettings` / `ServerSettings` / `LspSettings` / `LoggingSettings` / `DatabaseSettings` / `ProviderSettings`
- 각 Settings 는 **싱글턴** — `@lru_cache` 로 감싼 `get_*_settings()` 헬퍼 또는 `main.py` lifespan 에서 1회 인스턴스화. 중복 인스턴스화 금지
- 검증 실패 → 프로세스 종료 (uvicorn 재시작)
- 외부 리소스 sanity check 포함 (provider key 유효성, 디렉토리 존재)
- **prod-only 제약은 `@model_validator(mode="after")` 로 Settings 인스턴스화 시점에 `ConfigurationError` raise** — 약한/placeholder 시크릿 거부 + 최소 길이 강제 등. 예:
  - `AuthSettings._assert_prod_secret_strength` (`backend/services/auth/settings.py:113`) — `app_env=="prod"` 에서 None / placeholder (`replace-me-in-production` 등) / <32 바이트 secret 거부
  - `ServerSettings` prod CORS 검증 (`backend/server_settings.py:68`) — 와일드카드 origin 거부

**Hot reload (선택적):**
- 일부 설정만 SIGHUP / 엔드포인트로 재로드 가능
- 시크릿은 hot reload 금지 — 반드시 재시작
- reload 는 새 Settings 인스턴스 생성 (기존 인스턴스 mutate 금지)

## 새 설정 추가하기

1. `Settings` 클래스에 필드 추가 (타입 + 기본값 또는 필수)
2. `.env.example` 에 동일 키 추가
3. 시크릿이면 `${VAR}` 패턴 사용, `.env` 에 실제 값
4. 필수 필드면 기본값 없이 선언 → startup fail-fast
5. hot reload 대상이면 reload 로직에 포함 여부 결정
6. 테스트: 누락 시 ConfigurationError, 잘못된 형식 시 ValidationError

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 필수 설정 추가 | 모든 배포 환경의 .env 동시 업데이트 필요 |
| 설정 필드 이름 변경 | .env + .env.example + 참조 코드 전부 |
| 기본값 변경 | .env 없는 개발 환경 동작 변경 |
| hot reload 대상 확대 | reload 중 일시적 불일치 가능성 검토 |
| Settings 클래스 분할 | import 경로 변경 + DI 주입 지점 변경 |

## 금지 사항

- 시크릿을 코드나 테스트에 하드코드
- Settings 에 mutable state (리스트/dict 에 요청 간 쌓기)
- 설정 로드 순서가 import 순서에 의존
- 런타임에 Settings 인스턴스 mutate (reload 는 새 인스턴스)
