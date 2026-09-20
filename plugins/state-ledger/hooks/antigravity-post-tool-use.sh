#!/bin/sh
# Antigravity PostToolUse → global state-ledger stamp + project knip gate.
# Bridges Antigravity PostToolUse payload ({toolCall:{name,args:{TargetFile,CommandLine}}})
# to state-ledger's post-edit-state-stamp ({tool_input:{file_path,command}}).
# Self-locating via $0.
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${STATE_LEDGER_ROOT:-}" ]; then
  LEDGER_ROOT="$STATE_LEDGER_ROOT"
else
  LEDGER_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
fi
DISPATCH="$LEDGER_ROOT/scripts/hooks/global-state-hook.sh"

input=$(cat 2>/dev/null || true)

if [ ! -f "$DISPATCH" ]; then
  printf '%s\n' '{}'
  exit 0
fi

if command -v node >/dev/null 2>&1; then
  node -e '
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

let raw = "";
process.stdin.on("data", (c) => { raw += c; }).on("end", () => {
  let j = {};
  try { j = JSON.parse(raw || "{}"); } catch { j = {}; }
  if (j === null || typeof j !== "object") j = {};

  const workspaceRoot = (Array.isArray(j.workspacePaths) && j.workspacePaths[0])
    || j.cwd
    || process.cwd();

  let repoRoot = "";
  try {
    const gitRes = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workspaceRoot,
      encoding: "utf8"
    });
    if (gitRes.status === 0 && gitRes.stdout) {
      repoRoot = gitRes.stdout.trim();
    }
  } catch {}

  if (!repoRoot) {
    process.stdout.write("{}\n");
    process.exit(0);
  }

  const hasState = fs.existsSync(path.join(repoRoot, "STATE.md")) || fs.existsSync(path.join(repoRoot, ".staterc"));
  if (!hasState) {
    process.stdout.write("{}\n");
    process.exit(0);
  }

  // Extract modified file path or command from Antigravity toolCall
  const toolCall = j.toolCall || {};
  const args = toolCall.args || {};
  const targetFile = args.TargetFile || args.file_path || args.filePath || args.path || "";
  const command = args.CommandLine || args.command || "";

  // Normalize to Claude/Codex shape expected by downstream hooks
  const normalized = {
    tool_name: toolCall.name || "",
    tool_input: {
      file_path: targetFile,
      command: command
    },
    conversationId: j.conversationId || "",
    stepIdx: j.stepIdx ?? 0
  };

  const dispatch = process.env.DISPATCH;

  // Run stamp hook
  try {
    spawnSync("bash", [dispatch, "stamp"], {
      cwd: repoRoot,
      env: { ...process.env, STATE_LEDGER_HOST: "antigravity", HOOK_PROJECT_DIR: repoRoot },
      input: JSON.stringify(normalized),
      encoding: "utf8"
    });
  } catch {}

  // Run knip hook if present
  const knipHook = path.join(repoRoot, "scripts/hooks/post-edit-knip.sh");
  if (fs.existsSync(knipHook)) {
    try {
      spawnSync("bash", [knipHook], {
        cwd: repoRoot,
        env: { ...process.env, HOOK_PROJECT_DIR: repoRoot },
        input: JSON.stringify(normalized),
        encoding: "utf8"
      });
    } catch {}
  }

  // Antigravity PostToolUse contract expects {}
  process.stdout.write("{}\n");
});
' <<< "$input"
else
  printf '%s\n' '{}'
fi
