#!/usr/bin/env bash
# migrate-global-skills-to-iyaki.sh
#
# 1회용 마이그레이션: 글로벌 범용 스킬(~/.agents/skills)을 iyaki-rebuild 프로젝트로 이동하고,
# 글로벌 스킬 디렉토리를 keep-list 만 남기고 정리(fresh start)한다.
#
# keep(글로벌 유지): find-skills, using-superpowers (~/.agents/skills) / graphify(~/.claude/skills, real)
#                    / Codex ~/.codex/skills/.system (내장, 불가침)
# move → iyaki-rebuild: 나머지 ~/.agents/skills/* 전부
# delete: Codex develop-web-game, openai-docs, codex-primary-runtime + 글로벌 dangling symlink
#
# 기본은 DRY-RUN(미리보기만). 실제 적용은 --apply.
#   migrate-global-skills-to-iyaki.sh            # dry-run
#   migrate-global-skills-to-iyaki.sh --apply    # 실제 수행
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

HOME_DIR="$HOME"
AGENTS_DIR="$HOME_DIR/.agents/skills"
IYAKI="$HOME_DIR/Desktop/workplace/iyaki-rebuild"
IYAKI_AGENTS="$IYAKI/.agents/skills"
IYAKI_CLAUDE="$IYAKI/.claude/skills"
LOCK="$HOME_DIR/.agents/.skill-lock.json"

# 글로벌에 남길 스킬 (~/.agents/skills 기준)
KEEP_AGENTS=" find-skills using-superpowers "
# Codex 명시 삭제 대상 (~/.codex/skills 하위, .system 제외)
CODEX_DELETE=" develop-web-game openai-docs codex-primary-runtime "
# 정리 대상 글로벌 스킬 디렉토리 (dangling symlink 제거)
GLOBAL_SKILL_DIRS=(
  "$HOME_DIR/.claude/skills"
  "$HOME_DIR/.codex/skills"
  "$HOME_DIR/.config/opencode/skills"
)

say()  { printf '%s\n' "$*"; }
hr()   { printf -- '----------------------------------------\n'; }
# 적용 여부에 따라 실행 또는 미리보기
run() {
  if [ "$APPLY" -eq 1 ]; then
    "$@"
  else
    printf '  [dry-run] %s\n' "$*"
  fi
}

if [ "$APPLY" -eq 1 ]; then
  say "=== APPLY MODE — 실제 변경을 수행합니다 ==="
else
  say "=== DRY-RUN — 미리보기만 (실제 변경은 --apply) ==="
fi
say "iyaki-rebuild: $IYAKI"
hr

# 0) 사전 검증
[ -d "$AGENTS_DIR" ]    || { echo "ERROR: $AGENTS_DIR 없음" >&2; exit 1; }
[ -d "$IYAKI_AGENTS" ]  || { echo "ERROR: $IYAKI_AGENTS 없음 (iyaki 하네스 스캐폴드 필요)" >&2; exit 1; }
[ -d "$IYAKI_CLAUDE" ]  || { echo "ERROR: $IYAKI_CLAUDE 없음" >&2; exit 1; }

# 1) 이동 + Claude 미러 symlink
say "[1] ~/.agents/skills → iyaki-rebuild 이동"
MOVED=()
for src in "$AGENTS_DIR"/*; do
  [ -e "$src" ] || continue
  name="$(basename "$src")"
  # keep-list 는 건너뜀
  case "$KEEP_AGENTS" in *" $name "*) say "  keep   $name"; continue;; esac
  # real dir 만 이동 (symlink 는 글로벌 잔재 — 무시)
  if [ -L "$src" ]; then say "  skip   $name (symlink, not real)"; continue; fi
  dst="$IYAKI_AGENTS/$name"
  if [ -e "$dst" ]; then
    say "  WARN   $name — 대상에 이미 존재, skip (파괴 금지)"
    continue
  fi
  say "  move   $name  →  .agents/skills/$name"
  run mv "$src" "$dst"
  MOVED+=("$name")
done

hr
say "[2] iyaki .claude/skills/<skill> → ../../.agents/skills/<skill> symlink"
for name in "${MOVED[@]:-}"; do
  [ -n "$name" ] || continue
  link="$IYAKI_CLAUDE/$name"
  if [ -L "$link" ] || [ -e "$link" ]; then
    say "  exists $name"
    continue
  fi
  say "  link   .claude/skills/$name"
  run ln -sfn "../../.agents/skills/$name" "$link"
done

hr
say "[3] 글로벌 정리 — dangling symlink 제거 (keep target 은 valid → 자동 보존)"
for d in "${GLOBAL_SKILL_DIRS[@]}"; do
  [ -d "$d" ] || continue
  say "  dir: $d"
  for e in "$d"/*; do
    [ -e "$e" ] || [ -L "$e" ] || continue
    base="$(basename "$e")"
    if [ -L "$e" ] && [ ! -e "$e" ]; then
      say "    rm dangling: $base"
      run rm -f "$e"
    fi
  done
done

hr
say "[4] Codex 명시 삭제 대상 (.system 은 불가침)"
CODEX_DIR="$HOME_DIR/.codex/skills"
for name in $CODEX_DELETE; do
  t="$CODEX_DIR/$name"
  if [ "$name" = ".system" ]; then continue; fi
  if [ -e "$t" ] || [ -L "$t" ]; then
    say "    rm: .codex/skills/$name"
    run rm -rf "$t"
  fi
done

hr
say "[5] skill-lock 백업 (수동 prune 권장)"
if [ -f "$LOCK" ]; then
  say "    backup: $LOCK → $LOCK.bak-migrate"
  run cp "$LOCK" "$LOCK.bak-migrate"
  say "    NOTE: 이동된 스킬 항목은 lock 에 잔존 — npx skills 재사용 시 정리 권장."
fi

hr
say "완료. 검증 명령:"
say "  ls -la $IYAKI_AGENTS"
say "  ls -la $IYAKI_CLAUDE"
say "  ls -la ~/.claude/skills ~/.codex/skills ~/.config/opencode/skills ~/.agents/skills"
say "  find $IYAKI_CLAUDE -type l ! -exec test -e {} \\; -print   # dangling 없어야 함"
[ "$APPLY" -eq 0 ] && say "" && say ">>> 실제 적용: bash scripts/migrate-global-skills-to-iyaki.sh --apply"
