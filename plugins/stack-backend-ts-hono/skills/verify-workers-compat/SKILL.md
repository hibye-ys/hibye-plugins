---
name: verify-workers-compat
description: Use after writing/editing backend TypeScript code that runs on Hono (apps/api or similar). Runs grep checks for Node-only APIs that break Cloudflare Workers compatibility. Run BEFORE commit on backend changes.
---

# verify-workers-compat

`apps/api` 또는 `stack-backend-ts-hono` plugin 적용 영역에서 backend 코드 수정 후 *commit 전* 실행할 검증 체크리스트.

## 검증 항목

다음 grep 패턴이 *zero match* 이어야 함 (escape hatch 파일은 예외 — `storage/provider.ts`, `env.ts`):

### 1. Node-only module import

```bash
PROJECT_DIR=<프로젝트 루트>
EXCEPT='apps/api/src/storage/provider.ts\|apps/api/src/env.ts'

# fs / fs/promises / node:fs
grep -rEn "from ['\"](fs|fs/promises|node:fs)['\"]" "$PROJECT_DIR/apps/api/src" | grep -v "$EXCEPT"

# path / node:path
grep -rEn "from ['\"](path|node:path)['\"]" "$PROJECT_DIR/apps/api/src" | grep -v "$EXCEPT"

# child_process / node:child_process
grep -rEn "from ['\"](child_process|node:child_process)['\"]" "$PROJECT_DIR/apps/api/src" | grep -v "$EXCEPT"

# stream / node:stream / http / https / node:http / node:https
grep -rEn "from ['\"](stream|node:stream|http|https|node:http|node:https)['\"]" "$PROJECT_DIR/apps/api/src" | grep -v "$EXCEPT"
```

각 명령 → *0 라인 출력* 이 PASS. 라인 있으면 → 그 파일은 escape hatch 또는 fetch / URL / crypto.subtle / Uint8Array 같은 Web 표준으로 변환.

### 2. Buffer global / process.env direct read

```bash
# Buffer global (Workers ✕ — Uint8Array 사용)
grep -rEn "\bBuffer\.(from|alloc|isBuffer)\b" "$PROJECT_DIR/apps/api/src" | grep -v "$EXCEPT"

# process.env.X direct read (c.env.X 패턴 강제)
grep -rEn "process\.env\." "$PROJECT_DIR/apps/api/src" | grep -v "$EXCEPT"
```

### 3. 환경변수 접근 표준

backend route 안 환경변수 접근 = `c.env.X` 패턴. `process.env.X` direct read 는 `env.ts` 부트스트랩에서만 허용.

## 단계

1. 변경 파일 목록 = `git diff --name-only HEAD apps/api/src`
2. 위 grep 명령 모두 실행. 각각 *0 라인* 확인.
3. 위반 발견 시 = Web 표준 대안으로 변환 (`fs` → fetch + R2/storage adapter, `Buffer` → `Uint8Array`, `process.env.X` → `c.env.X`).
4. 변환 후 재실행. PASS.

## 식별 어휘

`M1-VERIFY-WORKERS-COMPAT-INVOKED` — 본 skill 발화 검증용 (M1 T10).

## 관련 문서

- `rules/hono-workers-compat.md` (본 plugin)
- `docs/superpowers/specs/2026-05-21-shared-agent-marketplace-design.md` §10.M1
