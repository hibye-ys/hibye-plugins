---
name: security-runtime
description: <api-app> 런타임 보안의 *통합 보고서* 작성 시 invoke. 9 영역 (CORS / rate limit / auth coverage / leak-safe 404 / secret scanner / 요청 크기 / 세션 TTL+CSRF / runtime secrets / audit log retention) 의 검증은 각 paired *-audit skill 정본 — 본 skill 은 보고서 형식 + 보안 측 예외 매핑 + 영향도 + 금지 사항 만 담당. zod input parse 0번 게이트, runtime secret store, WAF 연동 정책.
metadata:
  role: workflow
  scope: project
---

# security-runtime — 통합 보안 보고서 가이드

> **본 skill 의 역할** = *통합 보고서 + 운영 정책*. 9 영역의 grep 패턴 / 차단 검증은 각 paired audit skill 정본:
>
> | # | 영역 | 정본 audit |
> |---|---|---|
> | 1 | CORS 정책 | [[cors-policy-audit]] |
> | 2 | Rate limit | [[rate-limit-policy-audit]] |
> | 3 | Auth coverage | [[api-audit]] |
> | 4 | Leak-safe 404 / envelope | [[http-error-sentinels-audit]] |
> | 5 | Secret scanner (5 패턴) + secret 하드코딩 | [[security-audit-check]] |
> | 6 | Input safety (zod / 요청 크기 / gate 순서) | [[input-safety-audit]] |
> | 7 | Session TTL / CSRF | [[session-audit]] |
> | 8 | Runtime Secrets (`process.env` ✕, `<framework env binding>` 경유) | [[config-env-validation]] |
> | 9 | Audit log retention | 데이터 거버넌스 (instance 측 project-local skill) |
>
> 본 SKILL.md 본문에 매번-실행 grep 절차 ✕ (AP-06 회피). cite 한 audit 의 한계는 각 SKILL.md §"audit 이 커버하지 않는 것" 참조.

## 이 skill 은 언제 invoke 되는가

- `security-manager` sub-agent (`plugins/backend-ts/.codex/agents/security_manager.toml`) 호출 시 통합 보고서 작성 모드
- 분기별 / 릴리스 전 보안 audit 종합
- 새 라우트 / 새 secret 추가 후 9 영역 *전부* 의 일관성 점검
- 시크릿 노출 사고 후 secret scanner 패턴 보강 (정본 = [[security-audit-check]])

## 이 skill 은 언제 invoke 되지 않는가

- 단일 영역 검증 (예: CORS 만) — 해당 paired audit skill 직접 invoke
- 의존성 CVE 감사 → [[dependency-scanning]]
- 코드 구현 작업 → 해당 서브시스템 workflow

## 절대 원칙 — 모든 입력 → zod 0번 게이트

```typescript
import { z } from 'zod'

const RunInputSchema = z.object({
  input: z.string().max(50_000),
  agent: z.string().regex(/^[a-z0-9-]+$/).optional(),
})

// 라우트 진입 직후 zod parse — 이후 [[input-safety-gate-ordering]] V3 순서
// (tombstone → jailbreak heuristic → jailbreak classifier → moderation → _streamAgent) 와 결합.
// zod parse 는 **0번 게이트** (가장 싸고 항상 가장 먼저).
```

검증 + grep 패턴은 [[input-safety-audit]] + [[input-safety-gate-ordering]] 정본.

## 통합 보안 보고서 템플릿

```markdown
## Security Audit Report — <date>

### Executive Summary
- Audit scope: <api-app>/ (Phase <N>)
- Critical: <N> | High: <N> | Medium: <N> | Low: <N>

### 1. Input safety  (정본 = input-safety-audit)
- [OK/FAIL] All routes use framework zod validator or manual `Schema.parse`
- [OK/FAIL] Input safety gate V3 순서 유지 (tombstone → jailbreak → moderation → agent)
- [OK/FAIL] 요청 크기 제한 (bodyLimit) 적용 — /media/upload 만 100MB, 그 외 5MB

### 2. Supply Chain  (정본 = dependency-scanning)
- [OK/FAIL] `pnpm audit` clean (또는 ignore 사유 명시)
- License risks: <list>
- Stale dependencies: <list>

### 3. Runtime Security (9 영역 종합)
- CORS  (정본 = cors-policy-audit): [OK/FAIL] — wildcard ✕, allow-list 기반
- Rate limiting  (정본 = rate-limit-policy-audit): [OK/FAIL] — 3-axis 적용 + Retry-After
- Auth coverage  (정본 = api-audit): [OK/FAIL] — <N>/<M> routes protected + auth 미들웨어 등록 순서
- Leak-safe 404  (정본 = http-error-sentinels-audit): [OK/FAIL] — 403 사용 0건
- Secret scanner  (정본 = security-audit-check): [OK/FAIL] — 5 패턴 (sk- / AKIA / ghp_ / PEM / 사용자 추가) × 모든 SSE 이벤트 적용
- Secret 하드코딩  (정본 = security-audit-check 패턴 1): [OK/FAIL] — 0건
- Session TTL / CSRF  (정본 = session-audit): [OK/FAIL] — POST/PATCH/DELETE 만 CSRF, SSE GET 제외
- Runtime Secrets  (정본 = config-env-validation): [OK/FAIL] — `process.env` 사용 0건 (runtime 비호환 시), `<framework env binding>` 경유
- Audit log retention  (instance 측 데이터 거버넌스): [OK/FAIL] — append-only / object storage immutable

### 4. Top 5 Attack Surfaces
1. <surface> — risk: <level>, mitigation: <action>
2. ...

### 5. Remediation Priority
| # | Finding | Severity | Effort | Recommendation |
|---|---------|----------|--------|---------------|
| 1 | ... | CRITICAL | Low | Fix immediately |
```

