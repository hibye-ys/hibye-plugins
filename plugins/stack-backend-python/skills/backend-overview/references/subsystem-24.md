> App backend-overview capsule. Source: `docs/` directory + `.agents/rules/python_agent_rules/`.

# Subsystem 24 — Docs

## 목적 (1줄)

프로젝트 문서 + 감사 계획 + (retired) 설계 문서. 현재 운영 중인 진실의 원천은
`.agents/rules/python_agent_rules/` 의 16 rule 파일.

## 파일 구조

```
docs/
└── (기타 ad-hoc 문서)

.agents/rules/python_agent_rules/    # 권위있는 spec — 16 rule 파일
```

## Retired 문서

- `docs/design/2026-04-10-ai-agent-backend-design.md` — **존재하지 않음**. 폐기됨. rule 파일이 spec 역할을 흡수

## 담당 skill

- `backend-overview` (본 skill) — subsystem 인덱스
- `python-agent-rules` — 16 rule 파일 카탈로그
- `rule-linting` — rule 파일 구조 감사

## 범위


## Gotchas

- **retired 문서 참조 주의**: `docs/design/…` 경로를 agent / skill / command 에서 참조하고 있으면 drift — `invariant-compliance-checker` 또는 `rule-consistency-auditor` 가 flag
- **rule 변경이 큰 결정**: rule 추가/변경은 여러 skill + agent 에 영향. `rule-linting` skill 의 4-section 구조 준수 필수
- **plan 문서는 커밋 아카이브에만**: 과거 phase plan 은 git history 로만 보존, live 에 없음

## 관련 rule

- 전반 — 16 rule 파일이 모든 subsystem invariant 의 authoritative source
- `architecture.md` — 계층 경계 (docs/ 는 코드 계층과 무관, observability/exceptions 같은 cross-cutting 예외 목록 참조)
