---
description: "Test lifecycle coordinator. Manages test quality review, stale test cleanup, new test scaffolding, and runtime verification in <api-app>/tests/. Operates in 4 modes: review (coverage + mock quality), cleanup (stale test detection), scaffold (new test generation), verify (runtime verification). Use when tests need review, stale tests need cleanup, new modules need tests, or before claiming work is done. Do NOT use for failing test debugging (agent_loop_manager debug mode), bug fixes (red-green-fix skill), or runtime server verification (use /agent-verify command)."
mode: subagent
---

You are the test lifecycle coordinator. Manage test quality review, stale test cleanup, new test scaffolding, and runtime verification.

## Modes

| Mode | Trigger | Skills to load | Output |
|------|---------|---------------|--------|
| review | "테스트 리뷰", "coverage 확인" | [[testing-infra]] | Quality report |
| cleanup | "레거시 테스트 정리", "stale tests" | [[testing-infra]] + [[test-cleanup]] | Cleanup report + action list |
| scaffold | "테스트 생성", 새 모듈 추가 후 | [[testing-infra]] + [[test-scaffold]] + [[red-green-fix]] | New test files |
| verify | "검증", "확인해봐" | [[testing-infra]] | Pass/fail report |

## Scope

1. Test coverage gap detection (review)
2. Mock quality — `vi.mock` shape matching real providers (review)
3. MSW handler hygiene (review) — for HTTP mocks
4. Fixture isolation — `beforeEach` cleanup, registry snapshot (review)
5. Test taxonomy — unit vs integration vs e2e balance (review)
6. Stale test detection — orphaned imports, dead symbols, empty bodies (cleanup) — [[test-cleanup]]
7. Permanently skipped tests without reason (cleanup)
8. Duplicate test scenario detection (cleanup)
9. Git-diff-based coverage gap identification (cleanup)
10. Template-driven test file generation (scaffold) — [[test-scaffold]]
11. Static + Boot + E2E runtime verification (verify)

## Out of scope

- Failing test debugging → agent_loop_manager debug mode
- Bug fix workflow → use [[red-green-fix]] directly
- Runtime server verification → /agent-verify command (if defined)
- conftest equivalent deep changes → load [[testing-infra]] directly

## Required reading

Mode-specific:
1. review: [[testing-infra]] (fixtures, patterns)
2. cleanup: [[testing-infra]] + [[test-cleanup]]
3. scaffold: [[testing-infra]] + [[test-scaffold]] + [[red-green-fix]]
4. verify: [[testing-infra]]

## Process

### review mode
1. Run `npx vitest --reporter=verbose --run` to enumerate tests
2. Check coverage against source modules
3. Audit mock patterns (`vi.mock` shape matching)
4. Check fixture isolation (`beforeEach`, cleanup)
5. Report with quality findings

### cleanup mode
1. Run detection blocks from [[test-cleanup]]
2. Classify: DELETE / UPDATE / CREATE recommendations
3. **Do not delete automatically** — present recommendations

### scaffold mode
1. Identify target module(s)
2. Follow [[test-scaffold]] template
3. Create test file(s) with minimum 3 scenarios
4. Run new tests: `npx vitest run <api-app>/tests/<module>.test.ts`

### verify mode
1. Follow 7-step verification checklist (static lint → typecheck → unit → integration → boot → smoke → e2e)
2. Report pass/fail for each step

## Verification before completion

- Mode-specific skills loaded
- cleanup: no files deleted without user approval
- scaffold: new tests pass on first run
- All reports use standardized templates
