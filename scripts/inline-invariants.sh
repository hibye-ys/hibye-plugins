#!/usr/bin/env bash
# inline-invariants.sh — Markdown 의 @<path> @import 라인을 인라인 본문으로 expand.
# Codex AGENTS.md fallback 자동화. Claude Code 는 @import 직접 지원 — 스크립트 불필요.
#
# Usage: inline-invariants.sh <input-md> <output-md> [base-dir]
#   input-md   = @<path> 를 가진 source (CLAUDE.md 또는 AGENTS.md)
#   output-md  = expand 결과 작성 위치 (input-md 와 동일 경로 OK — 임시 파일 통한 atomic 갱신)
#   base-dir   = @<path> 가 상대 경로 (. 또는 ./ 시작 아닌 것) 일 때 기준 (기본 = input-md 의 디렉토리)

set -euo pipefail

INPUT="${1:?Usage: $0 <input-md> <output-md> [base-dir]}"
OUTPUT="${2:?Usage: $0 <input-md> <output-md> [base-dir]}"
INPUT="$(cd "$(dirname "$INPUT")" && pwd)/$(basename "$INPUT")"
BASE_DIR="${3:-$(dirname "$INPUT")}"
BASE_DIR="$(cd "$BASE_DIR" && pwd)"

if [[ ! -f "$INPUT" ]]; then
  echo "error: input not found: $INPUT" >&2
  exit 1
fi

TMP="$(mktemp)"

python3 - "$INPUT" "$BASE_DIR" "$TMP" <<'PY'
import sys, re, pathlib

input_path, base_dir, tmp_path = sys.argv[1:4]
base_dir = pathlib.Path(base_dir)
text = pathlib.Path(input_path).read_text(encoding='utf-8')

out_lines = []
for line in text.splitlines():
    stripped = line.strip()
    m = re.match(r'^@(.+\.md)\s*$', stripped)
    if not m:
        out_lines.append(line)
        continue
    ref = m.group(1)
    if ref.startswith('/'):
        # absolute path
        target = pathlib.Path(ref)
    elif ref.startswith('./') or ref.startswith('../'):
        # explicitly relative to input-md's directory
        target = (pathlib.Path(input_path).parent / ref).resolve()
    else:
        # project-root relative (e.g. .claude/plugins/cache/... or apps/...)
        target = (base_dir / ref).resolve()
    if not target.is_file():
        out_lines.append(f'<!-- inline-invariants: MISSING {ref} -->')
        continue
    body = target.read_text(encoding='utf-8')
    # strip YAML frontmatter
    fm = re.match(r'^---\n.*?\n---\n', body, re.DOTALL)
    if fm:
        body = body[fm.end():]
    out_lines.append('')
    out_lines.append(f'<!-- ━━━ inlined from {ref} ━━━ -->')
    out_lines.append('')
    out_lines.append(body.rstrip())

pathlib.Path(tmp_path).write_text('\n'.join(out_lines) + '\n', encoding='utf-8')
PY

mv "$TMP" "$OUTPUT"
echo "inlined: $OUTPUT (base-dir: $BASE_DIR)"
