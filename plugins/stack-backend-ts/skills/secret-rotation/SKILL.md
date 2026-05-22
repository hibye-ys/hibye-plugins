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

## 응급 회전 (누설 의심)

- dual-key window skip
- 즉시 새 key 배포 + 이전 key 무효화
- 사용자 영향 (인증 토큰 무효화) 감수 — 보안 우선
- audit log 에 `secret.emergency_rotation` 기록 ([[structured-log-schema]] level=critical, root cause + 영향 범위 + 회전 시각)

## 회전 대상 식별

매 회전 시 일관성 보장 필요한 종속물:
- 백엔드 ENV / runtime secret store
- secret store (vault / kms / 1Password 등)
- CI/CD 변수
- 운영자 문서 / 런북

## 공통 금지

- 회전 절차 없이 단일 key 직 교체 (인증 끊김 — 윈도우 없는 cutover)
- 회전 후 이전 key 를 코드 / git history 에 잔존 (`git rm` + `git filter-repo` 필요 시)
- 회전 audit log 누락 ([[structured-log-schema]] 의 critical level — incident response 시 timeline 부재)
- dual-key window 없이 verify 단일 key 만 (이전 토큰 일괄 거부)
- 응급 회전 사실을 사용자에게 알리지 않고 silent (강제 logout 사유 공지 의무)
