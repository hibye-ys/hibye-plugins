# Harness Best Practice — 폴더 인덱스

> **Claude Code / Codex 의 하네스(skills, subagents, hooks) 작성 베스트 프랙티스 딥리서치 보관소.**
>
> 핵심 질문: *모델이 이미 잘 아는 영역에 굳이 하네스를 만들면 context · 처리속도 낭비다. 무엇을 만들고, 무엇은 모델에 맡길 것인가?*

---

## 읽는 순서 가이드

| 시간 | 추천 |
|---|---|
| **5분 (스캐너)** | [`synthesis-report.md`](synthesis-report.md) 의 Executive Summary + §2 (5가지 핵심 통찰) + §4 (안티 패턴 Top 10) |
| **15분 (이해)** | 위 + `synthesis-report.md` §3 (Decision Tree) + §5 (하네스별 권고) + §6 (hibye-plugins dry-run) |
| **1시간 (실행자)** | 전체 + [`analysis/01-build-vs-trust-framework.md`](analysis/01-build-vs-trust-framework.md) 전체 + 본인 프로젝트의 skill 3-5개 dry-run |
| **참고용** | [`raw/`](raw/) 의 원문 — 인용 검증, 모델 버전 업그레이드 시 재평가 |

---

## 파일 구조

```
docs/harness_bestpractice/
├── README.md                          ← 본 파일
├── synthesis-report.md                ← ★ 최상위 종합 보고서 (Executive Summary + Decision Tree + 권고)
│
├── analysis/                          ← 심층 분석 5종
│   ├── 01-build-vs-trust-framework.md ← ★ 의사결정 framework (보고서의 척추)
│   ├── 02-skills-deep-dive.md         ← Skill 작성 원리
│   ├── 03-subagents-deep-dive.md      ← Subagent 분리 비용/이득
│   ├── 04-hooks-deep-dive.md          ← Hook 자동화 vs 수동
│   └── 05-anti-patterns.md            ← 10개 안티 패턴 카탈로그
│
└── raw/                                ← 외부 원문 데이터 (15 파일)
    ├── anthropic/                     ← Anthropic 공식 8 파일
    ├── codex-openai/                  ← Codex / OpenAI 공식 3 파일
    └── community/                     ← 커뮤니티 베스트 프랙티스 4 파일
```

---

## 주요 발견 3가지 (초간단 요약)

### 1. **Default assumption: Claude is already very smart**

Anthropic 공식 1번 원칙. 모델 native 영역 (일반 React, SQL, git, REST API 패턴) 을 skill 로 만들면 negative ROI.

→ 출처: [`raw/anthropic/agent-skills-best-practices.md`](raw/anthropic/agent-skills-best-practices.md)

### 2. **Skill content lifecycle 의 의외성**

한 번 invoke 된 SKILL.md 는 세션 끝까지 남고 **re-read 안 됨**. compaction 후 25k token 공유 budget. → *동적 매번-실행 절차는 skill 부적합*, hook 으로.

→ 출처: [`raw/anthropic/claude-code-skills.md`](raw/anthropic/claude-code-skills.md) §Skill content lifecycle

### 3. **Exclusion clause = "single most important line in the description"**

`"Do NOT use for X (use Y instead)"` 가 trigger 정확도의 결정타. positive trigger 만으로는 다른 skill 과 겹쳐 잘못 trigger.

→ 출처: [`raw/community/community-blog-skill-authoring-patterns.md`](raw/community/community-blog-skill-authoring-patterns.md) §Exclusion Clause Pattern

---

## Build vs Trust Decision Tree (요약)

신규 하네스 작성 전에 7개 질문에 답:

```
Q1. 공식 docs 5분 검색으로 해결? ─Yes→ ❌ TRUST (만들지 마라)
Q2. 모델 native 와 충돌하는 프로젝트 고유 컨벤션? ─No→ ❌ TRUST
Q3. baseline 실패율 ≥ 20%? ─No→ ❌ TRUST
Q4. 동적 행동 vs 정적 지식?
   ├행동→ Q6
   └지식→ Q7
Q6. lifecycle event 에 묶이는가? ─Yes→ ✅ HOOK
Q7. verbose 출력? ─Yes→ ✅ SUBAGENT
Q5. trigger 명확? ─Yes→ ✅ SKILL  ─No→ ⚠️ REWORK
```

