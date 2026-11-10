---
name: state-ledger-rules
description: >-
  STATE 원장(STATE.md 인덱스·docs/state/<area>/<id>.md detail)을 쓰는 프로젝트에서 항목을 추가·갱신·archive 하거나,
  작업을 claim(owner·branch)하고 §2→§1로 옮기거나, 구현 뒤 사용자 확인 대기(awaiting_user)로 두거나,
  WIP cap·detail 크기·유령 브랜치·hash 불일치·커밋 귀속([id=]) 경고를 처리하거나, 사용자 확인 뒤 정리(cleanup)를 하거나,
  브랜치를 폐기하거나 archive 태그로 보존할 때 사용한다. 설치·이관은 setup-state 스킬이 맡는다.
metadata:
  template: state-ledger-rules
  template_version: "5"
---

# STATE — 진행 중인 일의 공유 상태판

STATE 는 공유 상태판이다. 지금 누가 무엇을 하고, 무엇이 남았고, 무엇이 결정 대기인지와 그 WHY 만 담는다.
작업 기록(완료 사실·경과)은 커밋 메시지가 맡고 git log 가 정본이다. 상태가 바뀌면 그 줄과 detail 을 바꿔 쓰고 덧붙이지 않는다.

- 이 파일은 이 프로젝트의 STATE 규칙이다. state-ledger 플러그인 템플릿(`metadata.template_version`)에서 복사했고, 프로젝트에 맞게 직접 고친다.
- 공통 규칙이 바뀌어 플러그인 템플릿 버전이 오르면 SessionStart가 알린다. `setup-state`의 템플릿 갱신으로 이 파일에 병합한다. 같은 폴더의 `.template-base.md`는 병합 기준이므로 고치지 않는다.
- 정본 스키마는 플러그인 `README.md`다. `intent/`(project-context)·`.staterc`·`AGENTS.md`(또는 `CLAUDE.md`)가 이 파일과 어긋나면 임의로 고르지 말고 사용자에게 알린다.
- 저장소에 `STATE.md`·`.staterc`가 없으면 이 스킬을 쓰지 않는다. 설치·이관·runner 배치는 `setup-state` 스킬을 따른다.

## 프로젝트 로컬 자리

| 자리 | 담는 것 | 비어 있으면 |
| --- | --- | --- |
| `.staterc` | `STATE_INDEXES`(인덱스 경로), `STATE_DEFAULT_BRANCH`, `STATE_BRANCH_EXCLUDE`, `STATE_CLEANUP_ENFORCE`, `STATE_VERIFY`(독립 검증, 기본 꺼짐) | 기본값(`STATE.md` 하나, `main`, 정리 강제 off) |
| 이 파일 | STATE 작성 규칙 전체와 이 프로젝트만의 차이 | 템플릿 그대로 쓴다 |
| `AGENTS.md`/`CLAUDE.md` | 이 스킬 위치를 알려 주는 라우팅 한 줄(규칙 본문은 두지 않는다) | `setup-state`로 붙인다 |
| `intent/` | 정리 승인 범위·보존 규칙 등 프로젝트 결정 | 사용자 확인 없이는 정리하지 않는다 |
| 프로젝트 ops 스킬·문서 | worktree 밖 자원(로컬 DB·컨테이너·프로필) 정리 절차 | 그 자원은 건드리지 않고 사용자에게 묻는다 |

## 어디에 쓰나

- 인덱스 경로는 `.staterc`의 `STATE_INDEXES`(공백 구분, 기본 `STATE.md`)가 정한다. 작업 범위에 맞는 인덱스를 고른다.
- area 는 인덱스 경로에서 나온다: 루트 `STATE.md` → `root`, 그 외 → 부모 디렉터리 이름(`svc/api/STATE.md` → `api`).
- `.staterc`에 `STATE_INDEX_SOURCE="frontmatter"`가 있으면 인덱스 줄을 손으로 쓰지 않는다. 항목은 detail frontmatter 의
  `section`(`active|next|future|unresolved`)·`title`·`status` 세 줄이 정본이고, 인덱스 파일은 git 에 올리지 않는 생성물이다.
  등록 = detail 생성, 상태 변경 = 그 detail 수정, archive = detail 삭제. 아래 "인덱스 줄"은 이 세 필드로 읽는다.
  정리 요청은 `docs/state/.cleanup/<request-id>.json`에 남는다.
