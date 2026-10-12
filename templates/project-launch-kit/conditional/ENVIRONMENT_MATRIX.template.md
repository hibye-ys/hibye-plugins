# {{PROJECT_NAME}} — Environment Matrix

> secret·credential 값과 값의 digest는 이 파일에 쓰지 않는다. 이름·분류·소재·소유자·검증 방법만 기록한다.
> 상태 어휘: `ACTIVE | DORMANT | NOT_OPERATED | UNAVAILABLE`. 환경이 존재한다고 가정하지 않는다.

## 환경

| 환경 | 상태 | 목적 | 데이터 성격 | 접근 주체 | 변경 권한 | 설정 정본 | 배포 상태 정본 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| local | {{LOCAL_STATUS}} | {{LOCAL_PURPOSE}} | {{LOCAL_DATA}} | {{LOCAL_ACTORS}} | {{LOCAL_MUTATION_AUTHORITY}} | {{LOCAL_CONFIG_AUTHORITY}} | {{LOCAL_RUNTIME_TRUTH}} |
| test | {{TEST_STATUS}} | {{TEST_PURPOSE}} | {{TEST_DATA}} | {{TEST_ACTORS}} | {{TEST_MUTATION_AUTHORITY}} | {{TEST_CONFIG_AUTHORITY}} | {{TEST_RUNTIME_TRUTH}} |
| production | {{PRODUCTION_STATUS}} | {{PRODUCTION_PURPOSE}} | {{PRODUCTION_DATA}} | {{PRODUCTION_ACTORS}} | {{PRODUCTION_MUTATION_AUTHORITY}} | {{PRODUCTION_CONFIG_AUTHORITY}} | {{PRODUCTION_RUNTIME_TRUTH}} |

## 설정·Secret 카탈로그

분류는 `public-config | secret | credential | derived | operation-scoped` 중 하나다. `public-config`만
명시적으로 client artifact에 포함될 수 있다.

| 이름 | 분류 | 환경 | 사용 단계 | 값의 정본 | 주입·파생 경로 | 소비자 | 누락·부분·무효 시 동작 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| {{CONFIG_NAME}} | {{CLASSIFICATION}} | {{ENVIRONMENTS}} | {{BUILD_RUNTIME_OR_OPERATION}} | {{AUTHORITATIVE_STORE}} | {{MATERIALIZATION_PATH}} | {{CONSUMERS}} | {{FAILURE_BEHAVIOR}} |

## 원자성·동일성 그룹

함께 있어야 하거나 여러 소비자가 같은 값을 사용해야 하는 설정을 개별 키로 판단하지 않는다.

| 그룹 ID | 구성원 | 불변식 | 단일 출처 | 부분·불일치 검출 |
| --- | --- | --- | --- | --- |
| {{GROUP_ID}} | {{CONFIG_NAMES_OR_CONSUMERS}} | {{ALL_OR_NONE_OR_EXACT_EQUALITY_RULE}} | {{GROUP_AUTHORITY}} | {{PARITY_CHECK}} |

## 우선순위와 파싱

| 소비자 | 입력 우선순위 | 출처 혼합 규칙 | 형식·범위 검증 | 기본값 정책 |
| --- | --- | --- | --- | --- |
| {{CONSUMER}} | {{EXPLICIT_PRECEDENCE_ORDER}} | {{MIXING_ALLOWED_OR_REJECTED}} | {{VALIDATOR}} | {{DEFAULT_OR_FAIL_CLOSED}} |

## 파생 설정 파일·빌드 산출물

파생물은 정본이 아니다. secret을 포함할 수 있는 파생물은 최소 allowlist와 접근 제한을 갖는다.

| 파생물 | 입력 정본 | 포함 allowlist | 생성 명령 | 저장·접근 경계 | 최신성 검증 |
| --- | --- | --- | --- | --- | --- |
| {{DERIVED_ARTIFACT}} | {{SOURCE}} | {{ALLOWED_NAMES}} | {{GENERATION_COMMAND}} | {{IGNORE_PERMISSION_AND_PATH_RULES}} | {{FRESHNESS_CHECK}} |

## 검증·Readback 사슬

저장소나 provider console에 이름이 존재하는 것과 실제 소비자가 올바른 값을 쓰는 것은 별개의 증거다.

| 대상 | 선언·소재 검사 | 주입 검사 | 빌드·배포 산출물 검사 | 독립 라이브 readback | 증거 등급·유효기간 |
| --- | --- | --- | --- | --- | --- |
| {{CONFIG_OR_GROUP}} | {{DECLARATION_CHECK}} | {{INJECTION_CHECK}} | {{ARTIFACT_CHECK}} | {{LIVE_READBACK}} | {{EVIDENCE_GRADE_AND_FRESHNESS}} |

## 자격 증명 Lifecycle

| 이름 | 발급 책임자 | 회전 책임자 | 마지막 확인 | 만료 | 폐기 조건·증거 |
| --- | --- | --- | --- | --- | --- |
| {{CREDENTIAL_NAME}} | {{PROVISIONING_OWNER}} | {{ROTATION_OWNER}} | {{VERIFIED_AT_OR_UNKNOWN}} | {{EXPIRY_OR_UNKNOWN}} | {{REVOCATION_TRIGGER_AND_READBACK}} |

## 불변식

- [ ] 운영 secret과 실제 값은 저장소·로그·빌드 산출물에 포함되지 않는다.
- [ ] public config와 secret의 분류가 명시돼 있다.
- [ ] 환경의 미가동·휴면·사용 불가 상태를 `ACTIVE`로 표현하지 않는다.
- [ ] 각 값에는 정본이 하나뿐이며, 생성 파일·배포 설정·문서는 파생물로 표시한다.
- [ ] 같은 의미를 여러 소비자가 사용할 때 단일 출처 또는 exact parity 검사가 있다.
- [ ] 함께 필요한 키는 같은 출처에서 원자적으로 선택하며 부분 구성은 거부한다.
- [ ] 환경이나 필수 설정 누락이 조용한 fallback으로 바뀌지 않는다.
- [ ] 선택 기능의 미설정은 명시적인 `DISABLED` 또는 `NOT_CONFIGURED` 상태로 관측된다.
- [ ] client artifact에는 명시적으로 허용한 public config만 포함된다.
- [ ] 운영 빌드와 라이브 소비자가 의도한 endpoint·공개 식별자를 사용한다는 readback이 있다.
- [ ] 운영값을 개발·CI·다른 소비자로 일괄 복사하지 않고 최소 allowlist만 주입한다.
- [ ] operation-scoped 값은 영속 설정 저장소에 남지 않는다.
- [ ] 마지막 회전·만료·provider 상태를 증명하지 못하면 `UNKNOWN`으로 남긴다.
- [ ] 회전은 새 값의 소비 확인과 이전 값의 provider-side 폐기 확인까지 포함한다.

## 환경 간 차이

| 차이 | 영향 환경 | 이유 | 소유자 | 드리프트 검출 방법 | 제거 조건 |
| --- | --- | --- | --- | --- | --- |
| {{DIFFERENCE}} | {{AFFECTED_ENVIRONMENTS}} | {{RATIONALE}} | {{OWNER}} | {{DRIFT_CHECK}} | {{REMOVAL_TRIGGER}} |
