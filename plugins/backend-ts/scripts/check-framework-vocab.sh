#!/usr/bin/env bash
# check-framework-vocab.sh — SKILL.md 본문에 framework/runtime 어휘 재유입 차단
#
# forbidden-terms.txt 의 "Framework / runtime 어휘" 섹션만 단독으로 실행.
# CI 에서 별도 step 으로 사용 가능. forbidden-terms.txt 가 단일 SoT.
#
# rg --pcre2 사용 — 한국어 등 CJK 문자 인접한 ASCII \b word boundary 정합성 확보
# (BSD grep -E 는 multibyte locale 에서 \b 불일치).
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_TARGET="${1:-$PLUGIN_DIR/skills}"
TERMS_FILE="$PLUGIN_DIR/scripts/forbidden-terms.txt"

[ -f "$TERMS_FILE" ] || { echo "error: $TERMS_FILE not found" >&2; exit 2; }

# rg PCRE2 확인
if ! rg --pcre2 --version >/dev/null 2>&1; then
  echo "error: rg with PCRE2 required (한국어 word boundary 필요)" >&2
  exit 2
fi

# Framework / runtime 섹션의 패턴만 추출 (mktemp 없이 here-string 으로 처리)
# 섹션 헤더 (예: "# === Framework / runtime 어휘") 이후의 non-empty, non-comment 라인
PATTERNS=$(awk '
  /^# === Framework \/ runtime 어휘/ { in_section = 1; next }
  /^# ===/ { in_section = 0 }
  in_section && /^[^#]/ && NF > 0 { print }
' "$TERMS_FILE")

if [ -z "$PATTERNS" ]; then
  echo "error: no framework patterns found in $TERMS_FILE (expected '# === Framework / runtime 어휘' section)" >&2
  exit 2
fi

FAIL=0
PATTERN_COUNT=0
while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  PATTERN_COUNT=$((PATTERN_COUNT + 1))
  matches=$(rg -nP --pcre2 "$pattern" "$SCAN_TARGET" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "VIOLATION: $pattern"
    echo "$matches" | head -5
    echo ""
    FAIL=1
  fi
done <<< "$PATTERNS"

if [ $FAIL -eq 0 ]; then
  echo "✓ framework vocab clean: $SCAN_TARGET ($PATTERN_COUNT patterns from forbidden-terms.txt)"
else
  echo "✗ framework vocab violations found" >&2
  exit 1
fi