- 인덱스 = 항목당 1줄(≤200자): `- [<id>] <제목> — <짧은 상태·조건>`. id 없는 줄은 §3 placeholder 만. 인덱스 파일 ≤4KB.
- 상세 = `docs/state/<area>/<id>.md`. 전체 ≤8KB, `## 현재` ≤4KB.
  - frontmatter: `id·area·owner·branch·touched·hash` (+`session_id`·`lifecycle`·`depends`·`blocks`·`handoff`·`expires`, 긴 다단계 작업은 +`goal`·`step`·`next_step` 한 줄씩 ≤200자)
  - 본문: `## 현재`(필수 — 요약·남은 것·WHY) + `## 원장`(선택 — 결정 WHY 만)
- `id` 는 3–12자, `[a-z0-9-]`, 바뀌지 않는 식별자다.

| §   | 카테고리         | cap | 의미                                   |
| --- | ---------------- | --- | -------------------------------------- |
| 1   | 활성             | ≤6  | 지금 손이 닿은 작업 (owner 필수)       |
| 2   | 다음             | ≤6  | 활성이 끝나면 시작 — 예약              |
| 3   | 미래 placeholder | ≤5  | 조건부 트리거 대기                     |
| 4   | 미해결 결정      | ≤8  | 결정 대기 — 안 한 일 + 결정 조건       |

## 편집 규칙

- detail 은 Edit/Write(Codex 는 apply_patch)로만 고친다. PostToolUse 훅이 본문 hash 가 바뀔 때 `touched`·`hash`를 찍는다.
  셸(sed·python·heredoc)이나 외부 편집기로 고치면 hash 불일치 경고가 남는다.
- 훅은 세션 자기 checkout(git worktree 세션이면 그 worktree) 안 `docs/state/<area>/<id>.md`만 찍는다. 다른 checkout·폴더의 detail 을 고치면 찍히지 않는다.
  그때는 대상 저장소 루트에서 재스탬프한다(본문 hash 가 기록과 다를 때만 갱신):
  `printf '{"tool_input":{"file_path":"docs/state/<area>/<id>.md"}}' | HOOK_PROJECT_DIR="$(git rev-parse --show-toplevel)" node scripts/hooks/state-ledger-runner.mjs stamp`
- `owner`·`branch` 는 훅이 바꾸지 않는다. 손으로 claim 한다. 스치는 편집이 소유를 바꾸지 않게 하기 위해서다.
- 착수하면 인덱스 줄을 §2(또는 §3·§4)에서 §1로 옮기고 detail 의 `owner`·`branch`를 claim 한다. 손을 떼면 owner 를 풀거나 넘긴다.
- `## 현재`는 바꿔 쓴다. 단계별 경과·완료 로그를 덧붙이지 않는다(Stop 훅이 이번 턴 본문 1KB 초과 증가를 알린다).
- 구현·검증을 마치면 `session_id`에 현재 대화 ID 를, `lifecycle: awaiting_user`를 남기고 정상 커밋한다. 완료만을 이유로 지우지 않는다.
  대화 ID 는 호스트가 알려준 값을 쓴다. 모르면 추측하지 말고 사용자에게 묻는다.

## 긴 작업의 목표·절차 유지

- 단계가 여럿인 긴 작업은 claim 할 때 `goal`(목표와 완성 기준)·`step`(지금 단계)·`next_step`(다음 단계와 끝 조건)·`handoff`(계획 문서 `path` 또는 `path#절`)를 채운다. 단계가 바뀌면 `step`·`next_step`(과 `status`)을 바꿔 쓴다. 각 필드는 한 줄 ≤200자이고 상세는 `## 현재`·handoff 에 둔다.
- 현재 브랜치가 `branch:` 로 소유한 §1·§2 항목은 매 턴 훅이 목표·단계·절차를 다시 실어 준다(기본 브랜치·detached HEAD 에서는 없음). 그 알림을 따른다: 작업을 제안·시작·전환하기 전에 각 항목의 handoff(없으면 detail `## 현재`)에서 지금·다음 단계 절과 끝 조건을 다시 읽고, 제안에 그 절 제목이나 줄을 인용한다. 계획 순서를 벗어나거나 범위를 바꾸려면 먼저 사용자에게 묻는다 — 단, 이번 턴 사용자의 명시 지시가 우선한다(계획과 어긋나면 그 사실만 한 줄 알리고 따른다).
- `.staterc` 에 `STATE_VERIFY="1"` 이 있으면 별도 검사 세션이 단계 변경·compaction 직후·주기적으로 목표와 계획 순서를 확인한다. 그 판정(`=== STATE 독립 검증 결과 ===` 블록이나 Stop 차단 사유)은 제안이 아니라 확인 요청이다. 맞으면 바로잡고(해당 단계 절과 끝 조건을 다시 읽는다), 틀렸다고 보면 근거(파일·커밋·계획 줄)를 들어 사용자에게 알린다. 판정을 피하려고 `step`·`next_step` 을 갱신하지 않거나 끝 조건을 채우지 않은 채 단계를 넘기지 않는다.

