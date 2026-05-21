# hibye-plugins

Shared agent assets marketplace for Claude Code + Codex.

## Status

- M0 spike complete (2026-05-21) — see `docs/superpowers/m0-results.md` in iyaki-rebuild.
- M1 production bootstrap (2026-05-21~) — `stack-backend-ts-hono` + `surface-web-vite-react` 골격 추가.

## Plugins

| 이름 | Layer | 목적 |
|---|---|---|
| `core` | L1 | 진입점 + `using-marketplace` bootstrap skill + `debug-session` skill |
| `stack-backend-ts-hono` | L2 | Hono + Web 표준 (Workers 호환) backend 룰 + `verify-workers-compat` skill |
| `stack-backend-python` | L2 | Python FastAPI AI agent backend 룰 (23) + `_shared` 언어 무관 룰 (14) + 스킬 (45) — ref/iyaki-zip-ai legacy 보존 |
| `surface-web-vite-react` | L3 | Vite + React + Tailwind v4 토큰 룰 + Pack 시스템 룰 + `verify-token-only-styling` skill |
| `deprecated-example` | — | M0 #10 deprecation 시그널 검증 fixture |

## Quick Start (신규 프로젝트)

```bash
# 1. 본 셋업 스크립트가 project/.codex/skills/ + ~/.claude/plugins/cache/ 셋업 한 번에
bash /Users/youngseoklee/Desktop/workplace/hibye-plugins/scripts/setup-project.sh \
  <project-dir> core stack-backend-ts-hono surface-web-vite-react

# 2. Codex: ~/.codex/config.toml 에 [marketplaces.hibye] 추가 (스크립트가 안내 출력)
#    이미 등록되어 있으면 skip.

# 3. Claude Code: project 안에서
#    /plugin marketplace add /Users/youngseoklee/Desktop/workplace/hibye-plugins
#    /plugin install core@hibye-plugins
#    /plugin install stack-backend-ts-hono@hibye-plugins
#    /plugin install surface-web-vite-react@hibye-plugins
```

## Install (Claude Code, 단일 plugin)

```bash
/plugin marketplace add /Users/youngseoklee/Desktop/workplace/hibye-plugins
/plugin install <plugin-name>@hibye-plugins
```

## Register (Codex)

`~/.codex/config.toml`:

```toml
[marketplaces.hibye]
source_type = "local"
source = "/Users/youngseoklee/Desktop/workplace/hibye-plugins"
```

Project-side activation = `project/.codex/skills/<plugin>/ -> <marketplace>/plugins/<plugin>/skills/` (`scripts/setup-project.sh` 자동).

## Smoke test (M1)

iyaki-rebuild 에서 신규 plugin 2개가 인지되는지 확인:

1. **Claude Code**: fresh 세션 → install 후 `<system-reminder>` 의 available skills 목록에 `verify-workers-compat` + `verify-token-only-styling` 보이는지 확인.
2. **Codex**: `cd <project>` → 활성 skill 목록에 `stack-backend-ts-hono:verify-workers-compat` + `surface-web-vite-react:verify-token-only-styling` 보이는지 확인.
3. **상시 룰 인지**: "이 디렉토리에서 Workers 호환 룰 알려줘" 또는 "토큰 룰 알려줘" 메시지 — `Buffer`/`fs`/`c.env.X` 또는 `bg-card`/`@theme` 같은 어휘 응답에 등장하는지.

결과 = `docs/superpowers/m1-results.md` (iyaki-rebuild 측) 에 transcript 기록.

## Scripts

- `scripts/link-cache.sh` — `~/.claude/plugins/cache/hibye-plugins/<plugin>/<version>` 을 marketplace source 로 symlink.
- `scripts/setup-project.sh <project-dir> [plugin ...]` — Codex symlink + cache symlink 한 번에.
