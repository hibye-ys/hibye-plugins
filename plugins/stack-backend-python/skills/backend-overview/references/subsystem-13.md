# Subsystem 13 — State / Session

## 목적 (1줄)

세션(대화 히스토리), 비용, 메모리, 태스크를 보관하는 상태 레이어.

## 파일 / 모듈

- `backend/state/session.py` — 세션 생성/조회/아카이브 (InMemory 구현체 + Protocol)
- `backend/state/db_session.py` — DB 구현체 (`DbSessionStore` / `DbSessionHistory`)
- `backend/data/ports.py` — `SessionPort`, `SessionHistoryPort` Protocol 선언
- 비용은 `SessionRecord` 의 `total_*` 필드로 통합되어 별도 파일 없음

## 주요 타입 / 함수

| 이름 | 역할 |
|---|---|
| `SessionIdentity` | session_id + user_id + 스폰 계보 (write-once on ensure) |
| `SessionRecord` | identity + turn_count + cumulative usage/cost 필드 |
| `SessionPort.ensure_session(identity)` | 첫 호출 시 생성, 이후 조회 |
| `SessionPort.record_turn(session_id)` | turn_count ++ + last_accessed 갱신 |
| `SessionPort.add_usage(session_id, ...)` | 토큰/비용 누적 |
| `SessionHistoryPort.append_messages(session_id, msgs)` | 대화 이력 누적 |
| `SessionHistoryPort.get_messages(session_id, limit)` | 이력 replay |

## 세션 흐름

```
1. POST /run/<name> (session_id 없음) → ensure_session 이 새 UUID 발급
2. POST /run/<name> (session_id 있음) → 기존 SessionRecord 로드
3. 세션 내 messages 누적 → compaction 자동 적용
4. 일정 시간 비활성 → TTL sweep (InMemory) / DB TTL (Db)
```

## 저장소 전략 (session store Protocol / StoragePort)

Port Protocol 뒤로 숨긴 두 구현체를 동시에 제공:

| 구현체 | 위치 | 용도 |
|---|---|---|
| `InMemorySessionStore` / `InMemorySessionHistory` | `backend/state/session.py` | dev / 단일 worker |
| `DbSessionStore` / `DbSessionHistory` | `backend/state/db_session.py` | 다중 worker / 영속 |

부팅 시 `APP_DB_ENABLED` 로 선택. 호출자는 Protocol 만 참조.

## 동시 요청 처리

- 같은 세션에 동시 요청 → **거절** (HTTP 409 Conflict)
- 세션별 lock (`asyncio.Lock`) 으로 직렬화
- 다른 세션은 완전 독립 (병렬 처리)

## 담당 skill

`session-audit` — SessionPort 준수 / LRU / user_id scoping 감사.

## 범위

- InMemory: `INMEMORY_SESSION_MAX=10_000` LRU + `INMEMORY_SESSION_TTL=48h` sweep
- DB: `sessions`, `session_messages` 테이블 (Alembic 관리)
- Memory extraction / Task 관리는 별도 구현 없음 (도구 경유로 외부에서 처리)

## Gotchas

- **InMemory 재시작 손실**: dev / 단일 worker 전용. 프로덕션은 DB 구현체 필수.
- **concurrent session 거절**: 409 로 반환하되 클라이언트가 재시도 루프에 빠지지
  않도록 프론트에 명확한 에러 메시지.
- **cost tracking 정확도**: provider usage 필드를 그대로 합산. 캐시 히트 토큰은
  별도 항목 (`cache_read_tokens` / `cache_creation_tokens`).
- **구체 구현체 import 금지**: `DbSessionStore` 같은 클래스를 호출자 코드에서 직접
  import 하지 말 것 — `SessionPort` Protocol 만 참조 (StoragePort).

## 관련 AD

- session store Protocol — 세션 저장소 Protocol 추상화
- StoragePort — StoragePort 추상화 전반
