#!/bin/sh
# Antigravity Stop → global state-ledger stop reminder.
# Warn-only reminder: surfaces uncommitted code debt / unupdated STATE.md.
# Emits decision: "continue" at most once per execution loop to prevent deadlock.
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
  printf '%s\n' '{"decision":"allow"}'
  exit 0
fi

if command -v node >/dev/null 2>&1; then
  node -e '
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
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
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
    process.exit(0);
  }

  const hasState = fs.existsSync(path.join(repoRoot, "STATE.md")) || fs.existsSync(path.join(repoRoot, ".staterc"));
  if (!hasState) {
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
    process.exit(0);
  }

  // Prevent infinite loop: if already re-entered (executionNum > 1) or flagged, allow stop
  const sid = j.conversationId || j.session_id || "default";
  const executionNum = Number(j.executionNum || 1);
  const flagFile = path.join(os.tmpdir(), `antigravity-state-stop-${sid}.flag`);

  if (executionNum > 1 || fs.existsSync(flagFile)) {
    try { fs.unlinkSync(flagFile); } catch {}
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
    process.exit(0);
  }

  const dispatch = process.env.DISPATCH;
  const normalized = {
    session_id: sid,
    sessionID: sid,
    conversationId: sid,
    stop_hook_active: false
  };

  let stopOut = "";
  try {
    const res = spawnSync("bash", [dispatch, "stop"], {
      cwd: repoRoot,
      env: { ...process.env, STATE_LEDGER_HOST: "antigravity", HOOK_PROJECT_DIR: repoRoot },
      input: JSON.stringify(normalized),
      encoding: "utf8"
    });
    stopOut = (res.stdout || "").trim();
  } catch {}

  let reminderMsg = "";
  if (stopOut) {
    try {
      const parsed = JSON.parse(stopOut);
      reminderMsg = parsed?.systemMessage || parsed?.hookSpecificOutput?.additionalContext || "";
    } catch {
      reminderMsg = stopOut;
    }
  }

  if (reminderMsg && reminderMsg.trim()) {
    // Record flag so subsequent Stop in the same loop allows exit
    try { fs.writeFileSync(flagFile, "1"); } catch {}
    process.stdout.write(JSON.stringify({
      decision: "continue",
      reason: "⚠️ STATE.md 원장 검토 필요:\n" + reminderMsg.trim()
    }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  }
});
' <<< "$input"
else
  printf '%s\n' '{"decision":"allow"}'
fi
