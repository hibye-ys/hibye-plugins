# Vite + React + Tailwind v4 토큰 룰

본 디렉토리 안 모든 파일 작업 시 적용. 공통 invariant 는 root `AGENTS.md` 참고.

## 스택

- **Vite + React 19 + React Router 7 (SPA)** — 3 클라이언트 (웹·데스크탑·모바일) 균일 코드 전제
- **상태** = Zustand (이미 도입)
- **스타일** = Tailwind v4 `@theme` + CSS 변수 (디자인 토큰)

## 디자인 토큰 only

- 하드코딩 색·타이포·간격 ✕ — 토큰 통해서만
- 테마는 런타임 스위칭 가능 (빌드 시점 고정 ✕)

## 컴포넌트

- shadcn/ui 코드 복사 (npm 의존성 ✕) — `packages/ui-catalog/` 신설 후 3 클라이언트 공유

---
