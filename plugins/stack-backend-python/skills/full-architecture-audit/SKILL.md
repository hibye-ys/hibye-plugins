---
name: full-architecture-audit
description: Orchestration skill that runs 3 architecture checks in sequence (layer boundaries → spec drift → rule integrity) and produces a unified report. Load this skill for comprehensive architecture validation before phase transitions or major releases.
allowed-tools: Read, Bash, Grep, Glob
---

# full-architecture-audit — 아키텍처 종합 감사 오케스트레이션

## 이 skill은 언제 로드되는가

- `architecture-validator` sub-agent 호출 시 (full 모드)
- Phase 전환 전 종합 아키텍처 점검
- 대규모 리팩터링 후 전체 정합성 확인

## 이 skill은 언제 로드되지 않는가

- 단일 모드 감사 (→ 각 하위 skill 직접 로드)
- 코드 구현 작업 (→ 해당 서브시스템 skill)
- 런타임 디버깅 (→ `debug-session` skill)

## 오케스트레이션 순서 (고정)

3단계를 **순서대로** 실행. 앞 단계 결과가 뒤 단계 판단에 영향.

### Phase 1: Layer Boundaries (→ `architecture-invariants` skill)

```
1. architecture-invariants skill 로드
2. 5개 grep 블록 실행 (import 방향, single writer, 순환, layer 불일치, SDK 누출)
3. 위반 목록 수집 → Phase 1 결과
```

### Phase 2: Spec Drift (→ `spec-diff-auditor` 에이전트 제안)

```
1. AGENTS.md 서브시스템 매핑 테이블 과 backend/ 구현 비교
2. MISSING / EXTRA / RENAMED 분류
3. drift 목록 수집 → Phase 2 결과
참고: 서브시스템별 상세는 /spec-diff <subsystem> 사용 제안
```

### Phase 3: Rule Integrity (→ `rule-linting` skill)

```
1. rule-linting skill 로드
2. .agents/rules/python_agent_rules/*.md 구조 검증
3. 4-section 누락 (예외 파일 제외), cross-reference 깨짐, invariant 충돌 탐지
4. 결과 수집 → Phase 3 결과
```

## 빠른 실행 (skill 직접 체크)

에이전트 호출 없이 skill 만으로 빠르게 체크하는 축약 경로:

```bash
# Phase 1: Import 방향 (architecture-invariants 핵심 3개)
rg -n "^from backend\.(engine|routes|services)" backend/providers/
rg -n "^from backend\.routes" backend/engine/
rg -n "^from backend\.engine" backend/tools/

# Phase 1.1: single writer 단일 작성자 (data/media 직접 쓰기 탐지)
rg -n "\.write_text|\.write_bytes" backend/ -g '!backend/data/writer.py' -g '!backend/tests/*' | rg "data/media"

# Phase 2: 주요 모듈 존재 확인 (AGENTS.md 서브시스템 테이블 기준)
for m in loop context stream compaction subagent; do
  test -f "backend/engine/$m.py" && echo "OK: $m" || echo "MISSING: $m"
done

# Phase 3: Rule 4-section 구조 (예외: design-principles, commit-rules, coding-standards)
for f in .agents/rules/python_agent_rules/*.md; do
  base=$(basename "$f")
  case "$base" in
    design-principles.md|commit-rules.md|coding-standards.md) continue ;;
  esac
  has_inv=$(rg -c "## 불변식|## Invariants" "$f" 2>/dev/null || echo 0)
  has_ext=$(rg -c "## 새.*추가|## Extension" "$f" 2>/dev/null || echo 0)
  has_imp=$(rg -c "## 영향도|## Impact" "$f" 2>/dev/null || echo 0)
  has_forb=$(rg -c "## 금지|## Forbidden" "$f" 2>/dev/null || echo 0)
  total=$((has_inv + has_ext + has_imp + has_forb))
  [ "$total" -lt 4 ] && echo "INCOMPLETE: $base ($total/4 sections)"
done
```

## 통합 보고서 템플릿

```markdown
## Full Architecture Audit — <date>

### Executive Summary
- Phase 1 (Layer): <N> violations
- Phase 2 (Spec drift): <N> items (MISSING: <N>, EXTRA: <N>, RENAMED: <N>)
- Phase 3 (Rules): <N> integrity issues

### Phase 1: Layer Boundaries
| # | File:Line | Violation | Rule |
|---|-----------|-----------|------|
| 1 | ... | reverse import providers → engine | architecture.md |

### Phase 2: Spec Drift
| # | Subsystem | Type | AGENTS.md | Implementation |
|---|-----------|------|-----------|---------------|
| 1 | Agent Loop | MISSING | recovery.py | not found |

### Phase 3: Rule Integrity
| # | Rule File | Issue |
|---|-----------|-------|
| 1 | ... | missing ## 금지 사항 section |

### Recommendations
1. [CRITICAL] ...
2. [HIGH] ...
3. [MEDIUM] ...
```

## 의존 파일

- `.agents/skills/architecture-invariants/` — Phase 1 실행
- `.agents/skills/rule-linting/` — Phase 3 실행
- `.claude/agents/spec-diff-auditor.md` — Phase 2 위임
- `AGENTS.md` — 서브시스템 매핑 테이블 (Phase 2 기준)

## 검증 체크리스트

- [ ] 3 Phase 순서대로 실행
- [ ] 각 Phase 결과를 통합 보고서에 병합
- [ ] CRITICAL 항목은 즉시 알림
- [ ] 이전 audit 대비 개선/악화 비교 (가능한 경우)

## 구현 중 막히면

- Phase 1~3 중 하나 실패 → 나머지 계속 실행, 실패 Phase 는 "SKIPPED" 표시
- AGENTS.md 서브시스템 테이블 없음 → Phase 2 skip
- rules/ 없음 → Phase 3 skip
