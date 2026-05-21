---
name: rule-linting
description: Use when adding, editing, or auditing `.agents/rules/python_agent_rules/*.md` files — defines the required 4-section structure (Invariants / Extension Guide / Impact Map / Forbidden), the cross-reference block format, invariant wording conventions, and the integration with AGENTS.md's Python backend rule list. Load before writing a new rule or when rule-consistency-auditor sub-agent reports drift.
allowed-tools: Read, Grep, Glob
---

# rule-linting — Rule 파일 구조/정합성 표준

## 이 skill은 언제 로드되는가

- `.agents/rules/python_agent_rules/` 에 새 `.md` 파일 추가
- 기존 rule 수정 (특히 cross-reference 변경)
- `rule-consistency-auditor` sub-agent 호출 시 자동 로드
- AGENTS.md 의 Python 백엔드 규약 리스트 변경

## 구조 예외

다음 파일은 4-section 구조의 의도적 예외다. 본질이 "불변식 + 확장 + 영향 + 금지" 형식에 맞지 않기 때문:

| 파일 | 이유 | 대체 구조 |
|------|------|-----------|
| `design-principles.md` | "상위 원칙" 문서 — 불변식 자체가 아닌 원칙들. | 7 원칙 × (왜 / 예시 / 판단 기준 / 반례) + 충돌 trade-off 표 + PR 자가체크 |
| `commit-rules.md` | 커밋 메시지 컨벤션 — 형식 규칙. | 7 접두사 + 형식 규칙 + 예시 + 금지 사항 |
| `coding-standards.md` | PEP 8 기반 규약 — "새로 추가" 확장 가이드 해당 없음. | 불변식 + 영향도 + 금지 (3-section) |

예외 파일도 최소한은 지킨다:
- `> 관련:` 블록 최상단 필수
- `# <name> — <title>` 헤더 필수
- "하지 말 것" 리스트 또는 등가 섹션 (금지 사항)

새 예외 추가는 **사용자 승인 필요**. 예외 3개 초과 시 "4-section 구조 자체의 재설계" 신호로 취급.

## 4-Section 구조 (변경 금지)

예외 파일 외 모든 rule 파일은 정확히 다음 4 섹션을 가진다. 순서 고정:

```markdown
> App backend rules — <one-line purpose>.
> 관련: <file1>.md (<reason>), <file2>.md (<reason>)

# <name> — <short title>

## 불변식 (Invariants)
<목록형, 변경 금지 사항 중심>

## 새 <something> 추가하기  (또는 "<X> 확장하기")
<번호 매긴 체크리스트>

## 영향도
<표 형식: 변경 / 영향받는 곳>

## 금지 사항
<목록형>
```

### 각 섹션의 역할

| 섹션 | 역할 | 잘못된 예 |
|------|------|----------|
| 불변식 | "이건 절대 이래야 한다" — WHY 포함 | 숫자 하드코딩 (코드에 있어야 함) |
| 확장 가이드 | "새로 추가할 때 이런 순서로" | 구현 예시 (skill 영역) |
| 영향도 | "이 불변식을 바꾸면 어디가 깨지나" | 단순 반복 (불변식과 동일) |
| 금지 사항 | "절대 하지 말 것" 패턴 | 권장사항 (불변식에 포함) |

## Cross-Reference Block

최상단 `> 관련:` 줄은 필수. 형식:

```markdown
> 관련: `<file>.md` (<why it's related>), `<file2>.md` (<why>)
```

- 경로는 rule 디렉토리 기준 파일명만 (예: `core-infrastructure.md`)
- why 절은 한 줄 이내 — 연관성 힌트
- 외부 참조(skills, docs)가 있으면 별도 줄로 추가:
  ```markdown
  > 관련 rule: `<rule-file>.md` §<section>
  ```

## AGENTS.md 연동

AGENTS.md 의 "Python 백엔드 규약" 섹션에 새 rule 을 등록:

```markdown
- @.agents/rules/python_agent_rules/<new-rule>.md — <one-line summary>
```

- 한 줄 요약은 description 에서 가장 중요한 1-2개 invariant 를 압축
- 순서: 기반 규칙 (coding/error/commit) → 패턴 규칙 (provider/agent/core) → 구조 규칙 (architecture/config) → 서브시스템 규칙 (context/sse/data/run/media/api) 순

## 불변식 vs 상수 — 역할 분리

| | rule (.md) | skill (SKILL.md) |
|---|---|---|
| 표현 | 산문, "이래야 한다" | 코드 / 테이블, 정확한 값 |
| 예시 | "compaction threshold 는 context window 의 87% 근처" | `auto_compact_threshold()` → 187_000 상수 |
| 변경 빈도 | 낮음 (phase 별 1-2회) | 중간 (코드와 함께) |

**원칙**: rule 이 특정 숫자를 고정하지 말 것. 값은 코드 상수 + skill 이 소유.
위반 시 코드/skill 수정 없이 rule 만 바뀌는 불일치 발생.

## 확장 가이드 번호 체크리스트 패턴

매 rule 의 "새 X 추가하기" 섹션은 번호 매긴 체크리스트 형식:

```markdown
## 새 <X> 추가하기

1. <first concrete action>
2. <next action>
...
N. 테스트: <3 개 이상 시나리오>
```

- 최소 3 단계, 최대 8 단계 (더 길면 skill 으로 분리)
- 마지막은 테스트 요구
- 각 단계는 완료 여부 판정 가능한 수준으로 구체화

## 영향도 표 패턴

```markdown
## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| <change A> | <where breaks> |
```

- 변경 컬럼은 "불변식 X 를 깨면" 식
- 영향받는 곳 컬럼은 파일/모듈 수준 구체성
- 최소 5 행, 보통 8-12 행

## 검증 체크리스트

- [ ] 4 섹션 모두 존재 + 순서 정확
- [ ] `> 관련:` 블록 최상단
- [ ] 불변식 섹션에 하드코딩 숫자 없음 (코드에 위임)
- [ ] 확장 가이드 번호 목록이며 마지막이 테스트 요구
- [ ] 영향도 표 5행 이상
- [ ] 금지 사항 최소 5개
- [ ] AGENTS.md 에 @-reference 등록됨
- [ ] Cross-reference 대상 파일 실존

## 흔한 위반

- "금지 사항" 이 "불변식" 반복 → 금지 사항은 **안티패턴** 에 집중
- 확장 가이드에 코드 스니펫 장황 → skill 영역으로 이동
- 영향도 표 1-2행 → 충분한 영향 분석 부재
- Cross-reference 없음 → 고립된 rule, 유지보수 어려움
- 숫자 하드코딩 (예: MAX_SPAWN_DEPTH=3) → code + skill 로 위임, rule 은 원칙만
