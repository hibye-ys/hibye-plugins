---
name: design-principles
description: apps/api 설계 결정 시 7가지 핵심 원칙 (Safe Defaults / Cheapest First / Cache Stability First / Isolation Default / Structured Errors to Model / Dynamic Context Injection / Partial Loading) 검토. PR 리뷰 자가체크 + 원칙 간 충돌 trade-off 안내.
metadata:
  role: workflow
  scope: project
  source: stack-backend-python/rules/design-principles.md
---

**적용된 §4.4 매트릭스 행**:
- ABC / `abc.ABC` → **TS `interface`**
- DI: `Depends(get_session)` (FastAPI) → **생성자 인자** 또는 **`c.get('session')`** (Hono context)
- `typing.Protocol` + `@runtime_checkable` → **TS `interface`** + 런타임 검증 필요 시 zod
- `pydantic BaseModel` → **`zod`** schema (런타임 검증 경계)
- `asyncio.CancelledError` → **`AbortController.signal`**
- `contextvars` → **`AsyncLocalStorage`** (Node) / request-scoped Hono context

> source: `stack-backend-python/rules/design-principles.md`
> *원칙* (YAGNI / DRY / SoC / cohesion / loose coupling) 그대로, 예시 코드만 TS 화.

# design-principles — 7가지 핵심 설계 원칙 (apps/api TS / Hono)

## 이 skill은 언제 invoke 되는가

- 새 모듈 / 인터페이스 / 엔드포인트 설계 시
- PR 리뷰 시 (아래 §PR 리뷰 자가체크 사용)
- 두 원칙이 부딪힐 때 trade-off 결정

## 1. 안전한 기본값 (Safe Defaults)

선언하지 않은 것은 보수적으로 동작한다.

**왜:** 명시 없는 설정이 느슨한 기본값으로 허용되면 보안 / 데이터 사고가 "기본 동작" 에서 발생. 명시적 opt-in 만 감사 추적 가능하다.

- Tool: 미선언 시 순차 실행 + 쓰기 가정
- Sub-agent 권한: 부모보다 같거나 좁음
- 샌드박스: 화이트리스트 방식 (허용 목록 외 차단)
- Feature flag: 기본 비활성
- 판단 기준: **"보수적 기본값을 명시적 opt-in 으로만 덮고 있는가?"**
- 반례: 새 도구를 `isConcurrencySafe: true` 기본값으로 두어 쓰기 도구도 병렬 실행 — 동시 쓰기 충돌

```typescript
// ✅ safe default — 명시적 opt-in 만 병렬 허용
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  isConcurrencySafe: z.boolean().default(false),   // 기본 false (직렬 + 쓰기 가정)
});
```

## 2. 저렴한 것부터 (Cheapest First)

비용이 적은 방법을 먼저 시도하고, 실패 시 비싼 방법으로 에스컬레이션.

**왜:** 비싼 경로 (LLM 호출, 외부 네트워크 I/O) 를 먼저 쓰면 지연 · 비용이 불필요하게 발생. 같은 결과를 싸게 낼 수 있는 경로가 있으면 그것부터.

비용 계층 (높음 → 낮음):

1. LLM 호출 — 외부 API, 초 단위 latency + 토큰 비용
2. 외부 네트워크 I/O — provider fetch, MCP 원격
3. DB 쿼리 — Neon (Drizzle) / SQLite fallback
4. KV / R2 lookup — Workers 바인딩
5. 파일 I/O — Node 환경 디스크 (Workers ✕)
6. 메모리 연산

- Compaction: 메시지 삭제 → 부분 축소 → 세션 메모리 정리 → LLM 요약 (순서 고정)
- Error recovery: in-process 축소 → LLM compact → 에러 반환
- Token counting: 문자열 추정 먼저 → 정밀 계산 (`js-tiktoken`) 은 임계치 근접 시만
- 판단 기준: **"같은 결과를 한 계층 낮은 비용으로 낼 수 있는가?"**
- 반례: 토큰 경계 검사할 때마다 LLM tokenizer API 호출 — 근사치로 충분한데 매번 원격 호출