## 커밋 [id=] 규칙

- 작업 커밋 메시지에 `[id=<인덱스 id>]`를 단다. STATE 항목과 정말 무관한 잡무만 `[id=-]`. archive 커밋은 `archive [id=<id>]`.
- id 를 빠뜨렸으면 직접 만든 미push 직전 커밋은 `git commit --amend`로 붙이고, 아니면 다음 커밋부터 붙인다. STATE 에 경과를 적어 대신하지 않는다.
- 새 항목은 등재한 뒤(작업 트리여도 됨) 그 id 로 커밋한다. 인덱스에 없는 id 는 '알 수 없는 id'로 알린다.

## 병행 작업

- 다른 세션·에이전트와 동시에 일하면 branch·worktree 를 나눈다. 같은 파일을 같은 worktree 에서 동시에 편집하지 않는다.
- 같은 worktree 에 다른 활성 세션이 보이면 훅이 태그·덧붙임 판정을 보류한다. 그 커밋이 누구 것인지 확정할 수 없기 때문이다.

## 경고별 대응

경고는 warn 이다(커밋을 막지 않는다). 대신 0 으로 수렴시킨다. 방치하면 배경소음이 되어 채널이 죽는다.

| 경고 | 뜻 | 할 일 |
| --- | --- | --- |
| §N cap 초과 | 분류 실패 신호 | 오래 안 움직인 항목을 정리 후보로 사용자에게 제안한다. 나이·cap 만으로 archive 하지 않는다 |
| 줄 200자·인덱스 4KB 초과 | 인덱스에 상세가 섞임 | 줄은 제목·짧은 상태만. 남은 일·WHY 는 detail 로 |
| detail 8KB·`## 현재` 4KB 초과 | 경과가 쌓임 | 완료 경과는 git log 에 있으므로 지우고 남은 일·결정·WHY 만 남게 바꿔 쓴다 |
| 본문 덧붙임(이번 턴 +1KB 초과) | 기록을 누적함 | 덧붙인 경과를 걷어 내고 `## 현재`를 바꿔 쓴다 |
| hash 불일치 | 훅을 우회한 편집 | 내용을 확인한 뒤 Edit 으로 재저장하거나 runner `stamp`로 재스탬프 |
| 인덱스↔detail 단절·고아 | 라우팅 끊김 | detail 을 만들거나 인덱스에 등재한다. 지울 것이면 아래 정리 절차 |
| §1 owner 없음·필수 필드 없음 | claim 누락 | owner·branch 를 채운다 |
| frontmatter goal·step·next_step 빈 값·200자 초과 | 선택 필드가 비었거나 길다 | 지우거나 한 줄 요약으로 고치고 상세는 `## 현재`·handoff 로 옮긴다 |
| `expires` 경과 | 재확인 시점 | 사용자 확인 뒤 갱신하거나 정리한다 |
| branch 소멸·이미 머지됨 | 포인터가 낡음 | 포인터를 고치거나 정리 후보로 제안한다 |
| 유령 브랜치(미등재, 미머지 커밋) | 소유 불명 | 등재 또는 폐기 결정을 사용자에게 받는다. 아래 브랜치 절차 |
| 태그 없는 커밋·알 수 없는 id | 귀속 누락 | amend(미push 직전 커밋) 또는 다음 커밋부터 붙인다 |
| 동시 세션 보류 | 귀속 판정 불가 | worktree 를 나눈다 |

## 사용자 확인 뒤 정리

정리(archive) = 인덱스 줄 + detail 파일 삭제, 현재 참조 정리, `archive [id=<id>]` 커밋. 사용자 확인·정리 지시가 있을 때만 한다.
프로젝트 intent 가 정리 규칙(승인 범위·보존 대상)을 정했으면 그것을 따른다.

