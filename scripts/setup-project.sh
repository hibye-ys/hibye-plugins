#!/usr/bin/env bash
# setup-project.sh v2 — 한 프로젝트에 하네스를 Claude Code / Codex / OpenCode 동시 설치.
#
# 단일 SoT(마켓플레이스 plugin) → 프로젝트에 자산별 배선:
#   skills   : .agents/skills/<s> (Codex+OpenCode) + .claude/skills/<s> → ../../.agents/skills/<s> (Claude)
#   subagent : .claude/agents/*.md / .codex/agents/*.toml / .opencode/agents/*.md
#   hook     : .agents/hooks/<script> + Claude settings.json 머지 / .codex/hooks.json / .opencode/plugins/*-hooks.js
#   command  : .claude/commands / .codex/prompts / .opencode/commands  (plugin 에 commands/ 있을 때)
#   AGENTS.md: AGENTS.<plugin>.md 로 참조 symlink (기존 AGENTS.md 비파괴)
#
# Usage:
#   setup-project.sh --list
#   setup-project.sh <project-dir> [--plugin <name>]... [--skills a,b,c] [--tools claude,codex,opencode] [--no-hooks]
# 예:
#   setup-project.sh ~/proj --plugin backend-ts --skills auth,api-routing
#   setup-project.sh ~/proj --plugin backend-ts --tools claude,codex
set -euo pipefail

MARKET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGINS_DIR="$MARKET/plugins"

# ---- args ----
PROJECT=""
declare -a SEL_PLUGINS=()
SKILLS_CSV=""
TOOLS_CSV="claude,codex,opencode"
DO_HOOKS=1
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --list) LIST=1; shift;;
    --plugin) SEL_PLUGINS+=("$2"); shift 2;;
    --skills) SKILLS_CSV="$2"; shift 2;;
    --tools) TOOLS_CSV="$2"; shift 2;;
    --no-hooks) DO_HOOKS=0; shift;;
    -*) echo "unknown option: $1" >&2; exit 2;;
    *) [ -z "$PROJECT" ] && PROJECT="$1" || { echo "extra arg: $1" >&2; exit 2; }; shift;;
  esac
done

has_tool() { case ",$TOOLS_CSV," in *",$1,"*) return 0;; *) return 1;; esac; }

