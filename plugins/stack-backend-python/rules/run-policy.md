---
paths:
  - "backend/runs/**"
  - "backend/engine/policy.py"
  - "backend/engine/run_registry.py"
---

> App backend rules — RunPolicy invariants, extension guide, impact map.
> **정본:** `_shared/run-policy-presets.md` (13 필드 / cross-field validator / 4 preset / 정책 해석 순서 — 언어 무관),
>           `_shared/input-safety-gate-ordering.md` (V3 ordering / two-port jailbreak / orthogonal moderation / 헤더 sentinel — 언어 무관).
> 본 파일은 Python 측 적용 지점만 (pydantic v2 binding, `policy.py`, `routes/run.py`).
> 관련: `agent-loop-patterns.md` (loop 재사용), `tool-system-patterns.md` (allowed_tools 필터),
>       `sub-agent-patterns.md` (spawn_enabled), `compaction-patterns.md` (compaction_enabled),
>       `api-routing-patterns.md` (routes/run.py dispatch)

# run-policy — `/run/<name>` 엔드포인트 선언 모델

## 불변식 (Invariants)

**엔드포인트 = YAML:** `POST /run/<name>` 은 `runs/<name>.yaml` 의 `RunPolicy` 를 로드해서 실행한다. 코드 변경 없이 YAML 추가만으로 새 엔드포인트가 생긴다. RunPolicy 는 **범위 제약** 만 선언하고, 엔진(6-stage loop) 은 하나다.

**RunPolicy 는 `frozen=True` (pydantic ConfigDict)** — 인스턴스 생성 후 mutate 물리 차단. `extra="forbid"` — 오타 있으면 pydantic 이 `ValidationError` raise. 두 제약은 `policy.py:30` 에서 함께 선언됨.

**RunPolicy 필드 (`backend/engine/policy.py`, pydantic v2 BaseModel):**

