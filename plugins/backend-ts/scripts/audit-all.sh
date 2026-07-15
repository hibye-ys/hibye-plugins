#!/usr/bin/env bash
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$PLUGIN_DIR/skills/backend-audit/scripts/audit.mjs" "$@"
