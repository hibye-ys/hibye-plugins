# {{PROJECT_NAME}} — Incident Runbook: {{INCIDENT_TYPE}}

> Incident ID: {{INCIDENT_ID}}
> 상태: `DETECTED | TRIAGING | CONTAINED | RECOVERING | MONITORING | RESOLVED`
> Severity: {{SEVERITY_AND_USER_IMPACT_RULE}}
> 시작 시각·기준 clock: {{STARTED_AT_AND_CLOCK_SOURCE}}
> 영향 환경·release: {{AFFECTED_ENVIRONMENT_AND_RELEASE}}
> 서비스 owner: {{SERVICE_OWNER}}
> Incident commander: {{INCIDENT_COMMANDER}}
> 실행 / 커뮤니케이션 owner: {{EXECUTION_AND_COMMUNICATION_OWNERS}}
> 마지막 검증일: {{VERIFIED_DATE}}

## 1. 발동 조건

- 사용자 증상: {{USER_SYMPTOM}}
- 시스템 신호: {{SYSTEM_SIGNAL}}
- incident 승격 임계·fingerprint: {{THRESHOLD_FINGERPRINT_AND_DEDUP_RULE}}
- 이 runbook이 아닌 경우: {{OUT_OF_SCOPE_SIGNAL}}
- 알려진 false positive·관측 한계: {{KNOWN_FALSE_POSITIVES_AND_VISIBILITY_GAPS}}

신호는 관측값이고 incident는 대응이 필요한 상태다. 단일 알림·로그·모델 추정을 원인이나 incident로
자동 승격하지 않는다.

## 2. 영향 범위

| 표면 | 예상 정상 상태 | 관측 상태 | 영향 사용자·데이터·비용 | 확실성 | 근거 시각·출처 |
| --- | --- | --- | --- | --- | --- |
| {{SURFACE}} | {{EXPECTED_STATE}} | {{OBSERVED_STATE}} | {{IMPACT}} | {{CONFIRMED_SUSPECTED_OR_UNKNOWN}} | {{TIMESTAMP_AND_SOURCE}} |

- 영향이 없는 것으로 확인한 범위: {{CONFIRMED_UNAFFECTED_SCOPE}}
- 아직 관측할 수 없는 범위: {{UNOBSERVABLE_SCOPE}}

## 3. 즉시 안전 조치

원인을 고치기 전에 사용자·데이터·비용·권한 영향의 확대를 막는다. 가능한 한 가역적인 조치와 증거 보존을
먼저 수행한다.

| 순서 | 조치 | 바뀌는 것·안 바뀌는 것 | 가역성 | 승인 | 성공 readback | 중단 조건 |
| --- | --- | --- | --- | --- | --- | --- |
| {{ORDINAL}} | {{CONTAINMENT_ACTION}} | {{WILL_AND_WILL_NOT_CHANGE}} | {{REVERSIBILITY}} | {{APPROVAL}} | {{READBACK}} | {{STOP_CONDITION}} |

실행 전 승인이 필요한 조치: {{APPROVAL_REQUIRED_ACTION}}

증거 보존:

- 보존할 로그·trace·receipt·release identity: {{EVIDENCE_TO_PRESERVE}}
- secret·개인정보 redaction: {{REDACTION_RULE}}
- 보존 위치·기간·접근자: {{EVIDENCE_RETENTION_AND_ACCESS}}

## 4. 현재 상태 확정

문서·배포 명령 출력·오래된 registry만으로 현재 상태를 추정하지 않는다.

| 질문 | 독립 정본 | 조회 방법 | freshness | 기대 / 실제 | 판정 |
| --- | --- | --- | --- | --- | --- |
| {{STATE_QUESTION}} | {{AUTHORITATIVE_SOURCE}} | {{READ_ONLY_CHECK}} | {{FRESHNESS_RULE}} | {{EXPECTED_AND_ACTUAL}} | {{DECISION_RULE}} |

## 5. 사건 타임라인

사실·가설·결정·실행을 섞지 않고 append-only로 기록한다. 과거 판단이 틀렸으면 덮어쓰지 말고 정정 행을
추가한다.

| 시각 | 종류 | 주체 | 내용 | evidence·operation ID |
| --- | --- | --- | --- | --- |
| {{TIME}} | {{OBSERVATION_HYPOTHESIS_DECISION_ACTION_OR_CORRECTION}} | {{ACTOR}} | {{EVENT}} | {{EVIDENCE_OR_OPERATION_ID}} |

## 6. 진단과 재현

