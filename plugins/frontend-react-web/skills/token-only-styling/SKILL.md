---
name: token-only-styling
description: Tailwind v4 / CSS variable 디자인 토큰만 사용 강제. Tailwind arbitrary color (bg-[#xxx]) / 인라인 style 색 (color, backgroundColor 등) / 토큰 정의 외부의 raw color function 검출. 다크모드 + 대비 + 런타임 테마 스위칭 가능 기반.
metadata:
  priority: 5
  docs:
    - "https://tailwindcss.com/docs/theme"
    - "https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties"
    - "https://www.w3.org/WAI/WCAG21/quickref/#contrast-minimum"
  pathPatterns:
    - 'src/**/*.tsx'
    - 'src/**/*.jsx'
    - 'src/**/*.css'
    - 'src/**/*.scss'
    - 'src/**/*.module.css'
    - 'src/**/*.module.scss'
    - 'app/**/*.tsx'
    - 'app/**/*.css'
    - 'app/**/*.scss'
    - 'components/**/*.tsx'
    - 'components/**/*.css'
    - 'styles/**/*.css'
    - 'styles/**/*.scss'
    - 'tailwind.config.{js,ts,mjs,cjs}'
  bashPatterns: []
  importPatterns:
    - 'tailwindcss'
    - 'clsx'
    - 'tailwind-merge'
    - '@vanilla-extract/css'
validate:
  - pattern: '(bg|text|border|border-x|border-y|border-t|border-b|border-l|border-r|ring|ring-offset|outline|fill|stroke|shadow|from|to|via|decoration|accent|caret|placeholder|divide)-\[#[0-9a-fA-F]{3,8}\]'
    message: 'Tailwind arbitrary hex (bg-[#xxx]) — 디자인 토큰 우회. tailwind.config / @theme 에 토큰 등록 후 bg-{token-name} 사용.'
    severity: error
  - pattern: '(bg|text|border|border-x|border-y|border-t|border-b|border-l|border-r|ring|ring-offset|outline|fill|stroke|shadow|from|to|via|decoration|accent|caret|placeholder|divide)-\[(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb|color|color-mix)\('
    message: 'Tailwind arbitrary color function (bg-[rgb(...)]) — 디자인 토큰 우회. 토큰화 필수.'
    severity: error
  - pattern: 'style=\{\s*\{[^}]*\b(color|background|backgroundColor|borderColor|fill|stroke|outlineColor)\s*:\s*["''][^"'']*#[0-9a-fA-F]{3,8}'
    message: 'JSX 인라인 style 안 하드코딩 색 (camelCase / kebab-case 모두). className + 토큰 사용. (multiple props in single style object → 1 match per object — gate 목적엔 충분)'
    severity: error
  - pattern: 'style=\{\s*\{[^}]*\b(color|background|backgroundColor|borderColor|fill|stroke|outlineColor)\s*:\s*["''][^"'']*(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb|color|color-mix)\s*\('
    message: 'JSX 인라인 style 안 raw color function. className + 토큰 사용.'
    severity: error
retrieval:
  aliases:
    - design tokens
    - tailwind theme
    - css variables
    - dark mode
    - theming
  intents:
    - set up design tokens
    - theme switching
    - dark mode
    - color system
    - tailwind config
  entities:
    - "@theme"
    - var()
    - tailwind
    - css variable
    - design token
chainTo: []
---

# token-only-styling

**모든 색 / spacing / radius / shadow / motion 값은 디자인 토큰 통해서만.** 하드코딩은 다크모드 / 대비 / 런타임 테마 스위칭을 깨트림.

## When to apply

- 새 컴포넌트 styling 작성
- Tailwind class / inline `style={...}` / CSS module / styled-components / vanilla-extract 어느 방식이든
- `tailwind.config` 또는 `@theme` 정의 갱신
- 다크모드 / 테마 변환 작업
- 외부 디자인 시스템 (shadcn / Radix Themes / Material) 통합

## 핵심 원칙

### 1. 색 = 토큰만

- Tailwind v4: `@theme { --color-primary: oklch(...); }` → `bg-primary`
- Tailwind v3: `tailwind.config.{js,ts}` `theme.extend.colors` → `bg-primary`
- CSS variable: `:root { --color-primary: ...; }` → `background: var(--color-primary)`
- *절대 ✕*: `bg-[#3b82f6]`, `style={{color:'#fff'}}`, `style={{backgroundColor:'rgb(...)'}}` (validate 가 자동 검출)

### 2. spacing / radius / shadow / motion 도 토큰

- `p-4` (Tailwind scale) 또는 `p-[var(--space-md)]`
- `rounded-md` / `rounded-[var(--radius-card)]`
- `shadow-md` / `shadow-[var(--shadow-overlay)]`
- `transition-[var(--motion-default)]`

### 3. 런타임 테마 스위칭 가능 형태

- 빌드 시점 색 고정 ✕ — CSS variable 로 두면 `<html data-theme="dark">` 같이 attribute 로 즉시 스위치
- Tailwind v4 `@variant dark` + `<html class="dark">` 도 OK

### 4. 대비 ≥ 4.5:1 (WCAG AA 본문) / 3:1 (large text)

- 토큰 정의 시점에 대비 검증 (디자인 도구) — pair contrast 사전 약속
- `--color-foreground-on-primary` 같이 *pair* 로 토큰 분리

### 5. 색만으로 상태 ✕

- 빨강 = 에러 — 색맹 차단. semantic-a11y 의 원칙과 일치
- 색 + icon + 텍스트 ≥ 2종

### 6. shadcn / Radix Themes 통합 시

- shadcn ui — 컴포넌트 *코드 복사* (npm 의존 ✕, vercel:shadcn skill 권장)
- 컴포넌트가 사용하는 변수 (`--background`, `--foreground` 등) 를 *우리 토큰으로 매핑*

## validate 가 잡지 *않는* 케이스 (의도)

token 정의 *자체* 는 raw color function 을 사용해야 함 — false positive 방지 위해 validate 패턴은 *사용처* (inline style / Tailwind arbitrary) 만 검출. token 정의 시 raw `oklch(...)` 자유로움:

```css
/* 검출 ✕ — @theme 안 정의는 raw color 필수 */
@theme {
  --color-primary: oklch(60% 0.2 250);  /* OK */
}

:root {
  --color-bg: oklch(99% 0.005 240);     /* OK */
}
```

```tsx
{/* 검출 O — 사용처에서 raw color */}
<div style={{ backgroundColor: '#3b82f6' }} />          {/* validate error */}
<div className="bg-[#3b82f6]" />                        {/* validate error */}
<div style={{ color: 'rgb(59,130,246)' }} />            {/* validate error */}
```

> raw `#fff` / `#aabbcc` / `rgb(...)` 가 CSS 파일 안 *컴포넌트 룰* 에 직접 쓰인 케이스 — 본 validate 미커버. ESLint custom rule (`no-color-literal-in-css`) 또는 stylelint 의 `color-no-hex` 위임 권장.

## 도구 위임

- **정적 (Tailwind arbitrary)**: custom ESLint rule (`no-tailwind-arbitrary-color`) — repo 안에 추가 권장. frontmatter `validate:` 는 IDE 즉시 표시 보완.
- **정적 (CSS raw color)**: stylelint `color-no-hex` / `color-named` — CSS 파일 안 모든 raw color 검출.
- **빌드 시점**: Tailwind 의 unused token 경고 / typed-css-modules
- **디자인 사이드**: Figma variables / Stark 대비 검증 / Token Studio
- **다크모드 시각 회귀**: Playwright + Percy / Chromatic

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `bg-[#3b82f6]` | `bg-primary` (`@theme` 등록 후) | **validate (error)** |
| `bg-[rgb(59,130,246)]` | `bg-primary` | **validate (error)** |
| `style={{color:'#fff'}}` | `className="text-foreground"` | **validate (error)** |
| `style={{backgroundColor:'#fff'}}` | `className="bg-bg"` | **validate (error)** |
| `style={{borderColor:'rgb(...)'}}` | `className="border-border"` | **validate (error)** |
| `.foo { color: #aabbcc; }` (CSS 사용처) | `.foo { color: var(--color-...); }` | stylelint 위임 |
| 색만 상태 (빨강 = error) | 색 + icon + 텍스트 | 수동 (semantic-a11y) |
| `style={{ padding: '8px 12px' }}` | `className="px-3 py-2"` | 수동 리뷰 |
| Tailwind config 안 raw hex (`primary: '#3b82f6'`) | OKLCH 또는 token meta 추가 | 수동 리뷰 |

## Tailwind v4 `@theme` 예시

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  --color-bg: oklch(99% 0.005 240);
  --color-fg: oklch(20% 0.02 240);
  --color-primary: oklch(60% 0.2 250);
  --color-primary-fg: oklch(98% 0 0);
  --color-error: oklch(58% 0.22 28);
  --color-error-fg: oklch(98% 0 0);

  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 1rem;

  --shadow-overlay: 0 10px 30px -10px oklch(0% 0 0 / 0.3);
}

@variant dark {
  --color-bg: oklch(15% 0.02 240);
  --color-fg: oklch(95% 0.005 240);
  --color-primary: oklch(70% 0.22 250);
}
```

```tsx
// usage
<button className="bg-primary text-primary-fg rounded-md shadow-overlay">
  Save
</button>
```

## 외부 디자인 시스템 통합 패턴

- shadcn/ui 사용 시 — `@theme` 변수를 shadcn 의 CSS variable 이름과 alias (e.g. `--background: var(--color-bg)`)
- Radix Themes — `<Theme>` provider 의 token mapping 활용
- 디자인 토큰 single source of truth — Figma variables 또는 Token Studio export → `@theme` 으로 sync

## 참조

- [Tailwind v4 `@theme`](https://tailwindcss.com/docs/theme)
- [MDN CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties)
- [WCAG 2.1 contrast](https://www.w3.org/WAI/WCAG21/quickref/#contrast-minimum)
- [stylelint color-no-hex](https://stylelint.io/user-guide/rules/list/color-no-hex)
- [Style Dictionary](https://amzn.github.io/style-dictionary/) · [Token Studio](https://tokens.studio/)
- [shadcn/ui theming](https://ui.shadcn.com/docs/theming)
