# 04 — Hooks Deep Dive

> **결정론적 자동화의 강제력, 그리고 모델이 못 풀 영역**
> 
> 본 문서는 hook 의 *언제 적합한가*와 작성 원리를 다룬다. "skill 대신 hook" 의 분기는 [`01-build-vs-trust-framework.md`](01-build-vs-trust-framework.md) §4 참조.

---

## 0. 한 줄 요약

> **Hook 은 lifecycle event 에 묶이는 결정론적 부수효과 (block / inject / log). 학습성은 0 — 모델은 *왜* 막혔는지 모름. "맥락에 따라 다른 판단" 이 필요한 작업은 hook 부적합. 매번 새로 평가하는 정적 fact (e.g., git status, env) 의 inject 가 hook 의 최강점.**

---

## 1. Hook 의 본질 — 4가지 사실

[`claude-code-hooks.md` §Overview](../raw/anthropic/claude-code-hooks.md):

> *"Hooks are user-defined shell commands, HTTP endpoints, or LLM prompts that execute automatically at specific points in Claude Code's lifecycle. They enable workflow automation, security enforcement, permission management, and environment integration."*

| 본질 | 의미 |
|---|---|
| **자동 실행** | 사용자나 모델이 호출 안 함. 이벤트 발생 시 시스템이 trigger |
| **결정론적 동작 (보통)** | shell/HTTP/MCP 호출 결과로 동작. (단 `type: prompt` 와 `type: agent` 는 LLM 사용 — 결정론적 아님) |
| **3가지 lifecycle cadence** | (1) once per session, (2) once per turn, (3) per tool call |
| **inject / block / log** | additionalContext 로 정보 주입 / permissionDecision 으로 차단 / 단순 부수효과 |

---

## 2. 13가지 Hook Event — 적합한 사용처

[`claude-code-hooks.md` §Hook Lifecycle](../raw/anthropic/claude-code-hooks.md):

### 2.1 Once per session
| Event | 적합한 사용처 | 안 좋은 사용처 |
|---|---|---|
| `SessionStart` | 초기 git status / branch / env / project context inject | 매번 변하는 정보 (UserPromptSubmit 사용) |
| `SessionEnd` | cleanup (임시 파일 삭제, 통계 저장) | blocking (cleanup 에서 block 불가) |
| `Setup` | `--init-only` 등 CI 셋업 | 매 세션 trigger 가 필요한 경우 |

### 2.2 Once per turn
| Event | 적합한 사용처 | 안 좋은 사용처 |
|---|---|---|
| `UserPromptSubmit` | 매 prompt 마다 fresh context inject (현재 git status, 시간 등) / 부적절 prompt 차단 | 무거운 작업 (default timeout 30s) |
| `Stop` / `StopFailure` | 작업 완료 알림 / 자동 continue 강제 | 매번 block 하면 무한 루프 |

### 2.3 Per tool call
| Event | 적합한 사용처 | 안 좋은 사용처 |
|---|---|---|
| `PreToolUse` | destructive 명령 차단 / input 수정 / pre-validation | 모든 도구 매번 — 성능 부담 |
| `PostToolUse` | 자동 lint / format / test 실행 / 결과 기반 next-step 차단 | 무거운 작업 (latency 누적) |
| `PermissionRequest` | 자동 approve/deny | 사용자 의도 무시 |
| `PostToolUseFailure` | 실패 대응 / fallback | 단순 logging 외엔 신중 |

### 2.4 Async events
| Event | 적합한 사용처 |
|---|---|
| `FileChanged` | watched paths 의 파일 변경 감지 (e.g., `.envrc` 변경 시 env reload) |
| `ConfigChange` | settings 변경 시 reload |
| `CwdChanged` | 디렉토리 변경 시 context 갱신 |
| `WorktreeCreate` / `WorktreeRemove` | worktree lifecycle 통합 |
| `InstructionsLoaded` | CLAUDE.md load 시 audit/compliance |

---

## 3. Hook Handler 5가지 타입

### 3.1 비교

| 타입 | 결정론적 | 비용 | 적합 |
|---|---|---|---|
| `command` | ✅ | shell process spawn | 가장 흔함. 빠른 검증 / log / inject |
| `http` | ✅ | HTTP round-trip | 외부 시스템 연동 (CI, audit, observability) |
| `mcp_tool` | ✅ | MCP server 호출 | 다른 MCP server 기능 재사용 |
| `prompt` | ❌ (LLM) | LLM 호출 비용 + latency | judgment 필요한 검증 ("이 명령이 안전한가?") |
| `agent` (experimental) | ❌ | subagent spawn | 복잡한 검증 (security-reviewer 등) |

### 3.2 `command` hook 의 두 형태

**Exec form** (args 명시):
```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/script.js", "--fix"]
}
```
- shell 없이 직접 spawn. 특수문자 안전. 권장.

**Shell form** (args 생략):
```json
{
  "type": "command",
  "command": "git diff --name-only | grep '\\.ts$' | xargs eslint"
}
```
- pipe / glob / variable expansion 지원. 공백 quoting 주의.

---

## 4. Hook 출력 — 무엇으로 모델에 영향 주는가

