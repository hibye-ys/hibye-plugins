---
name: dependency-scanning
description: Use when auditing `pyproject.toml` + `uv.lock` for CVEs (pip-audit), license risks (GPL/AGPL contamination), stale maintainer activity, and supply-chain red flags. Defines the severity classification (CRITICAL/HIGH/MEDIUM/LOW/INFO), the license compatibility matrix for an Apache-2.0 / MIT codebase, and the 5-category report layout. Feeds security-manager sub-agent (dependency mode).
allowed-tools: Read, Bash, Grep, Glob
---

# dependency-scanning — 의존성 공급망 감사

## 이 skill은 언제 로드되는가

- 릴리스 밀리스톤 전 supply-chain 체크
- `pyproject.toml` 에 5+ 개 신규 의존성 추가 후
- CVE 관련 뉴스 이후 (e.g., 특정 패키지 침해 사고)
- `security-manager` sub-agent (dependency 모드) 호출 시 자동 로드

## 감사 5 카테고리

| # | 카테고리 | 도구 | 출력 |
|---|---------|-----|------|
| 1 | CVE 스캔 | `pip-audit` | 취약점 목록 + severity |
| 2 | License | PyPI metadata | 라이선스 분류 + 리스크 |
| 3 | Maintainer health | PyPI release history | stale / bus factor |
| 4 | Transitive depth | `uv.lock` 그래프 | depth > 3 경고 |
| 5 | Typosquat | PyPI 이름 유사도 | 가짜 패키지 의심 |

## CVE 심각도 분류

| Severity | CVSS | 대응 |
|----------|------|-----|
| CRITICAL | 9.0-10.0 | 즉시 fix (배포 block) |
| HIGH | 7.0-8.9 | 다음 릴리스 전 fix |
| MEDIUM | 4.0-6.9 | 분기 내 fix |
| LOW | 0.1-3.9 | 백로그 |
| INFO | N/A | 기록만 (fix 있는 CVE 의 older version) |

**Fix 버전이 없는 CVE** 는 CVSS 와 상관없이 항상 한 단계 올림.

## License 호환성 매트릭스 (Apache-2.0/MIT 프로젝트 기준)

| License | 직접 의존 | 전이 의존 | 액션 |
|---------|-----------|-----------|------|
| MIT / BSD / Apache-2.0 / ISC | OK | OK | — |
| LGPL-2.1+ / LGPL-3.0+ | WARN | INFO | dynamic linking 확인 |
| GPL-2.0 / GPL-3.0 | **BLOCK** | HIGH | 대체 탐색 |
| AGPL-3.0 | **BLOCK** | **BLOCK** | 대체 필수 |
| Commercial | User 판단 | User 판단 | 법무 검토 |
| Unknown / Proprietary | WARN | WARN | 메타데이터 확인 |

## Maintainer Health 신호

| 신호 | 값 | 분류 |
|-----|-----|------|
| 마지막 릴리스 | < 12mo | OK |
| 마지막 릴리스 | 12-24mo | WARN (활동 저하) |
| 마지막 릴리스 | > 24mo | STALE (검토 필요) |
| PyPI maintainer 수 | ≥ 2 | OK |
| PyPI maintainer 수 | 1 | WARN (bus factor 1) |
| Github stars | < 100 | INFO (가시성 낮음) |

**Stale ≠ bad**: 성숙한 라이브러리(`six`, `certifi` 등)는 업데이트가 드물어도 안전. 
조합 판단 — STALE + low star + unknown maintainer 일 때 HIGH 리스크.

## 실행 커맨드 레퍼런스

```bash
# CVE 스캔
uv run pip-audit --format json > audit.json

# License 확인 (설치된 패키지)
uv run python -c "
from importlib.metadata import distributions
for d in distributions():
    print(d.metadata['Name'], d.metadata.get('License', 'Unknown'))
"

# Transitive depth (uv)
uv tree --depth 5

# Typosquat 의심 (수동 PyPI 조회 필요)
# 예: 'reuests' 같은 오타 패키지 존재 여부
```

## 5 카테고리 리포트 레이아웃

```markdown
# Dependency Audit — <date>

## Executive summary
<posture + 주요 finding 1-2개>

## Cat 1: CVE findings
| CVE ID | Package | Current | Fixed in | Severity |

## Cat 2: License audit
| Package | License | Risk | Note |

## Cat 3: Maintainer health
| Package | Last release | Maintainers | Classification |

## Cat 4: Transitive depth
<depth > 3 chains list>

## Cat 5: Typosquat scan
<any close-name packages>

## Recommendations (priority order)
1. <CRITICAL CVE fix>
2. <GPL package replacement>
...
```

## 검증 체크리스트

- [ ] `pip-audit` 실행됨 (또는 INFO 로 미설치 표시)
- [ ] 모든 direct dep 라이선스 분류됨
- [ ] Stale / bus factor 1 패키지 표시됨
- [ ] uv.lock 기반 transitive depth 측정됨
- [ ] 우선순위 recommendation 최소 3 개

## 구현 중 막히면

- pip-audit 미설치 → `uv add --dev pip-audit` 또는 INFO 로 생략
- PyPI 조회 실패 (offline) → 로컬 `.dist-info/METADATA` fallback
- License 필드 비어있음 → 소스 repo `LICENSE` 파일 확인, 그래도 없으면 Unknown 분류
- CVE 가 disputed 상태 → NEEDS_MANUAL_REVIEW 로 격상
