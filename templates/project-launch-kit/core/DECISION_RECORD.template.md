# {{DATE}} — {{DECISION_TITLE}}

> ID: {{DECISION_ID}}
> 상태: `PROPOSED | DECIDED | DEFERRED | SUPERSEDED`
> 결정권자: {{DECISION_OWNER}}
> 결정일: {{DECIDED_AT_OR_NONE}}
> 권한 범위: {{AUTHORITY_SCOPE}}
> 관련 STATE: {{RELATED_STATE_IDS}}
> 대체하는 결정: {{SUPERSEDES_OR_NONE}}

기본 원칙은 **한 파일에 독립적으로 대체 가능한 결정 하나**다. 여러 결정이 같은 근거를 공유하더라도
각각 다른 시점에 번복될 수 있으면 파일을 나눈다.

## 결정할 문제

{{DECISION_QUESTION}}

## 근거

| 구분 | 주장·관찰 | 출처 anchor | 확인일 |
| --- | --- | --- | --- |
| 사실 | {{OBSERVED_FACT}} | {{FACT_SOURCE}} | {{FACT_VERIFIED_AT}} |
| 가정 | {{ASSUMPTION_OR_NONE}} | {{ASSUMPTION_SOURCE_OR_NONE}} | {{ASSUMPTION_REVIEW_AT}} |
| 반대 증거·한계 | {{COUNTEREVIDENCE_OR_LIMIT}} | {{COUNTEREVIDENCE_SOURCE}} | {{COUNTEREVIDENCE_VERIFIED_AT}} |

## 제약과 비목표

- 제약: {{CONSTRAINT}}
- 이번 결정으로 풀지 않는 것: {{NON_GOAL}}

## 선택지

필요한 수만큼 아래 블록을 반복한다. 선택지를 채우기 위해 인위적인 대안을 만들지 않는다.

### {{OPTION_ID}}. {{OPTION_TITLE}}

- 설명: {{OPTION_DESCRIPTION}}
- 장점: {{OPTION_BENEFIT}}
- 비용·위험: {{OPTION_COST_AND_RISK}}
- 되돌리기 난이도: {{OPTION_REVERSIBILITY}}

## 결정

{{DECISION}}

- 결정 범위: {{IN_SCOPE}}
- 범위 밖: {{OUT_OF_SCOPE}}
- 그대로 유지되는 경계: {{UNCHANGED_BOUNDARY}}

## 이유

{{RATIONALE}}

## 수용한 비용과 위험

- {{ACCEPTED_COST_OR_RISK}}

## 구현 계약

- 구현 완료를 주장하는 데 필요한 증거: {{REQUIRED_IMPLEMENTATION_EVIDENCE}}
- 후속 STATE ID: {{FOLLOW_UP_STATE_IDS}}

이 파일은 구현 진행률이나 완료 사실을 누적하지 않는다. 현재 진행은 `STATE`, 완료 사실은 Git·release 기록이 소유한다.

## 재검토와 대체

- 결정을 다시 볼 조건: {{REOPEN_TRIGGER}}
- 이 결정을 대체한 기록: {{SUPERSEDING_DECISION_OR_NONE}}
