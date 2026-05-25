# 05 — Anti-Patterns 카탈로그

> **흔한 실수의 카탈로그.** 각 패턴은 한 단락 정의 + 왜 잘못됐는지 + 출처 + 올바른 대안.
> 
> 이 문서는 audit 시 체크리스트로 활용할 수 있다.

---

## 0. 분류

10개 안티 패턴을 4범주로 분류:

| 범주 | 개수 |
|---|---|
| **Build vs Trust 위반** | 3 |
| **Skill 작성 결함** | 4 |
| **Subagent 오용** | 2 |
| **Hook 오용** | 1 |

---

## 1. Build vs Trust 위반 ❌

### AP-01. 모델 native 와 겹치는 skill

> **증상**: "How to write SQL queries", "React useState patterns", "git commit message format (Conventional Commits)" 같은 일반 지식을 skill 로.

**왜 잘못**:
- description budget (~1% context) 잠식 → niche skill 의 발견율 저하
- 모델 버전 업그레이드 시 stale (모델은 진화, skill content 는 정적)
- false-trigger 위험 (모델 native 답이 더 좋을 때도 skill 우선)

**출처**: [`agent-skills-best-practices.md` §Core principles](../raw/anthropic/agent-skills-best-practices.md) — *"Default assumption: Claude is already very smart. Only add context Claude doesn't already have."*

**대안**: 
- 일반 지식은 모델에 맡기기 (TRUST)
- 프로젝트 *고유* 컨벤션만 skill 화 ("우리 회사 SQL sub-scope 규칙", "우리 commit message 의 ticket-id 형식" 등)

**MUST not** — Decision Tree Q1/Q2 위반은 강제 거부.

---

### AP-02. baseline 측정 없이 skill 작성

> **증상**: "skill 이 있으면 더 좋을 것 같아서" 추측으로 작성.

**왜 잘못**:
- 모델이 skill 없이도 잘 하는 영역에 만든 skill 은 *negative ROI* (context 잠식 + maintenance 부담 - 실제 효능 0)
- Anthropic 의 공식 절차는 "Build evaluations first"

**출처**: [`agent-skills-best-practices.md` §Build evaluations first](../raw/anthropic/agent-skills-best-practices.md) — *"Create evaluations BEFORE writing extensive documentation. This ensures your Skill solves real problems rather than documenting imagined ones."*

**대안**:
1. skill 없이 representative 작업 3개 실행
2. 구체적 실패 패턴 기록
3. baseline 성공률 측정
4. 실패율 ≥ 20% 일 때만 skill 작성
5. skill 작성 후 같은 evaluation 으로 재측정

**SHOULD**.

---

### AP-03. 시간 종속 정보 (time-sensitive)

> **증상**: `"If before August 2025, use old API. After, new API."`

**왜 잘못**:
- skill 은 정적, 시간은 흐름. 미래에 stale
- 모델은 *현재 시각* 을 항상 모름

**출처**: [`agent-skills-best-practices.md` §Avoid time-sensitive information](../raw/anthropic/agent-skills-best-practices.md)

**대안**: 
- 현재 권장만 본문에 적기
- legacy 는 `<details>` 또는 "Old patterns" 별도 섹션
- 또는 hook 의 `additionalContext` 로 매번 새로 결정

**SHOULD**.

---

## 2. Skill 작성 결함 ⚠️

### AP-04. Description 없거나 너무 짧음

> **증상**: `description: Helps with documents`, `description: SQL tool`

**왜 잘못**:
- model 의 trigger 판단 실패
- skill 이 invoke 되지 않으면 SKILL.md 내용은 무의미

**출처**: [`agent-skills-best-practices.md` §Writing effective descriptions](../raw/anthropic/agent-skills-best-practices.md), [`community-blog-skill-authoring-patterns.md` §Activation Metadata Pattern](../raw/community/community-blog-skill-authoring-patterns.md)

**대안**: 3인칭 + 동사 시작 + 키워드 + 트리거 명시 + exclusion clause

```yaml
description: Extracts text and tables from PDF files, fills forms, merges documents. 
             Use when working with PDF files or when the user mentions PDFs, forms, 
             or document extraction.
             Do NOT use for spreadsheet data (use xlsx) or Word documents (use docx).
```

