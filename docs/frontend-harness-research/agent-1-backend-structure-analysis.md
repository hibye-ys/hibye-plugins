# Agent 1 — 백엔드 plugin 구조 분석 (raw)

- **목적**: `plugins/stack-backend-ts-hono` 의 구조/패턴 파악 — frontend plugin 신규 빌드 시 같은 결을 적용하기 위해
- **subagent**: `Explore` (read-only)
- **수집일**: 2026-05-22
- **참고**: 이 문서는 sub-agent 의 raw output 을 정돈 없이 옮긴 원본

---

## 플러그인 구조 분석: `stack-backend-ts-hono` 아키텍처 패턴

### 1. 상시 Invariant 18개 분류

CLAUDE.md 에서 `@import` 되는 18개 스킬은 다음 6개 대분류로 나뉨:

| 카테고리 | 스킬 수 | 항목 |
|---------|--------|------|
| **동시성 · 쓰기 안전** | 3 | single-writer, provider-retry-matrix, spawn-limits |
| **Context · 토큰 관리** | 3 | token-budget-constants, compaction-thresholds, sse-lifecycle |
| **API 계약 · 에러** | 3 | http-error-sentinels, run-policy-presets, cors-policy |
| **입력 / 라우팅** | 3 | input-safety-gate-ordering, tool-sort-order, mcp-namespace |
| **구조 · 인프라** | 3 | agent-loop-invariants, architecture-invariants, app-domain-boundary |
| **관측성 · 정책** | 3 | structured-log-schema, rate-limit-policy, media-job-lifecycle |

각 스킬은 frontmatter `name` (e.g. `single-writer`) + 다음 구조:
- **원칙** (불변식 선언)
- **핵심 상수** (언어 무관, 권장값)
- **금지 사항** (10~20개 규칙)
- **TS 구현 예시** (언어별 어댑터 행)

---

### 2. On-Demand 스킬 분류 (39 workflow + 21 audit = 60개)

**Workflow (구현 가이드) — 39개:**

| 카테고리 | 스킬 | 설명 |
|---------|------|------|
| **Agent Loop** (6) | agent-loop, ai-agent-patterns, context-assembly, compaction, sub-agent, usage-tracking | 루프 구조, provider 호출, 토큰 관리, 메모리 추출 |
| **Provider** (5) | provider-layer, provider-scaffold, provider-catalog-sync, provider-retry-matrix, codex-commands | LLM SDK, fallback chain, retry 분류, 모델 카탈로그 |
| **Tool System** (2) | tool-system, mcp-integration | 도구 레지스트리, 정렬, MCP 브릿지 |
| **Backend 기초** (6) | backend-overview, api-routing, auth, error-handling, database, data-layer | Hono 라우트, 인증, DB layer 추상화 |
| **미디어 · SSE** (3) | media-pipeline-patterns, sse-streaming, lsp-server | Job lifecycle, SSE 이벤트, LSP 언어 서버 |
| **코딩 규칙** (5) | coding-standards, commit-rules, design-principles, security-runtime, testing-infra | 네이밍, 커밋 메시지, 아키텍처 원칙, 보안, 테스트 |
| **디버깅 · 운영** (5) | debug-session, red-green-fix, performance-profiling, incident-triage, ts-agent-rules | 로그 읽기, 에러 복구, 성능 측정, SRE 패턴 |
| **신규 기능** (3) | idempotency-key, secret-rotation, migration-rollback | 멱등성, 보안 로테이션, DB 마이그레이션 |
| **New Instance** (4) | new-agent, new-run, codex-subagents | 에이전트 정의, RunPolicy, Codex 연동 |

**Audit (변경 검증) — 21개:**

| 서브카테고리 | 스킬 | Grep 패턴 |
|-----------|------|----------|
| **직접 매핑** (10) | provider-retry-audit, sse-lifecycle-audit, single-writer-audit, token-budget-audit, tool-sort-order-audit, input-safety-audit, mcp-namespace-audit, compaction-thresholds-audit, http-error-sentinels-audit, run-policy-presets-audit | 특정 상수 · 라이브러리 호출 패턴 |
| **M2.5 검증** (11) | spawn-limits-audit, agent-verify-def, api-audit, data-audit, full-architecture-audit, loop-audit, session-audit, security-audit-check, rule-linting, dependency-scanning, app-domain-boundary-audit | 구조적 검증 (파일 단위, 블록 레벨, cross-file) |

---

### 3. Rules vs Skills 차이

핵심 원칙:

| 측면 | Rules (상시 invariant) | Skills (on-demand) |
|------|------------------------|-------------------|
| **역할** | 불변식 정의 — 위반 시 큰 비용 | How-to 또는 검증 체크리스트 |
| **노출** | CLAUDE.md `@import` → fresh 세션마다 자동 로드 | 사용자가 명시적으로 invoke (설명 트리거) |
| **구조** | 1 + 1 (메타데이터 + 본문) | 메타데이터 + When-to-invoke + 구현 가이드 |
| **업데이트** | 불변식 변경 = breaking change (배포 조율) | 구현 가이드 갱신 = 로컬 버전관리 |
| **수량** | 18개 (고정, 커버리지 100%) | 60개 (확장 가능) |

**Import 메커니즘:**

