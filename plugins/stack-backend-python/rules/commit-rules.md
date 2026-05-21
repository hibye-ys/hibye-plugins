> App backend Python rules — Conventional commits prefix + formatting.

# commit-rules — Conventional Commits 규약

## 7 접두사

| 접두사 | 의미 | 예 |
|---|---|---|
| `feat` | 새 기능 | `feat: add tool retry backoff` |
| `fix` | 버그 수정 | `fix: prevent stream deadlock on eof` |
| `chore` | 빌드 / 의존성 / 메타 | `chore: bump pydantic to 2.9` |
| `docs` | 문서 전용 변경 | `docs: clarify compaction escalation ratio` |
| `refactor` | 기능 변화 없는 구조 개선 | `refactor: split loop stage into method` |
| `test` | 테스트 추가 / 수정 | `test: cover circuit breaker half-open` |
| `perf` | 성능 개선 | `perf: cache prompt template compile` |

## 형식 규칙

- 제목 = 접두사 + `: ` + 요약, 50자 이내 권장 (최대 72)
- 요약은 **명령형** ("add X", "fix Y") — 과거형("added") / 현재형("adds") 금지
- 요약 첫 단어는 **소문자**
- 제목 끝에 **마침표 금지**
- 접두사 뒤 scope 는 선택: `feat(provider): add gemini stream`
- 제목과 본문 사이 빈 줄 1개
- 본문은 72자 줄바꿈, **why** 를 설명하지 **what** 을 반복하지 말 것
- Breaking change 는 본문에 `BREAKING CHANGE:` prefix + 마이그 가이드
- `Co-Authored-By: Name <email>` 트레일러 허용

## 좋은 예 vs 나쁜 예

### Good
```
feat(provider): add anthropic thinking parameter

Enables controlled reasoning via extra_body. Needed because
the default params cannot expose thinking_budget_tokens.
Refs: .agents/rules/python_agent_rules/ai-provider-patterns.md
      §파라미터 호환성
```

### Bad
```
Added thinking support.       # 과거형 + 대문자 + 마침표 + 접두사 없음
```

## 금지 사항 (절대 하지 말 것)

- 하나의 커밋에 서로 무관한 변경 섞기 — 기능별로 분리
- `WIP`, `test`, `fix stuff` 같은 뜻 없는 메시지
- 시크릿/로컬 경로/개발자 이름 본문에 남기기
- `--amend` 를 pre-commit hook 실패 후 사용 (이전 커밋이 덮어씌워져 작업 손실)
