---
name: test-cleanup
description: Checklist + grep patterns for detecting stale, orphaned, or redundant tests in `apps/api/src/`. Load this skill to find tests referencing deleted symbols, duplicate scenarios, permanently-skipped tests, and git-diff-based coverage gaps. Also covers DB rollback, KV cleanup, and mock reset isolation patterns.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/skills/test-cleanup
allowed-tools: Read, Bash
---

**적용된 §4.4 매트릭스 행**: pytest hooks (yield+teardown) → Vitest afterEach/afterAll, DB rollback (SQLAlchemy session.rollback → Drizzle tx.rollback), mock reset (unittest.mock → vi.restoreAllMocks/clearAllMocks)

# test-cleanup — 레거시 테스트 정리 + 격리 가이드

## 이 skill은 언제 로드되는가

- 대규모 리팩터링 후 테스트 정리 필요 시
- "테스트가 너무 많아서 뭘 지워야 할지 모르겠다" 상황
- 테스트 간 상태 오염 의심 (DB/KV/mock 누수)
- `afterEach` / `afterAll` cleanup 패턴 추가 필요 시

## 이 skill은 언제 로드되지 않는가

- 테스트 실패 디버깅 (→ `debug-session` skill)
- 새 테스트 생성 (→ `test-scaffold` skill)
- Vitest 설정 / mock 패턴 이해 (→ `testing-infra` skill)

---

## Part A — Isolation Patterns (DB / KV / Mock)

테스트 격리 실패의 3대 원인과 해결 패턴.

### A1. DB Rollback (Drizzle Transaction)

```ts
// apps/api/src/db/__tests__/db-isolation.test.ts
import { describe, it, afterEach } from 'vitest'
import { createTestDb } from '../../test/helpers'

const db = createTestDb()  // better-sqlite3 in-memory

describe('DB 격리', () => {
  afterEach(async () => {
    // 각 테스트 후 in-memory DB 초기화 (전체 리셋)
    // 또는 각 테스트를 transaction 안에서 실행 + rollback
  })

  it('transaction rollback — 데이터 누수 없음', async () => {
    // withRollback helper 사용 — 테스트 끝나면 자동 rollback (아래 helper 정의 참조)
    await withRollback(db, async (tx) => {
      await tx.insert(myTable).values({ id: 'test-001', name: 'test' })
      // 테스트 로직
      const rows = await tx.select().from(myTable)
      expect(rows[0].id).toBe('test-001')
      // 함수 종료 후 withRollback 이 자동으로 rollback — DB 에 데이터 남지 않음
    })
  })
})
```

> Drizzle + better-sqlite3 에서 명시적 rollback:
> `db.transaction()` 콜백 안에서 예외를 throw 하면 자동 rollback.
> 데이터를 남기지 않으려면 `throw new Error('force-rollback')` 후 catch.

```ts
// 강제 rollback 헬퍼
async function withRollback<T>(
  db: ReturnType<typeof createTestDb>,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  let result: T
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx)
      throw new Error('__rollback__')  // 항상 rollback
    })
  } catch (e: any) {
    if (e.message !== '__rollback__') throw e
  }
  return result!
}
```

### A2. KV Cleanup (test-prefix key)

```ts
// apps/api/src/kv/__tests__/kv-cleanup.test.ts
import { describe, it, afterAll, beforeAll } from 'vitest'
import { createTestKV } from '../../test/helpers'  // testing-infra SKILL.md 의 Map-backed KV stub

const TEST_KEY_PREFIX = 'test:cleanup:'

// Map-backed KV stub
const kv = createTestKV()  // Map<string, string>

// 테스트에서 생성한 key 목록 추적
const createdKeys: string[] = []

function testKey(id: string): string {
  const key = `${TEST_KEY_PREFIX}${id}`
  createdKeys.push(key)
  return key
}

afterAll(async () => {
  // test-prefix key 전체 삭제
  for (const key of createdKeys) {
    await kv.delete(key)
  }
  createdKeys.length = 0
})

describe('KV cleanup', () => {
  it('key 생성 후 afterAll 에서 정리', async () => {
    const key = testKey('session-001')
    await kv.put(key, JSON.stringify({ status: 'active' }))

    const val = await kv.get(key)
    expect(JSON.parse(val!).status).toBe('active')
    // afterAll 에서 삭제됨
  })
})
```

> Workers 실제 KV (`c.env.KV`) 테스트 시: `unstable_dev` 또는 `miniflare` 로
> 격리된 KV namespace 사용. `afterAll(() => worker.stop())` 으로 정리.

### A3. Mock Reset

```ts
// setup.ts (testing-infra SKILL.md) 에 이미 포함:
// afterEach(() => vi.restoreAllMocks())

// 추가 필요 시 개별 테스트에서:
import { beforeEach, afterEach, vi } from 'vitest'

beforeEach(() => {
  vi.clearAllMocks()    // call count / args 초기화 (구현 유지)
})

afterEach(() => {
  vi.restoreAllMocks()  // spy 원복 (구현 복원)
})
```

