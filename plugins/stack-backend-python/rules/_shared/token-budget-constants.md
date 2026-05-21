> Language-neutral invariants — TokenBudget allocation, attachment ordering, partial loading thresholds.
> 정본 (single source of truth) for both Python and Rust harnesses.
> Cited from: `python_agent_rules/context-assembly-patterns.md`, `rust_agent_rules/context-assembly-patterns.md`.

# Token Budget — 언어 무관 불변식

## Token Budget 6 영역 (기준 모델 200K)

| 영역 | 토큰 | 전략 |
|------|------|------|
| BASE | 4,000 | 고정, truncate 불가 |
| AGENT | 8,000 | 고정, truncate 불가 |
| HINT | 500 | 2000자 컷 후 토큰 검증 |
| MEMORY | 16,000 | 최신순 LRU |
| CONVERSATION | 150,000 | Compaction 대상 (Stage 1 트리거) |
| RESERVED | 21,500 | LLM 출력 + 안전 마진 |
| **합계** | **200,000** | 기준 모델 (Claude 200K) context window |

## Provider 별 effective window 동적 스케일

- **Provider 별**: Anthropic 200K / OpenAI 128K / Google 1M+ 등
- 실제 `effective_window` 는 `provider.capabilities(model).context_window` 에서 조회
- 비-200K 모델: 영역별 비율 유지하며 스케일
  - 예: 128K 모델 → BASE 2,560 / AGENT 5,120 / MEMORY 10,240 / CONVERSATION 96,000 / RESERVED 13,760
- 정확한 스케일 로직은 `TokenBudget.for_model(model)` (Python) / `TokenBudget::for_model(model_id: &str)` (Rust) 에서 관리
- rule 은 비율·순서·불변만 정의, 정확한 상수는 코드에서 관리

## Compaction 트리거 조건

```
trigger if current_input_tokens > effective_window - RESERVED
```

- `total_input()` / `effective_window()` 는 **instance method** (self 기반 합산)
- `for_model(model_id)` 만 classmethod / 정적 함수 (인스턴스 생성)

## 3-Layer System Prompt (순서 고정)

| Layer | 소스 | 변경 빈도 | 캐시 영향 |
|-------|------|----------|----------|
| 1. Base | `agents/prompts/base.md` | 극저 | prefix |
| 2. Agent | `agents/prompts/<agent>.md` | 저 | prefix |
| 3. Context hint (옵셔널) | 요청별 주입 | 고 | suffix |

- 합성 순서는 **base → agent → context_hint** 고정. 뒤바뀌면 cache prefix 무효화
- `build_system_prompt()` 는 동일 입력에 바이트 수준 동일 문자열 반환
- context_hint 는 `HINT_MAX_CHARS=2000` 초과 시 head + `...` 컷 (Python: `_HINT_MAX_CHARS` private 관례, Rust: `HINT_MAX_CHARS`)
- **Layer 1/2 에 동적 값 금지**: timestamp, turn_count, session_id, random seed 등 → messages 첫 user 또는 metadata 로 이동

## 프롬프트 .md 파일 관리 원칙

프롬프트는 코드가 아닌 **파일** 로 관리. 한 바이트 편집이 세션 전체 cache 무효화:

- 파일 끝 개행 추가/제거, trailing 공백 삽입, 탭↔스페이스 혼용 → prompt prefix bytes 달라짐 → prompt cache 히트 0%
- 에디터 자동 정리 (trim trailing whitespace, ensure newline at EOF) 가 범인인 경우 많음
- `.editorconfig` / pre-commit 훅으로 고정
- 무해해 보이는 "포맷 정리" 커밋이 토큰 비용 수 배 상승으로 이어짐

## Attachment 수집 순서 (변경 빈도 낮은 것 먼저, prefix cache 보호)

매 턴마다 Stage 1 은 고정 순서로 attachment 를 수집한다. 순서 변경 금지 — prompt cache prefix 가 무효화된다.

| 빈도 | 위치 | 예시 |
|------|------|------|
| 저빈도 | 앞쪽 | 에이전트 정의, 프로젝트 규칙 |
| 중빈도 | 중간 | memory block, nested rule |
| 고빈도 | 뒤쪽 | context hint, 최근 read 파일 |

**현재 vs 목표**: `AttachmentType` enum 은 **11 values** (현재 코드 기준). 디자인 spec 목표는 **17 types** (agents directory / commands / hooks / permissions 등 추가 예정). 순서/빈도 원칙은 동일하게 적용.

## SKILLS attachment 위치

- `AttachmentType.SKILLS` 의 ordinal 위치는 **9** (suffix 영역)
- 유저가 자주 편집하는 특성에 정합
- **ordinal 변경 금지** — 모든 세션 prompt cache prefix 무효화
- 본문은 `UserSkillPort.read_body(user_id, name)` 에서 조회 후 `bodies` 파라미터로 주입
- 본문 없이 이름만 주면 header-only card 로 degrade

## Memory > History 보존 우선순위

- truncate 루프는 `memory_prefix_len` 인덱스부터 history 삭제. memory 구간(prefix) 은 건드리지 않음
- 뒤집으면 "사용자 등록 사실 증발" 버그 — 여러 턴 후 재현되어 추적 어려움
- 휘발성(history) < 영구성(memory) 원칙 고수

## Nested Memory Injection + Dual Dedup

- 파일 접근 시 CWD→대상 디렉토리까지 순회. 각 디렉토리의 AGENTS.md + 매칭 rules 수집
- **Dual dedup**: Non-evicting Set (재주입 방지, 항상 유지) + LRU (메모리 제한)
- Set 에 있으면 무조건 skip — LRU 가 evict 해도 Set 은 유지되어 재주입 안 됨
- 직접 append 금지 — 반드시 dedup 경유

## AssembledContext (Stage 1 산출물)

```
AssembledContext = (system_prompt, messages, tools, generation_params)
```

- 불변 (Python: `@dataclass(slots=True)`, Rust: `#[derive(Clone)]` + private fields). Stage 2+ 는 read-only 로 소비
- tools 는 `ToolRegistry.filter_for_agent(...).definitions()` 로 제공 — API tools 파라미터로 별도 전달 (system prompt 에 inline 금지)
- Stage 1 이 끝난 후 system_prompt / messages 수정 금지

## 공통 금지 사항 (언어 무관)

- System prompt (Layer 1/2) 에 동적 값 삽입 (timestamp, turn_count, random)
- 도구 정의 결과를 system prompt 에 inline (반드시 API tools 파라미터로)
- Memory 구간을 history 보다 먼저 truncate
- Attachment 수집 순서를 런타임에 변경 (cache 무효화)
- Dual dedup 우회 직접 append (Set/LRU 양쪽에 반영되어야 함)
- TokenBudget 합계가 provider window 와 불일치
- AssembledContext 를 Stage 2 이후에 mutate
- Context hint 를 2000자 초과 그대로 주입 (반드시 컷)
- 영역별 토큰 수치를 비율 유지 없이 변경 (compaction 빈도 + cache miss 동반)