### 4.1 Exit code

| Exit | 의미 |
|---|---|
| 0 | 성공. stdout 의 JSON 파싱 시도. JSON 없으면 no decision |
| 2 | **Blocking error**. stderr 가 Claude 에 feedback. 동작 차단 |
| 기타 non-zero | non-blocking error. stderr 첫 줄만 transcript |

### 4.2 JSON output (Exit 0 + stdout)

```json
{
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "Warning text for user",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Information for Claude",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Not allowed"
  }
}
```

### 4.3 핵심 출력 필드

| 필드 | 효과 |
|---|---|
| `additionalContext` | facts 를 system reminder 로 inject. **명령 아님** — prompt injection 위험 회피 |
| `permissionDecision` | `allow` / `deny` / `ask` / `defer` |
| `updatedInput` | tool input 수정 (e.g., command 안전 버전으로) |
| `continue: false` | 세션 중단 |
| `decision: "block"` (Stop/PostToolUse) | 차단 + reason 으로 모델에 feedback |

### 4.4 함정: additionalContext 는 fact 만

[`claude-code-hooks.md` §Best Practices](../raw/anthropic/claude-code-hooks.md):

> *"Use `additionalContext` for **facts**: Not system commands; avoid prompt injection"*

→ "Run npm test" 같은 *명령* 을 inject 하면 prompt injection 취약점. *사실* (현재 branch, 변경 파일 수 등) 만 inject.

---

## 5. Hook 의 4가지 핵심 use case

### 5.1 ✅ Context Injection (SessionStart / UserPromptSubmit)

```bash
#!/bin/bash
# SessionStart hook — inject current branch + uncommitted file count
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
CHANGES=$(git diff --name-only 2>/dev/null | wc -l)
jq -n --arg branch "$BRANCH" --arg changes "$CHANGES" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: "Current branch: \($branch)\nUncommitted files: \($changes)"
  }
}'
```

→ skill 안에 "git status 를 확인하라" 적는 것보다 결정론적 + 매 세션 새로.

**Skill 대비 우위**:
- 매번 새로 (skill content lifecycle 의 stale 문제 회피)
- 결정론적 (모델이 잊을 일 없음)
- 비용 작음 (5초 이내 권장)

### 5.2 ✅ Destructive 차단 (PreToolUse)

```bash
#!/bin/bash
COMMAND=$(jq -r '.tool_input.command')
if echo "$COMMAND" | grep -q 'rm -rf'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Destructive rm -rf blocked. Use safer alternatives."
    }
  }'
else
  exit 0
fi
```

→ skill 안에 "rm -rf 금지" 적어도 모델이 잊을 수 있음. Hook 은 잊을 수 없음.

### 5.3 ✅ 자동 lint / format (PostToolUse)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "npm run lint:fix --silent", "timeout": 30 }
        ]
      }
    ]
  }
}
```

→ "매번 lint 돌려라" 가 skill 에 있으면 모델이 잊음. Hook 은 강제.

### 5.4 ✅ Read-only DB enforcement (Subagent + Hook hybrid)

```yaml
# Subagent definition with embedded hook
---
name: db-reader
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

→ Subagent 가 system prompt 로 "SELECT 만 써" 라고 해도 모델이 어길 수 있음. Hook 이 INSERT/UPDATE/DROP/... 차단.

---

## 6. Hook 으로 만들면 안 되는 것

### 6.1 ❌ 맥락에 따라 다른 판단

**예**: "PR 이 작으면 자동 approve, 크면 review 요청"

Hook 은 결정론적이라 *맥락 판단* 에 약함. `type: prompt` 로 LLM 호출은 가능하지만 — *그럴 거면 모델에 맡기는 게 일관성*.

### 6.2 ❌ 학습성이 필요한 영역

**예**: "팀의 commit message 컨벤션"

Hook 으로 commit 메시지 차단해도 모델은 *왜* 막혔는지 모름. 다음에도 같은 실수. → **Skill (학습성) + Hook (강제)** 의 hybrid.

### 6.3 ❌ 무거운 작업

UserPromptSubmit 의 기본 timeout 은 30초. 무거운 작업 (테스트 전체 실행 등) 은 PostToolUse 의 async hook 으로 빼야.

### 6.4 ❌ 사용자 의도 무시

PermissionRequest hook 으로 자동 deny 하면 사용자가 *왜 막혔는지* 모를 수 있음. `systemMessage` 로 명확한 이유 제공 필수.

---

## 7. Hook 위치 — 5가지 scope

[`claude-code-hooks.md` §Hook Locations](../raw/anthropic/claude-code-hooks.md):

| 위치 | scope | 공유 가능 |
|---|---|---|
| `~/.claude/settings.json` | 모든 프로젝트 | ❌ (개인) |
| `.claude/settings.json` | 프로젝트 단일 | ✅ (git commit) |
| `.claude/settings.local.json` | 프로젝트 단일, gitignored | ❌ |
| Plugin `hooks/hooks.json` | plugin 활성 시 | ✅ (plugin 배포) |
| Skill / Agent frontmatter | component 활성 시 | ✅ |

