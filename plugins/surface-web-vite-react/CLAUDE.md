# surface-web-vite-react

`apps/web` 같은 *Vite + React + Tailwind v4* SPA 작업 시 적용. 3 클라이언트 (웹·데스크탑·모바일) 균일 코드 전제.

본 plugin 의 상시 룰 본문:

@./rules/vite-react-tokens.md
@./rules/pack-system.md

## on-demand 체크리스트

- `verify-token-only-styling` — 하드코드 색·간격·Tailwind arbitrary color (`bg-[#xxx]`) 검출. UI 작업 마무리 단계에 실행.

## 관련 spec

- `docs/superpowers/specs/2026-05-21-shared-agent-marketplace-design.md` §3.2 (L3 frontend surface), §10.M1
- `docs/superpowers/specs/2026-05-20-pack-abstraction-design.md` §10 (확장성 룰 5종)
