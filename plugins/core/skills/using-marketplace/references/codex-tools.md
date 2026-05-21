# Codex Tool Name Mapping

본 문서는 Claude Code 도구 이름이 Codex 환경에서 어떻게 매핑되는지 안내. superpowers 검증 패턴 따름.

## 매핑 표

| Claude Code | Codex |
|-------------|-------|
| `Task` (subagent dispatch) | `spawn_agent` / `wait_agent` / `close_agent` |
| `TodoWrite` | `update_plan` |
| `Read` | `read_file` |
| `Write` | `create_text_file` |
| `Edit` | `edit_file` |
| `Bash` | `execute_shell_command` |
| `Grep` | `search_for_pattern` |
| `Glob` | `find_file` |

## Codex 활성화 요건

- `~/.codex/config.toml` 의 `[features]` 섹션에 `multi_agent = true` (서브에이전트 사용 시)
- 마켓플레이스 등록: `[marketplaces.hibye]` source = 본 마켓플레이스 경로
- 프로젝트 활성화: `project/.codex/skills/<plugin> -> <marketplace>/plugins/<plugin>/skills/`
