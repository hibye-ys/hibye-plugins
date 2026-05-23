---
name: loop-audit
description: agent loop / run executor 코드 변경 후 invoke. <api-app>/src/agents/ + src/runs/ + src/engine/loop.ts 의 (1) 무한 while 종료 조건 (2) 6-stage 순서 (3) LoopTransition 8 enum 완전성 (4) Stage 1 산출물 immutability 를 grep + awk 으로 검출. runtime CPU time 초과 / 사용자 abort 무시 / 비용 폭주 / 관측성 누락 방지.
metadata:
  role: audit
  scope: project
  pair_invariant: agent-loop-invariants
---

# loop-audit — agent loop 안전성 + 6-stage / LoopTransition audit

## 검증 대상 invariant
[agent-loop-invariants/SKILL.md](../agent-loop-invariants/SKILL.md)

4가지 강제:

1. **무한 while 종료 조건** — `while (true)` / `for (;;)` 블록은 `break` / `abort` / `signal.aborted` / `turn` 카운터 중 하나 포함
2. **6-stage 순서** — `stage1_contextPrep` → `stage2_modelCall` → `stage3_errorRecovery` → `stage4_toolExecution` → `stage5_contextMerge` → `stage6_loopDecision` 순서. stage 함수 정의 순서 + 호출 순서 일치
3. **LoopTransition 8 enum 완전성** — `completed` / `aborted` / `max_turns` / `prompt_too_long` / `model_error` / `hook_stopped` / `tool_error` / `continuing` — 8개 모두 정의. 종료 시 항상 transition 기록
4. **AssembledContext immutability** — Stage 1 산출물은 Stage 2+ 에서 mutate ✕

runtime CPU time 제한 + 사용자 abort + 비용 폭주 + 관측성 누락 방지. `agent-loop-invariants` invariant 와 짝.

> ⚠️ **FAIL-SAFE — 패턴 PASS ≠ 완전 준수**: 본 audit 의 8 패턴 모두 PASS 라도 invariant 완전 준수 ✕ — 모든 패턴은 *file-level grep* 또는 *line-level regex*. 6-stage 함수 *내부 로직 정합성* (각 stage 가 invariant 의 책임을 실제로 수행하는지) / `LoopTransition` 분기 logic 정확성 / Stage 4 partition 의 isConcurrencySafe 결과 활용 등은 단위 테스트 / 수동 review 의무. 자세한 한계는 §"audit 이 커버하지 않는 것" 참조.

## 실행

