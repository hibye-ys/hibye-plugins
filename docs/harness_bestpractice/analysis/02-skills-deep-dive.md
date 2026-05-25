# 02 — Skills Deep Dive

> **만들기로 결정한 skill 을 어떻게 모델 친화적으로 작성할 것인가**
> 
> 본 문서는 [`01-build-vs-trust-framework.md`](01-build-vs-trust-framework.md) 에서 "build" 분기로 떨어진 skill 의 작성 원리를 다룬다. "만들지 말지" 는 01 에서 다룬다.

---

## 0. 한 줄 요약

> **Skill 의 효능은 ① description 으로 trigger 되는가, ② SKILL.md body 가 token 가치를 정당화하는가, ③ progressive disclosure 로 reference 와 분리되었는가, ④ 동적 행동이 아닌 정적 지식인가 — 이 4축으로 결정된다.**

---

## 1. Skill 의 3-level 로딩 모델 (가장 중요한 사실)

[`agent-skills-overview.md`](../raw/anthropic/agent-skills-overview.md) 가 명시:

| Level | 로딩 시점 | token 비용 | 내용 |
|---|---|---|---|
| **L1: Metadata** | 항상 (session 시작 시) | ~100 token/skill | YAML frontmatter 의 `name` + `description` |
| **L2: Instructions** | trigger 시 1회 | < 5000 token | SKILL.md body |
| **L3: Resources** | 필요 시 | 사실상 무제한 | bundled files (bash 로 실행 / read) |

→ **모든 skill 디자인 결정의 출발점**. L1 은 budget 경쟁, L2 는 invoke-tax, L3 는 free. *적절한 정보를 적절한 level 에 놓는 것이 skill 디자인의 본질*.

### 1.1 Level 별 디자인 함의

- **L1 (description)**: trigger 의 성패. discovery 가 실패하면 나머지 다 무의미. (§2 참조)
- **L2 (SKILL.md body)**: 한 번 로드되면 세션 끝까지 남고 **re-read 안 됨** + compaction 후 25k token 공유. 모든 줄이 정당화되어야.
- **L3 (references / scripts)**: free. 길게 써도 됨. 단, "1 hop deep" 제약.

---

## 2. Description — Skill 효능의 80%

### 2.1 description 의 14패턴 매핑

community 의 14패턴 중 **5개가 description 에 직결**:

#### (P1) Activation Metadata Pattern — 3인칭, 구체 트리거

```yaml
# Good (3인칭 + 트리거 + 키워드)
description: Extracts text and tables from PDF files, fills forms, merges documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.

# Bad (1인칭, 모호)
description: I can help you process Excel files
description: Helps with documents
```

근거: [`agent-skills-best-practices.md` §Writing effective descriptions](../raw/anthropic/agent-skills-best-practices.md) — *"Always write in third person. The description is injected into the system prompt, and inconsistent point-of-view can cause discovery problems."*

#### (P2) Exclusion Clause Pattern — "the single most important line"

```yaml
description: Extracts data from invoices and receipts in PDF/image format. 
             Use when user provides scanned financial documents.
             **Do NOT use for general PDF text extraction (use pdf-processing instead) or for spreadsheet data (use xlsx).**
```

근거: [`community-blog-skill-authoring-patterns.md` §Exclusion Clause Pattern](../raw/community/community-blog-skill-authoring-patterns.md) — *"positive triggers pull skills in while exclusions push them out... This is called 'the single most important line in the description' by practitioners."*

#### (P3) Pushy language — 의도적으로 강한 표현

```yaml
description: ... Make sure to use this skill whenever the user mentions dashboards, 
             data visualization, or internal metrics, even if they do not 
             explicitly ask for a dashboard.
```

근거: community blog 가 Anthropic best practice 에서 추출. 모델이 *자기검열* 하는 경향이 있어 강한 표현이 필요.

#### (P4) 키워드 dense

모델은 description 의 키워드와 사용자 요청의 유사도로 trigger 한다. *동의어 / 별칭 / 도메인 용어*를 적극 포함.

```yaml
# Bad
description: PDF tool

# Good
description: Extract text and tables from PDF files (also called .pdf documents, 
             portable document format files). Handles forms, receipts, invoices, 
             scanned documents, reports.
```

#### (P5) 1536 chars 한계 인식

`description` + `when_to_use` 합산 1536자 cap. 초과 시 잘림. → 핵심을 앞에 두고 detail 은 뒤로.

### 2.2 description 작성 체크리스트

