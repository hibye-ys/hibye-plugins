#!/bin/bash
# PostToolUse hook (Edit|Write|NotebookEdit|apply_patch) — STATE detail 파일 frontmatter 자동 stamp.
# 대상: docs/state/<area>/<id>.md — 본문(frontmatter 제외) hash 가 바뀌었을 때만 touched·hash 를 갱신한다.
# owner·branch 는 수동 claim — 스치는 편집이 소유권·브랜치 포인터를 바꾸면 안 되므로 자동 덮어쓰기 ✕.
# STATE.md 인덱스 줄은 meta 가 없으므로 대상 아님.
#
# 툴 중립: stdin JSON 입력.
#   - Claude Code: tool_input.file_path (단일)
#   - Codex (apply_patch): tool_input.command 패치 헤더에서 docs/state 경로 전부 추출 (다중 파일)
#
# 환경변수: HOOK_PROJECT_DIR(우선)/CLAUDE_PROJECT_DIR

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

root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
cd "$root" 2>/dev/null || exit 0

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

  # lexical prefix/case glob은 `docs/state/x/../../..`와 symlink escape를 막지 못한다.
  # realpath 후 정확히 docs/state/<area>/<id>.md 두 단계인지 검사한다.
  if ! file_path=$(python3 - "$root" "$file_path" <<'PYEOF'
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

  TS="$ts" python3 - "$file_path" <<'PYEOF'
import hashlib, os, re, sys, tempfile

path = sys.argv[1]
text = open(path, encoding="utf-8").read()

m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
if not m:
    sys.exit(0)
fm, body = m.group(1), m.group(2)

new_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()[:8]
cur = re.search(r"^hash: (\S+)$", fm, re.M)
if cur and cur.group(1) == new_hash:
    sys.exit(0)

def set_field(fm, key, value):
    if re.search(rf"^{key}: ", fm, re.M):
        return re.sub(rf"^{key}: .*$", f"{key}: {value}", fm, count=1, flags=re.M)
    return fm + f"\n{key}: {value}"

fm = set_field(fm, "touched", os.environ["TS"])
fm = set_field(fm, "hash", new_hash)

out = f"---\n{fm}\n---\n{body}"
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
done <<< "$paths"

exit 0
