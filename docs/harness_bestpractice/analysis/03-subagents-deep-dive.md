# 03 — Subagents Deep Dive

> **컨텍스트 격리의 비용과 이득, 그리고 언제 분리할 가치가 있는가**
> 
> 본 문서는 subagent 의 *분리 결정*과 작성 원리를 다룬다. "skill 대신 subagent" 의 분기는 [`01-build-vs-trust-framework.md`](01-build-vs-trust-framework.md) §4 참조.

---

## 0. 한 줄 요약

> **Subagent 는 "결과만 main context 에 남는 격리 실행". cold-start brief 비용을 정당화하려면 ① 출력이 verbose (모델이 main context 에 남기면 안 되는) ② 권한 격리 필요 ③ 병렬 실행 — 셋 중 하나여야 한다. 그 외엔 skill 또는 main context.**

---

## 1. Subagent 의 4가지 본질 (공식 문서가 명시)

[`claude-code-subagents.md` §개요](../raw/anthropic/claude-code-subagents.md):

> *"Use one when a side task would flood your main conversation with search results, logs, or file contents you won't reference again: the subagent does that work in its own context and returns only the summary."*

핵심 4축:

| 본질 | 의미 |
|---|---|
| **Fresh context** | 각 spawn 은 새 컨텍스트. main 의 history 안 봄. CLAUDE.md / git status 만 inherit (Explore/Plan 은 그것도 skip) |
| **Custom system prompt** | subagent definition 의 markdown body 가 system prompt 자체 (Claude Code 기본 system prompt 안 들어감) |
| **Tool restrictions** | `tools` allowlist + `disallowedTools` denylist + `permissionMode` |
| **Result-only return** | 작업 결과만 main 으로 옴. 중간 과정 (검색 결과, 파일 내용) 은 격리 |

---

## 2. 언제 분리할 가치가 있는가 — 3가지 정당화

### 2.1 ✅ Verbose output 격리

```
사례: "테스트 전체 실행 후 실패만 보고"
- main 직접 실행: 수천 줄 테스트 출력이 context 에 누적
- subagent 위임: 실패한 5개 테스트의 error message 만 returning
```

기준: 작업이 *5+ tool call* 또는 *50+ 파일 읽기* 또는 *수천 줄 출력* 생산 → subagent

### 2.2 ✅ 권한 격리

```yaml
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

→ Bash 만 허용 + write 명령 차단 hook. main agent 가 같은 작업을 하면 full 권한.

### 2.3 ✅ 병렬 실행

```
사례: "auth / database / api 모듈을 동시에 리서치"
- 3개 subagent 병렬 spawn (한 메시지에 3개 Agent tool call)
- 각자 fresh context, 각자 결과만 returning
```

근거: subagents-doc §"Run parallel research" + general background-task 패턴

### 2.4 ❌ 분리하지 말아야 할 경우

| 시나리오 | 왜 안 좋은가 |
|---|---|
| 짧은 작업 (< 3 tool call) | cold-start brief 비용이 작업 비용을 초과 |
| frequent back-and-forth 필요 | subagent 는 *한 번* 의 prompt 만 받음. mid-task 통신 불가 (SendMessage 는 experimental) |
| main context 에 결과가 남아야 함 | summary 만 returning 됨. detail 다시 봐야 하면 다시 spawn |
| latency 민감 | subagent spawn 자체에 시간 소요 |

근거: [`claude-code-subagents.md` §Choose between subagents and main conversation](../raw/anthropic/claude-code-subagents.md)

---

## 3. Cold-start Brief — Subagent 효능의 80%

### 3.1 Brief 의 필수 요소

Subagent 는 *콜드*. 다음을 prompt 에 명시해야:

1. **목표** — 왜 이 작업을 하는가 (judgment call 가능하게)
2. **이미 알아낸 것** — 중복 작업 방지
3. **제외 항목** — 안 해도 되는 것
4. **출력 형식** — 길이 cap, 구조

근정 근거: Claude Code 자체의 Agent tool 설명 — *"Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation"*

### 3.2 안티 패턴: terse command

```text
# Bad
"Find the bug in the auth module"

