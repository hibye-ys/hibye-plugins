---
name: commit-rules
description: <api-app> / plugins/backend-ts/ 변경 commit 작성 시 invoke. Conventional Commits 사용 — 7 접두사 자체는 표준 지식. 본 workflow 는 이 plugin 의 **scope 카탈로그** (backend-ts / <api-app> / sub-area 매핑) 와 도메인 어휘 금지 같은 로컬 룰에 집중.
metadata:
  role: workflow
  scope: project
---

# commit-rules — Scope 카탈로그 (<api-app> / backend-ts)

> Conventional Commits 표준 규약 ([conventionalcommits.org](https://www.conventionalcommits.org)) 준수. 본 workflow 는 **scope 카탈로그 + 로컬 금지 룰** 에만 집중 — 7 접두사 자체는 표준이므로 표만 짧게.

## 이 skill 은 언제 invoke 되는가

- `<api-app>/` 또는 `plugins/backend-ts/` 변경 commit 작성 시
- scope 결정 어려울 때 (어느 sub-area 에 속하는지)
- "왜 commit lint hook 가 reject?" 디버깅

## 7 접두사 (Conventional Commits)

`feat` / `fix` / `chore` / `docs` / `refactor` / `test` / `perf` — 표준 의미. 가능하면 7개 안에서 해결. 새 접두사 추가는 commit-lint config + 본 workflow 동시 갱신.

## 제목 / 본문 형식 (commit-lint hook 의존)

본 plugin 의 commit-lint hook 가 의존하는 형식 룰 (Conventional Commits 표준 강화):

- **제목**: `<접두사>(<scope>)?: <요약>` — 50자 이내 권장, 최대 72자
- **요약**: **명령형** ("add X" / "fix Y") — 과거형 ("added") / 현재형 ("adds") ✕
- **첫 단어**: 소문자
- **마침표**: 제목 끝에 ✕
- **본문**: 제목과 빈 줄 1개, 72자 줄바꿈, **why** 설명 (what 은 코드/diff)
- **Breaking change**: 본문에 `BREAKING CHANGE:` prefix + 마이그 가이드
- **Co-Authored-By**: `Co-Authored-By: <Name> <email>` 트레일러 허용 (자동 생성 정책은 별도)

## Scope 카탈로그 (이 plugin 의 로컬 룰)

scope = 변경 파일의 **최상위 의미 단위**. 모노레포 / 플러그인 / 서브에어리어 우선순위:

### 플러그인 / 패키지 단위 (최상위)

| Scope | 의미 |
|-------|------|
| `backend-ts` | `plugins/backend-ts/` rules + skills 변경 |
| `<api-app>` | `<api-app>/**` 광범위 변경 (sub-area 결정 어려울 때) |
| `apps/web` | `apps/web/**` |
| `apps/ml-worker` | `apps/ml-worker/**` |

### `<api-app>` sub-area

```
<api-app>/src/
├── routes/       → scope=routes (또는 routes/<name>)
├── engine/       → scope=loop / engine
├── providers/    → scope=provider (또는 provider/<name>)
├── tools/        → scope=tool (또는ml tool/<name>)
├── agents/       → scope=agent (또는 agent/<name>)
├── storage/      → scope=storage
├── auth/         → scope=auth
├── middleware/   → scope=middleware (또는 middleware/<name>)
├── streaming/    → scope=sse
└── observability/→ scope=observability / log
```

### 영역 결정 우선순위

1. 변경이 한 **sub-area** 에 닫혀 있으면 → sub-area scope (`provider`, `loop`, `sse` 등)
2. 한 **plugin** 안 여러 rule/skill 동시 변경 → plugin scope (`backend-ts`)
3. cross-cutting → `<api-app>` 또는 scope 생략

## 좋은 예 (이 plugin 특화)

```
feat(provider): add openrouter streaming retry
fix(sse): emit usage event before done
refactor(loop): extract stage helpers into separate files
chore(backend-ts): merge database Port section into data-layer
```

## 영향도

| 변경 | 영향받는 곳 |
|------|-----------|
| Scope 카탈로그 행 추가 | commit-lint config + 본 workflow 동시 갱신 |
| 새 접두사 도입 (예: `style`) | commit-lint config + 본 workflow 동시 갱신. 가능하면 7개 유지 |
| `<api-app>` sub-area 디렉토리 신설 | 위 sub-area 표에 행 추가 |

## 금지 사항 (로컬 룰)

- 시크릿 / 로컬 경로 / 사내 도메인 / 사용자 개인정보 본문에 남기기
- `WIP` / `wip` / `tmp` / `fix stuff` / `update` 같은 무의미 메시지
- 하나의 커밋에 서로 무관한 변경 섞기 — 기능별 분리
- `--amend` 를 pre-commit hook **실패 후** 사용 — 이전 커밋이 덮어쓰여 작업 손실. 실패 → 새 commit 으로
- `--no-verify` 로 hook skip — 실패 시 원인 수정 후 NEW commit
- commit 메시지에 **도메인 어휘** (제품 코드네임 / `<domain entity>` 이름 등) 사용 — 코드 자체가 도메인 중립이어야 함 ([[app-domain-boundary]] invariant)

## Cross-ref

- [[app-domain-boundary]] — commit 메시지의 도메인 어휘 금지 정본
- `scripts/forbidden-scan.sh` — 도메인 어휘 검출 (commit hook 에서 호출)
