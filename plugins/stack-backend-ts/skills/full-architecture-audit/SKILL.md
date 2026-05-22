---
name: full-architecture-audit
description: 대규모 리팩토링 후 또는 정기 점검 시 invoke. 25 audit 일괄 실행 + 디렉토리 구조 정합 + madge import cycle ✕ + spec §11 4-layer 경계를 통합 검증. deploy 전 체크의 6-step 체인 안에서도 호출됨 (instance 측 project-local skill 참조).
metadata:
  role: audit
  scope: project
---

# full-architecture-audit — 통합 architecture audit

## 검증 대상 invariant

`<api-app>/src/` 의 4가지 정합성을 한 번에 점검:

1. **25 audit 모두 통과** — `scripts/audit-all.sh` 가 0 violation 으로 종료
2. **디렉토리 구조** — `src/` 직속 디렉토리는 [[backend-overview]] §"디렉토리 구조" 정본 화이트리스트만 허용: `routes` / `ai` / `sse` / `tools` / `context` / `engine` / `mcp` / `middleware` / `storage` / `types` / `utils` + sub-area 변형 (`agents` / `runs` / `providers` / `db`) + `index.ts`
3. **import cycle ✕** — `madge --circular` 결과 0
4. **spec §11 4-layer 경계** — `routes ← services ← providers ← db` 방향. 역참조 ✕ (app-domain-boundary-audit 와 보완)

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 는 *통합 audit* — 패턴 1 (`audit-all.sh` 일괄), 패턴 2 (디렉토리 화이트리스트 grep), 패턴 3 (`madge --circular` AST 의존성 분석), 패턴 4 (4-layer 역참조 grep) 의 혼합. `audit-all.sh` 자체가 다른 21 audit 의 *문턱 검사* 만 — 그 21개 각자의 FAIL-SAFE 가 또 적용됨. madge / 디렉토리 list / 4-layer grep 도 각자 한계 (madge 는 동적 import 미커버, 디렉토리 list 는 sub-area 변형 정합성 검증 ✕). PASS 출력은 *부분 신뢰* 만 — 정확한 검증은 각 sub-audit 의 ## 실행 + 수동 review 의무.

## 실행

```bash
# 패턴 1: 25 audit 통합 (scripts/audit-all.sh 가 본 plugin scripts/ 안에 있다고 가정)
bash plugins/stack-backend-ts/scripts/audit-all.sh <api-app>

# 패턴 2: 디렉토리 구조 정합 — 화이트리스트 외 디렉토리 검출
# 화이트리스트 = [[backend-overview]] §"디렉토리 구조" 정본 + sub-area 변형
ls <api-app>/src/ 2>/dev/null \
  | grep -vE "^(routes|ai|sse|tools|context|engine|mcp|middleware|storage|types|utils|agents|runs|providers|db|index\.ts)$"

# 패턴 3: import cycle — madge (devDependency)
pnpm exec madge --circular --extensions ts <api-app>/src/ 2>/dev/null || \
  npx madge --circular --extensions ts <api-app>/src/

# 패턴 4: spec §11 4-layer 위반 — db 에서 routes import (역참조)
grep -rE "from\s+['\"](?:\.\./)+routes" <api-app>/src/db/ <api-app>/src/providers/ 2>/dev/null
```

## 통과 기준

- 패턴 1: `audit-all.sh` exit code = 0 (총 violations 0, 25 audit)
- 패턴 2: 출력 0줄 (화이트리스트 외 디렉토리 ✕)
- 패턴 3: `No circular dependency found` 또는 madge 종료 0
- 패턴 4: 출력 0줄 (역참조 ✕)

## 위반 시 조치

### 패턴 1 위반 — 25 audit 중 일부 실패

각 audit SKILL.md 의 `## 위반 시 조치` 섹션 따라 개별 수정. `audit-all.sh` 출력은 각 audit name + violation count 보고.

### 패턴 2 위반 — 화이트리스트 외 디렉토리

- 새 도메인 디렉토리 추가가 필요하면 spec §11 4-layer 재논의 후 화이트리스트 확장 (plugin CLAUDE.md + 본 audit 동시 수정)
- 임시 작업 디렉토리면 제거 또는 `.gitignore`

### 패턴 3 위반 — import cycle

```typescript
// 위반 예시: A ↔ B 순환
// src/services/user.ts
import { logEvent } from '@/services/audit'

// src/services/audit.ts
import { getCurrentUser } from '@/services/user'  // ← cycle
```

조치:
- 공통 의존성을 새 모듈로 추출 (예: `src/services/types.ts`)
- 또는 한쪽에서 의존성 주입 (DI) 패턴으로 분리

### 패턴 4 위반 — 4-layer 역참조

- `db/` 또는 `providers/` 에서 `routes/` import 발견 시 — 비즈니스 로직이 잘못된 layer 에 있음
- 해당 함수를 `services/` 또는 `routes/` 안으로 이동

---

## audit 이 커버하지 않는 것

- *runtime* 정합성 (배포 직후 health / SSE 동작) → runtime 검증 (instance 측 project-local skill 참조)
- 의존성 CVE / runtime 호환성 → `dependency-scanning`
- secret / SSRF / injection → `security-audit-check`
