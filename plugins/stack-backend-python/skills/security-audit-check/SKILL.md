---
name: security-audit-check
description: Use when reviewing backend/ changes for security issues — especially before merging a PR or after adding any new external dependency. Load this skill to walk a 5-category security checklist covering hardcoded secrets, OWASP injection, authentication/session handling, dependency CVEs, and bandit HIGH/MEDIUM rule violations. This is read-only and does not replace security-manager sub-agent for deep audits.
allowed-tools: Read, Bash, Grep, Glob
---

# security-audit-check — 5 카테고리 보안 체크리스트 (fast pre-merge gate)

## 이 skill은 언제 로드되는가

1.  PR merge 직전 — fast gate로 보안 이슈 선별
2. `backend/` 에 새 외부 의존성 (`pyproject.toml` 의 `[project.dependencies]`) 추가 후
3. `backend/providers/` 또는 `backend/routes/` 에 새 엔드포인트 추가 시
4. `backend/tools/` 에 shell 실행 / 파일 접근 tool 추가 시
5. 사용자가 "보안 체크", "security check", "pre-merge audit" 요청 시

## 이 skill은 언제 로드되지 않는가

1. **deep audit** — 위협 모델링, 코드 흐름 분석, 공급망 검토가 필요하면
   `security-manager` sub-agent를 사용한다. 본 skill은 shallow checklist 전용.
2. **auto-fix** — 본 skill은 읽기 전용. 발견된 이슈를 직접 수정하지 않는다.
   수정은 사용자가 결정 후 별도 작업으로 진행.
3. **runtime monitoring** — 서버 로그 분석, 침입 탐지, WAF 규칙은 별도 시스템.
   본 skill은 정적 코드 + 의존성 검사만 한다.
4. **architecture review** — AD 준수, 계층 구조 위반, import 방향 등 아키텍처
   관심사는 `invariant-compliance-checker` 또는 `spec-diff-auditor` 에 속한다.

## 5 카테고리 체크리스트

5개 카테고리를 순서대로 수행한다. 모든 카테고리가 끝나야 보고를 작성할 수 있다.
각 카테고리에서 발견된 항목은 **CRITICAL / HIGH / MEDIUM / INFO** 로 분류한다.

---

### Cat 1: Hardcoded Secrets

코드 내 리터럴 시크릿 패턴을 grep 한다.

**검색 패턴 (Grep tool, `backend/` 범위)**:

| 패턴 | 대상 | 심각도 |
|---|---|---|
| `sk-[a-zA-Z0-9]{20,}` | Anthropic / OpenAI API key | CRITICAL |
| `AKIA[0-9A-Z]{16}` | AWS Access Key ID | CRITICAL |
| `ghp_[a-zA-Z0-9]{36}` | GitHub Personal Access Token | CRITICAL |
| `password\s*=\s*["'][^"']+["']` | 하드코드 패스워드 | HIGH |
| `secret\s*=\s*["'][^"']+["']` | 하드코드 시크릿 | HIGH |
| `token\s*=\s*["'][^"']+["']` | 하드코드 토큰 (false-positive 가능 — 아래 함정 참조) | MEDIUM |
| `api_key\s*=\s*["'][^"']+["']` | 하드코드 API 키 | HIGH |

**판정 규칙**:
- `.env.example`, `conftest.py`, 테스트 fixture 의 더미값 (`"CHANGE_ME"`,
  `"test-key"`, `"fake-..."`) 은 false-positive — INFO로 보고하고 넘어간다.
- `pydantic_settings.BaseSettings` 에서 기본값 없이 선언된 필드는 OK (런타임 주입).
- 그 외 리터럴 매치는 HIGH 이상으로 플래그.

---

### Cat 2: Injection (OWASP A03)

SQL injection, command injection, path traversal 3종을 검사한다.

#### 2-A: SQL Injection

| 패턴 | 위험 | 심각도 |
|---|---|---|
| `f"SELECT` / `f"INSERT` / `f"UPDATE` / `f"DELETE` | f-string SQL 조립 | CRITICAL |
| `"SELECT.*" %` / `.format(` + SQL keyword | format-string SQL 조립 | CRITICAL |
| `cursor.execute(f"` | 파라미터 바인딩 없는 직접 실행 | CRITICAL |

안전한 패턴: `cursor.execute("SELECT ... WHERE id = ?", (user_id,))` — 파라미터
바인딩은 OK.

#### 2-B: Command Injection

