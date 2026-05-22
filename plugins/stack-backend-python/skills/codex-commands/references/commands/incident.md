---
description: Post-deploy incident triage — classify a user-reported symptom and dispatch to the right diagnostic tool (/sse-trace, agent-loop-manager, prompt-context-manager, tools-manager, data-state-manager, provider-manager, infra-performance-manager). Generic framework — not a playbook library.
argument-hint: [symptom summary]
---

Dispatch a reported incident to the right first-line diagnostic tool.

## Usage

`/incident "SSE cuts off after 5 seconds"`              — stream diagnosis
`/incident "responses slower than 10s"`                 — perf + provider diagnosis
`/incident "quality dropped 2 days ago"`                — prompt cache + provider diagnosis
`/incident "cost spike in last 24h"`                    — usage + catalog diagnosis
`/incident "DB errors for user X"`                      — data + external domain audit diagnosis
`/incident "MCP tool not firing"`                       — MCP state diagnosis
`/incident "tool X fails every time"`                   — tool + agent-loop diagnosis
`/incident` (no args)                                   — show triage matrix + prompt for more info

## Dispatch rule

1. **Load `incident-triage` skill** — `.agents/skills/incident-triage/SKILL.md`
   defines the symptom→tool matrix, evidence collection steps, and report template.

2. **Parse `$ARGUMENTS`** — free-text symptom summary. Match against symptom
   classes in the triage matrix (fuzzy match on keywords: "SSE", "slow",
   "quality", "cost", "DB", "MCP", "tool", "memory", etc.). If multiple
   matches, list them all and ask for clarification.

3. **Output the triage card**:

```
=== Incident Triage ===
Symptom: <user-provided summary>
Matched class: <one of 7 classes from the matrix>

1차 진단 경로:
  → <primary asset>
  → <secondary asset>

증거 수집 체크리스트:
  □ <item 1>
  □ <item 2>
  □ <item 3>

다음 단계:
  <command or agent to invoke>

Incident report 템플릿: `.agents/skills/incident-triage/SKILL.md` §report-template
```

4. **Stop.** Do NOT execute the dispatched tool automatically — user reviews
   the card and invokes the next step explicitly. Rationale: incident triage
   benefits from human judgment on "which symptom is actually primary".

## What this command does NOT do

- Does not auto-execute the diagnostic tool — user decides
- Does not collect logs by itself — the dispatched tool does
- Does not write the incident report — provides the template only
- Does not integrate with external monitoring (Datadog, Sentry) — structlog only
- Does not substitute for an on-call runbook — this is a triage dispatch layer

## When to escalate

- 증상이 triage matrix 에 해당 없음 → 매트릭스에 **새 symptom class 추가** 검토 (SKILL.md `새 symptom class 추가하기` 섹션 참조)
- 동일 incident 가 반복 발생 → specific playbook 으로 승격 검토 (현재는 generic framework 만 유지)
- Incident 가 `/run/*` 외곽 (authentication, CORS, rate limit) → `security-manager runtime` 모드로 전환

## Caveats

- Generic framework 이므로 **시나리오별 정확한 해결책은 제공하지 않음** — "어디부터 파야 할지" 의 dispatch 만 담당
- 추측 기반 매트릭스 — 실제 incident 축적되면 SKILL.md 의 specific case section 을 채워갈 예정
- 실 운영 로그 접근 권한은 이 command 범위 밖 (`.claude/settings.json` allow 에는 `tail logs/*` 가 없음)
