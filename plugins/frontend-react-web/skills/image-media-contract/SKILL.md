---
name: image-media-contract
description: <img> raw 사용 / width-height 누락 (CLS 유발) / loading attribute 누락 검출. next/image / framework Image component 권장 + LCP priority + responsive sizes + AVIF/WebP 안내. vercel:react-best-practices image 룰 보완.
metadata:
  priority: 4
  docs:
    - "https://web.dev/articles/lcp"
    - "https://web.dev/articles/cls"
    - "https://nextjs.org/docs/app/api-reference/components/image"
    - "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img#attributes"
  pathPatterns:
    - 'src/**/*.{tsx,jsx}'
    - 'app/**/*.{tsx,jsx}'
    - 'components/**/*.{tsx,jsx}'
    - 'src/components/**/*.{tsx,jsx}'
  bashPatterns: []
  importPatterns:
    - 'next/image'
    - '@remix-run/dev'
    - 'astro/assets'
    - 'gatsby-plugin-image'
    - 'react'
validate:
  - pattern: '<img\b(?![^>]*\bsrc=)[^>]*>|<img\b[^>]*\bsrc='
    message: 'raw <img> 사용 감지 — Next.js / Remix / Astro 환경이면 framework Image component (next/image 등) 권장. priority/loading/sizes 자동.'
    severity: warn
  - pattern: '<img\b(?![^>]*\b(width|height)=)'
    message: 'raw <img> 에 width 또는 height attribute 누락 — CLS (layout shift) 유발. width/height (px 단위) 또는 framework Image component (aspect ratio 자동) 사용.'
    severity: error
  - pattern: '<img\b(?![^>]*\bloading=)(?![^>]*\bsrc=["''][^"'']*(\.svg|data:))'
    message: 'raw <img> 에 loading attribute 누락 — `loading="lazy"` (off-screen) 또는 `loading="eager"` (LCP) 명시. SVG / data URL 은 무관.'
    severity: warn
retrieval:
  aliases:
    - next/image
    - LCP
    - CLS
    - lazy loading
    - responsive image
    - alt text
  intents:
    - optimize image loading
    - prevent CLS
    - LCP optimization
    - responsive image
    - AVIF WebP
  entities:
    - img
    - next/image
    - loading
    - width
    - height
    - sizes
    - srcset
chainTo: []
---

# image-media-contract

**이미지 = 가장 흔한 LCP / CLS 원인.** raw `<img>` + width/height 누락 = layout shift / dimensioning 실패. 본 skill 은 *framework Image 권장 + raw img attribute 검출* . LCP / CLS 깊은 audit 은 Lighthouse / vercel:react-best-practices 위임.

## When to apply

- 이미지 / 비디오 / iframe 추가
- LCP / CLS Web Vitals 개선
- 다크모드 이미지 변경
- responsive layout 안 image
- third-party 이미지 (외부 CDN / user upload)

## 핵심 원칙

### 1. framework Image component 우선

- Next.js → `next/image`, Remix → `@remix-run/dev` / `unpic-img`, Astro → `astro/assets`, Vite → `vite-imagetools`
- 자동 = AVIF / WebP 변환 / responsive srcset / lazy / placeholder blur / priority
- 외부 도메인 = `next.config.js` `images.remotePatterns` 명시 필수
- *Vite SPA 만* = `<img>` + 명시적 attribute 모두 (framework Image 미사용)

### 2. width + height = CLS 방지

- raw `<img>` = width / height attribute 의무
- aspect ratio 보존 — browser 가 placeholder space 미리 reserve
- `width="800" height="600"` (px) — actual ratio 와 일치, CSS 로 max-width / height auto

### 3. loading attribute 명시

- `loading="lazy"` = off-screen 이미지 (대부분)
- `loading="eager"` = LCP 이미지 (above-the-fold + 큰 hero)
- 미명시 default = "eager" (browser 따라 차이 있어 명시 권장)

### 4. LCP 이미지 = priority / fetchPriority="high"

- above-the-fold 의 *가장 큰* 이미지 = LCP candidate
- `next/image` 의 `priority={true}` — preload + decode async
- `<img fetchPriority="high">` (browser native)
- LCP 후보 1개만 — 모든 이미지에 priority ✕ (의미 사라짐)

### 5. responsive = sizes + srcset

- `next/image` 자동 — `sizes="(max-width: 768px) 100vw, 50vw"`
- raw `<img>` 도 `srcSet` + `sizes` 명시
- art direction (다른 crop) = `<picture>` + `<source>`

### 6. AVIF / WebP 권장

- 모던 browser = AVIF (best) > WebP > JPEG / PNG (fallback)
- `<picture>` + `<source type="image/avif">` 또는 framework Image 자동
- file size 30-50% 감소 = LCP 직접 영향

### 7. alt 의무 (semantic-a11y cross-ref)

- 의미 이미지 → `alt="설명"`
- 장식 → `alt=""` (empty, NOT 누락)
- icon button → 부모 button 에 `aria-label`
- jsx-a11y/alt-text 가 검출 — 본 plugin validate ✕