- [ ] 3인칭으로 작성 (1인칭 "I"/"you" 금지)
- [ ] 동사로 시작 ("Extract...", "Validate...", "Generate...")
- [ ] *무엇을 하는지* + *언제 쓰는지* 둘 다 포함
- [ ] 도메인 키워드 / 동의어 / 별칭 dense 하게
- [ ] Exclusion clause "Do NOT use for..." 명시 (다른 skill 과 안 겹치게)
- [ ] 1536 chars 이내 (Claude Code 의 합산 cap)
- [ ] Time-sensitive 표현 금지 ("after Aug 2025" 류)

---

## 3. SKILL.md Body — 길이와 정보 밀도

### 3.1 두 학파: 짧음 vs 김

| 학파 | 권장 길이 | 대표 | 철학 |
|---|---|---|---|
| **Anthropic 공식** | < 500 lines | bundled skills (pdf, xlsx 등) | progressive disclosure 로 references 분리. SKILL.md 는 "table of contents" |
| **hibye-plugins backend-ts** | 1000–2000 lines | `database/SKILL.md`, `agent-loop/SKILL.md` | 12-section pattern: invariants + workflows + algorithms + matrices + cross-field rules + forbidden + module structure + templates + impact matrix |

### 3.2 어느 쪽이 옳은가

**둘 다 옳을 수 있다. 단 조건이 다르다.**

| 짧음이 옳은 경우 | 김이 옳은 경우 |
|---|---|
| skill 이 *하나의 작업*을 다룸 (PDF 추출, Excel 분석) | skill 이 *도메인 전체*를 다룸 (DB 선택 + ORM + StoragePort + migration) |
| references 분리 비용 < information lookup 비용 | references 분리하면 모델이 nested read 에서 실패 ([best-practices §Avoid deeply nested references](../raw/anthropic/agent-skills-best-practices.md)) |
| trigger 가 narrow | trigger 가 도메인 전체 |
| 모델이 *작업 중* 에 lookup 함 | 모델이 *결정 시점* 에 한 번 봄 |

### 3.3 *information density per token* 기준

긴 SKILL.md 가 정당화되려면 *모든 줄* 이 다음 중 하나여야 한다:
1. **불변식 (invariant)** — 위반 시 시스템이 깨지는 규칙
2. **프로젝트 고유 컨벤션** — 모델 native 와 겹치지 않는
3. **trade-off matrix** — 모델이 직관으로 못 풀 결정 기준
4. **gotcha** — 실제 관측된 실패 사례 + 해결

다음에 해당하면 *제거 또는 references 로 이동*:
- 모델이 안다고 합리적으로 가정 가능한 일반 설명
- "왜 중요한지" 의 prose (대신 1줄 reason 만)
- 단순 example 의 반복 (1–2개로 충분)

근거: [`agent-skills-best-practices.md` §Concise is key](../raw/anthropic/agent-skills-best-practices.md) — `"Challenge each piece of information: Does Claude really need this explanation? Can I assume Claude knows this? Does this paragraph justify its token cost?"`

### 3.4 SKILL.md 구조 권장 (hybrid)

```markdown
---
name: <gerund-form>           # processing-pdfs, managing-databases
description: <P1-P5 따른 작성>
---

# <Name> — <subtitle>

## When to invoke           # 명확한 trigger 명시 (description 보완)

## Invariants               # 깨면 안 되는 규칙 (있다면)

## Quick start              # 가장 흔한 use case 50토큰 압축

## Workflow                 # 단계별 (필요시 checklist)
1. ...
2. ...

## Common patterns          # 2–3개 (more → references/)

## Known gotchas            # 관측된 실패 사례

## References               # 1 hop deep links
- [REFERENCE.md](REFERENCE.md) — API 상세
- [scripts/validate.py](scripts/validate.py) — bash 실행
```

이 구조는 Anthropic best-practices 의 "skill structure" 와 backend-ts 의 12단계를 절충한 것.

---

## 4. Progressive Disclosure — references 와 scripts

### 4.1 무엇을 references 로 빼나

```text
my-skill/
├── SKILL.md              # Quick start, workflow, invariants
├── REFERENCE.md          # 상세 API, 모든 함수, edge case 카탈로그
├── EXAMPLES.md           # input/output 쌍 다수
└── scripts/
    └── validate.py       # 결정론적 실행, code 가 context 에 안 들어감
```

