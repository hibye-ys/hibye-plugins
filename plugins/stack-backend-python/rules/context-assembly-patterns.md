---
paths:
  - "backend/engine/context.py"
  - "backend/agents/prompts/**"
  - "backend/runs/prompts/**"
---

> App backend rules — Context Assembly invariants, extension guide, impact map.
> **정본:** `_shared/token-budget-constants.md` (6-region 200K split / provider scaling / 3-Layer 합성 / Attachment 순서 / Memory>History — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `core-infrastructure.md` (캐시 안정성 §3 상위 정의), `agent-loop-patterns.md` (Stage 1),
>       `compaction-patterns.md` (트리거 threshold + post-compact 재주입),
>       `user-skill-patterns.md` (SKILLS attachment 의 user-skill 본문 소스)

# context-assembly-patterns — Stage 1 컨텍스트 조립

## 불변식 (Invariants)

**3-Layer System Prompt (순서 고정):**

| Layer | 소스 | 변경 빈도 | 캐시 영향 |
|-------|------|----------|----------|
| 1. Base | `backend/agents/prompts/base.md` | 극저 | prefix |
| 2. Agent | `backend/agents/prompts/<agent>.md` | 저 | prefix |
| 3. Context hint (옵셔널) | 요청별 주입 | 고 | suffix |

- 합성 순서는 **base → agent → context_hint** 고정. 뒤바뀌면 cache prefix 무효화
- `build_system_prompt()` 는 동일 입력에 바이트 수준 동일 문자열 반환 (static system prompt)
- context_hint 는 `_HINT_MAX_CHARS=2000` 초과 시 head + `...` 컷. 더 길어야 하면 memory block 또는 user 메시지로 이동
- **Layer 1/2 에 동적 값 금지**: timestamp, turn_count, session_id, random seed 등 → messages 첫 user 또는 metadata 로 이동

**프롬프트 .md 파일 관리 원칙:**

프롬프트는 코드가 아닌 **파일** 로 관리 (`backend/agents/prompts/*.md`, `backend/runs/prompts/*.md`). 이점:

- 비-코드 협업자도 편집 가능 (작가 / PM / QA)
- git diff 가 자연어로 읽힘 → PR 리뷰 용이
- 재배포 없이 수정 가능 (hot reload 는 run-policy reload 에 한정; base/agent prompt 는 재시작)

**주의 — 한 바이트 편집이 세션 전체 cache 무효화**:

- 파일 끝 개행 추가/제거, trailing 공백 삽입, 탭↔스페이스 혼용 → prompt prefix bytes 달라짐 → Anthropic/OpenAI prompt cache 히트 0%
- 에디터 자동 정리 (trim trailing whitespace, ensure newline at EOF) 가 범인인 경우 많음 — `.editorconfig` / pre-commit 훅으로 고정
- 무해해 보이는 "포맷 정리" 커밋이 이 영역에서는 **토큰 비용 수 배 상승** 으로 이어짐

**Token Budget (기준 모델 200K 가정, 6 고정 할당):**

| 영역 | 토큰 | 전략 |
|------|------|------|
| BASE | 4,000 | 고정, truncate 불가 |
| AGENT | 8,000 | 고정, truncate 불가 |
| HINT | 500 | 2000자 컷 후 토큰 검증 |
| MEMORY | 16,000 | 최신순 LRU |
| CONVERSATION | 150,000 | Compaction 대상 (Stage 1 트리거) |
| RESERVED | 21,500 | LLM 출력 + 안전 마진 |
| **합계** | **200,000** | 기준 모델 (Claude 200K) context window |

- **Provider 별 effective window 동적**: Anthropic 200K / OpenAI 128K / Google 1M+ 등. 실제 `effective_window` 는 `provider.capabilities(model).context_window` 에서 조회. 위 표는 기준값
- 비-200K 모델: 영역별 비율 유지하며 스케일 (예: 128K 모델 → BASE 2,560 / AGENT 5,120 / MEMORY 10,240 / CONVERSATION 96,000 / RESERVED 13,760). 정확한 스케일 로직은 `TokenBudget.for_model(model)` 에서 관리
- 정확한 상수는 `TokenBudget` 클래스에서 관리. rule 은 비율·순서·불변만 정의
- Compaction 트리거: `current_input_tokens > effective_window - RESERVED`
- `total_input()` / `effective_window()` 는 **instance method** (self 기반 합산), `for_model(model_id)` 만 classmethod (인스턴스 생성)

**Attachment 수집 순서 (변경 빈도 낮은 것 먼저, prefix cache 보호):**

매 턴마다 Stage 1 은 고정 순서로 attachment 를 수집한다. 순서 변경 금지 — prompt cache prefix 가 무효화된다. 새 attachment 타입을 추가할 때 **변경 빈도** 에 따라 위치를 결정:

1. 저빈도 (에이전트 정의, 프로젝트 규칙) → 앞쪽
2. 중빈도 (memory block, nested rule) → 중간
3. 고빈도 (context hint, 최근 read 파일) → 뒤쪽

**현재 구현 vs 목표:** `AttachmentType` enum 은 **11 values** (현재 코드 기준). 디자인 §4.3.2 spec 목표는 **17 types** (agents directory / commands / hooks / permissions 등 추가 예정). 순서/빈도 원칙은 동일하게 적용.

**`AttachmentType.SKILLS` (ordinal 9) 소스:**

- `collect_skills(active, *, bodies=None, descriptions=None)` (`backend/engine/context.py`) 가 SKILLS attachment 를 생성
- 유저 커스텀 skill 본문은 `UserSkillPort.read_body(user_id, name)` 에서 조회 후 `bodies` 파라미터로 주입 (`user-skill-patterns.md`)
- 본문 없이 이름만 주면 header-only card 로 degrade — system skill (미래) / 본문 fetch 실패 시 fallback
- ordinal 9 위치 (suffix 영역) 는 유저가 자주 편집하는 특성에 정합. **ordinal 변경 금지** — 모든 세션 prompt cache prefix 무효화

**Memory > History 보존 우선순위:**

- truncate 루프는 `memory_prefix_len` 인덱스부터 history 삭제. memory 구간(prefix)은 건드리지 않음
- 뒤집으면 "사용자 등록 사실 증발" 버그 — 여러 턴 후 재현되어 추적 어려움
- 휘발성(history) < 영구성(memory) 원칙 고수

**Nested Memory Injection + Dual Dedup:**

- 파일 접근 시 CWD→대상 디렉토리까지 순회. 각 디렉토리의 AGENTS.md + 매칭 rules 수집
- Dual dedup: **Non-evicting Set** (재주입 방지, 항상 유지) + **LRU** (메모리 제한)
- Set 에 있으면 무조건 skip — LRU 가 evict 해도 Set 은 유지되어 재주입 안 됨
- 직접 append 금지 — 반드시 dedup 경유

**AssembledContext (Stage 1 산출물):**

```
AssembledContext = (system_prompt, messages, tools, generation_params)
```

- `@dataclass(slots=True)`, 불변. Stage 2+ 는 read-only 로 소비
- tools 는 `ToolRegistry.filter_for_agent(...).definitions()` 로 제공 — API tools 파라미터로 별도 전달 (system prompt 에 inline 금지)
- Stage 1 이 끝난 후 system_prompt / messages 수정 금지

**Post-Compact 재주입 의무:**

Compaction (Stage 1 재실행) 후 다음 항목을 예산 내에서 재주입. 생략 시 모델이 컨텍스트 상실:

- 최근 read 파일 (최신 N개)
- 활성 skill
- 현재 plan
- deferred tools 스키마 (요청된 것)
- MCP server instructions (delta)
- agent 목록 (전체 listing 은 제외 — 토큰 절약)

## 새 Attachment 타입 추가하기

1. 변경 빈도 분류 (저/중/고)
2. 수집 순서에서 적절한 위치 선택 (저빈도 = 앞쪽)
3. `context.py` 의 attachment collector 에 등록
4. 토큰 예산 산정 → 기존 영역에 포함 가능한지 판단, 초과 시 `TokenBudget` 확장 (영향도 참조)
5. dedup 키 정의 — Set 에서 중복 판정에 사용할 식별자
6. 캐시 prefix 에 포함되는 위치면 static, suffix 면 dynamic
7. 테스트: 수집 순서, dedup 재주입 방지, 예산 초과 시 drop 동작

## 새 Memory Block 타입 추가하기

1. 영구성 수준 결정 (사용자 등록 영구 vs 세션 영구 vs ephemeral)
2. 영구 = history 보존 우선순위 위, 세션 = history 와 동급, ephemeral = history 뒤
3. `assemble_messages` 의 memory 구간 truncate 로직이 새 타입 인덱스 범위를 보존하는지 확인
4. 최신 N개 선별 기준 (timestamp / recency / explicit priority) 명시

## 새 Nested Rule 추가하기

1. `.agents/rules/` 에 `.md` 파일 생성
2. frontmatter `paths: ["pattern/**"]` — 없으면 항상 로드 (dual dedup 비용 주의)
3. glob 패턴은 좁게 — 너무 넓으면 불필요 로딩 + 토큰 낭비
4. 해당 rule 이 static (캐시 prefix) 인지 dynamic (suffix) 인지 결정 후 주입 지점 맞추기

## `TokenBudget` 할당 조정하기

1. **변경 금지 원칙**: 기존 영역 수치 변경은 모든 운영 환경의 cache miss + compaction 빈도 변화 동반
2. 반드시 변경해야 할 때: (a) provider window 확대, (b) agent prompt 초과, (c) memory 수요 증가
3. 수정 절차: 코드 상수 변경 → `effective_window() == provider_window` assert 추가 → 회귀 테스트 (compaction 빈도)
4. 본 rule 의 분배 테이블은 **비율·순서·이유** 만 갱신. 정확한 수치는 코드 위임

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 3-Layer 합성 순서 변경 | 모든 세션의 prompt cache 무효화 |
| Layer 1/2 에 동적 값 유입 | cache 적중률 0%, 토큰 단가 수 배 상승 |
| `TokenBudget` 상수 변경 | compaction 트리거 빈도, 대화 길이 한계, RESERVED 부족 시 max-output 에러 |
| Attachment 수집 순서 변경 | cache prefix 무효화 (모든 세션 즉시) |
| Memory truncate 순서 변경 | "사용자 설정 사라짐" 버그 — 여러 턴 후 재현 |
| Post-compact 재주입 항목 변경 | compaction 후 모델이 잃는/얻는 맥락 변경 → 품질 직접 영향 |
| Dual dedup 로직 변경 | 같은 파일 반복 주입 (토큰 낭비) 또는 누락 (품질 저하) |
| `AssembledContext` 필드 추가 | Stage 2~7 소비 경로 전체 + test fixture |
| context_hint 길이 제한 변경 | base/agent 가중치 희석 위험 (너무 크면 main instruction 무시) |
| `HINT_TEMPLATE` 문구 변경 | 모든 세션의 cache suffix 무효화 |

## 금지 사항

- System prompt (Layer 1/2) 에 동적 값 삽입 (timestamp, turn_count, random)
- `ToolRegistry.definitions()` 결과를 system prompt 에 inline (반드시 API tools 파라미터로)
- Memory 구간을 history 보다 먼저 truncate
- Attachment 수집 순서를 런타임에 변경 (cache 무효화)
- Dual dedup 우회 직접 append (Set/LRU 양쪽에 반영되어야 함)
- `TokenBudget` 합계가 provider window 와 불일치
- `AssembledContext` 를 Stage 2 이후에 mutate
- Context hint 를 2000자 초과 그대로 주입 (반드시 컷)
