# {{PROJECT_NAME}} — Release Runbook

> Lane: {{RELEASE_LANE}}
> 대상 환경: {{ENVIRONMENT}}
> Release owner / operator: {{OWNER_AND_OPERATOR}}
> 실행 상태: `ACTIVE | DORMANT | UNAVAILABLE | SEALED`
> 마지막 리허설: {{LAST_REHEARSAL_DATE}}
> 현재 상태 정본: {{LIVE_STATE_READBACK}}

이 runbook은 실행 절차이지 실행 승인이나 현재 가용성의 증거가 아니다. 명령을 실행하기 전에 lane 상태와
승인·자격·외부 전제조건을 현재 시점에서 다시 확인한다.

이 파일은 lane별 공통 절차다. 아래 양식의 명령·oracle·복구 정책은 이 lane에 맞게 준비하되,
operation·attempt·candidate·실측 결과는 여기 채우지 않는다. 실행을 준비할 때 아래 제목부터 끝까지를
`docs/releases/{{RELEASE_LANE}}/{{OPERATION_ID}}/{{ATTEMPT_ID}}.md`에 복사해 실행별 기록으로 사용한다.
명령·정책의 구체화는 해당 프로젝트의 실행 계약을 따라야 하며, 이 산문 자체가 기계 권한을 발급하지 않는다.

## 실행별 기록 양식

> 프로젝트 / lane / 환경: {{PROJECT_NAME}} / {{RELEASE_LANE}} / {{ENVIRONMENT}}
> 공통 절차 불변 참조: {{RUNBOOK_PATH_AND_REVISION_OR_DIGEST}}
> 실행 owner / operator: {{OWNER_AND_OPERATOR}}
> 실행 직전 lane 상태·가용성 증거: {{LIVE_LANE_STATUS_AND_EVIDENCE}}
> 이전 attempt 또는 복구 대상 기록: {{PREVIOUS_ATTEMPT_OR_RECOVERY_REFERENCE_OR_NONE}}

공통 절차의 이 revision을 실행 시점의 snapshot으로 보존한다. 첫 mutation 전에 입력·intent·승인 참조를
기록하고, 이후 관측은 시각과 증거를 붙여 추가한다. 정정도 이전 값을 지우지 않고 정정 이유와 함께 추가한다.
외부 원장·receipt가 정본이면 그 불변 참조만 남기며 여기서 경쟁 원장을 만들지 않는다.
실패·불명·차단 기록도 보존하고, 후속 실행으로 기존 기록을 덮어쓰지 않는다.

## 1. 릴리스 정체성

- operation ID: {{OPERATION_ID}}
- attempt ID: {{ATTEMPT_ID}}
- candidate revision·버전: {{CANDIDATE_ID}}
- build artifact와 digest: {{ARTIFACT_ID_AND_DIGEST}}
- 설정·schema identity: {{CONFIG_AND_SCHEMA_IDENTITY}}
- 실행 도구·정책 identity: {{EXECUTOR_AND_POLICY_IDENTITY}}
- 현재 live / 직전 성공 release: {{CURRENT_AND_PREVIOUS_RELEASE}}
- 포함 범위: {{RELEASE_SCOPE}}
- 제외 범위: {{EXCLUDED_SCOPE}}
- 배포 전략·트래픽 전환: {{ROLLING_CANARY_BLUE_GREEN_OR_ALL_AT_ONCE}}

## 2. 사전 조건

- [ ] lane이 실제로 `ACTIVE`이며 필요한 실행자·외부 adapter·자격이 존재함
- [ ] 대상 환경과 현재 live identity를 독립 readback으로 확인함
- [ ] checkout·artifact·config가 승인된 candidate identity와 일치함
- [ ] 필요한 게이트가 정확히 이 candidate·artifact·환경에 대해 통과함
- [ ] 환경 설정·secret 이름과 소비자가 확인됨
- [ ] 이전 producer/consumer·저장 데이터와의 양방향 호환성을 확인함
- [ ] schema·데이터·서비스·client 변경의 안전한 적용 순서가 정해짐
- [ ] 동시 release·중복 실행을 막는 lock·CAS·fence가 확인됨
- [ ] backup·복구 증거와 rollback 또는 forward-fix 가능 범위가 확인됨
- [ ] 관측·경보·성공 판정 readback이 실제로 사용 가능함
- [ ] 변경 권한과 승인 증거가 준비됨
- [ ] secret 값이 argv·로그·receipt·artifact에 노출되지 않음

미충족 전제조건과 판정:

| 전제조건 | 상태 | 근거 | 실패 시 다음 행동 |
| --- | --- | --- | --- |
| {{PREREQUISITE}} | {{PASS_FAIL_BLOCKED_OR_UNAVAILABLE}} | {{EVIDENCE}} | {{STOP_RECOVER_OR_ESCALATE}} |

## 3. Read-only plan

실행 명령 또는 절차:

```text
{{PLAN_COMMAND_OR_STEPS}}
```

예상 변경:

- 바뀌는 것: {{WILL_CHANGE}}
- 바뀌지 않는 것: {{WILL_NOT_CHANGE}}
- plan identity: {{PLAN_DIGEST_OR_ID}}
- plan 유효기간: {{PLAN_EXPIRY}}
- 현재 상태가 바뀌면 무효가 되는 조건: {{PRESTATE_FENCE}}

Apply는 mutation 직전에 동일 입력으로 plan을 다시 계산하고 identity가 일치할 때만 진행한다.

## 4. 적용 순서

서로 공유 상태·포트·artifact·DB를 사용하는 단계는 격리가 증명되지 않으면 병렬 실행하지 않는다.

