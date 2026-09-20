#!/bin/sh
# Antigravity PreInvocation → global state-ledger turn baseline + session-start injection.
# Bridges Antigravity's PreInvocation JSON protocol to state-ledger's global hooks.
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

  // Find git root
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

  // Check if STATE.md or .staterc exists
  const hasState = fs.existsSync(path.join(repoRoot, "STATE.md")) || fs.existsSync(path.join(repoRoot, ".staterc"));
  if (!hasState) {
    process.stdout.write("{}\n");
    process.exit(0);
  }

  const dispatch = process.env.DISPATCH;
  const sid = j.conversationId || j.session_id || j.sessionId || "";
  const normalizedInput = JSON.stringify({
    session_id: sid,
    sessionID: sid,
    conversationId: sid,
    workspacePaths: [repoRoot]
  });

  // 1. Snapshot turn start
  try {
    spawnSync("bash", [dispatch, "turn-start"], {
      cwd: repoRoot,
      env: { ...process.env, STATE_LEDGER_HOST: "antigravity", HOOK_PROJECT_DIR: repoRoot },
      input: normalizedInput,
      encoding: "utf8"
    });
  } catch {}

  // 2. Obtain session start context if needed (inject STATE index and warnings)
  let injectText = "";
  try {
    const sessionRes = spawnSync("bash", [dispatch, "session-start"], {
      cwd: repoRoot,
      env: { ...process.env, STATE_LEDGER_HOST: "antigravity", HOOK_PROJECT_DIR: repoRoot },
      input: normalizedInput,
      encoding: "utf8"
    });
    const out = (sessionRes.stdout || "").trim();
    if (out) {
      try {
        const parsed = JSON.parse(out);
        injectText = parsed?.hookSpecificOutput?.additionalContext
          || parsed?.systemMessage
          || (typeof parsed === "string" ? parsed : "");
      } catch {
        injectText = out;
      }
    }
  } catch {}

  // Also query project session-start-context if present
  const projectHook = path.join(repoRoot, ".agents/hooks/session-start-context.mjs");
  if (fs.existsSync(projectHook)) {
    try {
      const projRes = spawnSync(process.execPath, [projectHook], {
        cwd: repoRoot,
        env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot, HOOK_PROJECT_DIR: repoRoot },
        encoding: "utf8"
      });
      const pOut = (projRes.stdout || "").trim();
      if (pOut) {
        let pText = "";
        try {
          const parsed = JSON.parse(pOut);
          pText = parsed?.hookSpecificOutput?.additionalContext || parsed?.systemMessage || "";
        } catch {
          pText = pOut;
        }
        if (pText) {
          injectText = injectText ? `${injectText}\n\n---\n\n${pText}` : pText;
        }
      }
    } catch {}
  }

  if (injectText) {
    const result = {
      injectSteps: [
        {
          ephemeralMessage: injectText
        }
      ]
    };
    process.stdout.write(JSON.stringify(result) + "\n");
  } else {
    process.stdout.write("{}\n");
  }
});
' <<< "$input"
else
  printf '%s\n' '{}'
fi