**MUST**.

---

### AP-05. All-caps imperative 만 가득 (Explain-the-Why 위반)

> **증상**: 
> ```
> ALWAYS use zod.
> NEVER skip validation.
> MUST handle errors.
> ```

**왜 잘못**:
- 모델이 *letter* 따르고 *spirit* 놓침
- edge case 에서 over-apply 또는 under-apply
- 규칙 *왜* 가 없으면 새 상황에 일반화 불가

**출처**: [`community-blog-skill-authoring-patterns.md` §Explain-the-Why Pattern](../raw/community/community-blog-skill-authoring-patterns.md) — *"State the rule, then explain why, so Claude generalizes to unanticipated cases. 'Use constructor injection. Field injection breaks testability because we cannot mock the field without Spring context' beats 'MUST use constructor injection. NEVER use field injection.'"*

**대안**: 규칙 + 1줄 이유

```markdown
Use zod schemas at API boundaries. **Why:** malformed JSON has crashed our worker 
in 2024-Q4 — schema validation catches this at the edge instead of mid-flow.
```

**SHOULD** (frontend-react-web 의 skill 들은 이미 이 패턴 사용 중. backend-ts 의 일부 invariant skill 은 all-caps 사용 — audit 후보)

---

### AP-06. 동적 매번-실행 절차를 skill 안에

> **증상**: skill 안에 `"매번 git status 를 확인하라"`, `"현재 시각을 알려라"`, `!\`git diff HEAD\``

**왜 잘못**:
- Skill content 는 **첫 invoke 시 1회만 평가**, 이후 세션 끝까지 같은 내용으로 남음
- `!\`git diff\`` 의 출력이 첫 invoke 결과로 *영원히 stale*

**출처**: [`claude-code-skills.md` §Skill content lifecycle](../raw/anthropic/claude-code-skills.md) — *"When you or Claude invoke a skill, the rendered SKILL.md content enters the conversation as a single message and stays there for the rest of the session. Claude Code does not re-read the skill file on later turns."*

**대안**:
- 매 turn 새로 필요한 facts → **Hook (UserPromptSubmit) 의 additionalContext** 로 inject
- skill 안에는 *명령만* 적고, *실행은 모델이 매 turn* 직접

**MUST** (이게 가장 미묘하지만 가장 자주 어김)

---

### AP-07. References 의 nested chain (1 hop 초과)

> **증상**: `SKILL.md → A.md → B.md → C.md`

**왜 잘못**:
- 모델은 nested 파일을 `head -N` 으로 partial read 함
- 깊이 갈수록 정보 누락 위험

**출처**: [`agent-skills-best-practices.md` §Avoid deeply nested references](../raw/anthropic/agent-skills-best-practices.md) — *"Keep references one level deep from SKILL.md. All reference files should link directly from SKILL.md."*

**대안**: 모든 reference 는 SKILL.md 에서 직접 link. references/ 내에서 cross-link 자제.

**SHOULD**.

---

## 3. Subagent 오용 ⚠️

### AP-08. Terse command brief — "fix the bug"

> **증상**: subagent 에 한 줄 prompt 만 던지기.

**왜 잘못**:
- subagent 는 cold context (main 대화 안 봄, 이미 알아낸 것 모름)
- 추측 → 잘못된 방향
- 결과의 신뢰성 낮음

**출처**: Claude Code Agent tool description — *"Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried, doesn't understand why this task matters."*

**대안**: 4요소 brief
1. 목표 (왜 이 작업인가)
2. 이미 알아낸 것 (중복 방지)
3. 제외 항목 (안 해도 되는 것)
4. 출력 형식 (길이 cap, 구조)

```text
# Bad
"Find the bug in auth module"

# Good
"Trace why login fails for users with 2FA enabled.
 Context: error at auth-service.ts:142 'Cannot read property of undefined'.
 I suspect token decoding; want independent verification.
 Already ruled out: token expiry (line 130).
 Report: root cause + minimal fix. Under 300 words."
```

**MUST** for non-trivial subagent invocations.

