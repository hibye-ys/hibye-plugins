# hibye-plugins

Shared agent assets marketplace for Claude Code + Codex.

## Status

- M0 spike complete (2026-05-21) — see `docs/superpowers/m0-results.md` in the reference implementation project.
- M1 production bootstrap (2026-05-21~) — `stack-backend-ts-hono` + `surface-web-vite-react` 골격 추가.
- M2.5 coverage completion (2026-05-22) — Python → TS 1:1 포트 80 SKILL.md (invariant 16 / workflow 40 / audit 24).
- 2026-05-22 cleanup — `core` + `deprecated-example` plugin 제거 (M0 spike placeholder 잔재). L1 자리는 향후 universal 룰 필요 시 신규 plugin 으로 재구성.

## Plugins

| 이름 | Layer | 목적 |
|---|---|---|
| `stack-backend-ts-hono` | L2 | Hono + Web 표준 (Workers 호환) backend 룰 + `verify-workers-compat` skill. 80 SKILL.md (invariant 16 / workflow 40 / audit 24) |
| `stack-backend-python` | L2 | Python FastAPI AI agent backend 룰 (23) + `_shared` 언어 무관 룰 (14) + 스킬 (45). 본문 식별자는 `<domain>` / `<DOMAIN>` placeholder — 다른 product 적용 시 `sed` 로 자기 도메인 이름 치환. Reference 사례 = `iyaki` |
| `surface-web-vite-react` | L3 | Vite + React + Tailwind v4 토큰 룰 + Pack 시스템 룰 + `verify-token-only-styling` skill |

## Quick Start (신규 프로젝트)

```bash
# 1. 본 셋업 스크립트가 project/.codex/skills/ + ~/.claude/plugins/cache/ 셋업 한 번에
bash /Users/youngseoklee/Desktop/workplace/hibye-plugins/scripts/setup-project.sh \
  <project-dir> stack-backend-ts-hono surface-web-vite-react

# 2. Codex: ~/.codex/config.toml 에 [marketplaces.hibye] 추가 (스크립트가 안내 출력)
#    이미 등록되어 있으면 skip.

# 3. Claude Code: project 안에서
#    /plugin marketplace add /Users/youngseoklee/Desktop/workplace/hibye-plugins
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

대상 프로젝트에서 신규 plugin 2개가 인지되는지 확인:

1. **Claude Code**: fresh 세션 → install 후 `<system-reminder>` 의 available skills 목록에 `verify-workers-compat` + `verify-token-only-styling` 보이는지 확인.
2. **Codex**: `cd <project>` → 활성 skill 목록에 `stack-backend-ts-hono:verify-workers-compat` + `surface-web-vite-react:verify-token-only-styling` 보이는지 확인.
3. **상시 룰 인지**: "이 디렉토리에서 Workers 호환 룰 알려줘" 또는 "토큰 룰 알려줘" 메시지 — `Buffer`/`fs`/`c.env.X` 또는 `bg-card`/`@theme` 같은 어휘 응답에 등장하는지.

결과 = `docs/superpowers/m1-results.md` (대상 프로젝트 측) 에 transcript 기록.

## Scripts

- `scripts/link-cache.sh` — `~/.claude/plugins/cache/hibye-plugins/<plugin>/<version>` 을 marketplace source 로 symlink.
- `scripts/setup-project.sh <project-dir> [plugin ...]` — Codex symlink + cache symlink 한 번에.
