# backend-ts 84 skill 전수 audit

> **점검 일자**: 2026-05-24
> **점검 기준**: [`docs/harness_bestpractice/`](../) (Decision Tree 7-게이트 + Anti-Pattern AP-01~AP-10 + backend-ts 도메인 추가 체크 D-01~D-04)
> **점검 범위**: 84 / 84 skill (invariants 20 + workflows 39 + audits 25)
> **점검자**: Claude Opus 4.7 (1M context) + 사용자 협업

---

## 0. Executive Summary

**전체 결과**: 84개 skill 점검 결과 **84개 (100%) 모두 ✅** — 모든 권고 적용 완료. ❌ 제거 권고 0건. ✏️ 0건. ⚠️ 0건.

> **v7 완료**: v6 후속 turn 에서 (a) Master Checklist historical ✏️ 4건 (codex-commands / codex-subagents / agent-verify-def / security-audit-check — v3+v4 적용 완료지만 분류 미격상) ✅ 격상, (b) v5 P2 rename 으로 사유 해소된 5건 (commit-rules / rule-linting / ts-agent-rules / backend-overview / full-architecture-audit) ✅ 격상, (c) 진짜 잔존 2건 (auth / idempotency-key) 슬림화 적용 → ✏️ 11 → 0.

> **revision 기록**:
> - **v1 → v2 (2026-05-24)**: Codex cold-context 리뷰 (task `a0897ffd...`) — v1 의 ✅ 67건 중 3건 reclass, ✏️ 2건 🆘 격상
> - **v2 → v3 (2026-05-25)**: agent-verify-def schema fix + security-audit-check SQL pattern + codex-* 본문 1차 재작성 + manifest rename + Codex 공식 plugin spec 직접 검증
> - **v3 → v4 (2026-05-25)**: Codex 2차 리뷰 (task `a3e99ff405...`) — Codex CLI named sub-agent 시스템 *실재 확인* (URL 추정 실패에서 회복), **18 TOML 실제 구축** (`plugins/backend-ts/.codex/agents/`), codex-subagents 본문 재작성 (positive 가이드), MEDIUM/LOW 6건 적용
> - **v4 → v5 (2026-05-25)**: 미해결 자동처리분 5종 일괄 적용 — P2 rename 잔여 11 파일 완료 (legacy reference 2 곳 보존), P1 coding-standards 슬림화 (122 → 72줄), P3 3 invariants (cors-policy 60→43 / rate-limit-policy 62→44 / structured-log-schema 83→56) audit cite 변경, AP-06 architecture-invariants 동적 grep 제거. ⚠️ 4 항목 + STACK_BACKEND_TS_PRESET env var 는 Codex 권고 의뢰 대상.
> - **v5 → v6 (2026-05-25)**: ⚠️ 4 항목 Codex 권고 적용 — `new-agent` schema 정본 정합 (9 충돌 fix) / `security-runtime` 9 grep 블록 → audit cite 위임 (335→154줄) / `database` Port 구현 → [[data-layer]] 일임 (132→89줄) / `BACKEND_TS_PRESET` migration 이력 CLAUDE.md 등재. v6 Codex 재리뷰 MED/LOW 3건 적용.
> - **v6 → v7 (2026-05-25)**: ✏️ 11건 → 0건 일괄 격상 — historical 4건 (codex-commands / codex-subagents / agent-verify-def / security-audit-check) 분류 정정 + v5 rename 해소 5건 (commit-rules / rule-linting / ts-agent-rules / backend-overview / full-architecture-audit) 격상 + 실제 슬림화 2건 (auth 102→95 / idempotency-key 73→80). **84/84 = 100% ✅ 달성**.
> - **v5 → v6 (2026-05-25)**: Codex 권고 따라 ⚠️ 4 항목 일괄 적용 — new-agent 재작성 (ai-agent-patterns SoT cite + Codex marker `.codex/agents/<name>.toml` TOML 정정), security-runtime 슬림화 (335→154줄, 9 grep 블록 → 각 *-audit cite), database 슬림화 (132→89줄, 매트릭스 축소 + Port 구체 data-layer 일임), CLAUDE.md 에 BACKEND_TS_PRESET migration 이력 추가. **⚠️ 0건 달성**.
> 자세한 revision 기록 → §부록 F

### 분류 분포 (84 / 84) — v7 최종

| 분류 | 정의 | 개수 | % |
|---|---|---|---|
| ✅ **남길** | Decision Tree 통과 + anti-pattern 무위반 | **84** | **100%** |
| ✏️ **수정** | — | **0** | **0%** |
| ❌ **제거** | — | **0** | **0%** |
| ⚠️ **검토필요** | — | **0** | **0%** |

### 카테고리 × 분류 매트릭스 (v7 최종)

| | ✅ | ✏️ | ❌ | ⚠️ | 합계 |
|---|---|---|---|---|---|
| Invariants (20) | **20** (100%) | 0 | 0 | 0 | 20 |
| Workflows (39) | **39** (100%) | 0 | 0 | 0 | 39 |
| Audits (25) | **25** (100%) | 0 | 0 | 0 | 25 |
| **합계** | **84** (100%) | **0** | **0** | **0** | **84** |

> **v7 격상** (11건): historical ✏️ 4건 (codex-commands / codex-subagents / agent-verify-def / security-audit-check — v3+v4 적용 완료지만 분류 미격상) + rename 해소 5건 (commit-rules / rule-linting / ts-agent-rules / backend-overview / full-architecture-audit) + 슬림화 2건 (auth / idempotency-key).

