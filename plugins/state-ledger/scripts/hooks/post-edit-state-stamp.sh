#!/bin/bash
# PostToolUse hook (Edit|Write|NotebookEdit|apply_patch) — STATE detail 파일 frontmatter 자동 stamp.
# 대상: docs/state/<area>/<id>.md — 본문(frontmatter 제외) hash 가 바뀌면 touched·hash 를 갱신한다.
# 본문이 그대로여도 frontmatter(touched·hash 줄 제외)가 커밋된 HEAD 와 다르거나 파일이 HEAD 에 아직 없으면 touched 만 갱신한다
# (step·next_step·status 만 고친 편집이 "touched 최신순" 정렬에서 빠지지 않게). hash 는 그대로 둔다. 바뀐 게 없으면 파일을 다시 쓰지 않는다.
# owner·branch 는 수동 claim — 스치는 편집이 소유권·브랜치 포인터를 바꾸면 안 되므로 자동 덮어쓰기 ✕.
# STATE.md 인덱스 줄은 meta 가 없으므로 대상 아님.
# 편집한 파일이 세션 root 와 다른 checkout(같은 저장소의 다른 worktree)에 있으면 그 checkout 기준으로 stamp 한다.
# 다른 저장소의 파일은 건드리지 않는다.
#
# 툴 중립: stdin JSON 입력.
#   - Claude Code: tool_input.file_path (단일)
#   - Codex (apply_patch): tool_input.command 패치 헤더에서 docs/state 경로 전부 추출 (다중 파일, root 기준 상대 경로)
#
# 환경변수: HOOK_PROJECT_DIR(세션 checkout, 우선) → git toplevel → CLAUDE_PROJECT_DIR

set -u

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"systemMessage":"jq가 PATH에 없어 STATE detail meta를 스탬프하지 못했습니다."}'
  exit 0
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' '{"systemMessage":"python3가 PATH에 없어 STATE detail meta를 스탬프하지 못했습니다."}'
  exit 0
fi

input=$(cat)

