---
name: update-config-runtime
description: ".codex/settings.json, .codex/hooks/**, .claude/settings.json, .claude/hooks/** 에 항목 추가·수정·검증 시 invoke. 6단계 검증 플로우 (dedup / command 구성 / pipe-test 시뮬레이션 / merge-not-replace / schema 검증 / 실제 발화 증명) 실행. 새 hook 이벤트 등록 (PreToolUse, PostToolUse, SessionStart, PreCompact, PostCompact 등) 또는 기존 hook 미발화 디버깅 시에도 invoke. config 파일에 side effect — 명시적 invocation 권장."
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/skills/update-config-harness/SKILL.md
---

scope 확장 = `.codex/` `.claude/` 까지 (apps/api 에 국한되지 않고 project 전체 runtime config 관리).

**적용된 §4.4 매트릭스 행**: Python hook script (`*.py`) → TypeScript/JS hook script (`*.ts` / `*.js` / `*.sh`), `python .codex/hooks/pre_write_guard.py` → `node .codex/hooks/pre_write_guard.js` 또는 `bash .codex/hooks/pre_write_guard.sh`, `jq` 기반 설정 검증 → 동일 (jq 는 runtime 무관), echo stdin 파이프 테스트 → 동일

# update-config-runtime — settings.json / hooks 관리 절차

## 이 skill은 언제 invoke 되는가

- `.codex/settings.json` 또는 `.claude/settings.json` 수정 전
- `.codex/hooks/**` 또는 `.claude/hooks/**` 새 hook 추가 또는 기존 수정 전
- 특정 hook 이벤트 등록 (PreToolUse, PostToolUse, SessionStart, PreCompact, PostCompact 등)
- "hook가 안 뜬다 / 엉뚱한 시점에 뜬다" 디버깅

**주의**: 이 skill은 settings.json 파일 자체를 수정한다. implicit invocation으로 자동 실행되면 의도치 않은 설정 변경이 일어날 수 있으니, 사용자가 명시적으로 "설정을 바꾸자" 또는 "훅을 추가하자"고 말한 맥락에서만 활성화한다.

## Runtime directory 선택

- Codex 작업이면 `RUNTIME_DIR=.codex`
- Claude Code 작업이면 `RUNTIME_DIR=.claude`
- 공용 hook script는 가능하면 동일 파일을 두 런타임에서 호출할 수 있게 작성한다.
- 설정 파일은 런타임별로 분리한다. `.codex/settings.json`과 `.claude/settings.json`을 동시에 고치는 경우도 각각 아래 6단계를 통과해야 한다.

## 10 primary hook events

사용자가 `$RUNTIME_DIR/settings.json`의 `hooks` 필드에 등록 가능한 lifecycle 지점:

| Event                 | 시점                     | 주 용도                             |
|-----------------------|--------------------------|-------------------------------------|
| `PreToolUse`          | tool 호출 직전           | 경로/명령 차단 (deterministic guard)|
| `PostToolUse`         | tool 호출 직후 (성공)    | 결과 후처리, 린트, 로그             |
| `PostToolUseFailure`  | tool 호출 직후 (실패)    | 실패 알림, 재시도 유도              |
| `PermissionRequest`   | 권한 요청 발생 시        | 자동 승인/거부 정책                 |
| `Notification`        | 런타임 알림 이벤트       | 외부 시스템 브릿지                  |
| `Stop`                | turn 종료                | 완료 검증, 체크리스트               |
| `PreCompact`          | 컨텍스트 컴팩션 직전     | 중요 정보 보존 주입                 |
| `PostCompact`         | 컴팩션 직후              | 컴팩션 결과 요약, 상태 복원         |
| `UserPromptSubmit`    | 사용자가 프롬프트 제출   | intent routing, 키워드 감지         |
| `SessionStart`        | 세션 시작                | Phase 상태 주입, 초기 경고          |

## Hook payload I/O 규약

### stdin (agent runtime → hook)

```json
{
  "session_id": "abc123",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "apps/api/src/engine/loop.ts",
    "content": "..."
  },
  "tool_response": null
}
```

`PreToolUse`는 `tool_response`가 null, `PostToolUse`는 tool 결과가 들어온다.

### stdout (hook → agent runtime)

**차단 (deny)**:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "reference/ is read-only"
  }
}
```

**허용 (allow)**:
- 무출력 + `exit 0` → silent allow
- 또는 JSON으로 `permissionDecision: "allow"` 명시 가능 (보통 silent가 간결)

**메시지 주입 (PostToolUse context)**:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "eslint: apps/api/src/engine/loop.ts:42 error no-explicit-any"
  }
}
```

**시스템 메시지 (사용자에게 표시)**:

```json
{
  "systemMessage": "TypeScript lint detected 3 issues",
  "continue": true
}
```

## 6단계 HOOK_VERIFICATION_FLOW

`$RUNTIME_DIR/settings.json` 또는 새 hook script를 등록할 때 반드시 아래 6단계를 거친다. 한 단계라도 건너뛰면 silent failure로 hook가 등록은 되지만 실제로 발화하지 않는 상태가 된다.

### Step 1 — Dedup check

```bash
RUNTIME_DIR=.codex  # or .claude
jq '.hooks' "$RUNTIME_DIR/settings.json"
```

