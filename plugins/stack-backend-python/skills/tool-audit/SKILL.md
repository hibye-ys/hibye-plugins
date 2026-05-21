---
name: tool-audit
description: Operational checklist + grep patterns for auditing `backend/tools/` registry health, MCP naming, and concurrency annotations. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/tool-system-patterns.md` and `mcp-patterns.md`. Load this skill to detect build_tool bypasses, sort-order instability, and permission-check gaps.
allowed-tools: Read, Bash, Grep, Glob
---

# tool-audit — 도구 시스템 감사 실행 가이드

## 이 skill은 언제 로드되는가

- `tools-manager` sub-agent 호출 시 (tool-audit / mcp-audit 모드)
- `backend/tools/` 파일 변경 후 빠른 정합성 점검
- MCP 도구 추가 후 네이밍/등록 검증 필요 시

## 이 skill은 언제 로드되지 않는가

- 새 도구 구현 (→ `tool-system` skill)
- MCP 서버 연결 설정 (→ `mcp-integration` skill)
- 미디어 파이프라인 감사 (→ `media-pipeline-patterns` rule 직접)

## 원칙은 Rule 에 있다

**불변식 / 정렬 순서 / permission 체인** 은
`.agents/rules/python_agent_rules/tool-system-patterns.md` 에,
**MCP 네이밍 / 5-state / delta instructions** 은
`.agents/rules/python_agent_rules/mcp-patterns.md` 에 정의됨.

## 1. build_tool 팩토리 경유 검증

```bash
# ToolProtocol 직접 인스턴스 생성 (VIOLATION — build_tool 경유해야 함)
rg -n "ToolProtocol\(\|Tool\(" backend/tools/ | rg -v "build_tool\|import\|Protocol\|isinstance"

# build_tool 사용 현황
rg -n "build_tool" backend/tools/
```

## 2. is_concurrency_safe 입력 기반 판정

```bash
# class 속성으로 고정된 경우 (VIOLATION — 입력 기반이어야 함)
rg -n "is_concurrency_safe\s*=" backend/tools/ | rg -v "def \|args\|input"

# 올바른 패턴: 메서드로 정의 + args 참조
rg -n "def is_concurrency_safe" backend/tools/
```

## 3. validateInput / checkPermissions 2단계

```bash
# 도구 파일에서 validate + permission 체크 존재 여부
for f in backend/tools/*.py; do
  name=$(basename "$f" .py)
  [ "$name" = "__init__" ] || [ "$name" = "registry" ] || [ "$name" = "base" ] && continue
  has_validate=$(rg -c "validate_input\|validateInput" "$f" 2>/dev/null || echo 0)
  has_perm=$(rg -c "check_permissions\|checkPermissions" "$f" 2>/dev/null || echo 0)
  echo "$name: validate=$has_validate perm=$has_perm"
done
```

## 4. 정렬 순서 안정성 (cache prefix)

```bash
# 도구 정렬 로직: built-in 이름순 → MCP 이름순
rg -n "sort\|sorted\|order" backend/tools/registry.py

# MCP 도구가 built-in 뒤에 배치되는지
rg -n "mcp__" backend/tools/registry.py
```

## 5. MCP 네이밍 규칙

```bash
# mcp__ prefix 없는 MCP 도구 등록 (VIOLATION)
rg -n "register\|add_tool" backend/tools/registry.py | rg -i "mcp" | rg -v "mcp__"

# mcp__<server>__<tool> 패턴 준수
rg -n "mcp__" backend/tools/ backend/services/mcp/
```

## 6. 결과 크기 초과 정책

```bash
# max_result_size 관련 처리
rg -n "max_result_size\|result.*truncat\|disk.*preview" backend/tools/

# 전체 결과를 context 에 그대로 주입하는 경로 (VIOLATION 후보)
rg -n "tool_result\|return.*result" backend/tools/ | rg -v "truncat\|preview\|max_"
```

## 7. ToolRegistry 런타임 mutate 방지

```bash
# 부팅 후 등록/제거 시도 (VIOLATION)
rg -n "_tools\[|_tools\.pop\|_tools\.clear\|del _tools" backend/ -g '!backend/tests/*'
```

## 리포트 템플릿

```markdown
## Tool Audit — <date>

### build_tool factory
- [OK/FAIL] All tools created via build_tool

### Concurrency annotation
- [OK/FAIL] is_concurrency_safe is input-based method, not class attribute

### Permission checks
- [OK/FAIL] All tools implement validate + check_permissions
- [MISSING] <tool_name> lacks <validate|permissions>

### Sort order
- [OK/FAIL] built-in (name-sorted) → MCP (name-sorted)

### MCP naming
- [OK/FAIL] All MCP tools use mcp__<server>__<tool> pattern

### Result size
- [OK/FAIL] Oversize results stored to disk + preview

### Registry immutability
- [OK/FAIL] No runtime mutation of _tools after boot
```

## 의존 파일

- `.agents/rules/python_agent_rules/tool-system-patterns.md` — 도구 불변식
- `.agents/rules/python_agent_rules/mcp-patterns.md` — MCP 불변식
- `backend/tools/registry.py` — ToolRegistry
- `backend/tools/base.py` — ToolProtocol + build_tool

## 검증 체크리스트

- [ ] 7개 grep 블록 모두 실행
- [ ] 매치된 위반을 리포트 카테고리에 배치
- [ ] rule 참조로 위반 근거 제시
- [ ] 도구 총 수 및 MCP 도구 수 보고

## 구현 중 막히면

- `backend/tools/` 없음 → NOT_YET_IMPLEMENTED
- registry.py 구조 파악 안 됨 → `get_symbols_overview` 로 먼저 확인
- MCP 도구 0개 → "MCP not yet integrated" 보고, 나머지 체크만 실행
