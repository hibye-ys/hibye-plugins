#!/usr/bin/env bash
# check-framework-vocab.sh — SKILL.md 본문에 framework/runtime 어휘 재유입 차단
# forbidden-scan.sh 의 framework 어휘 패턴만 단독으로 실행. CI 에서 별도 step 으로 사용 가능.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_TARGET="${1:-$PLUGIN_DIR/skills}"

PATTERNS=(
  '\bHono\b'
  '\bhono\b'
  '\bCloudflare\b'
  '\bWorkers\b'
  '\bwrangler\b'
  '\bc\.env\b'
  '\bc\.json\b'
  '\bc\.req\b'
  '\bc\.set\b'
  '\bstreamSSE\b'
  '\bHTTPException\b'
  '\bapps/api\b'
)

FAIL=0
for p in "${PATTERNS[@]}"; do
  if matches=$(grep -rnE "$p" "$SCAN_TARGET" 2>/dev/null); then
    if [ -n "$matches" ]; then
      echo "VIOLATION: $p"
      echo "$matches" | head -5
      echo ""
      FAIL=1
    fi
  fi
done

if [ $FAIL -eq 0 ]; then
  echo "✓ framework vocab clean: $SCAN_TARGET"
else
  echo "✗ framework vocab violations found" >&2
  exit 1
fi
