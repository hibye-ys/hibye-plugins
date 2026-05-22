# scripts/

## generate-agents-md.sh
CLAUDE.md 의 `@./...` import 를 펼쳐서 AGENTS.md 생성.
- invariant 추가/삭제 → CLAUDE.md 수정 → `bash scripts/generate-agents-md.sh` → commit
- `--check`: stdout 출력 (CI/drift 검증)

## acceptance-check.sh
plugin 메타 검증 — frontmatter 5필드 / 캐시 링크 / forbidden-scan / AGENTS.md drift.

## audit-all.sh
사용자 프로젝트 안에서 실행 — 25 audit 일괄. `DOMAIN_VOCAB` envvar 정의 시 app-domain-boundary 활성.

## forbidden-scan.sh
SKILL.md 안 금지 어휘 검출.

## forbidden-terms.txt
forbidden-scan.sh 의 패턴 정본.
