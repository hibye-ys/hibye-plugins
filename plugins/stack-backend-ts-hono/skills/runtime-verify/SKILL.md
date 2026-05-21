---
name: runtime-verify
description: 배포 직후 invoke. /health 응답 + /api/v1/models 모델 카탈로그 + SSE 첫 chunk timing 3가지를 실제 endpoint 에 hit 해 검증. static audit (24개) 가 잡지 못하는 *런타임* 정합성 보조.
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/runtime-verify
---

# runtime-verify — 배포 후 런타임 검증 audit

## 검증 대상 invariant

배포 직후 다음 3가지 endpoint 가 정상:

1. **/health** — `{ ok: true }` JSON 응답 (Hono onError / middleware 가 깨지지 않았다는 최소 신호)
2. **/api/v1/models** — provider 카탈로그 ≥ 1개 (provider-catalog-sync 정합)
3. **/api/v1/chat/stream** SSE — 첫 chunk 가 2초 안 도착 (sse-lifecycle 동작 + provider warm)

## 실행

```bash
BASE_URL="${1:-https://apps-api.<your-domain>.workers.dev}"

# 패턴 1: /health
curl -fsS "$BASE_URL/health" | grep -q '"ok":true' \
  || { echo "health FAIL"; exit 1; }

# 패턴 2: /api/v1/models — 카탈로그 비어 있지 않음
curl -fsS "$BASE_URL/api/v1/models" \
  | python3 -c "import sys,json; data=json.load(sys.stdin); assert len(data['models'])>0, 'empty catalog'"

# 패턴 3: SSE 첫 chunk timing (2s 안)
timeout 2 curl -sN -H "Accept: text/event-stream" \
  "$BASE_URL/api/v1/chat/stream?test=1" \
  | head -c 1 | wc -c | grep -q "^[[:space:]]*1$" \
  || { echo "SSE timing FAIL"; exit 1; }

echo "runtime-verify PASS"
```

## 통과 기준

- 3가지 검사 모두 성공 (스크립트 exit code = 0)

## 위반 시 조치

### 패턴 1 위반 — /health 실패

- Workers route 자체가 배포 안 됨 → `wrangler tail` 으로 deploy log 확인
- onError middleware 가 모든 응답을 swallow → `src/index.ts` 의 `app.onError` 확인
- DNS / route binding 문제 → `wrangler whoami` + `wrangler deployments list`

### 패턴 2 위반 — 모델 카탈로그 비어 있음

- `provider-catalog-sync` invariant 위반
- 환경변수 `OPENROUTER_API_KEY` 미설정 / 만료
- provider fetch 가 silent fail — `src/providers/openrouter.ts` 의 error 처리 확인

### 패턴 3 위반 — SSE 첫 chunk 2s 초과

- provider cold start (OpenRouter / Anthropic 의 첫 요청 지연)
- `sse-lifecycle` 의 heartbeat / first-byte flush 누락
- Workers CPU time 초과 — `cf:compatibility_flags` + provider streaming flag 확인

---

## audit 이 커버하지 않는 것

- 정적 코드 검증 (24 audit) → `audit-all.sh` 가 담당 — 본 audit 은 *런타임* 만
- 부하 테스트 / latency p95 → 별도 load test pipeline
- E2E 시나리오 (login → 채팅 → export) → 별도 integration test
