---
name: commit-rules
description: apps/api 변경 사항 commit 작성 시 invoke. Conventional Commits 7 접두사 + scope 카탈로그 (stack-backend-ts / apps/api / sub-area) + 제목 / 본문 / Co-Authored-By 트레일러 규약 안내.
metadata:
  role: workflow
  scope: apps/api
  source: stack-backend-python/rules/commit-rules.md
---

> source: `stack-backend-python/rules/commit-rules.md`
> Conventional Commits 원본 규약 + TS / Hono 스택 scope 카탈로그.

# commit-rules — Conventional Commits 규약 (apps/api / stack-backend-ts)

## 이 skill은 언제 invoke 되는가

- `apps/api/` 변경 commit 작성 시
- `plugins/stack-backend-ts/` (rules / skills) 변경 commit 작성 시
- "왜 commit 메시지가 reject 되지?" 디버깅 (lint hook)

## 7 접두사

| 접두사 | 의미 | 예 |
|---|---|---|
| `feat` | 새 기능 | `feat(provider): add openrouter stream` |
| `fix` | 버그 수정 | `fix(sse): prevent stream deadlock on eof` |
| `chore` | 빌드 / 의존성 / 메타 | `chore(deps): bump zod to 3.23` |
| `docs` | 문서 전용 변경 | `docs(compaction): clarify escalation ratio` |
| `refactor` | 기능 변화 없는 구조 개선 | `refactor(loop): split stage into method` |
| `test` | 테스트 추가 / 수정 | `test(breaker): cover half-open transition` |
| `perf` | 성능 개선 | `perf(prompt): cache template compile` |

## Scope 카탈로그

scope 는 변경 파일의 **최상위 의미 단위**. 모노레포 / 플러그인 / 서브에어리어 우선순위:

### 플러그인 / 패키지 단위 (최상위)

| Scope | 의미 |
|-------|------|
| `stack-backend-ts` | `plugins/stack-backend-ts/` rules + skills 변경 |
| `stack-backend-python` | `plugins/stack-backend-python/` rules + skills 변경 |
| `apps/api` | `apps/api/**` 광범위 변경 (sub-area 결정 어려울 때) |
| `apps/web` | `apps/web/**` |
| `apps/ml-worker` | `apps/ml-worker/**` |

### apps/api sub-area

```
apps/api/src/
├── routes/       → scope=routes (또는 routes/<name>)
├── engine/       → scope=loop / engine
├── providers/    → scope=provider (또는 provider/<name>)
├── tools/        → scope=tool (또는 tool/<name>)
├── agents/       → scope=agent (또는 agent/<name>)
├── storage/      → scope=storage
├── auth/         → scope=auth
├── middleware/   → scope=middleware (또는 middleware/<name>)
├── streaming/    → scope=sse
└── observability/→ scope=observability / log
```

여러 sub-area 가 동시에 바뀌면 **상위 scope** (`apps/api`) 또는 변경의 핵심 도메인을 선택.

### 영역 결정 우선순위

1. 변경이 한 **sub-area** 안에 닫혀 있으면 → sub-area scope (`provider`, `loop`, `sse` 등)
2. 한 **plugin** 안에서 여러 rule / skill 동시 변경 → plugin scope (`stack-backend-ts`)
3. 영역 cross-cutting → `apps/api` 또는 모노레포 루트 scope 생략

## 형식 규칙

- 제목 = 접두사 + `(scope)?` + `: ` + 요약, 50자 이내 권장 (최대 72)
- 요약은 **명령형** ("add X", "fix Y") — 과거형 ("added") / 현재형 ("adds") 금지
- 요약 첫 단어는 **소문자**
- 제목 끝에 **마침표 금지**
- 제목과 본문 사이 빈 줄 1개
- 본문은 72자 줄바꿈, **why** 를 설명하지 **what** 을 반복하지 말 것
- Breaking change 는 본문에 `BREAKING CHANGE:` prefix + 마이그 가이드
- `Co-Authored-By: <Name> <email>` 트레일러 허용 (자동 생성 시 별도 정책 따름 — 본 skill 은 패턴만 정의)

## 좋은 예 vs 나쁜 예

### Good

```
feat(provider): add openrouter streaming retry

Wraps OpenRouter fetch in p-retry with 429 / 5xx exponential
backoff. Needed because cold-start cluster restarts occasionally
return transient 503 — default fetch had no retry path.
Refs: plugins/stack-backend-ts/skills/provider-layer/SKILL.md
      §재시도 매트릭스
```

```
fix(sse): emit usage event before done

Client state machine expected usage as fence-line. Without it,
the dashboard reported zero token consumption for streaming runs.
```

```
refactor(loop): extract stage helpers into separate files

Splits engine/loop.ts (~600 LOC) into 6 stage-N modules. No
behavior change. Easier to mock individual stages in vitest.
```

### Bad

```
Added streaming retry.            # 과거형 + 대문자 + 마침표 + 접두사 ✕
fix bug                           # 모호 + scope ✕
feat: stuff                       # 의미 없음
chore: WIP                        # WIP 금지
```

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| Scope 카탈로그 추가 | commit-lint config + 본 skill 동시 업데이트 |
| 접두사 추가 (e.g. `style`) | commit-lint config + 본 skill 동시 업데이트. 가능하면 7 접두사 유지 — 의미 분리는 scope 로 |

## 금지 사항

- 하나의 커밋에 서로 무관한 변경 섞기 — 기능별로 분리
- `WIP`, `wip`, `tmp`, `fix stuff`, `update` 같은 뜻 없는 메시지
- 시크릿 / 로컬 경로 / 사내 도메인 / 사용자 개인정보 본문에 남기기
- `--amend` 를 pre-commit hook 실패 후 사용 (이전 커밋이 덮어씌워져 작업 손실)
- `--no-verify` 로 hook skip — hook 실패 시 원인 수정 후 NEW commit
- commit 메시지에 도메인 어휘 (제품 코드네임 등) 사용 — 코드 자체가 도메인 중립이어야 함
