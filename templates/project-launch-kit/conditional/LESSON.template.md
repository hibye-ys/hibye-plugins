# {{DATE}} — {{LESSON_TITLE}}

> Lesson ID: {{LESSON_ID}}
> 소유자: {{OWNER}}
> 상태: `DRAFT | VALIDATED | ADOPTED | SUPERSEDED`
> 적용 범위: {{SCOPE}}
> 근거가 고정된 변경·사건: {{EVIDENCE_SNAPSHOT}}
> 마지막 재검증: {{VERIFIED_DATE}}
> 대체 관계: {{SUPERSEDES_OR_SUPERSEDED_BY}}
> 검색 인덱스: `docs/lessons/README.md`

## 1. 한 문장 규칙

**{{WHEN_CONDITION}}이면 {{REQUIRED_ACTION}}한다. 왜냐하면 {{MECHANISM}}이기 때문이다.**

- 금지할 지름길: {{FORBIDDEN_SHORTCUT}}
- 사용자의 원래 목표로 되묻는 질문: {{USER_GOAL_LITMUS}}

## 2. 문제 진단

- 기대한 결과: {{EXPECTED_OUTCOME}}
- 실제로 관측한 결과: {{OBSERVED_OUTCOME}}
- 사용자·시스템 영향: {{IMPACT}}
- 최초 관측 시점과 환경: {{OBSERVATION_CONTEXT}}

| 주장 | 분류 | 확인 방법 | 관측 결과 | 근거 anchor |
| --- | --- | --- | --- | --- |
| {{CLAIM}} | `FACT | HYPOTHESIS | FALSIFIED | UNKNOWN` | {{PROBE}} | {{RESULT}} | {{EVIDENCE_ANCHOR}} |

관측 한 번이나 문서·주석만으로 원인을 확정하지 않는다. 조건을 바꾼 재현, 반대 사례 또는 실제
source→sink 기전 중 하나가 없으면 `HYPOTHESIS`로 남긴다.

## 3. 확인된 원인과 놓친 이유

- 확인된 인과 사슬: {{VERIFIED_CAUSAL_CHAIN}}
- 원인으로 오해했지만 반증된 것: {{FALSIFIED_HYPOTHESES}}
- 기존 검사·리뷰가 놓친 이유: {{WHY_PRIOR_CONTROLS_MISSED_IT}}
- 아직 설명하지 못한 부분: {{REMAINING_UNCERTAINTY}}

## 4. 결정과 실제 조치

| 결정·조치 | 바뀐 계약·동작 | 소유자 | 상태 | 변경 근거 |
| --- | --- | --- | --- | --- |
| {{DECISION_OR_ACTION}} | {{CHANGED_CONTRACT_OR_BEHAVIOR}} | {{ACTION_OWNER}} | `PLANNED | APPLIED | REVERTED | NOT_APPLICABLE` | {{CHANGE_EVIDENCE}} |

조치가 없었다면 그 이유와 현재 노출된 위험을 적는다: {{NO_ACTION_REASON_OR_RESIDUAL_RISK}}

## 5. 검증 결과

| 검사 | 고정 조건·fixture | 기대 신호 | 반대 신호 | 실제 결과 | 판정 |
| --- | --- | --- | --- | --- | --- |
| {{CHECK}} | {{FIXED_CONDITIONS}} | {{EXPECTED_SIGNAL}} | {{FALSIFYING_SIGNAL}} | {{ACTUAL_RESULT}} | `NOT_RUN | PASS | FAIL | ENV_LIMIT` |

- 다음에 먼저 실행할 최소 결정적 검사: {{MINIMUM_DECISIVE_CHECK}}
- 검사가 실제 결함을 잡는다는 음성·변이 증거: {{ORACLE_NEGATIVE_EVIDENCE}}
- 검증하지 않은 범위: {{UNVERIFIED_SCOPE}}

`exit 0`, 파일 존재, 테스트 개수, 화면 표시만으로 완료를 대신하지 않는다. skip·미실행·환경 한계와
사용자 목표를 실제로 달성한 결과를 분리해 기록한다.

## 6. 재사용 가능한 형태

- 일반화된 불변식: {{DURABLE_INVARIANT}}
- 새 작업에서 이 규칙을 적용할 trigger: {{APPLICATION_TRIGGER}}
- 적용 직전 다시 확인할 현재 사실: {{FRESH_READBACK_BEFORE_REUSE}}
- 이 사례에만 해당하는 값·경로·제품명: {{LOCAL_DETAILS_NOT_TO_COPY}}
- 비슷해 보이지만 적용하면 안 되는 반례: {{COUNTEREXAMPLE}}

교훈은 과거 사건의 결론이지 현재 구현의 정본이 아니다. 현재 경로·호출자·환경이 바뀔 수 있다면
재사용 전에 실측한다.

## 7. 예방 장치와 반영 위치

| 반영 위치 | 반영 내용 | 강제 수준 | 소유자 | 상태·증거 |
| --- | --- | --- | --- | --- |
| 규칙·계약 | {{RULE_OR_CONTRACT_CHANGE}} | `GUIDANCE | ENFORCED` | {{OWNER}} | {{STATUS_AND_EVIDENCE}} |
| 코드·구성 | {{CODE_OR_CONFIG_CHANGE}} | `GUIDANCE | ENFORCED | NOT_APPLICABLE` | {{OWNER}} | {{STATUS_AND_EVIDENCE}} |
| test·gate | {{TEST_OR_GATE_CHANGE}} | `ENFORCED | NOT_APPLICABLE` | {{OWNER}} | {{STATUS_AND_EVIDENCE}} |
| runbook·template | {{RUNBOOK_OR_TEMPLATE_CHANGE}} | `GUIDANCE | NOT_APPLICABLE` | {{OWNER}} | {{STATUS_AND_EVIDENCE}} |
| 교훈 인덱스 | {{INDEX_ENTRY}} | `DISCOVERABLE` | {{OWNER}} | {{STATUS_AND_EVIDENCE}} |

문서에 적힌 규칙과 실제로 실행되는 예방 장치를 구분한다. 반복 가능하고 영향이 큰 결함이며 결정론적
검사가 있을 때만 gate로 승격한다. 일회성·환경 의존 사건은 검색 가능한 근거로 보존한다.

## 8. 유효 범위와 lifecycle

- 적용되는 조건: {{VALID_WHEN}}
- 적용되지 않는 조건: {{INVALID_WHEN}}
- 재검증 trigger: {{REVERIFY_TRIGGER}}
- 중복 교훈·관련 결정·runbook: {{RELATED_RECORDS}}
- 폐기·대체 조건: {{RETIREMENT_CONDITION}}

`SUPERSEDED`가 되면 새 교훈의 ID와 변경 이유를 남기고, 인덱스가 새 항목을 가리키게 한다. 과거 근거는
삭제하지 않는다.

## 9. 인덱스 항목

첫 교훈이면 `docs/lessons/README.md`에 `# Lessons` 제목을 만든다. 아래 한 줄만 추가하고 본문의
사건 서사나 현재 구현 사실을 인덱스에 복사하지 않는다.

```markdown
- [{{LESSON_ID}} — {{LESSON_TITLE}}]({{LESSON_ID}}.md) — {{LESSON_SUMMARY}}
```
