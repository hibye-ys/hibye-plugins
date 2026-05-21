> Language-neutral invariants — Input safety gate V3 ordering, two-port jailbreak, orthogonal moderation, header sentinels.
> 정본 (single source of truth) for both Python and Rust harnesses.
> Cited from: `python_agent_rules/run-policy.md`, `rust_agent_rules/run-policy.md`,
>             `python_agent_rules/architecture.md`, `rust_agent_rules/architecture.md`.

# Input Safety Gate Ordering — 언어 무관 불변식

## V3 Sequential Gate Order (cheapest-first §2)

`dispatch_run` 본문에서 **순차적으로** 게이트:

```
tombstone (account state)
  → jailbreak heuristic (regex, <1ms)
    → jailbreak classifier (opt-in, on heuristic miss, PromptGuard 2)
      → moderation (OpenAI omni-moderation)
        → _stream_agent (LLM 호출 진입)
```

이유: 가장 싼 layer 먼저, 가장 비싼 layer 마지막. 어느 layer 든 reject → 즉시 422 + history/replay 미기록 (LLM 호출 비용 0).

## 4 Layer 책임

| Layer | 역할 | 비용 | 결과 |
|-------|------|------|------|
| **tombstone** | 7-day grace 동안 deletion 신청 사용자 차단 | DB lookup (1 query) | `ResourceError(user_data_pending_deletion)` → 410 |
| **jailbreak heuristic** | regex pattern 매치 (system-instruction-bypass, prompt-leak) | <1ms in-process | `JailbreakDecision { allowed, matched_patterns }` |
| **jailbreak classifier** | PromptGuard 2 (opt-in, lazy transformers) | ~10ms ONNX | `JailbreakDecision { allowed, score }` |
| **moderation** | OpenAI omni-moderation 13 카테고리 | network call (~100ms) | `ModerationDecision { categories: {category: score} }` |

## Two-Port Jailbreak (R1-B1 — 단일 wrapper 금지)

- `app.state.jailbreak_heuristic_port` (`HeuristicJailbreakProvider` / `NoopJailbreakProvider`)
- `app.state.jailbreak_classifier_port` (`PromptGuardJailbreakProvider` / `NoopJailbreakProvider`)
- **두 별도 lifespan-wired port**. 라우트는 Protocol/trait 만 참조
- 단일 `_MultiJailbreakProvider` wrapper **금지** — Protocol 의 single-responsibility 위반
- `services/moderation/` 와 cross-import 금지 — 두 layer 는 직교

## Jailbreak ↔ Moderation 직교

두 게이트는 **독립적**으로 작동 — 두 layer 모두 통과해야 `_stream_agent` 진입.

- 결과 헤더 분리: `X-App-Jailbreak-Status` + `X-App-Moderation-Status`
- 한쪽 disabled 라도 다른 쪽은 정상 작동
- 단일 input 이 둘 다 trip 가능 (예: jailbreak attempt + sexual content) — 첫 reject layer 만 422 envelope, 다른 layer 는 헤더로만 surface

## Header Set (5종 status × 2 layer)

### `X-App-Moderation-Status` (5값)
- `ok` — 모든 카테고리가 threshold 미만
- `failed_open` — provider 호출 실패 → 통과 (audit)
- `skipped_short` — 입력 너무 짧음 (예: <3 chars)
- `disabled` — `enabled=false`
- (422 분기) — `blocked` 헤더 set 안 됨 — 422 envelope 자체가 신호

### `X-App-Jailbreak-Status` (6값)
- `ok` — 매치 없음
- `flagged` — 매치 + `enforcement="log_only"` → 200 통과 (창작 platform UX)
- `blocked` — 매치 + `enforcement="block"` → 422 envelope
- `failed_open` — provider 호출 실패 → 통과 (audit)
- `disabled` — `enabled=false`
- `skipped_short` — 입력 너무 짧음

## Decision-to-Status Mapping (S-R2-2 — route 가 single source)

- Provider (heuristic / classifier / moderation) 는 **raw match facts** 만 반환
  - jailbreak: `allowed`, `matched_patterns`, `score`, `failed_open`
  - moderation: `categories: {category: score}`, `failed_open`
- **Route** 가 `JailbreakPolicy.enforcement` / `ModerationPolicy.thresholds` 를 보고 final action 결정 + 헤더 매핑
- `_decision_to_status(decision, *, blocked_label)` 헬퍼가 input/output 양쪽의 facts→status 매핑 단일 source
- `JailbreakDecision` / `ModerationDecision` 에 `status` 필드 도입 **금지** — 헤더 매핑은 라우트가 단일 source

## ModerationPolicy 핵심 불변