| 가설 | 지지 근거 | 반대 근거 | 다음 최소 검사 | 반증 조건 | 상태 |
| --- | --- | --- | --- | --- | --- |
| {{HYPOTHESIS}} | {{SUPPORTING_EVIDENCE}} | {{COUNTEREVIDENCE}} | {{NEXT_MINIMAL_CHECK}} | {{FALSIFIER}} | {{SUSPECTED_REFUTED_OR_CONFIRMED}} |

재현 상태는 `NOT_RUN | REPRODUCED | NOT_REPRODUCED | BLOCKED | ENV_LIMIT` 중 하나다.

- 재현 대상 release·환경·fixture: {{REPRODUCTION_BINDING}}
- 실행 명령·절차: {{REPRODUCTION_COMMAND}}
- 실제 결과·증거: {{REPRODUCTION_RESULT_AND_EVIDENCE}}
- 재현이 불가능할 때 허용되는 긴급 조치: {{EMERGENCY_EXCEPTION_OR_NONE}}

## 7. 수정·복구

긴급 containment와 영구 수정의 scope·승인·완료 조건을 분리한다.

FixSpec:

- 허용 범위: {{ALLOWED_CHANGE_SCOPE}}
- 금지 범위: {{FORBIDDEN_CHANGE_SCOPE}}
- 고칠 실패 메커니즘: {{FAILURE_MECHANISM}}
- 완료 조건: {{COMPLETION_CRITERIA}}
- 범위 밖 발견 시: `NEEDS_REPLAN`

1. 복구 plan 생성: {{RECOVERY_PLAN}}
2. 대상·영향 확인: {{TARGET_AND_IMPACT_CHECK}}
3. 승인: {{AUTHORITY}}
4. 적용: {{RECOVERY_ACTION}}
5. 독립 readback: {{RECOVERY_READBACK}}
6. 원래 사용자 증상 재검증: {{ORIGINAL_USER_LITMUS}}

## 8. 모호한 결과

- 재시도 금지 조건: {{NO_RETRY_CONDITION}}
- 같은 operation으로 reconcile하는 방법: {{RECONCILE_METHOD}}
- 부분 효과를 격리하는 방법: {{PARTIAL_EFFECT_CONTAINMENT}}
- 상태를 확정할 수 없을 때: {{ESCALATION}}

판정할 수 없는 외부 효과는 `OUTCOME_UNKNOWN`으로 유지한다. 새 시도·rollback·성공 기록으로 덮지 않는다.

## 9. 커뮤니케이션

| 대상 | 전달 조건 | 포함할 사실 | 제외할 비밀·추정 | 주기 | owner |
| --- | --- | --- | --- | --- | --- |
| {{AUDIENCE}} | {{NOTIFICATION_TRIGGER}} | {{CONFIRMED_FACTS}} | {{REDACTED_OR_UNCONFIRMED_CONTENT}} | {{CADENCE}} | {{COMMUNICATION_OWNER}} |

- 보안·개인정보·법무 에스컬레이션 조건: {{SPECIAL_ESCALATION_TRIGGER}}
- 다음 업데이트 시각: {{NEXT_UPDATE_AT}}

## 10. 종료 조건

- [ ] 사용자 핵심 흐름 복구
- [ ] 독립 readback과 원래 사용자 증상이 모두 정상
- [ ] 데이터·권한·비용 부작용과 backlog·지연 작업 확인
- [ ] 정해진 관측 기간 동안 재발하지 않음
- [ ] 장애를 숨기는 fallback·경보 비활성화가 남지 않음
- [ ] 임시 완화의 제거 또는 owner 지정
- [ ] 사건 증거와 타임라인 보존
- [ ] `OUTCOME_UNKNOWN`·미확인 영향이 없거나 명시적인 owner와 추적 ID를 가짐

종료 판정자·시각·근거: {{RESOLUTION_AUTHORITY_TIME_AND_EVIDENCE}}

## 11. 사후 조치

- 직접 원인과 기여 조건: {{CAUSE_AND_CONTRIBUTING_FACTORS}}
- 탐지·대응이 늦어진 이유: {{DETECTION_AND_RESPONSE_GAPS}}
- 우연히 작동한 것과 재사용 가능한 방어: {{ACCIDENTAL_VS_DURABLE_CONTROLS}}
- 제거할 임시 조치: {{TEMPORARY_MEASURES_TO_REMOVE}}
- 재발 방지 `docs/lessons/`·`STATE`·결정 ID: {{FOLLOW_UP_IDS}}
- runbook 재현·리허설 결과: {{RUNBOOK_REHEARSAL_RESULT}}
