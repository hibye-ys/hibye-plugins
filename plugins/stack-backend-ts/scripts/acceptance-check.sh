#!/usr/bin/env bash
# acceptance-check.sh — 새 SKILL.md acceptance 검증
# Usage: acceptance-check.sh
set -euo pipefail

SKILLS_DIR="$(dirname "$0")/../skills"
COUNT=0
FAIL=0

for skill_dir in "$SKILLS_DIR"/*/; do
  skill=$(basename "$skill_dir")
  md="$skill_dir/SKILL.md"
  COUNT=$((COUNT+1))

  [ ! -f "$md" ] && { echo "FAIL $skill: SKILL.md missing"; FAIL=$((FAIL+1)); continue; }

  # 1. name = 디렉토리명
  grep -qE "^name:\s*$skill\s*\$" "$md" || { echo "FAIL $skill: name mismatch"; FAIL=$((FAIL+1)); }
  # 2. description 비어있지 않음
  grep -qE "^description:\s*\S" "$md" || { echo "FAIL $skill: empty description"; FAIL=$((FAIL+1)); }
  # 3. role 유효
  grep -qE "^\s*role:\s*(invariant|workflow|audit)\s*\$" "$md" || { echo "FAIL $skill: invalid role"; FAIL=$((FAIL+1)); }
  # 4. scope = apps/api (또는 project — runtime config 류 예외)
  grep -qE "^\s*scope:\s*(apps/api|project)\s*\$" "$md" || { echo "FAIL $skill: invalid scope"; FAIL=$((FAIL+1)); }
  # 5. source 존재
  grep -qE "^\s*source:\s*\S" "$md" || { echo "FAIL $skill: missing source"; FAIL=$((FAIL+1)); }
done

# 6. 캐시 심볼릭 링크 — plugin.json version 동적 + fallback path tolerant
PLUGIN_JSON="$(dirname "$0")/../.claude-plugin/plugin.json"
if command -v jq >/dev/null 2>&1 && [ -f "$PLUGIN_JSON" ]; then
  VERSION="$(jq -r '.version // empty' "$PLUGIN_JSON" 2>/dev/null || echo "")"
else
  VERSION=""
fi
CACHE_BASE="$HOME/.claude/plugins/cache/hibye-plugins/stack-backend-ts"
# 우선순위: (1) plugin.json version path  (2) plugin root 자체 (full symlink)  (3) 1.0.0 (legacy)
CACHE_OK=0
for candidate in "$CACHE_BASE/$VERSION" "$CACHE_BASE" "$CACHE_BASE/1.0.0"; do
  [ -z "$candidate" ] || [ "$candidate" = "$CACHE_BASE/" ] && continue
  if [ -L "$candidate" ] || [ -d "$candidate" ]; then
    CACHE_OK=1
    break
  fi
done
if [ $CACHE_OK -eq 0 ]; then
  echo "WARN: cache link missing under $CACHE_BASE (checked: \$VERSION='$VERSION', root, 1.0.0)"
fi

# 7. forbidden scan
bash "$(dirname "$0")/forbidden-scan.sh" >/dev/null || { echo "FAIL: forbidden-scan"; FAIL=$((FAIL+1)); }

echo ""
echo "=== acceptance-check: $COUNT skills checked, $FAIL failures ==="
[ $FAIL -eq 0 ] || exit 1
