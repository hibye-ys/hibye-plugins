# {{SLICE_ID}} — {{SLICE_TITLE}}

> Owner: {{OWNER}}
> 상태: `DRAFT | READY | IN_PROGRESS | BLOCKED | VERIFIED`
> Workspace: {{BRANCH_OR_WORKTREE}}
> 연결된 PROJECT_BRIEF: {{PROJECT_BRIEF_REFERENCE}}
> 연결된 결정·STATE: {{DECISION_AND_STATE_IDS}}

한 slice는 실제 진입점부터 관측 가능한 결과까지 이어지는 **독립적인 사용자 결과 하나**만 소유한다.
서로 따로 출시·검증·취소할 수 있는 결과는 별도 slice로 나눈다.

`DRAFT`에서는 사용자 리트머스와 산출 위치부터 고정한다. `READY`는 baseline·실행 경계·범위·소유권·
변경 계약·조건부 trigger·수용 oracle의 필수 입력이 확정되어 구현을 시작해도 된다는 뜻이다.
필수 결정이 `UNDECIDED`이거나 적용 여부가 `UNKNOWN`이면 그 결정에 의존하는 범위는 시작하지 않는다.
문서·STATE 링크만 만드는 것으로 해결되지 않는다. 독립적인 범위는 별도 slice로 분리할 수 있다.
비차단 결정에는 owner·다음 확인 조건·STATE 참조를 남긴다. 실행 뒤에 얻을 결과·증거는 `NOT_RUN`으로
남겨도 되지만, 무엇을 어떤 oracle로 검사할지는 `READY` 전에 정한다.

## 1. 사용자 리트머스

- 사용자 원문·요청: {{ORIGINAL_USER_REQUEST}}
- 결과 문장: {{USER}}가 {{STARTING_STATE}}에서 {{END_RESULT}}을 완료한다.
- 최종 산출물이 놓일 위치: {{OUTPUT_DESTINATION}}

`VERIFIED` 전에는 위 결과 문장을 실제로 수행한다. 파일 존재나 하위 단계의 green만으로 대체하지 않는다.

## 2. 시작 전 Baseline

| 항목 | 실측 값 | 증거 |
| --- | --- | --- |
| 기준 revision | {{BASELINE_REVISION}} | {{REVISION_EVIDENCE}} |
| 현재 사용자 동작 | {{CURRENT_BEHAVIOR}} | {{BEHAVIOR_EVIDENCE}} |
| 재현되는 실패·간극 | {{REPRODUCED_GAP}} | {{REPRODUCTION_STEPS_OR_COMMAND}} |
| 변경 전 oracle | {{PRE_CHANGE_ORACLE}} | {{ORACLE_SOURCE}} |

## 3. 실행 경계

| 항목 | 값 |
| --- | --- |
| 실제 진입점 | {{ENTRY_POINT}} |
| 환경·runtime | {{RUNTIME_ENVIRONMENT}} |
| fixture·계정·입력 | {{FIXTURE_OR_INPUT}} |
| 외부 시스템 | {{EXTERNAL_SYSTEMS_OR_NONE}} |
| 관측 가능한 종료점 | {{OBSERVABLE_END_POINT}} |
| 성공 증거 | {{SUCCESS_EVIDENCE}} |

## 4. 범위

### 포함

- {{IN_SCOPE_1}}
- {{IN_SCOPE_2}}

### 제외

- {{OUT_OF_SCOPE_1}}
- {{OUT_OF_SCOPE_2}}

## 5. 소유권과 의존성

| 작업 단위 | 소유 파일·모듈 | Owner | 선행 조건 | 병렬 가능 여부와 이유 |
| --- | --- | --- | --- | --- |
| {{WORK_UNIT}} | {{OWNED_PATHS}} | {{WORK_OWNER}} | {{PREDECESSORS_OR_NONE}} | {{PARALLELISM_DECISION}} |

같은 wave에서 소유 파일이 겹치거나 아직 결정되지 않은 계약을 공유하면 병렬화하지 않는다.

## 6. 변경 계약

| 계약 | 변경 여부 | 호환 영향 | 검증 |
| --- | --- | --- | --- |
| {{CONTRACT}} | {{CHANGE}} | {{COMPATIBILITY_IMPACT}} | {{CONTRACT_CHECK}} |

## 7. 조건부 문서 재평가

판정은 `YES | NO | UNKNOWN` 중 하나다. `YES`면 실제 문서 ID·경로와 필요한 결정 결과를 연결한다.
`UNKNOWN`이면 조사·결정 owner와 STATE를 연결하고, 의존 범위는 적용 여부와 필수 결정이 해결될 때까지
차단한다. `per_event` 기록은 준비 상태를 연결하고 실제 사건 때 생성한다.
프로젝트 시작 때 `NO`였어도 이 slice가 새 경계를 만들면 다시 연다.

