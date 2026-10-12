# Project Launch Kit

언어·프레임워크·배포 사업자와 무관하게 새 프로젝트의 판단과 실행을 빠르게 시작하기 위한 복사용 템플릿 묶음이다.
이 키트는 코드 스타터가 아니라 **무엇을 만들지, 무엇을 결정했는지, 어디까지 검증했는지**를 한곳에 고정한다.

## 설치·생성 규칙

`template-manifest.yaml`의 `target`·`target_pattern`이 설치 경로의 정본이다. 파일명에서 `.template`만
기계적으로 제거하지 않는다.

- `singleton`: 선언된 `target`에 한 번 만든다.
- `per_item`: 실제 작업·결정·계약이 생길 때마다 `target_pattern`에 만든다.
- `per_event`: 준비 책임과 생성 시점을 분리한다. owner·대응 가능성은 미리 확인하되, 기록 파일은 실제 사건이 발생했을 때 만든다.

`target_pattern`에 들어가는 ID와 lane 이름은 표시용 제목이 아니라 경로에 안전한 stable identifier를
사용한다. 날짜는 `YYYY-MM-DD`, ID는 공백 없는 lowercase kebab-case를 기본으로 한다.

처음 10분에는 `PROJECT_BRIEF.md`, `AGENTS.md`, `STATE.md`와 첫 `BUILD_SLICE`만 작성한다. 이후에는
다음 순서로 필요한 문서만 활성화한다.

10분 checkpoint에서는 Brief의 사용자 결과·범위·중단 조건, AGENTS의 승인 경계, STATE의 첫 활성
항목·미해결 결정, slice의 사용자 리트머스·산출 위치만 확정하면 된다. 나머지는 `DRAFT`에서 채우되,
구현을 시작하는 `READY` 전에는 이번 slice의 필수 결정을 실제로 해결한다. `UNDECIDED`는 미결정 표시이지
해결이 아니다. 구현과 무관한 결정은 owner·다음 확인 조건·STATE 참조와 함께 남길 수 있으며,
`NOT_APPLICABLE`은 실제로 적용되지 않는 이유가 있을 때만 쓴다. 아직 실행하지 않은 결과는 `NOT_RUN`으로 둔다.

1. 첫 실제 진입점이 생기면 `SYSTEM_MAP.md`를 만든다.
2. 첫 변경을 수용·공유하기 전에 `ops/gate-registry.yaml`을 만든다.
3. 중요한 결정이 생기면 `DECISION_RECORD`, STATE 한 줄이 길어지면 `STATE_DETAIL`을 생성한다.
4. 모든 `BUILD_SLICE` 시작 시 조건부 트리거 8개를 다시 평가하고 `YES`·`UNKNOWN`인 문서를 연결한다.
5. `PROJECT_BRIEF.md`는 현재 가설로 갱신하되, 중요한 판단 시점에는 변경 전 사본을 `snapshots/`에 고정한다.
6. 결정되지 않은 값은 추측하지 말고 `UNDECIDED`로 남긴다.

## 10분 시작 질문

처음에는 다음 다섯 질문만 답한다.

1. 누구의 어떤 상황을 바꾸려는가?
2. 사용자가 끝까지 완료할 수 있는 가장 작은 결과는 무엇인가?
3. 이번에 만들지 않을 것은 무엇인가?
4. 어떤 실패는 절대 허용할 수 없는가?
5. 어떤 증거가 없으면 중단하거나 방향을 바꿀 것인가?

## 기본형

| 파일 | 생성 시점 | 답하는 질문 |
| --- | --- | --- |
| `PROJECT_BRIEF` | 시작 시 | 누구의 어떤 문제를 어떤 증거로 풀 것인가? |
| `AGENTS` | 시작 시 | 에이전트와 개발자가 실제로 따라야 할 경계와 승인선은 무엇인가? |
| `STATE` | 시작 시 | 지금·다음·조건부 미래·미해결 결정과 현재 owner는 무엇인가? |
| `BUILD_SLICE` | 사용자 결과마다 | 다음에 끝까지 연결해 검증할 가장 작은 사용자 결과는 무엇인가? |
| `SYSTEM_MAP` | 첫 실제 진입점이 생길 때 | 모듈·데이터·외부 시스템의 경계와 정본은 어디인가? |
| `GATE_REGISTRY` | 첫 변경 수용 전 | 어떤 변경이 언제 어떤 검사를 통과해야 하는가? |
| `STATE_DETAIL` | STATE 한 줄로 부족할 때 | 병렬 작업·의존성·handoff에 필요한 긴 맥락은 무엇인가? |
| `DECISION_RECORD` | 중요한 결정마다 | 중요한 선택을 왜 했고 언제 다시 볼 것인가? |

## 조건부 확장

