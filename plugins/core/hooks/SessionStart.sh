#!/usr/bin/env bash
# M0 spike #7 — SessionStart hook 발화 검증
# 발화 시 echo 출력 (Claude Code 가 출력을 컨텍스트에 주입한다고 가정).

cat <<'EOF'
M0-HOOK-SESSIONSTART-INVOKED-5b8a

이 메시지가 conversation 컨텍스트에 보이면 plugin SessionStart hook 이 발화한 것.
M0 #7 = PASS.
EOF
