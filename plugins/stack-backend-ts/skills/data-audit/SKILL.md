---
name: data-audit
description: schema 변경 후 또는 새 migration 추가 후 invoke. Drizzle schema 의 FK 컬럼에 인덱스 정의가 함께 있는지 / migration 파일 순서가 정렬되어 있는지 / RLS policy 누락을 grep 으로 검증. data-layer + database invariant 와 짝.
metadata:
  role: audit
  scope: project
  source: stack-backend-python/skills/data-audit
---

# data-audit — Drizzle schema / migration audit

## 검증 대상 invariant

`apps/api/src/db/schema/*.ts` + `apps/api/drizzle/*.sql` 의 세 가지 정합성:

1. **FK 인덱스** — `references(...)` 가 붙은 컬럼은 같은 파일 안에 `index(...)` 로 인덱싱되어야 함 (FK lookup 성능 + cascade 안전)
2. **migration 순서** — `apps/api/drizzle/*.sql` 파일명이 사전식 정렬과 일치해야 함 (timestamp prefix 정합)
3. **RLS policy** — Postgres row-level security 가 필요한 테이블에 `policy` 정의 (선택적 — 멀티테넌트 스키마만)

## 실행

```bash
# 패턴 1: FK 컬럼이 인덱스 없음 — file-level loop + sed extract (PCRE2 lookahead 회피)
for f in apps/api/src/db/schema/*.ts; do
  [[ -f "$f" ]] || continue
  # references(...) 가 있는 라인에서 직전 컬럼명 추출
  grep -nE "references\(" "$f" | while IFS=: read -r lineno content; do
    col=$(echo "$content" | sed -nE "s/^\s*([A-Za-z_][A-Za-z0-9_]*):.*references.*/\1/p")
    [[ -z "$col" ]] && continue
    grep -qE "index\([^)]*\)\s*\.on\([^)]*\b${col}\b" "$f" \
      || grep -qE "\.${col}.*index" "$f" \
      || echo "$f:$lineno: FK column '$col' missing index"
  done
done

# 패턴 2: migration 순서 정합 — ls 정렬 vs 자연 정렬
ls apps/api/drizzle/*.sql 2>/dev/null | sort -c 2>&1 \
  && echo "migrations sorted OK" \
  || echo "migrations OUT OF ORDER"

# 패턴 3: RLS 누락 — schema 에 *_tenantId 컬럼 있는데 RLS policy 파일 없음
grep -lE "tenantId|orgId|workspaceId" apps/api/src/db/schema/*.ts 2>/dev/null | while read f; do
  table=$(basename "$f" .ts)
  grep -rqE "create policy.*${table}" apps/api/drizzle/ 2>/dev/null \
    || echo "$f: tenant-scoped table '$table' missing RLS policy"
done
```

## 통과 기준

- 패턴 1 출력 **0줄** (모든 FK 컬럼에 인덱스 존재)
- 패턴 2 출력 = `migrations sorted OK`
- 패턴 3 출력 **0줄** (멀티테넌트 schema 면 RLS 필수, 단일 tenant 면 패턴 3 무시 가능)

## 위반 시 조치

### 패턴 1 위반 — FK 인덱스 누락

```typescript
// 위반 예시
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),  // index ✕
})
```

조치:

```typescript
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),
}, (table) => ({
  userIdIdx: index('messages_user_id_idx').on(table.userId),
}))
```

### 패턴 2 위반 — migration 순서 어긋남

- `apps/api/drizzle/` 의 파일명 prefix (timestamp 또는 sequential number) 가 사전식 정렬과 불일치
- 조치: `drizzle-kit generate` 으로 새로 생성하거나 수동으로 prefix 정정 (단, 이미 적용된 migration 은 rename ✕ — 새 migration 으로 보정)

### 패턴 3 위반 — RLS policy 누락

```sql
-- apps/api/drizzle/0003_messages_rls.sql
alter table messages enable row level security;

create policy messages_tenant_isolation on messages
  for all using (tenant_id = current_setting('app.current_tenant')::uuid);
```

---

## audit 이 커버하지 않는 것

- Cloudflare D1 사용 검출 → `d1-forbidden-audit`
- Workers 호환 driver (neon-http 등) 검증 → `dependency-scanning`
- query 성능 (slow query) → 별도 runtime profiling
