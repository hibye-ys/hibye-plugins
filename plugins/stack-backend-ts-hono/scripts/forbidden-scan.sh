#!/usr/bin/env bash
# forbidden-scan.sh — 금지어 매치 검사
#
# Usage:
#   forbidden-scan.sh [target-dir]
#   forbidden-scan.sh [target-dir] --exclude PATTERN [--exclude PATTERN ...]
#
# 기본 target = plugins/stack-backend-ts-hono/skills/
# 기본 정본 forbidden-terms = scripts/forbidden-terms.txt (자기 옆)
#
# 환경 변수:
#   FORBIDDEN_FILE — forbidden-terms.txt 경로 override
#
# Repo-root 스캔 확장 시 --exclude 옵션 권장:
#   bash forbidden-scan.sh /path/to/repo \
#     --exclude 'ref/**' \
#     --exclude 'docs/superpowers/plans/**' \
#     --exclude '.git/**'

set -euo pipefail

TARGET_DIR=""
EXCLUDE_GLOBS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --exclude)
      EXCLUDE_GLOBS+=("$2")
      shift 2
      ;;
    --exclude=*)
      EXCLUDE_GLOBS+=("${1#*=}")
      shift
      ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      if [ -z "$TARGET_DIR" ]; then
        TARGET_DIR="$1"
      else
        echo "error: unexpected arg: $1" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

TARGET_DIR="${TARGET_DIR:-$(dirname "$0")/../skills}"
FORBIDDEN_FILE="${FORBIDDEN_FILE:-$(dirname "$0")/forbidden-terms.txt}"

if [ ! -f "$FORBIDDEN_FILE" ]; then
  echo "error: forbidden-terms file not found: $FORBIDDEN_FILE" >&2
  exit 2
fi

# rg PCRE2 확인
if ! rg --pcre2 --version >/dev/null 2>&1; then
  echo "error: rg with PCRE2 required (한국어 lookbehind/lookahead 필요)" >&2
  exit 2
fi

# rg --glob 인자 조립
RG_GLOB_ARGS=()
for glob in "${EXCLUDE_GLOBS[@]}"; do
  RG_GLOB_ARGS+=("--glob" "!${glob}")
done

# self-exclude — forbidden-terms.txt 자기 자신이 TARGET_DIR 안에 있으면 스캔에서 제외
# (자기 패턴 정의 라인이 자기 자신과 매치하는 self-match 방지)
FORBIDDEN_ABS="$(cd "$(dirname "$FORBIDDEN_FILE")" && pwd)/$(basename "$FORBIDDEN_FILE")"
TARGET_ABS="$(cd "$TARGET_DIR" 2>/dev/null && pwd)" || TARGET_ABS="$TARGET_DIR"
case "$FORBIDDEN_ABS" in
  "$TARGET_ABS"/*)
    SELF_REL="${FORBIDDEN_ABS#$TARGET_ABS/}"
    RG_GLOB_ARGS+=("--glob" "!${SELF_REL}")
    ;;
esac

# scan — legacy ref / metadata.source / audit 본질 디렉토리 제외
# 제외:
#   - frontmatter source 라인 (`source: stack-backend-python/...` legacy ref)
#   - metadata.source 키 자체
#   - 본질적으로 금지어를 *언급* 해야 하는 audit/룰 skill 디렉토리:
#       d1-forbidden-audit/  — D1 검출 audit (D1 단어 필수)
#       database/            — DB 룰 (D1 금지 명시)
#       data-governance/     — 데이터 거버넌스 룰 (D1 binding 금지 명시)
EXIT=0
while IFS= read -r pattern; do
  [[ -z "$pattern" || "$pattern" =~ ^# ]] && continue

  matches=$(rg -nP --pcre2 "${RG_GLOB_ARGS[@]}" "$pattern" "$TARGET_DIR" 2>/dev/null \
    | grep -v "source:\s*stack-backend-python/" \
    | grep -v "metadata.source" \
    | grep -v "/d1-forbidden-audit/" \
    | grep -v "/database/" \
    | grep -v "/data-governance/" \
    || true)

  if [ -n "$matches" ]; then
    echo "=== forbidden pattern: $pattern ==="
    echo "$matches"
    EXIT=1
  fi
done < "$FORBIDDEN_FILE"

if [ $EXIT -eq 0 ]; then
  echo "✓ forbidden-scan: 0 matches (target=$TARGET_DIR, excludes=${#EXCLUDE_GLOBS[@]})"
fi
exit $EXIT
