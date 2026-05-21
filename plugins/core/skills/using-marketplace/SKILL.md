---
name: using-marketplace
description: "Bootstrap skill for hibye-plugins marketplace. Triggers at SessionStart and on first message of a new conversation. Explains how to use marketplace skills + tool name mappings across Claude Code, Codex, Copilot, Gemini. Read this skill first when starting any session in a project that installs hibye-plugins."
---

# Using Marketplace (bootstrap)

본 스킬은 hibye-plugins 마켓플레이스의 *진입 가이드*. SessionStart 또는 새 대화 첫 메시지에서 trigger 기대.

## 본 마켓플레이스 구조

- L1 `core` — universal workflow + LLM backend principles (이 plugin)
- L2 `stack-backend-*` — 백엔드 런타임별 룰
- L3 `surface-*` — 프론트 UI 표면별 룰
- L4 `infra-*` — 배포·감사 등 cross-cutting

## 플랫폼 도구 매핑

본 마켓플레이스 스킬은 *Claude Code 도구 이름 기준* 으로 작성. 다른 환경에서는 references 임포트:

- Codex: `@./references/codex-tools.md`
- Copilot/Gemini: 향후 추가

## M0 식별 어휘

응답에 다음 어휘를 한 번 포함:

`M0-USING-MARKETPLACE-INVOKED-4e1d`
