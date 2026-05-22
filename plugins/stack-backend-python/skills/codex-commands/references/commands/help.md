---
description: Show App command cheat sheet — when to use which command, grouped by workflow.
argument-hint:
---

## App Command Cheat Sheet

### 코드 작성 후

| 상황 | 커맨드 |
|------|--------|
| 테스트 돌리기 | `/agent-test` |
| 테스트 갭 확인 (변경 파일 기준) | `/test-coverage` |
| 런타임 검증 (Static + Boot + E2E) | `/agent-verify` |
| 뭔가 고장남 | `/agent-debug [keyword]` |

### 감사/검증

| 상황 | 커맨드 |
|------|--------|
| **전체 감사** (13-phase 통합 리포트) | `/audit-all` |
| rule ↔ 구현 drift (서브시스템 1개) | `/spec-diff <subsystem>` |
| SSE 이벤트 실시간 트레이싱 | `/sse-trace [message]` |

### Scaffold

| 상황 | 커맨드 |
|------|--------|
| 새 도구 추가 | `/new-tool <name>` |
| 새 런타임 에이전트 추가 | `/new-agent <name>` |
| 새 `/run/<name>` 엔드포인트 추가 (runs/*.yaml) | `/new-run <name>` |

### 운영 (Operations)

| 상황 | 커맨드 |
|------|--------|
| 배포 직전 종합 게이트 (Tier 1 정적) | `/pre-deploy` |
| 배포 직전 + 외부 도메인 Postgres (예: <domain>) integration smoke | `/pre-deploy --integration` |
| 배포 직전 + OpenAI live smoke | `/pre-deploy --live-openai` |
| 배포 후 incident 발생 시 진단 dispatch | `/incident [증상 요약]` |
| SSE 이벤트 실시간 트레이싱 | `/sse-trace [message...]` (run endpoint override via `APP_SSE_TRACE_RUN` env) |

### 부분 감사 (에이전트 직접 호출)

커맨드 대신 에이전트 이름으로 직접 호출:

| 영역 | 에이전트 | 주요 모드 |
|------|---------|----------|
| Provider | `provider-manager` | scaffold / audit / debug / catalog-sync |
| Prompt/Context | `prompt-context-manager` | validate / audit / analyze |
| 도구/MCP | `tools-manager` | tool-audit / mcp-audit / media-audit |
| SSE/Output | `output-stream-manager` | stream-audit / usage |
| 에이전트 루프 | `agent-loop-manager` | loop-audit / debug / compaction |
| 서브에이전트 | `sub-agent-manager` | spawn-audit / topology |
| 테스트 | `test-manager` | review / cleanup / scaffold / verify |
| 보안 | `security-manager` | quick-check / deep-audit / dependency / runtime |
| 아키텍처 | `architecture-validator` | layer / rule-compliance / spec-drift / rule-lint / full |
| API | `api-manager` | run-policy / routing-audit / schema-sync |
| 데이터/세션 | `data-state-manager` | data-audit / session / cache |
| 인프라/성능 | `infra-performance-manager` | benchmark / concurrency / resource |

### 권장 워크플로우

```
개발 중    → /new-tool | /new-agent | /new-run → 코드 수정 → /agent-test → /test-coverage → /agent-verify → 커밋
PR 전     → /audit-all (또는 관련 영역만 에이전트 호출)
리팩터링 전후 → /audit-all 로 baseline / post 비교

배포 전    → /pre-deploy (Tier 1) → (선택) /pre-deploy --integration → (선택) /pre-deploy --live-openai → GO
배포 후    → /sse-trace 로 실시간 SSE 관찰 + 정상 흐름 확인
incident   → /incident "<증상>" → 1차 진단 경로 dispatch → /sse-trace | agent-loop-manager debug | infra-performance-manager resource | provider-manager debug | prompt-context-manager audit | data-state-manager data-audit 중 제안된 것으로 escalate
```