| 필드 | 타입 | 기본값 | 의미 |
|------|------|--------|------|
| name | str | — | 라우트 세그먼트. `[a-z0-9_]+`, 1~64자 |
| description | str \| None | None | 내부 문서용. 런타임 동작 영향 없음 |
| system_prompt_file | str | — | `runs/prompts/<file>.md` 상대 경로. 필수 |
| model_preference | str | "default" | fallback chain 이름 |
| allowed_tools | list[str] \| None | None | None=전체, []=도구 없음, list=화이트리스트 |
| max_turns | int | 50 | 루프 강제 종료 상한 |
| compaction_enabled | bool | True | Stage 1 compaction 활성 여부 |
| spawn_enabled | bool | False | spawn_agent 도구 노출 여부 |
| max_spawn_depth | int | 0 | 이 run 이 허용하는 서브 깊이 (`ge=0`). runtime `check_depth()` 가 per-policy cap 으로 사용 (engine 이 `ctx.metadata["policy_max_spawn_depth"]` 로 주입). 전역 상한 `GLOBAL_MAX_SPAWN_DEPTH = 3` (`policy.py:14`) 초과 시 startup reject |
| response_schema | str \| None | None | pydantic 모델 이름. 지정 시 마지막 assistant text 블록을 `parse_with_schema()` 로 파싱. **`sse=True` 와 상호 배타** — 조합 시 request-time 422 (`invalid_policy`) |
| sse | bool | True | True=EventSourceResponse, False=JSON buffer |
| session_enabled | bool | True | False=stateless (매 호출 새 세션) |
| pii_redaction | bool | True | True=user_message + tool_result 에 5종 PII 패턴 (RRN/모바일/유선/이메일/카드/운전면허) 일방향 redact. False=raw 데이터를 모델/DB 양쪽에 보존 (도메인이 fictional 한 경우 등). SSE wire scrub 은 정책과 무관하게 항상 작동 (sse-streaming-patterns.md `_SCAN_EVENTS`). **Phase 1 forward-only**: 이 플래그가 ship 되기 전에 저장된 `session_messages` row 는 retro-redact 안 됨. compliance 가 retro 요구하면 별도 ops migration 필요 (spec `2026-04-25-pii-redaction-phase1-design.md` §6.8) |
| moderation | ModerationPolicy | `ModerationPolicy()` (enabled=True, hard-block defaults) | Content moderation Phase 1 (input-side only). 기본 hard-block: `sexual/minors` + `self-harm/instructions` (=0.5). 나머지 11 카테고리는 log-only (effective threshold 1.0). 활성 시 `dispatch_run` 이 `record_turn` 후 `_stream_agent` 전에 게이트 — blocked 면 422 (`content_moderation_blocked`) + history/replay 미기록. 결과는 `X-App-Moderation-Status` 헤더로 (5값: `ok` / `failed_open` / `skipped_short` / `disabled` / 422 분기). spec: `docs/completed/superpowers/specs/2026-04-26-content-moderation-design.md` |
| jailbreak | JailbreakPolicy | `JailbreakPolicy()` (enabled=True, classifier_enabled=False, enforcement="log_only") | Jailbreak detection Phase 1 (input-side only). 기본 heuristic-only + log_only — 창작 platform UX 우선 (B-Plat-1). `enforcement="log_only"` 시 매치되어도 200 통과 (`flagged` 헤더만), `"block"` 시 매치 → 422 (`jailbreak_blocked`, **NO `details` body** R1-S8). V3 gate ordering: `tombstone → jailbreak heuristic → jailbreak classifier (opt-in, on heuristic miss) → moderation → _stream_agent` (cheapest-first §2). 결과는 `X-App-Jailbreak-Status` 헤더 (6값: `ok` / `flagged` / `blocked` / `failed_open` / `disabled` / `skipped_short`). moderation 과 직교 — 두 layer 모두 통과해야 `_stream_agent` 진입. spec: `docs/completed/superpowers/specs/2026-04-26-jailbreak-detection-design.md` |
| required_scope | str \| None | None | None=authenticated caller 허용. 설정 시 `dispatch_run` 이 inline `has_scope(scopes, required)` 로 검사 — 실패 시 **leak-safe 404** (403 아님, 존재 여부 유출 방지). 예: `"chat"`, `"admin"` |

**불변 규칙:**

- `spawn_enabled=True` 인데 `allowed_tools` 에 `spawn_agent` 가 없으면 → 시작 시 `ValidationError` raise. (또는 allowed_tools=None 이어야 함)
- `spawn_enabled=True` 인데 `max_spawn_depth < 1` → 시작 시 `ValidationError` raise. "spawn 허용하지만 깊이 0" 은 모순
- `max_spawn_depth > GLOBAL_MAX_SPAWN_DEPTH (=3, policy.py:14)` → startup 실패 (fail-fast). `_spawn_contract.py::MAX_SPAWN_DEPTH` 도 3 으로 동일 값 (두 상수 의도적 동일)
- runtime: `check_depth(ctx)` 가 `min(MAX_SPAWN_DEPTH, policy_cap)` 를 유효 ceiling 으로 사용
- `compaction_enabled=False` + `max_turns > 10` → WARNING 로그 (`run_policy.ptl_risk`). 긴 대화에서 PTL 발생 가능성 경고만 — startup 실패 아님
- `response_schema` + `sse=True` → **request-time 422** (`invalid_policy`, `routes/run.py:283`). 반드시 `sse=false` 와 조합 — schema 파싱은 전체 assistant message 가 손에 있어야 가능
- `session_enabled=False` 인 run 은 `state/session.py` 쓰기 금지. 메모리 추출 로직도 skip
- `moderation.enabled=False` AND `pii_redaction=False` AND `jailbreak.enabled=False` → WARNING 로그 (`run_policy.no_safety_layer`). 세 입력측 안전 레이어가 모두 꺼진 상태는 fictional-only / internal scope 에서만 정당화 — startup 실패 아님 (audit trail 만). **3-layer 검증 (R1-B5)**: jailbreak cycle 이 moderation cycle 의 2-layer 검증을 **REPLACE** (PR ordering: moderation 이 먼저 merge 되면 2-layer 도입 → jailbreak merge 시 3-layer 로 supersede). 단일 layer 비활성 (예: `jailbreak.enabled=False` 만) 은 warning 안 함 — heuristic FP 우려 시 비활성화는 정상 use case
- YAML 의 key 이름은 RunPolicy 필드와 **정확히 일치**. 오타 있으면 pydantic 이 `extra="forbid"` 로 reject

