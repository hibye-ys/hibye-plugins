> App backend-overview capsule. Source: harness build plans ..

# Subsystem 22 — Rules (Layer 2)

## 목적 (1줄)

`.agents/rules/python_agent_rules/` 아래의 App 적응 Python 코딩 규약 모음.
PEP 8 + SOLID + pydantic v2 + asyncio 관용.

## 파일 구조

```
.agents/rules/python_agent_rules/
├── pep8.md
├── solid.md
├── pydantic_v2.md
├── asyncio.md
├── error_handling.md
├── logging.md
├── testing.md
└── commit_messages.md
```

## 주요 rule 카테고리

| rule | 내용 |
|---|---|
| PEP 8 | 들여쓰기, 네이밍, 라인 길이 88자 (black), import 순서 |
| SOLID | SRP/OCP/LSP/ISP/DIP, Protocol 기반 DI |
| pydantic v2 | `BaseModel`, `model_config`, `field_validator`, `model_validator` |
| asyncio | `async def` + `await`, task lifecycle, cancellation |
| Error handling | 좁은 예외 범위, fail-fast, error wrapping |
| Logging | structlog, context binding, 민감 정보 금지 |
| Testing | pytest fixture, mock provider, async fixture |
| Commit messages | Conventional Commits + Co-Authored-By |

## 담당 skill

`python-agent-rules` — Python 코드 작성/리뷰 시 로드.

## 범위

- 8 rule 파일 모두 현재 (Python 개발 시 즉시 적용)

## Gotchas

- **rule 파일은 읽기 전용 참고**: 규칙 수정은 harness 운영자 결정.
- **AD와 rule 구분**: AD는 아키텍처 결정 (코드 구조), rule은 코딩 관용 (스타일/패턴).

## 관련 AD

- Protocol DI (pydantic v2 + Protocol DI) — rule에 실제 코드 패턴으로 구현됨
