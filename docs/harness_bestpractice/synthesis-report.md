# Harness 베스트 프랙티스 — 종합 보고서

> **Claude Code / Codex 하네스(skills / subagents / hooks) 를 만들 때, 모델이 이미 잘 아는 영역과 정렬되어 비용 없이 효과를 내려면 어떻게 해야 하는가**
>
> 보고서 일자: 2026-05-24 · 작성: hibye-plugins 운영자의 의뢰에 따라
> 
> raw 데이터: [`raw/`](raw/) · 상세 분석: [`analysis/`](analysis/) · 인덱스: [`README.md`](README.md)

---

## Executive Summary

이 보고서를 읽고 알게 되는 것 5줄:

1. **Anthropic 공식 1번 원칙: "Default assumption: Claude is already very smart"** — 모델 native 영역에 skill 을 만드는 것은 negative ROI.
2. **Skill / Subagent / Hook 은 *제어하는 축이 다르다*** — Skill = 재사용 prompt, Subagent = 컨텍스트 격리, Hook = lifecycle 자동화. 같은 작업을 셋 다로 풀 수 있지만 강제력과 학습성의 trade-off 가 다르다.
3. **Skill content lifecycle 의 의외성** — 한 번 invoke 된 SKILL.md 는 세션 끝까지 남고 **re-read 안 됨**. compaction 후 25k token 공유 budget 에서 오래된 skill 부터 drop. → *동적 매번-실행 절차는 skill 부적합, hook 으로*.
4. **Description 이 skill 효능의 80%** — exclusion clause ("Do NOT use for...") 가 *"the single most important line"*. all-caps imperative 보다 *"rule + 왜"* 가 모델의 일반화에 강함.
5. **Build vs Trust Decision Tree (7 게이트)** 로 신규 하네스 작성 전에 *진짜 필요한지* 검증. baseline 실패율 측정이 필수. → 본 보고서 §3.

---

## 1. 보고서 구조 한눈에

```
docs/harness_bestpractice/
├── README.md                          ← 폴더 인덱스 + 읽는 순서
├── synthesis-report.md                ← ★ 현재 문서 (최상위 종합)
├── analysis/
│   ├── 01-build-vs-trust-framework.md ← ★ 핵심 의사결정 framework
│   ├── 02-skills-deep-dive.md         ← Skill 작성 원리 (만들기로 결정한 경우)
│   ├── 03-subagents-deep-dive.md      ← Subagent 분리 비용/이득
│   ├── 04-hooks-deep-dive.md          ← Hook 자동화 vs 수동 결정
│   └── 05-anti-patterns.md            ← 10개 안티 패턴 카탈로그
└── raw/                                ← Anthropic / Codex / 커뮤니티 원문 (15 파일)
```

권장 읽는 순서:
- **5분**: 이 Executive Summary + §2 핵심 통찰 5가지
- **15분**: 위 + §3 Build vs Trust Decision Tree + §5 권고 요약
- **1시간**: 전체 + `01-build-vs-trust-framework.md` 전체 + 자기 프로젝트 dry-run

---

## 2. 핵심 통찰 5가지 (전체 분석의 결론)

### (1) "Claude is already very smart" 는 1번 원칙

Anthropic 공식 best-practices 의 첫 단락:

> *"Default assumption: Claude is already very smart. Only add context Claude doesn't already have. Challenge each piece of information: Does Claude really need this explanation? Can I assume Claude knows this? Does this paragraph justify its token cost?"*

→ 일반 코딩 지식 (React useState, REST API 디자인, SQL 작성, git 사용법) 을 skill 로 만드는 건 anti-pattern. 모델 native 와 *겹치지 않는* 영역만 skill.

**비용 정량**: 86개 skill (backend-ts) × 200자 description = 17,200 chars 가 system prompt 에 상주. Opus 200k context 의 1% = 2000 chars budget — **이미 초과** → description 잘림 → *발견되어야 할 niche skill 일수록 먼저 사라지는 음의 피드백*.

### (2) 세 하네스의 *제어 축* 이 다르다

