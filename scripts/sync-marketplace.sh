#!/usr/bin/env bash
# sync-marketplace.sh — 마켓플레이스 SoT 에서 각 도구 어댑터를 재생성/검증한다.
#
# plugin 별로 존재하는 생성기를 실행:
#   scripts/gen-subagents.mjs    → Claude agents/*.md + OpenCode opencode/agents/*.md
#   scripts/gen-hooks.mjs        → dist/{claude,codex,opencode} 훅 아티팩트
#   scripts/generate-agents-md.sh→ AGENTS.md (Codex/OpenCode 룰 인덱스)
# 그 후 link-cache.sh 로 Claude 캐시 symlink 갱신 (write 모드).
#
# Usage:
#   sync-marketplace.sh            # 재생성 (in-place) + 캐시 링크
#   sync-marketplace.sh --check    # drift 검증만 (무수정, drift 시 exit 1) — CI/커밋훅용
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGINS_DIR="$ROOT/plugins"
CHECK=0
SELECTED=()
NATIVE=0
for arg in "$@"; do
  case "$arg" in --plugin|--host|--preview|--build-marker) NATIVE=1;; esac
done
if [ "$NATIVE" = 1 ]; then
  exec python3 "$ROOT/scripts/sync-plugins.py" "$@"
fi
if [ "${1:-}" = "--check" ]; then CHECK=1; shift; fi
[ "$#" = 0 ] || { echo "Usage: $0 [--check] | --plugin NAME --host codex|claude|muse [--check|--preview] [--build-marker]" >&2; exit 2; }

fail=0
run_gen() {
  # $1 = 설명, 나머지 = 명령
  local desc="$1"; shift
  if [ "$CHECK" -eq 1 ]; then
    if ! "$@" --check; then echo "  DRIFT: $desc" >&2; fail=1; fi
  else
    "$@"
  fi
}

for plugin_dir in "$PLUGINS_DIR"/*/; do
  pname="$(basename "$plugin_dir")"
  echo "── plugin: $pname ──"

  if [ -f "$plugin_dir/scripts/gen-subagents.mjs" ]; then
    run_gen "$pname subagents" node "$plugin_dir/scripts/gen-subagents.mjs"
  fi
  if [ -f "$plugin_dir/scripts/gen-hooks.mjs" ]; then
    run_gen "$pname hooks" node "$plugin_dir/scripts/gen-hooks.mjs"
  fi
  if [ -f "$plugin_dir/scripts/generate-agents-md.sh" ]; then
    run_gen "$pname AGENTS.md" bash "$plugin_dir/scripts/generate-agents-md.sh"
  fi
done

if [ "$CHECK" -eq 1 ]; then
  if [ "$fail" -ne 0 ]; then
    echo "" >&2
    echo "sync-marketplace --check: DRIFT 발견 — 'bash scripts/sync-marketplace.sh' 로 재생성하세요." >&2
    exit 1
  fi
  echo ""
  echo "sync-marketplace --check: OK (drift 없음)"
  exit 0
fi

echo ""
echo "── Claude 캐시 symlink 갱신 ──"
"$ROOT/scripts/link-cache.sh"

echo ""
echo "sync-marketplace: 완료"
