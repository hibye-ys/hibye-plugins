# {{PROJECT_NAME}} — Risk Review

> Review ID: {{REVIEW_ID}}
> 검토 대상·진입점: {{FEATURE_FLOW_AND_ENTRYPOINTS}}
> 기준선 / 후보: {{BASELINE_AND_CANDIDATE}}
> Accountable owner: {{ACCOUNTABLE_OWNER}}
> 검토자: {{REVIEWERS}}
> 검토일: {{DATE}}
> 상태: `DRAFT | ACCEPTED | BLOCKED | SUPERSEDED`

## 1. 범위와 검토 트리거

- In scope: {{IN_SCOPE}}
- Out of scope: {{OUT_OF_SCOPE}}
- 의도적으로 그대로 두는 것: {{UNCHANGED_BOUNDARIES}}
- 트리거: {{SENSITIVE_DATA_AUTH_EXTERNAL_WRITE_AI_RETENTION_OR_IRREVERSIBLE_ACTION}}

## 2. 보호할 것

| 자산·사용자 | 소유자 | 손상될 수 있는 것 | 영향 범위 | 허용 가능한 손실·중단 |
| --- | --- | --- | --- | --- |
| {{ASSET_OR_ACTOR}} | {{ASSET_OWNER}} | {{HARM}} | {{BLAST_RADIUS}} | {{RECOVERY_OBJECTIVE_OR_NONE}} |

## 3. 신뢰 경계와 데이터·행위 흐름

| 단계 | 입력·호출자 | 검증 경계 | 소비자·저장소 | 권한 전이·외부 효과 | 성공 판정 readback |
| --- | --- | --- | --- | --- | --- |
| {{STEP}} | {{INPUT_OR_CALLER}} | {{VALIDATION_BOUNDARY}} | {{CONSUMER_OR_STORE}} | {{AUTHORITY_OR_SIDE_EFFECT}} | {{INDEPENDENT_READBACK}} |

### 데이터 Lifecycle

| 데이터 | 분류 | 수집 근거·최소 범위 | 외부 전달 | 저장 위치·기간 | 내보내기·삭제·복구 |
| --- | --- | --- | --- | --- | --- |
| {{DATA}} | {{CLASSIFICATION}} | {{PURPOSE_AND_MINIMIZATION}} | {{EXTERNAL_RECIPIENT_OR_NONE}} | {{STORE_AND_RETENTION}} | {{EXPORT_DELETE_AND_RECOVERY_PATH}} |

## 4. 위험 시나리오와 실제 방어

방어 상태는 `LIVE | DORMANT | UNAVAILABLE | PLANNED` 중 하나다. 코드나 문서가 존재하는 것만으로
`LIVE`라 부르지 않고, 실제 호출 경로와 실패 시 동작을 확인한다.

| Risk ID | 전제·진입점 | 실패·공격 경로 | 결과 | 영향·가역성·탐지성 | 현재 방어·소유자 | 방어 상태 | 남은 위험 | 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| {{RISK_ID}} | {{PRECONDITION_AND_ENTRYPOINT}} | {{FAILURE_OR_ABUSE_PATH}} | {{CONSEQUENCE}} | {{IMPACT_REVERSIBILITY_DETECTABILITY}} | {{CONTROL_AND_OWNER}} | {{CONTROL_STATE}} | {{RESIDUAL_RISK}} | {{CHECK}} |

최소 검토 항목:

- 인증 없이 가능한 읽기·쓰기
- 사용자·프로젝트·조직 간 데이터 경계
- 입력 크기·형식·URL·파일 경계
- secret·토큰·개인정보의 로그·오류·모델 전달
- 중복 실행과 재시도로 인한 결제·게시·삭제 반복
- 외부 서비스 실패·지연·부분 성공
- 삭제·내보내기·보존·복구 의무
- 제어 코드가 있지만 실제 호출자가 없거나 전제조건이 빠진 휴면·사용 불가 상태
- 후보가 자신의 정책·검증기·승인 규칙을 함께 바꿔 자기 승인하는 경로
- 테스트 fixture와 실제 운영 경로의 권한·환경·데이터 차이

## 5. 고위험 실행·승인 경계

