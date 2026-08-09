#!/bin/bash
# Plugin lifecycle dispatcher. Runtime code is owned by the globally installed
# plugin; repositories own only STATE.md, docs/state/**, and optional .staterc.

set -u

mode="${1:-}"
case "$mode" in
  session-start) hook_script="session-start-state-inject.sh" ;;
  turn-start) hook_script="turn-start-state-snapshot.sh" ;;
  stamp) hook_script="post-edit-state-stamp.sh" ;;
  stop) hook_script="stop-state-reminder.sh" ;;
  *) exit 0 ;;
esac

command -v git >/dev/null 2>&1 || exit 0

input=""
if [ ! -t 0 ]; then
  input=$(cat 2>/dev/null || true)
fi

candidate="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
root=$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$root" ] || exit 0

# Global install is inert until a repository declares the ledger with STATE.md
# or .staterc. A .staterc without STATE.md intentionally surfaces a missing-index warning.
[ -f "$root/.staterc" ] || [ -f "$root/STATE.md" ] || exit 0

# During branch-by-branch migration, do not run the same event twice. User-global
# Codex hooks identify themselves explicitly; plugin-bundled Claude hooks do likewise.
case "${STATE_LEDGER_HOST:-}" in
  codex) local_config="$root/.codex/config.toml" ;;
  claude) local_config="$root/.claude/settings.json" ;;
  *)
    if [ -n "${PLUGIN_ROOT:-}" ]; then
      local_config="$root/.codex/config.toml"
    else
      local_config="$root/.claude/settings.json"
    fi
    ;;
esac
if [ -f "$local_config" ] && grep -qF "/$hook_script" "$local_config"; then
  exit 0
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s' "$input" | HOOK_PROJECT_DIR="$root" bash "$script_dir/$hook_script"