# Good
"Trace why login fails for users with 2FA enabled. 
Context: error appears in auth-service.ts:142 'Cannot read property of undefined'. 
I suspect token decoding but want independent verification. 
Already ruled out: token expiry (verified at line 130). 
Report: root cause + minimal fix. Under 300 words."
```

### 3.3 "Don't delegate understanding"

> *"Never delegate understanding. Don't write 'based on your findings, fix the bug' or 'based on the research, implement it.' Those phrases push synthesis onto the agent instead of doing it yourself."*
> 
> — Claude Code Agent tool 설명

→ subagent 는 *수행* 에 좋고 *판단* 에 안 좋다. 판단은 main 이 raw data 받아서 직접.

---

## 4. Subagent 정의 — Frontmatter 핵심 필드

```yaml
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards.
...
```

### 4.1 자주 쓰는 필드

| 필드 | 권장 | 비고 |
|---|---|---|
| `name` | 케밥 케이스 | `code-reviewer`, `db-reader` |
| `description` | 3인칭 + *"Use proactively"* phrase | 자동 delegation trigger 강화 |
| `tools` | 최소 권한 allowlist | 생략 시 main 의 모든 도구 상속 |
| `model` | `inherit` (기본) 또는 `haiku` (저비용) | Explore 는 Haiku 기본 |
| `skills` | preload 할 skill 이름 | **full content inject**, description 아님 |
| `permissionMode` | 보통 default | `dontAsk` 등 자동화 |
| `memory` | `project` 또는 `user` | persistent memory 디렉토리 |
| `isolation: worktree` | code 변경 격리 시 | 임시 git worktree |
| `background: true` | 항상 백그라운드 | 자동 권한 deny 주의 |

근거: [`claude-code-subagents.md` §Supported frontmatter fields](../raw/anthropic/claude-code-subagents.md)

### 4.2 *"Use proactively"* 패턴

description 에 *"Use proactively"* / *"Use immediately after"* 같은 능동 표현을 넣으면 model 이 자동 delegate 할 가능성이 높아진다.

```yaml
# 강한 자동 trigger
description: Expert code review specialist. **Proactively** reviews code for quality, security, and maintainability. **Use immediately after** writing or modifying code.

# 약한 자동 trigger
description: Reviews code for quality
```

---

## 5. Skill ↔ Subagent 의 두 가지 결합 방식

### 5.1 Skill `context: fork` — skill 안에서 subagent spawn

```yaml
---
name: deep-research
context: fork
agent: Explore       # 어느 subagent 타입 쓸지
---

Research $ARGUMENTS thoroughly:
1. Find relevant files
2. Read and analyze
3. Summarize
```

→ skill content 가 subagent prompt. main context 안 더러움. **explicit instructions 일 때만 의미 있음.**

### 5.2 Subagent `skills:` 필드 — subagent 시작 시 skill 미리 로드

```yaml
---
name: api-developer
description: Implement API endpoints following team conventions
skills:
  - api-conventions
  - error-handling-patterns