**`ModerationPolicy` (nested, `backend/engine/policy.py`):**

- `enabled: bool = True` — False 면 input + output 게이트 모두 우회 + 헤더 `disabled` (output 도 함께 꺼짐)
- `thresholds: dict[str, float] = {}` — OpenAI omni-moderation 13 카테고리 (`sexual`, `sexual/minors`, `hate`, `hate/threatening`, `harassment`, `harassment/threatening`, `self-harm`, `self-harm/intent`, `self-harm/instructions`, `violence`, `violence/graphic`, `illicit`, `illicit/violent`) 중 override 만 명시. 기본은 `_DEFAULT_HARD_BLOCK_THRESHOLDS` (sexual/minors=0.5, self-harm/instructions=0.5). 나머지는 1.0 (log-only). Input 과 output 양쪽 모두 동일 thresholds 사용 (Phase 1 — 분리 thresholds 는 future)
- `output_enabled: bool = False` — opt-in output-side moderation hookup (Phase 1 add-on, 2026-04-26). True 시 `dispatch_run` 이 `_stream_agent` 출력 SSE 를 `_moderate_output_stream` 으로 wrap → 누적 assistant text 를 1회 `ModerationPort.check` 통과 + `notification` SSE 이벤트 (`kind=output_moderation`, `status=ok|flagged|failed_open`, `provider`, `categories`) 를 terminal `done` 이전에 inject + `output_moderation.scored` / `output_moderation.flagged` structlog. **Phase 1 enforcement = log_only** (B-Plat-1, mirrors JailbreakPolicy.enforcement default) — flagged 라도 `done` frame 그대로 emit, 응답 텍스트 redact/block 안 함. 별도 outbound 헤더 없음 (이미 stream 시작 후라 헤더 set 불가). 게이팅: `enabled=False` OR `output_enabled=False` 시 dispatch_run wiring 에서 wrap 자체 skip → zero per-frame overhead
- `model_config = ConfigDict(extra="forbid", frozen=True)` — 카테고리 이름 typo (예: `self-harm-instructions` slash↔hyphen) 시 startup `ValidationError`
- 점수 범위 `[0.0, 1.0]` 만 허용. 1.0 = "절대 block 안 함" sentinel (provider strict-greater 비교)
- **Hard floor invariant**: `_HARD_FLOOR_THRESHOLDS` (sexual/minors=0.5, self-harm/instructions=0.5) 는 YAML override 로 weakening 불가 — 이 값보다 큰 threshold 입력 시 startup `ValidationError`. 운영자는 코드 (PR review trail) 로만 변경 가능
- **Drift guard (S-R2-1)**: 모든 `_HARD_FLOOR_THRESHOLDS` 카테고리는 `_DEFAULT_HARD_BLOCK_THRESHOLDS` 에도 존재해야 함 (subset). 누락 시 import-time `ImportError` (프로세스 부팅 실패 — `python -O` 우회 불가)
- `effective_thresholds()` = defaults + overrides 머지. 게이트 호출 시 provider 가 이 dict 사용 (input + output 공유)
- **Decision-to-status mapping shared (`_decision_to_status`)**: `routes/run.py::_decision_to_status(decision, *, blocked_label)` 가 input/output 양쪽의 facts→status 매핑 단일 source. Input: `blocked_label="blocked"` (→ 422 분기). Output: `blocked_label="flagged"` (→ notification, log_only). S-R2-2 패턴 — `ModerationDecision` 에 `status` 필드 도입 금지

