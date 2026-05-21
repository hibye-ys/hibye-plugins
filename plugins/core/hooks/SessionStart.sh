#!/usr/bin/env bash
# M0 spike #7 — SessionStart hook 발화 검증
# 발화 시 JSON envelope 로 sentinel 어휘를 컨텍스트에 주입.
set -euo pipefail

SENTINEL_TEXT="M0-HOOK-SESSIONSTART-INVOKED-5b8a

이 메시지가 conversation 컨텍스트에 보이면 plugin SessionStart hook 이 발화한 것."

cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $(printf '%s' "$SENTINEL_TEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  }
}
JSON