```bash
# === 패턴 1: 무한 while 종료 조건 누락 (기존) ===
# macOS BSD awk 호환: `\s` → `[[:space:]]`
for f in <api-app>/src/agents/**/*.ts <api-app>/src/runs/**/*.ts <api-app>/src/engine/loop.ts; do
  [[ -f "$f" ]] || continue
  awk '/while[[:space:]]*\([[:space:]]*true[[:space:]]*\)|for[[:space:]]*\([[:space:]]*;[[:space:]]*;[[:space:]]*\)/{flag=1; start=NR; brace_depth=0}
       flag && /\{/{brace_depth++}
       flag && /(break|abort|signal\.aborted|turn[[:space:]]*[>=])/{flag=0}
       flag && /\}/{
         brace_depth--
         if (brace_depth <= 0) {
           print FILENAME":"start": unsafe loop — no break/abort/turn"
           flag=0
         }
       }' "$f" 2>/dev/null
done

# === 패턴 2: 6-stage 순서 / 누락 ===
# stage 함수 정의가 모두 존재하는지 (engine/loop.ts 또는 engine/ 안)
LOOP_DIR="<api-app>/src/engine"
for stage in stage1_contextPrep stage2_modelCall stage3_errorRecovery stage4_toolExecution stage5_contextMerge stage6_loopDecision; do
  grep -rqE "(function|const|async)\s+$stage\b|$stage\s*[:=]\s*async" "$LOOP_DIR" 2>/dev/null \
    || echo "missing stage function: $stage"
done

# stage 호출 순서 — engine/loop.ts 안 호출 순서가 1→6 인지
#
# 호출 패턴만 추출 (function 정의 제외):
#   ✓ `await stage1_contextPrep(`  ← 호출
#   ✓ `= stage1_contextPrep(`       ← 호출 (await 없는 경우)
#   ✗ `async function stage1_contextPrep(`  ← 정의 (제외)
#   ✗ `const stage1_contextPrep = async (`  ← 정의 (제외)
#   ✗ `// Stage 1: ...`  ← 주석 (제외)
if [ -f "$LOOP_DIR/loop.ts" ]; then
  CALL_ORDER=$(grep -nE "(await\s+|=\s*)stage[1-6]_[a-zA-Z]+\s*\(" "$LOOP_DIR/loop.ts" 2>/dev/null \
    | grep -vE "function\s+stage|const\s+stage[1-6]_[a-zA-Z]+\s*=" \
    | grep -oE "stage[1-6]_[a-zA-Z]+" | head -10)
  EXPECTED="stage1_contextPrep
stage2_modelCall
stage3_errorRecovery
stage4_toolExecution
stage5_contextMerge
stage6_loopDecision"
  ACTUAL=$(echo "$CALL_ORDER" | head -6)
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "stage call order mismatch in $LOOP_DIR/loop.ts"
    echo "  expected: $(echo "$EXPECTED" | tr '\n' ' ')"
    echo "  actual:   $(echo "$ACTUAL" | tr '\n' ' ')"
  fi
fi

# === 패턴 3: LoopTransition 8 enum 완전성 ===
# 정본 8: completed / aborted / max_turns / prompt_too_long / model_error / hook_stopped / tool_error / continuing
TRANSITION_FILE=$(grep -rlE "LoopTransition" <api-app>/src/engine/ <api-app>/src/types/ 2>/dev/null | head -1)
if [ -n "$TRANSITION_FILE" ]; then
  for trans in completed aborted max_turns prompt_too_long model_error hook_stopped tool_error continuing; do
    grep -qE "['\"]$trans['\"]" "$TRANSITION_FILE" \
      || echo "$TRANSITION_FILE: missing LoopTransition value '$trans'"
  done
fi

# === 패턴 4: 종료 시 LoopTransition 기록 누락 ===
# loop.ts 안 break / return / throw 직전에 trace({ transition: ... }) 호출 있는지
# 정상: deps.trace({ transition: decision.transition }) — Stage 6 가 기록 후 break
# 위반: stage6 외부에서 break 하면서 transition 기록 없음
grep -rnE "^\s*break\s*$|^\s*return[^;{]*$" <api-app>/src/engine/loop.ts 2>/dev/null \
  | while IFS=: read -r f ln rest; do
      # 직전 5줄 안 transition 기록 검색
      awk -v ln="$ln" 'NR>=ln-5 && NR<=ln {print}' "$f" 2>/dev/null \
        | grep -qE "transition|LoopTransition" \
        || echo "$f:$ln: break/return without transition record"
    done | head -10

# === 패턴 5: AssembledContext mutate (Stage 2+ 에서 변경) ===
# Stage 1 가 만든 AssembledContext / ctx.systemPrompt / ctx.messages / ctx.tools 를
# Stage 2+ 에서 push/splice/assignment 하는 패턴 검출
grep -rEn "ctx\.(systemPrompt|messages|tools)\s*=|ctx\.messages\.(push|splice|pop|shift)" \
  <api-app>/src/engine/ 2>/dev/null | grep -v "stage1\|contextPrep"

# === 패턴 6: provider SDK 타입 직접 사용 (unified Message/ContentBlock 경계 위반) ===
grep -rEn "import.*from\s+['\"](@anthropic-ai/sdk|openai|@google/generative-ai)" \
  <api-app>/src/engine/ 2>/dev/null

# === 패턴 7: Stage 4 의 isConcurrencySafe 체크 누락 ===
# tool partition 시 isConcurrencySafe(args) 호출 없이 parallel batch 가 있다면 위반
grep -rEn "Promise\.(all|allSettled)\(" <api-app>/src/engine/loop.ts <api-app>/src/tools/orchestration.ts 2>/dev/null \
  | while IFS=: read -r f ln rest; do
      # 같은 파일 안 isConcurrencySafe 호출 없으면 위반
      grep -qE "isConcurrencySafe" "$f" 2>/dev/null \
        || echo "$f:$ln: parallel batch without isConcurrencySafe check"
    done

# === 패턴 8: Stage 4 의 자동 retry (도구 에러 → 재시도) ===
# design-principles §5 — 도구 에러는 모델 반환, 자동 retry 금지
# 위반: tool.execute() 결과가 isError=true 인데 재시도 루프
grep -rEn "while.*isError|for.*retry.*tool\.execute" <api-app>/src/engine/ <api-app>/src/tools/ 2>/dev/null
```

## 통과 기준

- 패턴 1: 출력 0줄 (모든 무한 루프 종료 조건 보유)
- 패턴 2: 출력 0줄 (6 stage 함수 정의 + 호출 순서 일치)
- 패턴 3: 출력 0줄 (8 LoopTransition 값 모두 정의)
- 패턴 4: 출력 0줄 또는 명시적 사유 (모든 종료 경로에 transition 기록)
- 패턴 5: 출력 0줄 (AssembledContext immutability)
- 패턴 6: 출력 0줄 (engine 은 unified Message/ContentBlock 만 — provider 경계 위반 ✕)
- 패턴 7: 출력 0줄 (Stage 4 parallel batch 는 항상 `isConcurrencySafe` 체크 후)
- 패턴 8: 출력 0줄 (도구 에러 자동 retry ✕ — 모델 반환, design-principles §5)

## 위반 시 조치

### 패턴 1 — 무한 loop

```typescript
async function runLoop(signal: AbortSignal, maxTurns = 32) {
  let turn = 0
  while (true) {
    if (signal.aborted) throw new Error('aborted')
    if (turn >= maxTurns) throw new Error('max turns exceeded')
    turn++
    const result = await stepOnce({ signal })
    if (result.done) break
  }
}
```

### 패턴 2 — stage 순서

```typescript
// 위반 — stage4 (tool) 가 stage3 (recovery) 보다 먼저
const toolResults = await stage4_toolExecution(...)
const recovered = await stage3_errorRecovery(...)

// 조치 — agent-loop-invariants invariant 6-stage 순서 고정
const ctx = await stage1_contextPrep(state, deps)
const response = await stage2_modelCall(ctx, deps)
const recovered = await stage3_errorRecovery(response, state, deps)
const toolResults = await stage4_toolExecution(recovered.toolCalls, deps)
state = await stage5_contextMerge(state, toolResults, deps)
const decision = stage6_loopDecision(state, deps)
```

### 패턴 3 — LoopTransition 누락

```typescript
// 위반 — 7개만 정의
type LoopTransition = 'completed' | 'aborted' | 'max_turns' | 'model_error' |
  'hook_stopped' | 'tool_error' | 'continuing'

// 조치 — 8개 모두
type LoopTransition = 'completed' | 'aborted' | 'max_turns' | 'prompt_too_long' |
  'model_error' | 'hook_stopped' | 'tool_error' | 'continuing'
```

### 패턴 4 — transition 기록 누락

```typescript
// 위반
if (toolError) {
  throw new Error('tool failed')  // transition 기록 ✕
}

// 조치
if (toolError) {
  deps.trace({ transition: 'tool_error' })
  break
}
```

### 패턴 5 — AssembledContext mutate

```typescript
// 위반 — Stage 2 가 ctx.messages 변경
async function stage2_modelCall(ctx, deps) {
  ctx.messages.push({ role: 'system', content: '...' })  // ✕
}

// 조치 — 새 객체 반환
async function stage2_modelCall(ctx, deps) {
  return { ...ctx, response: ... }  // ctx 자체는 read-only
}
```

## audit 이 커버하지 않는 것

- **stage 함수 *내부 로직* 정합성** (예: stage3 가 PTL 외 다른 에러도 처리하나) → 단위 테스트
- **`runtime` CPU time 한계** 실측 → `performance-profiling` workflow
- **LoopState 의 messages 배열 외부 mutation** → 별도 통합 테스트
- **engine 외 코드 (routes/services) 의 stage 직접 호출 시도** → `architecture-invariants` 의 layer 검증

## Cross-ref

- `agent-loop-invariants` invariant — 6-stage + 8 LoopTransition 정본
- `agent-loop` workflow — 7단계 스켈레톤 (Stage 0 시스템 프롬프트 + Stage 1~6 invariant)
- `compaction-thresholds` invariant — Stage 3 reactive compact target ratio
- `provider-retry-audit` — Stage 2 의 retry 매트릭스 검증
- `spawn-limits-audit` — Stage 4 의 sub-agent spawn 가드
