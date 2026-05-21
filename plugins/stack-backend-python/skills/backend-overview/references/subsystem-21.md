> App backend-overview capsule. Source: harness build plans ..

# Subsystem 21 — Commands (harness)

## 목적 (1줄)

Codex/Claude command harness 정의. Codex는 `.agents/skills/codex-commands/`
adapter를 통해 command reference를 읽고, Claude Code는 `.claude/commands/`
를 직접 읽는다. 양쪽 모두 active.

## 파일 구조

```
.agents/skills/codex-commands/
├── SKILL.md
└── references/commands/          # 13 command references
    ├── agent-verify.md
    ├── agent-test.md
    ├── agent-debug.md
    ├── audit-all.md
    ├── new-tool.md
    ├── pre-deploy.md
    ├── spec-diff.md
    └── ...
```

## 작동 방식

Codex는 slash-command runtime을 직접 갖지 않는다. 사용자가 `/command args` 형식으로
요청하면 `codex-commands` skill이 `references/commands/<command>.md` 를 읽고
`$ARGUMENTS`를 args로 치환해 절차를 수행한다.

Claude Code에서는 `.claude/commands/*.md`가 그대로 slash command prompt로
주입된다. `.claude` 와 `.agents/skills/codex-commands/` 양쪽 모두 active —
변경 시 양쪽 동등 유지.

## 담당 skill

`codex-commands` — Codex command adapter.

## 범위

- Codex-facing command 정본은 `.agents/skills/codex-commands/references/commands/` (13개)
- Claude Code 가 직접 읽는 사본은 `.claude/commands/` (13개) — 양쪽 active, 동등 유지
- 새 command 추가 시 `codex-commands/SKILL.md` command map + `references/commands/help.md` 치트시트 + 관련 sub-agent reference + `.claude/commands/` 동시 업데이트

## Gotchas

- **command는 skill의 엔트리포인트**: 자체 로직은 최소. 실제 구현은 skill에.
- **인자 검증**: `$ARGUMENTS`가 비어 있을 때 적절한 fallback 동작 필요.

## 관련 AD

- 전반 — command는 개발자 UX 레이어, AD와 직결되지 않음
