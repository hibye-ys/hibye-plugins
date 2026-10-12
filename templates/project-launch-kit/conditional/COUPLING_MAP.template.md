# {{PROJECT_NAME}} — Coupling Map

같은 사실이 여러 소비자에게 필요할 때 정본과 파생 경로를 기록한다. 이 문서는 값의 사본이나 실행 정본이
아니라 변경 영향도를 찾는 read model이다. 실제 값 대신 위치·변환·검증 관계만 적는다.

상태 어휘: `LOCKED | PARTIAL | UNGUARDED | ACCEPTED_DEBT`.

처리 방식:

- `GENERATED`: 정본에서 파생물을 생성한다.
- `PARITY_CHECKED`: 외부 형식 때문에 남은 사본을 양방향 대조한다.
- `MANUAL_ATOMIC`: 자동화할 수 없지만 한 변경 단위에서 함께 갱신한다.
- `INDEPENDENT_PIN`: 후보가 자기 자신을 승인하지 못하도록 별도 기준점을 유지한다.
- `LIVE_READBACK`: 현재 상태는 저장소에 복사하지 않고 외부 시스템에서 관측한다.
- `IMMUTABLE_FORWARD`: 이미 적용된 artifact는 고치지 않고 새 후속 변경으로 전진한다.

## 결합 목록

| ID | 상태 | 공유 사실·불변식 | 정본·신뢰 종류 | 변환·처리 방식 | 실제 소비자·진입점 | 남은 사본·파생물 | 변경 소유자 | 드리프트 검사 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| {{ID}} | {{STATUS}} | {{FACT_OR_INVARIANT}} | {{AUTHORITY_AND_TRUST_KIND}} | {{TRANSFORMATION_AND_MODE}} | {{CONSUMERS_AND_ENTRYPOINTS}} | {{COPIES_OR_OUTPUTS}} | {{OWNER}} | {{PARITY_CHECK}} |

## 입력과 Provenance 경계

입력의 역할을 먼저 구분한다. 같은 역사적 정본을 읽는 두 채널이라면 pinned object만 사용하거나,
worktree 사본이 그 object와 같다는 parity proof를 강제한다. 후보 파일이 역사적 정본을 덮어쓰면 안 된다.
반면 baseline과 변경 후보는 원래 다른 버전이다. 각각의 revision·digest를 고정하고 독립적인
호환성·허용 변경 oracle로 비교한다. 둘의 동일성은 요구하지 않으며 후보가 같은 검사에서 oracle을
자기 변경에 맞춰 다시 만들거나 완화하지 못하게 한다.

| 입력 | 종류 | revision·유효기간 | 허용된 소비자 | 다른 입력과의 관계·검사 oracle |
| --- | --- | --- | --- | --- |
| {{INPUT}} | {{PINNED_BASELINE_CANDIDATE_CURRENT_EXTERNAL_OR_GENERATED}} | {{REVISION_OR_FRESHNESS}} | {{CONSUMERS}} | {{PARITY_OR_COMPATIBILITY_RULE_AND_ORACLE_IDENTITY}} |

## 독립 기준점

독립 pin·golden·negative fixture는 정본의 단순 복사본이 아니다. 무엇을 독립적으로 고정하는지와 변경 권한을
명시한다.

| 기준점 | 보호하는 실패 | 정본에서 자동 생성하지 않는 이유 | 변경 승인·절차 | 변조 시 negative case |
| --- | --- | --- | --- | --- |
| {{PIN_OR_GOLDEN}} | {{FAILURE_PREVENTED}} | {{INDEPENDENCE_REASON}} | {{CHANGE_AUTHORITY_AND_PROCEDURE}} | {{MUTANT_THAT_MUST_FAIL}} |

## 변경 절차

1. 바꾸려는 사실의 ID와 정본을 위 표에서 찾는다.
2. 소비자·경로 glob·생성물·독립 pin·외부 readback까지 실제 영향 범위를 확인한다.
3. `GENERATED`면 정본만 수정하고 지정된 명령으로 전체 파생물을 다시 만든다.
4. `PARITY_CHECKED`나 `MANUAL_ATOMIC`이면 모든 사본을 한 변경 단위에서 갱신한다.
5. 생성 전후 diff에서 누락·예상 밖 출력·ignored 산출물을 확인한다.
6. 소비자별 projection(선택·변환·순서) 규칙을 먼저 선언하고, 그 기대 출력과 실제 소비자 출력을 양방향 대조해 누락·추가를 거부한다. 정본 전체와 소비자가 같아야 하는 것은 아니다.
7. 목록뿐 아니라 각 항목의 매핑·호출 도달성·실제 동작도 검증한다.
8. 결함을 주입한 negative case가 red인지 확인한다.
9. 결합 구조가 바뀌었을 때만 이 지도를 갱신한다. 값 변경 내역은 여기에 복사하지 않는다.

## 새 소비자·사본 추가

| 질문 | 답 |
| --- | --- |
| 기존 정본에서 직접 읽거나 생성할 수 있는가? | {{DERIVATION_DECISION}} |
| 새 사본이 반드시 필요한 외부 제약은 무엇인가? | {{EXTERNAL_CONSTRAINT_OR_NONE}} |
| 소비자의 projection 규칙과 그 기대 출력은 어디에서 유도하는가? | {{PROJECTION_RULE_AND_EXPECTED_OUTPUT}} |
| 기대 출력 대비 누락·추가·순서·매핑을 누가 양방향 검사하는가? | {{VERIFIER_AND_OWNER}} |
| 실제 실행 경로가 이 소비자를 호출한다는 증거는 무엇인가? | {{REACHABILITY_EVIDENCE}} |
| 사본을 제거하거나 자동 생성으로 바꿀 조건은 무엇인가? | {{REMOVAL_OR_GENERATION_TRIGGER}} |

## 아직 수동으로 복제되는 사실

| ID | 사실 | 사본 위치 | 자동 유도가 어려운 이유 | 현재 안전장치 | 수용한 빈틈 | 해소 조건 |
| --- | --- | --- | --- | --- | --- | --- |
| {{ID}} | {{FACT}} | {{COPIES}} | {{WHY_MANUAL}} | {{GUARD}} | {{ACCEPTED_GAP}} | {{RESOLUTION_TRIGGER}} |

## 검증 불변식

- [ ] 정본은 하나이며 문서·생성물·테스트 fixture가 경쟁 정본이 되지 않는다.
- [ ] 외부 현재 상태는 저장소의 오래된 사본이 아니라 fresh readback으로 판정한다.
- [ ] 생성 명령은 전체 출력 집합을 소유하며 stale·orphan 산출물도 검출한다.
- [ ] parity 검사는 선언된 projection의 기대 출력 대비 누락·추가를 확인한다. 0건 출력은 명시적으로 허용된 경우만 인정한다.
- [ ] projection 출력 동등성뿐 아니라 값의 매핑과 실제 소비자 도달성도 검사한다.
- [ ] 독립 기준점은 후보 정본에서 같은 실행 중 자동 생성되지 않는다.
- [ ] 같은 역사적 정본의 이중 입력은 pinned-only 또는 명시적 parity proof로 보호한다.
- [ ] 서로 다른 baseline·candidate는 각 identity와 독립된 호환성·허용 변경 oracle로 비교한다.
- [ ] 이미 적용돼 수정할 수 없는 artifact는 후속 변경과 호환성 검사로 전진한다.
- [ ] 새 경로·이름·enum·버전·상태를 추가하면 분류기와 소비자 closure도 함께 검토한다.
- [ ] 지도에 없는 수동 사본을 발견하면 등록·제거·자동 생성 중 하나를 결정한다.
