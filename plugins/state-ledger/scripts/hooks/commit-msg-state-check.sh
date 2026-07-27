#!/bin/bash
# commit-msg hook — STATE ↔ git log 연결 규약 검사 (warn-only, block ✕).
# ① docs/state/** 를 건드리는 커밋인데 메시지에 [id=...] 없음 → git log 정본에서 작업 추적이 끊긴다.
# ② detail 파일을 삭제하는 커밋인데 'archive [id=' 없음 → 흔적 없는 소멸.
# 훅 디렉터리가 체크아웃 간 공유되는 프로젝트에서는 스크립트 부재 시 조용히 통과하도록 배선한다.

set -u

msgfile="${1:-}"
{ [ -n "$msgfile" ] && [ -f "$msgfile" ]; } || exit 0
command -v git >/dev/null 2>&1 || exit 0

staged=$(git diff --cached --name-only 2>/dev/null || true)
state_touched=$(printf '%s\n' "$staged" | grep -E '^docs/state/[^/]+/[^/]+\.md$' || true)
[ -n "$state_touched" ] || exit 0

msg=$(cat "$msgfile")

if ! printf '%s' "$msg" | grep -q '\[id='; then
  echo "WARN: docs/state 변경인데 commit message 에 [id=<id>] 없음 — git log 정본에서 이 작업이 끊긴다 (block ✕)" >&2
fi

deleted=$(git diff --cached --name-only --diff-filter=D 2>/dev/null | grep -E '^docs/state/[^/]+/[^/]+\.md$' || true)
if [ -n "$deleted" ] && ! printf '%s' "$msg" | grep -q 'archive \[id='; then
  echo "WARN: detail 삭제($(printf '%s' "$deleted" | tr '\n' ' '))인데 메시지에 'archive [id=...]' 없음 — 흔적 없는 소멸 (block ✕)" >&2
fi

exit 0
