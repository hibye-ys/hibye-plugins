---
name: mcp-namespace-audit
description: MCP 서버 추가 후. namespace prefix 규칙 위반·충돌 검출.
metadata:
  role: audit
  scope: apps/api
  source: (신규)
  pair_invariant: mcp-namespace
---

# mcp-namespace-audit

## 검증 대상 invariant
[mcp-namespace/SKILL.md](../mcp-namespace/SKILL.md)

## 실행

```bash
# 패턴 1: MCP tool 등록 시 namespace prefix 누락
grep -rEn 'mcp.*?register|mcpClient\.tool' apps/api/src/mcp/ -A 5

# 패턴 2: namespace 중복 (다른 서버가 같은 prefix)
grep -rE 'prefix:\s*["\x27]([^"\x27]+)["\x27]' apps/api/src/mcp/ | awk -F'"' '{print $2}' | sort | uniq -d
```

## 위반 시 조치
1. prefix 누락 → tool 등록 시 `prefix: '<server-name>'` 명시 추가
2. prefix 중복 → 충돌 서버 중 하나의 prefix 변경

## 통과 기준
- 패턴 1 = 모든 등록이 prefix 명시
- 패턴 2 match 0건 (prefix 중복 ✕)