### 8. SVG inline vs file

- icon / 작은 그림 = inline SVG (HTTP 호출 ✕, CSS controllable)
- 큰 illustration = file (browser 캐시) + lazy
- inline SVG 도 `aria-label` / `aria-hidden` 명시

## 도구 위임 (이 skill 의 진입점 역할)

- **빌드 시점**: Next.js Image / Remix unpic-img — AVIF/WebP/srcset 자동
- **정적**: jsx-a11y/alt-text (alt 검증) — semantic-a11y 위임
- **정적**: vercel:react-best-practices image 룰 — chainTo 가능
- **CI**: Lighthouse CI — LCP / CLS 자동 측정
- **runtime**: PerformanceObserver `largest-contentful-paint` — RUM 직접 측정

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `<img src="..." />` (Next.js 안) | `<Image>` from next/image | **validate (warn)** |
| `<img>` width/height 누락 | `width="..." height="..."` 또는 framework Image | **validate (error)** |
| `<img>` loading attribute 누락 | `loading="lazy"` / `eager` | **validate (warn)** |
| 모든 이미지 priority=true | LCP 후보 1개만 priority | 수동 |
| LCP hero 이미지 lazy | `loading="eager"` + `fetchPriority="high"` | 수동 |
| JPEG / PNG 만 | AVIF / WebP + fallback `<picture>` | 수동 |
| inline SVG 에 `aria-hidden` 없음 (장식) | `aria-hidden="true"` | 수동 |
| 외부 CDN 이미지에 lazy 안 함 | `loading="lazy"` + CDN 측 max-age | 수동 |
| `<img>` alt 누락 (의미 이미지) | `alt="설명"` | jsx-a11y/alt-text (semantic-a11y) |
| `<img>` 가 `<a>` 안에 있는데 alt="" + a 도 label 없음 | a 에 aria-label 또는 img 에 alt | jsx-a11y |
| video 가 autoplay + 큰 size (LCP poisoning) | `<video preload="metadata">` + poster | 수동 |
| 다크모드 이미지 swap 자체 구현 | CSS `<picture><source media="(prefers-color-scheme: dark)">` | 수동 |

## next/image 패턴 (Next.js)

```tsx
import Image from 'next/image'

// Hero (LCP 후보) - 1 page 1개만
function Hero() {
  return (
    <Image
      src="/hero.jpg"
      width={1920}
      height={1080}
      sizes="100vw"
      priority
      alt="Product hero shot"
    />
  )
}

// 일반 이미지 (lazy)
function PostCard({ post }: Props) {
  return (
    <article>
      <Image
        src={post.cover}
        width={400}
        height={225}
        sizes="(max-width: 768px) 100vw, 400px"
        alt={post.title}
      />
    </article>
  )
}
```

자동: AVIF / WebP / srcset / lazy / decode async / placeholder blur (옵션).

## raw `<img>` (Vite SPA 등 framework Image 미사용) 패턴

```tsx
function Avatar({ user }: { user: User }) {
  return (
    <img
      src={user.avatarUrl}
      srcSet={`${user.avatarUrl}?w=64 64w, ${user.avatarUrl}?w=128 128w, ${user.avatarUrl}?w=256 256w`}
      sizes="(max-width: 768px) 64px, 128px"
      width={128}
      height={128}
      alt={`${user.name} avatar`}
      loading="lazy"
      decoding="async"
    />
  )
}
```

명시적 = framework Image 보다 manual 하지만 SPA 환경 호환.

## `<picture>` art direction + AVIF fallback 패턴

```tsx
function HeroImage() {
  return (
    <picture>
      <source
        type="image/avif"
        srcSet="/hero.avif"
      />
      <source
        type="image/webp"
        srcSet="/hero.webp"
      />
      <img
        src="/hero.jpg"
        width={1920}
        height={1080}
        alt="Product hero"
        loading="eager"
        fetchPriority="high"
      />
    </picture>
  )
}
```

## 다크모드 이미지 swap 패턴

```tsx
function ThemeAwareLogo() {
  return (
    <picture>
      <source
        media="(prefers-color-scheme: dark)"
        srcSet="/logo-dark.svg"
      />
      <img
        src="/logo-light.svg"
        width={120}
        height={32}
        alt="MyApp logo"
      />
    </picture>
  )
}
```

JS 없이 OS theme 따라 자동.

## 참조

- [web.dev — Largest Contentful Paint](https://web.dev/articles/lcp) · [Cumulative Layout Shift](https://web.dev/articles/cls)
- [Next.js — Image component](https://nextjs.org/docs/app/api-reference/components/image)
- [MDN — `<img>` attributes](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img#attributes) · [`<picture>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/picture)
- [unpic-img (framework-agnostic)](https://unpic.pics/)
- [Squoosh — AVIF/WebP 변환](https://squoosh.app/)
- [vercel:react-best-practices image 룰](~/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/react-best-practices/SKILL.md)
