---
id: {{ID}}
owner: {{OWNER}}
workspace: {{BRANCH_OR_WORKTREE}}
touched: {{LAST_MEANINGFUL_UPDATE}}
depends:
  - {{DEPENDENCY_ID_OR_NONE}}
blocks:
  - {{BLOCKED_ITEM_ID_OR_NONE}}
handoff_to: {{HANDOFF_OWNER_OR_NONE}}
expires: {{EXPIRY_DATE_OR_NONE}}
external_issue: {{EXTERNAL_ISSUE_OR_NONE}}
---

# {{WORK_ITEM_TITLE}}

## 현재

- 요약: {{CURRENT_SUMMARY}}
- 남은 것: {{REMAINING_WORK}}
- 다음 증거: {{NEXT_EVIDENCE}}
- WHY: {{WHY_THIS_WORK_EXISTS}}

## Handoff

다른 작업자가 바로 이어받을 때 필요한 최소 정보만 유지한다.

- 기준 revision: {{VERIFIED_REVISION_OR_NONE}}
- 현재 dirty 파일: {{DIRTY_PATHS_OR_NONE}}
- 마지막으로 통과한 검사: {{LAST_VERIFIED_CHECK_OR_NONE}}
- 다음 정확한 행동: {{NEXT_ACTION}}
- blocker와 필요한 결정: {{BLOCKER_OR_DECISION}}

## 원장

선택 사항이다. 완료 서사가 아니라 이후 판단에 필요한 WHY·실측·결정 변화만 시간순으로 남긴다.

- {{DATE}} — {{MEASUREMENT_OR_DECISION_CHANGE}}