| 축 | Skill | Subagent | Hook |
|---|---|---|---|
| 제공물 | 재사용 prompt + 지식 | 격리 실행 context | 결정론적 부수효과 |
| 모델 판단 | 있음 | 있음 (격리) | **없음** |
| 강제력 | 약 | 중 | **강** |
| 학습성 | **강** (왜 인지 학습) | 중 | 0 |
| 컨텍스트 영향 | main 에 누적 | main 격리, 결과만 | inject 또는 차단 |

같은 목표 (e.g., "API 추가 시 zod 검증 강제") 를 셋 다로 풀 수 있지만:
- **Skill 단독**: 모델이 무시 가능 (약함)
- **Hook 단독**: 결정론적 강제, 학습성 0
- **Skill + Hook hybrid (권장)**: 학습성 + 강제력

### (3) Skill Content Lifecycle 의 의외성

[`claude-code-skills.md` §Skill content lifecycle](raw/anthropic/claude-code-skills.md):

> *"When you or Claude invoke a skill, the rendered SKILL.md content enters the conversation as a single message and stays there for the rest of the session. Claude Code does not re-read the skill file on later turns."*
>
> *"Auto-compaction... keeping the first 5,000 tokens of each. Re-attached skills share a combined budget of 25,000 tokens."*

함의:
- **동적 매번-실행 절차는 skill 안에 넣으면 안 됨** (첫 invoke 가 영원히 stale)
- **첫 5000 token 에 결정적 내용을 둬라**
- **자주 invoke 되는 skill 만 compaction 살아남음** → niche skill 은 오래된 채로 drop

해결: 동적 facts 는 hook 의 `additionalContext` 로 매 turn inject.

### (4) Description 작성이 skill 효능의 80%

community §Activation Metadata Pattern + Exclusion Clause Pattern:

> *"Positive triggers pull skills in while exclusions push them out. This is called 'the single most important line in the description' by practitioners."*

description 체크리스트:
- 3인칭 + 동사 시작
- 도메인 키워드 / 동의어 / 별칭 dense
- **Exclusion clause: "Do NOT use for X (use Y instead)"**
- 1536 chars 이내 (Claude Code 의 description + when_to_use 합산 cap)

### (5) "Explain-the-Why" 가 "All-caps imperative" 보다 일반화에 강함

community §Explain-the-Why Pattern:

> *"State the rule, then explain why, so Claude generalizes to unanticipated cases. 'Use constructor injection. Field injection breaks testability because we cannot mock the field without Spring context' beats 'MUST use constructor injection. NEVER use field injection.'"*

함의: backend-ts 의 다수 skill 이 *invariant* 를 all-caps 로 표기 → audit 후 *"규칙 + 1줄 이유"* 패턴으로 전환 권장.

---

## 3. Build vs Trust Decision Tree (7 게이트)

전체 트리는 [`01-build-vs-trust-framework.md`](analysis/01-build-vs-trust-framework.md) §3 참조. 요약:

```text
Q1. 공식 docs 5분 검색으로 해결? ─Yes→ ❌ TRUST (만들지 마라)
   └No
Q2. 모델 native 와 충돌하는 프로젝트 고유 컨벤션? ─No→ ❌ TRUST
   └Yes
Q3. baseline 실패율 ≥ 20%? ─No→ ❌ TRUST
   └Yes
Q4. 동적 행동 vs 정적 지식?
   ├행동→ Q6
   └지식→ Q7
Q6. lifecycle event 에 묶이는가? ─Yes→ ✅ HOOK
   └No → Q7
Q7. verbose 출력? ─Yes→ ✅ SUBAGENT
   └No → Q5
Q5. trigger 가 명확하고 다른 skill 과 안 겹치는가? ─Yes→ ✅ SKILL
   └No → ⚠️ REWORK
```

4분기 결과:
- **TRUST** — 만들지 마라 (모델 native)
- **HOOK** — lifecycle 결정론적 자동화
- **SUBAGENT** — verbose / 권한 격리 / 병렬
- **SKILL** — 재사용 prompt + 정적 지식

