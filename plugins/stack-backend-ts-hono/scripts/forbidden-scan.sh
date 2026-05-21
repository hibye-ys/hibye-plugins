#!/usr/bin/env bash
# forbidden-scan.sh — 금지어 매치 검사
# Usage: forbidden-scan.sh [target-dir]
# 기본 target = plugins/stack-backend-ts-hono/skills/
set -euo pipefail

TARGET_DIR="${1:-$(dirname "$0")/../skills}"
FORBIDDEN_FILE="${FORBIDDEN_FILE:-$(dirname "$0")/../../../docs/superpowers/plans/2026-05-22-m2.5-coverage-completion/forbidden-terms.txt}"

if [ ! -f "$FORBIDDEN_FILE" ]; then
  echo "error: forbidden-terms file not found: $FORBIDDEN_FILE"
  exit 2
fi

# rg PCRE2 확인
if ! rg --pcre2 --version >/dev/null 2>&1; then
  echo "error: rg with PCRE2 required (한국어 lookbehind/lookahead 필요)"
  exit 2
fi

# scan — legacy ref (`source: stack-backend-python/`) 라인 + metadata.source 라인 제외
EXIT=0
while IFS= read -r pattern; do
  [[ -z "$pattern" || "$pattern" =~ ^# ]] && continue

  # 제외:
  #   - frontmatter source 라인 (`source: stack-backend-python/...` legacy ref)
  #   - metadata.source 키 자체
  #   - 본질적으로 금지어를 *언급* 해야 하는 audit/룰 skill 디렉토리:
  #       d1-forbidden-audit/    — D1 검출 audit (D1 단어 필수)
  #       database/              — DB 룰 (D1 금지 명시)
  #       data-governance/       — 데이터 거버넌스 룰 (D1 binding 금지 명시)
  matches=$(rg -nP --pcre2 "$pattern" "$TARGET_DIR" 2>/dev/null \
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
  echo "✓ forbidden-scan: 0 matches"
fi
exit $EXIT