```markdown
@./skills/single-writer/SKILL.md     ← frontmatter 파싱 후 전체 본문 인라인
@./skills/provider-retry-matrix/SKILL.md
...
(18줄 — AGENTS.md 로 자동 확장)
```

---

### 4. Skill 본문 구조 패턴 (deep read: agent-loop-invariants, single-writer, sse-lifecycle)

공통 구조 (Skill body 의 12단계):

1. **Frontmatter** — `name`, `description`, `role` (workflow/invariant/audit), `scope`, `source`, `pair_invariant`
2. **적용 언어 어댑터 행** — Python → TS 변환 (asyncio → Promise, type hints, 라이브러리)
3. **정체성 선언** — "이 스킬의 책임은?" (한 문장)
4. **When-to-invoke** — "어떤 상황에?" (체크리스트)
5. **핵심 상수** (권장값 테이블)
6. **알고리즘 / 메커니즘** — 구조화된 설명 (예: single-writer 의 3단계 — atomic write + per-resource lock + singleton coordinator)
7. **TypeScript 구현 예시** — 코드 블록 또는 pseudo-code
8. **Cross-field 불변** (startup validation)
9. **금지 사항** (대문자 ✕, 10~20개 규칙 — "이것을 하면 안 됨")
10. **모듈 구조** (파일 레이아웃 표)
11. **Placeholder 해석** (도메인 중립 식별자)
12. **변경 영향 매트릭스** (새 필드 추가 시 어디를 갱신할지)

**예시 (single-writer):**
- 원칙: "쓰기 경로 1개 제한"
- 3가지 자원: media job state, output binary, user skill body
- 핵심 메커니즘 3개: atomic write (temp + fsync + rename), per-resource lock (mutex), singleton coordinator
- 멀티 워커 migration path 명시
- 금지: WriteCoordinator 우회, data ↔ db 상호 import, 직접 경로 조립

---

### 5. 부가 디렉토리 역할

| 경로 | 내용 | 용도 |
|------|------|------|
| **AGENTS.md** | auto-gen 카탈로그 (`scripts/generate-agents-md.sh`) | CLAUDE.md 의 `@import` 모든 skill 본문 인라인 (현재 세션 노출) |
| **scripts/** | 5개 helper — `audit-all.sh`, `forbidden-scan.sh`, `acceptance-check.sh`, `generate-agents-md.sh` | CI/CD 통합, Lint 자동 실행 |
| **scripts/forbidden-terms.txt** | 금지 단어 목록 (e.g. `user_state_overlay`, `append_op`) | `forbidden-scan.sh` 가 PR 에서 grep (legacy pattern reject) |
| **assets/icon.svg** | 플러그인 아이콘 (32px 권장) | Claude Code UI |
| **skills/** | 78 SKILL.md (invariant 18 + workflow 39 + audit 21) | 본 repository |

---

### 6. Verify-* / *-Audit 공통 구조

**Audit Skill 의 표준 패턴:**

```
[Frontmatter]
  name: <pattern>-audit
  pair_invariant: <pattern>  ← 정본 invariant 참조
  role: audit

[본문]
  ## 검증 대상 invariant
    [해당 invariant SKILL.md 링크]

  ## 실행 (단계별 grep)
    패턴 1 (문턱 검사): grep -rEn '...' [dir]
    패턴 2 (정밀화): for/awk block-level absence scan
    패턴 3 (보조): zod parse / transaction 검증

  ## 위반 시 조치
    [구체 수정 가이드]

  ## 통과 기준
    match 0건, 또는 grep -count > threshold
```

**3 계층 검증 (audit-all.sh):**
1. **문턱 검사** (`run_audit` helper) — `grep -rEnc` 1줄로 빠른 fail-fast
2. **정밀화** (Codex 리뷰) — file-level / awk block scan (동시 쓰기, transaction 누락 감지)
3. **전체 패턴** (수동) — 각 SKILL.md `## 실행` 섹션 전체 (cross-file, 상황 의존)

**예시 (single-writer-audit):**

```bash
# 문턱 검사
grep -rE '\.(put|delete)\(' src/ | grep -v 'lock\|mutex\|transaction'

# 정밀화 (file-level)
for f in $(grep -rl '.put\|.delete' src/); do
  grep -q 'lock\|mutex\|transaction' "$f" || echo "no-lock: $f"
done
```

---

### 요약: Frontend Plugin 설계 시 적용 가능한 패턴

1. **Invariant 18개** → 상시 노출 (CLAUDE.md `@import`) — 프론트엔드 특화 카테고리 (예: 상태 관리 원칙, 렌더링 계약, 접근성)
2. **Workflow 39개** → on-demand (e.g. "컴포넌트 트리 구조", "CSS-in-JS 통합 가이드")
3. **Audit 21개** → pre-deploy (ESLint 규칙, a11y 체크, 번들 크기)
4. **AGENTS.md auto-gen** → 부팅 시 invariant 인라인, 계층적 탐색
5. **구조화된 메타데이터** — `role` (workflow/invariant/audit), `pair_invariant`, `source` (언어 어댑터)

**핵심 다른 점:** 백엔드는 *불변식이 강하고 신뢰성 중심* (동시성, 데이터 안전성), 프론트엔드는 *UX 일관성 + 성능 + 접근성* 중심.