기준:
- **SKILL.md 에**: "매번 invoke 시 봐야 하는" 내용
- **references/ 에**: "특정 sub-task 일 때만" 보는 내용
- **scripts/ 에**: 결정론적 실행. **code 자체는 context 에 절대 들어가지 않음** — 출력만 사용됨. ([overview §Level 3](../raw/anthropic/agent-skills-overview.md))

### 4.2 *1 hop deep* 제약

[`agent-skills-best-practices.md` §Avoid deeply nested references](../raw/anthropic/agent-skills-best-practices.md):

> *"Claude may partially read files when they're referenced from other referenced files. When encountering nested references, Claude might use commands like `head -100` to preview content rather than reading entire files."*
> 
> *"Keep references one level deep from SKILL.md. All reference files should link directly from SKILL.md."*

→ `SKILL.md → A.md → B.md` 의 chain 은 깨진다. 모든 reference 는 SKILL.md 에서 직접 link.

### 4.3 References file 의 ToC 패턴

100줄 넘는 reference 파일은 상단에 ToC. 이유: 모델이 `head -N` 으로 preview 할 수 있어서 전체 scope 가 안 보일 위험.

```markdown
# REFERENCE.md

## Table of contents
- [Section A](#section-a) — ...
- [Section B](#section-b) — ...
...
```

---

## 5. Skill Content Lifecycle — 가장 자주 무시되는 사실

[`claude-code-skills.md` §Skill content lifecycle](../raw/anthropic/claude-code-skills.md):

> *"When you or Claude invoke a skill, the rendered SKILL.md content enters the conversation as a single message and stays there for the rest of the session. Claude Code does not re-read the skill file on later turns."*
>
> *"Auto-compaction carries invoked skills forward within a token budget. Claude Code re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each. Re-attached skills share a combined budget of 25,000 tokens."*
>
> *"If a skill seems to stop influencing behavior after the first response, the content is usually still present and the model is choosing other tools or approaches. Strengthen the skill's description and instructions, or use hooks to enforce behavior deterministically."*

### 5.1 함의 4가지

1. **Skill 안에 동적 절차 금지** — "매번 git status 를 확인하라" 같은 절차는 첫 invoke 의 git status 가 그대로 남음. *동적 사실은 hook 의 additionalContext 로*
2. **첫 5000 token 이 중요** — compaction 후 첫 5000 만 보존. *결정적 내용을 위에 둬라*
3. **자주 invoke 되는 skill 이 살아남음** — 25k 공유 budget 에서 most recent 부터 채움. 가끔 쓰는 skill 은 compaction 후 사라짐
4. **Skill 이 안 먹힌다면 description 강화 또는 hook 으로 결정론적 강제** — content 가 남아있어도 모델이 무시할 수 있음

### 5.2 안티 패턴: "skill 안에 매번 새로 실행해야 하는 절차"

```yaml
# 안티 패턴
---
name: env-checker
description: Checks current environment and warns about issues
---

## Workflow

Run these commands and verify:
!`git status`         # ← 첫 invoke 의 결과가 영원히 남음
!`npm list outdated`  # ← 같음
```

→ 이 skill 은 *처음 한 번* 만 정확하다. 이후 turn 에서는 stale.

**올바른 방식**: 
- Hook 의 SessionStart 또는 UserPromptSubmit 에 `additionalContext` 로 매번 inject
- 또는 skill 안에 *"실행할 명령"* 만 적어두고 *"실행은 모델이 매 turn 직접"*

---

## 6. 권한 사전승인 — `allowed-tools`

```yaml
---
name: commit
description: Stage and commit the current changes
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *)
---
```

### 6.1 함정: pre-approval ≠ sandboxing

community §Autonomy Calibration Pattern 의 핵심 경고:

> *"This reduces approval friction but doesn't by itself restrict available tools. In Claude Code, actual restrictions come from permission rules, not from `allowed-tools` alone."*

→ `allowed-tools` 는 *"이 도구는 묻지 말고 허용해라"* 이지 *"이 도구만 쓸 수 있다"* 가 아님. 실제 제한은 `/permissions` 의 deny rules 로.

### 6.2 권장 패턴

| 시나리오 | allowed-tools 권장 |
|---|---|
| Read-only 분석 skill | `Read Grep Glob` |
| 문서 생성 skill | `Read Write Glob` |
| 배포 skill (`disable-model-invocation: true`) | `Bash(deploy *)` 등 narrow matcher |
| Subagent fork 시 | 별도 `tools` 필드로 더 엄격 |

---

## 7. Skill 의 자주 묻는 분기