| 메서드 | 동작 |
|---|---|
| `vi.clearAllMocks()` | call count, args, return value 초기화. 구현은 유지 |
| `vi.resetAllMocks()` | clearAllMocks + mockReturnValue 등 설정도 리셋 |
| `vi.restoreAllMocks()` | spy 를 원래 구현으로 복원 (setup.ts default) |

---

## Part B — 레거시 테스트 탐지

### 1. 삭제된 심볼을 참조하는 테스트

```bash
# 테스트에서 import 하는 심볼이 소스에 존재하는지 확인
grep -rn "^import " apps/api/src/**/*.test.ts | while IFS=: read file line content; do
  # from '../module' 패턴 추출
  module=$(echo "$content" | sed "s/.*from ['\"]\.\.\/\([^'\"]*\)['\"].*/\1/")
  symbol=$(echo "$content" | sed "s/.*{ \([A-Za-z_]*\) }.*/\1/")
  if [ -n "$module" ] && [ -n "$symbol" ]; then
    target="apps/api/src/${module}.ts"
    grep -q "$symbol" "$target" 2>/dev/null || \
      echo "ORPHAN: $file:$line imports $symbol (not found in ${target})"
  fi
done 2>/dev/null | head -30
```

### 2. 영구 skip 된 테스트

```bash
# it.skip 이 이유 없이 방치된 것
grep -rn "it\.skip\|test\.skip\|describe\.skip" apps/api/src/ | grep -v "//.*reason"

# todo 마커 (구현 의도 있지만 방치)
grep -rn "it\.todo\|test\.todo" apps/api/src/ | head -20
```

### 3. 빈 테스트 함수

```bash
# expect 없는 테스트 (pass-through)
grep -rn "^  it\|^  test" apps/api/src/**/*.test.ts -A 5 | \
  grep -B 3 "^\s*$\|^\s*\/\/" | grep "it\|test(" | head -20

# ... (Ellipsis) 또는 빈 body
grep -rn "it('[^']*',\s*async () => {}" apps/api/src/ | head -10
```

### 4. 중복 시나리오 탐지

```bash
# 같은 test 이름이 여러 파일에 존재
grep -rn "^\s*it('[^']*'" apps/api/src/ | \
  sed "s/.*it('\([^']*\)'.*/\1/" | sort | uniq -d | head -20
```

### 5. 소스 없는 테스트 파일

```bash
# __tests__/foo.test.ts 에 대응하는 ../foo.ts 가 없는 경우
find apps/api/src -name "*.test.ts" | while read f; do
  dir=$(dirname "$f")
  parent=$(dirname "$dir")
  module=$(basename "$f" .test.ts)
  found=$(find "$parent" -maxdepth 1 -name "${module}.ts" -not -path "*/\__tests\__/*" 2>/dev/null | head -1)
  [ -z "$found" ] && echo "ORPHAN FILE: $f (no matching ${module}.ts in parent)"
done
```

### 6. Git diff 기반 커버리지 갭

```bash
# 최근 변경된 소스 파일에 대응하는 테스트가 있는지
git diff --name-only HEAD~10 -- apps/api/src/ | grep -v "\.test\.ts$" | while read src; do
  module=$(basename "$src" .ts)
  dir=$(dirname "$src")
  test -f "${dir}/__tests__/${module}.test.ts" || \
    echo "NO TEST: $src changed but ${dir}/__tests__/${module}.test.ts missing"
done
```

---

## Part C — 리포트 템플릿

```markdown
## Test Cleanup Report — <date>

### Orphaned imports (dead symbol references)
- <file:line> imports <symbol> not found in source

### Permanently skipped
- <file:line> it.skip without reason

### Empty tests
- <file:line> test body is empty / no expect

### Duplicates
- <test_name> defined in N files

### Orphaned files
- <test_file> has no matching source module

### Coverage gaps (recent changes)
- <source_file> changed but no test file exists

### Isolation issues (DB/KV/mock leak)
- <describe> may be leaking state — missing afterEach/afterAll cleanup

### Recommended actions
- DELETE: <files> (orphaned, no value)
- UPDATE: <files> (stale imports)
- CREATE: <files> (coverage gaps) — use test-scaffold skill
- FIX ISOLATION: <files> (add afterEach cleanup)
```

---

## 검증 체크리스트

- [ ] DB rollback: `withRollback` 헬퍼 또는 in-memory DB 재생성 패턴 적용
- [ ] KV cleanup: `test:` prefix key + `afterAll` 에서 삭제
- [ ] Mock reset: `vi.restoreAllMocks()` 가 `afterEach` 에 적용됨 (setup.ts)
- [ ] 6개 탐지 블록 실행
- [ ] 각 결과를 리포트 카테고리에 분류
- [ ] DELETE 권고는 실제로 사용 안 되는지 2차 확인
- [ ] CREATE 권고는 test-scaffold skill 로 위임

## 구현 중 막히면

- `apps/api/src/` 없음 → "no tests directory" 보고
- git history 없음 → git diff 단계 skip
- 너무 많은 orphan → 상위 10개만 보고, 나머지는 "and N more"
- DB 격리 방법 모름 → `testing-infra` skill 의 "DB 격리 전략" 참조
- Workers KV 격리 필요 → `miniflare` 또는 `unstable_dev` 통합 테스트로 분리
