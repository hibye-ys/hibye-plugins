---
name: architecture-invariants
description: TS 백엔드 작업 시 자동 로드. 18 invariant 의 overview + 어느 상황에 어느 invariant 가 적용되는지 라우팅 가이드. 새 invariant 추가 시 본 파일 갱신.
metadata:
  role: invariant
  scope: apps/api
  source: stack-backend-python/skills/architecture-invariants
---

# architecture-invariants (overview / meta)

> 본 skill = TS 백엔드의 **18 invariant** 카탈로그 + 라우팅 가이드. 각 invariant 의 원칙·금지·grep 패턴은 개별 invariant SKILL.md 가 정본 — 본 파일은 *어디서 어떤 invariant 를 봐야 하는지* 만 안내한다.
> Cited from: Python 측 14 invariant 카탈로그 (legacy). TS 측 = media-job-lifecycle / app-domain-boundary / rate-limit-policy / structured-log-schema / cors-policy 추가 → 18 invariant. 도메인 boundary invariant 는 `app-domain-boundary` 로 rename (메모리 룰 — 도메인 중립 식별자). Runtime-specific invariant (workers-compat 등) 는 별도 runtime plugin 으로 이전.

## 이 skill 은 언제 invoke 되는가

- TS 백엔드 안에서 새 모듈 작성 시 (어느 invariant 가 적용되는지 빠르게 매핑)
- "이 변경 이 invariant 깨뜨리나?" 빠른 확인 필요 시
- 새 invariant 추가/삭제 시 (본 파일 카탈로그 갱신)
- code review 준비 — 변경 영역에 걸리는 invariant 만 좁히기

## 원칙은 개별 invariant SKILL.md 에 있다

**불변식 본문 / 금지 사항 / grep 패턴 / 영향도** 는 모두 개별 invariant SKILL.md 안에 있다. 본 skill 은 **인덱스 + 라우팅** 만 담당한다. 충돌 시 개별 invariant SKILL.md 가 authoritative.

## 18 invariant 카탈로그

| invariant | 적용 상황 |
|---|---|
| single-writer | SSE 응답 — writer 1개만 (`streamSSE` 내부에서 동시 write ✕) |
| provider-retry-matrix | LLM / 외부 API 호출 — p-retry + CircuitBreaker + per-provider 재시도 분류 |
| token-budget-constants | context 조립 / compaction 판정 — js-tiktoken 카운트 + 5 budget 상수 |
| sse-lifecycle | SSE 응답 라이프사이클 — 12 이벤트 / 종료 4 제약 (`done` 미누락 / `done` + `error` 배타 / `usage` direct-before-`done` / payload 메타 혼합 ✕) |
| compaction-thresholds | context 81% 도달 시 — compaction 트리거 / 결과 검증 / 실패 시 폴백 |
| http-error-sentinels | `HTTPException` 던질 때 — 4 패턴 (공개 envelope / 내부 throw / 부팅 throw / 옵션 null+warn) |
| input-safety-gate-ordering | 사용자 입력 처리 시 — gate 순서 (size → schema → safety → policy) 고정 |
| mcp-namespace | MCP tool 등록 시 — namespace prefix + 충돌 검출 + 도구 정렬 안정성 |
| run-policy-presets | agent run 시작 시 — interactive / classifier / tool-based / multi-agent 4 preset + cross-field validation |
| spawn-limits | sub-agent spawn 시 — `MAX_SPAWN_DEPTH = 3` / `SpawnDepthExceeded` / `checkDepth()` 가드 / CacheSafeParams |
| tool-sort-order | tool list 렌더링 시 — built-in (이름순) → MCP (이름순) cache-stable 정렬 |
| agent-loop-invariants | agent loop 실행 시 — 6-stage 순서 고정 + LoopTransition 8종 + LoopDeps/LoopState/RunPolicyLike |
| app-domain-boundary | 도메인 분리 검증 시 — 백엔드는 도메인 어휘 ✕, 식별자 중립 |
| media-job-lifecycle | 미디어 job 처리 시 — 6-state machine + terminal status 집합 + 상태 전이 단방향 |
| rate-limit-policy | 사용자 요청 처리 시 — 토큰 버킷 / 슬라이딩 윈도우 정책 + 429 응답 형식 + per-user/per-ip 차원 |
| structured-log-schema | 모든 로그 출력 시 — JSON 1-line + 고정 필드 집합 (timestamp / level / request_id / trace_id / ...) + PII scrub |
| cors-policy | HTTP route 응답 시 — allowed origins 화이트리스트 + credentials 정책 + preflight (OPTIONS) 처리 |
| architecture-invariants | (본 skill 자체 = 메타 라우터 — 카탈로그 갱신용) |

## 적용 매핑 (작업 → invariant 묶음)

각 코드 영역 작업 시 *동시에* 적용되는 invariant 묶음:

| 작업 영역 | 적용 invariant |
|---|---|
| 새 route 추가 (`src/routes/`) | http-error-sentinels + rate-limit-policy + cors-policy + structured-log-schema + (auth) |
| LLM 호출 (`src/providers/`) | provider-retry-matrix + token-budget-constants + tool-sort-order + structured-log-schema |
| SSE 응답 핸들러 | sse-lifecycle + single-writer + token-budget-constants + structured-log-schema |
| context 조립 (`src/engine/context.ts`) | token-budget-constants + compaction-thresholds + tool-sort-order |
| 새 tool 등록 (`src/tools/`) | tool-sort-order + mcp-namespace |
| 새 sub-agent 호출 (`src/tools/spawn.ts`) | spawn-limits + agent-loop-invariants + run-policy-presets + structured-log-schema |
| 사용자 입력 처리 (`src/middleware/safety.ts`) | input-safety-gate-ordering + rate-limit-policy + http-error-sentinels |
| 미디어 job 처리 (`src/media/`) | media-job-lifecycle + (single-writer 의 미디어 쓰기 부분) |
| 도메인 영역 침범 검토 | app-domain-boundary (+ 모든 import 직접 grep) |
| 관측성 / 로그 / 디버깅 | structured-log-schema (+ 로그 필드 추가/삭제 시 영향도) |

## 새 invariant 추가 절차

1. TS 백엔드 코드 (`src/<area>/`) 안 새 불변 식별 (지속적 / 위반 시 큰 비용)
2. 별도 SKILL.md 작성 — `metadata.role: invariant` + scope/source 명시
3. 본 SKILL.md 카탈로그 표에 1행 추가 (적용 상황 컬럼)
4. 적용 매핑 표에도 해당 작업 영역에 추가
5. 가능하면 audit skill 도 동시 추가 (`<invariant>-audit`) — `audit-all.sh` 에 등록
6. 배포 전 검증 chain 에 추가 검토 (위반이 배포 차단 사유면)

## 새 invariant 삭제 절차

1. 코드에서 해당 패턴 사용처 0 확인
2. 본 SKILL.md 카탈로그에서 행 제거
3. 적용 매핑 표 정리
4. audit skill 삭제 + `audit-all.sh` 에서 라인 제거
5. 의존 invariant (다른 SKILL.md 의 "참조" 줄) 갱신

## invariant 변경 vs 새로 추가 판단

| 변경 유형 | 처리 |
|---|---|
| 기존 invariant 의 본문 명확화 / 예시 추가 | 해당 invariant SKILL.md 만 갱신 |
| 기존 invariant 의 *경계* 확장 (예: spawn-limits MAX_SPAWN_DEPTH 3 → 5) | 해당 invariant SKILL.md + 의존 코드 동시 갱신 + audit 갱신 |
| 새 영역 (지속 강제 필요) 발견 | 새 invariant SKILL.md + 본 카탈로그 추가 + audit 추가 |
| 일회성 / 단발 규칙 | invariant ✕ — workflow 또는 audit 으로 처리 |

## 자주 보는 함정

- **"이거 invariant 인가, workflow 인가?"** → *지속 강제 + 위반 시 큰 비용* = invariant. *어떻게 작성하는지 절차* = workflow. *기존 코드 점검 grep* = audit.
- **"단일 invariant 가 너무 커진다"** → 분리. invariant 1개당 한 가지 불변에 집중 (예: sse-lifecycle 은 이벤트 집합만, single-writer 는 동시 writer 만).
- **"invariant SKILL.md 와 코드가 다르다"** → invariant 가 정본. 코드 정정 또는 사용자 합의 후 invariant 갱신 — *코드 일치를 핑계로 invariant 슬쩍 완화 ✕*.
- **새 invariant 카탈로그 미갱신** → 본 SKILL.md 가 stale → agent 가 invariant 누락 → 위반 코드 통과. 신규 추가 시 본 카탈로그 갱신 의무.

## 검증 체크리스트

- [ ] 본 SKILL.md 카탈로그 행 수 = `ls plugins/stack-backend-ts/skills/ | rg -c '^(single-writer|provider-retry-matrix|token-budget-constants|sse-lifecycle|compaction-thresholds|http-error-sentinels|input-safety-gate-ordering|mcp-namespace|run-policy-presets|spawn-limits|tool-sort-order|agent-loop-invariants|app-domain-boundary|media-job-lifecycle|rate-limit-policy|structured-log-schema|cors-policy)$'` = 17 (본 skill 제외)
- [ ] 적용 매핑 표 = 작업 영역마다 *모든* 관련 invariant 명시 (누락 ✕)
- [ ] 신규 invariant 추가 시 — 카탈로그 + 적용 매핑 동시 갱신
- [ ] 모든 카탈로그 행에 frontmatter `name` 일치하는 SKILL.md 존재

## 구현 중 막히면

- TS 백엔드 디렉토리가 없음 → NOT_YET_IMPLEMENTED. invariant 만 정의되고 적용 코드는 추후
- "이 변경에 어떤 invariant 가 걸리는지 모르겠다" → 작업 영역 컬럼 매핑 표 참고. 그래도 모르면 사용자 확인
- 새 invariant 가 기존 invariant 와 중복 → 통합 또는 한 쪽 폐기. 같은 영역의 invariant 2개 공존 ✕
