# {{PROJECT_NAME}} — Project Brief

> 가설 상태: `DRAFT | VALIDATING | VALIDATED | INVALIDATED | SUPERSEDED`
> 소유자: {{OWNER}}
> 최초 작성일: {{DATE}}
> 다음 검토일: {{REVIEW_DATE}}

이 문서는 **현재 유효한 프로젝트 가설**이다. 첫 출시·시장 검증·중단·방향 전환처럼 중요한
판단 시점 전까지는 새 근거에 맞춰 갱신한다. 판단 시점에는 변경 전 사본을
`snapshots/{{DATE}}-project-brief.md`로 고정하고, 가설이 바뀐 이유는
`docs/decisions/<date>-<decision-id>.md`에 남긴다.

## 1. 결과 가설과 해결 가설

- 결과 가설: {{TARGET_USER}}가 {{SITUATION}}에서 {{DESIRED_OUTCOME}}을 얻는다.
- 해결 가설: {{PRODUCT_TYPE_OR_APPROACH}}이 그 결과를 만드는 효과적인 방법이다.

## 2. 문제와 근거

- 사용자가 겪는 구체적 문제: {{PROBLEM}}
- 기존 대안과 부족한 점: {{ALTERNATIVES}}

| 구분 | 주장·관찰 | 출처 | 확인일 |
| --- | --- | --- | --- |
| 사실 | {{OBSERVED_EVIDENCE}} | {{EVIDENCE_SOURCE}} | {{EVIDENCE_DATE}} |
| 가정 | {{ASSUMPTION}} | `아직 근거 없음` | {{ASSUMPTION_REVIEW_DATE}} |
| 반대 증거·한계 | {{COUNTEREVIDENCE_OR_LIMIT}} | {{COUNTEREVIDENCE_SOURCE}} | {{COUNTEREVIDENCE_DATE}} |

## 3. 첫 사용자 결과

이 절은 사용자가 얻는 결과와 그 증거만 소유한다. 구현 범위·순서·검사는 `BUILD_SLICE`에 둔다.

사용자가 처음부터 끝까지 완료할 수 있어야 하는 가장 작은 결과:

> {{FIRST_END_TO_END_OUTCOME}}

완료 증거:

- [ ] {{USER_VISIBLE_EVIDENCE}}
- [ ] {{SYSTEM_EVIDENCE}}

## 4. 범위

### 지금 만든다

- {{IN_SCOPE_1}}
- {{IN_SCOPE_2}}

### 지금 만들지 않는다

- {{NON_GOAL_1}}
- {{NON_GOAL_2}}

## 5. 계속·중단 조건

- 계속할 증거: {{CONTINUATION_EVIDENCE}}
- 중단 또는 방향 전환 조건: {{KILL_CONDITION}}
- 판단 시점: {{DECISION_DATE_OR_EVENT}}

## 6. 조건부 문서 초기 트리거

판정은 `YES | NO | UNKNOWN` 중 하나다. `YES`면 manifest가 지정한 문서를 준비하고, `UNKNOWN`이면
해당 문서 또는 blocking STATE 결정에 연결한다. `per_event` 기록은 owner·대응 준비만 확인하고 실제 사건 때
생성한다. 이 표는 시작 시점 판단이며 모든 `BUILD_SLICE`에서 다시 평가한다.

| Trigger ID | 질문 | 판정 | 문서·STATE reference |
| --- | --- | --- | --- |
| `shared_contract` | 둘 이상의 producer·consumer가 API·이벤트·파일·설정·영속 데이터 형식을 공유하는가? | {{TRIGGER_SHARED_CONTRACT}} | {{SHARED_CONTRACT_REFERENCE}} |
| `environment_or_secret` | 환경별 설정·secret·credential 또는 호출 비용이 있는 외부 서비스가 있는가? | {{TRIGGER_ENVIRONMENT_OR_SECRET}} | {{ENVIRONMENT_REFERENCE}} |
| `sensitive_or_irreversible` | 민감 데이터·인증·외부 쓰기·결제·삭제·게시처럼 피해나 비가역성이 있는가? | {{TRIGGER_SENSITIVE_OR_IRREVERSIBLE}} | {{RISK_REFERENCE}} |
| `duplicated_fact` | 같은 사실을 둘 이상의 위치에서 갱신해야 하는가? | {{TRIGGER_DUPLICATED_FACT}} | {{COUPLING_REFERENCE}} |
| `user_reachable_deployment` | 사용자가 접근하는 환경에 배포하는가? | {{TRIGGER_USER_REACHABLE_DEPLOYMENT}} | {{RELEASE_REFERENCE}} |
| `incident_or_recovery_ownership` | 장애 대응·복구·사용자 커뮤니케이션 책임이 생기는가? | {{TRIGGER_INCIDENT_OR_RECOVERY}} | {{INCIDENT_REFERENCE}} |
| `design_transplant` | 고정된 디자인 소스를 실제 사용자 UI로 이식하는가? | {{TRIGGER_DESIGN_TRANSPLANT}} | {{DESIGN_HANDOFF_REFERENCE}} |
| `reusable_lesson` | 기존에 검증된 교훈을 가져오거나 재발 방지 가치가 있는 함정이 확인됐는가? | {{TRIGGER_REUSABLE_LESSON}} | {{LESSON_REFERENCE}} |

## 7. 관련 미해결 결정

현재 상태·owner·필요한 근거·결정 조건은 `STATE`가 소유한다. 여기에는 이 가설에 영향을 주는 ID만 연결한다.

| STATE 결정 ID | 이 가설에 미치는 영향 |
| --- | --- |
| {{STATE_DECISION_ID}} | {{BRIEF_IMPACT}} |
