---
name: rule-linting
description: 새 skill 추가 후 또는 plugin 메타 변경 후 invoke. plugins/stack-backend-ts/skills/*/SKILL.md 의 frontmatter 가 필수 키 (name / description / role / scope / source) 를 모두 채우고 디렉토리명과 name 이 일치하는지를 grep 으로 검증.
metadata:
  role: audit
  scope: project
  source: stack-backend-python/skills/rule-linting
---

# rule-linting — plugin skill frontmatter audit

## 검증 대상 invariant

본 plugin (`stack-backend-ts`) 의 모든 `skills/*/SKILL.md` 는 다음 frontmatter v3.3 규약을 따라야 한다:

- `name: <kebab-case>` — 디렉토리명과 일치
- `description: <한국어 한 문장>` — 비어 있지 않음
- `metadata.role: invariant | workflow | audit` — 3종 중 하나
- `metadata.scope: <api-app>` — 본 plugin 의 scope
- `metadata.source: <...>` — 원본 출처 (포팅 추적성)

## 실행

```bash
for f in plugins/stack-backend-ts/skills/*/SKILL.md; do
  [[ -f "$f" ]] || continue
  dir=$(basename "$(dirname "$f")")

  # name: <dir>
  grep -qE "^name:\s*${dir}\$" "$f" || echo "$f: name mismatch (expect '$dir')"

  # description: non-empty
  grep -qE "^description:\s*\S" "$f" || echo "$f: empty description"

  # role: invariant | workflow | audit
  grep -qE "^\s*role:\s*(invariant|workflow|audit)\$" "$f" || echo "$f: invalid role"

  # scope: <api-app>
  grep -qE "^\s*scope:\s*<api-app>\$" "$f" || echo "$f: invalid scope"

  # source: present (값은 자유)
  grep -qE "^\s*source:" "$f" || echo "$f: missing source"
done
```

## 통과 기준

- 출력 **0줄** (모든 SKILL.md 가 5가지 frontmatter 정합)

## 위반 시 조치

### name mismatch

디렉토리명이 `agent-verify-def` 이면 frontmatter `name: agent-verify-def`. 둘 중 하나만 변경 (보통 frontmatter 정정).

### empty description

description 은 *언제 invoke 하는지* + *무엇을 검증하는지* 가 한 문장에 들어가야 한다 (Skill 자동 매칭 정확도 좌우).

### invalid role

- `invariant` — 상시 로드되는 불변 룰 (CLAUDE.md `@import` 대상)
- `workflow` — on-demand 작업 안내 (description trigger)
- `audit` — 검증 grep / 명령 (변화 후 invoke)

세 가지 중 하나로 정정.

### invalid scope

본 plugin 은 `<api-app>` scope. `<web-app>` 같은 다른 scope 면 다른 plugin (`stack-frontend-*`) 으로 이동.

### missing source

포팅 추적성을 위해 원본 명시:
- `stack-backend-python/skills/<source-name>` (직접 포팅)
- `(신규 — spec §<n> enforce)` (신규)
- `(분리 — <원본>)` (한 skill 에서 분리)

---

## audit 이 커버하지 않는 것

- frontmatter 외 본문 구조 (검증 / 실행 / 통과 기준 / 위반 시) — 본 audit 은 frontmatter 만
- root `AGENTS.md` / `CLAUDE.md` 룰 → 별도 root-level lint
- skill 본문 안 금지 어휘 (도메인명 / 식별자 prefix 등) → 별도 forbidden-terms scan 으로 분리
