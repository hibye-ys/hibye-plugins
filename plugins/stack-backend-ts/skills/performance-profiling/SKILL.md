---
name: performance-profiling
description: <api-app> 백엔드 성능 baseline 확정 / 회귀 검출 / "느려졌다" 객관화 시 invoke. 4 시나리오 × 30 샘플 × p50/p95/p99 측정. 0x / clinic / node --inspect / heapdump 진단 순서. Pre-launch 또는 provider / agent loop / compaction 대대적 변경 후 회귀 검출 시.
metadata:
  role: workflow
  scope: project
---

**적용된 §4.4 매트릭스 행**: `py-spy` → `0x` (flamegraph) + `clinic doctor` (이벤트 루프 lag), `cProfile` → `node --prof` + `node --prof-process` (V8 CPU profile), `memray` → `heapdump` + Chrome DevTools snapshot (메모리), `httpx.AsyncClient` → `fetch(url, init)` (스트림: `response.body.getReader()`), `time.perf_counter()` → `performance.now()`, `asyncio.sleep` → `await new Promise(r => setTimeout(r, ms))`, `statistics.quantiles` → 수동 정렬 + 인덱스 또는 `simple-statistics` (npm), `tiktoken` → `js-tiktoken` (토큰 카운트), `pytest` benchmark 러너 → `vitest` + `tinybench` 또는 standalone Node script, `pydantic BaseModel` baseline.json → `zod` schema

# performance-profiling — 성능 측정 표준

## 이 skill 은 언제 invoke 되는가

- Pre-launch 성능 baseline 확정 (<runtime> prod + Node fallback)
- Provider / Agent Loop / Compaction 대대적 변경 후 회귀 검출
- 사용자 리포트 "느려졌다" 객관화
- `infra-performance-manager` sub-agent (benchmark 모드) 호출 시 자동 로드

## 진단 순서 (5-step)

1. **clinic doctor** — 이벤트 루프 lag / GC pressure / I/O 병목 1차 분류
   ```bash
   pnpm exec clinic doctor -- node dist/index.js
   # 부하 후 Ctrl+C → 브라우저에서 진단 리포트
   ```

2. **0x flamegraph** — CPU bound 의심 시 hot path 식별
   ```bash
   pnpm exec 0x -- node dist/index.js
   # 부하 후 Ctrl+C → flamegraph.html
   ```

3. **node --inspect** — 라이브 디버깅 / CPU profile / heap snapshot
   ```bash
   node --inspect dist/index.js
   # Chrome → chrome://inspect → CPU Profile / Memory tab
   ```

4. **heapdump** — 메모리 누수 의심 시
   ```bash
   pnpm add -D heapdump
   # 코드에서 require('heapdump').writeSnapshot('/tmp/dump.heapsnapshot')
   # Chrome DevTools Memory → Load → 비교
   ```

5. **<framework> 라우트별 p99** — `<framework middleware registration>` 으로 timing middleware 등록 (예: framework timing helper)
   ```typescript
   // 의사코드: framework 가 제공하는 timing middleware 를 모든 경로에 등록
   // <framework middleware registration>('*', timing())
   // Server-Timing 헤더 측정 → 모니터링
   ```

> <runtime> 환경은 `0x` / `clinic` / `node --inspect` 불가 — **로컬 Node 빌드** 에서 측정 후 <runtime> 회귀 추적은 runtime live tail + analytics 로 (runtime-specific — instance 측 project-local skill 참조).

## 4 Scenario 정의

| Scenario | 목적 | 설명 | 측정 중점 |
|----------|------|-----|----------|
| A | 순수 LLM 지연 | 1 턴, 도구 호출 없음 | TTFB, 총 시간 |
| B | 도구 dispatch 오버헤드 | 1 턴, 1 도구 호출 | 도구 실행 전후 지연 |
| C | Cache hit 검증 | 3 턴 연속, 같은 도구 반복 | cacheRead / total |
| D | Compaction 근접 | 175K+ 토큰 컨텍스트 | compaction trigger, 복구 지연 |

각 시나리오 30 샘플, p50 / p95 / p99 계산.

## 측정 메트릭

| 메트릭 | 출처 | 단위 |
|--------|------|-----|
| TTFB | 첫 SSE 이벤트까지 | ms |
| Total duration | `done` 이벤트까지 | ms |
| Input tokens | `X-App-Usage` header 또는 `usage` SSE | count |
| Output tokens | 동일 | count |
| Cache creation | `usage.cacheCreationInputTokens` | count |
| Cache read | `usage.cacheReadInputTokens` | count |
| Cache hit rate | `cacheRead / (cacheRead + cacheCreation)` | % |
| Compaction count | console 로그 grep `compaction_triggered` | count per run |
| Event loop lag | `clinic doctor` 진단 | ms |
| GC pause p95 | `clinic doctor` 진단 | ms |