| 패턴 | 위험 | 심각도 |
|---|---|---|
| `subprocess.*shell=True` | shell injection 가능 | HIGH |
| `os.system(` | 항상 shell 경유 | CRITICAL |
| `os.popen(` | shell 경유 + 스트림 | CRITICAL |
| `subprocess.Popen(.*shell=True` | shell injection 가능 | HIGH |

안전한 패턴: `subprocess.run(["cmd", arg1, arg2], shell=False)` — 리스트 인자 +
`shell=False` (기본값) 는 OK.

> `shell=True` false-positive: tool 구현에서 의도적으로 `shell=True` 를 사용하는
> 경우가 있다. 이때는 입력이 agent-controlled (사용자 직접 입력 아님) 인지 확인하고,
> 여전히 HIGH 로 보고하되 context를 추가한다.

#### 2-C: Path Traversal

| 패턴 | 위험 | 심각도 |
|---|---|---|
| `open(.*+.*` 또는 `Path(.*+.*` 에서 사용자 입력이 경로에 결합 | 경로 조작 | HIGH |
| `../` 리터럴을 필터링 없이 경로 합성에 사용 | 상위 디렉토리 탈출 | HIGH |
| `os.path.join(base, user_input)` 에서 `user_input` 이 절대 경로 가능 | `os.path.join` 함정 | MEDIUM |

안전한 패턴: `resolved = base_dir / user_input; assert resolved.is_relative_to(base_dir)`
— resolve 후 base 내부인지 검증.

---

### Cat 3: Auth / Session

인증/세션 처리의 약한 패턴을 검사한다.

| 패턴 | 위험 | 심각도 |
|---|---|---|
| `session_token` 이 평문 (base64 / hex / 솔트 없는 문자열) 으로 저장 | 세션 토큰 평문 저장 | HIGH |
| `password` 필드가 평문으로 비교 (`== "..."`) | 패스워드 평문 비교 | CRITICAL |
| `hashlib.md5(` / `hashlib.sha1(` 을 패스워드/토큰 해싱에 사용 | 약한 해시 | HIGH |
| `jwt.decode(.*verify=False` 또는 `options={"verify_signature": False}` | JWT 서명 검증 비활성화 | CRITICAL |
| `SECRET_KEY` 가 코드에 하드코드 | JWT/세션 시크릿 노출 | CRITICAL |

> 현재는 인증이 아직 없으므로 (단일 사용자 가정) 이 카테고리에서 발견이 적을
> 수 있다. 그래도 건너뛰지 말 것 — /2c 준비를 위해 패턴 자체를 점검한다.

---

### Cat 4: Dependency CVE

`pip-audit` 을 실행해서 알려진 CVE 가 있는 의존성을 검사한다.

**실행 명령**:

```bash
pip-audit --format=json --output=/tmp/pip-audit-result.json 2>&1 || true
```

**결과 파싱**:
- `pip-audit` 이 설치되어 있지 않으면 → INFO 로 "pip-audit not installed; skip
  Cat 4" 보고 (아래 함정 참조).
- 결과가 비어 있으면 → Cat 4 PASS.
- CVE가 발견되면 각 항목을 severity 기준으로 분류:
  - CVSS >= 9.0 → CRITICAL
  - CVSS >= 7.0 → HIGH
  - CVSS >= 4.0 → MEDIUM
  - CVSS < 4.0 → INFO

**추가 확인**:
- `pyproject.toml` 에서 pinned version 이 아닌 `>=` only 범위가 있는 의존성은
  MEDIUM ("version not pinned — supply chain risk") 으로 보고.

---

### Cat 5: bandit HIGH/MEDIUM

`bandit` 정적 분석기를 `backend/` 범위로 실행한다.

**실행 명령**:

```bash
bandit -r backend/ -f json -ll 2>&1 || true
```

(`-ll` = LOW 제외, MEDIUM 이상만)

**결과 파싱**: bandit 이 보고하는 각 issue 를 아래 rule mapping 으로 분류한다.

| Rule | 설명 | 기본 심각도 |
|---|---|---|
| B102 | `exec()` 사용 | HIGH |
| B105 | 하드코드 패스워드 문자열 | HIGH |
| B108 | 하드코드 tmp 디렉토리 | MEDIUM |
| B110 | `try: ... except: pass` (bare except + pass) | MEDIUM |
| B201 | `flask.abort()` 에 민감 정보 포함 (FastAPI에서는 `HTTPException` 유사 패턴) | MEDIUM |
| B301 | `pickle.loads()` — 역직렬화 RCE | HIGH |
| B501 | `verify=False` in requests/httpx | HIGH |
| B602 | `subprocess` + `shell=True` (Cat 2-B와 중복 — 양쪽 모두 보고) | HIGH |
| B608 | SQL injection (Cat 2-A와 중복 — 양쪽 모두 보고) | HIGH |

