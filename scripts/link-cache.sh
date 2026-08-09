#!/usr/bin/env bash
# 로컬 marketplace의 Claude Code·Codex 캐시를 source-backed 상태로 유지한다.
# Claude는 버전 디렉터리 자체를 source symlink로 쓸 수 있다. Codex는 최신 CLI가
# symlink 버전 디렉터리를 미설치로 판정하므로 실제 디렉터리 안의 구성요소를
# source symlink로 만들고, lifecycle runtime용 current만 source에 직접 연결한다.

set -euo pipefail

MARKETPLACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$MARKETPLACE_ROOT/plugins" ]; then
    echo "ERROR: marketplace plugins/ not found at $MARKETPLACE_ROOT/plugins"
    exit 1
fi

link_versioned_cache() {
    local plugin_dir="$1"
    local plugin_name="$2"
    local manifest="$3"
    local cache_root="$4"
    local label="$5"
    local layout="$6"

    if [ ! -f "$manifest" ]; then
        echo "SKIP: $label/$plugin_name (no ${manifest#"$plugin_dir"/})"
        return
    fi

    local version
    version="$(grep -E '"version"' "$manifest" | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

    if [ -z "$version" ]; then
        echo "SKIP: $label/$plugin_name (no version in manifest)"
        return
    fi
    if [[ ! "$version" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]; then
        echo "ERROR: $label/$plugin_name has unsafe cache version: $version"
        return 1
    fi

    local target_dir="$cache_root/$plugin_name"
    local target_link="$target_dir/$version"

    mkdir -p "$target_dir"
    rm -rf -- "$target_link.bak"

    if [ "$layout" = "root-link" ]; then
        if [ -e "$target_link" ] && [ ! -L "$target_link" ]; then
            echo "REPLACE: $label generated cache $target_link -> source symlink"
            rm -rf -- "$target_link"
        fi
        ln -sfn "$plugin_dir" "$target_link"
        echo "LINK: $label $target_link -> $plugin_dir"
    else
        # Codex 설치 판정은 version path가 실제 디렉터리여야 한다. 캐시는 언제든
        # 재설치 가능한 생성물이므로 해당 한 버전의 자식만 source link로 재구성한다.
        if [ -L "$target_link" ]; then
            rm -- "$target_link"
        fi
        mkdir -p "$target_link"
        find "$target_link" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
        while IFS= read -r -d '' source_entry; do
            ln -s "$source_entry" "$target_link/$(basename "$source_entry")"
        done < <(find "$plugin_dir" -mindepth 1 -maxdepth 1 -print0)
        echo "LINK: $label $target_link/* -> $plugin_dir/* (source-backed directory)"
    fi

    ln -sfn "$plugin_dir" "$target_dir/current"
    echo "LINK: $label $target_dir/current -> $plugin_dir"
}

for plugin_dir in "$MARKETPLACE_ROOT/plugins/"*/; do
    plugin_name="$(basename "$plugin_dir")"

    link_versioned_cache \
        "$plugin_dir" \
        "$plugin_name" \
        "$plugin_dir/.claude-plugin/plugin.json" \
        "$HOME/.claude/plugins/cache/hibye-plugins" \
        "claude" \
        "root-link"

    link_versioned_cache \
        "$plugin_dir" \
        "$plugin_name" \
        "$plugin_dir/.codex-plugin/plugin.json" \
        "$HOME/.codex/plugins/cache/hibye-plugins" \
        "codex" \
        "source-backed-directory"

    # flat skills/ symlink — Claude와 Codex 프로젝트 링크가 같은 source tree를 보게 한다.
    if [ -d "$plugin_dir/skills" ]; then
        target_dir="$HOME/.claude/plugins/cache/hibye-plugins/$plugin_name"
        mkdir -p "$target_dir"
        ln -sfn "$plugin_dir/skills" "$target_dir/skills"
        echo "LINK: $target_dir/skills -> $plugin_dir/skills (flat)"
    fi
done

echo "DONE"