추가하려는 이벤트 이름과 matcher가 이미 있는지 확인. 같은 matcher에 동일 command가 있으면 중복 등록 금지.

### Step 2 — Construct command for this project

등록할 command 문자열을 정확히 구성:

- hook script 실행 방법 (Node / bash / 직접 실행)
- hook script 경로 (repo root 기준 상대 경로 권장: `$RUNTIME_DIR/hooks/foo.js`)
- 필요 시 `timeout` 필드 (초)

```json
{
  "type": "command",
  "command": "node .codex/hooks/pre_write_guard.js",
  "timeout": 30
}
```

TypeScript hook script는 `ts-node` 또는 `tsx` 실행기를 앞에 붙인다:

```json
{
  "type": "command",
  "command": "npx tsx .codex/hooks/pre_write_guard.ts",
  "timeout": 30
}
```

### Step 3 — Pipe-test raw command

JSON을 실제로 만들기 전에 stdin 시뮬레이션으로 hook script가 작동하는지 확인:

```bash
echo '{"tool_input":{"file_path":"reference/foo.ts"}}' | node "$RUNTIME_DIR/hooks/pre_write_guard.js"
```

기대 출력: deny JSON. 무출력이면 script가 조건을 못 잡고 있는 것. 이 단계에서 실패하면 settings.json을 **건드리지 마라** — hook script부터 고친다.

### Step 4 — Write JSON (merge, not replace)

settings.json을 수정할 때 **전체 교체 금지**. 기존 `permissions.allow`, `permissions.deny`, `hooks` 배열을 유지한 채 **증분 추가**.

```typescript
// TypeScript 증분 편집 예 (hook script 또는 setup 스크립트)
import { readFileSync, writeFileSync } from 'node:fs'

const settingsPath = '.codex/settings.json'  // or '.claude/settings.json'
const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))

const hooks = data.hooks ?? {}
const preToolUse = hooks.PreToolUse ?? []
preToolUse.push({
  matcher: 'Write|Edit|NotebookEdit',
  hooks: [{ type: 'command', command: 'node .codex/hooks/pre_write_guard.js' }],
})
hooks.PreToolUse = preToolUse
data.hooks = hooks

writeFileSync(settingsPath, JSON.stringify(data, null, 2))
```

`Edit` tool을 쓸 경우에도 기존 배열을 보존하는 edit만 적용.

### Step 5 — jq -e schema validate

```bash
jq -e '.permissions.allow and .permissions.deny and .hooks' "$RUNTIME_DIR/settings.json"
```

`-e` 플래그는 값이 null/false면 exit code 1을 반환. 스키마가 깨졌으면 여기서 바로 fail.

추가 검증:

```bash
jq -e '.hooks.PreToolUse | type == "array"' "$RUNTIME_DIR/settings.json"
jq -e '.hooks.PreToolUse[] | .hooks[] | .command' "$RUNTIME_DIR/settings.json"
```

### Step 6 — Prove the hook fires

settings.json 수정이 끝나도 **hook가 실제로 발화하는지** 확인해야 한다. 수정한 hook에 대응하는 실제 tool 작업을 대상 런타임 세션에서 수행 (예: PreToolUse on Write라면 실제 Write 시도)하고, 터미널에서 hook script의 출력 또는 차단 메시지가 나오는지 본다.

**나오지 않으면**:
- Step 2의 command 문자열 오타 (경로, 실행 권한, `node`/`npx tsx` 앞에 붙었는지)
- Step 4의 JSON 구조 오류 (matcher 패턴 불일치)
- 실행 권한 이슈 (`chmod +x` — shell script의 경우)

모두 체크했는데도 발화 안 하면 `$RUNTIME_DIR/settings.json` 변경을 revert하고 근본 원인부터 다시 본다.

## Merge-not-replace 원칙

settings.json의 모든 배열 (`permissions.allow`, `permissions.deny`, `hooks.*`)은 **누적**이다. 한 번의 변경이 다른 기존 entry를 지우면 안 된다.

```typescript
// NG: 기존 entry 전부 날림
data.hooks = { PreToolUse: [newEntry] }

// OK: 기존 배열에 push
data.hooks ??= {}
data.hooks.PreToolUse ??= []
data.hooks.PreToolUse.push(newEntry)
```

## 검증 체크리스트

settings.json 또는 hooks 수정 완료 시 다음을 모두 통과:

- [ ] Step 1 dedup 확인 (중복 entry 없음)
- [ ] Step 2 command 문자열이 정확한 실행기 + 경로
- [ ] Step 3 pipe-test 통과 (stdin 시뮬레이션에서 기대 출력)
- [ ] Step 4 기존 entry 보존 (merge, not replace)
- [ ] Step 5 `jq -e` 검증 통과
- [ ] Step 6 실제 tool 작업으로 hook 발화 확인
- [ ] settings.json 여전히 유효한 JSON (`jq . settings.json` 에러 없음)

## 현 상태

- 이 repository의 `.claude/settings.json`은 현재 `hooks: {}` 상태다.
- `.codex/settings.json`은 필요 시 별도로 생성/등록한다.
- hook을 재도입할 때는 `PreToolUse`부터 시작하고, `PostToolUse` (lint), `SessionStart`, `PreCompact` / `PostCompact`는 필요 시점에 개별 추가한다.

(legacy 이름: `update-config-harness`)