---

## 4. 안티 패턴 Top 10 (한 줄 요약)

| # | 범주 | 안티 패턴 | 강제력 |
|---|---|---|---|
| AP-01 | Build vs Trust | 모델 native 와 겹치는 skill | **MUST not** |
| AP-02 | Build vs Trust | baseline 측정 없이 skill 작성 | SHOULD |
| AP-03 | Build vs Trust | 시간 종속 정보 ("after Aug 2025") | SHOULD |
| AP-04 | Skill | description 너무 짧음 ("Helps with documents") | **MUST** |
| AP-05 | Skill | all-caps imperative 만 가득 (Explain-the-Why 위반) | SHOULD |
| AP-06 | Skill | 동적 매번-실행 절차를 skill 안에 (lifecycle 위반) | **MUST not** |
| AP-07 | Skill | references nested chain (1 hop 초과) | SHOULD |
| AP-08 | Subagent | terse command brief ("fix the bug") | **MUST** for non-trivial |
| AP-09 | Subagent | 판단까지 위임 ("based on findings, fix it") | SHOULD |
| AP-10 | Hook | 맥락 판단 영역에 hook (학습성 0) | SHOULD |

상세: [`analysis/05-anti-patterns.md`](analysis/05-anti-patterns.md)

---

## 5. 3종 하네스별 권고 요약

### Skills

✅ **만들어야 할 때**:
- 프로젝트 고유 컨벤션 / 불변식 (StoragePort, AgentDefinition 등)
- 모델이 baseline 측정으로 실패하는 영역 (≥ 20%)
- 정적 지식 + 결정 시점 한 번 봄

❌ **만들지 마라**:
- 일반 코딩 패턴 (React, SQL, git)
- 동적 매번-실행 절차
- description 이 narrow trigger 안 되는 영역

**작성 핵심**:
- description: 3인칭 + 동사 + 키워드 + exclusion clause
- progressive disclosure (SKILL.md < 500 lines, references 1 hop)
- "rule + 왜" (Explain-the-Why)
- 첫 5000 token 에 결정적 내용

상세: [`analysis/02-skills-deep-dive.md`](analysis/02-skills-deep-dive.md)

### Subagents

✅ **만들어야 할 때**:
- Verbose output 격리 (테스트 결과, 검색 결과)
- 권한 격리 (read-only DB, narrow Bash)
- 병렬 실행 (3+ 독립 작업 동시)

❌ **만들지 마라**:
- 짧은 작업 (< 3 tool call)
- frequent mid-task 통신 필요
- main context 에 detail 이 남아야 하는 작업
- built-in Explore/Plan/general-purpose 로 충분한 경우

**작성 핵심**:
- description 에 *"Use proactively"* / *"Use immediately after"*
- `tools` allowlist 최소 권한
- 4-요소 brief 가이드 (목표/이미아는것/제외/형식)
- 판단까지 위임 금지 — *raw data 받아 main 에서 판단*

상세: [`analysis/03-subagents-deep-dive.md`](analysis/03-subagents-deep-dive.md)

### Hooks

✅ **만들어야 할 때**:
- Context injection (SessionStart, UserPromptSubmit) — 매 세션/turn fresh
- 결정론적 차단 (PreToolUse) — destructive 명령, forbidden pattern
- 자동화 (PostToolUse) — lint, format, test
- 보안 강제 (subagent + PreToolUse hook hybrid)

❌ **만들지 마라**:
- 맥락 판단이 필요한 영역
- 학습성이 필요한 영역 (대신 Skill + Hook hybrid)
- 무거운 작업 (timeout 부담)

**작성 핵심**:
- `additionalContext` 는 facts only (prompt injection 회피)
- Exec form (args) 사용
- `${CLAUDE_PLUGIN_ROOT}` path placeholder
- timeout 적절 (SessionStart < 5s)
- 모델에 *왜* 막혔는지 `permissionDecisionReason` 명확

상세: [`analysis/04-hooks-deep-dive.md`](analysis/04-hooks-deep-dive.md)