## 3. 캐시 안정성 우선 (Cache Stability First)

프롬프트 구조를 안정적으로 유지하여 prompt cache 적중률을 극대화한다.

**왜:** Claude API prompt cache 는 prefix 의 byte-identical 매칭 여부로 작동. 캐시 히트 시 토큰 단가 대폭 감소 + latency 단축. 무효화 1회 = 세션 전체의 토큰 비용이 수 배 상승.

- Tool 정의: 이름순 정렬, built-in 먼저
- System prompt: 정적 (prefix) + 동적 (suffix) 분리
- Attachment 수집: 변경 빈도 낮은 것 앞 (고정 순서)
- Sub-agent fork: 부모의 prompt + tools 를 byte-identical 로 상속
- 판단 기준: **"이 변경이 prompt cache prefix 를 무효화하는가?"**
- 반례: 에이전트 system prompt 에 `new Date().toISOString()` / `turnCount` / random seed 삽입 — 매 턴 prefix 달라져서 cache hit 0%

## 4. 격리 기본, 공유 옵트인 (Isolation Default, Sharing Opt-in)

Sub-agent 는 복제된 상태로 시작. 부모 상태 변이는 명시적 옵트인만.

**왜:** 부모 - 자식 state 공유는 동시성 버그 + 디버깅 불가능한 오염의 원천. 격리가 기본이어야 공유가 눈에 띄고 설계 대상이 된다.

허용되는 공유 (명시적):

- Abort signal: 부모 → 자식 cascade (`AbortController` chain — 자식 즉시 중단)
- Trace context 필드 (`requestId`, `traceId`, `spanId`, `sessionId`, `userId`, `runName`, `agent`, `model`, `turnCount`, `spawnDepth`): 로깅 / 모니터링용 read-only. spawn 시 `AsyncLocalStorage` snapshot + `spawnDepth + 1` rebind 로 부모 오염 방지
- 그 외 (messages, tool decisions, file cache): **deep clone** (`structuredClone` / 직렬화 round-trip)

- 판단 기준: **"부모와 자식이 같은 객체를 공유하고 있는가? 의도적 공유인가?"**
- 반례: `toolDecisions` Map 을 부모 - 자식이 공유해서 자식이 거부한 tool 이 부모에게도 영향 — 권한 경계 오염

```typescript
// ✅ spawn 시 deep clone + spawnDepth+1
const childState = {
  ...structuredClone(parentState),
  spawnDepth: parentState.spawnDepth + 1,
  abortSignal: AbortSignal.any([parentState.abortSignal]),  // cascade
};
```

## 5. 구조화된 에러 → 모델 반환 (Structured Errors to Model)

도구 에러는 모델에게 반환. 백엔드가 대신 판단하지 않는다.

**왜:** 도구 실패의 "다음 행동" 을 백엔드가 판단하면 모델의 의도를 놓친다. 재시도? 다른 도구? 사용자에게 질문? 은 모델이 맥락 보고 결정.

- `ToolResult({ isError: true, content: 'human readable message' })`
- 자동 재시도 금지 — 모델이 다음 행동 결정
- 에러 메시지 절단: 현재 구현은 **head-truncate** (`TOOL_PREVIEW_MAX_CHARS = 4000`, `streaming/toolResultPreview.ts`). 스택 트레이스는 끝줄에 핵심 이유가 있으므로 head-only 가 정보 손실 가능 — 스택 트레이스 전용 head + tail 유틸은 **미래 개선** 사항
- 판단 기준: **"백엔드가 모델 대신 '다음 행동' 을 정하고 있는가?"**
- 반례: `applyEdit` 도구 실패 시 자동 3회 재시도 후 조용히 성공 / 실패 반환 — 모델은 실패 이유도, 재시도 히스토리도 모름

## 6. 동적 컨텍스트 주입 (Dynamic Context Injection)

시작 시 전부 로드하지 않는다. 접근 시점에 관련 컨텍스트를 주입한다.

