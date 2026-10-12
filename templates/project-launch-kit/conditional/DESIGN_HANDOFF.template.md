# {{PROJECT_NAME}} — Design Handoff: {{SURFACE}}

> Handoff ID: {{HANDOFF_ID}}
> 디자인 소유자: {{DESIGN_OWNER}}
> 구현 소유자: {{IMPLEMENTATION_OWNER}}
> 최종 수용자: {{ACCEPTANCE_OWNER}}
> 상태: `SOURCE_CAPTURED | MAPPED | IMPLEMENTING | BLOCKED | VERIFIED | SUPERSEDED`
> 소스 증거 등급: `EXACT | CURRENT_RECONSTRUCTED | UNRECOVERABLE`

## 1. 목표와 범위

- 사용자가 실제로 보거나 수행해야 하는 결과: {{USER_OUTCOME}}
- 원본과 같다고 판단할 최종 질문: {{USER_ACCEPTANCE_LITMUS}}
- 포함 surface·상태·상호작용: {{IN_SCOPE}}
- 기존 구현을 보존할 부분: {{PRESERVE_SCOPE}}
- 제외·연기할 부분과 이유: {{OUT_OF_SCOPE_OR_DEFERRED}}

## 2. 소스 정체성과 실행 폐쇄성

- 소스 종류: {{SOURCE_KIND}}
- 불변 소스 참조·revision·digest: {{SOURCE_IDENTITY}}
- 실행 방법과 runtime version: {{SOURCE_RUNTIME}}
- 기준 viewport / DPR: {{VIEWPORT_AND_DPR}}
- 기준 상태·데이터 fixture: {{REFERENCE_STATE}}
- 알려진 소스 결함·모순·복구 불가 항목: {{SOURCE_LIMITATIONS}}

| 의존 항목 | 경로·참조 | digest·version | 역할 | 가용성 |
| --- | --- | --- | --- | --- |
| {{DEPENDENCY_KIND}} | {{DEPENDENCY_REF}} | {{DEPENDENCY_IDENTITY}} | {{DEPENDENCY_ROLE}} | `EXACT`, `RECONSTRUCTED`, `MISSING` 중 하나 |

소스 파일만이 아니라 지원 코드, 폰트, 아이콘, 이미지와 외부 의존성까지 재현 가능한 형태로 닫혀야 한다.
외부 의존성은 고정된 사본과 identity가 없으면 `EXACT`로 판정하지 않는다.

### 레퍼런스와 제품 의존성의 분리

위 폐쇄성은 소스를 재현하기 위한 것이다. 제품은 레퍼런스 보관소 없이도 빌드·실행·일반 릴리스 검증이
가능해야 한다. 필요한 폰트·이미지·지원 자산은 허용된 사용권을 확인하고 앱 소유 경로로 복사하며,
값·공식은 구현에 전사하고 출처는 주석 anchor로 남긴다. symlink나 레퍼런스를 향한 URL 문자열·설정도
실행 의존이므로 제품 경로에 남기지 않는다. 출처 주석은 실행 의존이 아니다.

| 소스 자산·지원 코드 | 소스 identity | 앱 소유 위치 | 복사·변환 후 identity | 소유자·사용권 근거 |
| --- | --- | --- | --- | --- |
| {{SOURCE_ASSET}} | {{SOURCE_ASSET_IDENTITY}} | {{APP_OWNED_ASSET_PATH}} | {{APP_ASSET_IDENTITY}} | {{ASSET_OWNER_AND_USAGE_RIGHTS}} |

원본과 비교하는 이식 정합 테스트는 별도 명시적 검증 레인에 둔다. 일반 빌드·push·릴리스 검증이 이 레인에
의존하지 않게 하며, 레퍼런스가 없다고 정합 검증을 `PASS`로 바꾸지는 않는다.

## 3. Surface census와 처리 결정

각 화면 요소·상태·상호작용을 빠짐없이 분류한다. 허용 값은
`TRANSPLANT | APPROVED_ADAPTATION | PRESERVE_EXISTING | DEFER`다.

| surface·상태·상호작용 | 소스 anchor | 처리 결정 | 결정 ID | 소유자 | 비고 |
| --- | --- | --- | --- | --- | --- |
| {{SOURCE_SURFACE}} | {{SOURCE_ANCHOR}} | {{DISPOSITION}} | {{DECISION_ID_OR_NA}} | {{OWNER}} | {{NOTE}} |

`APPROVED_ADAPTATION`은 디자인·제품 결정 ID가 필수다. 소스가 없거나 모순되면 값을 발명하지 않고
`BLOCKED` 또는 `DEFER`로 남긴다.

## 4. 소스 ↔ 구현 양방향 매핑

