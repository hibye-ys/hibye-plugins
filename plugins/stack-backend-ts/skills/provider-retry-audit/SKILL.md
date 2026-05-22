---
name: provider-retry-audit
description: 배포 전 또는 새 LLM provider 추가 후 invoke. apps/api/src/ai/providers/**/*.ts 안 retry 로직이 provider-retry-matrix invariant (재시도 가능 / 즉시 fatal 구분) 따르는지 grep 검증.
metadata:
  role: audit
  scope: apps/api
  source: stack-backend-python/skills/provider-audit (retry 부분)
  pair_invariant: provider-retry-matrix
---

# provider-retry-audit

## 검증 대상 invariant
[provider-retry-matrix/SKILL.md](../provider-retry-matrix/SKILL.md)

## 실행

```bash
# 패턴 1: fatal status (401/403/404/422) 가 retry 안에 들어있나
grep -rEn 'retry.*\b(401|403|404|422)\b|\b(401|403|404|422)\b.*retry' apps/api/src/ai/providers/

# 패턴 2 (정밀화 — Codex 리뷰): fetch 가 *block 단위* 로 retry wrap 안에 있는지.
# (rg multi-line 옵션은 PCRE2 지원 필요 — 환경 의존적이라 file-level 패턴만 유지)

# 패턴 2: 디렉토리 단위 — 각 파일에 fetch 있으면서 retry 단어 없는지
for f in $(grep -rlE 'fetch\(' apps/api/src/ai/providers/); do
  grep -qE 'pRetry|retry|backoff' "$f" || echo "no-retry: $f"
done
```

## 위반 시 조치
1. fatal status 가 retry 들어 있으면 → `if (status === 401 || status === 403 ...) throw` 로 즉시 분기
2. fetch 만 (retry ✕) 발견 → `p-retry` 또는 manual backoff 추가

## 통과 기준
- 패턴 1 match 0건
- 패턴 2 match 0건 (또는 명시적 *single-shot* 사유 주석)
