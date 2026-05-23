---
name: mcp-namespace-audit
description: MCP 서버 추가 후. namespace prefix 규칙 위반·충돌 검출.
metadata:
  role: audit
  scope: project
  pair_invariant: mcp-namespace
---

# mcp-namespace-audit

## 검증 대상 invariant
[mcp-namespace/SKILL.md](../mcp-namespace/SKILL.md)

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 모든 패턴은 *file-level grep* — block-level / AST 검증 의무 ✕. PASS 출력은 *부분 신뢰* 만 의미. 정확한 invariant 준수 검증은 paired invariant SKILL.md 의 ## 실행 섹션 + 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: MCP tool 등록 시 namespace prefix 누락
grep -rEn 'mcp.*?register|mcpClient\.tool' <api-app>/src/mcp/ -A 5

# 패턴 2: namespace 중복 (다른 서버가 같은 prefix)
grep -rhoE "prefix:\\s*['\"]([^'\"]+)['\"]" <api-app>/src/mcp/ \
  | sed -E "s/^prefix:[[:space:]]*['\"]([^'\"]+)['\"].*/\1/" \
  | sort | uniq -d

# 패턴 3: tool name 이 mcp__<server>__<tool> 형식인지
grep -rhoEn "name:\\s*['\"]([^'\"]+)['\"]" <api-app>/src/mcp/ \
  | sed -E "s/.*name:[[:space:]]*['\"]([^'\"]+)['\"].*/\1/" \
  | while read -r name; do
      echo "$name" | grep -qE '^mcp__[a-z0-9_]+__[a-z0-9_]+$' || echo "wrong-format: $name"
    done
```

## 위반 시 조치
1. prefix 누락 → tool 등록 시 `prefix: '<server-name>'` 명시 추가
2. prefix 중복 → 충돌 서버 중 하나의 prefix 변경

## 통과 기준
- 패턴 1 = 모든 등록이 prefix 명시
- 패턴 2 match 0건 (prefix 중복 ✕)
- 패턴 3 = 모든 name 이 `mcp__<server>__<tool>` 형식
