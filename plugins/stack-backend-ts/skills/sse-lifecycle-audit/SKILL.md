---
name: sse-lifecycle-audit
description: SSE 라우트 추가/수정 후 invoke. <api-app>/src/sse/**/*.ts 안 4-state (open/heartbeat/drain/close) 라이프사이클 + abort signal 처리 검증.
metadata:
  role: audit
  scope: project
  source: stack-backend-python/skills/stream-audit
  pair_invariant: sse-lifecycle
---

# sse-lifecycle-audit

## 검증 대상 invariant
[sse-lifecycle/SKILL.md](../sse-lifecycle/SKILL.md)

## 실행

```bash
# 패턴 1 (정밀화 — Codex 리뷰): SSE helper 사용 *파일* 안에 abort 처리 누락 여부.
# 기존 grep -A 30 | grep -v 는 block-level absence 검증 못 함. 대신 파일 단위:
#   - `<framework SSE helper>` 는 instance 측 framework 별 SSE 응답 헬퍼 이름
for f in $(grep -rlE '<framework SSE helper>\(' <api-app>/src/sse/); do
  grep -qE 'onAbort|abort.*signal|abortController' "$f" || echo "no-abort: $f"
done

# 패턴 2: setInterval (일부 runtime 비호환 — runtime-specific, instance 측 project-local skill 참조)
grep -rEn 'setInterval\(' <api-app>/src/sse/

# 패턴 3: heartbeat 누락 (15s 이상 silent gap 위험)
grep -rLE 'heartbeat|stream\.sleep' <api-app>/src/sse/
```

## 위반 시 조치
1. abort 처리 누락 파일 → SSE helper 의 abort hook (예: `stream.onAbort(() => cleanup())`) 또는 framework abort signal 리스너 추가
2. setInterval 사용 → runtime-호환 sleep 패턴 (예: `stream.sleep()` 또는 setTimeout 기반 self-scheduling) 으로 대체
3. heartbeat 없음 → 15s 간격 heartbeat loop 추가

## 통과 기준
- 패턴 1 match 0건
- 패턴 2 match 0건 (runtime 호환성)
- 패턴 3 = 0건 — 모든 SSE 파일이 heartbeat 포함
