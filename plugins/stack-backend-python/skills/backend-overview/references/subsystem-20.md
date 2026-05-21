> App backend-overview capsule. Source: `.claude/agents/` 파일 리스트 + `new-agent-builder` skill.

# Subsystem 20 — Sub-agents (harness)

## 목적 (1줄)

`.claude/agents/` 아래의 Claude Code sub-agent 정의. 특정 워크플로우를 격리된
Claude 세션에서 전문적으로 수행. 백엔드 런타임의 sub-agent spawn (subsystem 04) 과
는 별개의 개념 — 이쪽은 **Claude Code 하네스의** sub-agent 이며 `.md` 파일로 선언.

## 파일 구조

```
.claude/agents/
├── invariant-compliance-checker.md           (cross-cutting rule 불변식 감사)
├── agent-loop-manager.md              (6-stage 루프 + debug + compaction)
├── api-manager.md                     (routes + RunPolicy + schema sync)
├── architecture-reviewer.md           (계층 경계 + media single-writer)
├── architecture-validator.md          (4 check 라우팅 coordinator)
├── data-state-manager.md              (data/state/db 감사)
├── infra-performance-manager.md       (벤치마크 + concurrency)
├── new-agent-builder.md               (새 agent scaffold + verify)
├── output-stream-manager.md           (SSE + usage)
├── prompt-context-manager.md          (프롬프트 조립 + TokenBudget)
├── provider-manager.md                (provider scaffold/audit/debug/catalog)
├── rule-consistency-auditor.md        (rule 파일 구조 감사)
├── security-manager.md                (security quick/deep/runtime/dependency)
├── settings-hooks-maintainer.md       (settings.json + hook 수명)
├── spec-diff-auditor.md               (rule ↔ 구현 drift per subsystem)
├── sub-agent-manager.md               (spawn 감사 + topology)
├── test-manager.md                    (테스트 리뷰/cleanup/scaffold)
└── tools-manager.md                   (tool + MCP + media)
```

총 18 sub-agent. 새 agent 추가 시 `new-agent-builder.md` 가 scaffold 담당.

## 주요 sub-agent 역할 (coordinator vs narrow)

대부분 `-manager` 접미사 = 영역 coordinator (여러 모드 지원).
`-reviewer` / `-validator` / `-auditor` / `-checker` / `-maintainer` = 감사 / 검증 narrow specialist.

Full dispatch 표는 `.claude/commands/help.md` 의 "부분 감사" 섹션 참조.

## 로드 방식

메인 Claude 세션이 `Task` tool 로 sub-agent 호출. 각 sub-agent 는:

- 독립 세션 (컨텍스트 격리) — 부모 세션의 대화 히스토리 상속 안 함
- frontmatter 의 `tools` 필드가 허용 도구 목록 — 권한 최소화
- `model: opus` 가 대부분 (정확성 우선)
- read-only 인 경우 많음 — 수정은 coordinator 가 user 허가 받고 직접

## 담당 skill

없음. sub-agent 정의 자체가 workflow. 구조 감사는 `rule-consistency-auditor` 가
`.agents/rules/` 측이지 `.claude/agents/` 측이 아님 — agent 파일 lint 는 별도
tool 없음 (향후 검토 대상).

## 범위

- 18 sub-agent 정의 유지
- 새 sub-agent 추가 시 `new-agent-builder.md` 또는 유사 기존 agent 복사 + 수정

## Gotchas

- **sub-agent 결과는 요약만 반환**: 대량 grep 결과를 본문에 그대로 담지 말 것
- **권한 최소화**: 각 sub-agent 의 `tools` frontmatter 가 실제로 필요한 것만 포함
- **백엔드의 sub-agent 시스템 (subsystem 04) 과 혼동 금지**: 본 서브시스템은 Claude Code 하네스 관점, subsystem 04 는 런타임 `spawn_agent` tool

## 관련 rule / skill

- `.agents/rules/python_agent_rules/ai-agent-patterns.md` — 백엔드 런타임 agent YAML (별도 개념)
- `.agents/rules/python_agent_rules/sub-agent-patterns.md` — 백엔드 런타임 spawn (별도 개념)
- `new-agent-builder.md` agent — 새 sub-agent scaffold
- `settings-hooks-maintainer.md` agent — `.claude/settings.json` 정합성