**왜:** 모든 규칙 / 메모리 / 스킬을 시작 시 로드하면 매 세션 토큰 낭비 + 관련 없는 정보로 모델 혼란. 필요해질 때 필요한 만큼만.

- 파일 접근 시 해당 경로의 규칙 / 메모리 주입 (nested memory)
- 조건부 규칙: `paths` frontmatter 매칭 파일 접근 시만 로드
- 판단 기준: **"이 컨텍스트가 지금 필요한가, 아니면 접근 시점에 주입할 수 있는가?"**
- 반례: 모든 rule 을 system prompt 에 inline 하여 매 세션 20K 토큰 소비 — §3 cache 도 함께 무너짐

## 7. 부분 로드 (Partial Loading)

전체가 필요한지 먼저 묻는다. 필요 없으면 부분만 로드한다.

**왜:** 큰 데이터를 통째로 context 에 넣으면 token budget 낭비 + compaction 트리거 빈발. Head-only, preview, head + tail 패턴으로 토큰당 정보 밀도를 최대화.

- 스킬 목록: 예산 내 절삭
- 도구 결과: 초과 시 **head-truncate + preview (현재 구현)**. 전체 데이터는 버려지고 모델은 preview 만 보게 됨. 미래: R2 spill 확장 (전체를 `r2://tool-results/<id>` 저장하고 `tool_result_fetch` 도구로 on-demand 조회) 예정
- 세션 목록: head + tail 만 읽기
- 판단 기준: **"전체가 필요한가? 부분으로 같은 결과 낼 수 있는가?"**
- 반례: 파일 Edit 전 Read 전체 의무는 §1 safe default 로 예외 (외부 변경 감지 필요)

## 원칙 간 충돌 — 상황별 trade-off

상위 번호가 **기본 우선** 이지만 상황별 판단. 프로젝트에서 실제 발생했거나 발생할 수 있는 충돌:

| 충돌 | 사례 | 해결 |
|------|------|------|
| §2 vs §3 | 싼 축소 방법이 cache prefix 를 깨는 경우 | §3 우선: cache 유지하는 방법 선택 (더 비싼 compaction 감수) |
| §7 vs §1 | partial view 인 파일을 편집하려는 경우 | §1 우선: 편집 차단, 전체 Read 요구 |
| §4 vs §2 | `structuredClone` 비용이 높은 경우 | §4 우선: 격리 유지. 비용은 구조로 최적화 (shallow clone + CoW) |
| §1 vs §5 | 유효성 실패를 safe-default 로 차단 vs 모델에 에러 반환 | 도메인 검증 실패 → §5 (모델 반환). 시스템 경계 (path traversal, scope 위반) → §1 (즉시 차단) |
| §3 vs §6 | 동적 컨텍스트 주입이 매번 달라 cache 깨는 경우 | §3 우선: 주입 지점을 suffix (동적 영역) 로 이동. prefix 는 정적 유지 |
| §2 vs §5 | 모델에게 매번 에러 판단 맡기는 LLM 비용 | §5 우선: 모델 의사결정 비용은 "구조화" 로 절감 (명확한 에러 메시지 + 재시도 가이드 inline 포함) |

## PR 리뷰 자가체크

변경 전 아래 체크. "Yes" 이면 영향받는 원칙 재확인:

- [ ] prompt cache prefix (tools 정렬, system prompt, attachment 순서) 에 영향? → §3
- [ ] 새 설정 / 플래그의 기본값이 "느슨한" 쪽인가? → §1
- [ ] 자동 재시도 / 자동 fallback / 자동 수정 로직을 추가? → §5 위험
- [ ] sub-agent 에 부모 state 를 직접 참조시키는 코드? → §4 위험
- [ ] 시작 / 부팅 시 전체 데이터를 메모리에 로드? → §6 / §7 위험
- [ ] 에러 메시지에 시크릿 / 내부 경로 노출? → §5 + `error-handling` skill

## 메타

이 문서는 **원칙 문서** 이므로 다른 skill 의 "불변식 / 확장 / 영향도 / 금지" 4-section 구조를 따르지 않는다.
