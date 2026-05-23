---
name: app-domain-boundary-audit
description: 모듈 추가/이동 후. app-domain-boundary invariant — 코어 (provider/sse/storage 등 generic) 디렉토리에 도메인-specific 어휘 누출 검출 (구체 어휘는 `scripts/forbidden-terms.txt` 정의).
metadata:
  role: audit
  scope: project
  pair_invariant: app-domain-boundary
---

# app-domain-boundary-audit

## 검증 대상 invariant
[app-domain-boundary/SKILL.md](../app-domain-boundary/SKILL.md)

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 모든 패턴은 *file-level grep* — block-level / AST 검증 의무 ✕. PASS 출력은 *부분 신뢰* 만 의미. 정확한 invariant 준수 검증은 paired invariant SKILL.md 의 ## 실행 섹션 + 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: core 모듈에 `<domain entity>` 어휘 누출
# DOMAIN_VOCAB envvar 는 instance 측에서 정의 (pipe-separated alternation, regex-safe 단어만):
#   - iyaki 프로젝트 예: export DOMAIN_VOCAB='writer|author|scenario|novel|character|persona'
#   - blog 프로젝트 예: export DOMAIN_VOCAB='post|comment|tag|category'
#   - commerce 프로젝트 예: export DOMAIN_VOCAB='order|product|cart|item|customer'
# envvar 미정의 시 본 audit 는 SKIP 처리 (`audit-all.sh` 12번 블록 fallback 참조)
: "${DOMAIN_VOCAB:?DOMAIN_VOCAB envvar 미정의 — instance 측에서 export 필요}"

# NOTE: 스캔 디렉토리는 [[backend-overview]] §"디렉토리 구조" + §"Sub-area 변형" 정본 화이트리스트와 동기 —
# 기본 + sub-area 변형 (providers/db/agents/runs top-level) 모두 포함
grep -rEn "\b(${DOMAIN_VOCAB})\b" \
  <api-app>/src/routes/ <api-app>/src/ai/ <api-app>/src/sse/ <api-app>/src/storage/ \
  <api-app>/src/middleware/ <api-app>/src/providers/ <api-app>/src/db/ <api-app>/src/engine/ \
  <api-app>/src/tools/ <api-app>/src/context/ <api-app>/src/mcp/ <api-app>/src/utils/ \
  <api-app>/src/agents/ <api-app>/src/runs/ <api-app>/src/types/ 2>/dev/null

# 패턴 2 (정밀화 — Codex 리뷰): TS import 정확 매치. 기존 `from\s+['"]\.\.\/(ai|sse|storage)/` 는
# `import ... from` 의 `from` 만 매치 (OK). 단 `import type`, `import { ... } from` 변형 모두 cover 위해:
grep -rEn "^import\s+(\{[^}]*\}|[^\s]+|\*\s+as\s+\w+|type\s+\{[^}]*\})\s+from\s+['\"](\.\./)+(routes|ai|sse|storage|middleware|providers|db|engine|tools|context|mcp|utils|agents|runs|types)/" \
  <api-app>/src/domain/

# 추가: side-effect import (`import './foo'`) 도 검출 (임의 depth)
grep -rEn "^import\s+['\"](\.\./)+(routes|ai|sse|storage|middleware|providers|db|engine|tools|context|mcp|utils|agents|runs|types)/" <api-app>/src/domain/
```

## 위반 시 조치
1. core 디렉토리 `<domain entity>` 어휘 발견 → `domain/` 레이어로 이동 또는 추상화
2. core → domain 의존 발견 → 의존 방향 역전 (domain → core 단방향 유지)

## 통과 기준
- 패턴 1 — core 디렉토리 `<domain entity>` 어휘 (`${DOMAIN_VOCAB}` 매치) ✕ (또는 명시 사유 주석)
- 패턴 2 — domain → core 단방향만, core → domain 의존 ✕

## Placeholder 해석

`<domain entity>` 어휘 alternation 은 instance 측에서 `DOMAIN_VOCAB` envvar 로 정의:
- iyaki 프로젝트 예: `DOMAIN_VOCAB='writer|author|scenario|novel|character|persona'`
- blog 프로젝트 예: `DOMAIN_VOCAB='post|comment|tag|category'`
- commerce 프로젝트 예: `DOMAIN_VOCAB='order|product|cart|item|customer'`
- 다른 instance: 자체 CI/CLAUDE.md 에 `DOMAIN_VOCAB` 매핑 명시
- 미정의 시: `scripts/audit-all.sh` 12번 블록은 `SKIP` 출력 (audit fail 아님)
