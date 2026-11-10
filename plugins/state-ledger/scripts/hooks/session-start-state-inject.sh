#!/bin/bash
# SessionStart hook — STATE 인덱스 주입 + 정합·예산 warn.
# 상세는 docs/state/<area>/<id>.md — 에이전트가 작업을 잡을 때 해당 파일만 읽는다 (lazy loading).
# 인덱스 머리에 원칙 한 줄을 붙인다: STATE는 공유 상태판이고 작업 기록은 커밋 메시지가 맡는다.
#
# 툴 중립: Claude Code / Codex 모두 stdin→stdout JSON 프로토콜로 동일 동작.
# opencode는 instructions 방식으로 STATE.md를 직접 주입하므로 이 스크립트를 호출하지 않음.
#
# 프로젝트 설정: 루트 `.staterc` (선택) — STATE_INDEXES="STATE.md apps/api/STATE.md" 식.

set -u

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"=== STATE hook 경고 ===\\njq가 PATH에 없어 STATE 주입을 실행하지 못했습니다."}}'
  exit 0
fi

input=$(cat)
root="${HOOK_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}")}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

out=""
indexes=""
config_error=""
if ! command -v node >/dev/null 2>&1; then
  config_error="node가 PATH에 없어 STATE_INDEXES를 안전하게 검증하지 못했습니다."
elif ! indexes=$(HOOK_PROJECT_DIR="$root" node "$script_dir/state-config.mjs" indexes 2>&1); then
  config_error="STATE 설정 거부: ${indexes:0:400}"
  indexes=""
fi
if [ -n "$config_error" ]; then
  out="=== STATE hook 경고 ===
$config_error"
fi

# 같은 worktree의 동시 세션은 읽기만 한다. 턴 기준점은 UserPromptSubmit이 매 턴 저장하므로
# 여기서 만들지 않는다 — 프롬프트 없이 열린 세션이 다른 세션의 판정을 보류시키지 않게.
sessions_result=""
if [ -z "$config_error" ] && ! sessions_result=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-turn-baseline.mjs" sessions 2>&1); then
  out="=== STATE hook 경고 ===
STATE 동시 세션 확인 실패: ${sessions_result:0:400}"
  sessions_result=""
fi
concurrent_count=$(printf '%s' "$sessions_result" | jq -r '.concurrentSessions | length // 0' 2>/dev/null || echo 0)
if [ "${concurrent_count:-0}" -gt 0 ]; then
  out="${out}${out:+

}=== STATE hook 경고 ===
같은 worktree에서 최근 30분 내 다른 활성 세션 ${concurrent_count}개가 감지됐습니다. 변경 귀속이 불명확하므로 Stop의 커밋 태그·덧붙임 판정은 보류됩니다."
fi

# 현재 브랜치 소유 항목의 목표·단계·절차. additionalContextLimit(5000) 절단에서 살아남도록 정합 요약·인덱스보다 앞에 두되,
# 초기화 오류는 그보다도 앞이다. 최종 순서: 정리 요청 → 초기화·설정 경고 → 현재 작업 알림 → 정합·예산 요약 → 규칙 스킬 → 원칙 → 인덱스.
# 실패는 주입을 막지 않고 알림 자리에 경고로 남는다. config_error 면 건너뛴다.
focus_context=""
if [ -z "$config_error" ]; then
  focus_err_file=$(mktemp "${TMPDIR:-/tmp}/state-ledger-focus.XXXXXX" 2>/dev/null) || focus_err_file=""
  if ! focus_context=$(HOOK_PROJECT_DIR="$root" node "$script_dir/state-focus.mjs" reminder 2>"${focus_err_file:-/dev/null}"); then
    focus_err=""
    [ -n "$focus_err_file" ] && focus_err=$(cat "$focus_err_file" 2>/dev/null)
    focus_context="=== STATE hook 경고 ===
STATE 현재 작업 알림 실패: ${focus_err:0:400}"
  fi
  [ -n "$focus_err_file" ] && rm -f "$focus_err_file"
fi

# 정합 검사 원본은 그대로 둔다. 시작 맥락에는 종류·건수·대표와 원본 조회 경로만 넣는다.
# 초기화 오류와 전체 조회 경로는 인덱스보다 먼저 전달한다.
if [ -z "$config_error" ]; then
  sync=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-branch-sync.sh" 2>&1 || true)
  budget=$(HOOK_PROJECT_DIR="$root" bash "$script_dir/../check-state-wip-cap.sh" 2>&1 || true)
  initialization=""
  warning_summary=""
  if summary=$(printf '%s\n%s' "$sync" "$budget" | node "$script_dir/session-start-warning-summary.mjs" "$root" "$script_dir/../.." 2>&1); then
    initialization=$(printf '%s' "$summary" | jq -r '.initialization')
    warning_summary=$(printf '%s' "$summary" | jq -r '.summary')
  else
    warning_summary="=== STATE hook 경고 ===
STATE 경고 요약 실행 실패: ${summary:0:400}
전체 경고는 $script_dir/../check-state-branch-sync.sh 와 $script_dir/../check-state-wip-cap.sh 를 HOOK_PROJECT_DIR=$root 로 다시 조회하세요."
  fi
  for section in "$initialization" "$focus_context" "$warning_summary"; do
    [ -n "$section" ] || continue
    out="${out}${out:+

}$section"
  done
fi