| 순서 | 대상 | 실행·변경 | 요구 prestate | 예상 효과 | 단계 readback | receipt·evidence | 중단 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| {{ORDINAL}} | {{TARGET}} | {{EXACT_COMMAND_OR_ACTION}} | {{REQUIRED_PRESTATE}} | {{EXPECTED_EFFECT}} | {{STEP_READBACK}} | {{RECEIPT_OR_EVIDENCE}} | {{STOP_CONDITION}} |

첫 외부 변경 전에 남길 intent·fence: {{WRITE_AHEAD_INTENT_AND_IDEMPOTENCY_FENCE}}

## 5. 독립 Readback

업로드·배포 명령의 exit code나 실행자가 만든 receipt만으로 성공을 판정하지 않는다.

| 확인 대상 | 독립 시스템 정본 | 기대 상태 | 판정 방법 | 수렴 시간·재조회 정책 | 증거 출력 |
| --- | --- | --- | --- | --- | --- |
| {{TARGET}} | {{AUTHORITATIVE_READBACK}} | {{EXPECTED_STATE}} | {{CHECK}} | {{CONVERGENCE_AND_RETRY_POLICY}} | {{EVIDENCE_OUTPUT}} |

Terminal 상태: `VERIFIED | FAILED | OUTCOME_UNKNOWN | BLOCKED`.

## 6. 모호한 결과

명령 응답이 끊겼거나 부분 성공 여부를 모르면 성공·실패로 추정하거나 같은 mutation을 재실행하지 않는다.

1. 같은 operation·attempt·request identity로 현재 상태를 readback한다.
2. {{AMBIGUOUS_READBACK_STEP}}
3. 기존 intent와 정확히 일치하는 효과만 reconcile한다: {{RECONCILE_STEP}}
4. 판정할 수 없으면 `OUTCOME_UNKNOWN`을 유지하고 격리·에스컬레이션한다: {{ESCALATION_STEP}}

재실행이 안전한 것으로 증명된 조건: {{SAFE_RETRY_CONDITION_OR_NONE}}

동일 attempt의 readback·reconcile은 이 기록에 이어 적는다. 안전한 재실행 조건이 충족된 후에만
새 attempt ID와 별도 기록을 만들고 이전 attempt를 연결한다. 새 release 의도에는 새 operation ID를 쓴다.

## 7. 되돌리기·Forward fix

- rollback target identity와 근거: {{ROLLBACK_TARGET_AND_EVIDENCE}}
- 되돌릴 수 있는 범위: {{ROLLBACK_SCOPE}}
- 되돌릴 수 없는 범위: {{NON_ROLLBACK_SCOPE}}
- rollback 진입 조건: {{ROLLBACK_TRIGGER}}
- rollback 준비 불가 시 동작: {{ROLLBACK_UNAVAILABLE_BEHAVIOR}}
- forward fix를 선택할 조건: {{FORWARD_FIX_TRIGGER}}
- 복구 후 검증: {{RECOVERY_VERIFICATION}}

Rollback도 별도 plan·승인·mutation·독립 readback을 갖는 release다. 데이터나 이미 적용된 schema는
down migration으로 추정 복구하지 않고, 명시된 forward migration 또는 restore 절차를 따른다.

## 8. 결과 기록

세 기록의 역할을 섞지 않는다.

| 기록 | 소유하는 사실 | 위치 |
| --- | --- | --- |
| 진행 중 operation·receipt | intent, attempt, 부분 효과, recovery 상태 | {{IN_FLIGHT_AUTHORITY}} |
| 실행 이력 | 성공뿐 아니라 실패·차단·불명 및 후속 recovery 경과 | 이 실행별 기록과 {{AUTHORITATIVE_OPERATION_HISTORY_REFERENCE_OR_NONE}} |
| 현재 live 상태 | 지금 실제로 서비스 중인 revision·config·schema | {{CURRENT_STATE_READBACK}} |

- terminal 상태: {{TERMINAL_STATUS}}
- 실제 release identity: {{ACTUAL_RELEASE_ID}}
- 실행자·시각: {{OPERATOR_AND_TIME}}
- 독립 readback 증거: {{READBACK_EVIDENCE}}
- 남은 위험·후속 STATE ID: {{REMAINING_RISK_AND_STATE_ID}}

| 관측·정정 시각 | 사건·판정 | 증거 참조 | 이전 관측의 정정 이유 또는 후속 관계 |
| --- | --- | --- | --- |
| {{OBSERVED_AT}} | {{OBSERVATION_OR_CORRECTION}} | {{IMMUTABLE_EVIDENCE_REFERENCE}} | {{CORRECTION_REASON_OR_FOLLOWUP_OR_NONE}} |

`OUTCOME_UNKNOWN`은 해당 시점의 판정이지 효과가 없었다는 증명이 아니다. recovery 관측으로 판정이
달라지면 이전 판정을 보존한다. rollback은 §7의 별도 release 기록을 연결하며 원 실행의 실패를 지우지 않는다.

## 9. Stop 조건

### Mutation 전

- candidate·artifact·plan·승인·prestate 중 하나라도 어긋나면 변경하지 않고 중단한다.
- required gate의 `NOT_RUN`, `SKIPPED`, `ENV_LIMIT`, `BLOCKED`는 통과로 취급하지 않는다.
- current state나 rollback target을 독립적으로 확인할 수 없으면 중단한다.

### Mutation 후

- expected readback이 나오지 않으면 완료 이력에 성공을 기록하지 않는다.
- 부분 효과 가능성이 있으면 새 attempt나 blind retry 대신 동일 operation의 recovery로 전환한다.
- 관측 불가·receipt 유실·외부 상태 불일치는 `OUTCOME_UNKNOWN` 또는 `BLOCKED`로 남긴다.