---

## 6. hibye-plugins 적용 — Decision Tree Dry-Run

backend-ts 의 대표 5개 skill 을 §3 의 7-게이트에 통과시킨 결과:

| Skill | Q1 (native?) | Q2 (고유?) | Q4 (정적/동적) | 결과 | 권고 |
|---|---|---|---|---|---|
| **`database`** | ❌ (StoragePort 는 고유) | ✅ | 정적 지식 | **SKILL ✅ 정당** | 현재 형태 유지 |
| **`coding-standards`** | ⚠️ **부분 위반** (SRP/DRY/KISS/YAGNI 는 모델 native, camelCase 도 native) | 일부 ✅ (pino + AsyncLocalStorage 셋업은 고유) | 정적 지식 | **부분 TRUST + 부분 SKILL** | *우리 고유 부분만 남기고 일반 원칙 제거*. AP-01 위반 후보 |
| **`auth`** | ⚠️ 부분 위반 (JWT/세션/rate limit 일반 패턴은 native) | ✅ (시크릿 누락 처리는 고유) | 정적 지식 | **부분 압축 권장** | 일반 패턴 줄이고 *우리 시스템 고유* 부분 강조 |
| **`ai-agent-patterns`** | ❌ (AgentDefinition + YAML+md prompt 선언 = 고유) | ✅ | 정적 지식 | **SKILL ✅ 정당** | 현재 형태 유지 |
| **`architecture-invariants`** | ❌ (20 invariant 라우팅 = 고유 메타) | ✅ | 정적 지식 (라우팅 index) | **SKILL ✅ 정당** | 자동 로드 = 25k budget 소비 — 정당성 재평가 권장 |

### 6.1 발견된 우선 audit 후보

1. **`coding-standards`** — SRP / DRY / KISS / YAGNI / camelCase 등 모델 native 영역이 다수. 보유 가치 ≈ "우리 회사 pino 셋업 + AsyncLocalStorage 패턴" 부분만. 압축 후 `our-logging-conventions` 같은 narrow skill 로 split 권장.

2. **`auth`** — JWT/세션 일반 패턴은 모델 native. "우리 시스템의 시크릿 누락 처리 분기", "우리 rate limit 정책" 만 남기기 권장.

3. **`architecture-invariants` 자동 로드 정책** — *항상 로드* = 25k token budget 의 핵심 점유자. 매 세션 *모든 작업* 에서 invariant 라우팅 가이드가 필요한지 재평가. 자동 로드 대신 *invoke-only* 로 전환 검토.

### 6.2 권장 신규 hook (현재 SessionStart profiler 외)

| 목표 | Hook event | 핵심 효과 | 우선순위 |
|---|---|---|---|
| Destructive bash 차단 (rm -rf, drop database) | PreToolUse on Bash | 사고 방지 | High |
| Forbidden pattern 즉시 차단 (StoragePort 우회 직접 DB write 등) | PostToolUse on Edit\|Write | invariant 강제 + 학습 | Med |
| 매 turn current branch + 변경 파일 inject | UserPromptSubmit | skill 의 동적 절차 대체 (AP-06 해결) | Med |

---

## 7. 외부 데이터에 근거한 결정 기준 매핑

본 보고서의 모든 결정 기준은 raw/ 폴더의 1차 자료에 근거. 검증용 매핑:

