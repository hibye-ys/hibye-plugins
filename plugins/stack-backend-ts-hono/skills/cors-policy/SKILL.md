---
name: cors-policy
description: CORS invariant — origin allowlist, credentials, preflight cache, expose_headers FE contract, vary 헤더. wildcard origin 금지, credentials + wildcard 조합 금지, Origin reflect 금지.
metadata:
  role: invariant
  scope: project
  source: stack-backend-ts/skills/cors-policy
---

# CORS Policy — 언어 무관 불변식

## 핵심 헤더 5종

| 헤더 | 의미 | 제약 |
|------|------|------|
| Access-Control-Allow-Origin | 허용 origin | 신뢰 도메인 화이트리스트 (env). `*` 금지 시 credentials 안전 |
| Access-Control-Allow-Credentials | 쿠키/auth 헤더 허용 | `true` 시 origin `*` 금지 (브라우저 거부) |
| Access-Control-Allow-Methods | 허용 method | preflight 응답 |
| Access-Control-Allow-Headers | 허용 request 헤더 | preflight 응답 |
| Access-Control-Expose-Headers | JS 가 읽을 응답 헤더 | FE contract — 변경 시 breaking |

## Preflight 캐시

`Access-Control-Max-Age` 헤더로 preflight 응답 캐시 기간 지정. 24h~1d 권장. 너무 짧으면 preflight 폭증, 너무 길면 정책 변경 적용 지연.

## Vary 헤더

`Vary: Origin` 필수 — CDN/proxy 가 origin 별 응답 분리 캐시. 누락 시 한 origin 응답이 다른 origin 에 served 되는 캐시 오염.

## expose_headers (FE contract)

JS `response.headers.get(...)` 로 읽어야 하는 모든 커스텀 헤더 명시. 누락 시 silent FE break. 변경은 breaking change — FE 와 함께 배포.

본 plugin 의 [[http-error-sentinels]] 가 정의한 7종 (X-App-Session-Id, X-App-Agent, X-App-Model, X-App-Run-Id, X-App-Moderation-Status, X-App-Jailbreak-Status, X-Request-Id) 는 expose_headers 에 반드시 포함.

## 공통 금지

- origin `*` + credentials `true` (브라우저가 거부)
- 사용자 입력 (Origin 헤더) 그대로 reflect (반드시 화이트리스트 매칭 후 echo)
- credentials 가 필요 없는 endpoint 도 무조건 `Allow-Credentials: true` (공격면 확대)
- `Vary: Origin` 누락 (CDN 캐시 오염)
- 새 커스텀 응답 헤더 추가 시 expose_headers 미갱신 (FE silent break)
- preflight 응답에 본문 포함 (`204 No Content` 이어야 함)
