---
name: backend-overview
description: Use when you need a quick map of the App backend — which subsystem owns which path, current phase boundaries, or where a particular concern lives. Load this skill at session start to get the thin index, then read individual references by topic only when you need depth (24 subsystems). The thin SKILL.md fits in about 100 lines and is always cheap to load; the references are progressive disclosure. Architecture invariants live in .agents/rules/python_agent_rules/. Also use when onboarding to the project, when in doubt about which skill to load, or when answering "where is X implemented" questions.
allowed-tools: Read, Grep, Glob
---

# backend-overview — App 백엔드 thin index

## 이 skill은 언제 로드되는가
- 세션 시작 시 (light load — 본 SKILL.md 만)
- "어디에 무엇이 있는지" 모를 때
- "이 변경이 어느 서브시스템에 속하는지" 분류 필요

## 아키텍처 불변식은 어디에

본 skill 은 **"어디에 뭐가 있는지" 위치 인덱스** 만 담당. 아키텍처 불변식 / 단일 작성자 / StoragePort / 외부 도메인 경계 등 **"왜 이렇게 짰나, 어떻게 지켜야 하나"** 는 `.agents/rules/python_agent_rules/` 에 있다.

- 계층 / import 방향 / cross-cutting — `rules/python_agent_rules/architecture.md`
- 7 설계 원칙 (safe defaults, cache stability 등) — `rules/python_agent_rules/design-principles.md`
- Subsystem 별 규약 — `rules/python_agent_rules/{subsystem}-patterns.md`

## 이 skill의 구조 (progressive disclosure)

본 SKILL.md는 **thin index** (~100줄). 실제 상세는 `references/` 아래 capsule들에 있다.
필요한 capsule만 lazy load.

## 서브시스템 매핑

| # | 서브시스템 | 경로 | capsule | 담당 skill / rule |
|---|---|---|---|---|
| 01 | Agent Loop | `backend/engine/loop.py`, `recovery.py` | `subsystem-01.md` | agent-loop |
| 02 | Tool System | `backend/tools/{base,registry,orchestration}.py` | `subsystem-02.md` | tool-system |
| 03 | Compaction | `backend/engine/compaction.py` | `subsystem-03.md` | compaction |
| 04 | Sub-agent Spawn | `backend/tools/agents.py`, `engine/subagent.py` | `subsystem-04.md` | sub-agent-spawn |
| 05 | Provider Layer | `backend/providers/`, `services/model_resolution.py` | `subsystem-05.md` | provider-layer |
| 06 | Context Assembly | `backend/engine/context.py`, `agents/prompts/` | `subsystem-06.md` | context-assembly |
| 07 | SSE Streaming | `backend/engine/stream.py`, `routes/run.py` | `subsystem-07.md` | sse-streaming |
| 08 | Data Layer | `backend/data/{ports,writer,cache}.py` + `media/` | `subsystem-08.md` | data-audit |
| 09 | LSP Server | `backend/lsp/` (pygls daemon thread) | `subsystem-09.md` | lsp-server |
| 10 | MCP Integration | `backend/services/mcp/` | `subsystem-10.md` | mcp-integration |
| 11 | Routes / API | `backend/routes/{run,media,_common}.py`, `main.py` | `subsystem-11.md` | rule: api-routing-patterns |
| 12 | Run Registry | `backend/runs/*.yaml`, `engine/policy.py`, `engine/run_registry.py` | (rule only) | rule: run-policy |
| 12b | Media Pipeline | `backend/services/media/`, `data/media/` | (rule only) | rule: media-pipeline-patterns |
| 13 | State / Session | `backend/state/`, `backend/db/` | `subsystem-13.md` | session-audit |
| 14 | Testing Infra | `backend/tests/`, `conftest.py` | `subsystem-14.md` | testing-infra |
| 15 | Debug | logs, debug helpers | `subsystem-15.md` | debug-session |
| 16 | Verify | runtime checks | `subsystem-16.md` | runtime-verify |
| 17 | Hooks (harness) [RETIRED] | `.claude/hooks/` (2026-04-26 폐기) | `subsystem-17.md` | (재도입 시 update-config-harness) |
| 18 | Settings (harness) | `.claude/settings.json` | `subsystem-18.md` | update-config-harness, settings-hooks-maintainer |
| 19 | Skills (harness) | `.agents/skills/` | `subsystem-19.md` | (이 skill 자체) |
| 20 | Sub-agents (harness) | `.claude/agents/` | `subsystem-20.md` | (rule: ai-agent-patterns) |
| 21 | Commands (harness) | `.claude/commands/` | `subsystem-21.md` | — |
| 22 | Rules (Layer 2) | `.agents/rules/python_agent_rules/` | `subsystem-22.md` | python-agent-rules, rule-linting |
| 24 | Docs | `docs/` | `subsystem-24.md` | — |

### Retired (폐기됨)

- **subsystem-17 (Hooks)** — `.claude/hooks/` 디렉토리 폐기 (2026-04-26 commit `eb8e9b9`). capsule 은 retired 표식으로 보존 — 재도입 가이드 포함
- **subsystem-23 (State files)** — `.claude/state/phase.json` 체계 폐기. 파일/디렉토리 모두 존재하지 않음
- **Phase 추적** — phase 기반 게이팅은 더 이상 사용하지 않음. 진행 상황은 git history + `docs/INDEX.md` 가 추적
- **`phase-checklist` skill** — phase 게이팅 폐기와 함께 제거됨

## capsule lazy load 패턴

특정 서브시스템 작업 시:

```bash
cat .agents/skills/backend-overview/references/subsystem-<NN>.md
```

또는 Read tool로 직접 로드. capsules는 이 SKILL.md에 자동 포함되지 않는다.

## 자주 보는 사용 예시

- "어디에 SSE 스트림이 있나" → 위 표 #07 → `references/subsystem-07.md` 또는 `sse-streaming` skill
- "단일 작성자 규칙이 뭐였지" → `.agents/rules/python_agent_rules/architecture.md` / `data-layer-patterns.md`
- "운영 검증 체크리스트가 있나" → `references/pre-launch.md` (launch-ready 감사 템플릿)
