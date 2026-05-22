---
name: tool-sort-order
description: Tool API 배열 정렬 순서 (built-in → MCP, 각 그룹 알파벳), is_concurrency_safe 입력 기반 동적 결정, ToolProtocol 8 멤버 invariant.
metadata:
  role: invariant
  scope: project
  source: stack-backend-python/_shared/tool-sort-order.md
---

**적용된 §4.4 매트릭스 행**: 거의 ✕. Python tool 등록 예시 → TS `Map<string, ToolHandler>` 또는 array 형태로 치환.

> Language-neutral invariants — Tool sort order, cache-stable tools array, dynamic safety determination.
> 정본 (single source of truth) for both Python and TS implementations.
> Cited from: `python_agent_rules/tool-system-patterns.md`, `ts_agent_rules/tool-system-patterns.md`,
>             `python_agent_rules/core-infrastructure.md`, `ts_agent_rules/core-infrastructure.md`.

# Tool Sort Order — 언어 무관 불변식

## API `tools` 배열 정렬 순서 (cache prefix 보호)

```
[built-in 이름순] + [MCP 이름순]
```

- 두 그룹 분리 — built-in 먼저, MCP 다음
- 각 그룹 내부는 사전 정렬 (이름 순 ascending)
- MCP 도구는 모두 `mcp__<server>__<tool>` prefix — built-in 과 같은 namespace 에 진입하지 않음
- 이 순서가 Anthropic prompt cache key 의 일부 — 변경 시 모든 세션의 cache 즉시 무효화

이유: 새 도구를 추가해도 기존 cache 가 살아남도록 deterministic 정렬.

TS 구현: 도구는 `Map<string, ToolHandler>` 또는 `ToolHandler[]` 로 관리하되, API 전송 전 반드시 위 순서로 정렬:

```ts
const sortedTools = [
  ...builtinTools.sort((a, b) => a.name.localeCompare(b.name)),
  ...mcpTools.sort((a, b) => a.name.localeCompare(b.name)),
];
```

## is_concurrency_safe — 입력 기반 동적 결정

도구 안전성은 **클래스 속성이 아니라 입력에 따라 동적 결정**:

- 같은 도구도 인자에 따라 read-only 또는 destructive
- 예: `bash` 도구 — `ls /tmp` 은 read-only, `rm -rf` 는 destructive
- 시그니처: `isConcurrencySafe(args: unknown): boolean` / `isReadOnly(args: unknown): boolean`
- 미선언 시 보수적 기본값: **순차 실행 + 쓰기 가정** (`isConcurrencySafe=false`)

## 실행 전 2단계 체크 (의무)

```
validateInput → checkPermissions → call
```

| 단계 | 책임 | 제약 |
|------|------|------|
| `validateInput(args)` | 논리 검증 | I/O 금지, 부수 효과 금지, 순수 함수 |
| `checkPermissions(args, ctx)` | 권한 판정 | `allow` / `ask` / `deny` / `passthrough` 반환 |

두 단계 모두 통과한 도구만 `call(args, ctx)` 진입.

## ToolProtocol 8 멤버 (data 3 + methods 5)

- **data 3**: `name`, `description`, `input_schema`
- **methods 5**: `isConcurrencySafe(args)`, `isReadOnly(args)`, `validateInput(args)`, `checkPermissions(args, ctx)`, `call(args, ctx)`

도구 직접 인스턴스화 금지 — 반드시 `buildTool()` 팩토리 경유 (미선언 필드는 safe default 적용).

## 결과 절단 (head-truncate + preview)

- `TOOL_PREVIEW_MAX_CHARS = 4000` — 도구 결과가 이 길이 초과 시 head-truncate + preview 반환
- 절단 마커: `[truncated, N more chars]`
- 대용량 disk-spill (`tool_result_fetch` 도구로 on-demand 조회) 은 미래 확장 항목 — 현재 미구현

## Read 후 Edit 의무 (mtime guard)

- Read 없이 Edit 도구 호출 금지
- Read 후 외부 변경 감지 (mtime 비교) 시 Edit 거부
- 이유: §1 safe-default 의 예외 — 외부 변경 감지 필요

## 도구 60개 초과 시 deferred loading

- 정렬·캐시 안정성은 도구 수와 무관하게 유지
- 60개 초과 시 모든 정의를 항상 로드하면 token budget 부담 → `ToolSearch` 도구로 on-demand 로딩 검토 필요

## 공통 금지 사항 (언어 무관)

- ToolProtocol 직접 인스턴스 생성 (반드시 `buildTool()` 팩토리 경유)
- `isConcurrencySafe` 를 static 속성으로 고정 (입력 기반 판정 원칙 위반)
- `validateInput` 내부에서 I/O 또는 부수 효과 (순수 검증만)
- Read 없이 Edit 도구 호출 허용 (mtime 검증 필수)
- 도구 결과를 전체 그대로 context 에 주입 (초과 시 head-truncate + preview)
- 도구 registry 직접 mutate (부팅 후 등록/제거 금지)
- MCP 도구를 `mcp__` prefix 없이 등록 (이름 충돌)
- 도구 정렬 순서 runtime 변경 (prompt cache prefix 무효화)
- 병렬 실행 시 exception swallow (단축 평가 + 예외 전파)
