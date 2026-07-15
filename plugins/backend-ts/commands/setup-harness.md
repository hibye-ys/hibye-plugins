---
description: 현재 프로젝트에 backend-ts 하네스를 Claude Code와 Codex가 같은 소스에서 읽도록 배선한다.
---

현재 프로젝트에 backend-ts 하네스를 배선하세요.

1. hibye-plugins 마켓플레이스 루트를 찾습니다.
2. 다음 스크립트를 실행합니다.

```bash
bash <marketplace>/scripts/setup-project.sh "$PWD" --plugin backend-ts --tools claude,codex
```

3. Claude Code에서 `backend-ts@hibye-plugins`를 `--scope project`로 설치합니다. 프로젝트별 Claude 복사본은 만들지 않고 글로벌 plugin cache를 사용하되, user scope 활성화는 제거합니다.

4. 두 도구가 같은 플러그인 소스를 가리키는지 확인합니다.

- Codex: `.codex/skills/backend-ts -> <plugin>/skills`
- Claude: `~/.claude/plugins/cache/hibye-plugins/backend-ts/skills -> <plugin>/skills`

5. `bash <plugin>/scripts/acceptance-check.sh --project "$PWD" --tools claude,codex`를 실행하고, 새 세션에서 10개 스킬과 4개 named agent만 노출되는지 확인합니다.

개별 스킬 복사본을 만들지 마세요. 심볼릭 링크가 깨졌으면 마켓플레이스 `scripts/link-cache.sh`로 복구합니다.
