> App backend-overview capsule. Source: design doc §3.8 LSP Integration.

# Subsystem 09 — LSP Server

## 목적 (1줄)

프론트엔드의 prose 에디터에 Language Server Protocol 기능(자동완성, diagnostics,
hover, entity highlight)을 제공한다.

## 파일 / 모듈

- `backend/lsp/server.py` — pygls 기반 LSP 서버 (WebSocket transport)
- `backend/lsp/completions.py` — 엔티티 `@` 자동완성 (aliases 포함)
- `backend/lsp/diagnostics.py` — Hard/World/Soft Rule 기반 일관성 경고
- `backend/lsp/hover.py` — 엔티티 요약 카드
- `backend/lsp/semantic_tokens.py` — 엔티티 타입별 색상 토큰
- `backend/routes/lsp.py` — `WebSocket /ai/lsp/ws` 엔트리

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `AppLanguageServer(pygls.LanguageServer)` | 메인 서버 클래스 |
| `complete_entity(prefix, context)` | `@` 입력 시 엔티티 자동완성 |
| `diagnose_prose(text, episode_id)` | 3-tier rule check |
| `hover_entity(entity_id)` | Hover 카드 데이터 생성 |
| `semantic_tokens(doc)` | 엔티티 span + 타입 색상 |

## 기능 표

| 기능 | 설명 |
|---|---|
| Entity Autocomplete | `@` 입력 시 엔티티 이름 자동완성 (aliases 포함) |
| Diagnostics | 실시간 일관성 경고 |
| Hover Info | 엔티티명에 마우스 올리면 요약 카드 |
| Go to Definition | 엔티티 클릭 → 위키/세계관 탭 이동 |
| Entity Highlight | 동일 엔티티 모든 멘션 색상 하이라이트 |
| Rename Symbol | 엔티티 이름 변경 → 전체 prose 일괄 치환 |

## Diagnostics 파이프라인

```
prose 변경 감지
  → 엔티티 NER (빠른 별명 테이블 매칭)
  → Hard Rule 체크 (결정론적, 즉시)
  → World Rule 체크 (결정론적, 즉시)
  → Soft Rule 체크 (LLM, debounced/비동기)
  → Diagnostic 결과를 에디터에 인라인 표시
```

Hard/World Rule은 즉시, Soft Rule은 debounce 후 LLM 호출.

## 프로세스 모델

- FastAPI 와 **같은 프로세스**, 별도 daemon thread 로 실행 (`main.py:342`)
- FastAPI 라우트가 아님 — pygls 자체 transport (stdio/WebSocket) 사용
- 엔티티 데이터는 <domain> 도메인 DB 에서 조회 — `backend/services/lsp_entities.py` 가 `backend/tools/_<domain>_db.py` 전용 pool 을 read-only 로 경유. 자체 TTL 캐시 + 쓰기 도구 성공 후 `ToolResult.metadata["resource_updated"]` 신호로 invalidation

## 담당 skill

`lsp-server`

## 범위

**부분 구현**. 기본 구조 존재, 기능별 완성도는 코드 기준.

## Gotchas

- **Soft Rule debounce**: 매 keystroke 마다 LLM 을 부르면 비용 폭발. 500ms debounce + 세션당 rate limit 필수
- **Entity 캐시 invalidation**: <domain> 도메인 쓰기 도구 (`<domain>_mutate.py`) 성공 시 `resource_updated` 메타데이터로 adapter 가 캐시 flush
- **pygls transport**: FastAPI 라우트 경로 외부에 있음 — 인증도 자체 구현 (`api-routing-patterns.md` §LSP)

## 관련 rule / skill

- `architecture.md` — LSP 계층 배치 (`lsp → engine / tools` 단방향)
- `database-patterns.md` §외부 도메인 경계 — 도메인 데이터 read-only 조회 경로
- `lsp-server` skill — pygls 구조 상세
