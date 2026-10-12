# STATE — {{PROJECT_NAME}}

> 이 파일은 현재 소유권·진행·조건부 미래·미해결 결정만 기록하는 live coordination index다.
> 완료 사실은 Git·릴리스 기록, 재발 방지 교훈은 `docs/lessons/`가 소유한다. 전체 제품 백로그를 여기에 복사하지 않는다.
> WIP 한도: active≤{{ACTIVE_WIP_CAP}}, next≤{{NEXT_WIP_CAP}}, unresolved≤{{UNRESOLVED_WIP_CAP}}

## 항목 규칙

- 모든 실제 작업과 결정은 짧고 안정적인 ID를 가진다.
- 한 작업에는 한 명의 accountable owner만 둔다.
- 항목은 한 줄로 현재 상태와 다음 증거를 전달할 수 있어야 한다.
- WHY·의존성·handoff가 길어지면 `docs/state/<id>.md`를 만들고 `STATE_DETAIL` 형식을 사용한다.
- detail이 있으면 owner·workspace·lifecycle metadata는 detail이 정본이고, 이 파일은 routing index다.
- 외부 issue tracker가 있으면 백로그와 수용 이력은 그곳이 소유하고 여기에는 현재 항목과 issue ID만 연결한다.

## 1. 활성

지금 실제로 손이 닿아 있는 작업이다. owner와 다음에 확인할 증거가 반드시 있어야 한다.

| ID | 작업 | Owner | Workspace | 현재 상태 | 다음 증거 |
| --- | --- | --- | --- | --- | --- |
| {{ID}} | {{WORK_ITEM}} | {{OWNER}} | {{WORKSPACE}} | {{CURRENT_STATE}} | {{NEXT_EVIDENCE}} |

## 2. 다음

활성 작업이 끝나면 시작할 예약이다. 단순 아이디어나 언젠가 할 백로그를 넣지 않는다.

| ID | 작업 | 시작 조건 | 막는 항목 | 외부 Issue |
| --- | --- | --- | --- | --- |
| {{ID}} | {{NEXT_ITEM}} | {{START_CONDITION}} | {{BLOCKER_OR_NONE}} | {{EXTERNAL_ISSUE_OR_NONE}} |

## 3. 조건부 미래

날짜가 아니라 실제 사건이나 증거가 생겨야 활성화되는 후보만 둔다.

| ID | 후보 | 활성화 조건 | 지금 만들지 않는 이유 |
| --- | --- | --- | --- |
| {{ID_OR_NONE}} | {{FUTURE_ITEM}} | {{TRIGGER}} | {{WHY_NOT_NOW}} |

## 4. 미해결 결정

아직 하지 않은 일과 결정 조건을 기록한다. 구현자가 편의를 위해 임의로 닫지 않는다.

| ID | 결정할 것 | 결정권자 | 필요한 근거 | 결정 조건 |
| --- | --- | --- | --- | --- |
| {{ID}} | {{OPEN_DECISION}} | {{DECISION_OWNER}} | {{EVIDENCE}} | {{DECISION_TRIGGER}} |

## Lifecycle

- 시작: 기존 축을 먼저 찾고, owner·workspace·다음 증거를 기록한 뒤 작업한다.
- 갱신: 의미 있는 진행·새 blocker·결정 변경이 있을 때만 상태를 바꾼다.
- 만료: detail의 `expires`가 지나면 갱신하거나 archive한다.
- 완료: 인덱스 항목과 detail을 제거한다. 완료 사실은 commit·release·외부 issue에 남긴다.
- 병렬 작업: 같은 파일을 편집하는 세션은 branch·worktree를 분리한다. 변경 귀속이 불명확하면 추측하지 않는다.
- 정리: 오래된 branch·workspace는 미병합 작업의 보존 여부를 확인하기 전 자동 삭제하지 않는다.
