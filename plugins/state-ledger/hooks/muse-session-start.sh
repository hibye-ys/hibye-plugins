#!/bin/sh
# Muse SessionStart → global state-ledger inject.
# Project memory/intent context is owned by project-context, independently registered.
# Final home: hibye-plugins/plugins/state-ledger/hooks/ (self-locating via $0).
set -u
# Muse 는 Claude 가 아니다 — Claude 세션의 Bash 도구로 띄운 Muse 워커(muse-delegate 스킬)는 부모의 CLAUDE_PROJECT_DIR 을
# 물려받는다. 그대로 두면 dispatcher 가 부모 프로젝트(다른 저장소이거나, 저장소가 아니면 pin 비활성)에 anchor 를 잡는다.
# Muse 의 anchor 는 자기 세션 pin 이다. HOOK_PROJECT_DIR 도 지워 dispatcher 의 pin 규칙(SessionStart 고정, 같은 저장소 검사,
# pin 폴더 소유자·심링크 검사)을 네 어댑터가 똑같이 따르게 한다.
unset HOOK_PROJECT_DIR CLAUDE_PROJECT_DIR
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${STATE_LEDGER_ROOT:-}" ]; then LEDGER_ROOT="$STATE_LEDGER_ROOT";
else LEDGER_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd); fi
DISPATCH="$LEDGER_ROOT/scripts/hooks/global-state-hook.sh"
EVENT="SessionStart"

input=$(cat 2>/dev/null || true)
input=$(printf '%s' "$input" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; }).on("end", () => {
  let j = {};
  try { j = JSON.parse(raw || "{}"); } catch { j = {}; }
  if (j === null || typeof j !== "object") j = {};
  const sid = j.session_id || j.sessionID || j.sessionId || (j.session && j.session.id) || "";
  if (sid) { j.session_id = j.session_id || sid; j.sessionID = j.sessionID || sid; }
  process.stdout.write(JSON.stringify(j));
});' 2>/dev/null || printf '%s' "$input")

ledger_out=""
if [ -f "$DISPATCH" ]; then
  ledger_out=$(printf '%s' "$input" | STATE_LEDGER_HOST=muse bash "$DISPATCH" session-start 2>/dev/null || true)
else
  ledger_out="{\"hookSpecificOutput\":{\"hookEventName\":\"$EVENT\",\"additionalContext\":\"⚠️ state-ledger dispatcher를 찾지 못했습니다 ($DISPATCH). 플러그인 설치를 확인하세요.\"}}"
fi

if command -v node >/dev/null 2>&1; then
  LEDGER_OUT="$ledger_out" HOOK_EVENT="$EVENT" node -e '
const BUDGET = 15000; // Muse hook stdout ceiling is 16384 bytes; envelope takes the rest.
const ev = process.env.HOOK_EVENT || "SessionStart";
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
function wholeTruncate(s) {
  const [k, om] = cut(s, BUDGET - 120);
  return k + `\n…(truncated ${om} bytes for Muse 16KB hook ceiling)`;
}
let out = ctxOf(process.env.LEDGER_OUT);
if (b(out) > BUDGET) out = wholeTruncate(out);
if (!out.trim()) process.exit(0);
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: out } }) + "\n");
'
else
  if [ -n "$ledger_out" ]; then printf '%s\n' "$ledger_out" | head -c 15000; fi
fi
exit 0