# ---- --list ----
if [ "$LIST" -eq 1 ]; then
  echo "사용 가능한 plugin (마켓플레이스: $MARKET):"
  for d in "$PLUGINS_DIR"/*/; do
    p="$(basename "$d")"
    s=$( { ls "$d/skills" 2>/dev/null || true; } | wc -l | tr -d ' ')
    a=$( { ls "$d/.codex/agents"/*.toml 2>/dev/null || true; } | wc -l | tr -d ' ')
    h=$( { ls "$d/hooks"/*.mjs 2>/dev/null || true; } | wc -l | tr -d ' ')
    c=$( { ls "$d/commands" 2>/dev/null || true; } | wc -l | tr -d ' ')
    echo "  - $p : skills=$s subagents=$a hooks=$h commands=$c"
  done
  echo ""
  echo "스킬 목록: ls $PLUGINS_DIR/<plugin>/skills"
  exit 0
fi

[ -n "$PROJECT" ] || { echo "ERROR: <project-dir> 필요 (또는 --list)" >&2; exit 2; }
[ -d "$PROJECT" ] || { echo "ERROR: 프로젝트 디렉토리 없음: $PROJECT" >&2; exit 2; }
PROJECT="$(cd "$PROJECT" && pwd)"
[ ${#SEL_PLUGINS[@]} -gt 0 ] || SEL_PLUGINS=("backend-ts")

link() { # src(abs) dst — 멱등 symlink, 비-symlink 충돌은 경고만
  local src="$1" dst="$2"
  if [ -L "$dst" ]; then ln -sfn "$src" "$dst"; return; fi
  if [ -e "$dst" ]; then echo "    WARN: $dst 이미 존재(비-symlink) — skip"; return 1; fi
  ln -sfn "$src" "$dst"
}

merge_json_hooks() { # snippet(abs) target(abs) — .hooks 딥머지 (jq), 없으면 복사
  local snip="$1" tgt="$2"
  if [ ! -f "$tgt" ]; then mkdir -p "$(dirname "$tgt")"; cp "$snip" "$tgt"; echo "    write: $tgt"; return; fi
  if command -v jq >/dev/null; then
    local tmp; tmp="$(mktemp)"
    jq -s '.[0] * .[1]' "$tgt" "$snip" > "$tmp" && mv "$tmp" "$tgt"
    echo "    merge(jq): $tgt  (동일 이벤트 hooks 는 교체됨)"
  else
    echo "    NOTE: jq 없음 — 아래 스니펫을 $tgt 에 수동 머지:"; sed 's/^/      /' "$snip"
  fi
}

echo "프로젝트: $PROJECT"
echo "plugins : ${SEL_PLUGINS[*]}   tools: $TOOLS_CSV   hooks: $DO_HOOKS"
echo ""

for plugin in "${SEL_PLUGINS[@]}"; do
  PP="$PLUGINS_DIR/$plugin"
  [ -d "$PP" ] || { echo "WARN: plugin 없음: $plugin — skip"; continue; }
  echo "══ $plugin ══"

  # ---- 1) skills ----
  if [ -d "$PP/skills" ]; then
    declare -a SKILLS=()
    if [ -n "$SKILLS_CSV" ]; then IFS=',' read -ra SKILLS <<< "$SKILLS_CSV"; else
      for s in "$PP/skills"/*/; do SKILLS+=("$(basename "$s")"); done
    fi
    ( has_tool codex || has_tool opencode ) && mkdir -p "$PROJECT/.agents/skills"
    has_tool claude && mkdir -p "$PROJECT/.claude/skills"
    echo "  [skills] ${#SKILLS[@]}개"
    for s in "${SKILLS[@]}"; do
      [ -d "$PP/skills/$s" ] || { echo "    WARN: 스킬 없음: $s"; continue; }
      if has_tool codex || has_tool opencode; then link "$PP/skills/$s" "$PROJECT/.agents/skills/$s" || true; fi
      if has_tool claude; then
        if [ -e "$PROJECT/.agents/skills/$s" ]; then link "../../.agents/skills/$s" "$PROJECT/.claude/skills/$s" || true
        else link "$PP/skills/$s" "$PROJECT/.claude/skills/$s" || true; fi
      fi
    done
  fi

  # ---- 2) subagents ----
  if has_tool claude && [ -d "$PP/agents" ]; then
    mkdir -p "$PROJECT/.claude/agents"; echo "  [subagent→claude] $(ls "$PP/agents"/*.md 2>/dev/null | wc -l | tr -d ' ')개"
    for f in "$PP/agents"/*.md; do [ -e "$f" ] && link "$f" "$PROJECT/.claude/agents/$(basename "$f")" || true; done
  fi
  if has_tool codex && [ -d "$PP/.codex/agents" ]; then
    mkdir -p "$PROJECT/.codex/agents"; echo "  [subagent→codex] $(ls "$PP/.codex/agents"/*.toml 2>/dev/null | wc -l | tr -d ' ')개"
    for f in "$PP/.codex/agents"/*.toml; do [ -e "$f" ] && link "$f" "$PROJECT/.codex/agents/$(basename "$f")" || true; done
  fi
  if has_tool opencode && [ -d "$PP/opencode/agents" ]; then
    mkdir -p "$PROJECT/.opencode/agents"; echo "  [subagent→opencode] $(ls "$PP/opencode/agents"/*.md 2>/dev/null | wc -l | tr -d ' ')개"
    for f in "$PP/opencode/agents"/*.md; do [ -e "$f" ] && link "$f" "$PROJECT/.opencode/agents/$(basename "$f")" || true; done
  fi

  # ---- 3) hook ----
  if [ "$DO_HOOKS" -eq 1 ] && [ -d "$PP/hooks" ]; then
    echo "  [hook]"
    mkdir -p "$PROJECT/.agents/hooks"
    for sc in "$PP/hooks"/*.mjs; do [ -e "$sc" ] && link "$sc" "$PROJECT/.agents/hooks/$(basename "$sc")" || true; done
    if has_tool claude && [ -f "$PP/dist/claude/settings.hooks.json" ]; then
      merge_json_hooks "$PP/dist/claude/settings.hooks.json" "$PROJECT/.claude/settings.json"
    fi
    if has_tool codex && [ -f "$PP/dist/codex/hooks.json" ]; then
      merge_json_hooks "$PP/dist/codex/hooks.json" "$PROJECT/.codex/hooks.json"
    fi
    if has_tool opencode && [ -f "$PP/dist/opencode/plugins/$plugin-hooks.js" ]; then
      mkdir -p "$PROJECT/.opencode/plugins"
      cp "$PP/dist/opencode/plugins/$plugin-hooks.js" "$PROJECT/.opencode/plugins/$plugin-hooks.js"  # symlink 불가(import.meta realpath)
      echo "    copy: .opencode/plugins/$plugin-hooks.js"
    fi
  fi

  # ---- 4) commands (있을 때) ----
  if [ -d "$PP/commands" ]; then
    echo "  [commands]"
    has_tool claude   && mkdir -p "$PROJECT/.claude/commands"  && for f in "$PP/commands"/*.md; do [ -e "$f" ] && link "$f" "$PROJECT/.claude/commands/$(basename "$f")" || true; done
    has_tool codex    && mkdir -p "$PROJECT/.codex/prompts"    && for f in "$PP/commands"/*.md; do [ -e "$f" ] && link "$f" "$PROJECT/.codex/prompts/$(basename "$f")" || true; done
    has_tool opencode && mkdir -p "$PROJECT/.opencode/commands" && for f in "$PP/commands"/*.md; do [ -e "$f" ] && link "$f" "$PROJECT/.opencode/commands/$(basename "$f")" || true; done
  fi

  # ---- 5) AGENTS.md 참조 (placeholder 매핑 등) ----
  if [ -f "$PP/AGENTS.md" ]; then
    link "$PP/AGENTS.md" "$PROJECT/AGENTS.$plugin.md" || true
    echo "  [rules] AGENTS.$plugin.md (Codex/OpenCode 가 읽도록 프로젝트 AGENTS.md 에서 참조 권장)"
  fi
done

echo ""
echo "완료. 검증:"
echo "  ls -la $PROJECT/.agents/skills $PROJECT/.claude/skills $PROJECT/.claude/agents $PROJECT/.codex/agents $PROJECT/.opencode/agents"
echo "  cat $PROJECT/.codex/hooks.json ; cat $PROJECT/.claude/settings.json"
echo ""
echo "Claude hook/command 를 marketplace plugin 으로도 쓰려면(선택):"
for plugin in "${SEL_PLUGINS[@]}"; do echo "  /plugin install ${plugin}@hibye-plugins"; done
echo "  (그 후) bash $MARKET/scripts/link-cache.sh"
