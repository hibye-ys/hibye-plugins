#!/bin/bash
# STATE ↔ git 브랜치 정합 검사 — warn-only (exit 0, check-state-wip-cap.sh 와 같은 철학).
# ① §1(활성)·§2(다음) 인덱스 id 의 detail frontmatter `branch:` 검사
#    - 브랜치 소멸 / 이미 기본 브랜치에 머지 → 포인터 갱신 또는 archive 검토
#    §3·§4 의 브랜치는 역사적 맥락이라 검사하지 않는다. 기본 브랜치 tip 과 동일한 브랜치는
#    방금 예약한 빈 브랜치이므로 머지 오탐에서 제외한다.
# ② 유령 브랜치: 기본 브랜치에 없는 커밋을 가진 로컬 브랜치가 어떤 detail frontmatter `branch:` 에도
#    없다 (이 checkout 작업 트리·기본 브랜치 트리·그 브랜치 자기 트리 중 어디서도) → 등재하거나 폐기를 결정해야 한다. 본문 서사의 언급은 등재로 치지 않는다
#    (substring 오탐 방지). STATE_BRANCH_EXCLUDE glob(기본 task-loop/*)은 자체 도구 관리로 보고 제외.
#
# 프로젝트 설정: 루트 `.staterc` (선택) — STATE_INDEXES, STATE_DEFAULT_BRANCH, STATE_BRANCH_EXCLUDE.

set -u

command -v git >/dev/null 2>&1 || exit 0

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root="${HOOK_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}")}"
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
# 기본 브랜치를 커밋 sha 로 한 번 풀어 둔다 — 이후 모든 비교·범위는 sha 를 쓴다. 같은 이름의 태그나 16진 약어와 겹쳐도
# 로컬 브랜치를 먼저 보고, 이름이 공백·`)` 같은 문자를 품어도 git 포맷·범위 식에 새지 않는다. 출력 문구는 설정 이름 $BASE 를 그대로 쓴다.
base_sha=""
for candidate in "refs/heads/$BASE" "refs/remotes/$BASE" "$BASE"; do
  base_sha=$(git rev-parse --verify --quiet "$candidate^{commit}" 2>/dev/null) && [ -n "$base_sha" ] && break
  base_sha=""
done
[ -n "$base_sha" ] || exit 0
# BASE 가 `origin/main` 같은 원격 ref 이면 같은 이름의 로컬 브랜치(main)도 기본 브랜치다 — push 전 로컬 main 이 유령·머지 후보로 잡히지 않게
# (state-focus.mjs 의 isBaseBranch 와 같은 규칙: refs/remotes/<BASE> 가 실제로 있을 때만 첫 `<remote>/` 마디를 뗀다).
LOCAL_BASE=""
if [ "${BASE#*/}" != "$BASE" ] && git show-ref --verify --quiet "refs/remotes/$BASE"; then
  LOCAL_BASE="${BASE#*/}"
fi

# ① §1/§2 id → detail frontmatter branch
if ! index_source=$(HOOK_PROJECT_DIR="$root" node "$script_dir/hooks/state-index.mjs" source 2>&1); then
  echo "WARN: STATE 설정 거부: ${index_source:0:400}"
  exit 0
fi
if [ "$index_source" = "frontmatter" ]; then
  if ! pairs=$(HOOK_PROJECT_DIR="$root" node "$script_dir/hooks/state-index.mjs" ids --sections active,next 2>&1); then
    echo "WARN: STATE frontmatter 인덱스 조회 실패: ${pairs:0:400}"
    pairs=""
  fi
else
  pairs=$(
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      [ -f "$f" ] || continue
      case "$f" in
        STATE.md) area=root ;;
        *) area=$(basename "$(dirname "$f")") ;;
      esac
      awk '/^## /{ in_sec = ($0 ~ /^## [12]\./); next } in_sec' "$f" | sed -nE "s/^- \[([a-z0-9-]+)\].*/$area \1/p"
    done <<EOF
$state_indexes
EOF
  )
fi
while read -r area id; do
  [ -n "${id:-}" ] || continue
  df="docs/state/$area/$id.md"
  [ -f "$df" ] || continue  # 존재성은 check-state-wip-cap 담당
  br=$(awk '/^---$/{n++; next} n==1' "$df" | sed -nE 's/^branch: (.+)$/\1/p' | head -1)
  case "$br" in ""|"$BASE"|"$LOCAL_BASE"|—|-) continue ;; esac
  if ! br_sha=$(git rev-parse --verify --quiet "refs/heads/$br"); then
    echo "WARN: $df branch=$br — 브랜치 소멸 (포인터 갱신 또는 archive 검토)"
  elif [ "$br_sha" = "$base_sha" ]; then
    : # 기본 브랜치 tip 과 동일 = 빈 예약 브랜치, 머지 오탐 방지
  elif git merge-base --is-ancestor "refs/heads/$br" "$base_sha" 2>/dev/null; then
    echo "WARN: $df branch=$br — 이미 $BASE 에 머지됨 (archive 후보)"
  fi