상세: [`analysis/01-build-vs-trust-framework.md`](analysis/01-build-vs-trust-framework.md) §3

---

## raw 데이터 출처 인벤토리

### Anthropic 공식 (8 파일)

| 파일 | 출처 |
|---|---|
| `claude-code-skills.md` | https://code.claude.com/docs/en/skills (redirect from docs.claude.com) |
| `claude-code-subagents.md` | https://code.claude.com/docs/en/sub-agents |
| `claude-code-hooks.md` | https://code.claude.com/docs/en/hooks |
| `agent-skills-overview.md` | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview |
| `agent-skills-best-practices.md` | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices |
| `engineering-agent-skills.md` | Anthropic Engineering 블로그 — skills/agent 관련 |
| `github-anthropics-skills.md` | github.com/anthropics/skills (summary) |
| `claude-code-plugins.md` | https://code.claude.com/docs/en/plugins (보조) |

### Codex / OpenAI 공식 (3 파일)

| 파일 | 출처 | 비고 |
|---|---|---|
| `codex-cli-readme.md` | github.com/openai/codex README | summary |
| `agents-md-spec.md` | **agentskills.io** 표준 | openai/codex 의 AGENTS.md 는 정형 spec 부재 — agentskills.io 가 사실상 cross-vendor 표준 (Claude/Codex/Cursor/Gemini/Copilot 등 40+ 채택) |
| `openai-agents-sdk.md` | openai.github.io/openai-agents-python/ | summary |

### 커뮤니티 (4 파일)

| 파일 | 출처 | 신호 강도 |
|---|---|---|
| `community-blog-skill-authoring-patterns.md` | Generative Programmer (Substack) | **HIGH** — 14패턴 카탈로그 |
| `community-blog-practical-guide-2026.md` | dev.to 블로그 | 중 |
| `superpowers-readme.md` | github.com/obra/superpowers | summary |
| `awesome-claude-code.md` | github.com/hesreallyhim/awesome-claude-code | 저신호 — curation 진행 중 |

---

## 향후 갱신 시 체크리스트

본 폴더는 *살아있는 자료* — Claude/Codex 의 진화에 따라 갱신 필요.

- [ ] **3-6개월마다** raw/ 의 Anthropic 공식 문서 재 fetch (특히 best-practices, skill spec 변경 확인)
- [ ] **모델 메이저 버전 변경 시** (Opus 4.7 → 4.8 등) framework 의 임계값 재평가
- [ ] **신규 하네스 추가 시** Decision Tree 통과 결과를 commit message 에 기록
- [ ] **anti-pattern 발견 시** [`analysis/05-anti-patterns.md`](analysis/05-anti-patterns.md) 에 사례 추가

---

## 의문이 들 때 어디로 가나

| 질문 | 답이 있는 곳 |
|---|---|
| "이 skill 정말 만들어야 하나?" | [`analysis/01-build-vs-trust-framework.md`](analysis/01-build-vs-trust-framework.md) §3 Decision Tree |
| "skill description 어떻게 쓰지?" | [`analysis/02-skills-deep-dive.md`](analysis/02-skills-deep-dive.md) §2 |
| "subagent 가 적절한가?" | [`analysis/03-subagents-deep-dive.md`](analysis/03-subagents-deep-dive.md) §2 |
| "hook 으로 풀까, skill 로 풀까?" | [`analysis/01-build-vs-trust-framework.md`](analysis/01-build-vs-trust-framework.md) §4 + [`analysis/04-hooks-deep-dive.md`](analysis/04-hooks-deep-dive.md) §8 |
| "내가 만드는 게 안티 패턴인가?" | [`analysis/05-anti-patterns.md`](analysis/05-anti-patterns.md) §5 체크리스트 |
| "출처가 어디?" | [`synthesis-report.md`](synthesis-report.md) §7 + raw/ 폴더 |
| "hibye-plugins 의 어느 skill 부터 audit?" | [`synthesis-report.md`](synthesis-report.md) §6.1 |

---

> 본 보고서 작성: 2026-05-24 · Claude Opus 4.7 (1M context) + 사용자 협업
> 의뢰자: hibye-plugins 운영자 (naviseo.hict@gmail.com)
