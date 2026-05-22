---
name: security-dom-sinks
description: React Web frontend 의 DOM sink 보안 검출 — dangerouslySetInnerHTML / eval / new Function / postMessage target_origin="*" / document.write 5 개 패턴. CSP / Trusted Types / DOMPurify 통합 권장.
metadata:
  priority: 5
  docs:
    - "https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage"
    - "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP"
    - "https://developer.chrome.com/docs/web-platform/trusted-types"
    - "https://owasp.org/www-community/attacks/DOM_Based_XSS"
    - "https://github.com/cure53/DOMPurify"
  pathPatterns:
    - 'src/**/*.tsx'
    - 'src/**/*.jsx'
    - 'src/**/*.ts'
    - 'src/**/*.js'
    - 'app/**/*.tsx'
    - 'app/**/*.jsx'
    - 'app/**/*.ts'
    - 'components/**/*.tsx'
    - 'components/**/*.jsx'
    - 'lib/**/*.{ts,tsx,js,jsx}'
  bashPatterns: []
  importPatterns:
    - 'dompurify'
    - 'isomorphic-dompurify'
    - 'react-dom'
validate:
  - pattern: 'dangerouslySetInnerHTML\s*=\s*\{\{'
    message: 'dangerouslySetInnerHTML 사용 — DOMPurify 등 sanitize 의무. user content 면 server-side sanitize 또는 안전한 alternative (markdown lib).'
    severity: error
  - pattern: '\beval\s*\('
    message: 'eval() — 코드 인젝션 위험. JSON.parse / Function dispatcher / WebAssembly 대체.'
    severity: error
  - pattern: 'new\s+Function\s*\('
    message: 'new Function() — eval 등가 동적 코드 실행. dispatcher 패턴 또는 sandboxed iframe 사용.'
    severity: error
  - pattern: 'postMessage\s*\(\s*[^,]+,\s*[''"]\*[''"]'
    message: 'postMessage target_origin = "*" — 모든 origin 에 노출. literal URL (예: "https://example.com") 명시.'
    severity: error
  - pattern: 'document\.write\s*\('
    message: 'document.write() — DOM XSS / 페이지 재로드 동작 부작용. React rendering 사용.'
    severity: error
retrieval:
  aliases:
    - DOM XSS
    - CSP
    - Trusted Types
    - dangerouslySetInnerHTML
    - DOMPurify
  intents:
    - prevent XSS
    - sanitize HTML
    - secure postMessage
    - configure CSP
    - block eval
  entities:
    - dangerouslySetInnerHTML
    - eval
    - postMessage
    - CSP
    - Trusted Types
    - DOMPurify
chainTo: []
---

# security-dom-sinks

**5 가지 DOM sink 패턴 = 즉각 위험.** dangerouslySetInnerHTML / eval / new Function / postMessage target="*" / document.write. 본 skill 은 *즉시 검출 + 안전한 대안 + CSP / Trusted Types 통합 안내*. 깊은 검증은 ESLint `react/no-danger` + security-focused plugins (`eslint-plugin-security` 등) 위임.

## When to apply

- 외부 / user-content HTML 렌더링
- 동적 코드 실행 (라이브러리 통합 시)
- iframe / window 간 통신 (postMessage)
- 동적 DOM 조작 (document.write 등)
- Content Security Policy 헤더 설정

## 핵심 원칙

### 1. dangerouslySetInnerHTML 최소 + DOMPurify 의무

- React 에서 user-controlled HTML 표시 = 거의 항상 위험. 가능하면 *markdown library* (react-markdown / @mdx-js/react) 위임 — sanitize 내장.
- 불가피하면 `DOMPurify.sanitize(html)` 의무. `isomorphic-dompurify` (SSR + client 동일).
- *server-side sanitize 가 더 안전* — client sanitize 는 bypass 가능.

### 2. eval / new Function = 절대 ✕

- JSON 파싱 → `JSON.parse`
- 동적 dispatcher → 화이트리스트 lookup table (`Record<string, () => void>`)
- 진짜 dynamic eval 필요 → sandboxed iframe (sandbox="allow-scripts") 또는 WebAssembly

### 3. postMessage target_origin = literal URL

- `window.postMessage(data, "*")` → 모든 origin 노출
- `window.postMessage(data, "https://trusted.example.com")` → 해당 origin 만
- receive side 도 `event.origin` 검증 의무

### 4. document.write 사용 ✕

- React rendering 사용 (state → render)
- legacy script integration 만이라면 dynamic `<script>` element 생성 + sandbox attribute

### 5. Trusted Types policy 권장 (Chromium)