**`JailbreakPolicy` (nested, `backend/engine/policy.py`):**

- `enabled: bool = True` — False 면 게이트 우회 + 헤더 `disabled`. heuristic + classifier 모두 영향
- `classifier_enabled: bool = False` — PromptGuard 2 classifier opt-in (R1-B4). default False = heuristic-only. True 라도 lifespan 이 실제 classifier port 를 wire 안 했으면 (operator 가 `APP_JAILBREAK_PROMPT_GUARD_ENABLED=true` 설정 + `[jailbreak]` extra 설치) silently `NoopJailbreakProvider` 반환 — 결과적으로 heuristic-only + WARNING 로그 (Sister-B5 graceful degrade)
- `enforcement: Literal["log_only", "block"] = "log_only"` — Phase 1 default `log_only` (B-Plat-1: 창작 platform UX 우선). 매치되어도 200 통과 + `flagged` 헤더만. `"block"` opt-in 시 매치 → 422 (`jailbreak_blocked`)
- `threshold: float = 0.9` (PromptGuard 한정, `Field(ge=0.5, le=0.99)`) — heuristic 은 binary (regex 매치/미매치) 라 ignored. classifier 만 사용. **Strict bounds**: 0.0 (항상 block) 도 1.0 (절대 block 안 함) 도 거부 (R1-S5 — moderation 의 1.0 sentinel 패턴은 본 spec 에 부적합)
- `model_config = ConfigDict(extra="forbid", frozen=True)` — 필드명 typo 시 startup `ValidationError`
- **Hard floor 없음 (Phase 1, B-Plat-1)**: moderation 의 `_HARD_FLOOR_THRESHOLDS` 같은 고정 floor 없음. 창작 platform 의 fictional role-play 보존이 default — 운영 데이터 누적 후 Phase 2 에 hard floor 도입 검토. drift guard 패턴은 moderation S-R2-1 참조 (Phase 2 도입 시 동일 subset check)
- **Provider raw decision vs route enforcement 분리 (S-R2-2 패턴)**: provider (`HeuristicJailbreakProvider`, `PromptGuardJailbreakProvider`) 는 raw match facts (`allowed`, `matched_patterns`, `score`, `failed_open`) 만 반환. Route 가 `JailbreakPolicy.enforcement` 를 보고 final action 결정 + `X-App-Jailbreak-Status` 헤더 매핑 (single source). `JailbreakDecision` 에 `status: str` 필드 도입 금지 (sister cycle S-R2-2 와 동일 원칙)

**정책 해석 순서 (시작 시 1회):**

1. `runs/<name>.yaml` 파싱 → dict (`yaml.safe_load`)
2. `${VAR}` 치환 — `backend/utils/env.py::substitute_env(obj, on_missing="keep_placeholder")`. **누락 env 는 placeholder 문자열 그대로 유지** (startup 을 막지 않음 — 오타는 hot-reload 리뷰 시점에 surface). Provider YAML 과 다름 (`MCP/providers` 는 missing 시 raise 가 기본)
3. `RunPolicy.model_validate(substituted)` 로 인스턴스 생성 → pydantic 필드 검증 + `extra="forbid"`
4. cross-field 검증 (`@model_validator(mode="after")` — spawn/tools, depth, PTL warning)
5. `allowed_tools` 에 존재하지 않는 도구 이름 있으면 `ValidationError` (optional `tool_name_provider` 주입 시)
6. `RunRegistry` 에 등록 (write-once) + 시스템 프롬프트 pre-resolve (`_resolved_prompts`)

**프리셋 가이드 (YAML 작성자용):**