`STATE_CLEANUP_ENFORCE="0"`(기본)이면 위 정의대로 수동 정리한다. `"1"`이면 runner 로 정리 계약을 따른다:
`node scripts/hooks/state-ledger-runner.mjs cleanup <명령> [옵션]`

| 단계 | 명령 | 요점 |
| --- | --- | --- |
| 1 확인 대기 | `await-user --session <대화ID> --target <area/id>` | `lifecycle: awaiting_user`로 두고 정상 커밋. 지우지 않는다 |
| 2 요청 | `request --session <대화ID> --instruction-ref <사용자메시지참조> --instruction '<원문>'` | 기본 대상 = 이 대화의 커밋된 awaiting_user 작업. 범위를 명시적으로 넓힌 지시만 `--scope explicit --target <area/id>`(반복) |
| 3 삭제 | (직접) | 요청은 첫 인덱스의 `STATE_CLEANUP_V1` 주석에 남는다. 대상 줄·detail 삭제, 현재 참조 정리, `archive [id=<id>]` 커밋 |
| 4 검사 | `check --session <대화ID> --request <요청ID>` | working tree·index·HEAD 삭제, archive 커밋, 참조 정리를 확인 |
| 5 마무리 | `finish --session <대화ID> --request <요청ID>` | 요청 제거 후 마무리 커밋. 그 뒤에 완료라고 보고한다 |
| 막힘 | `block --session <대화ID> --request <요청ID> --reason '<사유>'` | 요청을 보존하고 미완료로 보고 |
| 인계 | `resume --session <새대화ID> --request <요청ID> --instruction-ref <새재개메시지참조>` | 대상·원문·자동 보완 예산은 그대로 |

- 사용자 원문과 참조를 정확히 기록한다. 도구는 지시의 진위를 판별하지 못한다. 합성 Stop continuation 은 새 승인이 아니다.
- 과거 근거는 존재를 확인한 전체 SHA 의 `SHA:docs/state/...` 좌표로 바꿔 현재 참조와 구분한다.
- 자동 보완은 요청당 1회다. 재시작·압축 뒤에는 SessionStart 가 다시 보여 주는 같은 요청을 이어 처리한다. 새 요청을 만들지 않는다.
- 정리 성공은 실제 Git·파일·참조 증거로 판정한다. 요청 뒤 바뀐 detail 은 삭제가 거부된다 — 사용자에게 다시 확인한다.

## 브랜치 폐기·보존

정리 지시를 받은 대상에만 한다. 브랜치 경고는 로컬 ref 만 본다. 다른 머신의 브랜치가 이 clone 에 없거나 로컬 main 이 낡은 것은 작업 종료의 증거가 아니다.

1. origin 을 fetch 해 최신 `origin/<기본 브랜치>` 기준으로 본다. `git rev-list --count origin/<기본>..<branch>`가 0 이면 통합 후보다. 그래도 정리 지시를 대신하지 않는다.
2. squash·rebase 로 들어간 브랜치는 실제 PR 결과와 기본 브랜치의 변경을 대조한다. `git cherry` 하나로 판단하지 않는다. 불명확하면 살린다.
3. 미머지분이 남으면 `git tag archive/<브랜치> <브랜치>`(대상을 빼면 HEAD 가 태그된다) → `git rev-parse`로 두 SHA 가 같은지 확인 → 삭제.
4. worktree 가 붙은 브랜치(`git branch --list`의 `+`)는 활성 작업으로 보존한다. 명시된 정리 대상이면 미커밋·미push 변경, PR 통합, 다른 세션 사용을 확인한 뒤 worktree 와 브랜치를 함께 정리한다.
5. 검사에서 빼야 할 자동 브랜치 패턴은 `.staterc`의 `STATE_BRANCH_EXCLUDE`에 둔다.

primary checkout·다른 머신의 clone 은 worktree 정리 범위가 아니다. worktree 밖 자원(로컬 DB·컨테이너 등)은 프로젝트 ops 절차를 따른다.

## 훅·runner 소유

STATE 훅·검사 구현은 전역 플러그인 `state-ledger@hibye-plugins`가 소유한다. 저장소에는 `STATE.md`·`docs/state/**`·`.staterc`·얇은 runner(`scripts/hooks/state-ledger-runner.mjs`)·이 규칙 스킬 사본만 둔다.
runner action: `session-start`·`turn-start`·`stamp`·`stop`·`commit-msg`·`check-wip`·`check-branch`·`cleanup`·`validate`. 동작이 README 와 달라 보이면 설치 캐시 버전부터 확인한다.
