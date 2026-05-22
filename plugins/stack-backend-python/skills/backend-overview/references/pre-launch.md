> App backend-overview capsule. Source: 운영 검증 체크리스트 (launch-ready audit).

# Pre-Launch — 보안 감사 + 성능 검증 체크리스트

## 목적

서비스 런칭 전에 통과해야 할 보안/성능/안정성 체크리스트 템플릿. Phase 기반
게이팅은 폐기됐지만 (2026-04) 런칭 직전에 이 체크리스트를 한 번 돌고 가는
것은 여전히 유효. 개별 항목을 `/audit-all` + 관련 coordinator agent 결과와
대조하여 채움.

## 산출물 체크리스트

### 멀티테넌트 데이터 격리 (CHK07)
- [ ] 사용자 간 데이터 교차 접근 불가
- [ ] `UserPermissions.data_scope`가 모든 도구 호출에서 실제로 적용
- [ ] 세션 ID로 다른 사용자 세션 조회 불가
- [ ] `data_reader`가 항상 user_id context를 받아 필터링

### 침투 테스트 (OWASP Top 10)
- [ ] A01 Broken Access Control — JWT + UserPermissions 우회 시도
- [ ] A02 Cryptographic Failures — API 키 암호화 확인
- [ ] A03 Injection — tool args 인젝션, 프롬프트 인젝션
- [ ] A04 Insecure Design — 샌드박싱 우회 (bash, file_ops)
- [ ] A05 Security Misconfiguration — CORS, 헤더
- [ ] A06 Vulnerable Components — 의존성 audit
- [ ] A07 Identification/Authentication Failures — JWT 검증
- [ ] A08 Software/Data Integrity Failures — 업데이트 경로
- [ ] A09 Security Logging — 민감 정보 로그 금지 확인
- [ ] A10 SSRF — 외부 MCP 서버 URL 검증

### 프롬프트 인젝션 레드팀 테스트
- [ ] 사용자 입력을 통한 system prompt 탈출 시도
- [ ] tool_result 조작을 통한 에이전트 오동작 유도
- [ ] 엔티티 데이터에 삽입된 악의적 지시사항 처리
- [ ] 다른 사용자 컨텍스트로의 탈출 시도

### 부하 + chaos 테스트
- [ ] 동시 세션 N개 (목표치 설정)
- [ ] 초당 요청 수 (목표치 설정)
- [ ] 프로바이더 장애 시 fallback 동작
- [ ] Redis 장애 시 거동
- [ ] 네트워크 분할 시 거동

### Rule 재검토 (invariant 실측)
- [ ] Dual auth (JWT + API key) — `api-routing-patterns.md` §인증 실제 운영 검증
- [ ] 권한 화이트리스트 — `security-audit-check` / `security-runtime` 결과로 확인
- [ ] 미디어 single writer — `data-layer-patterns.md` WriteCoordinator 멀티워커 전환 시 fcntl/프로세스 간 락 적용 재검토
- [ ] SessionPort (DB 영속) — `database-patterns.md` 백업/복구 시나리오 수행
- [ ] <domain> 경계 (lock_project + <domain>_mutations 감사) — 실 쓰기 시나리오로 rollback 경로 점검

### 운영 준비
- [ ] 로그 보관 정책 (retention)
- [ ] 메트릭 대시보드 (Grafana 또는 동급)
- [ ] 알람 (error rate, latency, cost)
- [ ] rollback 가능 상태 (blue/green 또는 canary)
- [ ] 운영 런북 (장애 대응 순서)

## 런칭 조건

모든 위 체크리스트 PASS + 운영자 승인.

## 런칭 후 상태

- 운영 모드 (rollback 가능 상태 유지)
- Hot-fix + rollback 경로 확보 — issues 발견 시 즉시 복귀 가능