| 용도 | 핵심 설정 |
|------|-----------|
| 대화형 에이전트 (chat) | `max_turns=100`, `compaction=true`, `spawn=true`, `sse=true`, `session=true`, `allowed_tools=null` |
| 단발 분류 task | `allowed_tools=[]`, `max_turns=1`, `compaction=false`, `response_schema=<Schema>`, `sse=false`, `session=false` |
| 도구 기반 task | `allowed_tools=[read_file, search, ...]`, `max_turns=5`, `compaction=false`, `response_schema=<Schema>`, `sse=false`, `session=false` |
| multi-agent task | `allowed_tools=[read_file, spawn_agent, ...]`, `max_turns=20`, `spawn_enabled=true`, `max_spawn_depth=2`, `compaction=true`, `sse=true`, `session=true` |

## 새 run 추가하기

1. `runs/<name>.yaml` 생성 — 위 필드 작성. 의심스러우면 프리셋 복사
2. `runs/prompts/<name>.md` — system prompt 작성 (정적 영역은 prefix 에 둠)
3. `response_schema` 사용하면 해당 pydantic 모델을 `backend/engine/types.py` 또는 `routes/schemas.py` 에 선언. registry 에 이름 등록
4. 도구 화이트리스트 사용 시 각 도구가 존재하는지 확인 (registry lookup 실패 시 startup fail-fast)
5. 재시작 또는 `POST /runs/reload` 로 YAML 재로드
6. `GET /runs` 로 등록 확인
7. 테스트: `POST /run/<name>` 으로 실제 호출 + 응답 형식 (SSE or JSON) 검증

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| RunPolicy 필드 추가 | 모든 기존 YAML 검증 (`extra="forbid"`), 문서 업데이트 필요 |
| RunPolicy `frozen=True` 해제 | runtime mutate 물리 차단 해제 → 경쟁 조건/일관성 버그 |
| allowed_tools 해석 방식 변경 | 기존 run 의 도구 노출 범위 달라짐 |
| `GLOBAL_MAX_SPAWN_DEPTH` (`policy.py:14`) 변경 | `_spawn_contract.py::MAX_SPAWN_DEPTH` 와 동시에 바꿔야 정합성 유지. sub-agent-patterns.md 도 업데이트 |
| response_schema + sse 상호 배타 규칙 해제 | schema 파싱 로직을 스트림 기반으로 전면 재설계 필요 |
| `required_scope` 검사 방식 변경 (inline → `Depends`) | dispatch_run 시그니처 + test fixture 전면 수정 |
| `pii_redaction` 기본값 변경 (True → False) | 모든 기존 run 의 PII 처리 정책 변경 — DB 에 raw PII 저장 (compliance 영향). False 로 바꿀 거면 per-run YAML 에 명시적 opt-out 권장 |
| PII 패턴 추가/제거 (`backend/observability/pii.py::_PII_UNION`) | `_PII_UNION_EXPECTED_GROUPS` 상수 동시 업데이트 — 누락 시 import-time `ImportError`. SSE / 로그 / DB / HTTP envelope 4 경로 모두 영향 (sse-streaming-patterns.md) |
| `moderation.enabled` 기본값 변경 (True → False) | 모든 기존 run 의 입력 게이트 비활성 — operator opt-out 이 명시적 신호여야 하므로 기본값 False 는 §1 safe-default 위반 |
| `_HARD_FLOOR_THRESHOLDS` 항목 추가/제거 또는 값 변경 | 운영자가 YAML 만으로 카테고리를 약화할 수 있는 범위 변경. `_DEFAULT_HARD_BLOCK_THRESHOLDS` 와의 subset 관계 유지 필수 — 위반 시 import-time `ImportError` |
| OpenAI 카테고리 enum 변경 (`_OPENAI_MODERATION_CATEGORIES`) | provider 13종 동기화. 누락 카테고리는 typo 거부 위양성 위험, 추가 누락은 `thresholds` 검증 우회 위험. `services/moderation/openai_provider.py` 와 동시 업데이트 |
| `ModerationPolicy.model_config` `extra="forbid"` 해제 | YAML 오타 (slash↔hyphen 등) 가 silent-pass — 운영자가 의도한 카테고리가 적용 안 되는데 startup 통과 |
| `JailbreakPolicy.enabled` 기본값 변경 (True → False) | 모든 기존 run 의 jailbreak 게이트 비활성 — operator opt-out 이 명시적 신호여야 하므로 §1 safe-default 위반. heuristic 은 무료(<1ms) 라 비활성화 ROI 없음 |
| `JailbreakPolicy.enforcement` 기본값 변경 (`log_only` → `block`) | Phase 1 의 B-Plat-1 (창작 platform UX) 위반. heuristic FP 가 정상 fictional 차단. 운영 데이터 (flagged-rate < 2%) 확인 후에만 RunPolicy 별 opt-in 권장 |
| `JailbreakPolicy.threshold` 범위 변경 ([0.5, 0.99]) | 0.0 또는 1.0 sentinel 도입 시 의도 모호 — 비활성화는 `enabled=False` 로만 표현. R1-S5 패턴 |
| Heuristic pattern 추가/제거 (`backend/services/jailbreak/_patterns.py`) | `_PATTERN_COUNT_EXPECTED = 22` 상수 동시 업데이트 — 누락 시 import-time `ImportError` (drift guard, Q13). 운영 flagged-rate dashboard 영향 |
| `_validate_safety_layers` 의 3-layer 조건 변경 (예: 2-layer 로 회귀) | jailbreak 이 도입한 R1-B5 (3-layer warning) 무력화. moderation cycle 의 R1 lesson 와 일관성 깨짐 — 두 cycle 함께 검토 필요 |
| YAML 로더가 extra 필드 허용 여부 | 오타 감지 능력 변경 |
| `${VAR}` `on_missing` 정책 변경 (keep_placeholder → raise) | 일시적 env 누락 시 startup 실패 → 배포 안정성 영향 |
| RunRegistry 가 runtime mutate 허용? | **금지** — 부팅/reload 시에만 갱신. `_locked` 플래그로 enforce |

