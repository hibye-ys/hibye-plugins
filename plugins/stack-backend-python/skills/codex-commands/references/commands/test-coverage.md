---
description: Detect test coverage gaps based on recent git changes — finds source files that changed but lack corresponding tests, and offers to scaffold missing tests.
argument-hint: [N (commits to look back, default 10)]
---

Check test coverage for recently changed files.

## Usage

`/test-coverage`         # 최근 10 커밋 기준
`/test-coverage 5`       # 최근 5 커밋 기준
`/test-coverage 20`      # 최근 20 커밋 기준

## Dispatch rule

1. **Load skills**:
   - `test-cleanup` skill — coverage gap detection 로직
   - `testing-infra` skill — conftest 패턴 참조 (scaffold 시)

2. **Get changed source files**:

```bash
N="${ARGUMENTS:-10}"
git diff --name-only HEAD~"$N" -- backend/ | grep -v "tests/" | grep "\.py$" | sort -u
```

3. **For each changed file, check test existence**:

```bash
git diff --name-only HEAD~"$N" -- backend/ | grep -v "tests/" | grep "\.py$" | while read src; do
  module=$(basename "$src" .py)
  # __init__.py, conftest.py 등 제외
  case "$module" in __init__|conftest|__pycache__) continue ;; esac
  test_file="backend/tests/test_${module}.py"
  if [ ! -f "$test_file" ]; then
    echo "NO TEST: $src → expected $test_file"
  else
    # 테스트 파일이 있지만 비어있거나 pass 만 있는 경우
    test_count=$(grep -c "def test_" "$test_file" 2>/dev/null || echo 0)
    if [ "$test_count" -eq 0 ]; then
      echo "EMPTY TEST: $test_file (0 test functions)"
    else
      echo "OK: $src → $test_file ($test_count tests)"
    fi
  fi
done
```

4. **Summary report**:

```markdown
## Test Coverage Report — <date>

### Changed files (last N commits)
- Total: X source files changed
- Covered: Y files have tests
- **Gaps: Z files lack tests**

### Gap details
| Source file | Expected test | Status |
|------------|--------------|--------|
| backend/engine/foo.py | backend/tests/test_foo.py | NO TEST |
| backend/providers/bar.py | backend/tests/test_bar.py | EMPTY (0 tests) |

### Covered files (OK)
| Source file | Test file | Test count |
|------------|-----------|-----------|
| backend/engine/loop.py | backend/tests/test_loop.py | 12 tests |
```

5. **If gaps found, offer scaffold**:

> N개 파일에 테스트가 없습니다. scaffold 생성할까요?
> - `test-scaffold` skill 로 템플릿 생성 (최소 3 시나리오: 성공/실패/경계)
> - `test-manager` (scaffold 모드) 로 더 정교한 테스트 생성

사용자가 "예" 하면 `test-scaffold` skill 로드 후 각 gap 파일에 대해 테스트 생성.

6. **Stop** if user declines scaffold.

## What this command does NOT do

- 테스트를 **실행**하지 않음 — 파일 존재 여부만 확인. 실행은 `/agent-test`
- 커버리지 %를 측정하지 않음 — `pytest --cov` 는 별도 실행
- 기존 테스트의 **품질**을 판단하지 않음 — 품질은 `test-manager` (review 모드)
- git history 가 없는 환경에서 작동 안 함

## When to use

- 커밋 전 — 변경한 파일에 테스트가 있는지 빠르게 확인
- PR 생성 전 — 리뷰어에게 "테스트 어딨어?" 질문 예방
- `/audit-all` 보완 — audit-all 의 Test phase 는 기존 테스트 품질만 봄, 이건 **누락** 탐지

## When to escalate

- 테스트 품질 문제 → `test-manager` (review 모드)
- 레거시 테스트 정리 → `test-manager` (cleanup 모드)
- 버그 수정용 테스트 → `red-green-fix` skill