# 프로젝트 규칙 스킬 사본이 플러그인 템플릿보다 낮은 버전이면 한 줄 알린다. 실패는 조용히 넘긴다.
if [ -z "$config_error" ]; then
  rules_notice=$(HOOK_PROJECT_DIR="$root" node "$script_dir/rules-skill.mjs" notice 2>/dev/null || true)
  if [ -n "$rules_notice" ]; then
    out="${out}${out:+

}=== STATE 규칙 스킬 ===
$rules_notice"
  fi
fi

# 독립 검증(opt-in): compaction 으로 시작한 세션이면 다음 Stop 에서 점검하도록 예약한다. 출력은 쓰지 않고 실패도 주입을 막지 않는다.
if [ -z "$config_error" ] && [ -f "$root/.staterc" ] && grep -Eq '^STATE_VERIFY="1"[[:space:]]*$' "$root/.staterc" 2>/dev/null; then
  printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-verify.mjs" session-start >/dev/null 2>&1 || true
fi

STATE_PRINCIPLE='STATE = 공유 상태판. 남은 일·소유·결정이 바뀌면 그 줄을 바꿔 쓴다. 작업 기록은 커밋 메시지 [id=<id>] (STATE 항목과 무관하면 [id=-]).'
principle_added=0
total_bytes=0
# frontmatter 원천: 인덱스는 detail 에서 렌더한다. 로컬 사본(git 미추적)도 함께 갱신한다 — 실패는 주입을 막지 않는다.
index_source=manual
if [ -z "$config_error" ]; then
  index_source=$(HOOK_PROJECT_DIR="$root" node "$script_dir/state-index.mjs" source 2>/dev/null || echo manual)
fi
if [ "$index_source" = "frontmatter" ]; then
  STATE_PRINCIPLE='STATE = 공유 상태판. 항목 정본은 docs/state/<area>/<id>.md frontmatter(section·title·status)이고 인덱스는 생성물이다(직접 고치지 않는다). 남은 일·소유·결정이 바뀌면 그 detail 을 바꿔 쓴다. 작업 기록은 커밋 메시지 [id=<id>] (STATE 항목과 무관하면 [id=-]).'
  HOOK_PROJECT_DIR="$root" node "$script_dir/state-index.mjs" render --write >/dev/null 2>&1 || true
fi
while IFS= read -r f; do
  [ -n "$f" ] || continue
  index_text=""
  if [ "$index_source" = "frontmatter" ]; then
    if ! index_text=$(HOOK_PROJECT_DIR="$root" node "$script_dir/state-index.mjs" print "$f" 2>&1); then
      out="${out}${out:+

}=== STATE hook 경고 ===
$f 렌더 실패: ${index_text:0:400}"
      continue
    fi
    bytes=$(printf '%s' "$index_text" | wc -c)
  else
    [ -f "$root/$f" ] || continue
    bytes=$(wc -c < "$root/$f" 2>/dev/null || echo 0)
  fi
  if [ "${bytes:-0}" -gt 16384 ]; then
    out="${out}${out:+

}=== STATE hook 경고 ===
$f ${bytes}B — SessionStart 주입 cap 16384B를 초과해 생략했습니다."
    continue
  fi
  total_bytes=$((total_bytes + bytes))
  if [ "$total_bytes" -gt 65536 ]; then
    out="${out}${out:+

}=== STATE hook 경고 ===
STATE 인덱스 합계가 SessionStart 주입 cap 65536B를 초과해 $f부터 생략했습니다."
    break
  fi
  if [ "$principle_added" -eq 0 ]; then
    out="${out}${out:+

}$STATE_PRINCIPLE"
    principle_added=1
  fi
  out="${out}${out:+

}=== $f ===
$(if [ "$index_source" = "frontmatter" ]; then printf '%s' "$index_text"; else cat "$root/$f"; fi)"
done <<EOF
$indexes
EOF

if command -v node >/dev/null 2>&1; then
  cleanup_context=$(printf '%s' "$input" | HOOK_PROJECT_DIR="$root" node "$script_dir/state-cleanup.mjs" context 2>&1)
  cleanup_status=$?
  if [ "$cleanup_status" -ne 0 ]; then cleanup_context="STATE 정리 요청 초기화 실패: $cleanup_context"; fi
  if [ -n "$cleanup_context" ]; then
    # 정리 요청은 맨 앞이라 길이 제한이 없으면 뒤의 현재 작업 알림을 Claude additionalContext 5000B 한도 밖으로 밀어낸다.
    # 머리 + 요청 3줄만(줄당 100자) 싣고 나머지는 `…(N개 더)` 로 줄인다. 전체는 state-cleanup.mjs context 로 조회한다.
    cleanup_context=$(printf '%s' "$cleanup_context" | node -e '
      const lines = require("node:fs").readFileSync(0, "utf8").split("\n")
      const clip = (t) => { const c = [...t]; return c.length > 100 ? `${c.slice(0, 99).join("")}…` : t }
      const kept = lines.slice(0, 4).map(clip)
      if (lines.length > 4) kept.push(`…(${lines.length - 4}개 더)`)
      process.stdout.write(kept.join("\n"))
    ' 2>/dev/null || printf '%s' "$cleanup_context")
    out="$cleanup_context

$out"
  fi
fi

[ -z "$out" ] && exit 0

jq -n --arg ctx "$out" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'

exit 0
