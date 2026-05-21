# Pack 시스템 룰 (확장성 보장)

근거: `docs/superpowers/specs/2026-05-20-pack-abstraction-design.md` section 10. 매 작업마다 자동 적용되는 룰 — spec 은 한 번 작성하고 끝이지만 룰은 매번 강제력 가져야 함.

### 1. 신규 UI 컴포넌트는 CSS 변수 기반 Tailwind 클래스만

`bg-card`, `text-foreground`, `border-border` 등 — 모두 OK.
hex / rgb / oklch / hsl / arbitrary 색 (`bg-[#xxx]`) 모두 금지.

ESLint rule `no-tailwind-arbitrary-color` (eslint-rules/) 가 강제.

### 2. AppTokens 의 신규 색은 optional + default fallback

`AppColors` 인터페이스에 새 필드 추가 시 `?` 로 optional + 모든 사용처에 fallback 헬퍼.
기존 5개 Pack 이 안 깨지게 — 새 필드 안 채워도 동작.

### 3. PersonaPack 의 신규 능력 필드는 전부 optional

`voice / systemPrompt` 외 모든 신규는 `?`. RAG / tool / memory / safety policy 같은 미래 능력 도입 시 기존 Pack 무영향.

### 4. Pack 최상위에 새 영역 추가 가능

`motion?`, `sound?`, `haptic?` 같은 신규 영역 — optional 로 추가. `version` semver bump + migrate.

### 5. 렌더러 내부 색 literal 전면 금지

`brand` 채널만 참조. hex (`0xb89968`) / `rgb(` / `oklch(` / `hsl(` / template literal 안의 색 모두 금지.

ESLint rule `no-color-literal-in-renderer` (eslint-rules/) 가 강제.

**예외 허용은 비색 수치만** — 반지름, alpha 값, font size, letter-spacing 같은 숫자는 module const 로 허용 (이게 렌더러 정체성 const). 색은 절대 X.

## 관련 파일

- 인터페이스: `src/lib/packs/types.ts`
- zod schema: `src/lib/packs/schema.ts`
- BrandConfig 채널: `src/canvas-engine/BrandConfig.ts`
- 빌트인 Pack: `src/lib/packs/builtin/`
- store: `src/store/pack.ts` + `src/store/appearance.ts` + `src/store/personas.ts`
- UI: `src/components/PackPicker.tsx`
- 룰 강제: `eslint-rules/no-color-literal-in-renderer.js`, `eslint-rules/no-tailwind-arbitrary-color.js`

## 룰을 깨야 할 때

깨지 마라. 정말 필요하면 spec 재검토 + AGENTS.md 갱신.