| 결정 기준 | raw 출처 |
|---|---|
| "Claude is already smart" 1번 원칙 | [`raw/anthropic/agent-skills-best-practices.md`](raw/anthropic/agent-skills-best-practices.md) L27-33 |
| Description budget 1% context | [`raw/anthropic/claude-code-skills.md`](raw/anthropic/claude-code-skills.md) L402-408 |
| Skill content 25k token budget + re-read 안 됨 | [`raw/anthropic/claude-code-skills.md`](raw/anthropic/claude-code-skills.md) L226-232 |
| Skill vs Subagent 분기 | [`raw/anthropic/claude-code-subagents.md`](raw/anthropic/claude-code-subagents.md) L348-361 |
| Hook = lifecycle 자동화 본질 | [`raw/anthropic/claude-code-hooks.md`](raw/anthropic/claude-code-hooks.md) L14-22 |
| Exclusion clause 의 중요성 | [`raw/community/community-blog-skill-authoring-patterns.md`](raw/community/community-blog-skill-authoring-patterns.md) §Exclusion Clause Pattern |
| Explain-the-Why 패턴 | [`raw/community/community-blog-skill-authoring-patterns.md`](raw/community/community-blog-skill-authoring-patterns.md) §Explain-the-Why Pattern |
| Build evaluations first | [`raw/anthropic/agent-skills-best-practices.md`](raw/anthropic/agent-skills-best-practices.md) L454-476 |
| Cross-vendor skill 표준 | [`raw/codex-openai/agents-md-spec.md`](raw/codex-openai/agents-md-spec.md) — Claude/Codex/Cursor/Gemini/Copilot 등 40+ 채택 |
| Avoid deeply nested references (1 hop) | [`raw/anthropic/agent-skills-best-practices.md`](raw/anthropic/agent-skills-best-practices.md) §Avoid deeply nested references |
| "Never delegate understanding" | Claude Code Agent tool description (built-in) |

---

## 8. 한계와 다음 단계

### 8.1 본 보고서의 한계

- **임계값은 저자 권장**: "공식 docs 5분 검색", "실패율 20%" 등은 raw 데이터에 명시되지 않은 저자 권장. 운영하며 조정 필요.
- **현장 사례 부족**: backend-ts 외 다른 대규모 plugin 운영자의 사례 부재 — 일반화 가능성 한계.
- **모델 버전 의존**: skill content lifecycle 의 25k budget 등은 Claude Code 의 현재 버전 (2026-05) 기준. 미래 변경 가능.
- **Codex 자료 부족**: openai/codex 의 AGENTS.md 는 정형 spec 부재. agentskills.io 표준이 사실상 cross-vendor 표준이지만 Codex 의 hook/subagent 추가 기능은 별도.

### 8.2 다음 단계 제안

1. **§6 의 audit 후보 3개 (coding-standards, auth, architecture-invariants) 실행** — Decision Tree dry-run 후 압축/split/자동로드 전환
2. **권장 신규 hook 3개 prototype** — destructive 차단, forbidden pattern, current branch inject
3. **신규 skill 작성 시 본 framework 의 7-게이트 통과 의무화** — `.claude/commands/` 에 `/audit-new-skill` 같은 helper 도구화
4. **3개월 후 재평가** — 모델 버전 (Opus 4.7 → 4.8?) 변경 시 raw 데이터 갱신 + framework 재평가

### 8.3 본 보고서가 의도하지 않는 것

- ❌ **"skill 을 줄여라"** — *"모델 native 와 겹치는 skill 만 줄여라"*. 프로젝트 고유 자산은 늘려도 됨.
- ❌ **"hook 만능"** — hook 은 학습성 0. 학습이 필요하면 Skill + Hook hybrid.
- ❌ **"subagent 가 컨텍스트 만능"** — cold-start brief 비용이 있어 짧은 작업엔 main context.
- ❌ **"Anthropic 권장이 절대"** — backend-ts 의 긴 skill (1000+ lines) 도 *모든 줄이 정당화* 되면 정당. *information density per token* 으로 평가.

---

## 9. 한 줄 결론

> **하네스를 더 많이 만드는 것이 더 좋은 것이 아니다. 모델 native 영역에 만든 하네스는 description budget 잠식 + lifecycle stale + false trigger 의 음의 ROI 다. *"Claude is already very smart"* 를 출발점으로, 프로젝트 고유 가치만 하네스 화하라.**

---

> 본 보고서는 [`docs/harness_bestpractice/README.md`](README.md) 의 인덱스에서 다른 문서로 이동할 수 있다.
> raw 데이터는 [`raw/`](raw/) 에서 출처 검증 가능 (각 파일 상단에 source_url + fetched_at 명시).
