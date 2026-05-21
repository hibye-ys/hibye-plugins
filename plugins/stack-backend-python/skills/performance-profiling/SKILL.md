---
name: performance-profiling
description: Use when measuring App backend performance baselines or detecting regressions — defines 4 benchmark scenarios, the p50/p95/p99 methodology, the baseline JSON schema, and the regression thresholds. Feeds infra-performance-manager sub-agent in benchmark mode. Load before pre-launch or after a major loop/provider change.
allowed-tools: Read, Bash, Grep, Glob
---

# performance-profiling — 성능 측정 표준

## 이 skill은 언제 로드되는가

- Pre-launch 성능 baseline 확정
- Provider / Agent Loop / Compaction 대대적 변경 후 회귀 검출
- 사용자 리포트 "느려졌다" 객관화
- `infra-performance-manager` sub-agent (benchmark 모드) 호출 시 자동 로드

## 4 Scenario 정의

| Scenario | 목적 | 설명 | 측정 중점 |
|----------|------|-----|----------|
| A | 순수 LLM 지연 | 1 턴, 도구 호출 없음 | TTFB, 총 시간 |
| B | 도구 dispatch 오버헤드 | 1 턴, 1 도구 호출 | 도구 실행 전후 지연 |
| C | Cache hit 검증 | 3 턴 연속, 같은 도구 반복 | cache_read / total |
| D | Compaction 근접 | 175K+ 토큰 컨텍스트 | compaction trigger, 복구 지연 |

각 시나리오 30 샘플, p50 / p95 / p99 계산.

## 측정 메트릭

| 메트릭 | 출처 | 단위 |
|--------|------|-----|
| TTFB | 첫 SSE 이벤트까지 | ms |
| Total duration | `done` 이벤트까지 | ms |
| Input tokens | `X-App-Usage` header 또는 `usage` SSE | count |
| Output tokens | 동일 | count |
| Cache creation | `usage.cache_creation_input_tokens` | count |
| Cache read | `usage.cache_read_input_tokens` | count |
| Cache hit rate | `cache_read / (cache_read + cache_creation)` | % |
| Compaction count | log grep `compaction_triggered` | count per run |

## Baseline JSON 스키마

```json
{
  "version": 1,
  "created_at": "2026-04-15T10:00:00Z",
  "commit": "abc1234",
  "environment": {
    "python": "3.14.0",
    "os": "darwin",
    "provider": "anthropic",
    "model": "claude-sonnet-4-6"
  },
  "scenarios": {
    "A": {
      "samples": 30,
      "ttfb_p50_ms": 250,
      "ttfb_p95_ms": 480,
      "ttfb_p99_ms": 620,
      "duration_p50_ms": 1200,
      "duration_p95_ms": 2100,
      "input_tokens_median": 1500,
      "output_tokens_median": 300,
      "cache_hit_rate": 0.82
    },
    "B": { ... },
    "C": { ... },
    "D": { ... }
  }
}
```

저장 경로: `benchmarks/baseline.json`.

## 회귀 임계값

| 메트릭 | 회귀 판정 | Improvement 판정 |
|--------|----------|-----------------|
| p95 TTFB | +10% | -10% |
| p95 Duration | +10% | -10% |
| Output tokens (median) | +5% | -5% |
| Cache hit rate | -5pp | +5pp |
| Compaction count | 2x | 0.5x |

**p50 단독 변화는 노이즈** — p95 + 분산 확대가 동반될 때만 회귀로 선언.

## 측정 스크립트 (pseudo)

```python
# benchmarks/run_scenarios.py
import asyncio
import httpx
import statistics

async def scenario_a(client, n=30):
    latencies = []
    for _ in range(n):
        t0 = time.perf_counter()
        async with client.stream("POST", "/run/chat", json={"input": "hello"}) as r:
            async for line in r.aiter_lines():
                if line.startswith("event: text_chunk"):
                    ttfb = (time.perf_counter() - t0) * 1000
                    break
        latencies.append(ttfb)
    return {
        "p50": statistics.quantiles(latencies, n=2)[0],
        "p95": statistics.quantiles(latencies, n=20)[18],
        "p99": statistics.quantiles(latencies, n=100)[98],
    }
```

## Cache Hit Rate 디버깅 힌트

Hit rate 급락은 대부분 system prompt cache key 무효화. 확인 순서:

1. `context-assembly-patterns.md` — system prompt 에 동적 값 유입?
2. `tool-system-patterns.md` — tool 정렬 순서 변경?
3. `core-infrastructure.md` — attachment 수집 순서 변경?
4. Provider side — `cache_control` 파라미터 누락?

## 검증 체크리스트

- [ ] 4 시나리오 각 30 샘플
- [ ] p50/p95/p99 평균 아님 — 분위수
- [ ] Cache hit rate 시나리오 별 계산
- [ ] Baseline JSON 형식 준수
- [ ] Regression 판정 임계값 기준 명시

## 구현 중 막히면

- `X-App-Usage` 헤더 없음 → `sse-streaming-patterns.md` 확인, trailer header 또는 usage 이벤트로 대체
- 서버가 30 샘플 다 돌기 전 rate limit → 샘플 간 sleep 추가 또는 VCR cassette 로 replay
- 시간 측정 노이즈 과다 → CPU governor 고정, 다른 프로세스 kill, 3 회 평균
- Baseline 이 없음 → 첫 실행을 baseline 으로 저장, NEW_BASELINE 플래그
