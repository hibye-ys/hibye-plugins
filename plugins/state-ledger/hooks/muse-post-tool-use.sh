#!/bin/sh
# Muse PostToolUse → global state-ledger stamp.
# No matcher in the manifest: Muse tool names are unverified, so this wrapper
# normalizes stdin to the Claude-shape {tool_input:{file_path}} downstream expects.
# Project validation hooks are registered by the project, independently.
# Final home: hibye-plugins/plugins/state-ledger/hooks/ (self-locating via $0).
set -u
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${STATE_LEDGER_ROOT:-}" ]; then LEDGER_ROOT="$STATE_LEDGER_ROOT";
else LEDGER_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd); fi
DISPATCH="$LEDGER_ROOT/scripts/hooks/global-state-hook.sh"
EVENT="PostToolUse"

input=$(cat 2>/dev/null || true)
root=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$root" ] || exit 0

if command -v node >/dev/null 2>&1; then
  normalized=$(printf '%s' "$input" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; }).on("end", () => {
  let j = {};
  try { j = JSON.parse(raw || "{}"); } catch { j = {}; }
  if (j === null || typeof j !== "object") j = {};
  const ti = (j.tool_input && typeof j.tool_input === "object") ? j.tool_input : {};
  const file = ti.file_path || ti.filePath || ti.path || ti.filename
    || j.file_path || j.filePath || j.path || "";
  if (file) j.tool_input = Object.assign({}, ti, { file_path: file });
  const sid = j.session_id || j.sessionID || j.sessionId || (j.session && j.session.id) || "";
  if (sid) { j.session_id = j.session_id || sid; j.sessionID = j.sessionID || sid; }
  process.stdout.write(JSON.stringify(j));
});' 2>/dev/null || true)
  [ -n "$normalized" ] || normalized="$input"
else
  normalized="$input"
fi

stamp_out=""
if [ -f "$DISPATCH" ]; then
  stamp_out=$(printf '%s' "$normalized" | STATE_LEDGER_HOST=muse HOOK_PROJECT_DIR="$root" bash "$DISPATCH" stamp 2>/dev/null || true)
fi

if command -v node >/dev/null 2>&1; then
  LEDGER_OUT="$stamp_out" HOOK_EVENT="$EVENT" node -e '
const BUDGET = 15000; // Muse hook stdout ceiling is 16384 bytes; envelope takes the rest.
const ev = process.env.HOOK_EVENT || "PostToolUse";
const b = (s) => Buffer.byteLength(s, "utf8");
function cut(s, n) {
  if (b(s) <= n) return [s, 0];
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b(s.slice(0, mid)) <= n) lo = mid; else hi = mid - 1; }
  const kept = s.slice(0, lo);
  return [kept, b(s) - b(kept)];
}
function ctxOf(raw) {
  const t = (raw || "").trim();
  if (!t) return "";
  try {
    const j = JSON.parse(t);
    return j?.hookSpecificOutput?.additionalContext ?? j?.systemMessage ?? t;
  } catch { return t; }
}
let out = ctxOf(process.env.LEDGER_OUT);
if (!out.trim()) process.exit(0);
if (b(out) > BUDGET) {
  const [k, om] = cut(out, BUDGET - 120);
  out = k + `\n…(truncated ${om} bytes for Muse 16KB hook ceiling)`;
}
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: out } }) + "\n");
'
else
  if [ -n "$stamp_out" ]; then printf '%s\n' "$stamp_out" | head -c 15000; fi
fi
exit 0
