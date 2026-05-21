---
name: security-runtime
description: Runtime security audit checklist covering CORS, rate limiting, auth path coverage, leak-safe 404 pattern, and secret scanner gaps. Also provides a consolidated security report template. Does NOT restate baseline checks — those live in `security-audit-check` skill. Load this skill for runtime-specific and report-generation auditing.
allowed-tools: Read, Bash, Grep, Glob
---

# security-runtime — 런타임 보안 감사 + 보고서 가이드

## 이 skill은 언제 로드되는가

- `security-manager` sub-agent 호출 시 (runtime / deep-audit 모드)
- 런타임 보안 점검 (CORS, rate limit, auth) 필요 시
- 통합 보안 보고서 작성 시

## 이 skill은 언제 로드되지 않는가

- 빠른 pre-merge 체크 (→ `security-audit-check` skill)
- 의존성 CVE 감사 (→ `dependency-scanning` skill)
- 코드 구현 작업 (→ 해당 서브시스템 skill)

## 1. CORS 설정 검증

```bash
# CORS middleware 등록 확인
rg -n "CORS\|CORSMiddleware\|allow_origins" backend/main.py backend/middleware/

# wildcard origin (VIOLATION in production)
rg -n 'allow_origins.*\*\|allow_origins.*"\*"' backend/
```

## 2. Rate Limiting 설정

```bash
# rate limit 미들웨어 / 데코레이터
rg -n "rate_limit\|RateLimit\|slowapi\|throttle" backend/

# /media/* 별도 rate limit (비용 프로파일 다름)
rg -n "rate.*media\|media.*rate" backend/routes/media.py 2>/dev/null
```

## 3. Auth 경로 커버리지

```bash
# 인증 의존성 사용 현황
rg -n "require_auth\|Depends.*auth" backend/routes/

# 인증 없는 엔드포인트 (health 제외 = VIOLATION)
for f in backend/routes/*.py; do
  routes=$(rg -c "def \|@router" "$f" 2>/dev/null || echo 0)
  auths=$(rg -c "require_auth\|Depends.*auth" "$f" 2>/dev/null || echo 0)
  echo "$(basename $f): routes=$routes auths=$auths"
done
```

## 4. Leak-safe 404 패턴

```bash
# 403 반환 경로 (VIOLATION — 모두 404 여야 함)
rg -n "403\|HTTP_403\|Forbidden" backend/routes/

# 소유권 검증 후 404 반환 패턴
rg -n "404\|not_found\|_assert_owner" backend/routes/
```

## 5. Secret Scanner 커버리지

```bash
# _SECRET_PATTERNS 목록 (최소 4종: sk-, AKIA, ghp_, PEM)
rg -n "_SECRET_PATTERNS" backend/engine/stream.py -A 10

# scrub 함수가 SSE 3대상에서 호출되는지
rg -n "scrub_secrets\|_scrub_dict" backend/engine/stream.py | wc -l
```

## 6. 요청 크기 제한

```bash
# max body size / content length 제한
rg -n "max_.*size\|content.length\|body.*limit" backend/main.py backend/middleware/ backend/routes/
```

## 7. 세션 TTL / CSRF

```bash
# 세션 만료 설정
rg -n "ttl\|expire\|max_age\|session.*timeout" backend/state/ backend/services/auth/

# CSRF 보호 (SSE 엔드포인트는 제외 가능)
rg -n "csrf\|CSRF\|X-CSRF" backend/
```

## 통합 보안 보고서 템플릿

```markdown
## Security Audit Report — <date>

### Executive Summary
- Audit scope: backend/ (Phase <N>)
- Critical: <N> | High: <N> | Medium: <N> | Low: <N>

### 1. Code Security (from security-audit-check)
- Hardcoded secrets: [OK/FAIL]
- OWASP injection: [OK/FAIL]
- Auth/permission: [OK/FAIL]

### 2. Supply Chain (from dependency-scanning)
- CVEs found: <N> (critical: <N>)
- License risks: <list>
- Stale dependencies: <list>

### 3. Runtime Security (this skill)
- CORS: [OK/FAIL] — <details>
- Rate limiting: [OK/FAIL] — <details>
- Auth coverage: [OK/FAIL] — <N>/<M> routes protected
- Leak-safe 404: [OK/FAIL] — <N> 403 violations
- Secret scanner: [OK/FAIL] — <N> patterns, <M> targets covered
- Request size limits: [OK/FAIL]
- Session TTL: [OK/FAIL]

### 4. Top 5 Attack Surfaces
1. <surface> — risk: <level>, mitigation: <action>
2. ...

### 5. Remediation Priority
| # | Finding | Severity | Effort | Recommendation |
|---|---------|----------|--------|---------------|
| 1 | ... | CRITICAL | Low | Fix immediately |
```

## 의존 파일

- `.agents/rules/python_agent_rules/api-routing-patterns.md` — 인증 + leak-safe 404
- `.agents/rules/python_agent_rules/sse-streaming-patterns.md` — secret scanner
- `.agents/skills/security-audit-check/` — 5-category 기본 체크
- `.agents/skills/dependency-scanning/` — CVE/라이선스

## 검증 체크리스트

- [ ] 7개 런타임 체크 블록 실행
- [ ] 보고서 템플릿의 모든 섹션 채움
- [ ] CRITICAL 항목은 즉시 보고
- [ ] 403 사용 경로는 모두 VIOLATION 으로 분류

## 구현 중 막히면

- auth.py 없음 → 인증 미구현 경고 (CRITICAL)
- rate limit 라이브러리 없음 → "no rate limiting" 보고
- CORS 설정 없음 → 개발 환경이라도 경고