root="${HOOK_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}")}"
cd "$root" 2>/dev/null || exit 0
root_real=$(pwd -P)
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# 같은 저장소 판정: git common dir 을 절대·물리 경로로 풀어 비교한다 (global-state-hook.sh 와 같은 규칙).
common_dir_of() {
  local dir
  dir=$(git -C "$1" rev-parse --git-common-dir 2>/dev/null) || return 1
  case "$dir" in /*) ;; *) dir="$1/$dir" ;; esac
  (CDPATH= cd -- "$dir" 2>/dev/null && pwd -P)
}
same_repository() {
  local a b
  a=$(common_dir_of "$1") && b=$(common_dir_of "$2") && [ -n "$a" ] && [ "$a" = "$b" ]
}

paths=$(echo "$input" | jq -r '.tool_input.file_path // empty')
if [ -z "$paths" ]; then
  cmd=$(echo "$input" | jq -r '.tool_input.command // empty')
  paths=$(printf '%s\n' "$cmd" | sed -nE \
    -e 's#^\*\*\* (Add|Update|Delete) File: (.+)$#\2#p' \
    -e 's#^\+\+\+ b/(.+)$#\1#p' \
    -e 's#^--- a/(.+)$#\1#p' \
    | grep -E '(^|/)docs/state/[^/]+/[^/]+\.md$' | sort -u || true)
fi
[ -n "$paths" ] || exit 0

ts=$(date -u +"%Y-%m-%dT%H:%M")

while IFS= read -r file_path; do
  [ -n "$file_path" ] || continue
  case "$file_path" in
    */docs/state/*/*.md|docs/state/*/*.md) ;;
    *) continue ;;
  esac
  case "$file_path" in
    /*) ;;
    *) file_path="$PWD/$file_path" ;;
  esac
  [ -f "$file_path" ] || continue

  # 편집한 파일이 있는 checkout. root 와 같은 저장소의 다른 checkout(worktree)이면 그쪽을 기준으로 stamp 한다.
  # 다른 저장소이거나 git 밖이면 stamp_root 는 root 그대로라 아래 root 기준 검사에서 걸러진다.
  stamp_root="$root"
  file_dir=$(CDPATH= cd -- "$(dirname -- "$file_path")" 2>/dev/null && pwd -P) || file_dir=""
  if [ -n "$file_dir" ]; then
    file_top=$(git -C "$file_dir" rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$file_top" ] && [ "$file_top" != "$root_real" ] && same_repository "$file_top" "$root_real"; then
      stamp_root="$file_top"
    fi
  fi

  # lexical prefix/case glob은 `docs/state/x/../../..`와 symlink escape를 막지 못한다.
  # realpath 후 정확히 docs/state/<area>/<id>.md 두 단계인지 검사한다.
  if ! file_path=$(python3 - "$stamp_root" "$file_path" <<'PYEOF'
import os, pathlib, sys

root = pathlib.Path(sys.argv[1]).resolve()
candidate = pathlib.Path(sys.argv[2]).resolve()
state_root = root / "docs" / "state"
try:
    relative = candidate.relative_to(state_root)
except ValueError:
    raise SystemExit(1)
if len(relative.parts) != 2 or candidate.suffix != ".md":
    raise SystemExit(1)
print(candidate)
PYEOF
  ); then
    continue
  fi

  TS="$ts" python3 - "$stamp_root" "$file_path" <<'PYEOF'
import hashlib, os, re, subprocess, sys, tempfile

root, path = os.path.realpath(sys.argv[1]), sys.argv[2]
text = open(path, encoding="utf-8").read()

FM_RE = r"^---\n(.*?)\n---\n(.*)$"
m = re.match(FM_RE, text, re.S)
if not m:
    sys.exit(0)
fm, body = m.group(1), m.group(2)

new_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()[:8]
cur = re.search(r"^hash: (\S+)$", fm, re.M)

def set_field(fm, key, value):
    if re.search(rf"^{key}: ", fm, re.M):
        return re.sub(rf"^{key}: .*$", f"{key}: {value}", fm, count=1, flags=re.M)
    return fm + f"\n{key}: {value}"

def meta_lines(fm):
    return [line for line in fm.split("\n") if not line.startswith(("touched: ", "hash: "))]

body_unchanged = bool(cur) and cur.group(1) == new_hash
if body_unchanged:
    # 본문은 그대로다. frontmatter(touched·hash 줄 제외)가 커밋된 HEAD 와 같으면 손댈 게 없다.
    # 다르거나 HEAD 에 아직 없으면(새 파일·git 오류 포함) touched 만 갱신한다. hash 는 그대로 둔다.
    rel = os.path.relpath(path, root).replace(os.sep, "/")
    head = None
    try:
        shown = subprocess.run(["git", "-C", root, "show", f"HEAD:{rel}"], capture_output=True, timeout=10)
        if shown.returncode == 0:
            head = re.match(FM_RE, shown.stdout.decode("utf-8", "replace"), re.S)
    except (OSError, subprocess.SubprocessError):
        head = None
    if head and meta_lines(head.group(1)) == meta_lines(fm):
        sys.exit(0)
fm = set_field(fm, "touched", os.environ["TS"])
if not body_unchanged:
    fm = set_field(fm, "hash", new_hash)

out = f"---\n{fm}\n---\n{body}"
if out == text:
    sys.exit(0)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix=".state-stamp-", suffix=".tmp")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(out)
    os.chmod(tmp, os.stat(path).st_mode & 0o7777)
    os.replace(tmp, path)
except BaseException:
    os.unlink(tmp)
    raise
PYEOF
  # 세션 root 밖의 checkout 을 stamp 했으면 그쪽의 로컬 생성 인덱스(frontmatter 원천)도 갱신한다 — root 쪽은 dispatcher 가 맡는다.
  if [ "$stamp_root" != "$root" ] && command -v node >/dev/null 2>&1; then
    HOOK_PROJECT_DIR="$stamp_root" node "$script_dir/state-index.mjs" render --write >/dev/null 2>&1 || true
  fi
done <<< "$paths"

exit 0
