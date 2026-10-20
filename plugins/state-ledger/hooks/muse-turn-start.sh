#!/bin/sh
# Muse UserPromptSubmit → global state-ledger turn baseline.
# Final home: hibye-plugins/plugins/state-ledger/hooks/ (self-locating via $0).
set -u
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${STATE_LEDGER_ROOT:-}" ]; then LEDGER_ROOT="$STATE_LEDGER_ROOT";
else LEDGER_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd); fi
DISPATCH="$LEDGER_ROOT/scripts/hooks/global-state-hook.sh"
EVENT="UserPromptSubmit"

input=$(cat 2>/dev/null || true)
if command -v node >/dev/null 2>&1; then
  normalized_sid=$(printf '%s' "$input" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; }).on("end", () => {
  let j = {};
  try { j = JSON.parse(raw || "{}"); } catch { j = {}; }
  if (j === null || typeof j !== "object") j = {};
  const sid = j.session_id || j.sessionID || j.sessionId || (j.session && j.session.id) || "";
  if (sid) { j.session_id = j.session_id || sid; j.sessionID = j.sessionID || sid; }
  process.stdout.write(JSON.stringify(j));
});' 2>/dev/null || true)
  [ -n "$normalized_sid" ] && input="$normalized_sid"
fi
if [ ! -f "$DISPATCH" ]; then
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"$EVENT\",\"additionalContext\":\"⚠️ state-ledger dispatcher를 찾지 못했습니다 ($DISPATCH). 플러그인 설치를 확인하세요.\"}}"
  exit 0
fi
raw_out=$(printf '%s' "$input" | STATE_LEDGER_HOST=muse bash "$DISPATCH" turn-start 2>/dev/null || true)
if command -v node >/dev/null 2>&1; then
  RAW_OUT="$raw_out" HOOK_EVENT="$EVENT" node -e '
const BUDGET = 15000; // Muse hook stdout ceiling is 16384 bytes.
const ev = process.env.HOOK_EVENT || "UserPromptSubmit";
const t = (process.env.RAW_OUT || "").trim();
if (!t) process.exit(0);
if (Buffer.byteLength(t, "utf8") <= BUDGET + 300) { process.stdout.write(t + "\n"); process.exit(0); }
let ctx = t;
try {
  const j = JSON.parse(t);
  ctx = j?.hookSpecificOutput?.additionalContext ?? j?.systemMessage ?? t;
} catch { /* raw text */ }
const b = (s) => Buffer.byteLength(s, "utf8");
let lo = 0, hi = ctx.length;
while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b(ctx.slice(0, mid)) <= BUDGET - 120) lo = mid; else hi = mid - 1; }
const kept = ctx.slice(0, lo);
const om = b(ctx) - b(kept);
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: kept + `\n…(truncated ${om} bytes for Muse 16KB hook ceiling)` } }) + "\n");
'
else
  printf '%s' "$raw_out" | head -c 15000
fi
exit 0
