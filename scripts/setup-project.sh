#!/usr/bin/env bash
set -euo pipefail

# Usage: setup-project.sh <project-dir> [plugin-name ...]
# Example: setup-project.sh /path/to/your-project stack-backend-ts-hono frontend-react-web
#
# 동작:
#   1. <project-dir>/.codex/skills/<plugin>/ 에 marketplace plugin skills/ 로 nested symlink
#   2. ~/.claude/plugins/cache/hibye-plugins/<plugin>/<version> cache symlink 갱신 (link-cache.sh 위임)
#   3. Codex config.toml 추가 안내 출력 (자동 편집 ✕)

PROJECT_DIR="${1:?usage: $0 <project-dir> [plugin-name ...]}"
shift || true
PLUGINS=("$@")

if [ ${#PLUGINS[@]} -eq 0 ]; then
  PLUGINS=("stack-backend-ts-hono" "frontend-react-web")
fi

MARKETPLACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "ERROR: project dir not found: $PROJECT_DIR" >&2
  exit 1
fi

# 1. Codex skill symlink (nested 구조 — M0 #2/#8 PASS)
CODEX_SKILLS_DIR="$PROJECT_DIR/.codex/skills"
mkdir -p "$CODEX_SKILLS_DIR"

echo "[1/2] Codex nested symlink..."
for plugin in "${PLUGINS[@]}"; do
  src="$MARKETPLACE_DIR/plugins/$plugin/skills"
  dst="$CODEX_SKILLS_DIR/$plugin"
  if [ ! -d "$src" ]; then
    echo "  WARN: $plugin has no skills/ dir, skipping symlink" >&2
    continue
  fi
  if [ -L "$dst" ]; then
    echo "  exists: $dst -> $(readlink "$dst")"
  elif [ -e "$dst" ]; then
    echo "  WARN: $dst exists and is not a symlink — skip" >&2
  else
    ln -s "$src" "$dst"
    echo "  linked: $dst -> $src"
  fi
done

# 2. Cache symlink refresh (link-cache.sh 위임)
echo ""
echo "[2/2] Cache symlink refresh..."
"$MARKETPLACE_DIR/scripts/link-cache.sh"

echo ""
echo "setup-project complete."
echo ""
echo "Next steps (Claude Code):"
echo "  cd \"$PROJECT_DIR\""
for plugin in "${PLUGINS[@]}"; do
  echo "  /plugin install ${plugin}@hibye-plugins"
done
echo ""
echo "Next steps (Codex):"
echo "  add to ~/.codex/config.toml if not yet:"
echo "    [marketplaces.hibye]"
echo "    source_type = \"local\""
echo "    source = \"$MARKETPLACE_DIR\""
