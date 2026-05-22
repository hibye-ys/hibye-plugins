---
name: secret-rotation
description: secret 회전 workflow — env / secret store 회전 6단계, dual-key window 24h~7d, verify 양쪽 시도 + sign/encrypt 신규 key, 누설 시 응급 회전 (window skip), audit log 의무.
metadata:
  role: workflow
  scope: project
  source: stack-backend-ts/skills/secret-rotation
---

# Secret Rotation — Workflow

## 정상 회전 절차 (계획된, 6단계)

1. 새 key 생성 + secret store 에 push (vendor 측)
2. 백엔드 ENV 에 새 key 추가 (이전 key 와 공존 — dual-key window 시작)
3. 백엔드 코드는 "validate 시 두 key 모두 시도" — verify 만 dual
4. 새 key 로 sign / encrypt 시작 — verify 는 여전히 dual
5. dual-key window 동안 모니터링 (이전 key 로 들어오는 요청 트래픽 0 도달 확인)
6. 이전 key 제거 (ENV + secret store)

dual-key window 권장: 24h~7d (key 사용 주기에 따라).

## Rotation 절차 (Dual-Key Window)

```
1. 새 key 생성 → secret store 에 version N+1 으로 add (primary 는 N 유지)
2. Code deploy: verifySecret() 이 N 과 N+1 모두 시도
3. 클라이언트가 새 key 로 전환 (관찰)
4. Promote: primary 를 N+1 으로 swap (이제 verify 는 N+1 우선, N 는 fallback)
5. Grace period (24h~7d) 후 N revoke
```

각 단계에서 metrics:
- `secret_verify_total{version}` — version 별 검증 count
- `secret_verify_failed_total{version}` — 실패 count

## 응급 회전 (누설 의심)

- dual-key window skip
- 즉시 새 key 배포 + 이전 key 무효화
- 사용자 영향 (인증 토큰 무효화) 감수 — 보안 우선
- audit log 에 `secret.emergency_rotation` 기록 ([[structured-log-schema]] level=fatal, root cause + 영향 범위 + 회전 시각)

## 회전 대상 식별

매 회전 시 일관성 보장 필요한 종속물:
- 백엔드 ENV / runtime secret store
- secret store (vault / kms / 1Password 등)
- CI/CD 변수
- 운영자 문서 / 런북

## 공통 금지

- 회전 절차 없이 단일 key 직 교체 (인증 끊김 — 윈도우 없는 cutover)
- 회전 후 이전 key 를 코드 / git history 에 잔존 (`git rm` + `git filter-repo` 필요 시)
- 회전 audit log 누락 ([[structured-log-schema]] 의 fatal level — incident response 시 timeline 부재)
- dual-key window 없이 verify 단일 key 만 (이전 토큰 일괄 거부)
- 응급 회전 사실을 사용자에게 알리지 않고 silent (강제 logout 사유 공지 의무)

## 코드 레벨 검증 체크리스트

- [ ] **Secret 읽기 단일 함수**: 모든 secret 접근이 `getSecret(name, version?)` 단일 함수 경유 — direct env 접근 금지
- [ ] **Dual-key window 지원**: rotation 중 (`primary` + `previous` 둘 다 활성), `verifySecret(token)` 이 두 key 모두 시도
- [ ] **Rotation 알림 hook**: rotation 완료 시 `onRotation(name, oldVersion, newVersion)` 콜백으로 캐시 무효화 / 메트릭 발사
- [ ] **Secret 로깅 차단**: structured-log-schema 의 PII 필터가 `*_secret`, `*_key`, `*_token` 패턴 redact
- [ ] **Secret 만료 모니터링**: 각 secret 의 `expires_at` 메트릭화 — 임박 시 알람
- [ ] **Test fixture 의 secret 은 별도 namespace**: prod secret 과 같은 이름 사용 금지

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| Big-bang rotation (dual-key window 없이 swap) | rotation 시점에 in-flight 요청 모두 401 | dual-key window 강제 |
| Code 가 env 직접 읽기 | rotation 후 process restart 필요 | getSecret 함수 + cache invalidation hook |
| Secret 이 log 에 plain | log aggregator 가 archive 후 영구 leak | PII 필터 강제 + log 검증 audit |
| Test 가 prod secret 사용 | test 실패 시 prod secret 노출 위험 | namespace 분리 + lint rule |
