# {{PROJECT_NAME}} — System Map

> 지도 방식: `MANUAL | GENERATED | HYBRID`
> 검증 revision: {{VERIFIED_REVISION}}
> 마지막 실측일: {{VERIFIED_DATE}}
> 발견 입력: {{DISCOVERY_INPUTS}}
> 갱신 명령·절차: {{REFRESH_COMMAND_OR_PROCEDURE}}

이 파일은 **현재 구현을 탐색하기 위한 read model**이다. 실행 권위가 아니며, 충돌하면 실제 코드·계약·외부
시스템 readback을 따른다. 현재 존재하지 않는 예정 구조와 구현 간극은 `STATE.md`에 둔다.

## 1. 시스템 경계

- 시스템이 소유하는 것: {{OWNED_RESPONSIBILITY}}
- 시스템이 소유하지 않는 것: {{EXTERNAL_RESPONSIBILITY}}
- 신뢰 경계: {{TRUST_BOUNDARIES}}
- mutation 권한이 생기는 지점: {{MUTATION_AUTHORITY_BOUNDARY}}

## 2. 실제 진입점

| 종류 | 진입점 | 소유 모듈 | 코드 anchor | 계약 | Read / Write |
| --- | --- | --- | --- | --- | --- |
| {{ENTRY_KIND}} | {{ENTRY_POINT}} | {{ENTRY_OWNER}} | {{ENTRY_ANCHOR}} | {{ENTRY_CONTRACT}} | {{READ_OR_WRITE}} |

종류 예시: 사용자 화면, HTTP·RPC, CLI, worker, scheduler, queue consumer.

## 3. 모듈 지도

| 모듈 | 상태 | 책임 | 구현 위치 | 소유 데이터·계약 | 실제 의존성 | 검증 진입점 |
| --- | --- | --- | --- | --- | --- | --- |
| {{MODULE}} | {{ACTIVE_DORMANT_OR_UNAVAILABLE}} | {{RESPONSIBILITY}} | {{IMPLEMENTATION_PATH}} | {{OWNED_CONTRACT}} | {{OBSERVED_DEPENDENCIES}} | {{VERIFICATION_ENTRY}} |

- `active`: 실제 진입점이나 consumer가 있다.
- `dormant`: 구현은 있으나 현재 실제 consumer·activation이 없다.
- `unavailable`: 의도된 기능이지만 필요한 계약·권한·외부 자원이 없어 성공 경로가 없다.
- 파일 목록과 import graph는 가능하면 discovery로 생성하고, 이 표에는 모듈 의미와 경계만 수동 보강한다.

## 4. 핵심 흐름

### {{FLOW_NAME}}

| 순서 | Producer | 계약·메시지 | Consumer | 영속 상태 | 실패 표면 |
| --- | --- | --- | --- | --- | --- |
| 1 | {{PRODUCER}} | {{CONTRACT_OR_MESSAGE}} | {{CONSUMER}} | {{PERSISTENT_STATE_OR_NONE}} | {{FAILURE_SURFACE}} |

사용자에게 보이는 시작점과 완료점: {{USER_VISIBLE_START_AND_END}}

## 5. 데이터와 계약의 정본

| 데이터·어휘 | 정본 | Writer | Reader | 호환 정책 |
| --- | --- | --- | --- | --- |
| {{DATA_OR_TERM}} | {{SOURCE_OF_TRUTH}} | {{WRITER}} | {{READERS}} | {{COMPATIBILITY_POLICY}} |

이 표는 정본의 위치와 소비 관계만 보여준다. 복제된 사실·파생물의 갱신 절차는
`docs/operations/coupling-map.md`가 소유한다.

## 6. 외부 통합

| 시스템 | 목적 | Mutation 경계 | 독립 Readback 정본 | 실패 정책 | 복구 경로 |
| --- | --- | --- | --- | --- | --- |
| {{EXTERNAL_SYSTEM}} | {{PURPOSE}} | {{EXTERNAL_MUTATION_BOUNDARY}} | {{AUTHORITATIVE_READBACK}} | {{FAILURE_POLICY}} | {{RECOVERY_PATH}} |

## 7. 경계 관측

허용·금지 의존성 규칙은 `AGENTS.md`가 소유한다. 여기에는 현재 실측된 cross-boundary edge만 기록한다.

| From | To | 이유 | 규칙 reference | 판정 |
| --- | --- | --- | --- | --- |
| {{FROM_MODULE}} | {{TO_MODULE}} | {{DEPENDENCY_REASON}} | {{RULE_REFERENCE}} | `ALLOWED | VIOLATION | UNDECIDED` |

## 8. 알려진 간극

긴 계획을 이 파일에 쌓지 않고 `STATE` ID로 연결한다.

| STATE ID | 현재 관측 | 영향 | 활성화·해소 조건 |
| --- | --- | --- | --- |
| {{STATE_ID}} | {{OBSERVED_GAP}} | {{IMPACT}} | {{RESOLUTION_TRIGGER}} |

## 갱신 규칙

- 생성 영역은 손으로 수정하지 않고 발견 입력에서 다시 만든다.
- 수동 영역은 자동 추출이 어려운 의미·책임·실패 경계만 보강한다.
- 현재 구현에서 제거된 모듈을 역사 보존 목적으로 남기지 않는다.
- 지도 갱신만으로 기능·배포·외부 activation을 완료로 판정하지 않는다.
