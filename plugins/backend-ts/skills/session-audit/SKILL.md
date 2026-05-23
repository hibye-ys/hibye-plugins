---
name: session-audit
description: KV / session storage 코드 변경 후 invoke. KV.put 호출이 expirationTtl 없음 / framework env binding 의 KV 직접 접근 (storage adapter 우회) 두 패턴을 검출. KV 잔존 방지 + storage 경계 보존.
metadata:
  role: audit
  scope: project
---

# session-audit — KV / session storage audit

## 검증 대상 invariant

key-value cache (KV) 는 보통 *eventual consistency + read cache* — TTL 없이 put 하면 무기한 잔존하여 비용 + 보안 문제. 두 가지 정합성:

1. **KV.put 은 반드시 expirationTtl 동반** — short-lived session / cache 면 TTL 필수
2. **framework env binding 의 KV 직접 접근은 storage adapter 우회** — 모든 KV 호출은 `src/storage/` 안 adapter 함수 경유

`single-writer` invariant 와 짝 — KV 도 lock 없는 storage 이므로 race condition 주의.

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 모든 패턴은 *file-level grep* — block-level / AST 검증 의무 ✕. PASS 출력은 *부분 신뢰* 만 의미. 정확한 invariant 준수 검증은 paired invariant SKILL.md 의 ## 실행 섹션 + 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# 패턴 1: KV.put 인데 TTL 누락 — file-level loop + 다음 5줄 안 expirationTtl 검색
rg -nP "\.put\(" <api-app>/src/ 2>/dev/null | grep -E "(KV|kv|namespace)" | while IFS=: read -r file ln rest; do
  [[ -z "$file" ]] && continue
  awk -v ln="$ln" 'NR>=ln && NR<=ln+5 {print}' "$file" | grep -q "expirationTtl" \
    || echo "$file:$ln: KV.put missing expirationTtl"
done

# 패턴 2: framework env binding 의 KV.* 직접 접근 — storage/ 외부에서 (uncloaked usage)
#   - `<framework env binding>` 은 instance 별 framework 환경 binding 접근자
rg -nP "<framework env binding>\.\w*KV\w*\." <api-app>/src/ 2>/dev/null | grep -v "<api-app>/src/storage/"
```

## 통과 기준

- 패턴 1 출력 **0줄** (모든 KV.put 이 5줄 안 expirationTtl 보유)
- 패턴 2 출력 **0줄** (모든 KV 접근이 storage adapter 경유)

## 위반 시 조치

### 패턴 1 위반 — TTL 누락

```typescript
// 위반 — TTL 없이 KV 에 영구 저장 (framework-neutral pseudo)
await env.SESSIONS.put(sessionId, JSON.stringify(session))
```

조치 — TTL 명시 (초 단위):

```typescript
const SESSION_TTL = 60 * 60 * 24  // 24h
await env.SESSIONS.put(sessionId, JSON.stringify(session), {
  expirationTtl: SESSION_TTL,
})
```

> TTL 상수는 모듈 상단 또는 `src/config/constants.ts` 에 모음 (매직 넘버 ✕).

### 패턴 2 위반 — storage adapter 우회

```typescript
// 위반 — route 핸들러가 KV 직접 접근 (framework-neutral pseudo)
// <framework route definition>('/session', async (ctx) => {
//   const data = await <framework env binding>(ctx).SESSIONS.get(sessionId)  // ← 우회
//   return <framework json response>(ctx, { data })
// })
```

조치 — storage adapter 경유:

```typescript
// src/storage/sessions.ts
export async function getSession(env: Env, id: string) {
  return env.SESSIONS.get(id, 'json')
}

export async function putSession(env: Env, id: string, value: unknown, ttl: number) {
  await env.SESSIONS.put(id, JSON.stringify(value), { expirationTtl: ttl })
}

// route — framework-neutral pseudo
// <framework route definition>('/session', async (ctx) => {
//   const data = await getSession(<framework env binding>(ctx), sessionId)
//   return <framework json response>(ctx, { data })
// })
```

---

## audit 이 커버하지 않는 것

- DB 의 동시 쓰기 race → `single-writer-audit`
- session token 의 입력 검증 → `input-safety-audit`
- secret 노출 (session 값에 raw token 저장) → `security-audit-check`
