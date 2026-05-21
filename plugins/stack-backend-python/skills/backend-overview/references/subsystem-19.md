> App backend-overview capsule. Source: harness build plans ..

# Subsystem 19 — Skills (harness)

## 목적 (1줄)

`.agents/skills/` 아래의 skill 카탈로그. L1 서브시스템 스킬 + L2 운영 스킬 +
audit checklist + scaffolding utility.

## 파일 구조 (2026-04-26 기준 — 43 skills)

```
.agents/skills/
├── backend-overview/          ← 본 capsule이 속한 skill (thin index)
│   ├── SKILL.md               (~100줄)
│   └── references/            (lazy-load capsules)
├── python-agent-rules/        (L2 — Python 공통 규약)
├── rule-linting/              (L2 — rule 파일 구조 검증)
│
│ L1 서브시스템 implementation
├── agent-loop/                tool-system/
├── provider-layer/            context-assembly/
├── sse-streaming/             lsp-server/
├── mcp-integration/           sub-agent-spawn/
├── compaction/                testing-infra/
│
│ 운영 / 검증 / 디버그
├── runtime-verify/            debug-session/
├── red-green-fix/             update-config-harness/
├── performance-profiling/     pre-deploy-check/
├── security-audit-check/      security-runtime/
├── dependency-scanning/       full-architecture-audit/
├── incident-triage/
│
│ Audit checklist (operational, grep 패턴 위주)
├── architecture-invariants/   api-audit/
├── data-audit/                infra-audit/
├── loop-audit/                prompt-audit/
├── provider-audit/            session-audit/
├── stream-audit/              subagent-audit/
├── tool-audit/                usage-tracking/
│
│ Scaffolding / template
├── new-agent/                 new-run/
├── agent-verify-def/          provider-scaffold/
├── provider-catalog-sync/     test-cleanup/
└── test-scaffold/
```

## 레이어 구분

- **L1 (서브시스템 스킬)** — 특정 모듈을 implement/modify할 때 로드. 설계 규약 + 불변식.
- **L2 (운영 스킬)** — backend-overview / python-agent-rules / rule-linting. harness 자체 운영.
- **Audit** — 변경 후 검증 / 정기 health check. invariant 는 `.agents/rules/python_agent_rules/*.md` 가 정본.
- **Scaffolding** — 신규 모듈/엔드포인트/테스트 생성 템플릿.

## 로드 전략

- Progressive disclosure: SKILL.md는 가볍게, references/는 필요 시만.
- backend-overview는 "어디에 뭐가 있는지" 모를 때 항상 로드 가능한 thin index.

## 담당 skill

본 skill 자체 (`backend-overview`).

## 범위

- 위 트리는 2026-04-26 기준 스냅샷. **실제 정본은 `ls .agents/skills/`** — drift 시 본 capsule 갱신.
- 신규 skill 추가 시 카테고리 분류 + 본 트리 업데이트.

## Gotchas

- **SKILL.md 100줄 초과 금지**: 세션 시작 시 로드되므로 비용 직접 영향.
- **SKILL.md 내부에 상세 내용 금지**: references/로 분리.
- **skill 이름 중복 금지**: 전역 namespace.
- **카탈로그 drift**: skill 추가/삭제 시 본 capsule 갱신을 잊으면 onboarding 혼란.

## 폐기 이력

- `phase-checklist` (구 L2-S02) — phase 기반 게이팅 제거 (2026-04). subsystem-23 (state files) 와 함께 폐기. 진행 추적은 git history + `docs/INDEX.md`.

## 관련 AD

- 전반 — 스킬은 AD 준수를 보장하는 도구
