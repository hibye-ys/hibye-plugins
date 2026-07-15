#!/usr/bin/env bash
# setup-project.sh v2 — 한 프로젝트에 하네스를 Claude Code / Codex / OpenCode 동시 설치.
#
# 단일 SoT(마켓플레이스 plugin) → 프로젝트에 자산별 배선:
#   skills   : .agents/skills/<s> (Codex+OpenCode) + .claude/skills/<s> → ../../.agents/skills/<s> (Claude)
#   subagent : .claude/agents/*.md / .codex/agents/*.toml / .opencode/agents/*.md
#   hook     : .agents/hooks/<script> + Claude settings.json 머지 / .codex/hooks.json / .opencode/plugins/*-hooks.js
#   command  : .claude/commands / .codex/prompts / .opencode/commands  (plugin 에 commands/ 있을 때)
#   AGENTS.md: 별도 규칙 파일이 필요한 일반 plugin만 AGENTS.<plugin>.md 참조 symlink
#
# Usage:
#   setup-project.sh --list
#   setup-project.sh <project-dir> [--plugin <name>]... [--skills a,b,c] [--tools claude,codex,opencode] [--no-hooks]
# 예:
#   setup-project.sh ~/proj --plugin backend-ts
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

prune_plugin_skill_links() { # plugin path를 직접 가리키는 예전 개별 skill 링크 제거
  local plugin="$1"
  shift
  local root entry target
  for root in "$@"; do
    [ -d "$root" ] || continue
    for entry in "$root"/*; do
      [ -L "$entry" ] || continue
      target="$(readlink "$entry")"
      case "$target" in
        *"/plugins/$plugin/skills/"*)
          rm "$entry"
          echo "    prune stale link: $entry"
          ;;
      esac
    done
  done
}

prune_removed_links() { # source에서 제거된 파일을 가리키는 project symlink 정리
  local source_dir="$1" target_dir="$2"
  local entry target
  [ -d "$target_dir" ] || return 0
  for entry in "$target_dir"/*; do
    [ -L "$entry" ] || continue
    target="$(readlink "$entry")"
    case "$target" in
      "$source_dir"/*)
        if [ ! -e "$target" ]; then
          rm "$entry"
          echo "    prune removed link: $entry"
        fi
        ;;
    esac
  done
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
    if [ "$plugin" = "backend-ts" ]; then
      [ -z "$SKILLS_CSV" ] || echo "    WARN: backend-ts --skills 선택은 무시 — 단일 catalog 링크 사용"
      prune_plugin_skill_links "$plugin" "$PROJECT/.agents/skills" "$PROJECT/.claude/skills"
      if has_tool codex; then
        mkdir -p "$PROJECT/.codex/skills"
        link "$PP/skills" "$PROJECT/.codex/skills/$plugin" || true
      fi
      if has_tool opencode; then
        mkdir -p "$PROJECT/.agents/skills"
        link "$PP/skills" "$PROJECT/.agents/skills/$plugin" || true
      fi
      echo "  [skills] backend-ts catalog → plugin source (복사본 없음)"
    else
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
  fi

  # ---- 2) subagents ----
  # backend-ts Claude assets are provided by the project-scoped plugin. The
  # cache remains global, but activation is restricted to this repository.
  # Project-local duplicates would register the same named agents twice.
  prune_removed_links "$PP/agents" "$PROJECT/.claude/agents"
  prune_removed_links "$PP/.codex/agents" "$PROJECT/.codex/agents"
  prune_removed_links "$PP/opencode/agents" "$PROJECT/.opencode/agents"
  if has_tool claude && [ "$plugin" != "backend-ts" ] && [ -d "$PP/agents" ]; then
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
    # backend-ts Claude hook is loaded by the project-scoped plugin. Codex has
    # no equivalent marketplace install here, so only Codex gets a project hook.
    if has_tool claude && [ "$plugin" != "backend-ts" ] && [ -f "$PP/dist/claude/settings.hooks.json" ]; then
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
    if has_tool claude && [ "$plugin" != "backend-ts" ]; then
      mkdir -p "$PROJECT/.claude/commands"
      for f in "$PP/commands"/*.md; do [ -e "$f" ] && link "$f" "$PROJECT/.claude/commands/$(basename "$f")" || true; done
    fi
    has_tool codex    && mkdir -p "$PROJECT/.codex/prompts"    && for f in "$PP/commands"/*.md; do [ -e "$f" ] && link "$f" "$PROJECT/.codex/prompts/$(basename "$f")" || true; done
    has_tool opencode && mkdir -p "$PROJECT/.opencode/commands" && for f in "$PP/commands"/*.md; do [ -e "$f" ] && link "$f" "$PROJECT/.opencode/commands/$(basename "$f")" || true; done
  fi

  # ---- 5) AGENTS.md 참조 ----
  # backend-ts 규칙은 skill과 project root AGENTS.md에서 주입된다. 생성 산출물인
  # plugin/AGENTS.md를 프로젝트에 다시 연결하면 자동 발견되지 않는 중복 문서만 남는다.
  if [ "$plugin" = "backend-ts" ]; then
    rules_link="$PROJECT/AGENTS.$plugin.md"
    if [ -L "$rules_link" ]; then
      if node -e '
        const fs = require("node:fs")
        process.exit(fs.realpathSync(process.argv[1]) === fs.realpathSync(process.argv[2]) ? 0 : 1)
      ' "$rules_link" "$PP/AGENTS.md"; then
        rm "$rules_link"
        echo "  [rules] prune stale project link: AGENTS.$plugin.md"
      else
        echo "  [rules] WARN: 다른 대상을 가리키는 $rules_link — 유지"
      fi
    fi
  elif [ -f "$PP/AGENTS.md" ]; then
    link "$PP/AGENTS.md" "$PROJECT/AGENTS.$plugin.md" || true
    echo "  [rules] AGENTS.$plugin.md (Codex/OpenCode 가 읽도록 프로젝트 AGENTS.md 에서 참조 권장)"
  fi
done

for plugin in "${SEL_PLUGINS[@]}"; do
  if [ "$plugin" = "backend-ts" ]; then
    if has_tool claude; then
      command -v claude >/dev/null || { echo "ERROR: Claude CLI가 없어 project-scope plugin을 설치할 수 없습니다." >&2; exit 1; }
      echo ""
      echo "[claude] backend-ts project scope"
      (
        cd "$PROJECT"
        claude plugin install backend-ts@hibye-plugins --scope project
      )
      if [ -f "$HOME/.claude/settings.json" ] && node -e '
        const fs = require("node:fs")
        const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
        process.exit(data.enabledPlugins?.["backend-ts@hibye-plugins"] === true ? 0 : 1)
      ' "$HOME/.claude/settings.json"; then
        claude plugin uninstall backend-ts@hibye-plugins --scope user --keep-data
      fi
      bash "$MARKET/scripts/link-cache.sh"
    fi
    echo ""
    echo "[acceptance] backend-ts project harness"
    bash "$PLUGINS_DIR/backend-ts/scripts/acceptance-check.sh" \
      --project "$PROJECT" \
      --tools "$TOOLS_CSV"
  fi
done

echo ""
echo "완료. 검증:"
echo "  ls -la $PROJECT/.agents/skills $PROJECT/.claude/skills $PROJECT/.claude/agents $PROJECT/.codex/agents $PROJECT/.opencode/agents"
echo "  cat $PROJECT/.codex/hooks.json ; cat $PROJECT/.claude/settings.json"
echo ""
echo "Claude marketplace plugin 확인:"
for plugin in "${SEL_PLUGINS[@]}"; do
  if [ "$plugin" = "backend-ts" ]; then
    echo "  ${plugin}@hibye-plugins 는 이 프로젝트의 .claude/settings.json 에만 활성화됩니다."
  else
    echo "  /plugin install ${plugin}@hibye-plugins (선택)"
  fi
done
echo "  설치·업데이트 후: bash $MARKET/scripts/link-cache.sh"
