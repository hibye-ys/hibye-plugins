---
name: app-domain-boundary-audit
description: 모듈 추가/이동 후. app-domain-boundary invariant — 코어 (provider/sse/storage 등 generic) 디렉토리에 도메인-specific 어휘 누출 검출 (구체 어휘는 `scripts/forbidden-terms.txt` 정의).
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/data-audit (boundary 부분)
  pair_invariant: app-domain-boundary
---

# app-domain-boundary-audit

## 검증 대상 invariant
[app-domain-boundary/SKILL.md](../app-domain-boundary/SKILL.md)

## 실행

```bash
# 패턴 1: core 모듈에 도메인 어휘
grep -rEn '\b(writer|author|scenario|novel|character|persona)\b' \
  apps/api/src/ai/ apps/api/src/sse/ apps/api/src/storage/ apps/api/src/middleware/

# 패턴 2 (정밀화 — Codex 리뷰): TS import 정확 매치. 기존 `from\s+['"]\.\.\/(ai|sse|storage)/` 는
# `import ... from` 의 `from` 만 매치 (OK). 단 `import type`, `import { ... } from` 변형 모두 cover 위해:
grep -rEn "^import\s+(\{[^}]*\}|[^\s]+|\*\s+as\s+\w+|type\s+\{[^}]*\})\s+from\s+['\"](\.\./)+(ai|sse|storage|middleware)/" \
  apps/api/src/domain/

# 추가: side-effect import (`import './foo'`) 도 검출 (임의 depth)
grep -rEn "^import\s+['\"](\.\./)+(ai|sse|storage|middleware)/" apps/api/src/domain/
```

## 위반 시 조치
1. core 디렉토리 도메인 어휘 발견 → domain/ 레이어로 이동 또는 추상화
2. core → domain 의존 발견 → 의존 방향 역전 (domain → core 단방향 유지)

## 통과 기준
- 패턴 1 — core 디렉토리 도메인 어휘 ✕ (또는 명시 사유 주석)
- 패턴 2 — domain → core 단방향만, core → domain 의존 ✕