| 소스 요소·값·공식 | 소스 anchor | 대상 소유자·위치 | 대상 anchor | 매핑 | 역방향 검사 |
| --- | --- | --- | --- | --- | --- |
| {{SOURCE_ELEMENT_OR_FORMULA}} | {{SOURCE_ANCHOR}} | {{TARGET_OWNER_AND_LOCATION}} | {{TARGET_ANCHOR}} | `EXACT`, `APPROVED_ADAPTATION` 중 하나 | {{REVERSE_CHECK}} |

- 소스에만 있고 구현에 없는 항목: {{UNMAPPED_SOURCE_ITEMS}}
- 구현에만 있고 소스·승인 결정에 없는 항목: {{UNCLAIMED_TARGET_ITEMS}}
- 변환 렌더 경로: {{SOURCE_EXPRESSION_TO_RASTER_PATH}}

변환 렌더 경로가 있다면 `소스 표현식 → 계약 값 → projection·plan → scene graph·view tree → raster` 전체를
추적한다. 색·alpha·scale 같은 값이 누락되거나 두 번 적용되지 않았는지 확인한다.

## 5. 실제 데이터와 동작 배선

| 사용자 동작 | 소스 동작 | 실제 진입점 | 상태·데이터 정본 | 쓰기·영속·reload | 실패 시 동작 |
| --- | --- | --- | --- | --- | --- |
| {{USER_ACTION}} | {{SOURCE_BEHAVIOR}} | {{REAL_ENTRY}} | {{STATE_OR_DATA_OWNER}} | {{PERSISTENCE_BEHAVIOR}} | {{FAILURE_BEHAVIOR}} |

preview, stand-in, 고정 fixture, noop callback은 탐색 증거일 뿐 완료 증거가 아니다. 최종 검증은 실제
shell·provider·store·API·persistence·renderer·배포 설정이 연결된 사용자 진입점에서 수행한다.

## 6. 상태·상호작용 매트릭스

| 상태 | 진입·fixture | 기대 구조·스타일 | 기대 상호작용 | 반응형·접근성 | 증거 |
| --- | --- | --- | --- | --- | --- |
| {{STATE}} | {{ENTRY_AND_FIXTURE}} | {{EXPECTED_RENDER}} | {{EXPECTED_INTERACTION}} | {{RESPONSIVE_AND_ACCESSIBILITY}} | {{EVIDENCE}} |

최소 검토 범위: loading·empty·error, hover·focus·selected·disabled, 주요 viewport, animation·reduced-motion,
성공·실패·reload 뒤 영속 상태. 소스에 없는 상태는 임의 완성하지 않고 별도 결정한다.

## 7. 승인된 차이와 소스 결함

| 차이·결함 | 실측 증거 | 제품 이유 | 결정권자·결정 ID | 수용 기준 | 회귀 검사 |
| --- | --- | --- | --- | --- | --- |
| {{DEVIATION_OR_DEFECT}} | {{MEASURED_EVIDENCE}} | {{RATIONALE}} | {{AUTHORITY_AND_DECISION_ID}} | {{ACCEPTANCE_CHECK}} | {{REGRESSION_CHECK}} |

## 8. 결정론적 검증 환경

- 소스 실행 진입점: {{SOURCE_RENDER_ENTRY}}
- 대상 실제 진입점: {{TARGET_REAL_ROUTE_OR_ENTRY}}
- 브라우저·렌더러·운영체제: {{RENDER_ENVIRONMENT}}
- viewport·DPR·zoom: {{VIEWPORT_DPR_ZOOM}}
- 폰트·asset 준비 조건: {{FONT_AND_ASSET_READY_CONDITION}}
- fixture·계정·권한: {{FIXTURE_IDENTITY}}
- clock·locale·timezone·network: {{TIME_AND_NETWORK_CONTROLS}}
- motion·camera·random seed: {{MOTION_AND_RANDOM_CONTROLS}}
- settled frame 판정: {{SETTLED_CONDITION}}
- 비교 baseline identity: {{BASELINE_IDENTITY}}

## 9. 검증 결과

검사 전 각 행을 `REQUIRED`, `ADVISORY`, `NOT_APPLICABLE`로 분류하고 이유를 적는다. 비적용 행은
이유를 기록하고 실행 판정은 `—`로 둔다. 적용 행의 판정은 `NOT_RUN | PASS | FAIL | BLOCKED | ENV_LIMIT`이다.
사용자 수용 질문과 레퍼런스 없는 제품 빌드 검증은 필수다. 실패한 뒤 분류를 낮춰 완료로 만들지 않는다.

