---
name: docs-boundary
description: >-
  docs/ 는 사람이 읽는 기록이지 실행 입력이 아니라는 경계를 지킨다. docs/ 나 control plane(AGENTS.md·CLAUDE.md·.agents·.claude·.codex)을
  편집할 때, 코드·테스트·게이트가 docs/ 아래 파일을 읽게 만들려 할 때, docs 파일을 지우거나 옮길 때, 새 문서를 어디에 둘지 정할 때 사용한다.
metadata:
  template: docs-boundary
  template_version: "3"
---

# docs 경계 — 문서는 기록이지 실행 입력이 아니다

이 파일은 이 프로젝트의 docs 경계 규칙이다. project-context 플러그인 템플릿(`metadata.template_version`)에서 복사했고, 프로젝트에 맞게 직접 고친다.
공통 규칙이 바뀌어 템플릿 버전이 오르면 SessionStart 가 알리고, `setup-project-context`의 템플릿 갱신으로 병합한다. 같은 폴더의 `.template-base.md`는 병합 기준이므로 고치지 않는다.
프로젝트 `intent/`·STATE·`AGENTS.md`가 이 파일과 어긋나면 임의로 고르지 말고 사용자에게 어긋난 곳을 알린다.

## 규칙

| 규칙 | 이유 |
| --- | --- |
| `docs/**` 는 사람이 읽는 산문이다. 코드·테스트·게이트·훅이 docs 파일을 읽어 판정하지 않는다 | 문서를 고치는 일이 동작을 바꾸면 문서를 자유롭게 고칠 수 없다 |
| 기계 입력은 **계약 폴더**, append-only 원장은 **원장 폴더**, 생성물은 **생성물 폴더**에 둔다 (이름은 아래 `## 이 프로젝트의 값`이 정한다) | 기계가 읽는 파일은 형식·소유·변경 절차가 따로 있어야 한다 |
| `AGENTS.md`(`CLAUDE.md`)는 무엇이 어디 있는지 알려 주는 라우팅만 담고 작게 둔다. 규칙·절차·값을 거기 직접 쓰지 않는다 | 매 세션 읽히는 파일이 커지면 비용이 들고, 같은 내용이 두 곳에 있으면 한쪽이 낡는다 |
| 앞으로 지킬 규칙은 `intent/`, 구현할 내용은 구현계획서(`docs/plans/`), 반복 절차는 로컬 스킬, 진행 상태는 STATE 에 둔다. 구현은 구현계획서를 따른다 | 종류마다 한 곳에만 두어야 에이전트가 낡은 사본을 따르지 않는다 |
| 상태처럼 바뀌는 사실은 지침 파일에 쓰지 않고 STATE·원장에 둔다 | 지침 파일이 금방 낡는다 |

control plane = `AGENTS.md`·`CLAUDE.md`·`.agents/`·`.claude/`·`.codex/` (프로젝트가 더 정했으면 그것까지).

설계된 결합은 위반이 아니다. 예: project-context 훅이 메모리 인덱스(`docs/memory/MEMORY.md`)를 가리키는 것,
state-ledger 훅이 `docs/state/` detail 의 touched·hash 를 스탬프하는 것. 이런 결합은 플러그인이 소유하고,
프로젝트 코드가 같은 파일을 읽어 판정하는 것은 여전히 막는다.

## 어디에 두나

| 내용 | 위치 |
| --- | --- |
| 사용자가 확인한 결정 | `intent/<영역>.md` (project-context 형식: `## C1 · 제목`, `- 규칙:`, `- 갱신:`) |
| 인계·QA·리뷰·설계 변경 계획, 그 작업의 실측·출처 요약 같은 산출 기록 | `docs/plans/<작업 폴더>/` (산출 기록은 그 아래 하위 폴더) |
| 세션 간 공유 메모리 | `docs/memory/` (인덱스 + detail, `.project-context.json` 이 경로를 정한다) |
| STATE detail | `docs/state/<area>/<id>.md` (state-ledger) |
| 조사·비교 자료 | `docs/research/` |
| 기술 블로그 원고 (쓰는 프로젝트만) | `docs/blog/` |
| 운영 절차(런북) | 프로젝트 로컬 스킬 (`<프로젝트>-ops` 등) |
| 코드·게이트가 읽는 계약, 그 산문 설명 | 계약 폴더 (생성 문서는 생성물 폴더) |

- 위 목록에 없는 최상위 docs 폴더(`docs/decisions`·`docs/operations`·`docs/reviews` 등)를 새로 만들지 않는다.
  결정은 intent, 절차는 스킬, 계획은 plans 로 간다. 맞는 자리가 없으면 사용자에게 묻는다.
- 결정을 intent 에 올리는 건 사용자 확인 뒤다. 에이전트 추측을 intent 에 쓰지 않는다.

## 지난 시점의 내용 읽기

- 과거 내용이 필요하면 **pinned Git object**(커밋 SHA 고정, `git show <sha>:<path>`)로 읽는다.
- 같은 파일을 워킹트리와 pinned 두 채널로 섞어 읽지 않는다. 두 값이 언제 갈라졌는지 아무도 모른다.

## 파일을 옮기거나 지울 때

- 경로 문자열 중 **pinned Git 좌표**(커밋 SHA 와 짝인 경로 — 과거 blob 을 읽는 증거)는 고치지 않는다.
  그 SHA 시점에는 옛 경로가 맞다. 고치면 그 읽기가 영구히 깨진다.
- 워킹트리 링크(배경 링크)는 새 경로로 고친다.

## 프로젝트 로컬 자리

프로젝트마다 다른 값은 이 파일 끝의 `## 이 프로젝트의 값`에 둔다(`AGENTS.md`에는 이 스킬 위치만 적는다).

| 항목 | 예 | 필수 |
| --- | --- | --- |
| 계약 폴더 (기계 입력) | `ops/contracts/` | 예 |
| 원장 폴더 (append-only) | `ops/registries/` | 쓰면 |
| 생성물 폴더 | `ops/generated/` | 쓰면 |
| 허용 docs 하위 폴더 | `plans`·`memory`·`state`·`research` | 예 |
| 런북 스킬 이름 | `<프로젝트>-ops` | 쓰면 |
| 설계된 결합 목록 | 메모리 인덱스 주입, STATE 스탬프 훅 | 있으면 |

값이 비어 있으면:

1. 저장소를 훑어 이미 쓰는 폴더(`ops/`·`contracts/`·`schemas/`·`config/` 등)와 docs 하위 폴더를 확인한다.
2. 기본값을 제안한다 — 계약 `ops/contracts/`, 원장 `ops/registries/`, 생성물 `ops/generated/`,
   docs 는 `plans`·`memory`·`state`·`research`.
3. 사용자에게 묻는다: 폴더 이름, 블로그 등 추가 docs 폴더 여부.
4. 확인받은 값만 아래 절에 쓴다. 폴더 배치가 결정이면 `intent/` 에도 올릴지 함께 묻는다.

## 이 프로젝트의 값

| 항목 | 값 |
| --- | --- |
| 계약 폴더 (기계 입력) | (미정) |
| 원장 폴더 (append-only) | (미정) |
| 생성물 폴더 | (미정) |
| 허용 docs 하위 폴더 | (미정) |
| 런북 스킬 이름 | (미정) |
| 설계된 결합 목록 | (미정) |
