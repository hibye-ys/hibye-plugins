---
name: sse-lifecycle-audit
description: SSE 라우트 추가/수정 후 invoke. apps/api/src/sse/**/*.ts 안 4-state (open/heartbeat/drain/close) 라이프사이클 + stream.onAbort 처리 검증.
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/stream-audit
  pair_invariant: sse-lifecycle
---

# sse-lifecycle-audit

## 검증 대상 invariant
[sse-lifecycle/SKILL.md](../sse-lifecycle/SKILL.md)

## 실행

```bash
# 패턴 1 (정밀화 — Codex 리뷰): streamSSE 사용 *파일* 안에 onAbort 누락 여부.
# 기존 grep -A 30 | grep -v 는 block-level absence 검증 못 함. 대신 파일 단위:
for f in $(grep -rlE 'streamSSE\(' apps/api/src/sse/); do
  grep -qE 'onAbort|c\.req\.raw\.signal|abortController' "$f" || echo "no-abort: $f"
done

# 패턴 2: setInterval (Workers 비호환)
grep -rEn 'setInterval\(' apps/api/src/sse/

# 패턴 3: heartbeat 누락 (15s 이상 silent gap 위험)
grep -rLE 'heartbeat|stream\.sleep' apps/api/src/sse/
```

## 위반 시 조치
1. onAbort 누락 파일 → `stream.onAbort(() => cleanup())` 추가
2. setInterval 사용 → Workers 호환 `stream.sleep()` 으로 대체
3. heartbeat 없음 → 15s 간격 heartbeat loop 추가

## 통과 기준
- 패턴 1 match 0건
- 패턴 2 match 0건 (Workers 호환)
- 패턴 3 = 0건 — 모든 SSE 파일이 heartbeat 포함
