---
name: docs-boundary
description: >-
  docs/ 는 사람이 읽는 기록이지 실행 입력이 아니라는 경계를 지킨다. docs/ 나 control plane(AGENTS.md·CLAUDE.md·.agents·.claude·.codex)을
  편집할 때, 코드·테스트·게이트가 docs/ 아래 파일을 읽게 만들려 할 때, docs 파일을 지우거나 옮길 때, 새 문서를 어디에 둘지 정할 때,
  프로젝트의 docs 경계 검사 결과(위반·stale·authority-debt)를 처리할 때 사용한다.
metadata:
  template: docs-boundary
  template_version: "1"
---

# docs 경계 — 문서는 기록이지 실행 입력이 아니다

이 파일은 이 프로젝트의 docs 경계 규칙이다. project-context 플러그인 템플릿(`metadata.template_version`)에서 복사했고, 프로젝트에 맞게 직접 고친다.
공통 규칙이 바뀌어 템플릿 버전이 오르면 SessionStart 가 알리고, `setup-project-context`의 템플릿 갱신으로 병합한다. 같은 폴더의 `.template-base.md`는 병합 기준이므로 고치지 않는다.
프로젝트 `intent/`·STATE·`AGENTS.md`가 이 파일과 어긋나면 임의로 고르지 말고 사용자에게 어긋난 곳을 알린다.

## 규칙

| 규칙 | 이유 |
| --- | --- |
| `docs/**` 는 사람이 읽는 산문이다. 코드·테스트·게이트·훅이 docs 파일을 읽어 판정하지 않는다 | 문서를 고치는 일이 동작을 바꾸면 문서를 자유롭게 고칠 수 없다 |
| 기계 입력은 **계약 폴더**, append-only 원장은 **원장 폴더**, 생성물은 **생성물 폴더**에 둔다 (이름은 프로젝트 로컬 절이 정한다) | 기계가 읽는 파일은 형식·소유·변경 절차가 따로 있어야 한다 |
| control plane 이 문서를 "정본"·"먼저 읽는다"·"따른다"로 부르지 않는다 | 그렇게 부르는 순간 산문이 실행 권위가 된다 |
| 운영 내용은 control plane 안에 직접 쓰고, 문서는 배경 링크로만 건다 | 에이전트가 실제로 따르는 곳과 내용이 있는 곳을 같게 둔다 |
| 상태처럼 바뀌는 사실은 지침 파일에 쓰지 않고 STATE·원장에 둔다 | 지침 파일이 금방 낡는다 |

control plane = `AGENTS.md`·`CLAUDE.md`·`.agents/`·`.claude/`·`.codex/` (프로젝트가 더 정했으면 그것까지).

설계된 결합은 위반이 아니다. 예: project-context 훅이 메모리 인덱스(`docs/memory/MEMORY.md`)를 가리키는 것,
state-ledger 훅이 `docs/state/` detail 의 touched·hash 를 스탬프하는 것. 이런 결합은 플러그인이 소유하고,
프로젝트 코드가 같은 파일을 읽어 판정하는 것은 여전히 막는다.

## 어디에 두나

| 내용 | 위치 |
| --- | --- |
| 사용자가 확인한 결정 | `intent/<영역>.md` (project-context 형식: `## C1 · 제목`, `- 규칙:`, `- 갱신:`) |
| 인계·QA·리뷰·설계 변경 계획 | `docs/plans/<작업 폴더>/` |
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
  예외는 두 채널이 같음을 강제하는 검사가 따로 등록된 경우뿐이다.

## 파일을 옮기거나 지울 때

- 경로 문자열 중 **pinned Git 좌표**(커밋 SHA 와 짝인 경로 — 과거 blob 을 읽는 증거)는 고치지 않는다.
  그 SHA 시점에는 옛 경로가 맞다. 고치면 그 읽기가 영구히 깨진다.
- 옛 경로가 남는 것은 검사기 정책의 dangling(또는 같은 역할) 목록에 옛 경로와 이유로 선언한다.
- 워킹트리 링크(배경 링크)는 새 경로로 고친다.
- docs 파일을 지우면 그 파일을 가리키던 검사기 정책 항목도 **같은 커밋에서** 정리한다.

## 검사 결과 처리 (프로젝트에 검사기가 있을 때)

| 결과 | 할 일 |
| --- | --- |
| 위반 (새 읽기·새 권위 문구) | 내용을 계약 폴더·control plane 으로 옮기거나 문구를 배경 링크로 바꾼다. 정책 예외 추가는 마지막 수단이고, 예외 추가와 그 위반을 같은 커밋에 담지 않는다 |
| stale (정책 항목이 가리킨 결합이 사라짐) | 부채가 갚아진 것이다. 정책에서 그 항목을 지운다. 위반이 아니다 |
| 권위 문구 분류 | `authority-denial`(문서를 권위로 부르지 않음)·`background-pointer`(배경 링크)·`authority-debt`(아직 산문에만 있는 운영 사실 — 언제 control plane 으로 옮길지 retire 조건 필수) 셋 중 하나. 미분류는 위반이다 |

CLEAN 은 "결합 없음"이 아니다.

- 읽기 검출은 보통 리터럴 경로 스캔이다. 설정·계약 필드를 거쳐 간접으로 읽는 경로는 못 본다 — 그런 경로는 정책에 수동으로 적는다.
- 권위 검출은 신호어 휴리스틱이다. 다른 표현으로 문서를 권위로 세우면 안 잡힌다. 편집할 때 직접 문구를 본다.
- 검사 범위(스캔 대상 폴더)를 먼저 확인한다. 범위 밖 결합은 검사 통과와 무관하다.

검사기가 없으면 위 규칙을 편집 때 직접 확인한다. 검사기를 새로 만드는 건 사용자가 요청할 때만 한다.

## 프로젝트 로컬 자리

프로젝트 `AGENTS.md` 에 `## docs 경계` 절을 둔다. 이 스킬은 거기 적힌 값을 쓴다.

| 항목 | 예 | 필수 |
| --- | --- | --- |
| 계약 폴더 (기계 입력) | `ops/contracts/` | 예 |
| 원장 폴더 (append-only) | `ops/registries/` | 쓰면 |
| 생성물 폴더 | `ops/generated/` | 쓰면 |
| 허용 docs 하위 폴더 | `plans`·`memory`·`state`·`research` | 예 |
| 런북 스킬 이름 | `<프로젝트>-ops` | 쓰면 |
| 검사 명령과 정책 파일 | `<패키지 매니저> run docs-boundary:check`, `<계약 폴더>/docs-boundary-policy.json` | 있으면 |
| 설계된 결합 목록 | 메모리 인덱스 주입, STATE 스탬프 훅 | 있으면 |

절이 없으면:

1. 저장소를 훑어 이미 쓰는 폴더(`ops/`·`contracts/`·`schemas/`·`config/` 등)와 docs 하위 폴더를 확인한다.
2. 기본값을 제안한다 — 계약 `ops/contracts/`, 원장 `ops/registries/`, 생성물 `ops/generated/`,
   docs 는 `plans`·`memory`·`state`·`research`, 검사기 없음.
3. 사용자에게 묻는다: 폴더 이름, 블로그 등 추가 docs 폴더 여부, 검사기를 둘지.
4. 확인받은 값만 `AGENTS.md` 절로 쓴다. 폴더 배치가 결정이면 `intent/` 에도 올릴지 함께 묻는다.