## Baseline JSON 스키마

```typescript
// benchmarks/schema.ts
import { z } from 'zod'

export const ScenarioStatsSchema = z.object({
  samples: z.number().int().positive(),
  ttfbP50Ms: z.number(),
  ttfbP95Ms: z.number(),
  ttfbP99Ms: z.number(),
  durationP50Ms: z.number(),
  durationP95Ms: z.number(),
  inputTokensMedian: z.number(),
  outputTokensMedian: z.number(),
  cacheHitRate: z.number().min(0).max(1),
})

export const BaselineSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  commit: z.string(),
  environment: z.object({
    node: z.string(),
    os: z.string(),
    provider: z.string(),
    model: z.string(),
  }),
  scenarios: z.object({
    A: ScenarioStatsSchema,
    B: ScenarioStatsSchema,
    C: ScenarioStatsSchema,
    D: ScenarioStatsSchema,
  }),
})

export type Baseline = z.infer<typeof BaselineSchema>
```

저장 경로: `<api-app>/benchmarks/baseline.json`.

## 회귀 임계값

| 메트릭 | 회귀 판정 | Improvement 판정 |
|--------|----------|-----------------|
| p95 TTFB | +10% | -10% |
| p95 Duration | +10% | -10% |
| Output tokens (median) | +5% | -5% |
| Cache hit rate | -5pp | +5pp |
| Compaction count | 2x | 0.5x |
| Event loop lag p95 | +50% | -25% |

**p50 단독 변화는 노이즈** — p95 + 분산 확대가 동반될 때만 회귀로 선언.

## 측정 스크립트 (pseudo)

```typescript
// <api-app>/benchmarks/runScenarios.ts
import { performance } from 'node:perf_hooks'

async function scenarioA(baseUrl: string, n = 30): Promise<{ p50: number; p95: number; p99: number }> {
  const latencies: number[] = []
  for (let i = 0; i < n; i += 1) {
    const t0 = performance.now()
    const response = await fetch(`${baseUrl}/run/chat`, {
      method: 'POST',
      body: JSON.stringify({ input: 'hello' }),
      headers: { 'Content-Type': 'application/json' },
    })
    if (response.body === null) throw new Error('no body')
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value !== undefined && value.includes('event: text_chunk')) {
        latencies.push(performance.now() - t0)
        await reader.cancel()
        break
      }
    }
  }
  const sorted = [...latencies].sort((a, b) => a - b)
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  }
}
```

## Cache Hit Rate 디버깅 힌트

Hit rate 급락은 대부분 system prompt cache key 무효화. 확인 순서:

1. `context-assembly` — system prompt 에 동적 값 유입?
2. `tool-sort-order` — tool 정렬 순서 변경?
3. `compaction` — attachment 수집 순서 변경?
4. Provider side — `cacheControl` 파라미터 누락?

## 검증 체크리스트

- [ ] 4 시나리오 각 30 샘플
- [ ] p50/p95/p99 평균 아님 — 분위수 (정렬 후 인덱스 또는 `simple-statistics`)
- [ ] Cache hit rate 시나리오 별 계산
- [ ] Baseline JSON 형식 (`BaselineSchema.parse` 통과)
- [ ] Regression 판정 임계값 기준 명시
- [ ] `clinic doctor` 1회 이상 실행 (이벤트 루프 lag 추적)
- [ ] <runtime> prod 측정은 runtime live tail + analytics 로 보강 (runtime-specific — instance 측 project-local skill 참조)

## 구현 중 막히면

- `X-App-Usage` 헤더 없음 → `sse-streaming` workflow 확인, trailer header 또는 usage SSE 이벤트로 대체
- 서버가 30 샘플 다 돌기 전 rate limit → 샘플 간 `await new Promise(r => setTimeout(r, 500))` 추가 또는 nock / msw 로 replay
- 시간 측정 노이즈 과다 → 다른 프로세스 kill, 3 회 평균
- Baseline 이 없음 → 첫 실행을 baseline 으로 저장, `NEW_BASELINE` 플래그
- `0x` / `clinic` 실행 안 됨 (<runtime>) → 로컬 Node 빌드 (`<api-app>/src/node-entry.ts`) 만들고 그 위에서 측정

## Cross-ref

- `sse-streaming` — TTFB 측정 (첫 SSE 이벤트 기준)
- `compaction-thresholds` — 시나리오 D 의 175K 토큰 기준
- `provider-retry-matrix` — provider 별 retry 폭증 시 회귀 원인
- runtime 빌드 분리 (instance 측 project-local skill 참조)
