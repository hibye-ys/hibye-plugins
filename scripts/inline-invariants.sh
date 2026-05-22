#!/usr/bin/env bash
# inline-invariants.sh — Markdown 의 @<path> @import 라인을 인라인 본문으로 expand.
# Codex AGENTS.md fallback 자동화. Claude Code 는 @import 직접 지원 — 스크립트 불필요.
#
# Usage:
#   inline-invariants.sh <input-md> <output-md> [base-dir]
#   inline-invariants.sh --check <input-md> <expected-md> [base-dir]
#
#   input-md     = @<path> 를 가진 source (CLAUDE.md 또는 AGENTS.md)
#   output-md    = expand 결과 작성 위치 (input-md 와 동일 경로 OK — 임시 파일 통한 atomic 갱신)
#   base-dir     = @<path> 가 상대 경로일 때 기준 (기본 = input-md 의 디렉토리)
#
#   --check 모드: expected-md 와 expand 결과 diff. 0 = 일치, 1 = drift (write ✕). CI 용.

set -euo pipefail

CHECK_MODE=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_MODE=1
  shift
fi

INPUT="${1:?Usage: $0 [--check] <input-md> <output-md> [base-dir]}"
OUTPUT="${2:?Usage: $0 [--check] <input-md> <output-md> [base-dir]}"
INPUT="$(cd "$(dirname "$INPUT")" && pwd)/$(basename "$INPUT")"
BASE_DIR="${3:-$(dirname "$INPUT")}"
BASE_DIR="$(cd "$BASE_DIR" 2>/dev/null && pwd)" || { echo "error: base-dir not found: ${3:-(default)}" >&2; exit 1; }

if [[ ! -f "$INPUT" ]]; then
  echo "error: input not found: $INPUT" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

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
    fm = re.match(r'^---[ \t]*\r?\n.*?\r?\n---[ \t]*\r?\n?', body, re.DOTALL)
    if fm:
        body = body[fm.end():]
    out_lines.append('')
    out_lines.append(f'<!-- ━━━ inlined from {ref} ━━━ -->')
    out_lines.append('')
    out_lines.append(body.rstrip())

pathlib.Path(tmp_path).write_text('\n'.join(out_lines) + '\n', encoding='utf-8')
PY

if [[ $CHECK_MODE -eq 1 ]]; then
  if [[ ! -f "$OUTPUT" ]]; then
    echo "drift: expected file not found: $OUTPUT" >&2
    exit 1
  fi
  if diff -q "$TMP" "$OUTPUT" >/dev/null 2>&1; then
    echo "ok: $OUTPUT matches expansion of $INPUT"
    exit 0
  else
    echo "drift: $OUTPUT differs from expansion of $INPUT" >&2
    diff "$OUTPUT" "$TMP" | head -50 >&2
    exit 1
  fi
fi

mv "$TMP" "$OUTPUT"
trap - EXIT
echo "inlined: $OUTPUT (base-dir: $BASE_DIR)"
