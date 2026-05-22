---
name: run-policy-presets
description: RunPolicy 16 필드 defaults, cross-field 불변, 정책 해석 순서, 프리셋 가이드 invariant. YAML 추가만으로 새 엔드포인트.
metadata:
  role: invariant
  scope: project
  source: stack-backend-python/_shared/run-policy-presets.md
---

**적용된 §4.4 매트릭스 행**: 거의 ✕ (constants table). 본문 안 Python config 클래스 → TS `const` + zod 검증 형태로 적용.

> Language-neutral invariants — RunPolicy schema, defaults, cross-field validation, presets.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/run-policy.md`, `ts_agent_rules/run-policy.md`.

# RunPolicy — 언어 무관 불변식

## 엔드포인트 = YAML

`POST /run/<name>` 은 `runs/<name>.yaml` 의 `RunPolicy` 를 로드해서 실행.

- 코드 변경 없이 YAML 추가만으로 새 엔드포인트가 생긴다
- RunPolicy 는 **범위 제약** 만 선언, 엔진(6-stage loop) 은 하나
- RunPolicy 는 **frozen** + Zod `strict()` — 인스턴스 생성 후 mutate 차단 + 오타 시 startup `ValidationError`

## RunPolicy 16 필드 (defaults + 의미)

TS 구현: `z.object({ ... }).readonly()` 또는 `Object.freeze(policy)` 로 immutability 보장.

| 필드 | 타입 | 기본값 | 의미 |
|------|------|--------|------|
| `name` | string | — | 라우트 세그먼트. `[a-z0-9_]+`, 1~64자 |
| `description` | string / null | null | 내부 문서용. 런타임 동작 영향 없음 |
| `system_prompt_file` | string | — | `runs/prompts/<file>.md` 상대 경로. 필수 |
| `model_preference` | string | `"default"` | fallback chain 이름 |
| `allowed_tools` | string[] / null | null | null=전체, []=도구 없음, list=화이트리스트 |
| `max_turns` | number | 50 | 루프 강제 종료 상한 |
| `compaction_enabled` | boolean | true | Stage 1 compaction 활성 여부 |
| `spawn_enabled` | boolean | false | spawn_agent 도구 노출 여부 |
| `max_spawn_depth` | number | 0 | 이 run 이 허용하는 서브 깊이 (`ge=0`). 전역 상한 `MAX_SPAWN_DEPTH=3` 초과 시 startup reject |
| `response_schema` | string / null | null | 스키마 이름. 지정 시 마지막 assistant text 블록을 schema 로 파싱. **`sse=true` 와 상호 배타** |
| `sse` | boolean | true | true=streamSSE, false=JSON buffer |
| `session_enabled` | boolean | true | false=stateless (매 호출 새 세션) |
| `pii_redaction` | boolean | true | true=user_message + tool_result 에 5종 PII 패턴 (RRN/모바일/유선/이메일/카드/운전면허) 일방향 redact |
| `moderation` | nested | `ModerationPolicy()` (enabled=true, hard-block defaults) | Content moderation Phase 1 (input-side only) |
| `jailbreak` | nested | `JailbreakPolicy()` (enabled=true, classifier_enabled=false, enforcement="log_only") | Jailbreak detection Phase 1 (input-side only) |
| `required_scope` | string / null | null | null=authenticated caller 허용. 설정 시 inline scope check + leak-safe 404 |

## Cross-field 불변 (startup fail-fast)

- `spawn_enabled=true` 인데 `allowed_tools` 에 `spawn_agent` 가 없으면 → 시작 시 `ValidationError`
- `spawn_enabled=true` 인데 `max_spawn_depth < 1` → 시작 시 `ValidationError`. "spawn 허용하지만 깊이 0" 은 모순
- `max_spawn_depth > 3 (=MAX_SPAWN_DEPTH)` → startup 실패
- `compaction_enabled=false` + `max_turns > 10` → WARNING 로그 (`run_policy.ptl_risk`). 긴 대화에서 PTL 발생 가능성 경고만 — startup 실패 아님
- `response_schema` + `sse=true` → **request-time 422** (`invalid_policy`). 반드시 `sse=false` 와 조합 — schema 파싱은 전체 assistant message 가 손에 있어야 가능
- `session_enabled=false` 인 run 은 세션 쓰기 금지. 메모리 추출 로직도 skip
- `moderation.enabled=false` AND `pii_redaction=false` AND `jailbreak.enabled=false` → WARNING 로그 (`run_policy.no_safety_layer`). 세 입력측 안전 레이어가 모두 꺼진 상태는 fictional-only / internal scope 에서만 정당화 — startup 실패 아님 (audit trail 만)
- YAML 의 key 이름은 RunPolicy 필드와 **정확히 일치**. 오타 있으면 Zod `strict()` 로 reject

## 정책 해석 순서 (시작 시 1회)

1. `runs/<name>.yaml` 파싱 → object
2. `${VAR}` 치환 — `substituteEnv(obj, { onMissing: 'keep_placeholder' })`. **누락 env 는 placeholder 문자열 그대로 유지** (startup 을 막지 않음 — 오타는 hot-reload 리뷰 시점에 surface). Provider/MCP YAML 과 다름 (provider/MCP 는 missing 시 throw 가 기본)
3. `RunPolicySchema.parse(substituted)` — 필드 검증 + Zod strict
4. cross-field 검증 (spawn/tools, depth, PTL warning)
5. `allowed_tools` 에 존재하지 않는 도구 이름 있으면 `ValidationError`
6. `RunRegistry` 에 등록 (write-once) + 시스템 프롬프트 pre-resolve

## 프리셋 가이드 (YAML 작성자용)

| 용도 | 핵심 설정 |
|------|-----------|
| **대화형 에이전트 (chat)** | `max_turns=100`, `compaction=true`, `spawn=true`, `sse=true`, `session=true`, `allowed_tools=null` |
| **단발 분류 task** | `allowed_tools=[]`, `max_turns=1`, `compaction=false`, `response_schema=<Schema>`, `sse=false`, `session=false` |
| **도구 기반 task** | `allowed_tools=[read_file, search, ...]`, `max_turns=5`, `compaction=false`, `response_schema=<Schema>`, `sse=false`, `session=false` |
| **multi-agent task** | `allowed_tools=[read_file, spawn_agent, ...]`, `max_turns=20`, `spawn_enabled=true`, `max_spawn_depth=2`, `compaction=true`, `sse=true`, `session=true` |

## 공통 금지 사항 (언어 무관)

- 코드에서 `RunPolicy` 직접 인스턴스화 후 loop 호출 (반드시 `runs/*.yaml` 경유)
- YAML 에 시크릿 하드코드 (반드시 `${VAR}`)
- 기존 agent-loop / tool-system / sub-agent / compaction 불변식을 **RunPolicy 로 우회**. 범위 제약 외의 의미를 담지 말 것
- `allowed_tools` 에 존재하지 않는 도구 이름 (startup fail-fast 해야 함)
- 같은 name 으로 2개 YAML 파일 (duplicate 감지 시 `ConfigurationError`)
- RunPolicy 를 런타임에 mutate (`Object.freeze` / Zod readonly 로 물리 차단되어 있지만 우회 시도 금지)
- `sse=true` + `response_schema` 조합 (422 — 반드시 `sse=false` 와 조합)
- RunRegistry runtime mutate (부팅/reload 시에만 갱신)