| 행위 | 계획과 실행의 분리 | 최소 실행 권한 | 승인 주체 | 승인 결속 대상 | 만료·철회 | 중복 방지·fence | 완료 readback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| {{ACTION}} | {{PLAN_APPLY_BOUNDARY}} | {{LEAST_PRIVILEGE_EXECUTOR}} | {{APPROVAL_AUTHORITY}} | {{OPERATION_ATTEMPT_CANDIDATE_TARGET_AND_PLAN}} | {{EXPIRY_AND_REVOCATION}} | {{IDEMPOTENCY_OR_ONE_USE_CONTROL}} | {{TERMINAL_READBACK}} |

- 승인 기록과 실제 실행 권한의 관계: {{RECORD_VS_ENFORCEMENT}}
- 승인 없이 허용되는 읽기·dry-run: {{AUTONOMOUS_READ_ONLY_SCOPE}}
- 승인 후에도 금지되는 행위: {{HARD_DENY_BOUNDARY}}

## 6. 부분 성공·결과 불명·복구

외부 효과 뒤 응답이 끊기면 재실행을 성공 전략으로 가정하지 않는다. 먼저 동일 operation의 실제 상태를
readback하고 `SUCCEEDED | FAILED | OUTCOME_UNKNOWN`으로 판정한다.

| 실패 지점 | 가능한 부분 효과 | 즉시 격리·완화 | 판정 readback | rollback·forward fix·reconcile | 책임자 |
| --- | --- | --- | --- | --- | --- |
| {{FAILURE_POINT}} | {{POSSIBLE_EFFECT}} | {{CONTAINMENT}} | {{READBACK}} | {{RECOVERY_PATH}} | {{RECOVERY_OWNER}} |

- 알려진 안전 상태: {{KNOWN_SAFE_STATE}}
- 복구에 필요한 사전 증거·artifact: {{RECOVERY_PREREQUISITES}}
- 복구 경로가 없을 때의 기본 동작: {{FAIL_CLOSED_BEHAVIOR}}

## 7. 결정과 위험 수용

Disposition은 `MITIGATE | ACCEPT | TRANSFER | AVOID | BLOCK` 중 하나다. 수용은 범위·소유자·기한이
있는 결정이며 영구적인 면제가 아니다.

| Risk ID | Disposition | 결정권자 | 이유·수용 비용 | 보완 통제 | 만료·재검토 조건 | 추적 위치 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| {{RISK_ID}} | {{DISPOSITION}} | {{DECISION_OWNER}} | {{RATIONALE_AND_ACCEPTED_COST}} | {{COMPENSATING_CONTROL_OR_NONE}} | {{EXPIRY_OR_REVIEW_TRIGGER}} | {{STATE_DECISION_OR_ISSUE_ID}} |

출시·활성화 조건:

- 반드시 닫을 위험: {{BLOCKING_RISK_IDS}}
- 별도 승인 대상: {{APPROVAL_REQUIRED_ACTIONS}}
- 재검토 트리거: {{CHANGE_INCIDENT_SCALE_OR_DATE_TRIGGER}}

## 8. 검증 결과

판정은 `NOT_RUN | PASS | FAIL | BLOCKED | ENV_LIMIT` 중 하나다. 저장소 검증과 실제 운영 증거를
같은 등급으로 합치지 않는다.

| Risk ID | 검사·명령 | 기대 | 실제 | 증거 등급·대상 revision | 판정 |
| --- | --- | --- | --- | --- | --- |
| {{RISK_ID}} | {{TEST_OR_COMMAND}} | {{EXPECTED}} | {{ACTUAL}} | {{REPOSITORY_RUNTIME_OR_USER_SURFACE_EVIDENCE}} | `NOT_RUN` |

## 완료 규칙

- [ ] 필수 방어가 `DORMANT`, `UNAVAILABLE`, `PLANNED`이면 위험을 닫은 것으로 기록하지 않는다.
- [ ] `NOT_RUN`, `BLOCKED`, `ENV_LIMIT`을 성공 증거로 사용하지 않는다.
- [ ] 문서·숨겨진 URL·호출되지 않는 검증기는 보안 경계로 간주하지 않는다.
- [ ] 승인은 정확한 행위·후보·대상·계획·유효기간에 결속돼 있다.
- [ ] 외부 쓰기는 최소 권한 실행자와 독립 readback을 갖는다.
- [ ] `OUTCOME_UNKNOWN` 상태에서는 blind retry나 성공 처리를 하지 않는다.
- [ ] 수용 위험에는 결정권자·영향·기한·재검토 트리거가 있다.
- [ ] negative case가 방어를 제거하거나 우회했을 때 실제로 실패한다.
