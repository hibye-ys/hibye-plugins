#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$PLUGIN_DIR/skills"
PROJECT=""
TOOLS_CSV="claude,codex"
EXPECTED_SKILLS=(
  agent-definition
  agent-loop-runtime
  backend-audit
  context-runtime
  http-contract
  mcp-runtime
  provider-runtime
  stream-contract
  subagent-runtime
  tool-runtime
)
EXPECTED_AGENTS=(
  architecture_reviewer
  security_manager
  settings_hooks_maintainer
  test_manager
)
FAIL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --tools) TOOLS_CSV="${2:-}"; shift 2 ;;
    *) echo "usage: acceptance-check.sh [--project <repo>] [--tools claude,codex,opencode]" >&2; exit 2 ;;
  esac
done

if [ -n "$PROJECT" ]; then
  [ -d "$PROJECT" ] || { echo "ERROR: project directory missing: $PROJECT" >&2; exit 2; }
  PROJECT="$(cd "$PROJECT" && pwd)"
fi

has_tool() { case ",$TOOLS_CSV," in *",$1,"*) return 0;; *) return 1;; esac; }

record_fail() {
  echo "FAIL: $*"
  FAIL=$((FAIL + 1))
}

is_expected_agent() {
  local candidate="$1" expected
  for expected in "${EXPECTED_AGENTS[@]}"; do
    [ "$candidate" = "$expected" ] && return 0
  done
  return 1
}

check_link() {
  local link_path="$1" expected="$2"
  if [ ! -L "$link_path" ]; then
    record_fail "$link_path is not a symlink"
    return
  fi
  if ! node -e '
    const fs = require("node:fs")
    process.exit(fs.realpathSync(process.argv[1]) === fs.realpathSync(process.argv[2]) ? 0 : 1)
  ' "$link_path" "$expected"; then
    record_fail "$link_path does not resolve to $expected"
  fi
}

reject_link_to() {
  local link_path="$1" rejected="$2"
  [ -L "$link_path" ] || return 0
  if node -e '
    const fs = require("node:fs")
    process.exit(fs.realpathSync(process.argv[1]) === fs.realpathSync(process.argv[2]) ? 0 : 1)
  ' "$link_path" "$rejected"; then
    record_fail "$link_path is a stale duplicate link to $rejected"
  fi
}

ACTUAL_SKILLS=()
while IFS= read -r skill; do ACTUAL_SKILLS+=("$skill"); done < <(
  find "$SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort
)
if [ "${ACTUAL_SKILLS[*]}" != "${EXPECTED_SKILLS[*]}" ]; then
  record_fail "skill catalog mismatch (expected: ${EXPECTED_SKILLS[*]}; actual: ${ACTUAL_SKILLS[*]})"
fi

ACTUAL_AGENTS=()
while IFS= read -r agent; do ACTUAL_AGENTS+=("$agent"); done < <(
  find "$PLUGIN_DIR/.codex/agents" -mindepth 1 -maxdepth 1 -name '*.toml' -exec basename {} .toml \; | sort
)
if [ "${ACTUAL_AGENTS[*]}" != "${EXPECTED_AGENTS[*]}" ]; then
  record_fail "named-agent catalog mismatch (expected: ${EXPECTED_AGENTS[*]}; actual: ${ACTUAL_AGENTS[*]})"
fi

node "$PLUGIN_DIR/scripts/validate-metadata.mjs" "${EXPECTED_SKILLS[@]}" || FAIL=$((FAIL + 1))

GENERATED="$(bash "$PLUGIN_DIR/scripts/generate-agents-md.sh" --check)"
CURRENT="$(cat "$PLUGIN_DIR/AGENTS.md")"
if [ "$GENERATED" != "$CURRENT" ]; then
  record_fail "AGENTS.md out of sync"
fi

node "$PLUGIN_DIR/scripts/gen-subagents.mjs" --check || FAIL=$((FAIL + 1))
node "$PLUGIN_DIR/scripts/gen-hooks.mjs" --check || FAIL=$((FAIL + 1))
node --check "$PLUGIN_DIR/hooks/session-start-profiler.mjs" || FAIL=$((FAIL + 1))
node --check "$PLUGIN_DIR/skills/backend-audit/scripts/audit.mjs" || FAIL=$((FAIL + 1))

for executable in \
  "$PLUGIN_DIR/scripts/acceptance-check.sh" \
  "$PLUGIN_DIR/scripts/audit-all.sh" \
  "$PLUGIN_DIR/scripts/generate-agents-md.sh" \
  "$PLUGIN_DIR/scripts/validate-metadata.mjs" \
  "$PLUGIN_DIR/hooks/session-start-profiler.mjs" \
  "$PLUGIN_DIR/skills/backend-audit/scripts/audit.mjs"; do
  [ -x "$executable" ] || record_fail "$executable is not executable"
done