---

### AP-09. "Based on findings, fix it" — 판단을 subagent 에 위임

> **증상**: subagent 에 *연구* + *판단* + *실행* 을 한꺼번에 위임.

**왜 잘못**:
- subagent 는 cold context — main 의 더 깊은 맥락 모름
- 판단을 위임하면 main 의 시야가 좁아짐
- 잘못된 판단을 detect 할 기회 없음 (subagent 가 implement 했으니)

**출처**: Claude Code Agent tool description — *"Never delegate understanding. Don't write 'based on your findings, fix the bug' or 'based on the research, implement it.' Those phrases push synthesis onto the agent instead of doing it yourself."*

**대안**: 
- subagent 는 *수행* / *수집* 에 좋음
- subagent 가 *raw data* 를 returning → **main 이 판단** → main 이 fix 지시

**SHOULD**.

---

## 4. Hook 오용 ⚠️

### AP-10. 맥락 판단이 필요한 영역에 hook

> **증상**: "PR 이 작으면 auto-approve, 크면 review 요청" 을 결정론적 hook 으로.

**왜 잘못**:
- hook 은 결정론적 (또는 `type: prompt` 사용 시 LLM 호출 — 비용 + latency + non-deterministic)
- *맥락 판단* 영역은 모델이 다루는 게 일관성
- hook 으로 막히면 모델은 *왜* 막혔는지 학습 못함 (학습성 0)

**출처**: [`claude-code-hooks.md` §Best Practices](../raw/anthropic/claude-code-hooks.md) + [`01-build-vs-trust-framework.md`](01-build-vs-trust-framework.md) §4.1

**대안**:
- 결정론적 영역 (rm -rf 차단, lint, env inject) 에 hook 집중
- 맥락 판단은 main agent + skill (학습성)
- *강제* 가 필요하면 Hook (강제) + Skill (왜 인지 학습) hybrid

**SHOULD**.

---

## 5. Audit 체크리스트 (요약)

audit 시 다음 항목을 각 skill/subagent/hook 에 적용:

### Skills
- [ ] (AP-01) 모델 native 와 겹치지 않는가
- [ ] (AP-02) baseline 측정으로 정당화되는가
- [ ] (AP-03) time-sensitive 표현 없는가
- [ ] (AP-04) description 이 3인칭 + 동사 + 키워드 + exclusion 포함하는가
- [ ] (AP-05) all-caps imperative 대신 "rule + 왜" 패턴 사용하는가
- [ ] (AP-06) 동적 매번-실행 절차 없는가 (hook 으로 옮겨야 할 거 없는가)
- [ ] (AP-07) references 가 1 hop deep 인가

### Subagents
- [ ] (AP-08) description 이 cold agent 에게 충분한 brief 가이드를 주는가
- [ ] (AP-09) 판단까지 위임하는 instruction 이 없는가
- [ ] 자작 정당한가 (built-in Explore/Plan 으로 충분한지 확인)
- [ ] `tools` allowlist 가 최소 권한인가

### Hooks
- [ ] (AP-10) 맥락 판단 영역에 hook 안 쓰는가
- [ ] timeout 적절 (SessionStart < 5s, UserPromptSubmit < 30s)
- [ ] `additionalContext` 는 facts only (명령 아님)
- [ ] Exec form (args) 사용하는가 (특수문자 안전)
- [ ] `${CLAUDE_PLUGIN_ROOT}` 등 path placeholder 사용하는가

---

## 6. hibye-plugins 적용 시 우선순위

audit 시 다음 순서:

1. **AP-06 우선** — *동적 매번-실행 절차가 skill 안에 있는지*. skill content lifecycle 이슈로 잠재 가장 큰 영향.
2. **AP-01** — *모델 native 겹침*. description budget 회복 효과.
3. **AP-04** — *description 부실*. 가장 발견되어야 할 skill 이 trigger 안 되는 손실.
4. **AP-05** — *all-caps 패턴*. 모델이 edge case 에 약함.
5. 나머지는 발견 시 fix.

상세 dry-run 사례: [`../synthesis-report.md`](../synthesis-report.md) §6 참조.
