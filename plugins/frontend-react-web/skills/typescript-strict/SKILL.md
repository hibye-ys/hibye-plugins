---
name: typescript-strict
description: TypeScript strict family + noUncheckedIndexedAccess + branded type + exhaustive switch + satisfies operator 권장. tsconfig 의 strict 옵션 누락 / noImplicitAny false / raw any 사용 검출. typescript-eslint 깊은 검증 위임.
metadata:
  priority: 4
  docs:
    - "https://www.typescriptlang.org/tsconfig#strict"
    - "https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess"
    - "https://typescript-eslint.io/getting-started/typed-linting"
    - "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#satisfies"
  pathPatterns:
    - 'src/**/*.{ts,tsx}'
    - 'app/**/*.{ts,tsx}'
    - 'components/**/*.{ts,tsx}'
    - 'lib/**/*.{ts,tsx}'
    - 'tsconfig*.json'
    - 'tsconfig.*.json'
  bashPatterns:
    - '\btsc\s+(?:--noEmit\s+)?(?:--strict\s+)?'
    - '\bnpx\s+tsc\b'
  importPatterns:
    - 'typescript'
    - 'zod'
    - 'valibot'
    - 'effect'
    - 'neverthrow'
validate:
  - pattern: '"strict"\s*:\s*false'
    message: 'tsconfig 안 strict: false — strict family (noImplicitAny / strictNullChecks / strictFunctionTypes / ...) 비활성. true 권장.'
    severity: error
  - pattern: '"noImplicitAny"\s*:\s*false'
    message: 'tsconfig 안 noImplicitAny: false — 명시 안 한 any 허용. strict: true 안에 포함되지만 개별 override 도 금지.'
    severity: error
  - pattern: '"noUncheckedIndexedAccess"\s*:\s*false'
    message: 'tsconfig 안 noUncheckedIndexedAccess 가 명시적 false — 배열 / 객체 인덱스 접근 시 undefined 가능성 검증 누락. true 권장 (strict 에 미포함).'
    severity: warn
  - pattern: ':\s*any\b(?!\s*\[)|\bas\s+any\b'
    message: 'raw `any` 타입 사용 — narrow 가능하면 `unknown` + type guard 우선. 라이브러리 타입 미지원이면 `// @ts-expect-error` 또는 module declaration 추가.'
    severity: warn
retrieval:
  aliases:
    - strict mode
    - TypeScript strict
    - noUncheckedIndexedAccess
    - branded type
    - exhaustive switch
    - satisfies
  intents:
    - configure tsconfig strict
    - opaque type
    - exhaustive check
    - narrow any
    - tsc noEmit
  entities:
    - tsconfig
    - strict
    - any
    - unknown
    - never
    - satisfies
chainTo: []
---

# typescript-strict

**TypeScript strict 옵션 + 추가 권장 (`noUncheckedIndexedAccess`) + 5 패턴** = exhaustive switch / branded type / satisfies / discriminated union / unknown narrowing. 본 skill 은 *tsconfig 룰 검출 + 5 권장 패턴*. 깊은 typed-linting 은 `@typescript-eslint/recommended-type-checked` 위임.

## When to apply

- 새 TypeScript 프로젝트 / tsconfig 작성
- 기존 프로젝트의 strict 활성화 마이그레이션
- 타입 에러 ("Object is possibly undefined" / "Type X is not assignable") 만남
- 외부 라이브러리 타입 미지원 (`@types/*` 없음)
- 라이브러리 export 타입 설계 (branded ID / discriminated union)

## 핵심 원칙

### 1. `strict: true` 의 7 옵션

- `noImplicitAny` / `strictNullChecks` / `strictFunctionTypes` / `strictBindCallApply` / `strictPropertyInitialization` / `noImplicitThis` / `alwaysStrict`
- 한꺼번에 활성 = `strict: true`. 개별 옵션을 *false 로 override* ✕
- 마이그레이션 시 단계적 활성 → 종착점은 `strict: true`

### 2. `noUncheckedIndexedAccess: true` 권장

- `strict` 에 *미포함*. 별도 활성 필요
- `arr[0]` → `T | undefined` (이전: `T`)
- 객체 인덱스 (`record[key]`) 도 동일
- TS 추론을 정확하게 — undefined check 강제

### 3. `any` ✕, `unknown` + narrow

- 외부 데이터 (API 응답 / `JSON.parse`) = `unknown` 받기
- type guard (`typeof` / `Array.isArray` / `'key' in obj` / 사용자 정의 predicate) 로 narrow
- `as any` cast ✕ — `as unknown as T` 또는 정확한 type guard

### 4. branded type for opaque IDs

```ts
type UserId = string & { readonly __brand: 'UserId' }
type PostId = string & { readonly __brand: 'PostId' }

function fetchUser(id: UserId) { ... }
const userId = 'u_123' as UserId
const postId = 'p_456' as PostId
fetchUser(userId)  // OK
fetchUser(postId)  // ✕ Type error
```