---
```

→ subagent 가 시작될 때 두 skill 의 **full content** 가 context 에 inject. description 만 보지 않음.

| 방식 | 누가 prompt 인가 | 누가 system prompt 인가 |
|---|---|---|
| `context: fork` | skill body | agent 타입 (Explore/Plan/general-purpose 등) 의 기본 |
| subagent `skills` | 사용자 delegation 메시지 | subagent definition 의 markdown body + preloaded skill content |

근거: [`claude-code-skills.md` §Run skills in a subagent](../raw/anthropic/claude-code-skills.md), [`claude-code-subagents.md` §Preload skills](../raw/anthropic/claude-code-subagents.md)

---

## 6. Built-in subagent 활용 우선

자작 subagent 를 만들기 전에 built-in 으로 충분한지 검토:

| 자작 후보 | Built-in 대체 |
|---|---|
| "코드베이스 검색 agent" | **Explore** (Haiku, read-only, 빠름) |
| "plan mode 의 research agent" | **Plan** (read-only, auto-used in plan mode) |
| "복잡 multi-step 작업" | **general-purpose** (모든 도구) |
| "statusline 설정" | **statusline-setup** (Sonnet) |
| "Claude Code 질문" | **claude-code-guide** (Haiku) |

근거: [`claude-code-subagents.md` §Built-in subagents](../raw/anthropic/claude-code-subagents.md)

자작이 정당한 경우:
- 도메인 특화 system prompt 필요 (e.g., "senior security reviewer")
- 권한 매우 좁게 제한 필요 (e.g., `db-reader` 의 Bash 만 + write 차단 hook)
- 특정 skill 들을 항상 preload 하고 싶음

---

## 7. Context Management — 무엇이 inherit 되는가

각 subagent 가 spawn 될 때 받는 것 ([`claude-code-subagents.md` §What loads at startup](../raw/anthropic/claude-code-subagents.md)):

| 항목 | 일반 subagent | Explore / Plan |
|---|---|---|
| Subagent 자체 system prompt | ✅ | ✅ |
| Task message (delegation prompt) | ✅ | ✅ |
| CLAUDE.md (모든 레벨) | ✅ | ❌ (skip) |
| Git status snapshot | ✅ | ❌ (skip) |
| Preloaded skills (`skills:` 필드) | ✅ | ✅ |
| Main 의 conversation history | ❌ | ❌ |
| Main 이 이미 read 한 파일들 | ❌ | ❌ |
| Main 이 invoke 한 skill content | ❌ | ❌ |

→ **함의**: Explore/Plan 은 CLAUDE.md 안 봄. CLAUDE.md 의 규칙이 결과에 반영되려면 *prompt 에 명시* 해야.

### 7.1 Fork subagent (실험적)

```text
/fork draft unit tests for the parser changes so far
```

- 전체 conversation history 를 inherit
- 같은 system prompt, tools, model
- prompt cache 도 main 과 공유
- 단점: experimental, `CLAUDE_CODE_FORK_SUBAGENT=1` env var 필요

언제: named subagent 가 너무 많은 background brief 필요한 경우 / 같은 시작점에서 여러 접근 병렬 시도

---

## 8. Subagent 안티 패턴 5가지

| 안티 패턴 | 왜 | 대안 |
|---|---|---|
| terse command brief ("fix the bug") | 콜드 agent 가 추측 → 잘못된 방향 | 4-요소 brief (목표/이미아는것/제외/형식) |
| "based on findings, implement it" | 판단을 subagent 에 넘김 | raw data 받아 main 에서 판단 |
| 짧은 작업에 subagent 사용 | cold-start cost > 작업 cost | main context 직접 |
| frequent mid-task 통신 시도 | subagent 는 일방향 (SendMessage 는 experimental) | skill 또는 main 직접 |
| `tools` 생략하고 모든 권한 inherit | 권한 격리 효과 없음 | 최소 권한 allowlist |
| subagent 안에서 또 subagent spawn 시도 | **금지됨** (nested delegation 불가) | main 에서 chain |

근거: [`claude-code-subagents.md` §"Subagents cannot spawn other subagents"](../raw/anthropic/claude-code-subagents.md)

---

## 9. hibye-plugins 적용 — codex/codex-rescue 사례 평가

`.claude/agents/` 또는 plugin agents 의 사례:
- **plugin-dev:agent-creator** — agent 생성을 위한 specialized agent. ✅ 정당 (도메인 특화 system prompt + skill preload 가능)
- **codex:codex-rescue** — Codex 위임. ✅ 정당 (별도 런타임 = 권한 격리)
- **feature-dev:code-explorer / code-architect / code-reviewer** — 세 단계 분리. ✅ 정당하지만, 짧은 작업에선 main context 직접이 빠를 수 있음

권장 audit:
- 모든 자작 subagent 의 description 에 *"Use proactively"* phrase 가 있는가
- `tools` allowlist 가 최소 권한인가
- 각 subagent 의 system prompt body 가 *콜드 agent* 에게 충분한 context 를 주는가
- subagent 가 *짧은 작업* 에도 호출되는 패턴이 있다면 — 정말 정당한가?

---

## 10. 다음 읽기

- [`04-hooks-deep-dive.md`](04-hooks-deep-dive.md) — Hook 으로 결정론적 강제하기
- [`05-anti-patterns.md`](05-anti-patterns.md) — subagent 오용 사례 카탈로그