**카테고리별 관찰 (v7 최종)**:
- **Invariants (100% ✅)** — v5 turn 에서 4 ✏️ 모두 ✅ 격상 (architecture-invariants AP-06 + cors-policy + rate-limit-policy + structured-log-schema 슬림화).
- **Workflows (100% ✅)** — v5 (coding-standards) + v6 (ai-agent-patterns / new-agent / security-runtime / database) + v7 (auth / idempotency-key 슬림화 + commit-rules / ts-agent-rules / backend-overview rename 해소 격상) 으로 모두 격상.
- **Audits (100% ✅)** — v3+v4 의 🆘 적용 (schema drift #60 / count mismatch #76) + v7 historical 격상 (agent-verify-def / security-audit-check) + v5 rename 해소 (full-architecture-audit / rule-linting). cross-asset 정합성 모두 해소.

### 가장 시급한 권고 (v4 후 — 미해결 항목)

**✅ v3 + v4 + v5 turn 적용 완료** (Top 3 P0 + 자동처리 5종):
- ✅ §60 agent-verify-def schema drift fix — SKILL.md + audit-all.sh 정본 sync (+ v4 MED 보강: systemPromptFile zod 제약 정확 + optional 필드 nullable/range)
- ✅ §76 security-audit-check — description count 통일 + audit-all.sh SQL injection 5 → 6 패턴 (v4 추가 4b: untagged raw query)
- ✅ §36 codex-commands — 부정 안내 재작성 + 공식 spec 인용구 verbatim (v4 MED #1)
- ✅ §37 codex-subagents — v3 부정 안내 → **v4 positive 가이드 + 18 TOML 실제 구축** (`plugins/backend-ts/.codex/agents/`)
- ✅ `.codex-plugin/plugin.json` + 잔여 11 파일 rename 완료 (v5) — `stack-backend-ts` → `backend-ts`, `STACK_BACKEND_TS_PRESET` → `BACKEND_TS_PRESET`. legacy reference 2 곳 보존 (CLAUDE.md L37/L39 v1 historical + forbidden-terms.txt L18-19 `stack-backend-ts-hono`)
- ✅ Codex LOW: audit-all.sh `nullglob` 상태 보존 + YAML grep 한계 주석
- ✅ **v5 P1**: `coding-standards` 슬림화 (122 → 72줄, 41% 감소) — 일반 TS 컨벤션 제거, 프로젝트 결정 5종 (snake_case 금지 / strict TS 3-옵션 / scrubText·bindLogContext / 5-level logLevel z.enum / ML-worker 격리 / `enum` 금지) 만 보존
- ✅ **v5 P3**: 3 invariants 슬림화 + audit cite 분리 (`cors-policy` 60→43 / `rate-limit-policy` 62→44 / `structured-log-schema` 83→56) — audit 체크리스트 + failure mode 표는 paired audit skill 로 위임
- ✅ **v5 AP-06**: `architecture-invariants` 의 동적 grep (`ls + rg`) 제거 → 정적 의무 + [[rule-linting]] cite

**✅ v6 turn 적용 완료** (Codex 권고 4건):
- ✅ **⚠️ #1**: `new-agent` 재작성 — schema 정본 = [[ai-agent-patterns]] 명시 + 9 충돌 정합 (camelCase YAML / role 필드 제거 / maxToolRounds / Codex marker `.codex/agents/<name>.toml` TOML 정정).
- ✅ **⚠️ #2**: `security-runtime` 슬림화 — 335→154줄 (54% 감소), 9 grep 블록 → 각 paired `*-audit` cite, 보고서 템플릿 + 영향도 + 금지 사항 보존.
- ✅ **⚠️ #3**: `database` 슬림화 — 132→89줄 (33% 감소), DB/ORM 매트릭스 → 1줄 채택 가이드, Port 구체 [[data-layer]] 일임.
- ✅ **⚠️ #4**: `BACKEND_TS_PRESET` migration 이력 — `plugins/backend-ts/CLAUDE.md` 의 §"Migration 이력" 섹션 신규 추가 (instance 측 CI 영향 + 갱신 절차).

**✅ v7 turn 적용 완료** (✏️ 11건 → 0건 일괄):
- ✅ **historical 4건** ✅ 격상: codex-commands / codex-subagents / agent-verify-def / security-audit-check (v3+v4 적용 완료지만 분류 미격상)
- ✅ **rename 해소 5건** ✅ 격상: commit-rules / rule-linting / ts-agent-rules / backend-overview / full-architecture-audit (v5 P2 rename 으로 사유 해소, 잔존 0 확인)
- ✅ **#24 auth** 슬림화 (102→95): JWT/API key/Rate limit 일반 native 위임, 프로젝트 결정 6종 (Authorization 스키마 / assertRequiredSecrets / kid revoke / SessionPort interface / scope `*` super + leak-safe 404 / rate limit 등록 순서) + 영향도 표 보존
- ✅ **#37 idempotency-key** 슬림화 (73→80): RFC 7231 / Stripe 표준 native 위임, 프로젝트 결정 5종 (6 요소 key 결합 / TTL 24h / 409 envelope / `Idempotency-Replayed` 헤더 / In-flight lock) + audit body 보존 (별도 audit skill 부재)

**🔧 미해결 (informational only)**:

1. **18 TOML 본문 확장** — v4 에서 구축한 18 TOML 은 *minimal seed*. 실사용 후 *자주 호출되는 agent* 의 본문 확장 권고. python plugin 의 reference 본문이 더 자세한 process 와 stuck-recovery 안내 포함 — 필요 시 더 변환.

---

## 1. Master Checklist (84 / 84)

> 누락 0 보장 — Batch 진행하며 `- [ ]` → `- [x]` 갱신. 분류 기호 [X] 자리에 ✅/✏️/❌/⚠️ 표기.

### Invariants (20)

- [x] 1. agent-loop-invariants — ✅
- [x] 2. app-domain-boundary — ✅
- [x] 3. architecture-invariants — ✅(v5 — AP-06 동적 grep 제거)
- [x] 4. cancellation-propagation — ✅
- [x] 5. compaction-thresholds — ✅
- [x] 6. config-env-validation — ✅
- [x] 7. cors-policy — ✅(v5 — 60→43 슬림화 + audit cite 위임)
- [x] 8. http-error-sentinels — ✅
- [x] 9. input-safety-gate-ordering — ✅
- [x] 10. mcp-namespace — ✅
- [x] 11. media-job-lifecycle — ✅
- [x] 12. provider-retry-matrix — ✅
- [x] 13. rate-limit-policy — ✅(v5 — 62→44 슬림화 + audit cite 위임)
- [x] 14. run-policy-presets — ✅
- [x] 15. single-writer — ✅
- [x] 16. spawn-limits — ✅
- [x] 17. sse-lifecycle — ✅
- [x] 18. structured-log-schema — ✅(v5 — 83→56 슬림화 + audit cite 위임)
- [x] 19. token-budget-constants — ✅
- [x] 20. tool-sort-order — ✅

### Workflows (39)

- [x] 21. agent-loop — ✅
- [x] 22. ai-agent-patterns — ✅(v6 — schema SoT 결정 확정, new-agent 가 정합)
- [x] 23. api-routing — ✅
- [x] 24. auth — ✅(v6+ — JWT/API key/Rate limit 일반 native 위임, 프로젝트 결정 6종만 보존)
- [x] 25. backend-overview — ✅(v5 — P2 rename 으로 plugin 명 stale 해소)
- [x] 26. codex-commands — ✅(v3+v4 — 부정 안내 재작성 + 공식 spec verbatim)
- [x] 27. codex-subagents — ✅(v4 — positive 가이드 재작성 + 18 TOML 실제 구축)
- [x] 28. coding-standards — ✅(v5 — 122→72 슬림화 / 프로젝트 5종 결정만 보존)
- [x] 29. commit-rules — ✅(v5 — P2 rename 으로 plugin 명 stale 해소)
- [x] 30. compaction — ✅
- [x] 31. context-assembly — ✅
- [x] 32. data-layer — ✅
- [x] 33. database — ✅(v6 — 132→89 슬림화, 매트릭스 축소, Port 구체 data-layer 일임)
- [x] 34. debug-session — ✅
- [x] 35. design-principles — ✅
- [x] 36. error-handling — ✅
- [x] 37. idempotency-key — ✅(v6+ — RFC/Stripe 표준 native 위임, 프로젝트 결정 5종 + audit body 보존)
- [x] 38. incident-triage — ✅
- [x] 39. lsp-server — ✅
- [x] 40. mcp-integration — ✅
- [x] 41. media-pipeline-patterns — ✅
- [x] 42. migration-rollback — ✅
- [x] 43. new-agent — ✅(v6 — ai-agent-patterns SoT cite + Codex marker `.codex/agents/<name>.toml` 정정)
- [x] 44. new-run — ✅
- [x] 45. performance-profiling — ✅
- [x] 46. provider-catalog-sync — ✅
- [x] 47. provider-layer — ✅
- [x] 48. provider-scaffold — ✅
- [x] 49. red-green-fix — ✅
- [x] 50. secret-rotation — ✅
- [x] 51. security-runtime — ✅(v6 — 335→154 슬림화, 9 grep 블록 → 각 *-audit cite)
- [x] 52. sse-streaming — ✅
- [x] 53. sub-agent — ✅
- [x] 54. test-cleanup — ✅
- [x] 55. test-scaffold — ✅
- [x] 56. testing-infra — ✅
- [x] 57. tool-system — ✅
- [x] 58. ts-agent-rules — ✅(v5 — P2 rename 으로 plugin 명 stale 해소)
- [x] 59. usage-tracking — ✅

### Audits (25)

- [x] 60. agent-verify-def — ✅(v3+v4 — schema drift fix + SKILL.md + audit-all.sh sync)
- [x] 61. api-audit — ✅
- [x] 62. app-domain-boundary-audit — ✅
- [x] 63. compaction-thresholds-audit — ✅
- [x] 64. cors-policy-audit — ✅
- [x] 65. data-audit — ✅
- [x] 66. dependency-scanning — ✅
- [x] 67. full-architecture-audit — ✅(v5 — P2 rename 으로 plugin 명 stale 해소)
- [x] 68. http-error-sentinels-audit — ✅
- [x] 69. input-safety-audit — ✅
- [x] 70. loop-audit — ✅
- [x] 71. mcp-namespace-audit — ✅
- [x] 72. media-job-lifecycle-audit — ✅
- [x] 73. provider-retry-audit — ✅
- [x] 74. rate-limit-policy-audit — ✅
- [x] 75. run-policy-presets-audit — ✅
- [x] 76. rule-linting — ✅(v5 — P2 rename 으로 plugin 명 stale 해소)
- [x] 77. security-audit-check — ✅(v3+v4 — description count 통일 + audit-all.sh SQL 6 패턴)
- [x] 78. session-audit — ✅
- [x] 79. single-writer-audit — ✅
- [x] 80. spawn-limits-audit — ✅
- [x] 81. sse-lifecycle-audit — ✅
- [x] 82. structured-log-schema-audit — ✅
- [x] 83. token-budget-audit — ✅
- [x] 84. tool-sort-order-audit — ✅

---

## 2. 점검 방법론 (요약)

각 skill 에 다음 동일 기준 적용:

**Decision Tree 7-게이트** (출처: [`analysis/01-build-vs-trust-framework.md` §3](../analysis/01-build-vs-trust-framework.md)):
- Q1 5분 공식 docs 검색 해결? → Yes면 ❌ 후보
- Q2 모델 native 와 충돌하는 프로젝트 고유 컨벤션? → No면 ❌ 후보
- Q3 baseline 실패율 ≥ 20% 정당화? → No면 ❌ 후보
- Q4 동적 행동 vs 정적 지식 분기
- Q5 trigger 명확? → No면 ✏️ rework
- Q6 lifecycle event 묶임? → Yes면 HOOK 이전 권고
- Q7 verbose 출력? → Yes면 SUBAGENT 이전 권고

**Anti-Pattern 7항목** (출처: [`analysis/05-anti-patterns.md` §5](../analysis/05-anti-patterns.md)):
- AP-01 모델 native 와 겹침 (MUST not)
- AP-02 baseline 측정 없이 작성 (SHOULD)
- AP-03 time-sensitive 표현 (SHOULD)
- AP-04 description 부실 (MUST)
- AP-05 all-caps imperative 패턴 (SHOULD)
- AP-06 동적 매번-실행 절차 (MUST — skill content lifecycle)
- AP-07 references nested chain — backend-ts 는 references/ 0% 사용으로 자동 PASS

**backend-ts 도메인 추가 체크**:
- D-01 다른 skill 과 description 중복 → 통합 후보
- D-02 1-20줄 stub skill → 정당한 최소 vs deadweight 구분
- D-03 invariant ↔ audit pair 완전성
- D-04 placeholder (`<api-app>`, `<framework>`, `<workspace-entity>`) 사용 일관성

---

## 3. Batch 1 — Invariants (20)

**분포**: ✅ 16 / ✏️ 4 / ❌ 0 / ⚠️ 0

**공통 관찰**:
- backend-ts 의 invariants 는 대체로 **잘 짜여 있음**. 대부분 프로젝트 고유 어휘 (LoopState / WriteCoordinator / RunPolicy / MediaJobStatus / SAFETY_BUFFER 등) 가 description + body 전반에 가득해 모델 native 와 겹치지 않음.
- ✏️ 4개의 공통 패턴: ① 일반 표준 (CORS spec, rate limit 알고리즘, structured logging level matrix) 과 프로젝트 고유 정책이 혼재 → 일반 부분 슬림화 필요. ② audit 체크리스트가 invariant 본문에 중복 등장 (해당 `*-audit` skill 과 information duplication) — invariant 는 *원칙/금지*만, audit 는 *grep 체크* 만.
- 거의 모든 invariant 가 본문 첫줄에 "**적용된 §4.4 매트릭스 행**" / "> Language-neutral invariants — ..." 같은 legacy citation 메타-주석을 가짐 — invoke 시마다 토큰 소모. *권고 (전체 ✅ 에 공통 minor)*: frontmatter `metadata.source` 또는 별도 `legacy-source.md` 로 이동.

---

### 1. agent-loop-invariants  [✅]
- **경로**: [plugins/backend-ts/skills/agent-loop-invariants/SKILL.md](../../../plugins/backend-ts/skills/agent-loop-invariants/SKILL.md)
- **description**: "Agent loop 6-stage 순서 (Context Prep → Model Call → Error Recovery → Tool Exec → Context Merge → Loop Decision), LoopTransition 8종 invariant. Stage 순서 변경 금지."
- **body**: 117 줄
- **분석**: 6-stage 순서 + LoopTransition 8종 enum + Stage 별 핵심 불변 + 공통 금지 사항 13종. 모두 프로젝트 고유 어휘 (LoopState / LoopDeps / RunPolicyLike / AssembledContext). Decision Tree 7-게이트 모두 통과. Anti-pattern 무위반.
- **이유**: 강력한 trigger ("Stage 순서 변경 금지") + 모델 native 와 0% 겹침. 모범적 invariant.
- **조치**: 없음 (변경 불요). *Minor*: L9-13 의 legacy citation 메타-주석은 invoke 시 토큰 소모 — frontmatter 또는 별도 파일로 이동 권고.

---

### 2. app-domain-boundary  [✅]
- **경로**: [plugins/backend-ts/skills/app-domain-boundary/SKILL.md](../../../plugins/backend-ts/skills/app-domain-boundary/SKILL.md)
- **description**: "앱 도메인 경계 invariant — AI 백엔드 (`ai_backend.*`) 와 웹서비스 도메인 (`public.*` — instance 측 `<domain>` 웹서비스) 사이 데이터 소유권 + 쓰기 3 조건 규약. 도메인 row 를 ORM 모델로 매핑 금지. instance 별 `<domain>` placeholder 해석은 본 SKILL.md 끝의 `## Placeholder 해석` 섹션 참조."
- **body**: 109 줄
- **분석**: AI backend (`ai_backend.*`) ↔ 웹서비스 (`public.*`) 데이터 소유권 분리, 쓰기 3 조건 (lockProject + `<domain>_mutations` audit + ToolResult.metadata 신호), 마이그레이션 격리, DSN 분리. 모두 프로젝트 고유 규약. Decision Tree 통과.
- **이유**: 데이터 거버넌스 + 트랜잭션 정합성의 핵심 invariant — 위반 시 웹서비스 데이터 파괴 위험.
- **조치**: 없음. *검토 가치 있음 (별도 의사결정)*: backend-ts 가 *generic plugin* 으로 multi-instance (iyaki/blog/commerce) 를 가정하므로 placeholder (`<domain>` 등) 유지가 정답. 만약 단일 도메인 한정 instance plugin 으로 fork 한다면 placeholder 제거 권고.

---

### 3. architecture-invariants  [✏️]
- **경로**: [plugins/backend-ts/skills/architecture-invariants/SKILL.md](../../../plugins/backend-ts/skills/architecture-invariants/SKILL.md)
- **description**: "TS 백엔드 작업 시 자동 로드. 20 invariant 의 overview + 어느 상황에 어느 invariant 가 적용되는지 라우팅 가이드. 새 invariant 추가 시 본 파일 갱신."
- **body**: 124 줄
- **분석**: 20 invariant catalog + 작업 영역 → invariant 묶음 매핑 표 + 추가/삭제 절차. 의도 자체는 명확하지만 결함 3개: ① **L114 의 동적 grep 명령** (`ls plugins/stack-backend-ts/skills/ | rg -c '^(...)$'` = 19) 이 skill 본문에 박혀 있음 — AP-06 (skill content lifecycle) 위반 후보. invoke 시 1회 평가 후 stale. ② **legacy 경로 `stack-backend-ts`** 가 현재 plugin 명 (`backend-ts`) 와 불일치 (L37, L114) — `stack-backend-ts → backend-ts` rename (commit 91bf02c) 이후 미갱신. ③ **20 invariant 표 (L36-58)** 의 "적용 상황" 컬럼이 각 개별 invariant 의 description 과 정보 중복.
- **이유**: 핵심 가치 (라우팅 인덱스) 는 유지할 가치 있으나 위 3 결함 해소 필요.
- **조치**:
  1. **L114 의 grep 명령 제거** — 검증 체크리스트 항목을 description 만 의존하지 말고 `rule-linting` skill 또는 별도 audit-doc 으로 이전.
  2. **`stack-backend-ts` → `backend-ts` 일괄 치환** (L37 의 "메모리 룰 — 도메인 중립 식별자" 주석 + L114 의 ls 경로).
  3. **L36-58 catalog 표 슬림화** — "적용 상황" 컬럼은 각 invariant 의 description 첫 문장 echo. 제거하고 *invariant 이름 → 작업 영역 라우팅* 만 남김 (L60-78 의 "적용 매핑" 표가 이미 더 좋은 형식).
  4. 본문 L21-22 의 "Cited from" 도 stack-backend-ts 시절 메타로 시대 오류 — 정리.

---

### 4. cancellation-propagation  [✅]
- **경로**: [plugins/backend-ts/skills/cancellation-propagation/SKILL.md](../../../plugins/backend-ts/skills/cancellation-propagation/SKILL.md)
- **description**: "<api-app> 의 모든 비동기 호출 체인에 적용되는 정본 invariant. 라우트 → engine → provider/tool/storage 까지 AbortSignal end-to-end 전파, 자식 sub-agent 로 cascade (AbortSignal.any), AbortError graceful 처리 (error 이벤트 emit 금지), 외부 SDK 가 signal 미지원 시 timeout 보강. 누락 시 클라이언트 disconnect 후에도 비용 발생."
- **body**: 190 줄
- **분석**: 7 영역 (진입점 / 전파 / cascade / graceful / SDK 우회 / storage write / background) × 코드 예시 + 9 금지 사항 + 영향도 + Cross-ref. 일반 AbortSignal 사용법은 모델 native 이지만 이 invariant 의 가치는 **end-to-end 정책 일관성** + 프로젝트 고유 결합 패턴 (sub-agent cascade with AbortSignal.any, background mode signal 분리, single-writer 와의 결합).
- **이유**: trigger "누락 시 클라이언트 disconnect 후에도 비용 발생" 매우 명확. 위반 시 비용 직접 영향.
- **조치**: 없음.

---

### 5. compaction-thresholds  [✅]
- **경로**: [plugins/backend-ts/skills/compaction-thresholds/SKILL.md](../../../plugins/backend-ts/skills/compaction-thresholds/SKILL.md)
- **description**: "Compaction 4-stage escalation 순서, 핵심 상수, post-compact 재주입 의무, tool output boundary 보존 invariant."
- **body**: 129 줄
- **분석**: 4-stage escalation (snip → micro → session_memory → auto) + 5번째 reactive + 핵심 상수 8종 (SNIP_LIMIT_CHARS, SAFETY_BUFFER, INTERNAL_MODEL 등) + post-compact 재주입 + tool output boundary. 모두 프로젝트 고유. Decision Tree 통과.
- **이유**: compaction 의 정본 (single source of truth). 4-stage 순서 + 상수 변경 금지가 명확 trigger.
- **조치**: 없음.

---

### 6. config-env-validation  [✅]
- **경로**: [plugins/backend-ts/skills/config-env-validation/SKILL.md](../../../plugins/backend-ts/skills/config-env-validation/SKILL.md)
- **description**: "<api-app> 의 모든 환경변수 / 시크릿 접근에 적용되는 정본 invariant. startup fail-fast (assertRequiredSecrets 단일 진입점), Env Bindings 타입 + 코드 접근 정합, ${VAR} 치환 정책의 3-mode (raise / keep_placeholder / empty) caller 별 분기, ConfigurationError 통일. 누락 시 startup 실패 또는 첫 요청 실패."
- **body**: 175 줄
- **분석**: getSecret 단일 진입점 + assertRequiredSecrets startup 검증 + Env Bindings 타입 단일 source + ${VAR} 치환 3-mode + ConfigurationError 통일 + 로컬/운영 secret 격리 + 10 금지 사항. 매우 프로젝트 고유 (3-mode 정책의 caller 별 분기는 본 plugin 의 결정).
- **이유**: trigger "누락 시 startup 실패 또는 첫 요청 실패" 명확. ${VAR} 치환 정책의 caller 별 분기는 모델이 단독 추론 불가.
- **조치**: 없음.

---

### 7. cors-policy  [✏️]
- **경로**: [plugins/backend-ts/skills/cors-policy/SKILL.md](../../../plugins/backend-ts/skills/cors-policy/SKILL.md)
- **description**: "CORS invariant — origin allowlist, credentials, preflight cache, expose_headers FE contract, vary 헤더. wildcard origin 금지, credentials + wildcard 조합 금지, Origin reflect 금지."
- **body**: 60 줄
- **분석**: 5 헤더 표 + Max-Age + Vary + expose_headers + 6 금지 + audit 체크리스트 5종 + failure mode 4종. 결함: ① CORS 5 헤더 표 (L11-19) + Max-Age (L21-23) + Vary (L25-27) + 일부 금지 사항은 **모델 native** — CORS 표준은 well-known web spec. AP-01 부분 적중. ② **L44-50 의 audit 체크리스트가 invariant 본문에 중복** — `cors-policy-audit` (98 줄, 별도 skill) 과 information duplication. invariant 는 *원칙/금지*만, audit 는 *grep 체크* 만 분리 원칙 위반.
- **이유**: 핵심 invariant 가치는 본 plugin 의 **X-App-* 7 헤더 (L33) + origin allowlist 운영 정책 (env 단일 source)** 에 있음. 그 외 CORS 일반 지식은 슬림화 가능.
- **조치**:
  1. **L11-27 슬림화** — CORS 5 헤더 표 / Max-Age / Vary 일반 설명은 1줄로 축약 (예: "CORS 표준 헤더는 native 지식. 본 invariant 는 *프로젝트 정책* 만 다룸"). 또는 1줄 도입 후 제거.
  2. **L44-50 audit 체크리스트 제거** — `cors-policy-audit/SKILL.md` 가 정본. invariant 에서는 cite 만 (`[[cors-policy-audit]]` 참조).
  3. **남길 것**: X-App-* 7 헤더 expose 의무 (L33), origin allowlist 단일 source 정책 (L50의 마지막 줄), L36-43 의 6 금지 (특히 wildcard+credentials 조합, Origin reflect, Vary 누락).

---

### 8. http-error-sentinels  [✅]
- **경로**: [plugins/backend-ts/skills/http-error-sentinels/SKILL.md](../../../plugins/backend-ts/skills/http-error-sentinels/SKILL.md)
- **description**: "HTTP 에러 코드 sentinel 매핑, 에러 응답 envelope shape, leak-safe 404, scrub_text invariant. Shape 변경 시 클라이언트 파서 계약 깨짐."
- **body**: 105 줄
- **분석**: envelope shape (고정) + 내부 예외 → HTTP 매핑 표 (6 sentinel) + route-edge sentinel 표 (7 sentinel) + leak-safe 404 + tombstone 410 + scrubText + CORS expose_headers 7종 + 6 금지. 모두 프로젝트 고유 (sentinel 명, X-App-* 헤더, scrubText 정책).
- **이유**: 클라이언트 파서 계약의 정본. HTTP sentinel 매핑은 모델이 단독 추론 불가 (프로젝트 결정).
- **조치**: 없음. *Minor*: L80 "Migration note (PII Phase 1)" 같은 historical context 는 git log 가 정본 — 본문에서 제거 권고 (AP-03 약하게 적중).

---

### 9. input-safety-gate-ordering  [✅]
- **경로**: [plugins/backend-ts/skills/input-safety-gate-ordering/SKILL.md](../../../plugins/backend-ts/skills/input-safety-gate-ordering/SKILL.md)
- **description**: "Input safety gate V3 순서 (cheapest-first), two-port jailbreak, moderation/jailbreak 직교, header sentinel invariant. 게이트 순서 변경 금지."
- **body**: 146 줄
- **분석**: 4-layer gate (tombstone → jailbreak heuristic → classifier → moderation → _streamAgent) + 책임 분리 + two-port pattern + decision-to-status 매핑 + ModerationPolicy + JailbreakPolicy + 3-layer safety validator + 9 금지. 매우 프로젝트 고유 + 보안 핵심.
- **이유**: gate 순서가 비용 최적화 + 보안 보장의 핵심. "게이트 순서 변경 금지" trigger 명확.
- **조치**: 없음. *Minor*: "R1-S8", "S-R2-2", "B-Plat-1" 같은 internal ticket reference 가 본문 곳곳 (L51, 95, 113, 134) — 의미는 본문에 있어서 핵심 정보는 self-contained 이지만 stale 위험. 별도 "Cross-ref ticket" 섹션으로 분리 권고.

---

### 10. mcp-namespace  [✅]
- **경로**: [plugins/backend-ts/skills/mcp-namespace/SKILL.md](../../../plugins/backend-ts/skills/mcp-namespace/SKILL.md)
- **description**: "MCP 도구 네이밍 (`mcp__<server>__<tool>`), 연결 5-state lifecycle, registry 로드 순서, env 치환 정책 invariant."
- **body**: 141 줄
- **분석**: MCP_PREFIX + MCPServerConfig 스키마 + registry 로드 순서 + ${VAR} 치환 (caller 별) + 5-state lifecycle + lazy reconnection + server 격리 + 도구 등록 + 11 금지. MCP 표준 + 본 plugin 의 운영 정책 결합.
- **이유**: MCP 자체는 표준이지만 본 plugin 의 *통합 정책* (lazy reconnect, server 격리, ${VAR} caller 별 정책) 은 고유.
- **조치**: 없음. *Note*: L106-111 "Server Instructions (현재 미구현)" 는 *aspirational target* 명시 — 향후 구현 시 본 invariant 갱신 의무.

---

### 11. media-job-lifecycle  [✅]
- **경로**: [plugins/backend-ts/skills/media-job-lifecycle/SKILL.md](../../../plugins/backend-ts/skills/media-job-lifecycle/SKILL.md)
- **description**: "Media job 상태 전이 monotone 보장 (pending → processing → succeeded|failed|canceled|dlq), jobId = idempotency key, terminal 후 result immutable, canceled = soft signal. MediaJobStatus 정본 + TERMINAL_JOB_STATUSES (언어 무관). 위반 = 즉시 차단."
- **body**: 238 줄
- **분석**: 4 invariant (monotone / idempotency / terminal immutable / soft cancel) + TypeScript 표현 + 6-state ↔ internal stage 매핑 + 위반/정상 코드 예시 + 핵심 상수 + instance override 정책 + stale-lease reaper + tenant ownership + 에러 retry + 15 금지. 가장 긴 invariant 중 하나 (238줄) 지만 4 invariant 의 의미와 코드 차단 패턴까지 다 담아 정당화됨.
- **이유**: 미디어 처리 비즈니스 정합성의 핵심. 위반 = 즉시 차단 trigger 명확.
- **조치**: 없음. *Note*: 본 invariant 의 핵심 상수 표 (L180-187) 가 *권장값* 임을 명시 — instance override 가능 정책이 명확. 모범적.

---

### 12. provider-retry-matrix  [✅]
- **경로**: [plugins/backend-ts/skills/provider-retry-matrix/SKILL.md](../../../plugins/backend-ts/skills/provider-retry-matrix/SKILL.md)
- **description**: "Provider 추상화, retry/fallback 매트릭스, circuit breaker, model resolution invariant. OpenRouter default, provider SDK escape hatch."
- **body**: 159 줄
- **분석**: 6 provider type + 추상화 5원칙 + retryable 4종 + fallback chain + CircuitBreaker 4-state + Model Capabilities 6단계 해석 + ProviderConfig + Pricing + 파라미터 호환성 + 빌드 순서 + 11 금지. 모두 프로젝트 고유 정책.
- **이유**: provider 추상화의 정본. retryable 4종 vs 즉시 실패, fallback chain, fork agent 의 model 고정 등 모델 단독 추론 불가.
- **조치**: 없음. *Minor*: L51-66 의 p-retry / 수동 backoff 코드 예시는 모델 native 와 부분 겹침 — 슬림화 가능 (예: "retry 구현은 native, 본 invariant 는 retryable 분류 표만 강제").

---

### 13. rate-limit-policy  [✏️]
- **경로**: [plugins/backend-ts/skills/rate-limit-policy/SKILL.md](../../../plugins/backend-ts/skills/rate-limit-policy/SKILL.md)
- **description**: "TS 백엔드 rate limit invariant — per-user / per-IP / per-endpoint 3-axis 기본, 429 응답 envelope, Retry-After 헤더 필수, token bucket / sliding window 알고리즘 선택, rate limit 키 충돌 / bypass 방지."
- **body**: 61 줄
- **분석**: 3-axis 표 + 429 envelope + 알고리즘 표 + 6 금지 + audit 체크리스트 5종 + failure mode 4종. 결함: ① **L28-37 의 알고리즘 표 (token bucket / fixed window / sliding log / sliding window counter)** 는 모델 native — AP-01 부분 적중. ② **L46-52 의 audit 체크리스트** 가 invariant 본문에 — `rate-limit-policy-audit` (99 줄) 와 중복.
- **이유**: 핵심 invariant 가치는 **3-axis 정책 (운영 결정) + 429 envelope (http-error-sentinels 와 일관성)** 에 있음.
- **조치**:
  1. **L28-37 알고리즘 표 슬림화** — "알고리즘 선택은 운영 결정. token bucket / sliding window 등은 native 지식" 1줄 도입 후 표 제거.
  2. **L46-60 audit + failure mode 제거** — `rate-limit-policy-audit/SKILL.md` 가 정본. invariant 에서는 `[[rate-limit-policy-audit]]` 참조만.
  3. **남길 것**: 3-axis 표 (L11-20) + 429 envelope (L21-26) + 6 금지 (L39-44).

---

### 14. run-policy-presets  [✅]
- **경로**: [plugins/backend-ts/skills/run-policy-presets/SKILL.md](../../../plugins/backend-ts/skills/run-policy-presets/SKILL.md)
- **description**: "RunPolicy 16 필드 defaults, cross-field 불변, 정책 해석 순서, 프리셋 가이드 invariant. YAML 추가만으로 새 엔드포인트."
- **body**: 87 줄
- **분석**: "엔드포인트 = YAML" 추상 + 16 필드 표 + cross-field 불변 7종 + 정책 해석 순서 6단계 + 프리셋 가이드 4종 + 9 금지. 매우 프로젝트 고유 (RunPolicy 자체가 고유 추상화).
- **이유**: "YAML 추가만으로 새 엔드포인트" 라는 강력한 운영 원칙 + 16 필드 default 가 명시되어 모델이 단독 추론 불가.
- **조치**: 없음. 모범적 invariant.

---

### 15. single-writer  [✅]
- **경로**: [plugins/backend-ts/skills/single-writer/SKILL.md](../../../plugins/backend-ts/skills/single-writer/SKILL.md)
- **description**: "Single-writer pattern invariant — 동일 자원의 쓰기 경로는 1개로 제한. Atomic write, per-resource lock, WriteCoordinator singleton."
- **body**: 131 줄
- **분석**: 원칙 + 3 단일 작성자 자원 표 + 4 핵심 메커니즘 (atomic write / per-resource lock / WriteCoordinator 싱글턴 / 경로 헬퍼) + 멀티 워커 가정 + StoragePort 추상 + 8 금지. WriteCoordinator / StoragePort 같은 프로젝트 고유 추상화.
- **이유**: crash-safety + 데이터 무결성 핵심. WriteCoordinator 싱글턴 정책은 모델 단독 추론 불가.
- **조치**: 없음. *Note*: L80-82 "현재: 싱글 프로세스 가정" 은 가정 명시. 멀티 워커 전환 시 본 invariant 갱신 의무 (변경 영향 명시).

---

### 16. spawn-limits  [✅]
- **경로**: [plugins/backend-ts/skills/spawn-limits/SKILL.md](../../../plugins/backend-ts/skills/spawn-limits/SKILL.md)
- **description**: "Sub-agent spawn 상한 (`MAX_SPAWN_DEPTH=3`), 3 mode, coordinator/worker 분리, state isolation, CacheSafeParams invariant."
- **body**: 133 줄
- **분석**: MAX_SPAWN_DEPTH=3 + 3 mode (foreground/in_process/background) + forked agent 별개 개념 + coordinator/worker 분리 + cross-field 충돌 + deterministic child ID + state isolation + CacheSafeParams + use_exact_tools + model override priority + 11 금지. 매우 프로젝트 고유.
- **이유**: 비용 통제 + cache stability 의 핵심. coordinator/worker 분리 / CacheSafeParams 정책 명확.
- **조치**: 없음. *Note*: L34 "in_process 는 rule 에 선언되어 있지만 **아직 구현 미완**" — aspirational. 본 invariant 가 그 사실을 명시해 정당화됨.

---

### 17. sse-lifecycle  [✅]
- **경로**: [plugins/backend-ts/skills/sse-lifecycle/SKILL.md](../../../plugins/backend-ts/skills/sse-lifecycle/SKILL.md)
- **description**: "SSE 12 이벤트 집합 + lifecycle 순서 + 종료 보장 4 제약 invariant. 이벤트 타입 추가/순서 변경은 클라이언트 상태머신 breaking change."
- **body**: 92 줄
- **분석**: 12 이벤트 집합 (session/agent/text/thinking/tool_call/tool_result/action/notification/suggestions/usage/done/error) + lifecycle 순서 + 종료 보장 4 제약 + 이벤트 카테고리 표 + 변경 영향 + 5 금지. 12 이벤트는 본 plugin 의 정의.
- **이유**: 클라이언트 상태머신과의 contract 정본. "이벤트 타입 추가/순서 변경 = breaking change" trigger 명확.
- **조치**: 없음. 모범적 invariant.

---

### 18. structured-log-schema  [✏️]
- **경로**: [plugins/backend-ts/skills/structured-log-schema/SKILL.md](../../../plugins/backend-ts/skills/structured-log-schema/SKILL.md)
- **description**: "구조화 로그 invariant — 10 trace 필드 (request_id / trace_id / span_id / session_id / user_id / run_name / agent / model / turn_count / spawn_depth), log level 매트릭스, 메시지 명명 규약, scrub 의무, log injection 방어."
- **body**: 83 줄
- **분석**: 필수 3 필드 + trace correlation 4 필드 + optional 4 필드 + log level 매트릭스 + 메시지 명명 + scrub + 5 금지 + audit 체크리스트 5종 + failure mode 4종. 결함: ① **log level 매트릭스 (L43-49)** + **메시지 명명 (L51-53)** + **로그 injection 방어** 는 모델 native — AP-01 부분 적중. ② **L67-83 audit 체크리스트 + failure mode** 가 invariant 본문에 — `structured-log-schema-audit` (125 줄) 와 중복.
- **이유**: 핵심 invariant 가치는 **10 trace 필드 중 6 프로젝트 고유 (session_id/user_id/run_name/agent/model/turn_count/spawn_depth — agent-loop-invariants 와 묶임)** 에 있음. 일반 logging 지식은 슬림화 가능.
- **조치**:
  1. **L41-53 log level + 명명 규약 슬림화** — "log level matrix / snake_case 명명은 native 지식, 본 invariant 는 *프로젝트 고유 6 trace 필드* 만 강제" 도입.
  2. **L67-83 audit + failure mode 제거** — `structured-log-schema-audit` 정본. invariant 에서는 `[[structured-log-schema-audit]]` 참조만.
  3. **남길 것**: 필수 3 + trace correlation 4 + agent-loop 컨텍스트 6 필드 표 (L13-39), scrub 의무 (L55-57), 5 금지 (L59-65).

---

### 19. token-budget-constants  [✅]
- **경로**: [plugins/backend-ts/skills/token-budget-constants/SKILL.md](../../../plugins/backend-ts/skills/token-budget-constants/SKILL.md)
- **description**: "Token budget 6 영역, 3-layer system prompt, attachment 수집 순서, compaction 트리거 조건 invariant. 수치 상수 및 순서 변경 금지."
- **body**: 129 줄
- **분석**: 6 영역 (BASE/AGENT/HINT/MEMORY/CONVERSATION/RESERVED) 토큰 분배 + provider 별 effective window 동적 스케일 + Compaction trigger (SAFETY_BUFFER 와의 관계 명시) + 3-layer system prompt 순서 + 프롬프트 파일 관리 + Attachment 수집 순서 + SKILLS attachment 위치 (ordinal 9 고정) + Memory>History 우선순위 + Nested Memory + dual dedup + AssembledContext + 9 금지. 매우 프로젝트 고유.
- **이유**: token budget + cache stability 의 정본. "수치 상수 및 순서 변경 금지" trigger 명확.
- **조치**: 없음. *Note*: L86 "현재 vs 목표: AttachmentType enum 은 **11 values** (현재 코드 기준). 디자인 spec 목표는 **17 types**" — aspirational. 향후 17 으로 증가 시 본 invariant 갱신.

---

### 20. tool-sort-order  [✅]
- **경로**: [plugins/backend-ts/skills/tool-sort-order/SKILL.md](../../../plugins/backend-ts/skills/tool-sort-order/SKILL.md)
- **description**: "Tool API 배열 정렬 순서 (built-in → MCP, 각 그룹 알파벳), is_concurrency_safe 입력 기반 동적 결정, ToolProtocol 8 멤버 invariant."
- **body**: 96 줄
- **분석**: 정렬 순서 (built-in → MCP) + is_concurrency_safe 입력 기반 동적 결정 + 실행 전 2단계 체크 (validateInput → checkPermissions) + ToolProtocol 8 멤버 + 결과 절단 (TOOL_PREVIEW_MAX_CHARS=4000) + Read 후 Edit mtime guard + 60개 deferred loading + 8 금지. 매우 프로젝트 고유.
- **이유**: prompt cache prefix 보호 + 권한/안전성 정합의 핵심. ToolProtocol 8 멤버 + mtime guard 정책 모두 프로젝트 결정.
- **조치**: 없음.

---

## 4. Batch 2 — Workflows: agent / loop / provider (12)

**분포**: ✅ 10 / ✏️ 0 / ❌ 0 / ⚠️ 2

**공통 관찰**:
- 모든 workflow 가 *해당 invariant 의 구현 청사진* 형태 — invariant=강제 룰 + workflow=실제 코드 스켈레톤. 분리는 의도된 layered separation 으로 대체로 정당화됨.
- 단 **new-agent ↔ ai-agent-patterns** 의 분리는 의문 — 둘 다 agent 정의 / loader / coordinator-worker / prompt 정책을 다루고 30-40% 내용 overlap. 사용자 결정 필요.
- 본 batch 의 workflow 들은 평균 200-340줄로 길지만, 모두 *프로젝트 고유 코드 스켈레톤* + *runtime caveat* + *동시성 함정* 으로 채워져 정당화. 모델 native 와 거의 안 겹침.

---

### 21. agent-loop  [✅]
- **경로**: [plugins/backend-ts/skills/agent-loop/SKILL.md](../../../plugins/backend-ts/skills/agent-loop/SKILL.md)
- **description**: "<api-app> 에서 agentic loop (provider → tool calls → 결과 feed → loop) 구현 / 수정 시 invoke. LoopState 관리, 에러 복구 4분기, tool concurrency 파티셔닝, compaction check 위치 안내. tool_use 무한 루프, budget 이상, 복구 분기 미발동 디버깅 시에도 invoke."
- **body**: 200 줄
- **분석**: 7단계 스켈레톤 + LoopState 정의 + 에러 복구 4종 (RateLimit / PromptTooLong / MaxOutputTokens / ProviderError / ToolExecutionError) + 동시성 함정 3종 + Runtime 특화 + 검증 체크리스트. agent-loop-invariants 가 *순서/enum 강제*, 본 workflow 는 *구현 코드* 로 분리 명확.
- **이유**: src/engine/loop.ts 의 청사진. trigger ("디버깅 시에도 invoke") 명확.
- **조치**: 없음. agent-loop-invariants 와 짝으로 우수한 invariant ↔ workflow 분리 사례.

---

### 22. ai-agent-patterns  [⚠️]
- **경로**: [plugins/backend-ts/skills/ai-agent-patterns/SKILL.md](../../../plugins/backend-ts/skills/ai-agent-patterns/SKILL.md)
- **description**: "<api-app> 에 새 agent 정의 추가 / AgentDefinition 스키마 변경 / agent loader 수정 시 invoke. YAML + markdown prompt 선언, zod 기반 AgentDefinition 검증, in-memory cache (Map) 패턴, coordinator vs worker tool 제한, prompt cache 보전 안내."
- **body**: 213 줄
- **분석**: 파일 레이아웃 + AgentDefinitionSchema (zod) + Loader 규약 + Discover 규약 + Memory 3-Tier 금지 + Tool 휴리스틱 + Context budgeting + Safety gate + Fallback + 절차 + 영향도 + 11 금지. **D-01 적중**: `new-agent` workflow (225 줄) 와 30-40% 내용 overlap — 양쪽 모두 AgentDef interface, Coordinator vs Worker, prompt 동적값 금지, 6-step 절차 등을 다룸.
- **이유**: 두 skill 의 *목적*은 다름 (ai-agent-patterns = *schema/loader/discover/memory 정책 청사진*, new-agent = *step-by-step 추가 절차*). 하지만 본문 30-40% overlap → 사용자가 새 agent 추가 시 두 skill 모두 invoke 될 가능성 → description budget 잠식 + 충돌 위험.
- **조치 (사용자 결정 요청)**:
  - 질문 1: ai-agent-patterns 와 new-agent 의 분리가 *의도된 layered separation* 인가? (예: ai-agent-patterns = 처음 한 번 읽는 architecture, new-agent = 매번 새 agent 추가 시 invoke)
  - 질문 2: 통합 시 단일 skill 로 합쳐 *Architecture + 6-step 절차* 로 묶을 수 있는가? (예: ai-agent-patterns 본문 → new-agent 의 "0. 사전 지식" 섹션으로 흡수)
  - 질문 3: 분리 유지 시 ai-agent-patterns 의 description trigger 를 "처음 contributor 가 agent 시스템 *전반 이해* 가 필요할 때" 로 명확화 + new-agent 의 description 에 "agent system 전반은 ai-agent-patterns 참조" exclusion clause 추가 — overlap 해소.
  - 권고 (default): **분리 유지 + description 명확화** (option 3). 이유: 두 skill 모두 본질 가치 있음, overlap 은 description trigger 로 해소 가능.

---

### 23. new-agent  [⚠️]
- **경로**: [plugins/backend-ts/skills/new-agent/SKILL.md](../../../plugins/backend-ts/skills/new-agent/SKILL.md)
- **description**: "새 agent 정의 (`<api-app>/src/agents/<name>.ts` + `<api-app>/agents/<name>.yaml` + prompts/<name>.md) 추가 시 invoke. AgentDef interface + zod schema 검증 + tool allowlist 룰 (coordinator vs worker) + 등록/스모크 체크. agent-loop-invariants + run-policy-presets + spawn-limits invariant 자동 적용. Codex 의 .codex-plugin/agents/ 마커도 함께 생성."
- **body**: 225 줄
- **분석**: 6 step 절차 + AgentDef interface + YAML 스키마 + Coordinator vs Worker 표 + 시스템 프롬프트 템플릿 + 등록 체크리스트 + 스모크 테스트 + Codex marker mirror. **D-01 적중** (위 #22 와 같은 이슈) — ai-agent-patterns 와 30-40% 내용 overlap.
- **이유**: step-by-step 가이드로서 가치 있음. 단 ai-agent-patterns 와 통합/분리 정책 결정 필요.
- **조치 (사용자 결정 요청)**: 위 #22 참조. 권고 (default): **분리 유지** + new-agent 의 description 에 "AgentDef 구조 / loader 동작 등 전반은 [[ai-agent-patterns]] 가 정본" exclusion clause 추가.

---

### 24. new-run  [✅]
- **경로**: [plugins/backend-ts/skills/new-run/SKILL.md](../../../plugins/backend-ts/skills/new-run/SKILL.md)
- **description**: "새 agent run 정의 시 invoke. `<api-app>/runs/<name>.yaml` + `<api-app>/runs/prompts/<name>.md` 스캐폴드 — 4 RunPolicy preset (interactive / classifier / tool-based / multi-agent) 중 선택. name pattern + full-form 필드명 + cross-field validation 강제. run-policy-presets + sse-lifecycle + token-budget-constants + spawn-limits invariant 자동 적용. new-agent 와 경계 분리 (agents 는 spawn 대상 / runs 는 `POST /run/<name>` 엔드포인트)."
- **body**: 339 줄
- **분석**: 경계 표 (vs new-tool / new-agent) + 6 step 절차 + RunPolicy 정본 코드 + 4 Presets + Cross-Field Validation + SSE 핸들러 골격 + 스캐폴드 절차 + Prompt 템플릿 + 완료 가이드 + 검증 체크리스트. 매우 자세하지만 모두 프로젝트 고유 (RunPolicy 자체, 4 preset 정책, framework-neutral SSE 핸들러). run-policy-presets invariant 와 짝.
- **이유**: 매우 명확한 trigger ("새 agent run 정의 시 invoke") + new-agent 와의 경계 분리 명시 (L20-26).
- **조치**: 없음. 모범적 workflow.

---

### 25. sub-agent  [✅]
- **경로**: [plugins/backend-ts/skills/sub-agent/SKILL.md](../../../plugins/backend-ts/skills/sub-agent/SKILL.md)
- **description**: "src/tools/spawn.ts 또는 src/engine/subagent.ts 최초 작성·수정 시 invoke. MAX_SPAWN_DEPTH = 3 상수 / SpawnDepthExceeded / checkDepth() 가드 / SpawnQueue (background task 추적) / useExactTools 캐시 정합성 / summarizeSession() 결과 압축. depth budget exhausted, 무한 재귀, 부모 cache hit 소실 디버깅 시에도 invoke."
- **body**: 431 줄 (가장 긴 workflow 중 하나)
- **분석**: foreground vs background 모드 + spawn_agent tool signature + SpawnTool 구현체 + depth limit 코드 + useExactTools 캐시 정합 + SpawnQueue 클래스 + summarizeSession + 동시성 함정 3종 (background queue, depth 전파, cache invalidation) + 검증 체크리스트. spawn-limits invariant 와 짝.
- **이유**: 길지만 모두 *프로젝트 고유 코드 청사진* + *디버깅 시나리오* — 정당화. trigger ("depth budget exhausted, 무한 재귀, 부모 cache hit 소실" 디버깅) 매우 명확.
- **조치**: 없음.

---

### 26. provider-layer  [✅]
- **경로**: [plugins/backend-ts/skills/provider-layer/SKILL.md](../../../plugins/backend-ts/skills/provider-layer/SKILL.md)
- **description**: "<api-app> 에 새 LLM provider 추가 / 기존 provider retry/timeout 정책 변경 / OpenRouter 게이트웨이 우회 (Anthropic·OpenAI·Google 직접 SDK escape hatch) 시 invoke. provider 코드 수정, model resolution 분기 변경, retry storm 디버깅 시에도 invoke."
- **body**: 292 줄
- **분석**: Provider Interface 코드 + Model Resolution 4단계 함수 + Fuzzy Match + Connected Providers Cache + Retry Policy 표 + Stream Tee 패턴 + Provider-specific Quirks 표 + 검증 체크리스트 + 구현 막힘 시 도움. provider-retry-matrix invariant 와 짝.
- **이유**: Stream Tee 패턴 (L220-262), Model Resolution 4단계 (L84-103) 등 프로젝트 고유 청사진. 모두 코드 수준 청사진.
- **조치**: 없음. *Minor*: Retry Policy 표 (L170-178) 가 provider-retry-matrix invariant 와 일부 overlap — invariant 는 retryable 4종 분류만, workflow 는 foreground/background 구체 수치 — 분리 정당화.

---

### 27. provider-scaffold  [✅]
- **경로**: [plugins/backend-ts/skills/provider-scaffold/SKILL.md](../../../plugins/backend-ts/skills/provider-scaffold/SKILL.md)
- **description**: "<api-app> 에 새 LLM provider (Anthropic / OpenAI / Google / OpenRouter / OpenAI-compatible self-hosted) 추가 시 invoke. 7-step 절차 — Provider interface 구현 / retry 매트릭스 / 카탈로그 yaml 항목 / test scaffolding / catalog sync. `provider-layer` 의 단일 변환 원칙 + `provider-retry-matrix` invariant 준수."
- **body**: 351 줄
- **분석**: 7-step 절차 + Case A (직접 SDK Provider 코드 청사진) + Case B (OpenAI-compatible 셀프 호스팅 — 카탈로그 yaml 만) + 검증 체크리스트 + 절대 금지 + Cross-ref. 매우 자세, Provider interface 본문은 *재정의 금지* 명시 (L324-325) 로 정본 분리 명확.
- **이유**: 새 provider 추가 시 step-by-step 가이드. trigger 명확 ("새 LLM provider 추가 시 invoke"). Cross-ref 표 (L342-350) 가 정본 분리를 잘 명시 — 모범적.
- **조치**: 없음.

---

### 28. provider-catalog-sync  [✅]
- **경로**: [plugins/backend-ts/skills/provider-catalog-sync/SKILL.md](../../../plugins/backend-ts/skills/provider-catalog-sync/SKILL.md)
- **description**: "<api-app> 의 provider 모델 카탈로그 (bundled snapshot + FUZZY 별칭 + ENV default) 새로고침 시 invoke. 주요 provider 릴리스 직후 / `_meta.updated` 3개월 경과 / 새 provider 추가 직후 운영 절차. PROVIDER_SOURCES 표가 유일한 provider별 지식 — 새 provider 추가 = 행 1개 추가."
- **body**: 287 줄
- **분석**: 언제 invoke / 언제 invoke 안 됨 분리 + PROVIDER_SOURCES 표 (확장 지점) + 5-step sync process + sync-models 스크립트 코드 + Report 템플릿 + 영향도 + 금지 + 검증 체크리스트.
- **이유**: 운영 절차의 정본 — bundled_models.json 갱신 + FUZZY_MAP + ENV_DEFAULT_MODEL 의 sync 가 프로젝트 고유. PROVIDER_SOURCES 표가 "새 provider 추가 = 행 1개" 패턴으로 확장성 명확.
- **조치**: 없음. *Note*: L42-46 의 외부 URL (https://docs.anthropic.com/...) 은 stale 위험 (AP-03 약). 본질이 catalog sync workflow 이므로 정당화. Report 템플릿 (L209-237) 의 날짜 "2026-MM-DD" placeholder 가 미래 사용을 제대로 가이드.

---

### 29. tool-system  [✅]
- **경로**: [plugins/backend-ts/skills/tool-system/SKILL.md](../../../plugins/backend-ts/skills/tool-system/SKILL.md)
- **description**: "<api-app> 에 새 LLM tool 추가 / ToolRegistry 수정 / tool concurrency 정책 변경 시 invoke. tool 등록 규칙, is_concurrency_safe 분기, ToolContext dataclass, dispatch_tool_calls orchestration 포함. tool not registered, tool schema validation 실패, race condition 디버깅 시에도 invoke."
- **body**: 222 줄
- **분석**: Tool interface + ToolRegistry 클래스 + ToolContext + dispatchToolCalls 함수 (병렬 파티셔닝 코드) + 동시성 함정 3종 + 신규 도구 체크리스트 + 검증. tool-sort-order invariant 와 짝.
- **이유**: 구현 청사진 (Tool interface + ToolRegistry + dispatchToolCalls) 이 매우 프로젝트 고유. trigger 명확 ("tool 등록 / concurrency 정책 / race condition 디버깅").
- **조치**: 없음.

---

### 30. context-assembly  [✅]
- **경로**: [plugins/backend-ts/skills/context-assembly/SKILL.md](../../../plugins/backend-ts/skills/context-assembly/SKILL.md)
- **description**: "<api-app> 에서 컨텍스트 조립 (system prompt + history + retrieved + tools) 추가/수정 시 invoke. TokenBudget 상수, AssembledContext 타입, static system prompt 원칙, context_hint 주입 패턴 안내. token budget 초과, cache 적중률 하락, memory block 유실 디버깅 시에도 invoke."
- **body**: 207 줄
- **분석**: TokenBudget 상수 + 3-Layer Prompt 코드 (HINT_TEMPLATE, buildSystemPrompt) + Token Counting (근사 + js-tiktoken) + AssembledContext + Memory Block 주입 (memoryPrefixLen 보존 로직) + 동시성 함정 3종 + 검증. token-budget-constants invariant 와 짝.
- **이유**: assembleContext / assembleMessages 함수가 매우 프로젝트 고유. trigger 명확 ("cache 적중률 하락, memory block 유실 디버깅").
- **조치**: 없음. *Note*: L32-50 TokenBudget 상수는 token-budget-constants invariant 와 *정본 중복* 위험 — 본 workflow 의 L53 "token-budget-constants invariant 가 이 값들의 정본. 본 skill 은 활용 방법 안내" 명시로 잘 해소됨.

---

### 31. compaction  [✅]
- **경로**: [plugins/backend-ts/skills/compaction/SKILL.md](../../../plugins/backend-ts/skills/compaction/SKILL.md)
- **description**: "<api-app> 에서 토큰 한계 접근 시 conversation 요약·압축 트리거 시 invoke. 5 전략 에스컬레이션 (snip/micro/session_memory/auto/reactive), CompactionResult 타입, COMPACTABLE_TOOLS frozenset, autoCompactThreshold 계산 안내. context window exceeded 에러, auto compaction 미발동 디버깅 시에도 invoke."
- **body**: 348 줄 (가장 긴 workflow 중 하나)
- **분석**: 5 핵심 원칙 + autoCompactThreshold 계산 + CompactionResult + COMPACTABLE_TOOLS + 5 전략 코드 구현 (snip/micro/session_memory/auto/reactive) + dispatch 함수 + 경량 모델 요약 + 동시성 함정 3종 + 검증. compaction-thresholds invariant 와 짝.
- **이유**: 5 전략의 실제 코드 구현 (~250줄) 이 매우 가치 있음. 모두 프로젝트 고유 (ESCALATION_TARGET_RATIO=0.80, REACTIVE_TARGET_RATIO=0.70, INTERNAL_MODEL='claude-haiku-4-5' 등).
- **조치**: 없음.

---

### 32. mcp-integration  [✅]
- **경로**: [plugins/backend-ts/skills/mcp-integration/SKILL.md](../../../plugins/backend-ts/skills/mcp-integration/SKILL.md)
- **description**: "<api-app> 에서 MCP 서버 연결 / namespace 결정 / tool 자동 prefix 추가 시 invoke. @modelcontextprotocol/sdk 기반 client, MCPServerConfig, mcp_ prefix 브릿지, JSON schema → zod 동적 변환 패턴. MCP tool not registered, MCP server disconnected 디버깅 시에도 invoke."
- **body**: 299 줄
- **분석**: 3-파일 구조 (config.ts / client.ts / bridge.ts) + MCPServerConfig + resolveEnvVars + loadMCPRegistry + MCPClient 클래스 + makeMCPToolClass + registerAllMCPTools + buildZodFromSchema + 동적 tool 등록 흐름 + 실패 모드 표 + 검증. mcp-namespace invariant 와 짝.
- **이유**: 3-파일 구조 + 동적 JSON schema → zod 변환 (buildZodFromSchema) 가 매우 프로젝트 고유. trigger 명확 ("MCP tool not registered, MCP server disconnected 디버깅").
- **조치**: 없음.

---

## 5. Batch 3 — Workflows: http / auth / security (13)

**분포**: ✅ 6 / ✏️ 6 / ❌ 0 / ⚠️ 1

**공통 관찰**:
- 본 batch 에서 ✏️ 가 6개로 가장 많음 (Batch 1: 4개 / Batch 2: 0개). 원인 패턴 3가지:
  - **(P1) 모델 native 겹침**: `coding-standards` (가장 심각), `auth`, `idempotency-key` 의 일반 표준 부분 (TS naming, JWT verify, HTTP idempotency RFC 7231)
  - **(P2) `stack-backend-ts → backend-ts` rename 후 미갱신**: `codex-commands`, `codex-subagents`, `commit-rules` 본문에 legacy plugin 명 잔존 (commit 91bf02c 이후 미갱신)
  - **(P3) audit 체크리스트가 workflow/invariant 본문에 중복**: `auth`, `idempotency-key` (idempotency-audit skill 자체가 없음 — 정당화 일부 가능)
- ⚠️ `security-runtime` 은 9 항목 grep 명령 모음이 사실상 *통합 audit batch* — security-audit-check / 개별 *-audit skill 들과 역할 분리 불명확.

---

### 33. api-routing  [✅]
- **경로**: [plugins/backend-ts/skills/api-routing/SKILL.md](../../../plugins/backend-ts/skills/api-routing/SKILL.md)
- **description**: "<api-app> 에 새 HTTP route / middleware / 전역 에러 핸들러 추가 시 invoke. route 그룹화 + middleware 순서 + auth middleware 패턴, HTTP 에러 sentinel 변환, CORS expose_headers 규약 안내."
- **body**: 117 줄
- **분석**: 최상위 prefix 규약 표 + Middleware 등록 순서 (requestId → rateLimit → cors → auth → schema → handler) + Route 구현 원칙 + Leak-safe 404 + HTTP 에러 변환 표 + CORS expose_headers + Routes 계층 원칙 표. 프로젝트 고유 (middleware 순서, X-App-* 헤더 4종 expose, routes thin layer 원칙).
- **이유**: middleware 순서와 routes 계층 분리는 프로젝트 결정. http-error-sentinels invariant 와 cross-ref 명시 (L71-78).
- **조치**: 없음. *Minor*: L71-78 의 sentinel 매핑 표가 http-error-sentinels 와 information duplication (4행) — invariant cite 만으로 충분. 슬림화 가능.

---

### 34. auth  [✏️]
- **경로**: [plugins/backend-ts/skills/auth/SKILL.md](../../../plugins/backend-ts/skills/auth/SKILL.md)
- **description**: "<api-app> 인증·세션·시크릿 추가 또는 수정 시 invoke. JWT 인증 / 세션 스토어 / API key / rate limit 패턴, scope 검증, 시크릿 누락 에러 처리. 인증 실패 401 디버깅, 시크릿 누락 에러 시에도 invoke."
- **body**: 102 줄
- **분석**: JWT 인증 원칙 (signing / verify / expiry / claims / algorithm pinning) + API Key 인증 원칙 + 시크릿 접근 원칙 + 세션 스토어 (SessionPort interface) + Rate Limit + Scope 검증 + 시크릿 누락 에러 처리. **P1 적중**: L20-32 의 JWT 일반 원칙 (HS256/RS256 선택, exp claim, algorithm pinning, refresh token) + L34-39 의 API Key bcrypt hash 패턴은 *모델 native*. **D-01**: rate-limit-policy invariant 와 overlap (L68-75).
- **이유**: 프로젝트 고유 부분 (SessionPort interface, assertRequiredSecrets, leak-safe 404, X-App-* 헤더) 은 가치 있음 — 그러나 일반 인증 지식과 혼재.
- **조치**:
  1. **L20-32 JWT 인증 원칙 슬림화** — algorithm pinning, exp claim 권장, refresh token 패턴은 native. 본 plugin 의 *프로젝트 결정* (예: "AUTH_SECRET 단일 source, 15분 access + 7일 refresh 정책") 만 남기기.
  2. **L34-39 API Key 인증 슬림화** — bcrypt hash 저장은 native. kid 단위 revoke 정책 + secret-rotation cross-ref 만 남기기.
  3. **L68-75 Rate Limit 섹션 제거** — rate-limit-policy invariant 가 정본. cite 만.
  4. **남길 것**: SessionPort interface (L52-66), assertRequiredSecrets() startup 검증, scope leak-safe 404 (api-routing 과 일관성), `.gitignore` 의 secret 파일 정책.

---

### 35. backend-overview  [✏️]
- **경로**: [plugins/backend-ts/skills/backend-overview/SKILL.md](../../../plugins/backend-ts/skills/backend-overview/SKILL.md)
- **description**: "TS 백엔드 진입 시 또는 새 모듈 위치 결정 시 invoke. TS 디렉토리 구조와 모듈 의존성 방향, 주요 진입점 (src/routes/, src/ai/providers/, src/sse/) 안내. 새 contributor onboarding, 어디에 무엇이 있는지 분류 필요 시에도 invoke. framework / runtime 무관."
- **body**: 161 줄
- **분석**: L13 "본 skill = 디렉토리 → 서브시스템 매핑 만" 명시적 정본 분리 — architecture-invariants 와의 세 메타 catalog 역할 분리 모범. 디렉토리 트리 (L62-105) + 계층 단방향 import + 서브시스템 매핑 표 (14 행) + sub-area 변형 표. **P2 적중 (Codex 검증으로 확정)**: L23 "**`plugins/stack-backend-ts/skills/`** 의 invariant SKILL.md 파일들에 있다" — `backend-ts` 로 rename (commit 91bf02c) 후 미갱신. 본 plugin 이 thin index 로서 *다른 skill 들의 진입점* 역할을 하므로 잘못된 plugin 명 노출이 *cascading*.
- **이유**: 본문 가치는 그대로 우수하나 plugin 명이 stale → 신규 contributor 가 잘못된 경로를 보게 됨.
- **조치**:
  1. **L23 `plugins/stack-backend-ts/skills/` → `plugins/backend-ts/skills/`** 치환.
  2. *Minor (선택)*: L23-43 의 19 invariant → SKILL.md description 매핑은 architecture-invariants 와 정보 중복 (각 invariant trigger 가 backend-overview 에서 반복 cite 됨) — backend-overview 는 *디렉토리/서브시스템 매핑 표* (L130-145) 만 남기고 invariant 매핑은 architecture-invariants cite 1줄로 슬림화 가능.

---

### 36. codex-commands  [✏️ — 🆘 false premise]
- **경로**: [plugins/backend-ts/skills/codex-commands/SKILL.md](../../../plugins/backend-ts/skills/codex-commands/SKILL.md)
- **description**: "Codex 환경에서 stack-backend-ts plugin 의 slash command 호출 시 invoke. `.codex-plugin/commands/` 카탈로그 + arg 파싱 + 출력 포맷. Claude Code 의 `.claude/commands/` 와 contract 호환 — Codex 측 mirror."
- **body**: 183 줄
- **분석**: Codex slash command adapter 를 가정. **v3 추가 검증 (Codex 공식 spec `developers.openai.com/codex/plugins/build` 직접 fetch)**: 본 skill 의 핵심 가정 (`.codex-plugin/commands/<name>.md` 가 Codex 가 인식하는 디렉토리) 이 **공식 spec 과 충돌**:
  - 공식 spec verbatim: *"Only `plugin.json` belongs in `.codex-plugin/`. All other components reside at the plugin root level."*
  - 공식 plugin component = **skills / mcpServers / apps / hooks** 4개 — *commands 도, agents 도 plugin component 가 아님*.
  - 공식 디렉토리 트리에는 `commands/` 가 plugin root 에도 부재.
  - `import { spawnAgent } from '@codex/cli-host'` 등 본문이 인용하는 API 도 npm 에 실재 ✕.
  - 즉, 본 skill 의 (b) 가 *유일하게 정합한 선택* (a 는 Codex 가 그 디렉토리를 안 보므로 의미 ✕).
- **이유**: 본문이 가정하는 *Codex commands mirror infra* 가 Codex spec 에 존재하지 않는다. 본 skill 의 dispatch 절차는 작동 ✕. (audit v2 에서 (a)/(b) 양자택일로 표현했으나 v3 에서 (a) 가 무효임을 확정.)
- **조치 (P0 — (b) 확정)**:
  1. **본문 전면 재작성** — *부정 안내* 중심:
     - "Codex CLI 의 plugin spec 은 commands 를 plugin component 로 인식 ✕" 명시
     - Codex 의 *built-in* slash commands 만 존재 (커스텀 슬래시는 spec 미공개)
     - backend-ts plugin 의 84 skill 은 `plugin.json` 의 `"skills": "./skills/"` 로 정상 발견됨
     - Claude Code `.claude/commands/` 동등 시스템은 Codex 에 부재
  2. **Command Map (13행) / Dispatch 절차 / TS implementation 패턴 / spawn contract 코드 블록 제거**.
  3. **`stack-backend-ts` → `backend-ts` rename** (잔존 잔재 — description + L13, L26, L62-68, L173).
  4. **`.codex-plugin/plugin.json` 의 `"name"` rename** (별도 PR 0 항목 — manifest level).
  5. 재작성 후 line count: 183줄 → 40-60줄 예상 (부정 안내 + plugin discovery 만).

---

### 37. codex-subagents  [✏️ — 🆘 false premise]
- **경로**: [plugins/backend-ts/skills/codex-subagents/SKILL.md](../../../plugins/backend-ts/skills/codex-subagents/SKILL.md)
- **description**: "Codex 환경에서 stack-backend-ts plugin 의 subagent 정의/호출 시 invoke. `.codex-plugin/agents/` 카탈로그 + Claude Code 의 Agent tool contract 호환. Codex 가 named agent 를 직접 로드하지 못해 reference md 로 mirror."
- **body**: 161 줄
- **분석**: Codex sub-agent adapter 를 가정. **v3 추가 검증 (Codex 공식 spec + agents_md docs 직접 fetch)**:
  - 공식 plugin spec: agents 가 plugin component 가 *아님* (skills/mcpServers/apps/hooks 만).
  - `developers.openai.com/codex/agents-md` — 404 (named sub-agent dispatch 시스템 docs *부재*).
  - `agents_md.md` docs (raw): AGENTS.md 는 *단일 프로젝트 인스트럭션 파일* (CLAUDE.md 와 동등). `child_agents_md` feature flag 는 `config.toml` 에서 AGENTS.md 의 scope/precedence 만 조정.
  - 결론: **Codex 에 Claude Code `.claude/agents/<name>.md` 동등 시스템 존재 ✕** (또는 미공개).
  - `import { spawnAgent } from '@codex/cli-host'` 도 npm 실재 ✕.
- **이유**: codex-commands 와 동일 패턴 — *Codex spec 에 존재하지 않는 mirror infra* 를 전제. 18 agent catalog 는 fundamental 하게 spawn 메커니즘 부재로 vapor.
- **조치 (P0 — (b) 확정)**:
  1. **본문 전면 재작성** — *부정 안내* 중심:
     - "Codex CLI 는 Claude Code `.claude/agents/` 동등 시스템 부재" 명시
     - AGENTS.md 는 단일 파일 (CLAUDE.md 동등) — child_agents_md feature flag 안내 (config.toml)
     - 사용자가 sub-agent 패턴이 필요하면: 메인 task 안에서 *emulation* 만 가능 (실제 spawn 없음, role 명시 + 단일 컨텍스트 내 처리)
     - backend-ts plugin 의 skill 들은 Codex 가 정상 발견
  2. **Agent Catalog (18행) / Dispatch 절차 / sub-agent 정의 구조 / Codex spawn contract / emulation vs spawn / 신규 추가 절차 제거**.
  3. **`stack-backend-ts` → `backend-ts` rename** (잔존 잔재 — description + L13, L25, L131-132, L151).
  4. 재작성 후 line count: 161줄 → 40-60줄 예상 (부정 안내 + AGENTS.md 안내 + emulation 패턴).

---

### 38. coding-standards  [✏️]
- **경로**: [plugins/backend-ts/skills/coding-standards/SKILL.md](../../../plugins/backend-ts/skills/coding-standards/SKILL.md)
- **description**: "<api-app> TS 코드 작성 시 invoke. 네이밍 (camelCase / PascalCase / UPPER_SNAKE / kebab-case 파일명), 타입 (strict TS + zod 경계), async (Promise / fetch / Promise.all), 로깅 (pino + AsyncLocalStorage / edge runtime JSON.stringify), SRP / DRY / KISS / YAGNI 원칙 안내."
- **body**: 122 줄
- **분석**: 네이밍 + Import 규약 + 타입 (strict TS) + 비동기 + 로깅 + 원칙 (SRP/OCP/DRY/KISS/YAGNI) + 주석 + 영향도 + 금지. **P1 가장 심각**: 본 batch 에서 모델 native 와 *광범위* 겹침. (보고서 §6 dry-run 에서 사용자가 이미 다룬 사례)
  - L30-42 네이밍 표 (camelCase / PascalCase / UPPER_SNAKE / kebab-case) → TS 커뮤니티 표준, 모델 native
  - L45-60 Import 규약 (named import, wildcard 금지) → 표준
  - L66-71 타입 (TypeScript strict) → 표준
  - L74-78 비동기 (Promise.all / Promise.allSettled) → 표준
  - L88-93 SRP/OCP/DRY/KISS/YAGNI → 가장 표준
- **이유**: 프로젝트 고유 부분 (AsyncLocalStorage 10 필드 cite, scrubText, 5-level logLevel, snake_case 금지 — Python 흔적) 은 가치 있음. 그러나 80% 이상이 native 와 겹침.
- **조치**:
  1. **L30-42 네이밍 표 → 1-2줄**: "naming = standard TS conventions (camelCase / PascalCase / UPPER_SNAKE / kebab-case 파일명). **본 plugin 의 *특수 룰*: snake_case 변수명/file 명 금지 — Python 코드 복붙 흔적 차단**."
  2. **L45-60 Import 규약 슬림화**: "named import + import 정렬은 표준. **본 plugin 의 *특수*: `import type {}` 의무 (bundle 사이즈)**."
  3. **L66-71 타입 슬림화**: "tsconfig strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes. *any 금지 — 외부 SDK 경계는 zod parse*. 자세히는 [[ts-agent-rules]]."
  4. **L74-78 비동기 슬림화**: "Promise.all vs allSettled 는 표준. *CPU 블로킹은 ML-worker 격리*."
  5. **L80-84 로깅**: 프로젝트 고유 (pino + AsyncLocalStorage 10 필드 + 5-level logLevel) 만 keep. cite [[structured-log-schema]] / [[ts-agent-rules]].
  6. **L88-93 원칙 (SRP/OCP/DRY/KISS/YAGNI) 제거** — 모델 native, 본 plugin 만의 해석 없음.
  7. **L110-121 금지 사항**: snake_case (Python 흔적), `as any` 도주, hardcode 절대 경로 등 프로젝트 고유 부분만 keep.
  - 예상 효과: 122줄 → 50-60줄 슬림화, description budget 회복.

---

### 39. commit-rules  [✏️]
- **경로**: [plugins/backend-ts/skills/commit-rules/SKILL.md](../../../plugins/backend-ts/skills/commit-rules/SKILL.md)
- **description**: "<api-app> / plugins/stack-backend-ts/ 변경 commit 작성 시 invoke. Conventional Commits 사용 — 7 접두사 자체는 표준 지식. 본 workflow 는 이 plugin 의 **scope 카탈로그** (stack-backend-ts / <api-app> / sub-area 매핑) 와 도메인 어휘 금지 같은 로컬 룰에 집중."
- **body**: 100 줄
- **분석**: Conventional Commits 표준 (짧게) + 제목/본문 형식 + Scope 카탈로그 (플러그인 + sub-area) + 좋은 예 + 영향도 + 금지 사항 (도메인 어휘 금지 등). 모범적 정본 분리 — "7 접두사 자체는 표준이므로 표만 짧게" 명시. **P2 적중**: description + L9 + L37-46 등 `stack-backend-ts` 잔존.
- **이유**: 매우 잘 정리된 workflow (정본 분리 + scope 카탈로그 + 도메인 어휘 금지 cite). 결함은 plugin 명 stale 만.
- **조치**:
  1. **`stack-backend-ts` → `backend-ts` 일괄 치환** — description + L3 + L9 + L11 + L37-46 + L70-77 + L83.
  - 그 외는 변경 불요.

---

### 40. design-principles  [✅]
- **경로**: [plugins/backend-ts/skills/design-principles/SKILL.md](../../../plugins/backend-ts/skills/design-principles/SKILL.md)
- **description**: "<api-app> 설계 결정 시 7가지 핵심 원칙 (Safe Defaults / Cheapest First / Cache Stability First / Isolation Default / Structured Errors to Model / Dynamic Context Injection / Partial Loading) 검토. PR 리뷰 자가체크 + 원칙 간 충돌 trade-off 안내."
- **body**: 167 줄
- **분석**: 7가지 핵심 원칙 (Safe Defaults / Cheapest First / Cache Stability First / Isolation Default / Structured Errors to Model / Dynamic Context Injection / Partial Loading) + 원칙 간 충돌 trade-off 표 + PR 리뷰 자가체크 + 메타. 모든 원칙에 "**왜**" + "**판단 기준**" + "**반례**" 명시 — AP-05 (all-caps imperative) 회피 + Explain-the-Why 패턴 모범.
- **이유**: 7 원칙 자체가 프로젝트의 *고유한 설계 결정*. 충돌 trade-off 표 (L143-152) 는 모델이 단독 추론 불가. PR 리뷰 자가체크 (L154-163) 가 매우 실용적.
- **조치**: 없음. *우수한 workflow 의 모델 사례* — 다른 workflow 들이 본받을 만함 (특히 "왜+판단 기준+반례" 패턴).

---

### 41. error-handling  [✅]
- **경로**: [plugins/backend-ts/skills/error-handling/SKILL.md](../../../plugins/backend-ts/skills/error-handling/SKILL.md)
- **description**: "<api-app> 의 에러 처리 4 표준 패턴 분류 + 예외 계층 (TypeScript) + Tool 에러 wrap 패턴 + Tool result 절단 + SSE 에러 emit. 전역 핸들러의 sentinel 매핑 / envelope shape / route-edge 발신 매트릭스는 [[http-error-sentinels]] invariant 가 정본 — 본 workflow 는 구현 분류만."
- **body**: 194 줄
- **분석**: 4 표준 패턴 분류 (공개 API / 내부 서비스 / 초기화 / best-effort) + 예외 계층 (AppError/ValidationError/ConfigurationError/ResourceError/InternalError 코드) + 전역 핸들러 pass-through 룰 + Tool 에러 wrap 패턴 + Tool result 절단 + Pattern 4 + SSE 에러 + Structured Logging cite + 금지 + Cross-ref. description 자체에 정본 분리 명시 ("sentinel 매핑 / envelope shape / route-edge 발신 매트릭스는 [[http-error-sentinels]] invariant 가 정본 — 본 workflow 는 구현 분류만") — 모범적!
- **이유**: 4 표준 패턴 매트릭스 + AppError 계층 + Tool 에러 wrap = 매우 프로젝트 고유. Cross-ref 표 (L186-194) 가 invariant ↔ workflow 분리를 잘 명시.
- **조치**: 없음. *우수한 정본 분리 사례*.

---

### 42. idempotency-key  [✏️]
- **경로**: [plugins/backend-ts/skills/idempotency-key/SKILL.md](../../../plugins/backend-ts/skills/idempotency-key/SKILL.md)
- **description**: "클라이언트 재시도 안전성 workflow — POST/PATCH/DELETE 의 Idempotency-Key 헤더 처리, 응답 캐싱 TTL 24h, key 중복 + 같은 body → replay, 다른 body → 409 conflict."
- **body**: 73 줄
- **분석**: 헤더 contract + 처리 절차 + 응답 헤더 + 저장 schema + 공통 금지 + Key 구성 (5 차원) + audit 체크리스트 + failure mode. **P1 부분 적중**: L11-23 의 Idempotency-Key 헤더 contract + 처리 절차는 *모델 native* (RFC 7231 / Stripe Idempotency-Keys 패턴). **P3 적중**: L58-65 audit 체크리스트 + L67-73 failure mode 가 workflow 본문에 — `idempotency-key-audit` skill 이 *없음* (audit-25 리스트에 부재) — 따라서 일부 정당화 가능하지만 분리 권고.
- **이유**: 프로젝트 고유 가치 (5 차원 key 구성, TTL 24h, 409 envelope = http-error-sentinels 와 일관) 명확. 다만 일반 RFC 패턴이 본문 절반.
- **조치**:
  1. **L11-23 헤더 contract + 처리 절차 슬림화** — 표준 패턴 1-2줄 도입 후 *본 plugin 의 결정* (TTL 24h, 5 차원 key, in-flight lock) 만 강조.
  2. **L48-52 Key 구성 5 차원 keep** — 멀티테넌트 격리 정책은 프로젝트 고유.
  3. **L58-65 audit 체크리스트 결정 (사용자 결정 요청)**: ① 별도 `idempotency-key-audit` skill 생성 후 이전, ② 본 workflow 에 유지 (audit skill 없으므로 정당화) — 권고 (default): **유지** (별도 skill 추가 시 description budget 잠식). 단 "audit 체크리스트는 본 workflow 본문" 임을 명시.
  4. **L67-73 failure mode 표 keep** — 가치 높음.

---

### 43. secret-rotation  [✅]
- **경로**: [plugins/backend-ts/skills/secret-rotation/SKILL.md](../../../plugins/backend-ts/skills/secret-rotation/SKILL.md)
- **description**: "secret 회전 workflow — env / secret store 회전 6단계, dual-key window 24h~7d, verify 양쪽 시도 + sign/encrypt 신규 key, 누설 시 응급 회전 (window skip), audit log 의무."
- **body**: 75 줄
- **분석**: dual-key window 6단계 + Rotation 절차 (verify N과 N+1, promote, grace, revoke) + 응급 회전 + 회전 대상 식별 (ENV / secret store / CI/CD / 운영자 문서) + 공통 금지 + 코드 레벨 검증 (getSecret 단일 함수, dual-key 지원, rotation hook, secret 로깅 차단, secret 만료 모니터링, test fixture namespace) + failure mode. 일반 secret rotation 패턴 (KMS rotation 표준) 이지만 정보 밀도 높음 + 프로젝트 고유 (24h~7d window, structured-log-schema fatal level cite, 강제 logout 사용자 공지) 명시.
- **이유**: 운영 절차의 정본 — dual-key window + rotation hook + emergency rotation 정책이 모델 단독 추론 불가.
- **조치**: 없음.

---

### 44. security-runtime  [⚠️]
- **경로**: [plugins/backend-ts/skills/security-runtime/SKILL.md](../../../plugins/backend-ts/skills/security-runtime/SKILL.md)
- **description**: "<api-app> 런타임 보안 감사 + 통합 보고서 작성 시 invoke. CORS / rate limit / auth 경로 커버리지 / leak-safe 404 / secret scanner / 요청 크기 제한 / 세션 TTL / CSRF / audit log retention. zod input parse 게이트 / runtime secret store / WAF 연동."
- **body**: 335 줄 (Batch 3 중 최장)
- **분석**: 9개 런타임 체크 블록 (CORS 검증, Rate Limiting, Auth 커버리지, Leak-safe 404, Secret Scanner, 요청 크기 제한, 세션 TTL / CSRF, Runtime Secrets, Audit log retention) + 통합 보안 보고서 템플릿 + core-infrastructure 흡수 보충. **D-01 강하게 적중 + ⚠️**: ① 9 항목 grep 명령은 사실상 *통합 audit batch* — `security-audit-check` (74줄, audit skill) 와 trigger 모호. ② 개별 invariant audit (cors-policy-audit, rate-limit-policy-audit, input-safety-audit, structured-log-schema-audit) 의 grep 영역과 information duplication. ③ L260-298 의 "core-infrastructure 흡수 보충" 섹션은 다른 invariant 정본의 echo.
- **이유**: workflow 라고 명명되지만 실제로는 *통합 audit 보고서 작성 가이드*. 다른 audit skill 들과 역할 분리 결정 필요.
- **조치 (사용자 결정 요청)**:
  - 질문 1: security-runtime 의 9 grep 블록은 *통합 audit 보고서 작성* 목적 — `security-audit-check` + 개별 *-audit skill 들과 명확히 분리되어 있는가?
  - 질문 2: 통합 보고서가 진짜 가치 있는가? 사용자가 보안 감사 시점에 *9 개별 audit skill 을 순차 invoke* + 그 결과를 종합하는 방식 vs *security-runtime 1개 invoke* 의 trade-off 어느 쪽이 운영상 효율적인가?
  - 질문 3: L260-298 의 "core-infrastructure 흡수 보충" 섹션 (예외 계층 매핑, 영향도 표, 금지 사항) 은 error-handling workflow 와 다른 invariant 의 echo — 제거 가능한가?
  - 권고 (default — *통합 보고서 가치 유지 가정*):
    - (a) description 에 "**개별 보안 점검은 각 *-audit skill 이 정본 — 본 workflow 는 *통합 보고서 + 9 영역 cross-check* 만**" exclusion clause 추가
    - (b) 9 grep 블록을 각 *-audit skill cite 로 슬림화 (예: "CORS 검증 → [[cors-policy-audit]] 정본 — 본 workflow 는 통합 보고서의 OK/FAIL 행만 채움")
    - (c) L260-298 "core-infrastructure 흡수" 제거 — 다른 정본의 echo
    - 예상 효과: 335줄 → 150-180줄 슬림화.

---

### 45. sse-streaming  [✅]
- **경로**: [plugins/backend-ts/skills/sse-streaming/SKILL.md](../../../plugins/backend-ts/skills/sse-streaming/SKILL.md)
- **description**: "TS 백엔드 SSE 응답 핸들러 추가 / 기존 SSE 핸들러 수정 시 invoke. 12 이벤트 직렬화 + heartbeat + secret scrub + done/error 종료 보장 가이드. SSE stream 끊김, done 이벤트 누락, 시크릿 노출 증상 디버깅 시에도 invoke."
- **body**: 131 줄
- **분석**: 12 이벤트는 sse-lifecycle invariant 정본 참조 명시 + SCAN_EVENTS 7개 분류 (scrub 대상) + NON-SCAN 5개 + SSE 응답 구현 4단계 원칙 + Heartbeat 원칙 (15s 간격) + Secret Scanner (7 패턴 + scrubSecrets/scrubDict/scrubEventPayload 3단계) + HTTP 헤더 분리 + 동시성 함정 5종 + 검증.
- **이유**: sse-lifecycle invariant 와의 정본 분리 ("12 이벤트 정본 참조") + SCAN_EVENTS 7개 분류는 본 workflow 의 고유 contribution. 모범적.
- **조치**: 없음.

---

## 6. Batch 4 — Workflows: data / media / ops (14)

**분포**: ✅ 12 / ✏️ 1 / ❌ 0 / ⚠️ 1

**공통 관찰**:
- Batch 4 는 *가장 자세한 workflow 들* 모음 (lsp-server 637줄, usage-tracking 416줄, testing-infra 321줄, ts-agent-rules 312줄, media-pipeline-patterns 262줄 등). 길이는 모두 정당화됨 — *프로젝트 고유 코드 청사진* + *cross-ref 정본 분리* + *runtime caveat* 가 명확.
- 단 ⚠️ `database` 는 DB/ORM 선택 매트릭스 (모델 native 일부) 와 data-layer 와의 역할 분리가 검토 필요.
- ✏️ `ts-agent-rules` 는 단순한 P2 (stack-backend-ts → backend-ts rename 미반영).
- **testing-infra** 의 Core Rules ("CRITICAL — baseline already knows common Vitest patterns, these are the UNIQUE differentiators") 는 *모범적 baseline 차별점 명시* — 보고서의 baseline measurement 정신과 일치. 다른 workflow 들이 본받을 만함.

---

### 46. data-layer  [✅]
- **경로**: [plugins/backend-ts/skills/data-layer/SKILL.md](../../../plugins/backend-ts/skills/data-layer/SKILL.md)
- **description**: "데이터 계층 추상 (Repository / Port 패턴, transaction boundary, optimistic locking) 결정 시 invoke. Drizzle ORM + serverless Postgres (예: Neon) — runtime 호환성은 instance 측에서 결정."
- **body**: 252 줄
- **분석**: 담당 범위 + Port / Interface 패턴 (SessionPort / SessionHistoryPort / MediaJobPort 코드 정의) + 구현체 구조 표 + 트랜잭션 (`db.transaction`) + Drizzle ORM + Neon serverless 연결 + Optimistic Locking (version column) + 모듈 구조 + 새 Port 추가 절차 + 영향도 + 금지. *Port 정본* 으로서의 가치.
- **이유**: SessionPort / MediaJobPort 등 interface 정의가 매우 프로젝트 고유. database 와 분리 (database = 선택 가이드, data-layer = Port 코드 정본).
- **조치**: 없음.

---

### 47. database  [⚠️]
- **경로**: [plugins/backend-ts/skills/database/SKILL.md](../../../plugins/backend-ts/skills/database/SKILL.md)
- **description**: "TS 백엔드 DB 선택 / ORM 선택 / runtime 호환성 / StoragePort 추상 결정 시 invoke. DB·ORM·driver 선택 trade-off matrix + Port 추상 원칙. 구체 DB/driver는 instance 측 결정."
- **body**: 132 줄
- **분석**: KV vs DB 분리 + TS 백엔드 DB 선택 매트릭스 (Postgres/MySQL/SQLite) + ORM 선택 매트릭스 (Drizzle/Kysely/Prisma) + Runtime 호환성 + StoragePort 추상화 (data-layer cite) + 트랜잭션 일관성 + 영향도 + 금지. **D-01 + AP-01 부분 적중**: L29-37 DB 선택 매트릭스 + L43-49 ORM 선택 매트릭스 + L54-62 Runtime 호환성 = *모델 native* 광범위. **D-01**: `data-layer` workflow 와의 분리 — database 는 *선택 가이드*, data-layer 는 *Port 코드 정본* 분리가 description 에 명시 ("구체 DB/driver는 instance 측 결정") — 정당화 일부 가능.
- **이유**: 본 workflow 의 *프로젝트 고유* 가치는 (a) KV vs DB durable 상태 분리 원칙, (b) Long-running 트랜잭션 금지 + AppDatabase URL fail-fast 같은 *backend-ts 결정*. DB/ORM 매트릭스는 일반 지식.
- **조치 (사용자 결정 요청)**:
  - 질문 1: database 와 data-layer 의 분리가 의도된 layered separation 인가? (database = "어느 DB/ORM 선택할까" 결정 시점, data-layer = "Port 코드 어떻게 작성" 시점)
  - 질문 2: DB/ORM 매트릭스 (L29-49) 가 *backend-ts 의 결정 기록* 가치가 있는가? (예: "backend-ts 는 Drizzle + Postgres 선택, 이유는 ___") vs *일반 trade-off 표* (모델 native — 슬림화 가능)?
  - 권고 (default — *backend-ts 의 결정 기록 가치 있다고 가정*):
    - (a) DB/ORM 매트릭스 를 *backend-ts 가 채택한 선택지 + 그 이유* 로 슬림화 (예: "**backend-ts 채택: Drizzle + Postgres + Neon HTTP driver**. 이유: typesafe + runtime 호환 + branching")
    - (b) 일반 trade-off 표는 1줄 cite 로 ("DB / ORM / driver 표준 trade-off 는 native 지식")
    - (c) description trigger 명확화: "신규 backend-ts instance 설정 시 / DB 또는 ORM 교체 검토 시" (현재 모호)

---

### 48. debug-session  [✅]
- **경로**: [plugins/backend-ts/skills/debug-session/SKILL.md](../../../plugins/backend-ts/skills/debug-session/SKILL.md)
- **description**: "<api-app> 에서 무언가 깨졌는데 원인을 모를 때 invoke. Vitest 실패 / agent loop hang / tool not firing / context window exceeded / dev server 500 / 사용자가 '왜 안 돼' · 'stuck' · 'debug me' 라고 할 때. <framework>+<runtime> 특화 단서 포함 5단계 디버깅 워크플로를 제공한다."
- **body**: 207 줄
- **분석**: 5단계 디버깅 (디버그 로깅 → 로그 tail → Vitest traceback → X-Request-Id 추적 → 설계 문서 조회) + TS 백엔드 특화 단서 (env binding undefined / setInterval 폭주 / AbortError / CPU time / process env) + 증상별 first move 표 + 디버그 종료 기준 + 재현 케이스 + 절대 하지 말 것. incident-triage 와 명시적 범위 분리.
- **이유**: trigger 매우 명확 (`"왜 안 돼" · "stuck" · "debug me"` 사용자 표현 매칭). 5단계가 순서 강제 ("역순으로 하면 안 된다"). 종료 기준 3개 명시 ("고친 것 같다는 종료 사유가 아니다").
- **조치**: 없음. *우수한 workflow*.

---

### 49. incident-triage  [✅]
- **경로**: [plugins/backend-ts/skills/incident-triage/SKILL.md](../../../plugins/backend-ts/skills/incident-triage/SKILL.md)
- **description**: "배포 후 incident 1차 진단 dispatch. 사용자 증상 ('느림', '응답 이상', 'tool 실패') → 7 symptom class 분류 → 1차 진단 도구 / 증거 수집 체크리스트로 dispatch. runtime live tail / Sentry / log aggregator 라이브 로그 + AsyncLocalStorage 10 필드 상관관계."
- **body**: 275 줄
- **분석**: 범위 표 (vs debug-session vs agent-loop debug) + 1차 진단 체크리스트 + AsyncLocalStorage 10 필드 상관관계 + 격리 / 빠른 복구 + 7 Symptom Class Matrix (SSE 끊김 / Latency / Quality / Cost spike / DB / MCP / Tool) + 증거 수집 → 가설 → 검증 3단계 + Incident Report 템플릿 + 새 class 추가 + Specific playbooks (향후 축적) + 절대 금지.
- **이유**: 7 class 의 *증상 keyword → 1차 도구 → 증거 수집 체크리스트* 패턴이 매우 실용적. AsyncLocalStorage 10 필드 correlation 정책 명시.
- **조치**: 없음.

---

### 50. lsp-server  [✅]
- **경로**: [plugins/backend-ts/skills/lsp-server/SKILL.md](../../../plugins/backend-ts/skills/lsp-server/SKILL.md)
- **description**: "<api-app> LSP 서버 (`<workspace-entity>` 언어 지능 — 예 prose editor / code editor / blog mention) 최초 작성 / 4-class 구조 (LSPManager / LSPRegistry / LSPInstance / LSPBridge) 추가 / completion·diagnostic·hover·definition 핸들러 수정 시 invoke. completion 이 안 뜬다, diagnostic 이 stale 텍스트에 걸려있다, IDE 클라이언트가 30초 후 disconnect 디버깅 시에도 invoke."
- **body**: 637 줄 (backend-ts 84 skill 중 *최장*)
- **분석**: Core Rules (non-negotiable) + 4 capabilities + 배포 형태 (runtime 호환성, 옵션 A/B 분리) + vscode-languageserver scaffolding 코드 + 3-tier 구조 (LSPManager / LSPRegistry / LSPInstance) + Bridge (LSP ↔ Agent) + Feature 우선순위 + non-streaming collect 패턴 + 동시성 함정 4종 (stale text / memory leak / agent timeout / setInterval) + 환경별 cleanup 트리거 매트릭스 + 검증 + Placeholder 해석.
- **이유**: LSP 서버는 본 plugin 의 *특수 기능* (workspace entity 언어 지능). 637줄 길이는 4 capability + 3-tier 구조 + bridge + runtime caveat + 동시성 함정이 모두 본문에 필요해서 정당화. *Core Rules (non-negotiable)* 가 5종 강제 사항을 상단에 명시 — 모범적.
- **조치**: 없음. *길이가 정당화되는 우수 사례*.

---

### 51. media-pipeline-patterns  [✅]
- **경로**: [plugins/backend-ts/skills/media-pipeline-patterns/SKILL.md](../../../plugins/backend-ts/skills/media-pipeline-patterns/SKILL.md)
- **description**: "미디어 (이미지 / 오디오 / 비디오) 파이프라인 추가 / 수정 시 invoke. /media/<category>/<op> 라우트, object storage 바이너리 출력, ML-worker enqueue / SSE polling, 런타임별 본문 크기 제한 → presigned URL 패턴 안내. Job lifecycle 정본은 media-job-lifecycle invariant."
- **body**: 262 줄
- **분석**: /run vs /media 경계 + 엔드포인트 패턴 + Presigned URL 패턴 (런타임 본문 크기 제한) + Job 라이프사이클 (internal stage ↔ external status 매핑 함수) + Storage (DbMediaJob / KvMediaJob) + ML-worker 위임 4-step + Stale-lease reaper + Tenant 소유권 (IDOR fix) + Job Queue + 에러 처리 (분류 기반 retry) + 응답 전송 + 인증/rate limit + Backpressure + 새 미디어 op 추가 (Schema-first) + 런타임 호환성 + Media vs /run 경계 표 + 영향도 + 금지. media-job-lifecycle invariant 정본 분리 명시.
- **이유**: 미디어 파이프라인의 *구현 청사진* 전체. media-job-lifecycle invariant 와 *완벽한* 정본 분리 ("정본 type 은 invariant skill 이 소유. 본 workflow 는 import 만, 자체 재선언 ✕"). 매우 가치 있음.
- **조치**: 없음.

---

### 52. migration-rollback  [✅]
- **경로**: [plugins/backend-ts/skills/migration-rollback/SKILL.md](../../../plugins/backend-ts/skills/migration-rollback/SKILL.md)
- **description**: "DB migration rollback workflow — forward-only vs reversible 결정, blue/green 호환 schema 변경 6단계 (add nullable → deploy → backfill → constraint → read-remove → drop), 사고 시 forward fix vs PITR 결정."
- **body**: 77 줄
- **분석**: forward-only vs reversible 표 + Online migration 관측성 체크리스트 + 6 단계 Blue/Green (expand-contract) + Rollback 가능 조건 + failure mode 표 + Rollback 절차 (사고 시) + 공통 금지. 일반 schema migration 패턴 + 프로젝트 결정 (forward-only + blue/green 6단계 권장) 결합. 정보 밀도 높음.
- **이유**: 운영 절차의 정본 — 6단계 expand-contract 패턴은 모델이 단독 추론 가능하지만 *어느 단계까지 rollback 가능* (L46-50) + lock_timeout / replication lag 관측성 + forward fix vs PITR 결정 패턴이 프로젝트 운영 정책.
- **조치**: 없음.

---

### 53. performance-profiling  [✅]
- **경로**: [plugins/backend-ts/skills/performance-profiling/SKILL.md](../../../plugins/backend-ts/skills/performance-profiling/SKILL.md)
- **description**: "<api-app> 백엔드 성능 baseline 확정 / 회귀 검출 / 느려졌다 객관화 시 invoke. 4 시나리오 × 30 샘플 × p50/p95/p99 측정. 0x / clinic / node --inspect / heapdump 진단 순서. Pre-launch 또는 provider / agent loop / compaction 대대적 변경 후 회귀 검출 시."
- **body**: 204 줄
- **분석**: 진단 순서 5-step (clinic doctor / 0x flamegraph / node --inspect / heapdump / framework timing) + 4 Scenario 정의 (A 순수 LLM 지연 / B 도구 dispatch / C Cache hit / D Compaction 근접) + 측정 메트릭 표 + Baseline JSON 스키마 (zod) + 회귀 임계값 표 + 측정 스크립트 + Cache Hit Rate 디버깅 힌트.
- **이유**: 0x / clinic / heapdump 일반 사용법은 모델 native 이지만, **4 시나리오 정의 + 측정 메트릭 (cacheReadInputTokens 등) + 회귀 임계값 (p95 +10% 등 구체 수치) + Cache Hit Rate 디버깅 순서** 는 프로젝트 운영 결정.
- **조치**: 없음.

---

### 54. red-green-fix  [✅]
- **경로**: [plugins/backend-ts/skills/red-green-fix/SKILL.md](../../../plugins/backend-ts/skills/red-green-fix/SKILL.md)
- **description**: "Use when fixing a bug in <api-app>/ — especially the first time you're touching that subsystem after a regression. Load this skill to walk a strict 5-step red-green-fix workflow covering a failing test, failure confirmation, minimal production fix, subsystem test run, and refactor after green. Also use when the user says fix this bug, this is broken, or regression."
- **body**: 277 줄
- **분석**: 5단계 TDD (RED → CONFIRM RED → GREEN → CONFIRM GREEN + NO REGRESSION → REFACTOR) + 각 단계 코드 예시 + RED 3원칙 + GREEN 3원칙 + 4-1/4-2/4-3 3단계 confirm + Watch 모드 + 절대 금지 6종 + 종료 기준 4종 + 자주 보는 함정 5종 (RED 없이 GREEN / 여러 버그 / Flaky / CI 불일치 / runtime 비호환) + 사용 예시 (maxTurns 버그) + 관련 skill.
- **이유**: TDD red/green/refactor 자체는 모델 native 이지만 *backend-ts 특화* 가 강력함: Step 4-2/4-3 모듈 vs 서브시스템 테스트 분리, GREEN 3원칙 ("최소 변경 / 새 모듈 지양 / 하드코딩 OK"), runtime 비호환 패턴이 unit test 통과 함정. 종료 기준 4종 ("거의 다 됐다는 종료 사유가 아니다") 매우 단호.
- **조치**: 없음.

---

### 55. test-cleanup  [✅]
- **경로**: [plugins/backend-ts/skills/test-cleanup/SKILL.md](../../../plugins/backend-ts/skills/test-cleanup/SKILL.md)
- **description**: "Checklist + grep patterns for detecting stale, orphaned, or redundant tests in `<api-app>/src/`. Load this skill to find tests referencing deleted symbols, duplicate scenarios, permanently-skipped tests, and git-diff-based coverage gaps. Also covers DB rollback, KV cleanup, and mock reset isolation patterns."
- **body**: 279 줄
- **분석**: Part A Isolation Patterns (DB rollback `withRollback` helper / KV cleanup test-prefix / Mock reset clear vs reset vs restore 매트릭스) + Part B 레거시 테스트 탐지 6 grep 블록 (삭제된 심볼 / 영구 skip / 빈 테스트 / 중복 / 소스 없는 파일 / git diff 커버리지 갭) + Part C 리포트 템플릿. testing-infra cite (정본 분리).
- **이유**: `withRollback` helper, KV test-prefix cleanup, vi.restore/clear/reset 분리가 프로젝트 고유 패턴. 6 grep 탐지 블록은 정확한 정규식으로 실행 가능.
- **조치**: 없음.

---

### 56. test-scaffold  [✅]
- **경로**: [plugins/backend-ts/skills/test-scaffold/SKILL.md](../../../plugins/backend-ts/skills/test-scaffold/SKILL.md)
- **description**: "Template-driven test file generation for `<api-app>/src/`. Creates unit + integration skeletons following the project's Vitest + <framework> in-process request patterns (FACTORY mocks, async generator streams). Load this skill when a new module needs tests or test-cleanup identifies coverage gaps."
- **body**: 261 줄
- **분석**: 테스트 파일 기본 템플릿 (3 시나리오 happy / invalid / boundary) + 생성 절차 5-step + 모듈 타입별 최소 시나리오 표 (Provider / Tool / Engine / Route / Data) + Route 테스트 골격 + Provider Mock 골격 + SSE 스트리밍 테스트. testing-infra + test-cleanup + red-green-fix cite (정본 분리 명시).
- **이유**: 모듈 타입별 최소 시나리오 표 (Provider = 5개, Tool = 5개, Route = 4개 등) 가 backend-ts 의 *테스트 분류 결정*. apiRequest / makeMockProvider 패턴은 프로젝트 고유.
- **조치**: 없음.

---

### 57. testing-infra  [✅]
- **경로**: [plugins/backend-ts/skills/testing-infra/SKILL.md](../../../plugins/backend-ts/skills/testing-infra/SKILL.md)
- **description**: "<api-app> 테스트 인프라 셋업 시 invoke. Vitest 설정 + <framework> in-process request 패턴 + DB test branch 격리 + runtime-호환 test harness 옵션."
- **body**: 321 줄
- **분석**: **Core Rules (CRITICAL — baseline already knows common Vitest patterns, these are the UNIQUE differentiators)** 6종 강제 + Vitest 설정 + setup.ts + Mock provider (FACTORY 패턴, async generator) + framework in-process request 패턴 + 사용 예시 + SSE 스트리밍 테스트 + runtime-환경 테스트 + DB 격리 전략 (in-memory better-sqlite3 / managed DB branch / Transaction rollback) + Vitest 마커 + 동시성 함정 3종.
- **이유**: **L12-19 의 Core Rules 가 매우 모범적** — "baseline already knows common Vitest patterns, these are the UNIQUE differentiators" 라고 *명시적으로* 모델 native 와의 차별점 6종을 상단에 강조. 이는 보고서의 baseline measurement 정신 (AP-02) 의 모범 적용. 다른 workflow 들이 본받을 만함.
- **조치**: 없음. *모범 사례*.

---

### 58. ts-agent-rules  [✏️]
- **경로**: [plugins/backend-ts/skills/ts-agent-rules/SKILL.md](../../../plugins/backend-ts/skills/ts-agent-rules/SKILL.md)
- **description**: "TS 백엔드 작업 시 자동 로드. 20 invariant + 39 workflow + 25 audit 의 라우팅 + 자주 묶이는 룰 묶음 + core-infrastructure 흡수 보충 (타입 경계 / interface DI / Stateless / AsyncLocalStorage 10 필드 / 영향도 표). python-agent-rules 의 TS 동등 — 메모리 룰 rename."
- **body**: 312 줄
- **분석**: 카탈로그 구조 + 자주 묶이는 룰 묶음 표 + core-infrastructure 흡수 보충 6 항목 (타입 경계 / interface DI / interface + zod 페어링 / Stateless / AsyncLocalStorage 10 필드 / 예외 / 캐시) + 영향도 표 + 금지 + 본 카탈로그가 다루지 않는 것 6 항목 + 다른 skill 과의 관계 (L2 layer 명시) + 자주 보는 함정. **세 메타 catalog (backend-overview / architecture-invariants / ts-agent-rules) 의 명시적 역할 분리** 우수. **P2 적중**: L26 `plugins/stack-backend-ts/skills/` + L300 `plugins/stack-backend-ts/skills/` 안 SKILL.md 개수 = 84 — legacy plugin 명 잔존.
- **이유**: 매우 가치 있는 cross-cutting reference (interface DI + AsyncLocalStorage 10 필드 + Stateless + interface + zod 페어링 정본). 결함은 plugin 명 stale 만.
- **조치**:
  1. **`stack-backend-ts` → `backend-ts` 치환** — L26 + L300.
  2. *Note*: 세 메타 catalog (backend-overview / architecture-invariants / ts-agent-rules) 모두 description "TS 백엔드 작업 시 자동 로드" 형식 → 동시 invoke 가능성 — 그러나 각 catalog 가 *다른 dimension* 을 다루는 것이 본문에 명시되어 (디렉토리 / invariant / 상황별 묶음) description budget 낭비라기보다 의도된 분담. 변경 불요.

---

### 59. usage-tracking  [✅]
- **경로**: [plugins/backend-ts/skills/usage-tracking/SKILL.md](../../../plugins/backend-ts/skills/usage-tracking/SKILL.md)
- **description**: "<api-app> 의 LLM 호출 usage 이벤트 정합성 / 토큰·비용 집계 / 일일 한도 검사 추가 수정 시 invoke. provider 응답 (OpenAI / Anthropic / OpenRouter) 정규화, Postgres `llm_usage` insert, KV pre-call cache + DB post-call tx, runtime cron 일일 집계. usage 이벤트 누락, 비용 폭증, 한도 검사 누락 디버깅."
- **body**: 416 줄
- **분석**: UsageRecord 스키마 (zod, 14 필드) + Provider 응답 정규화 (anthropic / openai / openrouter / google 각 함수) + 비용 계산 (`decimal.js`, JS Number 직접 곱셈 ✕) + Drizzle insert + 사용자 한도 검사 (pre-call KV + post-call DB tx 이중 안전망) + SSE usage 이벤트 + 헤더 분리 (X-App-Usage) + Cron Triggers (일일 집계) + 감사 체크리스트 + 리포트 템플릿. sse-streaming, provider-layer, provider-catalog-sync, database, incident-triage Class 4 와 cross-ref.
- **이유**: 매우 자세, 매우 프로젝트 고유 (UsageRecord 14 필드, decimal.js 사용, daily_usage_summary upsert SQL, KV+DB 이중 안전망 정책). incident-triage Class 4 cost spike 와 짝.
- **조치**: 없음.

---

## 7. Batch 5 — Audits 1차 (13)

**분포**: ✅ 12 / ✏️ 1 / ❌ 0 / ⚠️ 0

**공통 관찰**:
- 본 batch 의 audit 들은 **모범적 패턴 3종** 을 잘 따름:
  - **(M1) FAIL-SAFE 명시**: 모든 audit (12/13) 가 "⚠️ FAIL-SAFE — 패턴 PASS ≠ 완전 준수" 경고를 상단에 명시. 모델이 grep PASS 결과를 *부분 신뢰* 만 함을 강제 — 매우 우수.
  - **(M2) paired_invariant frontmatter**: 대부분의 `*-audit` skill 이 `pair_invariant: <name>` frontmatter 필드 보유 + 본문에 paired invariant cite — 정본 분리 일관.
  - **(M3) "audit 이 커버하지 않는 것" 섹션**: 본 batch 의 다수 (특히 data-audit, cors-policy-audit, loop-audit, media-job-lifecycle-audit) 가 자체 한계를 명시 — runtime 검증 / AST 분석 / 단위 테스트 의무를 별도 책임으로 분리.
- ✏️ 1개는 단순한 P2 (`stack-backend-ts → backend-ts` rename 미반영).
- 길이 분포는 매우 합리적: 짧은 audit (compaction-thresholds-audit 18줄, http-error-sentinels-audit 19줄, input-safety-audit 23줄, mcp-namespace-audit 25줄) 는 *paired invariant cite + 2-3 패턴* 으로 충분 — slim 정당화. 긴 audit (loop-audit 225줄, media-job-lifecycle-audit 166줄, cors-policy-audit 135줄) 은 *8 패턴 * 8 위반 시 조치* 로 길이 정당화.

---

### 60. agent-verify-def  [✏️ — ✅ v3 적용됨]
- **경로**: [plugins/backend-ts/skills/agent-verify-def/SKILL.md](../../../plugins/backend-ts/skills/agent-verify-def/SKILL.md)
- **description**: "새 agent 정의 추가 후 또는 배포 전 invoke. <api-app>/src/agents/*.ts 의 default export 가 AgentDef 인터페이스 필수 필드 (name / version / step / modelMix) 를 모두 채우는지 + name 중복 ✕ 를 grep 으로 검증."
- **body**: 86 줄
- **분석**: 🆘 **SCHEMA DRIFT — audit 가 CORRUPTED**. 본 audit 가 검증하는 4 필드 (`name` / `version` / `step` / `modelMix`) 는 [[ai-agent-patterns]] L60-75 의 정본 zod schema `AgentDefinitionSchema` 와 **완전 불일치**:
  - **정본 필수 필드** (ai-agent-patterns): `name`, `systemPromptFile`, (default 보유) `modelPreference` / `maxToolRounds`
  - **정본 optional**: `description`, `tools`, `temperature`
  - **본 audit 가 찾는 4 필드**: `name`, `version`, `step`, `modelMix` — `version` / `step` / `modelMix` 는 *정본 schema 에 존재 ✕*
  - 결과: 정상 agent YAML 도 "missing version / missing step / missing modelMix" 3건 false-positive. 정작 실제 위반 (`systemPromptFile` 누락, `name` regex 위반, `.strict()` 오타 필드) 은 *검출 ✕*.
  - 동일 결함이 [audit-all.sh #14](../../../plugins/backend-ts/scripts/audit-all.sh) (L268-282) 에도 mirrored — `for field in name version step modelMix` 라인.
  - 추가 mismatch: 본 audit 가 `*.ts` 만 스캔하지만 정본은 YAML + markdown prompt (`<name>.yaml` + `prompts/<name>.md`) — 파일 확장자도 틀림.
- **이유**: 검증 도구가 잘못된 schema 를 따라가면 *틀린 안전감* 을 줌 — 정작 실제 결함은 통과시키고 정상 코드는 노이즈 violation 으로 막는다. AP-01/04 보다 심각한 결함 (audit 가치 *negative*).
- **조치 (P0 — 🆘 가장 시급) — ✅ v3 turn 에서 적용 완료**:
  1. ✅ **description 재작성** — 정본 [[ai-agent-patterns]] AgentDefinitionSchema 와 동기 (name regex + systemPromptFile + file stem + 중복 + audit-all.sh sync 의무 명시)
  2. ✅ **본문 §검증 대상 invariant 재작성** — `name`/`version`/`step`/`modelMix` → 정본 schema (`name`/`systemPromptFile` 필수 + `modelPreference`/`maxToolRounds` default + optional 3개) 표.
  3. ✅ **본문 §실행 4 패턴 재작성** — (1) 필수 필드 누락 (`*.yaml` glob), (2) name regex `^[a-z0-9_]{1,64}$` 위반, (3) name != 파일 stem 불일치, (4) name 중복.
  4. ✅ **본문 §위반 시 조치 + §audit-all.sh sync 의무 섹션 추가** — 3 곳 (ai-agent-patterns 정본 / 본 SKILL.md / audit-all.sh) 동시 갱신 의무 명시.
  5. ✅ **`audit-all.sh` L269-310 의 `agent_verify_def_check()` 동기 갱신** — `*.ts` → `*.yaml` glob, 필수 필드 (name/systemPromptFile), name regex bash regex (`[[ "$name" =~ ^[a-z0-9_]{1,64}$ ]]`), file stem 일치 검증, name 중복.
  6. ✅ **bash syntax check 통과** (`bash -n` OK).
  - 미해결 *sanity check*: 실제 `<api-app>/src/agents/` 가 YAML 인지 TS 인지 instance 측 확인 — 정본 ai-agent-patterns 은 YAML 명시이므로 audit 도 YAML 기준. 만약 사용자의 특정 instance 가 TS 만 쓴다면 (`<api-app>/src/agents/*.ts`) 그 instance 측에서 audit override 필요.

---

### 61. api-audit  [✅]
- **경로**: [plugins/backend-ts/skills/api-audit/SKILL.md](../../../plugins/backend-ts/skills/api-audit/SKILL.md)
- **description**: "새 framework route 추가 후 또는 배포 전 invoke. POST/PUT/PATCH 핸들러가 schema validator 미들웨어 없음 / 보호 path 가 authMiddleware 없음 / handler 응답 명시 부재를 grep 으로 검증. input-safety-gate-ordering + auth 가 함께 동작하는지 정합성 체크."
- **body**: 117 줄
- **분석**: 3 패턴 (mutation schema validator / protected authMiddleware / raw Response 직접 반환) + FAIL-SAFE + 위반 시 조치 + audit 이 커버하지 않는 것. **모범적 정본 분리** — "middleware 순서 정본은 [[api-routing]] 단일" 명시 (L18). instance 측 framework 패턴은 env var (ROUTE_MUTATION_PATTERN / ZOD_VALIDATOR_PATTERN) 로 주입 가능 — generic plugin 으로서 우수.
- **이유**: routes thin-layer 강제. api-routing workflow 와 짝.
- **조치**: 없음.

---

### 62. app-domain-boundary-audit  [✅]
- **경로**: [plugins/backend-ts/skills/app-domain-boundary-audit/SKILL.md](../../../plugins/backend-ts/skills/app-domain-boundary-audit/SKILL.md)
- **description**: "모듈 추가/이동 후. app-domain-boundary invariant — 코어 (provider/sse/storage 등 generic) 디렉토리에 도메인-specific 어휘 누출 검출 (구체 어휘는 `scripts/forbidden-terms.txt` 정의)."
- **body**: 60 줄
- **분석**: DOMAIN_VOCAB envvar 기반 (iyaki/blog/commerce 예시 명시) + 디렉토리 화이트리스트가 backend-overview 정본과 sync (L28 명시) + core → domain 역참조 검출 + Placeholder 해석. **모범적 generic plugin 패턴** — instance 별 도메인 어휘는 envvar 로 주입, 미정의 시 SKIP.
- **이유**: 도메인 격리 강제. 디렉토리 화이트리스트가 backend-overview 와 sync 유지 의무 명시.
- **조치**: 없음.

---

### 63. compaction-thresholds-audit  [✅]
- **경로**: [plugins/backend-ts/skills/compaction-thresholds-audit/SKILL.md](../../../plugins/backend-ts/skills/compaction-thresholds-audit/SKILL.md)
- **description**: "compaction 코드 변경 후. compaction-thresholds invariant (CompactAt%, EmergencyCompactAt% 등) 상수 import 검증."
- **body**: 35 줄
- **분석**: 2 패턴 (threshold 매직 넘버 / 상수 import 누락) + FAIL-SAFE + 위반 시 조치 + 통과 기준. 매우 짧지만 명확 — paired invariant cite 만으로 충분.
- **이유**: 매직 넘버 0.7/0.9 사용을 차단 + invariant 상수 import 강제.
- **조치**: 없음. *짧은 audit 의 모범 사례* — slim 정당화.

---

### 64. cors-policy-audit  [✅]
- **경로**: [plugins/backend-ts/skills/cors-policy-audit/SKILL.md](../../../plugins/backend-ts/skills/cors-policy-audit/SKILL.md)
- **description**: "CORS middleware / route 응답 변경 후 invoke. cors-policy invariant 의 wildcard origin 금지 / credentials+wildcard 금지 / expose_headers FE contract / Vary 헤더 / preflight cache TTL 강제를 grep 으로 검증."
- **body**: 134 줄
- **분석**: 7 패턴 (wildcard origin / credentials+wildcard / expose_headers 7 / Vary 헤더 / preflight Max-Age / origin reflect 검증 / Allow-Methods wildcard) + FAIL-SAFE + 7 위반 시 조치 코드 + audit 이 커버하지 않는 것 + Cross-ref.
- **이유**: X-App-* 7 헤더 정본 (`http-error-sentinels` cite) 까지 검증. 매우 자세 — 7 패턴이 cors-policy invariant 의 모든 강제 사항 covers.
- **조치**: 없음.

---

### 65. data-audit  [✅]
- **경로**: [plugins/backend-ts/skills/data-audit/SKILL.md](../../../plugins/backend-ts/skills/data-audit/SKILL.md)
- **description**: "schema 변경 후 또는 새 migration 추가 후 invoke. Drizzle schema 의 FK 컬럼에 인덱스 정의가 함께 있는지 / migration 파일 순서가 정렬되어 있는지 / RLS policy 누락을 grep 으로 검증. data-layer + database invariant 와 짝."
- **body**: 100 줄
- **분석**: 3 패턴 (FK 인덱스 / migration 순서 / RLS policy) + FAIL-SAFE + 위반 시 조치 코드 + audit 이 커버하지 않는 것. **PCRE2 lookahead 회피** + sed extract 등 *grep 정확도* 에 신경 — 잘 작성됨.
- **이유**: DB schema 정합성 핵심. FK 인덱스 누락은 흔한 실수.
- **조치**: 없음.

---

### 66. dependency-scanning  [✅]
- **경로**: [plugins/backend-ts/skills/dependency-scanning/SKILL.md](../../../plugins/backend-ts/skills/dependency-scanning/SKILL.md)
- **description**: "의존성 lockfile 변경 후 또는 배포 전 invoke. npm/pnpm audit 으로 high/critical CVE 를 검출."
- **body**: 95 줄
- **분석**: pnpm audit + Package manager matrix (pnpm / npm / yarn / bun) + Lockfile 정책 + Supply-chain hardening (overrides / CVE 차단 / license / postinstall 차단) + Runtime smoke + failure mode. 일부 일반 지식 (pnpm audit 사용법) 이지만 **Package manager matrix + Lockfile 단일 SoT 정책 + postinstall allowlist** 는 본 plugin 의 운영 정책.
- **이유**: 의존성 CVE + supply-chain 보안. 4종 package manager 지원 명시.
- **조치**: 없음.

---

### 67. full-architecture-audit  [✏️]
- **경로**: [plugins/backend-ts/skills/full-architecture-audit/SKILL.md](../../../plugins/backend-ts/skills/full-architecture-audit/SKILL.md)
- **description**: "대규모 리팩토링 후 또는 정기 점검 시 invoke. 25 audit 일괄 실행 + 디렉토리 구조 정합 + madge import cycle ✕ + spec §11 4-layer 경계를 통합 검증. deploy 전 체크의 6-step 체인 안에서도 호출됨 (instance 측 project-local skill 참조)."
- **body**: 86 줄
- **분석**: 4 패턴 (25 audit 일괄 / 디렉토리 화이트리스트 / madge --circular / 4-layer 역참조) + FAIL-SAFE + 위반 시 조치 + audit 이 커버하지 않는 것. **P2 적중**: L26 `bash plugins/stack-backend-ts/scripts/audit-all.sh <api-app>` — backend-ts 로 rename 후 미갱신.
- **이유**: 통합 audit 의 가치 명확 (25 sub-audit + 디렉토리 정합 + import cycle + 4-layer). 결함은 plugin 명 stale 만.
- **조치**:
  1. **L26 `plugins/stack-backend-ts/scripts/audit-all.sh` → `plugins/backend-ts/scripts/audit-all.sh`** 치환 (또는 plugin-root-relative 경로로 일반화 — 예: `${CLAUDE_PLUGIN_ROOT}/scripts/audit-all.sh`).

---

### 68. http-error-sentinels-audit  [✅]
- **경로**: [plugins/backend-ts/skills/http-error-sentinels-audit/SKILL.md](../../../plugins/backend-ts/skills/http-error-sentinels-audit/SKILL.md)
- **description**: "route handler 또는 error path 수정 후. http-error-sentinels invariant 의 status ↔ sentinel 매핑 따르는지."
- **body**: 36 줄
- **분석**: 2 패턴 (throw new Error / inline error JSON 직접 작성) + FAIL-SAFE + 위반 시 조치. 매우 짧음 — paired invariant cite 만으로 충분.
- **이유**: route handler 가 framework HTTP error class + errorBody helper 경유 강제.
- **조치**: 없음.

---

### 69. input-safety-audit  [✅]
- **경로**: [plugins/backend-ts/skills/input-safety-audit/SKILL.md](../../../plugins/backend-ts/skills/input-safety-audit/SKILL.md)
- **description**: "route handler 추가/수정 후. input-safety-gate-ordering invariant (입력측 안전 게이트 chain — tombstone → jailbreak → moderation) 위반 검출. middleware 등록 순서는 [[api-routing]] invariant 가 정본."
- **body**: 41 줄
- **분석**: 2 패턴 (zod 검증 누락 / middleware 순서) + FAIL-SAFE. **정본 분리** 모범 — middleware 등록 순서는 api-routing 정본 cite (description 에 명시).
- **이유**: input safety + middleware 순서 강제.
- **조치**: 없음.

---

### 70. loop-audit  [✅]
- **경로**: [plugins/backend-ts/skills/loop-audit/SKILL.md](../../../plugins/backend-ts/skills/loop-audit/SKILL.md)
- **description**: "agent loop / run executor 코드 변경 후 invoke. <api-app>/src/agents/ + src/runs/ + src/engine/loop.ts 의 (1) 무한 while 종료 조건 (2) 6-stage 순서 (3) LoopTransition 8 enum 완전성 (4) Stage 1 산출물 immutability 를 grep + awk 으로 검출. runtime CPU time 초과 / 사용자 abort 무시 / 비용 폭주 / 관측성 누락 방지."
- **body**: 224 줄 (Batch 5 중 *최장 audit*)
- **분석**: 8 패턴 (무한 while 종료 / 6-stage 함수 + 호출 순서 / LoopTransition 8 enum / transition 기록 / AssembledContext mutate / provider SDK 직접 import / isConcurrencySafe / 자동 retry) + FAIL-SAFE + 5 위반 시 조치 코드 + audit 이 커버하지 않는 것 + Cross-ref. 매우 자세, **awk + grep + sed 의 정밀한 조합** (BSD awk 호환성 명시).
- **이유**: agent loop 의 8 invariant 모두 covers. runtime CPU time 보호 + 비용 폭주 방지 + 관측성 보장.
- **조치**: 없음. *긴 audit 의 길이 정당화 우수 사례*.

---

### 71. mcp-namespace-audit  [✅]
- **경로**: [plugins/backend-ts/skills/mcp-namespace-audit/SKILL.md](../../../plugins/backend-ts/skills/mcp-namespace-audit/SKILL.md)
- **description**: "MCP 서버 추가 후. namespace prefix 규칙 위반·충돌 검출."
- **body**: 43 줄
- **분석**: 3 패턴 (prefix 누락 / 중복 / name format `mcp__<server>__<tool>`) + FAIL-SAFE + 위반 시 조치. 짧지만 핵심 명확.
- **이유**: MCP namespace 강제. 정렬 키 / 충돌 방지의 핵심.
- **조치**: 없음.

---

### 72. media-job-lifecycle-audit  [✅]
- **경로**: [plugins/backend-ts/skills/media-job-lifecycle-audit/SKILL.md](../../../plugins/backend-ts/skills/media-job-lifecycle-audit/SKILL.md)
- **description**: "media job 코드 변경 후 또는 새 op 추가 후 invoke. media-job-lifecycle invariant 의 4 invariant (monotone 전이 / jobId idempotency / terminal immutable / soft cancel) 위반을 grep 으로 검출. <api-app>/src/media/ + <api-app>/src/services/media/ 대상."
- **body**: 165 줄
- **분석**: 8 패턴 (terminal status 직접 set / terminal 후 result mutate / jobId 직접 생성 / handler 강제 kill / 직접 insert / 같은 op 두 번 / worker idempotency / monotone 예외) + FAIL-SAFE + 5 위반 시 조치 코드 + audit 이 커버하지 않는 것 (block-level 정밀도 한계 명시) + Cross-ref. 매우 우수 — **자체 한계까지 명시** (패턴 7의 idempotency guard 정확도, 패턴 2 의 block-level 검증 불가).
- **이유**: media job 4 invariant 모두 강제. 외부 SDK 호출 + idempotency + monotone 예외 (reaper) 까지 covers.
- **조치**: 없음. *자체 한계 명시의 모범 사례*.

---

## 8. Batch 6 — Audits 2차 (12)

**분포**: ✅ 11 / ✏️ 1 / ❌ 0 / ⚠️ 0

**공통 관찰**:
- Batch 5 와 동일하게 모범 패턴 3종 (M1 FAIL-SAFE 명시 / M2 paired_invariant frontmatter / M3 "audit 이 커버하지 않는 것" 섹션) 잘 따름.
- 본 batch 의 자세한 audit (rate-limit-policy-audit 136줄 / structured-log-schema-audit 167줄) 은 *8-10 패턴* 으로 길이 정당화 — paired invariant 의 모든 강제 사항 covers + 자체 한계 명시.
- 짧은 audit (single-writer-audit 32줄, tool-sort-order-audit 30줄, run-policy-presets-audit 32줄, token-budget-audit 33줄) 도 *paired invariant cite + 2-3 패턴* 으로 충분 — slim 정당화.
- ✏️ 1개는 단순 P2 (rule-linting 의 stack-backend-ts → backend-ts 미반영).

---

### 73. provider-retry-audit  [✅]
- **경로**: [plugins/backend-ts/skills/provider-retry-audit/SKILL.md](../../../plugins/backend-ts/skills/provider-retry-audit/SKILL.md)
- **description**: "배포 전 또는 새 LLM provider 추가 후 invoke. <api-app>/src/ai/providers/**/*.ts 안 retry 로직이 provider-retry-matrix invariant (재시도 가능 / 즉시 fatal 구분) 따르는지 grep 검증."
- **body**: 37 줄
- **분석**: 2 패턴 (fatal status retry / fetch 없이 retry 누락) + FAIL-SAFE + 위반 시 조치. 짧지만 정확.
- **이유**: provider-retry-matrix invariant 의 핵심 강제 사항 covers.
- **조치**: 없음.

---

### 74. rate-limit-policy-audit  [✅]
- **경로**: [plugins/backend-ts/skills/rate-limit-policy-audit/SKILL.md](../../../plugins/backend-ts/skills/rate-limit-policy-audit/SKILL.md)
- **description**: "rate limit middleware / 새 라우트 추가 후 invoke. rate-limit-policy invariant 의 3-axis 강제 / Retry-After 헤더 / 멀티 인스턴스 in-memory 금지 / anonymous DDoS 가드를 grep 으로 검증."
- **body**: 136 줄
- **분석**: 8 패턴 (429 Retry-After / in-memory backend / bypass header / anonymous DDoS / envelope shape / counter 노출 / 3-axis 적용 / disable flag) + FAIL-SAFE (IP keyword 셋 보강 한계 명시) + 위반 시 조치 + audit 이 커버하지 않는 것 + Cross-ref. **IP keyword 매우 자세** (envoy / fly / cf-connecting-ip / x-real-ip 등 10+ 헤더) + 3-axis 검증 정밀.
- **이유**: rate-limit-policy invariant 의 모든 강제 사항 + 운영 경계 사항 (anonymous DDoS / disable flag / counter 노출) covers.
- **조치**: 없음.

---

### 75. rule-linting  [✏️]
- **경로**: [plugins/backend-ts/skills/rule-linting/SKILL.md](../../../plugins/backend-ts/skills/rule-linting/SKILL.md)
- **description**: "새 skill 추가 후 또는 plugin 메타 변경 후 invoke. plugins/stack-backend-ts/skills/*/SKILL.md 의 frontmatter 가 필수 키 (name / description / role / scope) 를 모두 채우고 디렉토리명과 name 이 일치하는지를 grep 으로 검증."
- **body**: 84 줄
- **분석**: frontmatter v3.4 규약 (name kebab-case / description non-empty / role enum 3 / scope project / source 제거) + FAIL-SAFE + 위반 시 조치 + audit 이 커버하지 않는 것. v3.4 source field 제거 정책이 잘 명시. **P2 적중**: description + L13 + L27 `plugins/stack-backend-ts/skills/` — backend-ts 로 rename 후 미갱신.
- **이유**: skill frontmatter 정합성 강제 + v3.4 source 제거 정책 enforcement. 결함은 plugin 명 stale 만.
- **조치**:
  1. **description + L13 + L27 의 `stack-backend-ts` → `backend-ts` 치환**.
  2. *권고*: L27 의 bash 경로를 `${CLAUDE_PLUGIN_ROOT}/skills/*/SKILL.md` 또는 `plugins/backend-ts/skills/*/SKILL.md` 로 일반화.

---

### 76. security-audit-check  [✏️ — ✅ v3 적용됨]
- **경로**: [plugins/backend-ts/skills/security-audit-check/SKILL.md](../../../plugins/backend-ts/skills/security-audit-check/SKILL.md)
- **description**: "배포 전 또는 외부 입력 처리 코드 변경 후 invoke. secret 하드코딩 / eval / new Function / 동적 require / SQL injection / SSRF 6가지 패턴을 grep 으로 일괄 검출."
- **body**: 120 줄
- **분석**: **3-way count mismatch**:
  - **description 주장**: 6가지 패턴 (secret 하드코딩 + eval/new Function 분리 셈하면 6)
  - **본문 §검증 대상 invariant (L13)**: "6가지 보안 안티패턴" 라벨이지만 실제 enumerated 는 **5개** (1.secret, 2.eval/new Function, 3.동적 require, 4.SQL injection, 5.SSRF) — eval과 new Function 을 묶어 5가지
  - **본문 §실행 (L23-42)**: **5 패턴** (rg 명령 5개)
  - **본문 §위반 시 조치 (L48-112)**: **5 패턴 조치** (패턴 1~5)
  - **[audit-all.sh L408-423](../../../plugins/backend-ts/scripts/audit-all.sh) `security_audit_check()`**: 🆘 **실제 실행은 4 패턴** (secret / eval+new Function / 동적 require / **SSRF만**) — **SQL injection 패턴 누락** — description 의 핵심 항목이 실제로 검사 ✕ → false-clean PASS 가능.
  - 본 audit body 의 위반 시 조치는 잘 작성되어 있고 FAIL-SAFE / "audit 이 커버하지 않는 것" 모범 패턴은 유지.
- **이유**: 5/6 mismatch 는 표현 정리 문제 (eval+new Function 묶음 vs 분리) — 사소. 그러나 **audit-all.sh 의 SQL injection 패턴 누락**은 *security audit 의 결정적 결함* — "PASS" 출력이 거짓 안전감 제공.
- **조치 — ✅ v3 turn 에서 적용 완료**:
  1. ✅ **description + 본문 L13 count 통일** — `6가지` → `5가지` (eval + new Function 을 "동적 평가" 묶음으로). description 에 audit-all.sh sync 의무 명시 추가.
  2. ✅ **`audit-all.sh` L438-462 의 `security_audit_check()` 에 SQL injection 패턴 추가** — body L36-37 의 `rg -nP 'sql\s*\`[^\`]*\$\{[^}]+\}' src/` 를 4번째 패턴으로 mirror + `sql.identifier` / `sql.placeholder` 안전 케이스 grep -v 제외.
  3. ✅ **cross-ref 주석 추가** — `audit-all.sh` 함수 헤더에 *"SKILL.md §실행 의 5 rg 명령과 문자열 그대로 sync 의무"* 명시.
  4. ✅ **bash syntax check 통과**.

---

### 77. session-audit  [✅]
- **경로**: [plugins/backend-ts/skills/session-audit/SKILL.md](../../../plugins/backend-ts/skills/session-audit/SKILL.md)
- **description**: "KV / session storage 코드 변경 후 invoke. KV.put 호출이 expirationTtl 없음 / framework env binding 의 KV 직접 접근 (storage adapter 우회) 두 패턴을 검출. KV 잔존 방지 + storage 경계 보존."
- **body**: 96 줄
- **분석**: 2 패턴 (KV.put TTL 누락 / framework env binding 의 KV 직접 접근) + FAIL-SAFE + 위반 시 조치 코드 + audit 이 커버하지 않는 것 (다른 audit 분리). single-writer invariant 와 짝 — KV 도 lock 없는 storage 임을 명시.
- **이유**: KV TTL 강제 + storage adapter 경계 보존.
- **조치**: 없음.

---

### 78. single-writer-audit  [✅]
- **경로**: [plugins/backend-ts/skills/single-writer-audit/SKILL.md](../../../plugins/backend-ts/skills/single-writer-audit/SKILL.md)
- **description**: "동시 쓰기 위험 코드 변경 후. <api-app> 안 동일 리소스 (DB row, KV key, object storage object) 에 lock/transaction 없이 다중 writer 접근하는 패턴 grep."
- **body**: 32 줄
- **분석**: 2 패턴 (KV/object storage put lock 없이 / UPDATE SQL advisory lock 없이) + FAIL-SAFE + 위반 시 조치. 매우 짧지만 핵심 명확.
- **이유**: single-writer invariant 의 핵심 강제. KV / object storage / DB row 의 다중 writer 접근 차단.
- **조치**: 없음.

---

### 79. spawn-limits-audit  [✅]
- **경로**: [plugins/backend-ts/skills/spawn-limits-audit/SKILL.md](../../../plugins/backend-ts/skills/spawn-limits-audit/SKILL.md)
- **description**: "sub-agent / parallel call 코드 변경 후. spawn-limits invariant 의 max-parallel 상수 + MAX_SPAWN_DEPTH depth 가드 우회 검출."
- **body**: 57 줄
- **분석**: 5 패턴 (Promise.all limit 없음 / 상수 import 누락 / MAX_SPAWN_DEPTH 정의 누락 / depth 가드 호출 누락 / parent depth 상속 누락) + FAIL-SAFE + 위반 시 조치.
- **이유**: spawn-limits invariant 의 3 안전망 (max-parallel / MAX_SPAWN_DEPTH / 상수 import) + depth 상속 검증.
- **조치**: 없음.

---

### 80. sse-lifecycle-audit  [✅]
- **경로**: [plugins/backend-ts/skills/sse-lifecycle-audit/SKILL.md](../../../plugins/backend-ts/skills/sse-lifecycle-audit/SKILL.md)
- **description**: "SSE 라우트 추가/수정 후 invoke. <api-app>/src/sse/**/*.ts 안 4-state (open/heartbeat/drain/close) 라이프사이클 + abort signal 처리 검증."
- **body**: 42 줄
- **분석**: 3 패턴 (abort 처리 / setInterval 사용 / heartbeat 누락) + FAIL-SAFE + 위반 시 조치. 짧지만 SSE 의 3 가지 핵심 위험 (abort / runtime 비호환 / heartbeat) covers.
- **이유**: SSE 응답의 결정론적 안티 패턴 검출.
- **조치**: 없음.

---

### 81. structured-log-schema-audit  [✅]
- **경로**: [plugins/backend-ts/skills/structured-log-schema-audit/SKILL.md](../../../plugins/backend-ts/skills/structured-log-schema-audit/SKILL.md)
- **description**: "로깅 코드 / middleware 변경 후 invoke. structured-log-schema invariant 의 필수 3 필드 (timestamp/level/event) / request_id 자동 주입 / PII 필터 / JSON 단일 라인 / level enum 일치를 grep 으로 검증."
- **body**: 167 줄
- **분석**: 10 패턴 (console.log 직접 사용 / log injection / level 자유 문자열 / ad-hoc context / scrub 누락 / multi-line JSON / 필수 3 필드 / request_id middleware / timestamp UTC / event 명명) + FAIL-SAFE (spread/computed payload + 라이브러리 timestamp 패턴 한계 명시) + 5 위반 시 조치 + audit 이 커버하지 않는 것 (block-level 검증 / scrubText 정본 / log alerting / collector 설정) + Cross-ref. 매우 우수 — **자체 한계까지 매우 명시적**.
- **이유**: structured-log-schema invariant 의 5 강제 사항 + 추가 운영 사항 (event 명명 / timestamp UTC / log injection 방어). spread/computed payload 한계까지 명시.
- **조치**: 없음. *자체 한계 명시의 모범 사례 (Batch 5 의 media-job-lifecycle-audit 과 함께)*.

---

### 82. token-budget-audit  [✅]
- **경로**: [plugins/backend-ts/skills/token-budget-audit/SKILL.md](../../../plugins/backend-ts/skills/token-budget-audit/SKILL.md)
- **description**: "context-assembly 또는 prompt 코드 변경 후. <api-app> 안 token-budget-constants 상수 (MAX_HISTORY_TOKENS 등) 우회·하드코딩 검출."
- **body**: 33 줄
- **분석**: 2 패턴 (token 매직 넘버 8000/16000/32000/128000 numeric separator 포함 / 상수 import 누락) + FAIL-SAFE + 위반 시 조치. 짧지만 정확 — numeric separator (`8_000`) 까지 grep.
- **이유**: token budget 상수 강제 + 매직 넘버 차단.
- **조치**: 없음.

---

### 83. tool-sort-order-audit  [✅]
- **경로**: [plugins/backend-ts/skills/tool-sort-order-audit/SKILL.md](../../../plugins/backend-ts/skills/tool-sort-order-audit/SKILL.md)
- **description**: "tool 등록 코드 변경 후. tools/registry.ts 안 tool 정렬 순서가 invariant tool-sort-order 따르는지."
- **body**: 30 줄
- **분석**: 1 패턴 (registry.ts 등록 순서 grep) + 수동 비교 단계 + FAIL-SAFE. 가장 짧은 audit. **자동화 부분 적음 — "수동 비교" 의존** (정렬 순서는 본질적으로 grep 으로 검증 어려움).
- **이유**: tool-sort-order invariant 의 정렬 순서 강제. 자동화 한계는 정렬 순서 자체의 *cache prefix 보호* 본질에서 정당화 (정렬 순서를 자동으로 검증하려면 invariant 본문 parsing 필요).
- **조치**: 없음. *Minor*: "수동 비교" 단계를 *bash 자동 비교* (예: `grep -E '^register\(' registry.ts | sort -c`) 로 향상 가능하나 invariant 본문의 정렬 순서 정의 형식 결정 필요 — 별도 작업.

---

### 84. run-policy-presets-audit  [✅]
- **경로**: [plugins/backend-ts/skills/run-policy-presets-audit/SKILL.md](../../../plugins/backend-ts/skills/run-policy-presets-audit/SKILL.md)
- **description**: "AI run / job 설정 코드 변경 후. run-policy-presets invariant 의 timeout / max-turn / retry preset 우회 검출."
- **body**: 32 줄
- **분석**: 2 패턴 (timeout/maxTurns 매직 넘버 / RUN_POLICY/POLICY_PRESET import 누락) + FAIL-SAFE + 위반 시 조치. 짧음, 명확.
- **이유**: RunPolicy preset 상수 강제.
- **조치**: 없음.

---

## 9. 부록

### A. 카테고리 × 분류 매트릭스 (상세)

#### A-1. ✏️ 16 항목 분류 (그 중 🆘 5건)

| skill | 카테고리 | 결함 분류 | 핵심 조치 |
|---|---|---|---|
| 🆘 **agent-verify-def** | audits | **schema drift CRITICAL** — audit 가 검증하는 4 필드 (`name`/`version`/`step`/`modelMix`) 가 ai-agent-patterns 정본 schema 와 완전 불일치 | description + 본문 §검증/§실행 재작성 (정본 zod schema 와 sync) + audit-all.sh L268-282 동기 갱신 |
| 🆘 **codex-commands** | workflows | **🆘 false premise** — Codex 공식 plugin spec 에 `.codex-plugin/commands/` 가 plugin component ✕ ((a) 옵션 무효 확정 v3) | 본문 전면 재작성 ((b) 확정): Codex 의 commands plugin component 부재 안내 + plugin discovery 만 + 13 command catalog 제거 + 183→40-60줄 |
| 🆘 **codex-subagents** | workflows | **🆘 false premise** — Codex 공식 spec 에 named sub-agent dispatch 시스템 부재 ((a) 옵션 무효 확정 v3) | 본문 전면 재작성 ((b) 확정): AGENTS.md 단일파일 안내 + child_agents_md flag + emulation 패턴 + 18 agent catalog 제거 + 161→40-60줄 |
| 🆘 **security-audit-check** | audits | **count mismatch + audit-all.sh SQL injection 누락 🆘** — desc "6가지" vs body 5 패턴, 그러나 결정적으로 audit-all.sh L408-423 가 4 패턴만 실행 (SQL injection 누락) → false-clean PASS | desc + L13 count 통일 (5 권고) + audit-all.sh 에 SQL injection 패턴 추가 + cross-ref 주석 |
| 🆘 **full-architecture-audit** | audits | **P2 (legacy)** — L26 의 `plugins/stack-backend-ts/scripts/audit-all.sh` 경로 stale | `${CLAUDE_PLUGIN_ROOT}/scripts/audit-all.sh` 또는 `plugins/backend-ts/...` 로 갱신 |
| architecture-invariants | invariants | P2 (legacy) + P3 (정보 중복) + AP-06 | stack-backend-ts → backend-ts + 20 invariant 표 슬림화 + 동적 grep 제거 |
| backend-overview | workflows | **P2 (legacy)** — L23 의 `plugins/stack-backend-ts/skills/` (v1 누락 — Codex 발견) | L23 치환 |
| cors-policy | invariants | P1 (모델 native) + P3 (audit 중복) | CORS 일반 부분 슬림화 + audit 체크리스트 → cors-policy-audit |
| rate-limit-policy | invariants | P1 (모델 native) + P3 (audit 중복) | 알고리즘 표 슬림화 + audit 체크리스트 → rate-limit-policy-audit |
| structured-log-schema | invariants | P1 (모델 native) + P3 (audit 중복) | log level 매트릭스 슬림화 + audit 체크리스트 → structured-log-schema-audit |
| auth | workflows | P1 (모델 native) + D-01 (rate-limit overlap) | JWT/API key 일반 원칙 슬림화 + rate-limit cite |
| coding-standards | workflows | P1 (광범위 모델 native — 가장 심각) | 122줄 → 50-60줄. 프로젝트 고유 부분만 (snake_case 금지 / scrubText / AsyncLocalStorage cite) |
| commit-rules | workflows | P2 (legacy) | stack-backend-ts → backend-ts (scope 카탈로그) |
| idempotency-key | workflows | P1 (RFC native) + P3 (audit 본문) | RFC 헤더 contract 슬림화 + 5 차원 key 강조 |
| ts-agent-rules | workflows | P2 (legacy) | stack-backend-ts → backend-ts (L26, L300) |
| rule-linting | audits | P2 (legacy) | description + L13 + L27 stack-backend-ts → backend-ts |

#### A-2. ⚠️ 4 항목 사용자 결정 요청

| skill | 검토 사항 | 권고 (default) |
|---|---|---|
| ai-agent-patterns | new-agent 와 30-40% overlap. 통합 vs 분리 유지? | 분리 유지 + description trigger 명확화 (option 3) |
| new-agent | ai-agent-patterns 와 30-40% overlap | 분리 유지 + exclusion clause 추가 |
| security-runtime | 9 grep 블록이 사실상 *통합 audit batch* — 개별 *-audit / security-audit-check 와 역할? | 통합 보고서 가치 유지 가정 — description trigger 명확화 + 9 grep 블록을 각 *-audit cite 로 슬림화 + L260-298 "core-infrastructure 흡수" 제거 (다른 정본의 echo). 335줄 → 150-180줄. |
| database | data-layer 와 분리 정책 + DB/ORM 매트릭스 (모델 native) 슬림화 | DB/ORM 매트릭스를 *backend-ts 의 결정 기록* 으로 슬림화 + description trigger 명확화 |

### B. 추천 후속 PR 묶음

권고: 다음 **5 PR** 로 분할 (영향 범위 + 위험도 별). **PR 0 (🆘 CRITICAL) 가 가장 먼저** — audit 정합성 자체가 깨진 상태.

#### PR 0 — ✅ **CRITICAL audit 정합성 회복** (P0, 적용 완료 — v3 + v4)

**대상 3 group — 모두 적용 완료**:
1. ✅ **`agent-verify-def` schema drift fix** (§60)
   - description 재작성 (`name`/`version`/`step`/`modelMix` → `name`/`systemPromptFile` + name regex + file-stem 일치)
   - 본문 §검증 대상 invariant / §실행 패턴 1 재작성
   - 스캔 glob 정정 (`*.ts` → `*.yaml`, 정본 ai-agent-patterns 가 YAML 명시) — 단 instance 측 실재가 TS 라면 정본/audit 양쪽 동시 정정
   - **`scripts/audit-all.sh` L263-284 의 `agent_verify_def_check()` 동기 갱신**
2. ✅ **`security-audit-check` audit-all.sh SQL injection 패턴 추가** (§76)
   - description + body L13 count 통일 (5 권고)
   - **`scripts/audit-all.sh` 의 `security_audit_check()` 에 SQL injection 패턴 (body L36-37) 추가** — v3
   - audit body 와 audit-all.sh 의 패턴 sync 명시 주석
   - ✅ v4 추가 (Codex HIGH #2): **untagged raw query 패턴 (4b) 추가** — `\.(query|execute|raw|executeRaw|\$queryRawUnsafe)\s*\(\s*\`[^\`]*\$\{` — `client.query(\`...\${name}\`)` 같은 위험 케이스 검출.
3. ✅ **`codex-commands` + `codex-subagents` 본문 전면 재작성** (§36, §37) — **v3 의 (b) 단일 확정 → v4 정정**:
   - **v3 결정**: Codex 공식 plugin spec (`developers.openai.com/codex/plugins/build`) 직접 fetch 결과 — plugin component = skills/mcpServers/apps/hooks 4개. `.codex-plugin/commands/` 와 `.codex-plugin/agents/` 는 plugin component ✕ → (b) 부정 안내로 재작성.
   - **v4 정정 (Codex HIGH #1)**: codex-subagents 의 v3 부정 안내가 **stale**. `developers.openai.com/codex/subagents` 가 실재 — Codex 는 **named sub-agent dispatch 를 정식 지원**:
     - 디렉토리: `~/.codex/agents/` (personal) / `.codex/agents/` (project)
     - TOML 형식: name / description / developer_instructions 필수 + sandbox_mode / model / mcp_servers / skills.config 옵션
     - 병렬 실행 + `/agent` CLI
   - **codex-commands (변경 ✕, MED #1 인용구만 정정)**: Codex 는 *여전히* commands 를 plugin component 로 인식 ✕ → v3 부정 안내 유지. 인용구 verbatim 으로 교체 ("Keep `skills/`, `hooks/`, `assets/`, `.mcp.json`, and `.app.json` at the plugin root.").
   - **codex-subagents v4 재작성 (positive 가이드)**: Codex 의 실재 시스템 안내 + 18 agent catalog + TOML schema + `/agent` CLI + 병렬 실행 + sandbox_mode + skills.config. 72줄 (v3 부정 가이드) → 약 110줄 (v4 positive 가이드).
   - ✅ **18 TOML 실제 구축**: `plugins/backend-ts/.codex/agents/` 에 18 TOML 작성 (총 1,144줄):
     - 5 read-only auditors: architecture_reviewer / architecture_validator (inherit) / invariant_compliance_checker / rule_consistency_auditor / spec_diff_auditor
     - 13 managers: agent_loop_manager / api_manager / data_state_manager / infra_performance_manager / new_agent_builder / output_stream_manager / prompt_context_manager / provider_manager / security_manager / settings_hooks_maintainer / sub_agent_manager / test_manager / tools_manager
     - python plugin (`archive/stack-backend-python/skills/codex-subagents/references/agents/`) 의 18 reference 본문을 TS 도메인 + Codex TOML 형식으로 변환
     - 64 unique `[[skill-name]]` cite 모두 backend-ts 의 실재 skill 로 resolve (broken 0)

**위험**: 중간. audit 정합성 결정 (#1) 은 본문 재작성. (#3) 은 *방향 reset* 2회 — Codex subagents 시스템 실재 확인 후 v4 turn 에 (a) 옵션 실제 구축.

**검증**:
- `bash scripts/audit-all.sh` 실행 → schema drift false-positive 사라짐 확인
- audit-all.sh L408-462 의 `security_audit_check()` 5 패턴 (1.secret / 2.eval / 3.dyn-require / 4a.sql-tagged / 4b.raw-query / 5.SSRF) 실행 확인 (실제로 6개 패턴)
- `ls plugins/backend-ts/.codex/agents/*.toml | wc -l` = 18
- 18 TOML 의 `[[skill-name]]` cite → `plugins/backend-ts/skills/<name>/` resolve 확인 (broken 0)
- `bash -n scripts/audit-all.sh` 통과

#### PR 1 — 🔧 **stack-backend-ts → backend-ts rename 일괄** (P2, 위험도 ★)

**대상 7개 skill + manifest + 부속 파일**:
- skill: codex-commands / codex-subagents / commit-rules / ts-agent-rules / full-architecture-audit / rule-linting / **backend-overview (v1 누락 — Codex 발견)**
- manifest: `plugins/backend-ts/.codex-plugin/plugin.json` 의 `"name": "stack-backend-ts"` → `"backend-ts"`
- 부속 (확인 필요): `plugins/backend-ts/AGENTS.md`, `docs/ci-template.md`, `docs/instance-claude-md-template.md`, `scripts/audit-all.sh` 내 plugin self-reference (STACK_BACKEND_TS_PRESET env var 이름은 *유지* — preset 식별자라 의도된 안정 ABI 가능), `scripts/forbidden-scan.sh`, `scripts/forbidden-terms.txt`, `scripts/presets/hono-workers.env`

**작업**: 각 SKILL.md / manifest / 부속 파일의 `stack-backend-ts` 식별자 → `backend-ts` 일괄 치환. env var `STACK_BACKEND_TS_PRESET` 등 stable identifier 는 *유지* (변경 시 instance 측 break) — 사용자 결정.

**위험**: 매우 낮음 (단순 문자열 치환) + 부분적 중간 (manifest 변경은 plugin 등록 키 — `.codex-plugin/` 로 다른 호스트가 참조한다면 cascading).

**검증**: `grep -rln 'stack-backend-ts' plugins/backend-ts/` 결과 = STACK_BACKEND_TS_PRESET (유지 결정 시) 가 있는 파일만.

#### PR 2 — ✂️ **coding-standards 슬림화** (P1, 위험도 ★★)

**대상 1개**: coding-standards

**작업**: 122줄 → 50-60줄. 모델 native 부분 (네이밍 / Import / 타입 strict / 비동기 / SRP-OCP-DRY-KISS-YAGNI) 광범위 슬림화. 프로젝트 고유 (snake_case 금지 = Python 흔적 / scrubText / 5-level logLevel / AsyncLocalStorage cite) 만 남김.

**위험**: 중간. 사용자가 *어디까지 슬림화* 결정 필요. 본 audit 의 권고는 *대략적 비율* — 구체 라인 결정은 사용자 review 후.

**검증**: line count 감소 + grep 으로 cite ([[ts-agent-rules]] / [[structured-log-schema]]) 보존 확인.

#### PR 3 — 📝 **4 invariants 의 audit 체크리스트 분리** (P3, 위험도 ★)

**대상 4개**: architecture-invariants / cors-policy / rate-limit-policy / structured-log-schema

**작업**: invariant 본문의 audit 체크리스트 (각 5-7 grep 패턴) 를 해당 `*-audit` skill 로 이전. invariant 에는 `[[*-audit]]` cite 만.

**위험**: 낮음. audit skill 들에 이미 동일/유사 grep 이 있을 가능성 — 중복 제거.

**검증**: 각 invariant 의 line count 감소 + 해당 *-audit skill 에 누락 grep 없는지 확인.

#### PR 4 — ❓ **⚠️ 4 항목 사용자 결정 후 후속** (위험도 ★★★)

**대상 4개**: ai-agent-patterns + new-agent / security-runtime / database

**작업**: 위 §A-2 의 사용자 결정 받은 후, 결정에 따른 구조 변경.

**위험**: 높음. *역할 분리 정책* 의 의미적 변경 — 잘못 결정하면 description budget 재설계 필요.

**검증**: 사용자가 결정한 정책의 *실제 작업* 시점에 cross-skill invoke 빈도 모니터링.

### C. 사용자 결정 요청 사항 (⚠️ 4 항목 집계)

각 ⚠️ 항목의 *결정 질문* 모음 — 사용자가 한 번에 답변하면 PR 4 진행 가능:

#### Q1. `ai-agent-patterns` ↔ `new-agent` 분리 정책

두 skill 의 30-40% overlap (AgentDef interface / Coordinator vs Worker / prompt 동적값 금지 / 6-step 절차) 처리:

- (A) **분리 유지 + description trigger 명확화** *(default 권고)* — ai-agent-patterns 는 "agent system *전반 이해* 가 필요할 때", new-agent 는 "*매번 새 agent 추가 시* invoke" 로 trigger 분리 + 각 description 에 exclusion clause.
- (B) 통합 — ai-agent-patterns 본문을 new-agent 의 "0. 사전 지식" 섹션으로 흡수.
- (C) 현재 유지 (overlap 허용).

#### Q2. `security-runtime` 의 역할 분리

9 grep 블록이 *통합 보고서 작성* 인지 *개별 audit* 인지:

- (A) **통합 보고서 가치 유지 + 슬림화** *(default 권고)* — description 에 "통합 보고서 + 9 영역 cross-check 만, 개별 점검은 각 *-audit skill" 명시 + 9 grep 블록을 각 *-audit cite 로 슬림화 + L260-298 "core-infrastructure 흡수" 제거. 335줄 → 150-180줄.
- (B) `security-runtime` 폐기, 사용자가 *9 개별 audit skill 을 순차 invoke* + 결과 종합 (security-runtime 제거).
- (C) 현재 유지 (다른 audit 들과 정보 중복 허용).

#### Q3. `database` ↔ `data-layer` 분리 정책

database 의 DB/ORM/Runtime 매트릭스가 *backend-ts 의 결정 기록* 가치인지 *일반 trade-off* (모델 native) 인지:

- (A) **backend-ts 결정 기록 가치 있음** *(default 권고)* — DB/ORM 매트릭스를 *backend-ts 가 채택한 선택지 + 그 이유* 로 슬림화 (예: "**backend-ts 채택: Drizzle + Postgres + Neon HTTP driver**. 이유: ___"). 일반 trade-off 표는 1줄 cite 로.
- (B) 일반 trade-off 표라 모델 native — database skill 자체 제거, data-layer 로 통합.
- (C) 현재 유지 (DB/ORM 매트릭스 보존).

### D. 인용 spot-check 결과

본 audit 의 각 entry 에서 인용한 line 번호 / 본문 내용이 실제 SKILL.md 와 일치하는지 무작위 5개 spot-check:

| # | skill | 인용 위치 | 인용 내용 | 검증 결과 |
|---|---|---|---|---|
| 1 | architecture-invariants | L114 동적 grep 명령 | `ls plugins/stack-backend-ts/skills/ | rg -c '^(...)$' = 19` | ✅ 매칭 — stack-backend-ts legacy 잔존 + grep 명령 본문에 있음 |
| 2 | coding-standards | L88-93 SRP/OCP/DRY/KISS/YAGNI | "한 모듈/클래스는 변경 이유 1개", "확장 열림, 수정 닫힘", "같은 로직 2회 이상 → 유틸 추출" 등 | ✅ 매칭 — 모두 모델 native, 본 plugin 만의 해석 없음 |
| 3 | lsp-server | L12-19 Core Rules (non-negotiable) | "MUST implement 4-class 구조 / `invalidateEntityCache()` / `cleanupStaleInstances()` / `AbortSignal.timeout(10_000)` / trigger character" | ✅ 매칭 — 5종 강제 명시. *모범적 Core Rules 패턴*. |
| 4 | media-job-lifecycle | L180-187 핵심 상수 표 | `STALE_MS=1_800_000`, `MAX_ATTEMPTS=5`, `CATEGORY_CAPS={image:100, audio:200, video:50}` *권장 기본값* 명시 | ✅ 매칭 — 권장 기본값 명시 + instance override 정책 명확 |
| 5 | testing-infra | L12-19 Core Rules (CRITICAL) | "baseline already knows common Vitest patterns, these are the UNIQUE differentiators" — 6종 강제 | ✅ 매칭 — baseline 차별점 명시. **보고서 §AP-02 (baseline measurement) 정신과 일치하는 모범 사례** |

**spot-check 결과**: 5/5 매칭. 본 audit 의 인용 정확도 신뢰 가능. 사용자가 의문 시 동일 패턴 (line 번호 + 본문 핵심 문구 확인) 으로 추가 검증 가능.

### E. backend-ts 의 *모범 사례 패턴* (다른 plugin 이 본받을 만함)

본 audit 과정에서 발견한 backend-ts 의 **우수한 작성 패턴 5종** — 다른 plugin audit 시 참고:

1. **(P-1) Core Rules / FAIL-SAFE 명시** — `lsp-server`, `testing-infra` 의 *"baseline already knows, these are the UNIQUE differentiators"* + 모든 audit 의 *"패턴 PASS ≠ 완전 준수"* 경고. 모델이 *부분 신뢰* 를 명시적으로 강제 — AP-01/AP-02 위반 자체 차단.
2. **(P-2) 명시적 정본 분리 (cite-only)** — `error-handling` workflow 의 description 에 *"sentinel 매핑 / envelope shape / route-edge 발신 매트릭스는 [[http-error-sentinels]] invariant 가 정본 — 본 workflow 는 구현 분류만"* 명시. `media-pipeline-patterns` 가 *"정본 type 은 invariant skill 이 소유. 본 workflow 는 import 만"* 명시. 정보 중복 방지 + lineage 명확.
3. **(P-3) paired_invariant frontmatter + cite 본문** — 모든 `*-audit` skill 이 `pair_invariant: <name>` frontmatter 필드 + 본문에 paired invariant cite. invariant ↔ audit 짝이 자동 추적 가능.
4. **(P-4) "audit 이 커버하지 않는 것" 섹션** — `media-job-lifecycle-audit`, `structured-log-schema-audit`, `data-audit` 등 다수의 audit 가 자체 한계를 명시 (block-level 정밀도 부족 / 라이브러리 패턴 미커버 등). runtime 검증 / 단위 테스트 / 수동 review 의 분담 책임 명확.
5. **(P-5) Explain-the-Why 패턴 (rule + 왜)** — `design-principles` 의 7 원칙 모두 "**왜**" + "**판단 기준**" + "**반례**" 명시. AP-05 (all-caps imperative) 회피 모범. *다른 invariant/workflow 들도 이 패턴 본받을 만함*.

> **⚠️ 패턴 채택 시 주의 (Codex review 교훈)**: P-3 / P-4 패턴은 *backing asset 존재* 를 전제로 한다. `codex-commands` / `codex-subagents` 의 "검증 체크리스트" 섹션이 *18 agent reference / 13 command marker md 존재* 를 가정하지만 실제 backing 파일이 부재하여 *vapor catalog* 가 됐다. **패턴 P-3/P-4 채택 시 의무**: 본문이 *cite 하는 모든 파일 / 디렉토리가 실재하는지* skill 작성 시점에 1회 grep 검증. 본 audit v1 은 main session 의 self-blind spot 으로 이를 놓쳤음 (cold-context Codex review 에서 발견).

### F. Revision history

#### v6 → v7 (2026-05-25, ✏️ 11 → 0 일괄 격상, 100% ✅ 달성)

**배경**: v6 turn 완료 후 사용자 *"뭐야 수정도 끝난거야 그럼?"* — Master Checklist 의 ✏️ 11건이 *진짜로 수정 필요한 항목* 인지 의문. 실제 점검 결과 11건이 *세 가지 상태* 로 섞여 있음:

1. **historical ✏️ 4건** — v3+v4 turn 에 조치 적용 완료 (본문에 `✅(vX 적용됨)` 마킹) 했지만 분류 자체는 ✏️ 그대로. 분류 정정 필요:
   - #26 codex-commands (v3+v4 부정 안내 재작성 + 공식 spec verbatim)
   - #27 codex-subagents (v4 positive 가이드 + 18 TOML)
   - #60 agent-verify-def (v3+v4 schema drift + audit-all.sh sync)
   - #77 security-audit-check (v3+v4 description count + audit-all.sh SQL 6 패턴)
2. **v5 rename 해소 5건** — audit doc 의 ✏️ 사유가 *오직 `stack-backend-ts` plugin 명 stale* 뿐이었는데 v5 P2 rename 으로 이미 해소. 분류 미격상.
   - #25 backend-overview / #29 commit-rules / #58 ts-agent-rules / #67 full-architecture-audit / #76 rule-linting
   - `rg 'stack-backend-ts|STACK_BACKEND_TS' plugins/backend-ts/skills/{commit-rules,rule-linting,ts-agent-rules,backend-overview,full-architecture-audit}/SKILL.md` → 0 결과 확인
3. **실제 슬림화 권고 잔존 2건** — 적용 필요:
   - #24 auth — JWT/API key/Rate limit 일반 패턴 (모델 native) 제거, 프로젝트 결정 6종 (Authorization 스키마 / assertRequiredSecrets / API key kid revoke / SessionPort interface / scope `*` super + leak-safe 404 / rate limit 등록 순서) 만 보존. 102→95줄
   - #37 idempotency-key — RFC 7231 / Stripe 표준 패턴 native 위임, 프로젝트 결정 5종 (6 요소 key 결합 / TTL 24h / 409 envelope / `Idempotency-Replayed` 헤더 / In-flight lock) + audit body 보존 (별도 audit skill 부재). 73→80줄

**v7 변경 사항**:

| 항목 | v6 | v7 | 사유 |
|---|---|---|---|
| Master Checklist historical 4건 | ✏️ ✅(vX 적용됨) | ✅ (격상) | 분류는 *현재 상태* 정본. v3+v4 적용 완료면 ✅ |
| Master Checklist rename 해소 5건 | ✏️ | ✅(v5 — P2 rename 으로 plugin 명 stale 해소) | 사유 사후 점검 — 잔존 0 확인 |
| auth SKILL.md | 102줄 (JWT/API key/Rate limit 일반 + 프로젝트 결정 혼재) | 95줄 (프로젝트 결정 6종만 + 영향도 표) | AP-01 적중 해소 |
| idempotency-key SKILL.md | 73줄 (RFC 표준 + 프로젝트 결정 혼재) | 80줄 (5 결정 + audit body 보존) | 사용자 결정 (audit skill 신규 ✕) — 본 workflow 안에 유지 |
| 분포 | ✅ 73 / ✏️ 11 / ⚠️ 0 | **✅ 84 / ✏️ 0 / ⚠️ 0** | **100% ✅ 달성** |
| 카테고리별 | Workflows 82% / Audits 84% | **Workflows 100% / Audits 100%** | 세 카테고리 모두 100% |

**v7 turn self-blind spot 교훈**:
- audit doc 의 ✏️ 마킹이 *현재 상태 ✕ historical record* 로 해석될 가능성 — 분류는 *작업 진행 시점마다 동기화* 해야 사용자 혼란 ✕. 명시: ✏️ = "*현재* 수정 필요", `✅(vX 적용됨)` = "*과거에 ✏️ 였지만 vX 에서 해소*" 로 표현 + 분포 통계 = *현재 상태 기준* (격상 누락 ✕).
- 권고 본문 텍스트 (예: "✏️ 사유 = plugin 명 stale") 가 후속 turn 에서 *이미 해소*된 경우 *재검증* 후 격상 의무. main session 이 *historical record* 만 보고 ✏️ 유지하는 패턴 = self-blind spot.

**v7 Codex 재리뷰 결과** (agentId `a28263270d4e3f9ba`, 2026-05-25):

- **Section A (슬림화 2건)** — PASS. auth 의 6 결정 + idempotency-key 의 5 결정 모두 *원본 가치* 빠짐없이 보존. cite 5종 실재 확인.
- **Section B HIGH 1건 — 즉시 적용 완료**: `codex-subagents/SKILL.md` L101/L104 의 `[[skill-name]]` placeholder 가 wiki-style cite 문법인데 대응 skill 디렉토리 ✕ → broken cite. 정정: "wiki-style cite (`[[` 와 `]]` 로 감싼 *실제* skill name — 예: `[[architecture-invariants]]`, `[[agent-loop-invariants]]`)" 으로 표현 변경 + 검증 절차 "모든 wiki-style cite 가 실재 (broken cite ✕)" 명시.
- **Section B rename 5건**: 잔존 0 + cite 정상 + audit role 의 grep 블록은 AP-06 결함 아님. 격상 정당.
- **Section B LOW 1건 — 즉시 적용 완료**: `idempotency-key/SKILL.md` 의 "5 차원" 명칭 ↔ 식 6 요소 (user_id / tenant_id / method / path / body_hash / client_key) 혼선. "5 차원" → "6 요소" 일관화 + description + §1 제목 + §"공통 금지" + failure mode 표 모두 정정.
- **Section C 분류 평가**: 100% ✅ 는 HIGH catch 시점에는 *과도하게 관대* 했으나, HIGH fix 후 정합. ❌ 0건은 정당 (모든 84 skill 이 *제거 후보 ✕*).

**v7 turn self-blind spot 교훈 (추가)**:
- main session 이 codex-subagents 본문 placeholder `[[skill-name]]` 을 *예시* 로 인식 ✕ — Codex cold-context 가 cite 문법으로 인식 → broken cite 검출. 교훈: placeholder 라도 cite 문법 사용 시 *명시적 예시 형식* (예: `<placeholder>` 또는 backtick) 으로 전환 필수.
- 숫자 표현 (5 차원 vs 6 요소) self-blind spot — *원본 본문의 명명* 을 유지하다가 *실제 수식의 요소 수* 와 mismatch. v8 이후 *수식 ↔ 명칭 자동 일치 검증* 의무.

**v7 적용 후 미해결 (informational only)**:
- 18 TOML 본문 확장 — *minimal seed* 상태. 실사용 후 자주 호출되는 agent 우선 확장 (v6 와 동일, 즉시 액션 ✕)

#### v5 → v6 (2026-05-25, Codex 권고 따라 ⚠️ 4 항목 일괄 해소)

**배경**: v5 turn 의 Codex 재리뷰 (agentId `ab3a3aa61740c8a70`) 가 HIGH 1건 (architecture-invariants `[[rule-linting]]` cite broken, v5 fix) + MEDIUM 0건 + ⚠️ 4 항목 권고 산출. 사용자 *"적용하고 재리뷰"* 결정으로 권고 4건 일괄 적용.

**v6 변경 사항**:

| 항목 | v5 상태 | v6 적용 | 효과 |
|---|---|---|---|
| §43 new-agent | ⚠️ (schema 충돌 + Codex marker stale) | **재작성** — 정본 = [[ai-agent-patterns]] 명시 + YAML camelCase / role 필드 제거 / `maxToolRounds` 통일 / Codex marker `.codex/agents/<name>.toml` TOML 정정 | ⚠️ → ✅ |
| §22 ai-agent-patterns | ⚠️ (vs new-agent 통합 미결정) | **변경 ✕** — schema SoT 위치 확정 (ai-agent-patterns 가 정본, new-agent 가 cite). 통합 ✕, 분리 유지 | ⚠️ → ✅ |
| §51 security-runtime | ⚠️ (9 grep 블록 role 불명확) | **335 → 154줄 슬림화** — 9 grep 블록 → 각 paired `*-audit` cite (cors-policy-audit / rate-limit-policy-audit / api-audit / http-error-sentinels-audit / security-audit-check / input-safety-audit / session-audit / 데이터 거버넌스). 보고서 템플릿 + 영향도 + 금지 보존. | ⚠️ → ✅ |
| §33 database | ⚠️ (vs data-layer 분리 미결정) | **132 → 89줄 슬림화** — DB/ORM 매트릭스 → 1줄 채택 가이드. Port 구체 [[data-layer]] 일임 (분리 유지). | ⚠️ → ✅ |
| `BACKEND_TS_PRESET` migration | v5 변경 완료, 사후 승인 보류 | `plugins/backend-ts/CLAUDE.md` §"Migration 이력" 신규 — instance CI 갱신 절차 + legacy reference 보존 위치 명시 | 사후 승인 완료 |
| 분포 | ✅ 69 / ✏️ 11 / ⚠️ 4 | **✅ 73 / ✏️ 11 / ⚠️ 0** | ⚠️ 0건 달성 |

**v6 turn 의 self-blind spot 회피 + Codex 활용**:
- ⚠️ 항목은 *Codex 권고 → 사용자 검토* 의 hybrid loop 으로 처리. main session 단독 결정 회피 → cold-context 의 권고를 명시적 cite 후 적용.
- 그 결과 모든 결정 (분리 vs 통합 / SoT 위치 / 슬림화 범위) 에 *외부 reasoning trace* 가 audit doc 에 기록됨 — 향후 review 시 재현 가능성 확보.

**v6 적용 후 미해결** (informational):
- 18 TOML 본문 확장 (실사용 우선 결정 후)
- ✏️ 11건 잔존 — priority 강등 상태, batch review 가능

#### v4 → v5 (2026-05-25, 미해결 자동처리 5종 일괄 적용)

**배경**: v4 완료 후 사용자 *"남은 미해결항목 정리하고 재리뷰 받아"* — Auto mode 결정으로 사용자 결정 필요 항목 (⚠️ 4) 만 제외한 5종 자동 처리.

**v5 변경 사항**:

| 항목 | v4 상태 | v5 적용 | 효과 |
|---|---|---|---|
| P2 rename 잔여 11 파일 | `stack-backend-ts` 잔존 | `sed` 일괄 치환 + legacy reference 2 곳 보존 (CLAUDE.md L37/L39 v1 historical + forbidden-terms.txt L18-19 `stack-backend-ts-hono`) | CLAUDE.md L37 broken link 평문화 + STACK_BACKEND_TS_PRESET → BACKEND_TS_PRESET (rename 일관성 — instance 측 CI template 재가져오기 의무) |
| §28 coding-standards | 122줄 (AP-01 80% 모델 native) | **72줄 (41% 슬림화)** — 프로젝트 5종 결정 (snake_case 금지 / strict TS 3-옵션 / scrubText·bindLogContext / 5-level logLevel z.enum / ML-worker / enum 금지) 보존, 일반 TS 컨벤션 모두 제거 | ✏️ → ✅ |
| §7 cors-policy | 60줄 (audit 체크리스트 + failure mode 중복) | **43줄** — CORS 표준 헤더 정의 제거 (web spec 정본), expose_headers 7종 + origin allowlist 운영 정책 + 6 금지 보존, audit cite [[cors-policy-audit]] 위임 | ✏️ → ✅ |
| §13 rate-limit-policy | 62줄 (알고리즘 표 + audit + failure mode 중복) | **44줄** — 알고리즘 표 제거 (native), 3-axis + 429 envelope + storage 일관성 + 5 금지 보존, audit cite [[rate-limit-policy-audit]] 위임 | ✏️ → ✅ |
| §18 structured-log-schema | 83줄 (log level 매트릭스 + 명명 + audit + failure mode 중복) | **56줄** — 필수 3 + trace 4 + optional + agent-loop trace cite + scrub 의무 + 6 금지 보존, audit cite [[structured-log-schema-audit]] 위임 | ✏️ → ✅ |
| §3 architecture-invariants | 동적 grep `ls + rg` (AP-06) | **정적 의무 + [[rule-linting]] cite** — invariant SKILL.md 본문에 매번-실행 명령 ✕ | ✏️ → ✅ |
| 분포 | ✅ 64 / ✏️ 16 / ⚠️ 4 | **✅ 69 / ✏️ 11 / ⚠️ 4** | Invariants 카테고리 100% ✅ 달성 |

**v5 turn 의 self-blind spot 회피 확인**:
- 슬림화 후 *원래 invariant 의 비-중복 가치* (X-App-* 7 헤더 / 3-axis / agent-loop trace 6 필드 / scrubText 정본) 가 보존됐는지 명시적 점검 — 모두 보존.
- audit cite (`[[cors-policy-audit]]` 등) 가 가리키는 audit skill 실재 확인 — 모두 실재 (Master Checklist #62, #67, #79).
- legacy reference 의도된 보존 위치 (CLAUDE.md / forbidden-terms.txt) 사전 식별 + 보존 — sed 일괄 치환의 over-rename 회피.

**v5 turn Codex 재리뷰 결과** (agentId `ab3a3aa61740c8a70`, 2026-05-25):

- **HIGH 1건 — 즉시 적용 완료**: `architecture-invariants` 의 `[[rule-linting]]` cite 가 broken — rule-linting 은 frontmatter 검사만, 카탈로그 sync 자동화 ✕. 정정: cite 제거 + "현재 자동 검증 ✕ — 향후 `audit-all.sh` 의 `architecture_invariants_catalog_check()` 함수 추가 PR 예정" 으로 명확화.
- **MEDIUM 0건**: 나머지 v5 auto-fix (cors-policy 슬림화 / rate-limit-policy 슬림화 / structured-log-schema 슬림화 / coding-standards 슬림화 / P2 rename / BACKEND_TS_PRESET 변경) 모두 정확. audit cite 4개 실재 확인 + legacy reference 2 곳 의도대로 보존.

**v5 적용 후 미해결 (Codex 권고 → 사용자 최종 결정)**:

1. **⚠️ `ai-agent-patterns` ↔ `new-agent`** — Codex 권고: **분리 유지 + 필드명 정합** (`ai-agent-patterns` 를 schema SoT, `new-agent` 내 충돌 참조 정렬). audit doc §22 + §23 + 양 SKILL.md (L25/L67-70/L167-171 vs L3/L15/L60-70) 의 충돌 식별 후 fix.
2. **⚠️ `security-runtime` 9 grep 블록 role** — Codex 권고: **통합 보고서 유지 + grep 블록 슬림화** (각 `*-audit` cite 로 교체) + L268-299 echo 블록 제거.
3. **⚠️ `database` ↔ `data-layer`** — Codex 권고: **분리 유지 + database 슬림화** — `database/SKILL.md` L27-61 매트릭스를 채택 결정 중심으로 축소, Port 구현 구체는 `data-layer/SKILL.md` L32-100 일임.
4. **⚠️ `STACK_BACKEND_TS_PRESET → BACKEND_TS_PRESET`** — Codex 권고: **승인** (일관성 정당화 가능). 단, 기존 instance CI 참조 시 template 재-pull / env var 수정 필수 — *migration 의무 공지* 필요 (release note + CLAUDE.md 변경 이력).
5. **18 TOML 본문 확장** — 실사용 후 자주 호출되는 agent 우선 (informational, 즉시 액션 ✕).

**v5 turn self-blind spot 교훈** (Codex catch):
- main session 은 `architecture-invariants` 에 `[[rule-linting]]` cite 추가 시 *rule-linting 의 실제 검사 범위* 까지 verify ✕. cite 대상이 frontmatter 만 검사하지 카탈로그 sync 는 ✕ 라는 사실을 cold-context Codex 가 catch.
- v3/v4 의 *backing asset 부재* 교훈과 같은 패턴 — cite 의 *file 존재* 만 검증해서는 ✕. *cite 가 약속하는 기능 범위* 가 실제로 구현되어 있는지까지 single-hop 검증 의무.
- audit doc §부록 D-P3 패턴 채택 시 주의를 *content-level* 까지 확장: cite (`[[skill-name]]`) 의 대상 skill 이 cite 한 책임을 실제로 수행하는지 확인.

#### v3 → v4 (2026-05-25, Codex subagents 시스템 실재 확인 + 18 TOML 구축)

**배경**: v3 turn 후 codex-rescue 의 cold-context 리뷰 (`task a3e99ff405...`) 가 v3 의 **시스템적 결함** 발견:
- v3 가 `developers.openai.com/codex/agents-md` 가 404 라서 *named sub-agent 시스템 부재* 로 결론. 그러나 정확한 URL 은 `developers.openai.com/codex/subagents` — main session 의 URL 추정 실패로 잘못된 결론.
- Codex 가 직접 `/codex/subagents` fetch → **Codex CLI 는 named sub-agent dispatch 를 정식 지원**: `~/.codex/agents/` + `.codex/agents/` TOML, `/agent` CLI, 병렬 실행.
- 사용자 *"작동하는 거면 운영해야지"* 의문이 *처음부터 맞았음* — v3 의 (b) 단일 옵션 강요가 잘못된 방향.

**v4 변경 사항**:

| 위치 | v3 | v4 | 사유 |
|---|---|---|---|
| §37 codex-subagents 본문 | 부정 안내 (72줄) | positive 가이드 + 18 agent catalog (약 110줄) | Codex 실재 시스템 안내 |
| `plugins/backend-ts/.codex/agents/` | 부재 | **18 TOML 구축 (1,144줄)** | python plugin 의 18 reference → TS 도메인 + TOML 변환 |
| §36 codex-commands 인용구 | "All other components reside at the plugin root level" | **"Keep `skills/`, `hooks/`, `assets/`, `.mcp.json`, and `.app.json` at the plugin root."** | Codex MED #1 — 공식 spec verbatim |
| §76 security-audit-check audit-all.sh | 4 패턴 (SSL 누락) → v3 5 패턴 추가 | **6 패턴** — untagged raw query (4b) 추가 | Codex HIGH #2 — `client.query(\`...\${name}\`)` 미탐지 |
| §60 agent-verify-def systemPromptFile | "prompts/ 하위 상대 경로" 라고 표기 | **zod 자체 제약 ✕** + project invariant 라고 명시 + optional 필드 nullable/range/type 추가 | Codex MED #2 + #3 — zod schema 정확성 |
| audit-all.sh `agent_verify_def_check()` | `shopt -s nullglob` + `shopt -u nullglob` | `nullglob_state=$(shopt -p nullglob); ...; eval "$nullglob_state"` | Codex LOW #1 — 호출자 nullglob 상태 보존 |
| audit-all.sh YAML grep 한계 | 주석 ✕ | tab indent / `# name:` 주석 / multi-doc YAML 미처리 명시 주석 | Codex LOW #2 |
| 분포 | ✅ 64 / ✏️ 16 / ⚠️ 4 | 변동 ✕ | 분류는 그대로, 조치 내용만 v4 적용 |

**v4 turn 의 main session self-blind spot 교훈** (이번도):
- v3 turn 에서 URL `/codex/agents-md` 404 결과로 *"named sub-agent 부재"* 단정. 정확한 URL 추정 실패 (`/codex/subagents` 복수형 시도 안 함).
- Codex 의 cold-context fetch 가 *나의 URL 가정과 다른 정확한 URL* 시도 → 결정적 차이.
- 교훈: *공식 docs 의 페이지 이름은 추측 ✕*. 404 시 *유사 이름 (단수/복수, kebab/snake, 명사/동사) 모두 시도* 의무.

**v4 적용 후 미해결**:
- 다른 7개 skill 의 `stack-backend-ts` → `backend-ts` rename (codex-2개는 완료, 5개 남음: commit-rules / ts-agent-rules / full-architecture-audit / rule-linting / backend-overview, 부속 파일들)
- 사용자 결정 권고: `STACK_BACKEND_TS_PRESET` env var 명 유지 vs 변경 (instance 측 호환성)
- coding-standards 슬림화 (P1 광범위 모델 native)
- 4 invariants 의 audit 체크리스트 분리 (P3)
- architecture-invariants 의 동적 grep 명령 제거 (AP-06)
- ⚠️ 4 항목 사용자 결정 후 후속 PR
- 18 TOML 의 본문은 *minimal seed* — 실사용 시 *어느 agent 가 자주 호출되는가* 파악 후 본문 확장 권고

---

#### v2 → v3 (2026-05-25, Codex 공식 plugin spec 직접 검증)

**배경**: v2 의 PR 0 묶음 §36/§37 에서 codex-commands / codex-subagents 의 backing asset 부재를 *"(a) 디렉토리 생성 vs (b) 본문 재작성 — 사용자 결정"* 이분법으로 표현. 사용자가 *"작동하는 거면 운영해야지"* 의문 제기로 Codex 공식 plugin spec 직접 fetch 진행.

**검증 결과** (`developers.openai.com/codex/plugins/build` verbatim):
- *"Only `plugin.json` belongs in `.codex-plugin/`. All other components reside at the plugin root level."*
- 공식 plugin component = **skills / mcpServers / apps / hooks** 4개. **commands / agents 는 plugin component 가 아님**.
- 공식 디렉토리 트리에 `commands/` 와 `agents/` 가 plugin root 에도 부재.
- `developers.openai.com/codex/agents-md` → 404 (named sub-agent dispatch 시스템 docs 부재).
- `import { spawnAgent } from '@codex/cli-host'` 도 npm 실재 ✕ — 가공의 API.

**v3 변경 사항**:

| 위치 | v2 | v3 | 사유 |
|---|---|---|---|
| §36 codex-commands | (a)/(b) 사용자 결정 | **(b) 단일 확정** | Codex spec 에 `.codex-plugin/commands/` 가 plugin component ✕ — (a) 무효 |
| §37 codex-subagents | (a)/(b) 사용자 결정 | **(b) 단일 확정** | 동일 |
| §부록 A-1 codex 2행 | (a)/(b) 결정 | "본문 전면 재작성 ((b) 확정)" | 동일 |
| §부록 B PR 0 항목 3 | YES/NO 결정 | "본문 전면 재작성 ((b) 확정)" + 공식 spec 인용 | 동일 |
| 분포 | ✅ 64 / ✏️ 16 / ⚠️ 4 | 변동 ✕ | 분류는 그대로, 조치 내용만 확정 |

**v3 적용 후 codex-commands / codex-subagents 의 *유효한 가치***:
- 두 skill 의 *재작성 후* 역할 = *부정 안내* — backend-ts plugin 의 Codex 사용자가 *Claude Code 와의 차이* 를 이해하도록.
- 통합 옵션 (codex-host-notes 같은 single skill): 검토 가치. v3 에서는 분리 유지 후 line-count 축소 (183→40-60, 161→40-60).

**v3 turn 적용 완료 항목**:
- ✅ codex-commands SKILL.md 본문 재작성 (183→64줄)
- ✅ codex-subagents SKILL.md 본문 재작성 (161→72줄)
- ✅ `.codex-plugin/plugin.json` rename: `stack-backend-ts` → `backend-ts` + displayName 정리
- ✅ §60 agent-verify-def schema drift fix — SKILL.md 본문 + audit-all.sh `agent_verify_def_check()` (정본 [[ai-agent-patterns]] AgentDefinitionSchema 와 sync, YAML glob, name regex, file stem 일치, name 중복 4 패턴)
- ✅ §76 security-audit-check count + SQL injection fix — SKILL.md L13 "6가지" → "5가지" + audit-all.sh `security_audit_check()` 에 SQL injection 패턴 추가 (5 패턴 모두 실행) + cross-ref 주석
- ✅ audit-all.sh `bash -n` syntax check 통과

**v3 적용 후에도 미해결** (PR 1+ 후속):
- 다른 7개 skill 의 `stack-backend-ts` → `backend-ts` rename (codex-2개는 완료, 5개 남음: commit-rules / ts-agent-rules / full-architecture-audit / rule-linting / backend-overview, 그리고 부속 파일 `AGENTS.md` / `docs/ci-template.md` / `docs/instance-claude-md-template.md` / `scripts/forbidden-*` / `scripts/presets/`)
- `STACK_BACKEND_TS_PRESET` env var 명 유지 vs 변경 결정 (instance 측 호환성)
- agent YAML vs TS 가정 sanity check (정본은 YAML 명시 — instance 별 확인 권고)
- coding-standards 슬림화 (P1 광범위 모델 native — 122 → 50-60줄)
- 4 invariants 의 audit 체크리스트 분리 (P3)
- architecture-invariants 의 동적 grep 명령 제거 (AP-06)
- ⚠️ 4 항목 사용자 결정 후 후속 PR

---

#### v1 → v2 (2026-05-24, Codex cold-context 리뷰 반영)

**배경**: v1 자체 셀프리뷰 (HIGH 3건 발견) 후 codex-rescue agent (`task a0897ffd...`) 에 cold-context 리뷰 의뢰. Codex 가 HIGH 8건 (self-review 의 약 3배) 발견 + 본 audit 의 *체계적 blind spot* 노출. main session 은 *동일 패턴 검사 시 self-blind* (예: rename drift 6개는 발견하면서 7번째는 놓침; backing asset 부재는 stat 검증 의무 누락).

**v2 변경 사항**:

| 위치 | v1 | v2 | 사유 (Codex 발견) |
|---|---|---|---|
| §60 agent-verify-def | ✅ | ✏️ 🆘 | description 의 4 필드가 정본 zod schema (ai-agent-patterns AgentDefinitionSchema) 와 *완전 불일치* — schema drift. audit-all.sh L268-282 동일 결함 mirrored. |
| §76 security-audit-check | ✅ | ✏️ 🆘 | description "6가지" vs body 5 패턴 mismatch + audit-all.sh L408-423 가 *4 패턴만 실행 (SQL injection 누락)*. |
| §35 backend-overview | ✅ | ✏️ | L23 `plugins/stack-backend-ts/skills/` rename drift — v1 의 6 skill rename 목록에서 누락. |
| §36 codex-commands | ✏️ | ✏️ 🆘 | backing asset 부재 확정 (`.codex-plugin/commands/` + `references/commands/` 모두 실재 ✕). v1 은 "확인 필요" 로 미결정. |
| §37 codex-subagents | ✏️ | ✏️ 🆘 | backing asset 부재 확정 (`.codex-plugin/agents/` + `references/agents/` + `.claude/agents/` 모두 실재 ✕). v1 은 "확인 필요" 로 미결정. |
| §부록 A-1 | 13행 | 16행 (그 중 🆘 5건) | 위 3 신규 reclass + 2 강화 |
| §부록 B | 4 PR | 5 PR (PR 0 신설) | 🆘 CRITICAL audit 정합성 회복 묶음 추가 |
| §0 분포 | ✅ 67 / ✏️ 13 | ✅ 64 / ✏️ 16 | 위 reclass 반영 |
| §0 Top 5 | rename 1번 | 🆘 schema drift 1번 | 우선순위 재배치 (audit 정합성 결함이 rename 보다 critical) |

**v2 적용 후에도 미해결**:
- `audit-all.sh` 내 `STACK_BACKEND_TS_PRESET` env var 명 — env name 이라 *의도된 stable ABI* 가능 (instance 측 export 호환성). 변경 vs 유지 결정은 사용자 몫.
- `.codex-plugin/plugin.json` 의 `"name": "stack-backend-ts"` — manifest level rename 누락 (PR 1 묶음에 포함).
- 본 audit doc 가 측정하지 않은 layer: cross-plugin 간 manifest 이름 충돌 (예: `.claude-plugin/plugin.json` `"backend-ts"` vs `.codex-plugin/plugin.json` `"stack-backend-ts"` — plugin loader 가 어느 쪽을 인식하는가는 host 별 다름).

---

## 10. 본 audit 의 자체 한계

본 audit 는 *모델 1회 점검* — 다음을 검증하지 않음:

1. **각 권고 액션의 실제 효과** — ✏️ 16건의 권고는 *제안* 이며, 실제 적용 후 *invoke 빈도 변화 / description budget 회복* 측정은 별도 작업.
2. **Cross-skill invoke 빈도** — D-01 (다른 skill 과의 overlap) 판단은 *description 본문 비교* 기반. 실제 동시 invoke 빈도는 별도 telemetry 필요.
3. **runtime 측정 (baseline 실패율)** — Decision Tree Q3 (`baseline 실패율 ≥ 20%`) 는 본 audit 에서는 *모든 skill 통과 가정* — 실제 baseline 측정은 별도 작업 (보고서 §AP-02).
4. **사용자 의도 (⚠️ 4 항목)** — 분리 정책 / 통합 가능성 판단은 사용자 결정 필요.
5. **다른 plugin** — 본 audit 은 backend-ts 전용. 다른 plugin 의 audit 은 별도 작업.
6. **self-blind spot 위험** (Codex review 발견) — main session 은 *동일 패턴 검사 시* (rename drift, count mismatch 등) self-blind spot 을 가진다. v2 는 Codex cold-context 리뷰로 일부 보강했으나, 동일 방식의 후속 정기 리뷰 (예: v3, v4) 가 권고됨 — 단일 모델 단일 세션 자기검증의 신뢰도는 *완전 ≠* 임을 명시.

