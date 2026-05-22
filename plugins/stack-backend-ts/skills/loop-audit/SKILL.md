---
name: loop-audit
description: agent loop / run executor 코드 변경 후 invoke. <api-app>/src/agents/ + src/runs/ 안 while(true) 가 break / abort signal / turn 카운터 같은 종료 조건 없이 도는 경우를 검출. runtime CPU time 초과 / 사용자 abort 무시 / 무한 비용 누출 방지.
metadata:
  role: audit
  scope: project
  source: stack-backend-python/skills/loop-audit
---

# loop-audit — 무한 loop 안전성 audit

## 검증 대상 invariant

`<api-app>/src/agents/**/*.ts` + `<api-app>/src/runs/**/*.ts` 의 `while (true)` 블록은 반드시 다음 중 하나의 종료 조건을 포함해야 한다:

- `break` (명시적 종료)
- `abort` / `signal.aborted` (AbortSignal 체크)
- `turn` 카운터 비교 (`turn > maxTurns` 등)

runtime CPU time 제한 + 사용자 abort + 비용 폭주 방지 — 세 가지 안전망. `agent-loop-invariants` invariant 와 짝.

## 실행

```bash
# file-level awk block scan — while(true) 안 종료 조건 키워드 검색
# macOS BSD awk 호환: `\s` → `[[:space:]]` (PCRE 미지원)
for f in <api-app>/src/agents/**/*.ts <api-app>/src/runs/**/*.ts; do
  [[ -f "$f" ]] || continue
  awk '/while[[:space:]]*\([[:space:]]*true[[:space:]]*\)/{flag=1; start=NR; brace_depth=0}
       flag && /\{/{brace_depth++}
       flag && /(break|abort|signal\.aborted|turn[[:space:]]*[>=])/{flag=0}
       flag && /\}/{
         brace_depth--
         if (brace_depth <= 0) {
           print FILENAME":"start": unsafe while(true) — no break/abort/turn"
           flag=0
         }
       }' "$f" 2>/dev/null
done
```

## 통과 기준

- 출력 **0줄**

## 위반 시 조치

### 위반 예시

```typescript
// 위반 — 무한 루프 + AbortSignal 무시
async function runLoop() {
  while (true) {
    const result = await stepOnce()
    if (result.done) return
    // ↑ stepOnce 가 안 끝나면 무한 루프, abort 도 무시
  }
}
```

조치 — 3가지 안전망 모두 적용:

```typescript
async function runLoop(signal: AbortSignal, maxTurns = 32) {
  let turn = 0
  while (true) {
    if (signal.aborted) throw new Error('aborted')
    if (turn >= maxTurns) throw new Error('max turns exceeded')
    turn++

    const result = await stepOnce({ signal })
    if (result.done) break
  }
}
```

> `maxTurns` 같은 상수는 `run-policy-presets` invariant 에서 가져옴 (매직 넘버 ✕).

---

## audit 이 커버하지 않는 것

- `setInterval` / `setTimeout` 반복 (일부 runtime 비호환) → `sse-lifecycle-audit`
- Promise.all 안 무제한 spawn → `spawn-limits-audit`
- `for (;;)` 무한 루프 — 현 audit 은 `while(true)` 패턴만 (필요 시 패턴 확장)
