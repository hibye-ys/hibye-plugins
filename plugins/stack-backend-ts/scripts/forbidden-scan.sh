#!/usr/bin/env bash
# forbidden-scan.sh — 금지어 매치 검사
#
# Usage:
#   forbidden-scan.sh [target-dir]
#   forbidden-scan.sh [target-dir] --exclude PATTERN [--exclude PATTERN ...]
#
# 기본 target = plugins/stack-backend-ts/skills/
# 기본 정본 forbidden-terms = scripts/forbidden-terms.txt (자기 옆)
#
# 환경 변수:
#   FORBIDDEN_FILE — forbidden-terms.txt 경로 override
#   ALLOW_FRAMEWORK_VOCAB=1 — Phase 4 batch 일시 우회 (Task 4.8 에서 제거)
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

# Phase 4 batch 진행 중 임시 우회 — Task 4.8 에서 제거
ALLOW_FRAMEWORK_VOCAB="${ALLOW_FRAMEWORK_VOCAB:-0}"

if [ "$ALLOW_FRAMEWORK_VOCAB" = "1" ]; then
  # Framework/runtime 어휘 섹션 헤더 이전까지만 패턴으로 사용
  _PATTERNS_TMP="$(mktemp)"
  trap 'rm -f "$_PATTERNS_TMP"' EXIT
  awk '/^# === Framework \/ runtime 어휘/ { exit } { print }' "$FORBIDDEN_FILE" > "$_PATTERNS_TMP"
  FORBIDDEN_FILE="$_PATTERNS_TMP"
fi

# Normalize TARGET_DIR — collapse `../` segments so glob 패턴 (e.g. `!**/scripts/**`)
# 가 의도치 않게 *대상 디렉토리 경로* 안 `scripts` 세그먼트에 매치되어 전체 결과를
# 무력화시키는 버그를 차단. (rg --glob 은 file path 전체에 매치되므로
# `plugins/stack-backend-ts/scripts/../skills/...` 는 `**/scripts/**` 에 매치됨)
if [ -d "$TARGET_DIR" ]; then
  TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
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

# self-exclude — scripts/ 디렉토리 전체 (forbidden-terms.txt 자기 정의 + audit 스크립트
# 본문의 grep 패턴 string 이 자기 forbidden 패턴에 매치하는 self-match 방지)
RG_GLOB_ARGS+=("--glob" "!**/scripts/**")

# legacy single-file self-exclude — TARGET_DIR 안 forbidden-terms.txt 가 scripts/ 외 위치에
# 있을 때만 작동 (현재 default 호출에선 위 scripts/ glob 이 cover, redundant)
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
#   - 본질적으로 금지어를 *언급* 해야 하는 룰 skill 디렉토리:
#       database/            — DB 룰 (D1 금지 명시)
EXIT=0
while IFS= read -r pattern; do
  [[ -z "$pattern" || "$pattern" =~ ^# ]] && continue

  matches=$(rg -nP --pcre2 "${RG_GLOB_ARGS[@]}" "$pattern" "$TARGET_DIR" 2>/dev/null \
    | grep -v "source:\s*stack-backend-python/" \
    | grep -v "metadata.source" \
    | grep -v "/database/" \
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