- 같은 string 인데 *다른 ID* 임을 타입 차원에서 구분 — argument swap 방지
- `as UserId` cast = boundary (API 입력 / DB 결과) 에서만

### 5. exhaustive switch with `never`

```ts
type Status = 'pending' | 'success' | 'error'

function statusLabel(s: Status): string {
  switch (s) {
    case 'pending': return '대기'
    case 'success': return '완료'
    case 'error': return '오류'
    default: {
      const _exhaustive: never = s
      throw new Error(`Unhandled status: ${_exhaustive}`)
    }
  }
}
```

- Status 에 새 값 추가 시 → switch 가 컴파일 에러 → 모든 사용처 강제 update
- runtime safety (default throw) + compile-time exhaustive

### 6. `satisfies` for object literals

```ts
const config = {
  primary: '#3b82f6',
  secondary: '#9333ea',
} satisfies Record<string, string>

config.primary  // string (literal narrowed, not widened)
```

- `as` cast 는 widening / type lying
- `satisfies` = type *constraint* 만 (literal 추론 유지)
- TS 4.9+

### 7. discriminated union for tagged variants

```ts
type Result<T> =
  | { tag: 'ok'; value: T }
  | { tag: 'err'; error: Error }

function unwrap<T>(r: Result<T>): T {
  if (r.tag === 'ok') return r.value
  throw r.error
}
```

- 명시적 tag → exhaustive narrow
- `neverthrow` / `effect` 같은 Result 라이브러리도 동일 패턴

## 도구 위임 (이 skill 의 진입점 역할)

- **정적 (정확)**: `@typescript-eslint/recommended-type-checked` — 60+ rule, type-aware
- **CLI**: `tsc --noEmit` — 빌드 없이 타입만 검증, CI 단계 권장
- **에디터**: VSCode TypeScript Language Server — 즉시 표시
- **스키마**: `zod` / `valibot` — runtime + type 통합 (parsing 시 narrow)

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| tsconfig 안 `"strict": false` | `"strict": true` | **validate (error)** |
| `"noImplicitAny": false` (strict override) | strict 안에 포함 — 명시 ✕ | **validate (error)** |
| `"noUncheckedIndexedAccess": false` | 명시적 활성 권장 | **validate (warn)** |
| `let x: any` / `as any` | `unknown` + narrow | **validate (warn)** |
| `arr[0].name` (no undef check) | `arr[0]?.name` 또는 explicit check | typescript-eslint |
| `function f(x: SomeOpaqueId): void` 인데 `string` 받음 | branded type | 수동 |
| switch case + no default exhaustive | `never` exhaustive | 수동 |
| `as` cast 로 widening | `satisfies` | 수동 |
| `{ tag, ... }` shape 없는 union (untagged) | discriminated union (`tag`) | 수동 |
| `JSON.parse(...)` 직접 사용 | zod / valibot parse | 수동 |
| `// @ts-ignore` 남용 | `// @ts-expect-error <reason>` (TS 가 fix 됐을 때 알려줌) | typescript-eslint |
| function return 타입 미명시 (public API) | return 타입 명시 (`function f(): T`) | 수동 / `@typescript-eslint/explicit-module-boundary-types` |

## 권장 tsconfig (frontend)

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "jsx": "preserve",

    // strict family
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    // safety
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true,

    // module
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,

    // build
    "noEmit": true,
    "incremental": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "app/**/*", "components/**/*"]
}
```

## type guard / narrow 패턴

```ts
// ✕ any 캐스트
function parseJson(raw: string): User {
  return JSON.parse(raw) as User  // 거짓 — runtime 검증 ✕
}

// ✓ zod + unknown narrow
import { z } from 'zod'

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
})

function parseJson(raw: string): User {
  return UserSchema.parse(JSON.parse(raw))  // throws on mismatch
}
```

## branded ID + factory 패턴

```ts
type UserId = string & { readonly __brand: 'UserId' }

const UserId = {
  of: (raw: string): UserId => {
    if (!/^u_[a-z0-9]{8}$/.test(raw)) throw new Error('Invalid UserId')
    return raw as UserId
  },
}

const id = UserId.of(data.userId)  // validated boundary
```

## 참조

- [TypeScript handbook — strict mode](https://www.typescriptlang.org/tsconfig#strict)
- [TypeScript handbook — `noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess)
- [TS 4.9 — `satisfies` operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#satisfies)
- [typescript-eslint — recommended-type-checked](https://typescript-eslint.io/getting-started/typed-linting)
- [Effect](https://effect.website/) · [neverthrow](https://github.com/supermacro/neverthrow) — Result-style
- [Zod](https://zod.dev/) · [Valibot](https://valibot.dev/) — Schema parsing