## 금지 사항

- 코드에서 `RunPolicy` 직접 인스턴스화 후 loop 호출 (반드시 `runs/*.yaml` 경유)
- YAML 에 시크릿 하드코드 (반드시 `${VAR}`)
- 기존 agent-loop / tool-system / sub-agent / compaction 불변식을 **RunPolicy 로 우회**. 범위 제약 외의 의미를 담지 말 것
- `allowed_tools` 에 존재하지 않는 도구 이름 (startup fail-fast 해야 함)
- 같은 name 으로 2개 YAML 파일 (하나가 승리하면 예측 불가 — `RunRegistry.load_from_dir` 이 duplicate 감지 시 `ConfigurationError`)
- RunPolicy 를 런타임에 mutate (`frozen=True` 로 물리 차단되어 있지만 우회 시도 금지)
- `sse=True` + `response_schema` 조합 (422 — 반드시 `sse=false` 와 조합)
- `ModerationPolicy.thresholds` 에 `_HARD_FLOOR_THRESHOLDS` 보다 큰 값 주입 (startup `ValidationError`. 약화하려면 코드의 floor 자체를 PR review 로 변경)
- `ModerationDecision` 에 `status: str` 필드 도입 (S-R2-2 위반 — 헤더 값 매핑은 라우트가 단일 source. provider 는 facts 만)
- `JailbreakDecision` 에 `status: str` 필드 도입 (S-R2-2 동일 원칙 — `_classify_jailbreak_status()` 가 single source)
- `JailbreakPolicy.threshold` 에 0.0 또는 1.0 sentinel 주입 (Field validator 가 거부, R1-S5)
- 단일 wrapper `_MultiJailbreakProvider` 도입 (R1-B1 — heuristic + classifier 는 두 별도 port lifespan-wired. 단일 wrapper 는 Protocol 의 single-responsibility 위반)