### 7.1 `disable-model-invocation: true` vs `user-invocable: false`

| Frontmatter | 사용자 가능 | Claude 자동 invoke | 언제 |
|---|---|---|---|
| (default) | Yes | Yes | 가장 흔함. 양쪽 모두 |
| `disable-model-invocation: true` | Yes | **No** | 부작용 있는 명령 (`/commit`, `/deploy`) |
| `user-invocable: false` | **No** | Yes | background knowledge (사용자가 `/` 메뉴에서 보면 안 되는) |

근거: [`claude-code-skills.md` §Control who invokes a skill](../raw/anthropic/claude-code-skills.md)

### 7.2 `context: fork` (subagent 안에서 skill 실행)

```yaml
---
name: deep-research
description: Research a topic thoroughly
context: fork
agent: Explore
---
```

→ skill 이 새 subagent context 에서 실행. main 컨텍스트 안 더러움. *단, skill 이 explicit instructions 일 때만 의미 있음* — guideline 만 있는 skill 을 fork 하면 prompt 없는 subagent 가 됨.

### 7.3 `skills:` 필드 (subagent 에 skill 미리 로드)

```yaml
# subagent definition
---
name: api-developer
description: Implement API endpoints
skills:
  - api-conventions
  - error-handling-patterns
---
```

→ subagent 시작 시 **skill content 전체가 inject**. 단순 description 이 아니라. context: fork 의 반대.

---

## 8. Skill 작성 체크리스트 (요약)

### Core
- [ ] Description: 3인칭, 동사 시작, 키워드 dense, exclusion clause
- [ ] Description 1536 chars 이내 (Claude Code cap)
- [ ] Name: 케밥 케이스, gerund form 권장 (`processing-pdfs`)

### Structure
- [ ] SKILL.md < 500 lines (Anthropic 공식) 또는 *모든 줄 정당화* (긴 skill)
- [ ] references 는 1 hop deep
- [ ] 100줄+ references 에 ToC
- [ ] scripts/ 의 code 는 free (context 안 들어감)

### Content
- [ ] *동적 매번-실행* 절차 금지 (skill content lifecycle 위배)
- [ ] 첫 5000 token 에 결정적 내용
- [ ] Consistent terminology (한 가지 단어로)
- [ ] No time-sensitive ("after Aug 2025" 류)
- [ ] All-caps imperative 대신 "rule + 왜" (Explain-the-Why)

### Tooling
- [ ] `allowed-tools` 는 사전승인일 뿐, 실제 제한은 permission rules
- [ ] `disable-model-invocation: true` 는 부작용 있는 명령에
- [ ] `context: fork` 는 explicit instructions 가 있을 때만

### Evaluation
- [ ] **Skill 만들기 전에** baseline 측정 (실패율 ≥ 20% 인가?)
- [ ] 3개 evaluation scenario 작성
- [ ] Haiku / Sonnet / Opus 에서 모두 테스트
- [ ] Skill 효능 정량 측정 (skill 없을 때 vs 있을 때)

---

## 9. hibye-plugins 적용 — backend-ts 패턴 평가

backend-ts 의 12-section pattern 은 *길이 면에서* Anthropic 공식 권장 (< 500) 을 넘는다. 이게 정당화되는 조건:

| 조건 | 만족 여부 (audit 필요) |
|---|---|
| 모든 section 이 모델 native 와 겹치지 않는 정보 | ⚠️ audit 필요 (특히 "algorithm" section) |
| invariant 위반이 시스템을 깨는 종류 | ✅ database, single-writer 등은 명확히 fit |
| trade-off matrix 가 모델 직관으로 못 풀 결정 | ✅ provider-retry-matrix, run-policy-presets 등 fit |
| 모델이 *결정 시점*에 한 번만 봄 (작업 중 lookup 아님) | ✅ workflow 타입은 fit, validate 타입은 더 짧을 수 있음 |

**구체 권장**:
- **invariant 타입 skill** (architecture-invariants, agent-loop-invariants 등): 길이 유지 OK
- **workflow 타입 skill** (new-agent, new-run 등): 길이 유지 OK, references 추가 검토
- **validate 타입 skill**: 이미 짧음, OK
- **codebase audit skill** (full-architecture-audit 등): 길이 정당 — 다만 동적 절차 (`!\`git log\``) 가 있다면 hook 으로 이전 검토

상세: [`05-anti-patterns.md`](05-anti-patterns.md) §"long skill 의 정당화 조건"