- CSP 헤더 `Content-Security-Policy: require-trusted-types-for 'script'`
- `trustedTypes.createPolicy('app', { createHTML: (input) => DOMPurify.sanitize(input) })`
- assign `el.innerHTML = trustedHTML` 만 가능
- Firefox / Safari 미지원 — graceful degrade

### 6. CSP 헤더 = strict-dynamic + nonce

- `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-XXX' 'strict-dynamic'`
- 매 request 마다 새 nonce 생성 (Next.js `middleware` / Vite 의 build-time hash)
- `'unsafe-inline'` / `'unsafe-eval'` 사용 ✕

### 7. iframe sandbox attribute

- 외부 widget / 광고 iframe → `<iframe sandbox="allow-scripts">` (최소 권한)
- `allow-same-origin` 동시 사용 ✕ (sandbox 우회 가능)

## 도구 위임 (이 skill 의 진입점 역할)

- **정적**: `eslint-plugin-react` `react/no-danger` — dangerouslySetInnerHTML 검출 (validate 보완)
- **정적**: `eslint-plugin-security` `detect-eval-with-expression` 등
- **빌드 시점**: Vite / Next.js 의 CSP 헤더 생성 플러그인
- **런타임 검증**: CSP `report-uri` / `report-to` — 위반 reporting
- **수동 audit**: OWASP ZAP / Burp Suite — penetration testing

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `dangerouslySetInnerHTML={{__html: userInput}}` | `DOMPurify.sanitize(userInput)` 또는 markdown lib | **validate (error)** |
| `eval(expr)` | JSON.parse / dispatcher table | **validate (error)** |
| `new Function(code)` | dispatcher table / sandboxed iframe | **validate (error)** |
| `window.postMessage(data, "*")` | literal URL target_origin | **validate (error)** |
| `document.write(html)` | React state + render | **validate (error)** |
| `el.innerHTML = userInput` (raw DOM) | DOMPurify + Trusted Types | 수동 / react/no-danger 보완 |
| CSP header 부재 | helmet (Node) / next.config CSP / middleware nonce | 수동 |
| `'unsafe-inline'` CSP | nonce + strict-dynamic | 수동 |
| iframe sandbox 없음 | `sandbox="allow-scripts"` 최소 권한 | 수동 |
| event listener 안 origin 미검증 | `if (event.origin !== TRUSTED_ORIGIN) return` | 수동 |

## DOMPurify 패턴 (SSR 안전)

```tsx
import DOMPurify from 'isomorphic-dompurify'

function MarkdownContent({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'a', 'em', 'strong', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'rel', 'target'],
  })
  return <div dangerouslySetInnerHTML={{ __html: clean }} />
}
```

> `react-markdown` / `@mdx-js/react` 사용이 더 안전. raw HTML 불가피한 경우만 위 패턴.

## Trusted Types policy 패턴 (Chromium)

```ts
// app/main.tsx or app initializer
if (window.trustedTypes?.createPolicy) {
  window.trustedTypes.createPolicy('default', {
    createHTML: (input: string) => DOMPurify.sanitize(input),
    createScriptURL: (input: string) => {
      const url = new URL(input, window.location.origin)
      if (!ALLOWED_HOSTS.includes(url.host)) throw new Error('Untrusted script URL')
      return input
    },
    createScript: () => { throw new Error('Inline script blocked') },
  })
}
```

CSP header 동반:
```
Content-Security-Policy: require-trusted-types-for 'script'; trusted-types default
```

## CSP nonce 패턴 (Next.js middleware)

```ts
// middleware.ts
import { NextResponse } from 'next/server'

export function middleware(request: Request) {
  const nonce = crypto.randomBytes(16).toString('base64')
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'unsafe-inline';
    object-src 'none';
    base-uri 'self';
    frame-ancestors 'none';
    require-trusted-types-for 'script';
  `.replace(/\s{2,}/g, ' ').trim()

  const response = NextResponse.next()
  response.headers.set('Content-Security-Policy', cspHeader)
  response.headers.set('x-nonce', nonce)
  return response
}
```

## 참조

- [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) · [strict-dynamic 가이드](https://web.dev/articles/strict-csp)
- [Chrome Trusted Types](https://developer.chrome.com/docs/web-platform/trusted-types) · [w3c spec](https://w3c.github.io/trusted-types/dist/spec/)
- [OWASP DOM XSS](https://owasp.org/www-community/attacks/DOM_Based_XSS)
- [DOMPurify](https://github.com/cure53/DOMPurify) · [isomorphic-dompurify](https://github.com/kkomelin/isomorphic-dompurify)
- [eslint-plugin-react/no-danger](https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/no-danger.md)
