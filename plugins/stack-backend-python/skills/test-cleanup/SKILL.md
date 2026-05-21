---
name: test-cleanup
description: Checklist + grep patterns for detecting stale, orphaned, or redundant tests in `backend/tests/`. Load this skill to find tests referencing deleted symbols, duplicate scenarios, permanently-skipped tests, and git-diff-based coverage gaps.
allowed-tools: Read, Bash, Grep, Glob
---

# test-cleanup — 레거시 테스트 정리 가이드

## 이 skill은 언제 로드되는가

- `test-manager` sub-agent 호출 시 (cleanup 모드)
- 대규모 리팩터링 후 테스트 정리 필요 시
- "테스트가 너무 많아서 뭘 지워야 할지 모르겠다" 상황

## 이 skill은 언제 로드되지 않는가

- 테스트 실패 디버깅 (→ `debug-session` skill)
- 새 테스트 생성 (→ `test-scaffold` skill)
- conftest / fixture 패턴 이해 (→ `testing-infra` skill)

## 1. 삭제된 심볼을 참조하는 테스트

```bash
# 테스트에서 import 하는 심볼이 소스에 존재하는지
rg -n "^from backend\." backend/tests/ | while IFS=: read file line content; do
  module=$(echo "$content" | sed 's/from \(backend\.[^ ]*\).*/\1/' | tr '.' '/')
  symbol=$(echo "$content" | sed 's/.*import \([A-Za-z_]*\).*/\1/')
  if [ -n "$symbol" ] && [ "$symbol" != "*" ]; then
    rg -q "$symbol" "${module}.py" 2>/dev/null || echo "ORPHAN: $file:$line imports $symbol (not found in ${module}.py)"
  fi
done 2>/dev/null | head -30
```

## 2. 영구 skip 된 테스트

```bash
# @pytest.mark.skip 이 reason 없이 방치된 것
rg -n "@pytest.mark.skip" backend/tests/ | rg -v "reason="

# skipIf 조건이 항상 True 인 것 (수동 확인 필요)
rg -n "@pytest.mark.skipIf\|@pytest.mark.skip(" backend/tests/
```

## 3. 빈 테스트 함수

```bash
# pass 만 있는 테스트
rg -n "def test_" backend/tests/ -A 2 | rg -B 1 "^\s*pass$"

# ... (Ellipsis) 만 있는 테스트
rg -n "def test_" backend/tests/ -A 2 | rg -B 1 "^\s*\.\.\.$"
```

## 4. 중복 시나리오 탐지

```bash
# 같은 함수 이름이 여러 파일에 존재
rg -n "^def test_\|^    def test_" backend/tests/ | \
  sed 's/.*def //' | sed 's/(.*$//' | sort | uniq -d | head -20
```

## 5. 소스 없는 테스트 파일

```bash
# test_<module>.py 에 대응하는 backend/<module>.py 가 없는 경우
for f in backend/tests/test_*.py; do
  module=$(basename "$f" | sed 's/^test_//' | sed 's/\.py$//')
  found=$(find backend/ -name "${module}.py" -not -path "backend/tests/*" 2>/dev/null | head -1)
  [ -z "$found" ] && echo "ORPHAN FILE: $f (no matching ${module}.py)"
done
```

## 6. Git diff 기반 커버리지 갭

```bash
# 최근 변경된 소스 파일에 대응하는 테스트가 있는지
git diff --name-only HEAD~10 -- backend/ | rg -v "tests/" | while read src; do
  module=$(basename "$src" .py)
  test -f "backend/tests/test_${module}.py" || echo "NO TEST: $src changed but backend/tests/test_${module}.py missing"
done
```

## 리포트 템플릿

```markdown
## Test Cleanup Report — <date>

### Orphaned imports (dead symbol references)
- <file:line> imports <symbol> not found in source

### Permanently skipped
- <file:line> @skip without reason

### Empty tests
- <file:line> test body is pass/...

### Duplicates
- <test_name> defined in N files

### Orphaned files
- <test_file> has no matching source module

### Coverage gaps (recent changes)
- <source_file> changed but no test file exists

### Recommended actions
- DELETE: <files> (orphaned, no value)
- UPDATE: <files> (stale imports)
- CREATE: <files> (coverage gaps)
```

## 검증 체크리스트

- [ ] 6개 탐지 블록 실행
- [ ] 각 결과를 리포트 카테고리에 분류
- [ ] DELETE 권고는 실제로 사용 안 되는지 2차 확인
- [ ] CREATE 권고는 test-scaffold skill 로 위임

## 구현 중 막히면

- backend/tests/ 없음 → "no tests directory" 보고
- git history 없음 → git diff 단계 skip
- 너무 많은 orphan → 상위 10개만 보고, 나머지는 "and N more"