**hibye-plugins 권장**:
- *공통 보안* (rm -rf 차단 등): user 또는 enterprise settings
- *프로젝트 lint*: project `.claude/settings.json`
- *플러그인별 자동화*: plugin `hooks/hooks.json` (현재 backend-ts 가 이 방식)
- *skill/subagent 의 conditional rule*: frontmatter 에 embed (db-reader 사례)

---

## 8. Skill / Subagent / Hook 의 3축 조합

### 8.1 같은 목표 — 3가지 강제력

목표: "신규 API endpoint 추가 시 zod 검증 강제"

| 도구 | 강제력 | 학습성 | 함의 |
|---|---|---|---|
| Skill 만 | 약함 (모델이 무시 가능) | 강함 (왜 인지 학습) | 컨벤션 *가르치기* |
| Subagent 만 | 중간 (system prompt 가 강제) | 중간 (subagent 안에서만) | *격리된 작업* 단위 |
| Hook 만 | 강함 (결정론적 차단) | 0 (왜 막혔는지 모름) | *어기면 깨지는* 규칙 |
| **Skill + Hook (권장)** | **강함** | **강함** | 학습성 + 강제력 |

### 8.2 hybrid 패턴 권장 — "왜" 는 Skill, "강제" 는 Hook

```markdown
# SKILL.md (api-conventions)
## Why we use zod

zod schemas catch invalid input at the boundary, before it reaches business logic.
Without zod, we've had production incidents where malformed JSON crashed the worker.

## Pattern

Every API endpoint must validate `req.body` with a zod schema before processing.

**The PostToolUse hook `validate-api-schema.sh` will block writes if zod is missing — 
this section explains the why.**
```

```json
// .claude/settings.json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "if": "Edit(src/api/*.ts)",
        "hooks": [{ "type": "command", "command": "./scripts/validate-api-schema.sh" }]
      }
    ]
  }
}
```

→ Skill 의 *왜* + Hook 의 *강제*. 모델은 hook 으로 막히면 skill 의 이유를 참조 가능.

---

## 9. Hook 작성 체크리스트

### 핵심
- [ ] Lifecycle event 선택 적절 (per-session / per-turn / per-tool)
- [ ] timeout 적절 (UserPromptSubmit 30s, 나머지 600s 기본)
- [ ] Exit 0 + stdout JSON 또는 Exit 2 명확히 사용
- [ ] `additionalContext` 는 *facts only* (prompt injection 회피)
- [ ] Hook 결과로 모델이 *왜* 막혔는지 알 수 있게 `permissionDecisionReason` 명확

### 성능
- [ ] SessionStart / UserPromptSubmit 은 빠르게 (5초 이내 권장)
- [ ] PreToolUse 매처를 narrow 하게 (`Bash` 만, `Edit|Write` 만 등)
- [ ] `if` 필드로 도구 인자까지 필터 (매처보다 효율적)
- [ ] 무거운 작업은 PostToolUse `async: true` 로

### 보안
- [ ] `allowedEnvVars` 명시 (HTTP hook)
- [ ] `${CLAUDE_PLUGIN_ROOT}` 등 path placeholder 사용
- [ ] Exec form (args) 권장 (특수문자 안전)
- [ ] Profile startup 출력이 stdout 더럽히지 않게 `> /dev/null`

### 디자인
- [ ] hook 으로 *강제* + skill 으로 *학습성* hybrid 검토
- [ ] *맥락 판단* 필요한 영역엔 hook 부적합 — 모델에 맡길지 검토
- [ ] 결정론적 영역 (보안, lint, env inject) 에 집중

---

## 10. hibye-plugins 적용 — 현재 hook 자산 평가

현재 backend-ts 의 `hooks/hooks.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/hooks.schema.json",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start-profiler.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

평가:
- ✅ SessionStart 에 profiler → context injection. **모범 사례**
- ✅ timeout 5초 (best practice 부합)
- ✅ `${CLAUDE_PLUGIN_ROOT}` path placeholder 사용
- 검토 사항:
  - 새 hook 추가 시 PostToolUse 로 lint 자동화 검토
  - skill 의 audit 절차 (`audit-all.sh` 등) 를 hook 으로 옮길 수 있는 부분 있는지

### 권장 신규 hook

| 목표 | Hook event | 핵심 효과 |
|---|---|---|
| Destructive bash 차단 | PreToolUse on Bash | rm -rf / drop database 등 차단 |
| Audit pattern violation 즉시 차단 | PostToolUse on Edit\|Write | forbidden pattern (e.g., direct DB write outside StoragePort) 차단 |
| 매 turn 에 현재 branch + 변경 파일 수 inject | UserPromptSubmit | 매번 fresh context |

상세 결정 트리는 [`01-build-vs-trust-framework.md`](01-build-vs-trust-framework.md) §3 의 Q6/Q7 참조.

---

## 11. 다음 읽기

- [`05-anti-patterns.md`](05-anti-patterns.md) — 만들면 안 되는 사례 카탈로그 (hook 오용 포함)
- [`../synthesis-report.md`](../synthesis-report.md) — 종합 결론 및 hibye-plugins 적용 권고