| Trigger ID | 판정 | 이번 slice의 근거 | 적용 문서·STATE reference |
| --- | --- | --- | --- |
| `shared_contract` | {{TRIGGER_SHARED_CONTRACT}} | {{SHARED_CONTRACT_EVIDENCE}} | {{SHARED_CONTRACT_REFERENCE}} |
| `environment_or_secret` | {{TRIGGER_ENVIRONMENT_OR_SECRET}} | {{ENVIRONMENT_EVIDENCE}} | {{ENVIRONMENT_REFERENCE}} |
| `sensitive_or_irreversible` | {{TRIGGER_SENSITIVE_OR_IRREVERSIBLE}} | {{RISK_EVIDENCE}} | {{RISK_REFERENCE}} |
| `duplicated_fact` | {{TRIGGER_DUPLICATED_FACT}} | {{COUPLING_EVIDENCE}} | {{COUPLING_REFERENCE}} |
| `user_reachable_deployment` | {{TRIGGER_USER_REACHABLE_DEPLOYMENT}} | {{RELEASE_EVIDENCE}} | {{RELEASE_REFERENCE}} |
| `incident_or_recovery_ownership` | {{TRIGGER_INCIDENT_OR_RECOVERY}} | {{INCIDENT_EVIDENCE}} | {{INCIDENT_REFERENCE}} |
| `design_transplant` | {{TRIGGER_DESIGN_TRANSPLANT}} | {{DESIGN_HANDOFF_EVIDENCE}} | {{DESIGN_HANDOFF_REFERENCE}} |
| `reusable_lesson` | {{TRIGGER_REUSABLE_LESSON}} | {{LESSON_EVIDENCE}} | {{LESSON_REFERENCE}} |

## 8. 구현 순서

1. {{IMPLEMENTATION_STEP_1}}
2. {{IMPLEMENTATION_STEP_2}}
3. {{IMPLEMENTATION_STEP_3}}

각 계층을 따로 완성하는 것보다 가장 이른 시점에 실제 진입점과 종료점을 얇게 연결한다.

## 9. 수용 시나리오

변경 위험에 해당하는 행만 사용한다. 필요 없는 시나리오를 통과한 것처럼 채우지 않는다.

| 시나리오 | 진입·입력 | 사전 정의한 Oracle | 실행 명령·절차 | 증거 수준 | 판정 |
| --- | --- | --- | --- | --- | --- |
| 정상 흐름 | {{HAPPY_PATH_INPUT}} | {{HAPPY_PATH_ORACLE}} | {{HAPPY_PATH_CHECK}} | `repository`, `runtime`, `user-surface` 중 하나 | `NOT_RUN` |
| 실패 흐름 | {{FAILURE_INPUT}} | {{FAILURE_ORACLE}} | {{FAILURE_CHECK}} | {{FAILURE_EVIDENCE_LEVEL}} | `NOT_RUN` |
| 재시도·중복 | {{RETRY_INPUT}} | {{RETRY_ORACLE}} | {{RETRY_CHECK}} | {{RETRY_EVIDENCE_LEVEL}} | `NOT_RUN` |
| 영속·reload | {{PERSISTENCE_INPUT}} | {{PERSISTENCE_ORACLE}} | {{PERSISTENCE_CHECK}} | {{PERSISTENCE_EVIDENCE_LEVEL}} | `NOT_RUN` |

## 10. 검증 결과

| 위험·계약 | 가장 작은 결정적 검사 | 실제 결과 | 판정 | 귀속 |
| --- | --- | --- | --- | --- |
| {{RISK_OR_CONTRACT}} | {{CHECK}} | {{ACTUAL_RESULT}} | {{NOT_RUN_PASS_FAIL_BLOCKED_OR_ENV_LIMIT}} | {{CHANGE_PRE_EXISTING_ENVIRONMENT_OR_UNKNOWN}} |

검사 command의 exit code만 보지 않고 실제 대상·assertion·출력을 확인한다. 환경 실패는 제품 통과로 계산하지 않는다.

## 11. 완료 판정

- [ ] 사용자 리트머스를 실제 진입점에서 끝까지 수행함
- [ ] 산출물이 의도한 위치에 남음
- [ ] blocking 수용 시나리오와 변경 계약 검증이 통과함
- [ ] 조건부 trigger 8개를 현재 slice 기준으로 평가하고 필요한 문서·결정을 연결함
- [ ] 실행하지 못한 검증과 그 이유가 기록됨
- [ ] 남은 blocking 결정이 없음

## 12. 남은 결정·위험

| STATE ID | 결정·위험 | 영향 | 다음 조건 |
| --- | --- | --- | --- |
| {{STATE_ID_OR_NONE}} | {{REMAINING_DECISION_OR_RISK}} | {{IMPACT}} | {{NEXT_CONDITION}} |