- `enabled: bool = true`
- `thresholds: dict[str, float] = {}` — OpenAI omni-moderation 13 카테고리 중 override 만 명시
- 기본 `_DEFAULT_HARD_BLOCK_THRESHOLDS`: `sexual/minors=0.5`, `self-harm/instructions=0.5`. 나머지 11 카테고리는 1.0 (log-only)
- 점수 범위 `[0.0, 1.0]` 만 허용. 1.0 = "절대 block 안 함" sentinel (provider strict-greater 비교)
- **Hard floor invariant**: `_HARD_FLOOR_THRESHOLDS` (sexual/minors=0.5, self-harm/instructions=0.5) 는 YAML override 로 weakening 불가 — 이 값보다 큰 threshold 입력 시 startup `ValidationError`
- **Drift guard (S-R2-1)**: `_HARD_FLOOR_THRESHOLDS` ⊆ `_DEFAULT_HARD_BLOCK_THRESHOLDS`. 누락 시 import-time `ImportError`
- `extra="forbid"` — 카테고리 이름 typo (예: `self-harm-instructions` slash↔hyphen) 시 startup `ValidationError`
- `output_enabled: bool = false` — opt-in output-side moderation. 활성 시 streaming 끝나기 전 output text 1회 check + notification SSE

## JailbreakPolicy 핵심 불변

- `enabled: bool = true`
- `classifier_enabled: bool = false` — PromptGuard 2 opt-in (R1-B4). default false = heuristic-only
- `enforcement: Literal["log_only", "block"] = "log_only"` — Phase 1 default `log_only` (B-Plat-1: 창작 platform UX 우선). 매치되어도 200 통과 + `flagged` 헤더만. `"block"` opt-in 시 매치 → 422
- `threshold: float = 0.9` (PromptGuard 한정, `ge=0.5, le=0.99`) — heuristic 은 binary, ignored. classifier 만 사용. **Strict bounds**: 0.0/1.0 sentinel 거부 (R1-S5)
- **Hard floor 없음** (Phase 1, B-Plat-1) — 창작 platform 보존. Phase 2 운영 데이터 누적 후 검토
- Heuristic pattern 추가/제거 시 `_PATTERN_COUNT_EXPECTED` 상수 동시 업데이트 (drift guard, Q13)
- Classifier opt-in 했지만 lifespan 이 실제 wire 안 했으면 (operator 가 env + extra 미설치) silently `NoopJailbreakProvider` 반환 → heuristic-only + WARNING 로그 (Sister-B5 graceful degrade)

## 3-Layer Safety Validator (R1-B5)

`moderation.enabled=false` AND `pii_redaction=false` AND `jailbreak.enabled=false` → WARNING 로그 (`run_policy.no_safety_layer`).

- 세 입력측 안전 레이어가 모두 꺼진 상태는 fictional-only / internal scope 에서만 정당화
- startup 실패 아님 (audit trail 만)
- jailbreak cycle 이 moderation cycle 의 2-layer 검증을 **REPLACE** (PR ordering: moderation 이 먼저 merge 되면 2-layer 도입 → jailbreak merge 시 3-layer 로 supersede)
- 단일 layer 비활성 (예: `jailbreak.enabled=false` 만) 은 warning 안 함 — heuristic FP 우려 시 비활성화는 정상 use case

## Input Reject 시 데이터 처리

- 422 응답 + history/replay 미기록 (LLM 호출 비용 0)
- structlog: `jailbreak.detected` (operator-only — pattern + score 포함) / `moderation.flagged` (categories + scores 포함)
- 사용자 응답 body 는 minimal — pattern 시그너처 / score 노출 금지 (R1-S8)

## Jailbreak Spec 참조

- spec: `docs/completed/superpowers/specs/2026-04-26-jailbreak-detection-design.md`
- moderation spec: `docs/completed/superpowers/specs/2026-04-26-content-moderation-design.md`

## 공통 금지 사항 (언어 무관)

- 게이트 순서 변경 (cheapest-first 위반)
- 어떤 게이트도 우회한 직접 LLM 호출
- 단일 `_MultiJailbreakProvider` wrapper 도입 (R1-B1 — heuristic + classifier 는 두 별도 port)
- `JailbreakDecision` / `ModerationDecision` 에 `status: str` 필드 도입 (S-R2-2 — 헤더 매핑은 라우트 단일 source)
- 422 envelope 의 `jailbreak_blocked` 에 `details` body (R1-S8 — attacker info-disclosure)
- `ModerationPolicy.thresholds` 에 `_HARD_FLOOR_THRESHOLDS` 보다 큰 값 주입
- `JailbreakPolicy.threshold` 에 0.0 또는 1.0 sentinel 주입 (Field validator 거부)
- `services/jailbreak/` 와 `services/moderation/` cross-import (직교 layer)
- moderation cycle 의 2-layer warning 로 회귀 (R1-B5 무력화)