CLAUDE_VERSION="$(node -p "require('$PLUGIN_DIR/.claude-plugin/plugin.json').version")"
CACHE_BASE="$HOME/.claude/plugins/cache/hibye-plugins/backend-ts"
if has_tool claude; then
  if [ -n "$PROJECT" ]; then
    check_link "$CACHE_BASE/$CLAUDE_VERSION" "$PLUGIN_DIR"
    check_link "$CACHE_BASE/skills" "$SKILLS_DIR"
    if ! node -e '
      const fs = require("node:fs")
      const path = process.argv[1]
      const data = JSON.parse(fs.readFileSync(path, "utf8"))
      process.exit(data.enabledPlugins?.["backend-ts@hibye-plugins"] === true ? 0 : 1)
    ' "$PROJECT/.claude/settings.json"; then
      record_fail "Claude project-scoped backend-ts plugin is not enabled"
    fi
    if [ -f "$HOME/.claude/settings.json" ] && node -e '
      const fs = require("node:fs")
      const path = process.argv[1]
      const data = JSON.parse(fs.readFileSync(path, "utf8"))
      process.exit(data.enabledPlugins?.["backend-ts@hibye-plugins"] === true ? 0 : 1)
    ' "$HOME/.claude/settings.json"; then
      record_fail "Claude user-scoped backend-ts plugin must not be enabled"
    fi
    for entry in "$PROJECT/.claude/agents"/*.md "$PROJECT/.claude/commands"/*.md; do
      [ -L "$entry" ] || continue
      case "$(readlink "$entry")" in
        "$PLUGIN_DIR"/*) record_fail "duplicate project-local Claude backend-ts asset: $entry" ;;
      esac
    done
  elif [ ! -L "$CACHE_BASE/$CLAUDE_VERSION" ] || [ ! -L "$CACHE_BASE/skills" ]; then
    echo "WARN: Claude source-sharing links are missing under $CACHE_BASE"
  fi
fi

if [ -n "$PROJECT" ] && has_tool codex; then
  if [ -e "$HOME/.codex/skills/backend-ts" ] || [ -L "$HOME/.codex/skills/backend-ts" ]; then
    record_fail "Codex user-scoped backend-ts skill catalog must not exist"
  fi
  check_link "$PROJECT/.codex/skills/backend-ts" "$SKILLS_DIR"
  check_link "$PROJECT/.agents/hooks/session-start-profiler.mjs" "$PLUGIN_DIR/hooks/session-start-profiler.mjs"
  check_link "$PROJECT/.codex/prompts/setup-harness.md" "$PLUGIN_DIR/commands/setup-harness.md"
  reject_link_to "$PROJECT/AGENTS.backend-ts.md" "$PLUGIN_DIR/AGENTS.md"
  for agent in "${EXPECTED_AGENTS[@]}"; do
    check_link "$PROJECT/.codex/agents/$agent.toml" "$PLUGIN_DIR/.codex/agents/$agent.toml"
  done
  for entry in "$PROJECT/.codex/agents"/*.toml; do
    [ -L "$entry" ] || continue
    case "$(readlink "$entry")" in
      "$PLUGIN_DIR/.codex/agents/"*)
        name="$(basename "$entry" .toml)"
        is_expected_agent "$name" || record_fail "stale backend-ts Codex agent link: $entry"
        ;;
    esac
  done
  # Codex는 SessionStart 훅을 .codex/hooks.json 또는 .codex/config.toml 의 inline
  # [[hooks.SessionStart.hooks]] 중 하나로 선언한다. 둘을 함께 두면 Codex가 merge하며
  # 경고하므로 정확히 하나만 인정한다. 판정은 detect-codex-hook.mjs 가 소유한다 —
  # 문자열 포함이 아니라 profiler 경로가 이 프로젝트를 가리키는지까지 본다.
  HOOK_LINES="$(node "$PLUGIN_DIR/scripts/detect-codex-hook.mjs" --project "$PROJECT")"
  HOOK_SOURCES="$(printf '%s' "$HOOK_LINES" | paste -sd' ' -)"
  HOOK_SOURCE_COUNT="$(printf '%s' "$HOOK_LINES" | grep -c . || true)"
  if [ "$HOOK_SOURCE_COUNT" -eq 0 ]; then
    record_fail "Codex SessionStart hook is not installed (declare it in .codex/hooks.json or as inline [[hooks.SessionStart.hooks]] in .codex/config.toml, pointing at this project's .agents/hooks/session-start-profiler.mjs)"
  elif [ "$HOOK_SOURCE_COUNT" -gt 1 ]; then
    record_fail "Codex SessionStart hook declared in $HOOK_SOURCES; Codex merges both and warns — keep exactly one"
  fi
fi

if [ -n "$PROJECT" ] && has_tool opencode; then
  check_link "$PROJECT/.agents/skills/backend-ts" "$SKILLS_DIR"
  check_link "$PROJECT/.opencode/commands/setup-harness.md" "$PLUGIN_DIR/commands/setup-harness.md"
  for agent in "${EXPECTED_AGENTS[@]}"; do
    check_link "$PROJECT/.opencode/agents/$agent.md" "$PLUGIN_DIR/opencode/agents/$agent.md"
  done
  [ -f "$PROJECT/.opencode/plugins/backend-ts-hooks.js" ] || record_fail "OpenCode hook adapter missing"
fi

echo
echo "=== acceptance-check: ${#EXPECTED_SKILLS[@]} skills, ${#EXPECTED_AGENTS[@]} agents, $FAIL failures ==="
[ "$FAIL" -eq 0 ]
