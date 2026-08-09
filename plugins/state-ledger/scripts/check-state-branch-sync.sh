#!/bin/bash
# STATE ↔ git 브랜치 정합 검사 — warn-only (exit 0, check-state-wip-cap.sh 와 같은 철학).
# ① §1(활성)·§2(다음) 인덱스 id 의 detail frontmatter `branch:` 검사
#    - 브랜치 소멸 / 이미 기본 브랜치에 머지 → 포인터 갱신 또는 archive 검토
#    §3·§4 의 브랜치는 역사적 맥락이라 검사하지 않는다. 기본 브랜치 tip 과 동일한 브랜치는
#    방금 예약한 빈 브랜치이므로 머지 오탐에서 제외한다.
# ② 유령 브랜치: 기본 브랜치에 없는 커밋을 가진 로컬 브랜치가 어떤 detail frontmatter `branch:` 에도
#    없다 → 등재하거나 폐기를 결정해야 한다. 본문 서사의 언급은 등재로 치지 않는다
#    (substring 오탐 방지). STATE_BRANCH_EXCLUDE glob(기본 task-loop/*)은 자체 도구 관리로 보고 제외.
#
# 프로젝트 설정: 루트 `.staterc` (선택) — STATE_INDEXES, STATE_DEFAULT_BRANCH, STATE_BRANCH_EXCLUDE.

set -u

command -v git >/dev/null 2>&1 || exit 0

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
cd "$root" 2>/dev/null || exit 0

# .staterc — KEY="value" 고정 형식만 읽는다 (source ✕: set -u 중단·변수 오염·임의 실행 방지)
if ! command -v node >/dev/null 2>&1; then
  echo "WARN: node가 PATH에 없어 STATE_INDEXES를 안전하게 검증하지 못함"
  exit 0
fi
if ! state_indexes=$(HOOK_PROJECT_DIR="$root" node "$script_dir/hooks/state-config.mjs" indexes 2>&1); then
  echo "WARN: STATE 설정 거부: ${state_indexes:0:400}"
  exit 0
fi
read_staterc() {
  [ -f ".staterc" ] || return 0
  sed -nE "s/^$1=\"([^\"]*)\"[[:space:]]*\$/\1/p" .staterc | head -1
}
v=$(read_staterc STATE_DEFAULT_BRANCH); BASE="${v:-main}"
v=$(read_staterc STATE_BRANCH_EXCLUDE); BR_EXCLUDE="${v:-task-loop/*}"
git rev-parse --verify --quiet "$BASE" >/dev/null || exit 0

# ① §1/§2 id → detail frontmatter branch
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  case "$f" in
    STATE.md) area=root ;;
    *) area=$(basename "$(dirname "$f")") ;;
  esac
  ids=$(awk '/^## /{ in_sec = ($0 ~ /^## [12]\./); next } in_sec' "$f" | sed -nE 's/^- \[([a-z0-9-]+)\].*/\1/p')
  for id in $ids; do
    df="docs/state/$area/$id.md"
    [ -f "$df" ] || continue  # 존재성은 check-state-wip-cap 담당
    br=$(awk '/^---$/{n++; next} n==1' "$df" | sed -nE 's/^branch: (.+)$/\1/p' | head -1)
    case "$br" in ""|"$BASE"|—|-) continue ;; esac
    if ! git rev-parse --verify --quiet "refs/heads/$br" >/dev/null; then
      echo "WARN: $df branch=$br — 브랜치 소멸 (포인터 갱신 또는 archive 검토)"
    elif [ "$(git rev-parse "refs/heads/$br")" = "$(git rev-parse "$BASE")" ]; then
      : # 기본 브랜치 tip 과 동일 = 빈 예약 브랜치, 머지 오탐 방지
    elif git merge-base --is-ancestor "refs/heads/$br" "$BASE" 2>/dev/null; then
      echo "WARN: $df branch=$br — 이미 $BASE 에 머지됨 (archive 후보)"
    fi
  done
done <<EOF
$state_indexes
EOF

# ② 유령 브랜치 — 기본 브랜치에 없는 커밋 보유 + 어떤 detail frontmatter `branch:` 에도 없음
known_branches=$(find docs/state -name '*.md' -exec awk 'FNR==1{n=0} /^---$/{n++; next} n==1' {} + 2>/dev/null | sed -nE 's/^branch: (.+)$/\1/p' | sort -u)
for br in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  case "$br" in "$BASE") continue ;; esac
  for pat in $BR_EXCLUDE; do case "$br" in $pat) continue 2 ;; esac; done
  ahead=$(git rev-list --count "$BASE..$br" 2>/dev/null || echo 0)
  [ "${ahead:-0}" -gt 0 ] || continue
  if ! printf '%s\n' "$known_branches" | grep -qxF "$br"; then
    echo "WARN: 유령 브랜치 $br — $BASE 에 없는 커밋 ${ahead}개, STATE 미등재 (등재 또는 폐기 결정 필요)"
  fi
done

exit 0
