#!/bin/bash
# Stop hook — uncommitted 코드 변경 있는데 STATE 변경 없으면 알림 (block ✕ — 사소한 fix 까지 안 막음).
#
# 툴 중립: Claude Code / Codex 모두 stdin→stdout JSON 프로토콜로 동일 동작.
# opencode: session.idle 이벤트에서 플러그인이 호출. decision:block은 이미 idle 상태라
# 의미가 없으므로, 알림만 additionalContext로 전달.
#
# 환경변수:
#   HOOK_PROJECT_DIR — 프로젝트 루트 (우선)
#   CLAUDE_PROJECT_DIR — Claude Code 호환 (차선)

set -u

if ! command -v git >/dev/null 2>&1; then exit 0; fi
if ! command -v jq >/dev/null 2>&1; then exit 0; fi

# 이미 Stop 훅 때문에 재진입한 상태면 조용히 종료 — 알림은 1회만, 무한 재발동 차단.
# stdin 은 파이프일 때만 읽는다 — 터미널 수동 실행(stdin=TTY, EOF 없음)에서 cat 이
# 영구 블록되지 않게 (스모크 테스트: bash scripts/hooks/stop-state-reminder.sh).
input=""
if [ ! -t 0 ]; then
  input=$(cat 2>/dev/null || true)
fi
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ]; then
  exit 0
fi

root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
cd "$root" 2>/dev/null || exit 0

# 코드 취급 확장자 — goal-run 강제와 STATE 리마인더가 같은 집합을 쓴다 (갈리면 한쪽이 조용히 낡는다).
code_re='\.(ts|tsx|js|jsx|sh|py|css|ya?ml|json|sql|toml)$|(^|/)Dockerfile'

# goal-run 강제 (goal-pipeline 스킬): frontmatter 가 phase: executing 인 TRACK.md 가 있으면
# 코드 변경(uncommitted 또는 TRACK 마지막 커밋 이후 커밋분) 시 TRACK 갱신 없이는 턴 종료 block.
# 상단 stop_hook_active 가드가 재진입을 통과시키므로 무한 루프 없음 — 강제는 턴당 1회 교정.
# phase 는 frontmatter 블록(1행이 정확히 --- 일 때만, 다음 --- 까지)만 검사 — 본문 수평선 사이의
# 'phase: executing' 인용·'executing-archived' 같은 접미사 변형에 오발화 방지 (phase 값도 정확히 executing 만).
# executing 런은 동시 1개 가정(스킬 규칙) — 첫 매치만 강제.
active_track=""
for f in docs/goal-runs/*/TRACK.md; do
  [ -f "$f" ] || continue
  if awk 'NR==1{if($0!="---") exit; next} /^---$/{exit} {print}' "$f" 2>/dev/null | grep -qE '^phase:[[:space:]]*executing[[:space:]]*$'; then
    active_track="$f"; break
  fi
done
if [ -n "$active_track" ]; then
  track_dirty=$(git status --porcelain -- "$active_track" 2>/dev/null || true)
  if [ -z "$track_dirty" ]; then
    code_dirty=$(git status --porcelain 2>/dev/null | cut -c4- | grep -E "$code_re" | head -5 || true)
    code_committed=""
    last_track_commit=$(git log -n1 --format=%H -- "$active_track" 2>/dev/null || true)
    if [ -n "$last_track_commit" ]; then
      code_committed=$(git log "$last_track_commit"..HEAD --name-only --format= 2>/dev/null | grep -E "$code_re" | head -5 || true)
    fi
    if [ -n "$code_dirty$code_committed" ]; then
      msg="goal-run 강제: $active_track 미갱신 상태로 코드 변경 턴 종료 불가 — Items/Waves 상태와 updated 를 갱신한 뒤 종료하라."
      jq -n --arg msg "$msg" '{decision: "block", reason: $msg}'
      exit 0
    fi
  fi
  # goal-run 모드에서는 TRACK.md 가 ledger — 아래 STATE.md 리마인더는 생략 (매 턴 중복 발화 방지).
  exit 0
fi

# STATE 갱신 = 인덱스(STATE.md) 또는 상세(docs/state/**) 어느 쪽이든 인정.
# 변경 감지는 staged·unstaged·untracked 전부 — `git diff`만 보면 add 된 변경이 사라진다.
changed=$(git status --porcelain 2>/dev/null | cut -c4-)
state_diff=$(printf '%s\n' "$changed" | grep -E '(^|/)STATE\.md$|(^|/)docs/state/' || true)
code_diff=$(printf '%s\n' "$changed" | grep -vE '(^|/)STATE\.md$|(^|/)docs/state/' | grep -E "$code_re" | head -5 || true)

if [ -n "$code_diff" ] && [ -z "$state_diff" ]; then
  files=$(echo "$code_diff" | tr '\n' ' ' | sed 's/ $//')
  msg="STATE reminder: 코드 변경 있는데 STATE 미갱신 — $files. 인덱스 또는 docs/state/<area>/<id>.md 갱신/archive 검토 (block ✕)."
  jq -n --arg msg "$msg" '{
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: $msg
    }
  }'
fi

exit 0
