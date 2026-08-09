#!/bin/bash
# commit-msg hook — STATE ↔ git log 연결 규약 검사 (warn-only, block ✕).
# ① STATE 인덱스/detail 에서 바뀐 각 id 가 메시지의 [id=...] 와 일치해야 한다.
# ② detail 파일 삭제는 파일별로 `archive [id=<그 id>]` 를 요구한다.
# 훅 디렉터리가 체크아웃 간 공유되는 프로젝트에서는 스크립트 부재 시 조용히 통과하도록 배선한다.

set -u

msgfile="${1:-}"
{ [ -n "$msgfile" ] && [ -f "$msgfile" ]; } || exit 0
command -v git >/dev/null 2>&1 || exit 0
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "WARN: node가 PATH에 없어 STATE_INDEXES를 안전하게 검증하지 못함 (commit 진행)" >&2
  exit 0
fi
if ! state_indexes=$(HOOK_PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)" node "$script_dir/state-config.mjs" indexes 2>&1); then
  echo "WARN: STATE 설정 거부: ${state_indexes:0:400} (commit 진행)" >&2
  exit 0
fi
state_index_args=()
while IFS= read -r index; do
  [ -n "$index" ] && state_index_args+=("$index")
done <<EOF
$state_indexes
EOF

staged=$(git diff --cached --name-only 2>/dev/null || true)
state_touched=$(printf '%s\n' "$staged" | grep -E '^docs/state/[^/]+/[^/]+\.md$' || true)
for index in "${state_index_args[@]}"; do
  if printf '%s\n' "$staged" | grep -qxF "$index"; then
    state_touched="${state_touched}${state_touched:+
}$index"
  fi
done
[ -n "$state_touched" ] || exit 0

msg=$(cat "$msgfile")

detail_ids=$(printf '%s\n' "$staged" \
  | sed -nE 's#^docs/state/[^/]+/([a-z0-9-]{3,12})\.md$#\1#p')
index_ids=$(git diff --cached -U0 -- "${state_index_args[@]}" 2>/dev/null \
  | sed -nE 's/^[+-]- \[([a-z0-9-]{3,12})\].*/\1/p')
required_ids=$(printf '%s\n%s\n' "$detail_ids" "$index_ids" | sed '/^$/d' | sort -u)

for id in $required_ids; do
  if ! printf '%s' "$msg" | grep -qE "\\[id=$id\\]"; then
    echo "WARN: STATE [id=$id] 변경인데 commit message 에 '[id=$id]' 없음 — git log 정본과 실제 변경이 불일치한다 (block ✕)" >&2
  fi
done

deleted=$(git diff --cached --no-renames --name-only --diff-filter=D 2>/dev/null | grep -E '^docs/state/[^/]+/[^/]+\.md$' || true)
for d in $deleted; do
  id=$(basename "$d" .md)
  if ! printf '%s' "$msg" | grep -qE "(^|[^[:alnum:]])archive \[id=$id\]"; then
    echo "WARN: $d 삭제인데 메시지에 'archive [id=$id]' 없음 — 흔적 없는 소멸 (block ✕)" >&2
  fi
done

exit 0
