#!/usr/bin/env bash
# 사용자 글로벌 CLAUDE.md 의 cache symlink 패턴.
# Claude Code 의 ~/.claude/plugins/cache/hibye-plugins/<plugin>/<version> 을
# 본 마켓플레이스 plugins/<plugin> 디렉토리로 symlink 한다.

set -euo pipefail

MARKETPLACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_ROOT="$HOME/.claude/plugins/cache/hibye-plugins"

if [ ! -d "$MARKETPLACE_ROOT/plugins" ]; then
    echo "ERROR: marketplace plugins/ not found at $MARKETPLACE_ROOT/plugins"
    exit 1
fi

for plugin_dir in "$MARKETPLACE_ROOT/plugins/"*/; do
    plugin_name="$(basename "$plugin_dir")"
    plugin_manifest="$plugin_dir/.claude-plugin/plugin.json"

    if [ ! -f "$plugin_manifest" ]; then
        echo "SKIP: $plugin_name (no .claude-plugin/plugin.json)"
        continue
    fi

    version="$(grep -E '"version"' "$plugin_manifest" | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

    if [ -z "$version" ]; then
        echo "SKIP: $plugin_name (no version in manifest)"
        continue
    fi

    target_dir="$CACHE_ROOT/$plugin_name"
    target_link="$target_dir/$version"

    mkdir -p "$target_dir"
    if [ -e "$target_link" ] && [ ! -L "$target_link" ]; then
        echo "REPLACE: generated cache $target_link -> source symlink"
        rm -rf -- "$target_link"
    fi
    rm -rf -- "$target_link.bak"

    ln -sfn "$plugin_dir" "$target_link"
    echo "LINK: $target_link -> $plugin_dir"

    # flat skills/ symlink — Claude와 Codex 프로젝트 링크가 같은 source tree를 보게 한다.
    if [ -d "$plugin_dir/skills" ]; then
        ln -sfn "$plugin_dir/skills" "$target_dir/skills"
        echo "LINK: $target_dir/skills -> $plugin_dir/skills (flat)"
    fi
done

echo "DONE"