done <<EOF
$pairs
EOF

# ② 유령 브랜치 — 기본 브랜치에 없는 커밋 보유 + 등재된 detail frontmatter `branch:` 가 없음.
# 등재는 병렬 브랜치에 흩어져 있다 → 이 checkout 작업 트리 / 기본 브랜치 트리 / 그 브랜치 자기 트리
# 중 어디든 frontmatter 가 이름을 대면 등재로 본다. 앞의 둘만 보면 자기 트리에만 등재한 병렬 브랜치가
# 전부 유령으로 보이고, 이 checkout 에서 포인터가 바뀐 브랜치도 유령이 된다.
# git 트리는 node 한 번(트리·blob 을 cat-file --batch 로 묶어 읽는다 — 브랜치 수와 무관하게 git 프로세스 몇 개)으로 읽는다 — SessionStart 마다 돈다.
# 브랜치 수에 비례하는 프로세스(grep·rev-list·ls-tree)를 띄우지 않는다: 미등재 300개에서 약 12초 → 1초 미만.
known_branches=$(find docs/state -name '*.md' -exec awk 'FNR==1{n=0} /^---$/{n++; next} n==1' {} + 2>/dev/null | sed -nE 's/^branch: (.+)$/\1/p' | sort -u)
# 브랜치 이름은 %(refname:lstrip=2) — `short` 는 같은 이름의 태그가 있으면 `heads/<name>` 이 된다.
# 앞선 커밋 수는 git 이 지원하면(2.41+, 한 번만 확인) 한 번에 센다. 아니면 후보마다 rev-list 로 센다.
if git for-each-ref --count=1 --format="%(ahead-behind:$base_sha)" refs/heads/ >/dev/null 2>&1; then
  branch_format="%(refname:lstrip=2) %(ahead-behind:$base_sha)"
else
  branch_format="%(refname:lstrip=2)"
fi
# 등재 이름 제외와 (센 값이 있으면) ahead>0 거름은 awk 한 번으로 한다. 입력 1 = 등재 이름 목록, 입력 2 = 브랜치 목록.
unregistered=$(awk 'NR==FNR{seen[$0]=1; next} !($1 in seen) && (NF<2 || $2>0) {print}' <(printf '%s\n' "$known_branches") <(git for-each-ref --format="$branch_format" refs/heads/))
ghost_candidates=""
set -f  # BR_EXCLUDE glob 을 작업 디렉터리 파일 이름으로 풀지 않는다
while read -r br ahead; do
  [ -n "$br" ] || continue
  case "$br" in "$BASE"|"$LOCAL_BASE") continue ;; esac
  for pat in $BR_EXCLUDE; do case "$br" in $pat) continue 2 ;; esac; done
  if [ -z "$ahead" ]; then
    ahead=$(git rev-list --count "$base_sha..refs/heads/$br" 2>/dev/null || echo 0)
    [ "${ahead:-0}" -gt 0 ] || continue
  fi
  ghost_candidates="${ghost_candidates}${br} ${ahead}
"
done <<EOF
$unregistered
EOF
set +f
if [ -n "$ghost_candidates" ]; then
  rev_args="--rev $base_sha"
  while read -r br ahead; do
    [ -n "$br" ] && rev_args="$rev_args --rev refs/heads/$br"
  done <<EOF
$ghost_candidates
EOF
  # shellcheck disable=SC2086
  if ! tree_registered=$(HOOK_PROJECT_DIR="$root" node "$script_dir/hooks/state-index.mjs" branches $rev_args 2>&1); then
    # 조회가 실패하면 등재 여부를 알 수 없다 — 후보를 전부 유령으로 몰지 않고 실패만 알린다.
    echo "WARN: STATE 브랜치 등재 조회 실패: ${tree_registered:0:400}"
    ghost_candidates=""
  fi
  # 기본 브랜치 트리 또는 그 브랜치 자기 트리가 이름을 등재한 후보는 유령이 아니다 — 조회 결과 "<rev>\t<branch>" 줄과 awk 한 번으로 대조한다.
  if [ -n "$ghost_candidates" ]; then
    ghost_lines=$(BASE_NAME="$BASE" awk -v base="$base_sha" 'NR==FNR{reg[$0]=1; next}
      !((base "\t" $1) in reg) && !(("refs/heads/" $1 "\t" $1) in reg) {
        printf "WARN: 유령 브랜치 %s — %s 에 없는 커밋 %s개, STATE 미등재 (등재 또는 폐기 결정 필요)\n", $1, ENVIRON["BASE_NAME"], $2
      }' <(printf '%s\n' "$tree_registered") <(printf '%s' "$ghost_candidates"))
    [ -z "$ghost_lines" ] || printf '%s\n' "$ghost_lines"
  fi
fi

exit 0
