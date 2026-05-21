---
paths:
  - "backend/tools/**"
---

> App backend rules — Tool System invariants, extension guide, impact map.
> **정본:** `_shared/tool-sort-order.md` (built-in→MCP 정렬 / cache prefix / 8-멤버 ToolProtocol / dynamic safety — 언어 무관). 본 파일은 Python 측 적용 지점만.
> 관련: `architecture.md` (단일 작성자), `agent-loop-patterns.md` (Stage 4),
>       `sub-agent-patterns.md` (allow/deny), `error-handling.md` (에러 분류)

# tool-system-patterns — 도구 시스템

## 불변식 (Invariants)

- 모든 도구는 `build_tool()` 팩토리로 생성. 직접 인스턴스 생성 금지
- 미선언 플래그는 보수적 기본값 (순차 실행, 쓰기 가정)
- 도구 안전성은 **입력에 따라 동적 결정** — 같은 도구도 인자에 따라 read-only 또는 destructive
- 실행 전 반드시 `validateInput → checkPermissions` 2단계 통과
  - validateInput: 논리 검증 (I/O 금지, 부수 효과 금지)
  - checkPermissions: allow / ask / deny / passthrough 반환
- API `tools` 파라미터 배치: `[built-in 이름순] + [MCP 이름순]`. 이 순서가 prompt cache key
- 결과가 `TOOL_PREVIEW_MAX_CHARS` (`backend/engine/stream.py`, 현재 4000자) 초과 시 head-truncate + preview 반환. 대용량 disk-spill 은 pre-launch 이후 확장 항목 (현재 미구현)
- Read 없이 Edit 금지. Read 후 외부 변경 감지(mtime 비교) 시 Edit 거부

## 새 도구 추가하기

1. `tools/{name}.py` 생성
2. `ToolProtocol` 구현 — **8 멤버** (`backend/tools/base.py:144-169`): data 3 (`name`, `description`, `input_schema: type[ToolInput]`) + methods 5 (`is_concurrency_safe(args)`, `is_read_only(args)`, `validate_input(args)`, `check_permissions(args, ctx)`, `call(args, ctx)`)
3. `build_tool()` 로 감싸기 (미선언 필드는 safe default 적용)
4. `tools/registry.py` 에 등록
5. 테스트 작성: 최소 1 성공 + 1 실패 + 1 권한거부 케이스
6. 읽기 전용이면 `is_concurrency_safe` → True 명시 (명시 안 하면 False)
7. MCP 도구라면 `mcp-patterns.md` 의 네이밍 규칙 준수

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| 도구 이름 변경 | agents/*.yaml tools 리스트, 캐시 정렬 순서, 테스트 |
| ToolProtocol 에 메서드 추가 | 모든 도구 구현체 + build_tool defaults + 테스트 |
| `TOOL_PREVIEW_MAX_CHARS` 변경 | context 예산 → compaction threshold 재검토 필요 |
| is_concurrency_safe 로직 변경 | partition 결과 변경 → 병렬/순차 실행 순서 달라짐 |
| validateInput 규칙 추가 | 기존에 통과하던 입력이 막힐 수 있음 |
| tools 정렬 순서 변경 | 모든 세션의 prompt cache 즉시 무효화 |
| 도구 60개 초과 | deferred loading 필요 → ToolSearch 도구 구현 필요 |

## 금지 사항

- `ToolProtocol` 직접 인스턴스 생성 (반드시 `build_tool()` 팩토리 경유)
- `is_concurrency_safe` 를 class 속성으로 고정 (입력 기반 판정 원칙 위반)
- validateInput 내부에서 I/O 또는 부수 효과 (순수 검증만)
- Read 없이 Edit 도구 호출 허용 (mtime 검증 필수)
- 도구 결과를 전체 그대로 context 에 주입 (초과 시 head-truncate + preview)
- `ToolRegistry._tools` 직접 mutate (부팅 후 등록/제거 금지)
- MCP 도구를 `mcp__` prefix 없이 등록 (이름 충돌)
- 도구 정렬 순서 runtime 변경 (prompt cache prefix 무효화)
- `gather` 로 병렬 실행 시 exception 을 swallow (단축 평가 + 예외 전파)

## Tool Output Guardrail (2026-04-25 spec)

모든 tool result 의 content 는 `backend/engine/loop.py::_wrap_tool_result_content`
를 통해 `<tool_output>...</tool_output>` 으로 감싸진 후 LLM messages 에 포함된다.
Spec: `docs/completed/superpowers/specs/2026-04-25-indirect-injection-defense-design.md`.

**핵심 불변식:**
- Wrap 호출 지점은 `_stage_context_merge` 단일 위치 (중복 wrap 방지)
- SSE `tool_result` event 의 `content_preview` 는 raw — 사용자 UI 용
- LLM messages 의 `tool_result` block 의 `content` 는 wrapped — 모델 instruction 공간 분리
- `</tool_output>` 리터럴은 zero-width space 로 escape (tag confusion 차단)
- `is_error=True` 도 동일하게 wrap (에러 메시지도 data 로 간주)
- Tag 이름 (`<tool_output>`) 은 base.md defensive block 과 lockstep — 둘 중 하나만 바꾸면 보호 무효화

**금지:**
- ToolResult 인스턴스 생성 시점에 wrap (호출자가 잊을 위험 + 중앙화 위반)
- providers 의 `_convert_to` 에서 wrap (single point 위반)
- `_wrap_tool_result_content` 를 idempotent 로 가정 (실제로는 idempotent 아님 — 중복 호출 시 중첩됨)
