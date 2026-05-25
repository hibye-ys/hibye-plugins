---
name: cors-policy
description: CORS invariant — origin allowlist, credentials, preflight cache, expose_headers FE contract, vary 헤더. wildcard origin 금지, credentials + wildcard 조합 금지, Origin reflect 금지.
metadata:
  role: invariant
  scope: project
---

# CORS Policy — 언어 무관 불변식

CORS 표준 5 헤더 (`Allow-Origin` / `Allow-Credentials` / `Allow-Methods` / `Allow-Headers` / `Expose-Headers`) + `Max-Age` / `Vary` 정의는 web spec 정본 (MDN / fetch spec). 본 invariant 는 *프로젝트 운영 결정* 만 강제.

## expose_headers (FE contract)

JS `response.headers.get(...)` 로 읽어야 하는 모든 커스텀 헤더 명시. 누락 시 silent FE break. 변경은 breaking change — FE 와 함께 배포.

본 plugin 의 [[http-error-sentinels]] 가 정의한 **7종** 은 `Expose-Headers` 에 반드시 포함:

- `X-App-Session-Id` / `X-App-Agent` / `X-App-Model` / `X-App-Run-Id` / `X-App-Moderation-Status` / `X-App-Jailbreak-Status` / `X-Request-Id`

## origin allowlist — 단일 SoT

- env / config 단일 출처 (코드 하드코딩 ✕)
- 사용자 입력 (Origin 헤더) 그대로 reflect ✕ — 화이트리스트 매칭 후 echo
- `Origin: null` 허용 ✕ (sandboxed iframe / file:// 우회)

## Preflight / Vary

- `Access-Control-Max-Age`: 24h~1d 권장 (운영 결정 — 너무 짧으면 preflight 폭증, 너무 길면 정책 변경 적용 지연)
- `Vary: Origin` 필수 — CDN/proxy origin 별 응답 분리 캐시 (누락 시 캐시 오염)
- preflight 응답은 `204 No Content` (본문 ✕)

## 공통 금지

- origin `*` + credentials `true` (브라우저 거부 — 표준 위반)
- credentials 가 필요 없는 endpoint 도 `Allow-Credentials: true` (공격면 확대)
- `Allow-Methods: *` (의도치 않은 verb 허용 — 명시적 열거)
- 새 커스텀 응답 헤더 추가 시 expose_headers 미갱신 (FE silent break)
- `Vary: Origin` 누락 (CDN 캐시 오염)

## audit / 검증

grep 패턴 + 자동 차단 검증은 [[cors-policy-audit]] 정본.