## 보안 측 예외 매핑 (정본 = [[error-handling]])

> `error-handling` workflow 의 예외 계층 정본. 본 SKILL.md 는 **보안 측 행동만** 추가.

| 예외 (정본 = [[error-handling]]) | 보안 측 행동 |
|---|---|
| `ValidationError` (zod 실패) | 422, 사용자 input scrub 후 반환 — stack ✕ |
| `ConfigurationError` (env 누락) | 500 "service misconfigured" — 어떤 env 누락인지 ✕ |
| `ResourceError` (권한/미존재) | **항상 404** (leak-safe), 403 ✕ |
| `InternalError` (불변식 위반) | 500 "internal server error" — 상세 메시지 ✕ |

## 영향도 — 보안 정책 변경 시

| 변경 | 영향받는 곳 |
|---|---|
| CORS allow-list 변경 | 프론트엔드 빌드 + 모바일 (web view), CSRF origin 동시 갱신 |
| Rate limit threshold 변경 | KV cost, 정당 사용자 차단 risk — Sentry alert 임계값도 동시 갱신 |
| Secret 회전 | runtime secret store 갱신 → 모든 인스턴스 즉시 반영 (재배포 불필요). 단 캐시된 client 인스턴스 (`p-retry` 등) reset 필요 — [[secret-rotation]] 정본 |
| Auth middleware 순서 변경 | [[input-safety-gate-ordering]] V3 게이트 순서와 충돌 가능 — 유지 검증 |
| 새 secret 추가 | (1) runtime secret store 등록 (2) `Env.Bindings` 타입 추가 (3) runtime types 재생성 |
| SCRUB_PATTERNS 추가 | 모든 SSE 이벤트 처리 경로 + 테스트 fixture 동시 갱신 ([[security-audit-check]] 패턴 1 정본) |

## 보안 정책 금지

- CORS `origin: '*'` (production)
- 403 반환 ([[http-error-sentinels]] leak-safe 위반)
- `process.env.<NAME>` 사용 (runtime undefined 가능성 — runtime-specific, instance 측 project-local skill 참조)
- 로컬 secret 파일 (.env / .dev.vars 등) git commit
- Audit log 의 update / delete (append-only 위반 — 데이터 거버넌스)
- Secret 을 KV 에 저장 (KV 는 평문) — 반드시 runtime secret store
- JWT 에 PII 포함 (payload 는 base64, encryption ✕)
- `SCRUB_PATTERNS` 우회 — scrub 없이 직접 SSE emit
- zod parse 우회 — `as` casting 으로 외부 input 통과

## 의존 자산 (cross-ref)

- [[input-safety-gate-ordering]] — V3 게이트 순서
- [[error-handling]] — 4 예외 / 4 패턴 정본
- [[http-error-sentinels]] — sentinel 매핑 + scrubText 정본
- [[auth]] — JWT / runtime secrets / KV 세션
- [[secret-rotation]] — secret 회전 절차
- [[config-env-validation]] — env 단일 진입점 + `process.env` ✕ 정책
- [[ts-agent-rules]] — AsyncLocalStorage 10 필드 (`requestId` / `userId`)
- 데이터 거버넌스 (instance 측 project-local) — audit log 6 event taxonomy + 7년 retention

## 검증 체크리스트 (통합 보고서 작성용)

- [ ] 9 영역 각각의 paired audit skill 실행 결과 첨부
- [ ] 보고서 템플릿의 모든 섹션 채움 (FAIL 항목 = remediation table 에 등재)
- [ ] CRITICAL 항목은 즉시 보고 + remediation effort 명시
- [ ] 영향도 표의 *최근 변경 사유* 가 보고서 §3 의 FAIL/OK 상태와 일치
- [ ] `pnpm audit` 결과 첨부 ([[dependency-scanning]])

## 구현 중 막히면

- 9 영역 중 *어떤 audit skill 이 어디에 있는지* 모름 → 위 §"본 skill 의 역할" 표 참조
- paired audit 가 *없는* 영역 (예: 신규 정책) → [[ts-agent-rules]] §"새 audit 추가" 절차로 audit skill 먼저 생성 + 본 skill 의 보고서 템플릿에 행 추가
- runtime secret store 미사용 → 로컬 secret 파일 → runtime secret store 마이그 ([[secret-rotation]])
- `process.env` 사용 발견 → runtime 호환성 (instance 측 project-local) + `<framework env binding>.<NAME>` 마이그