| 계층 | 필수성·이유 | 검사 | 기대 | 실제 | 증거 | 판정 |
| --- | --- | --- | --- | --- | --- | --- |
| 소스·매핑 | {{REQUIREMENT_AND_REASON}} | {{SOURCE_AND_MAPPING_CHECK}} | {{EXPECTED}} | {{ACTUAL}} | {{EVIDENCE}} | `NOT_RUN` |
| 구조 | {{REQUIREMENT_AND_REASON}} | {{DOM_VIEW_TREE_OR_SCENE_CHECK}} | {{EXPECTED}} | {{ACTUAL}} | {{EVIDENCE}} | `NOT_RUN` |
| 런타임 값 | {{REQUIREMENT_AND_REASON}} | {{COMPUTED_VALUE_CHECK}} | {{EXPECTED}} | {{ACTUAL}} | {{EVIDENCE}} | `NOT_RUN` |
| raster | {{REQUIREMENT_AND_REASON}} | {{PIXEL_INK_OR_CONTRAST_CHECK}} | {{EXPECTED}} | {{ACTUAL}} | {{EVIDENCE}} | `NOT_RUN` |
| 동작·영속 | {{REQUIREMENT_AND_REASON}} | {{INTERACTION_AND_PERSISTENCE_CHECK}} | {{EXPECTED}} | {{ACTUAL}} | {{EVIDENCE}} | `NOT_RUN` |
| 제품 독립성 | REQUIRED — 레퍼런스는 제품 부품이 아님 | {{SOURCE_ISOLATED_BUILD_AND_RELEASE_CHECKS}} | 레퍼런스 없이 정상 검증 통과 | {{ACTUAL}} | {{EVIDENCE}} | `NOT_RUN` |
| 사용자 수용 | REQUIRED — 원래 결과 질문 | {{USER_ACCEPTANCE_CHECK}} | {{EXPECTED}} | {{ACTUAL}} | {{EVIDENCE}} | `NOT_RUN` |

단일 screenshot diff나 build 성공만으로 정합을 선언하지 않는다. 구조·계산값·raster·동작 중 해당
surface를 실제로 판별하는 독립 증거를 함께 둔다.

제품 독립성은 원본을 삭제하지 않고 임시 격리 checkout에서 확인한다. 검사할 candidate의 미커밋 변경과
필수 앱 자산도 포함하고 identity를 기록한다. 레퍼런스 디렉터리는 포함하지 않으며 이전 빌드 출력·캐시로
참조 누락이 가려지지 않게 새로 빌드한다. 일반 빌드·통합·릴리스 검증 중 해당 경로의 실제 명령을 실행하되,
실제 push·게시·배포 mutation은 수행하지 않는다. 문자열 스캔 통과만으로 독립성을 증명하지 않는다.

- 격리 candidate·입력 identity: {{ISOLATED_CANDIDATE_AND_INPUT_IDENTITY}}
- 제외한 레퍼런스·캐시와 격리 방식: {{REFERENCE_AND_CACHE_ISOLATION}}
- 실행한 비배포 검증 명령·결과: {{ISOLATED_VALIDATION_COMMANDS_AND_RESULTS}}
- 별도 소스 정합 검증 레인·소유자: {{SOURCE_FIDELITY_LANE_AND_OWNER}}

## 10. 검증기 유효성

| 의도적 변이 | 반드시 실패해야 할 검사 | 실제 결과 | 검출 여부 |
| --- | --- | --- | --- |
| {{NEGATIVE_MUTATION}} | {{EXPECTED_ORACLE_FAILURE}} | {{OBSERVED_RESULT}} | `NOT_RUN` |

검증 대상의 값·anchor·baseline을 바꿔도 검사가 계속 통과한다면 검증기는 완료 증거가 아니다.

## 11. 완료와 재검증 조건

- [ ] 소스와 모든 실행 의존성의 identity가 고정됐다.
- [ ] census의 모든 항목에 처리 결정과 소유자가 있다.
- [ ] 소스 미매핑과 대상 무근거 항목이 0이거나 승인 결정으로 닫혔다.
- [ ] 실제 사용자 진입점에서 데이터·동작·영속을 검증했다.
- [ ] 원래 사용자 수용 질문(또는 명시적으로 승인된 축소 기준)을 통과했다.
- [ ] 레퍼런스 없이 앱 소유 자산만으로 제품 빌드·일반 릴리스 검증이 통과했다.
- [ ] 모든 `REQUIRED` 검사가 `PASS`다. 이유가 있어도 `NOT_RUN`, `FAIL`, `BLOCKED`, `ENV_LIMIT`은 통과가 아니다.
- [ ] 소스·매핑·대상·renderer·상태 계약 변경 시 재검증할 검사와 소유자가 정해졌다.

연기 항목은 owner·결정 ID·제외 범위를 남긴다. 원래 사용자 수용 질문에 필요한 항목이 연기됐다면
전체 handoff를 `VERIFIED`로 표시하지 않는다. 수용자가 범위를 명시적으로 축소한 경우에만 변경된 기준과
결정을 연결하고 그 범위의 완료를 보고한다. advisory 미검증·실패도 숨기지 않는다.

- 검증된 범위·수용 기준: {{VERIFIED_SCOPE_AND_ACCEPTANCE_CRITERIA}}
- 제외·연기 범위·owner·결정 ID: {{DEFERRED_SCOPE_OWNER_AND_DECISION_OR_NONE}}
- advisory 잔여 검증·위험: {{ADVISORY_REMAINING_CHECKS_AND_RISKS_OR_NONE}}
