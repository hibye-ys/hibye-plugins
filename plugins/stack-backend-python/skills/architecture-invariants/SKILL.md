---
name: architecture-invariants
description: Operational checklist + grep patterns for auditing `backend/` layer boundaries. Used by architecture-reviewer sub-agent. Does NOT restate invariants — those live in `.agents/rules/python_agent_rules/architecture.md`. Load this skill to get executable commands for detecting import-direction violations, single writer single-writer bypasses, and circular-import risk.
allowed-tools: Read, Grep, Glob, Bash
---

# architecture-invariants — 계층 감사 실행 가이드

## 이 skill은 언제 로드되는가

- `architecture-reviewer` sub-agent 호출 시 자동
- `backend/` 파일의 import 구조를 빠르게 grep 하고 싶을 때
- "계층 위반 있나?" 빠른 확인 필요 시

## 원칙은 Rule 에 있다

**불변식 / 계층 방향 / 금지 사항 / 영향도** 는 모두
`.agents/rules/python_agent_rules/architecture.md` 에 정의됨. 본 skill 은
**그 rule 을 기계적으로 체크하는 커맨드** 만 제공한다. 원칙 설명을 여기서
반복하지 않는다 — 충돌 시 rule 이 authoritative.

## 1. Import 방향 위반 탐지

각 계층별로 "역방향 import" 가 있는지 grep:

```bash
# providers → engine / routes / services (역방향 = VIOLATION)
rg -n "^from backend\.(engine|routes|services|tools|agents|state)" backend/providers/

# engine → routes (역방향)
rg -n "^from backend\.routes" backend/engine/

# tools → engine (역방향)
rg -n "^from backend\.engine" backend/tools/

# data → 모든 상위 (data 는 외부 의존 없음)
rg -n "^from backend\.(engine|routes|services|tools|agents|state|lsp)" backend/data/

# agents → 다른 계층 (agents 는 순수 config/prompt)
rg -n "^from backend\." backend/agents/ | rg -v "^backend/agents/"
```

각 명령이 매치를 반환하면 VIOLATION 리스트에 추가.

## 2. 단일 작성자 (single writer) 우회 탐지

현재 single-writer 불변식의 **scope 는 `data/media/**` 만** —
`data/user-state/**` 개념은 2026-04 에 폐기됨 (`data-layer-patterns.md:86`).
따라서 `data/user-state/` 패턴이 코드에 남아있으면 VIOLATION 이자 구개념 drift.

```bash
# data/media/** 직접 write — WriteCoordinator 우회 (VIOLATION)
rg -n "\.write_text|\.write_bytes" backend/ -g '!backend/data/writer.py' \
  | rg "data/media"

rg -n "Path\([^)]*data/media" backend/ \
  | rg -v "backend/data/writer\.py"

rg -n 'open\([^)]*["\047][wax]' backend/ -g '!backend/data/writer.py' \
  | rg "data/media"

# 구개념 drift 탐지 (있으면 VIOLATION)
rg -n "data/user-state" backend/ .agents/
```

모든 매치 = VIOLATION. `data/user-state` 매치는 구개념 drift 로
별도 카테고리에 배치.

## 3. 순환 Import 위험 탐지

```bash
# TYPE_CHECKING 안에 있지만 runtime isinstance/cast 에 쓰이는지
rg -n "TYPE_CHECKING" backend/ -A 5

# 함수 내부 import (cycle 회피 hack 의심)
rg -n "^\s{4,}from backend\." backend/ --multiline

# 실제 순환 시도 (부팅 smoke)
python -c "import backend.main" 2>&1 | rg -i "circular|partially initialized"
```

## 4. 파일 레이어 불일치 빠른 체크

```bash
# provider-specific type 이 engine 에 누출?
rg -n "anthropic\.|openai\.|google\.|litellm\." backend/engine/

# FastAPI 타입이 engine 에 누출?
rg -n "fastapi|starlette" backend/engine/ backend/tools/ backend/providers/

# SDK 타입이 routes 에 직접 노출?
rg -n "anthropic\.types|openai\.types" backend/routes/
```

## 5. 리포트 템플릿

```markdown
## Architecture Review — <date>

### Import direction
- [file:line] <from layer> → <to layer> (violation)

### Single writer (data/media/**)
- [file:line] direct write to data/media/..., should route through backend/data/writer.py::WriteCoordinator

### Retired concept drift
- [file:line] reference to data/user-state (retired per data-layer-patterns.md:86)

### Circular import
- [file:line] TYPE_CHECKING import used at runtime (<symbol>)

### Layer misplacement
- [file:line] <external type> leaked into <wrong layer>

### Clean summary
- N files audited, M layers, K arrows checked
```

## 의존 파일

- `.agents/rules/python_agent_rules/architecture.md` — 불변식 원본
- `.agents/rules/python_agent_rules/data-layer-patterns.md` — 미디어 single-writer scope
- `.agents/skills/backend-overview/` — 서브시스템 파일 맵 (subsystem-NN 캡슐은 2026-04 Step C 재작성 진행 중 — 구개념 잔존 가능)
- `AGENTS.md` — "서브시스템 매핑 (Layer 1 core)" 표 (13 항목) — 권위있는 파일↔서브시스템 매핑

## 검증 체크리스트

- [ ] 5 개 grep 블록 모두 실행
- [ ] 매치된 모든 line 을 리포트 카테고리에 배치
- [ ] `architecture.md` rule 참조로 위반 근거 제시
- [ ] No-op 인 경우에도 "0 violations, X arrows checked" 로 coverage 증명
- [ ] 원칙 설명 반복 금지 (rule 링크로 대체)

## 구현 중 막히면

- `backend/` 존재 안 함 → NOT_YET_IMPLEMENTED, 초기 부팅 전 상태로 보고
- grep 명령이 너무 많은 매치 → subsystem 단위로 좁히기 (`backend/engine/` 만 등)
- TYPE_CHECKING 블록이 legitimate → runtime 사용처 없음 확인 후 SKIP