| Trigger ID | 조건 | 추가할 템플릿 |
| --- | --- | --- |
| `shared_contract` | API·이벤트·파일·설정·영속 데이터 형식을 둘 이상이 공유함 | `CONTRACT` |
| `environment_or_secret` | 환경별 설정·secret·credential이 생김 | `ENVIRONMENT_MATRIX` |
| `sensitive_or_irreversible` | 민감 데이터·인증·외부 쓰기·비가역 작업이 생김 | `RISK_REVIEW` |
| `duplicated_fact` | 같은 사실을 여러 곳에서 갱신해야 함 | `COUPLING_MAP` |
| `user_reachable_deployment` | 사용자가 접근하는 환경에 배포함 | `RELEASE_RUNBOOK` |
| `incident_or_recovery_ownership` | 장애 대응이나 복구 책임이 생김 | `INCIDENT_RUNBOOK` |
| `design_transplant` | 디자인 소스를 실제 UI로 이식함 | `DESIGN_HANDOFF` |
| `reusable_lesson` | 재발 방지 가치가 있는 함정을 발견함 | `LESSON` |

첫 `LESSON`을 만들 때 `docs/lessons/README.md`도 만들고, 이후에는 한 줄 링크만 추가한다. 교훈 본문과
현재 구현 사실을 인덱스에 복사하지 않는다.

`RELEASE_RUNBOOK`은 lane별 공통 절차와 실행별 기록을 분리한다. 전체 템플릿은 `target_pattern`에
복사하고, 실제 실행을 준비할 때만 `record_source_heading`부터 끝까지를 `record_target_pattern`에
복사한다. 이 필드들은 수동 복사 규약이며 생성기는 포함하지 않는다. 공통 파일에는 명령·oracle·복구 정책을
준비하되, 양식의 실행별 값·결과는 비워둔다.
각 기록은 사용한 공통 절차의 불변 revision·digest를 참조하며, operation·attempt별로 새 경로를 쓴다.
공통 절차를 갱신해도 과거 실행의 입력·결과를 덮어쓰지 않는다.

## Placeholder 규칙

- `{{NAME}}`: 해당 항목을 사용하는 시점에 실제 값으로 바꾼다. `READY` 필수 입력과 실행 뒤 증거를 구분한다.
- `UNDECIDED`: 아직 사용자나 소유자가 결정하지 않은 값이다.
- `NOT_APPLICABLE — 이유`: 검토했지만 적용되지 않는 항목이다.
- 예시 행은 구조 설명용이다. 프로젝트 사실로 간주하지 않는다.

아래 검색은 미해결 항목을 찾는 보조 도구이지 자동 합격·불합격 검사가 아니다. 생성한 대상 파일이 있는
디렉터리에서 실행하고, 원본 템플릿과 공통 runbook 안의 미사용 기록 양식은 판정 대상에서 제외한다.
검색 결과 중 `READY`의 필수 입력은 해결해야 하지만, 미래 실행 증거는 `NOT_RUN`, 비차단 결정은
owner·다음 조건·STATE 참조를 확인한다. 문자열을 치환해 검색 결과만 없애는 것은 해결이 아니다.

```sh
rg -n '\{\{[A-Z0-9_]+\}\}|\bUNDECIDED\b' .
```

## 의도적으로 포함하지 않은 것

- 특정 언어, 패키지 관리자, 프레임워크, 데이터베이스, 클라우드 설정
- 모든 프로젝트에 강제되는 CI/CD 또는 Git hook
- 미리 만든 모듈·추상화·fallback chain
- 실제 필요가 확인되지 않은 인증·관측·배포 인프라

`AGENTS.md`를 자동으로 읽지 않는 도구에는 같은 규칙을 복사하지 않고 이 파일을 가리키는 얇은 adapter만 둔다.

코드 기반은 선택한 플랫폼의 공식 starter를 사용한다. 이 키트에서 반복이 확인된 작업만 이후 생성기나 자동 게이트로 승격한다.

## EUNHA에서 추출한 원형

이 키트는 EUNHA의 제품·공급자 값을 복사하지 않고 다음 구조만 일반화했다.

- 프로젝트 규칙: [`../../AGENTS.md`](../../AGENTS.md)
- 현재 작업과 미해결 결정: [`../../STATE.md`](../../STATE.md)
- 결정 기록: [`../../docs/decisions/`](../../docs/decisions/)
- 단일 정본과 결합 지도: [`../../docs/operations/coupling-map.md`](../../docs/operations/coupling-map.md)
- 검증 등록부: [`../../scripts/ops/gate-registry.mjs`](../../scripts/ops/gate-registry.mjs)
- 기계 검증 계약: [`../../ops/contracts/`](../../ops/contracts/)
- 운영·복구 절차: [`../../docs/operations/`](../../docs/operations/)
- 재발 방지 교훈 인덱스: [`../../docs/memory/MEMORY.md`](../../docs/memory/MEMORY.md)
