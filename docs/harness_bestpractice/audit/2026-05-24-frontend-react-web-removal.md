# frontend-react-web 22 skill 전체 제거 — audit log

> **결정 한 줄**: 2026-05-24, `plugins/frontend-react-web/skills/` 22 skill 전체 제거. 사유 = `synthesis-report.md` Decision Tree dry-run 결과 모두 모델 native 와 겹침 (AP-01). 향후 baseline 측정 후 재작성 예정.

## 결정 맥락

- **점검 요청**: hibye-plugins 운영자 (1인 개발자), 본인이 작성한 `docs/harness_bestpractice/synthesis-report.md` 기준 dry-run.
- **개발 환경**: Vite SPA + Electron 렌더러 + Expo (React Native). Next.js ❌. 사내 자산 (CSS 컨벤션 / 디자인 토큰 / Electron IPC 규약 / Sentry PII 정책) **없음**.
- **점검 트리거**: synthesis-report §8.2 #3 권고 — *"frontend-react-web 24개 skill 도 같은 dry-run"*.

## 제거된 22 skill 목록

```
a11y-dialog-pattern              hydration-determinism      semantic-a11y
async-race-avoidance             image-media-contract       sentry-rum-pii
client-boundary                  input-state-contract       server-vs-client-state
electron-renderer-isolation      playwright-msw-e2e         suspense-error-locality
error-boundary-telemetry         react19-migration          test-doubles-discipline
focus-navigation                 render-purity              token-only-styling
                                 rtl-query-priority         typescript-strict
                                 security-dom-sinks         web-vitals-transport
```

## 제거 사유 (Decision Tree 통과 실패)

`synthesis-report.md` §3 의 7-게이트 dry-run 결과:

| 게이트 | 22 skill 결과 |
|---|---|
| **Q1** 공식 docs 5분 검색 가능? | ✅ 22/22 — React docs / Next.js docs / web.dev / testing-library / Sentry docs 등 정본 |
| **Q2** 사내 고유 컨벤션? | ❌ 22/22 — user 확인 ("없음 + 혼자") |
| **Q3** baseline 실패율 ≥ 20%? | ❓ 측정 안 됨 (AP-02) |
| **결론** | TRUST (만들지 마라) |

**근거 강도** (분석 보고서 §22 skill 개별 분석):
- A (확실) — 12개: 공식 docs 5분 검색으로 *동일 내용 그대로*
- B (강함) — 9개: 공식 docs + 도구 (ESLint plugin 자동 검출) + 모델 native
- C (중간) — 1개: 공식 docs + vendor turn-key (`@vercel/speed-insights` 등)

## 코덱스 second opinion 받은 결과 (참고)

코덱스 verdict: *PARTIAL — 방향성은 맞으나 너무 이분법적*. 권장 = "자동 로드 제거 + generic 내용 도구/모델 위임 + Electron/Sentry 같은 고위험 영역만 narrow skill 또는 hook 진입점".

→ user 결정 = "일단 전부 제거, 나중에 재작성" (2026-05-24). 코덱스 중간안 채택 ❌.

## 현재 위임 (frontend 작업 시 — 재작성 전까지)

| 영역 | 위임 대상 |
|---|---|
| React / Next.js 일반 패턴 | `claude-plugins-official:vercel` (react-best-practices / shadcn / verification / ai-sdk) |
| Expo / React Native | `expo` plugin (13 skill) + `vercel-react-native-skills` |
| Vite / Electron / 일반 React | 모델 native + 공식 docs |
| 정적 검증 | ESLint plugins — jsx-a11y / typescript-eslint / testing-library / playwright / vitest |
| Electron 보안 audit | `electronegativity` (도구) |
| RUM | `@vercel/speed-insights` (turn-key) |
| Sentry / RUM PII | Sentry 공식 docs (도입 시) |

## 재작성 가이드 (미래 본인 / 다른 작업자)

본 plugin 을 다시 채울 때 권장 순서:

1. **baseline 측정 우선** — synthesis-report §5. *내가 모델에게 같은 가이드를 반복해서 주고 있나?* 3-6개월 자가 관찰.
2. **vercel:react-best-practices 의 progressive disclosure 패턴 적용**:
   - SKILL.md = index 만 (≤ 200 lines)
   - `rules/<name>.md` = 별도 파일 (on-demand)
   - frontmatter `pathPatterns` + `importPatterns` + `validate` (actionable + `upgradeToSkill`) + `chainTo` + `retrieval` (aliases/intents/entities)
3. **모델 native 회피** — 공식 docs 5분 검색 가능 영역 ❌. *내 프로젝트 운영 데이터 기반* 패턴만.
4. **CLAUDE.md `@./skills/X/SKILL.md` 자동 참조 ❌** — 25k budget 잠식. 대신 *invoke-only* skill 로.
5. **고위험 영역 우선** (codex 권장) — Electron IPC allowlist / Sentry PII masking / security DOM sinks 등 *실수 비용 큰* 영역부터 narrow skill. 단 baseline 측정 후.

## 관련 자료

- **분석 보고서 (22 skill 개별 분석 + 근거 강도)**: `~/.claude/plans/users-youngseoklee-desktop-workplace-hi-tingly-sparkle.md`
- **점검 기준**: `docs/harness_bestpractice/synthesis-report.md`
  - 상세 framework: `docs/harness_bestpractice/analysis/01-build-vs-trust-framework.md`
  - 안티 패턴: `docs/harness_bestpractice/analysis/05-anti-patterns.md`
- **이력 보존 (왜 22 skill 이 추가되었는지)**: `docs/superpowers/plans/2026-05-22-frontend-react-web-phase-{1,2,3}.md`
- **reference 사례 (잘 만든 React skill)**: `~/.claude/plugins/cache/claude-plugins-official/vercel/0.43.0/skills/react-best-practices/`

## 검증 — 제거 후 상태 (2026-05-24)

```
plugins/frontend-react-web/
├── .claude-plugin/plugin.json    (preserved)
├── .codex-plugin/                 (preserved)
├── assets/                        (preserved — icon)
├── skills/                        (empty)
└── CLAUDE.md                      (reduced to 1-line scaffold)
```

cache symlink (글로벌 CLAUDE.md 룰) 유효성 — 소스로 link 유지됨.
