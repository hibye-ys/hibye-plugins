---
name: verify-token-only-styling
description: Use after writing/editing frontend React or Tailwind v4 styling code (apps/web or similar). Runs grep checks for hardcoded colors, Tailwind arbitrary colors, and color literals in renderers. Run BEFORE commit on UI changes.
---

# verify-token-only-styling

`apps/web` 또는 `surface-web-vite-react` plugin 적용 영역에서 UI 코드 수정 후 *commit 전* 실행할 검증 체크리스트.

## 검증 항목

다음 grep 패턴이 *zero match* 이어야 함:

### 1. Tailwind arbitrary color

```bash
PROJECT_DIR=<프로젝트 루트>
# bg-[#xxx], text-[#xxx], border-[#xxx], 등 모든 arbitrary color
grep -rEn "(bg|text|border|ring|outline|fill|stroke|shadow|from|to|via)-\[#[0-9a-fA-F]{3,8}\]" "$PROJECT_DIR/apps/web/src"
grep -rEn "(bg|text|border|ring|outline|fill|stroke|shadow|from|to|via)-\[(rgb|rgba|hsl|hsla|oklch)\(" "$PROJECT_DIR/apps/web/src"
```

### 2. 렌더러 색 literal (canvas-renderers)

`apps/web/src/lib/canvas-renderers/` 또는 `packages/canvas-renderers/` 안에서 색 literal 사용 ✕. `brand` 채널만 참조.

```bash
# 0xRRGGBB, rgb(, hsl(, oklch( 모두 검출
grep -rEn "0x[0-9a-fA-F]{6}\b|rgb\s*\(|hsl\s*\(|oklch\s*\(" "$PROJECT_DIR/packages/canvas-renderers" "$PROJECT_DIR/apps/web/src/lib/canvas-renderers" 2>/dev/null
```

예외 = 비색 수치 (반지름, alpha, font size, letter-spacing 등) 의 module const. 색 만 ✕.

### 3. CSS 변수 / 토큰 기반 클래스만

`bg-card`, `text-foreground`, `border-border` 등 — `@theme` 정의 토큰 OK.
hex / rgb / oklch / hsl / arbitrary 모두 ✕.

### 4. 컴포넌트 출처

shadcn/ui = *코드 복사*. `npm install` 통한 의존 ✕. `packages/ui-catalog/` 안에 둠.

```bash
grep -rEn "@shadcn/ui|from ['\"]shadcn-ui" "$PROJECT_DIR/apps/web/src" "$PROJECT_DIR/packages/ui-catalog/src" 2>/dev/null
# 기대: 0 라인
```

## 단계

1. 변경 파일 목록 = `git diff --name-only HEAD apps/web/src packages/ui-catalog packages/canvas-renderers`
2. 위 grep 명령 모두 실행. 각각 *0 라인* 확인.
3. 위반 발견 시 = 토큰 클래스 또는 brand 채널로 변환.
4. 변환 후 재실행. PASS.

## ESLint rule 강제

본 룰은 codebase 안 ESLint rule (`no-tailwind-arbitrary-color`, `no-color-literal-in-renderer`) 로도 강제. 본 skill 은 *commit 전 빠른 manual 검증* 용.

## 식별 어휘

`M1-VERIFY-TOKEN-STYLING-INVOKED` — 본 skill 발화 검증용 (M1 T10).

## 관련 문서

- `rules/vite-react-tokens.md` (본 plugin)
- `rules/pack-system.md` (본 plugin, Pack 시스템의 색 literal 룰)
- `docs/superpowers/specs/2026-05-20-pack-abstraction-design.md` §10