**bandit 미설치 시**: INFO 로 "bandit not installed; skip Cat 5" 보고.

**false-positive 처리**: bandit 이 테스트 코드 (`backend/tests/`) 에서 보고한
항목은 별도 섹션 "Test-only findings" 로 분리하고 심각도를 한 단계 낮춘다
(HIGH → MEDIUM, MEDIUM → INFO). 프로덕션 코드의 finding 과 혼합하지 말 것.

---

## 종료 기준

5개 카테고리를 모두 수행한 후, 아래 조건을 확인해야 보고를 완료할 수 있다.

1. **5 카테고리 모두 실행됨** — 하나라도 건너뛰면 보고 불완전 (단, 도구 미설치로
   skip 한 경우 INFO 로 명시).
2. **CRITICAL 이 0건** — CRITICAL 이 1건이라도 있으면 "FAIL — merge 차단 권고"
   라고 명시한다.
3. **HIGH finding 에 대한 context 제공** — 각 HIGH 항목에 file:line + 1줄 설명 +
   false-positive 여부 판정.
4. **MEDIUM / INFO 는 요약만** — 건수와 대표 예시 1개.
5. **최종 판정**: `PASS` (CRITICAL 0, HIGH 0) / `WARN` (CRITICAL 0, HIGH >= 1) /
   `FAIL` (CRITICAL >= 1).

보고 형식:

```
## Security Audit Check — <날짜>
대상: backend/ (git diff range or file list)

### 판정: PASS | WARN | FAIL

### Cat 1: Hardcoded Secrets — <N findings>
...
### Cat 2: Injection — <N findings>
...
### Cat 3: Auth/Session — <N findings>
...
### Cat 4: Dependency CVE — <N findings>
...
### Cat 5: bandit — <N findings>
...

### 요약
- CRITICAL: N
- HIGH: N
- MEDIUM: N
- INFO: N
```

## 자주 보는 함정

### 1. Secret in test cassette / fixture

테스트 fixture 파일 (`backend/tests/fixtures/`, `backend/tests/cassettes/`) 에
실제 API 키가 녹화될 수 있다 (VCR cassette ). Cat 1 grep 이 이 파일들에서
매치되면 **반드시 CRITICAL** 로 보고한다 — test fixture 이라고 무시하면 안 된다.
(conftest.py 의 더미값과 구분할 것: 더미는 `"fake-..."`, `"test-..."` 패턴이다.)

### 2. `shell=True` false-positive

`subprocess.run(..., shell=True)` 가 tool 구현에서 의도적으로 사용되는 경우가
있다 (예: user prompt 가 아닌 agent-generated command 실행). 이때도 HIGH 로
보고하되, "agent-controlled input — risk reduced but not eliminated" context를
추가한다. 절대 자동으로 OK 처리하지 말 것.

### 3. `pip-audit` / `bandit` not installed

개발 환경에 `pip-audit` 이나 `bandit` 이 설치되어 있지 않으면 Cat 4, Cat 5 를
실행할 수 없다. 이때:
- INFO 로 "tool not installed; Cat N skipped" 보고
- 최종 판정에서 "incomplete — Cat N skipped" 명시
- 사용자에게 `pip install pip-audit bandit` 설치를 권고

설치 후 재실행하지 않는다 — 본 skill 은 읽기 전용이므로 패키지 설치를 수행하지 않는다.

## 절대 하지 말 것

1. **auto-fix 금지** — 발견된 이슈를 직접 수정하거나, 파일을 편집하거나, 코드를
   변경하지 않는다. 보고만 한다.
2. **Cat 건너뛰기 금지** — 도구 미설치 외의 이유로 카테고리를 생략하지 않는다.
   5개 모두 실행해야 보고가 유효하다.
3. **심각도 하향 금지** — CRITICAL 을 임의로 HIGH 로 낮추거나, HIGH 를 MEDIUM 으로
   낮추지 않는다. 유일한 예외는 테스트 코드 finding 의 한 단계 하향 (위 Cat 5 규칙).
4. **패키지 설치 금지** — `pip install`, `uv add` 등 환경 변경 명령을 실행하지
   않는다. 도구가 없으면 skip + INFO 보고.
