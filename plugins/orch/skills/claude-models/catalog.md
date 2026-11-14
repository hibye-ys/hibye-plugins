# Claude 모델 카탈로그

> 출처: https://claude.dev/blog/which-claude-model-should-you-build-with/ · 확인일 2026-11-14
> 모델이 바뀌면 이 파일만 고친다(`/orch:claude-models refresh`). 판단 규칙은 SKILL.md 에 있다.

## GA 모델

| 별칭 (Agent `model`) | 현재 버전 | 용도 | 지연 | 입력/출력 $/MTok | 캐시 읽기 | 기본 effort (Claude Code) | fast mode |
|---|---|---|---|---|---|---|---|
| `haiku` | Haiku 5.5 | 대량·비용 민감 | 가장 빠름 | $0.10/$0.50 (≤100K), $0.50/$2.50 (>100K) | $0.01 / $0.05 | medium | 없음 |
| `sonnet` | Sonnet 5.5 | 빠르고 유능한 범위형 작업 | 빠름 | $2/$10 | $0.10 | medium | 없음 |
| `opus` | Opus 5.5 | 일상적 고난도 코딩·지식 업무 (기본) | 보통 | $4/$20 | $0.20 | medium | 있음 |
| `fable` | Fable 5.2 | 가장 어려운 기술 작업 | 보통 | $8/$40 | $0.20 | medium | 있음 |

- 전 모델 1M 컨텍스트, 최대 출력 128K.
- Mythos 5.2 는 검증 프로그램 전용이다. 배정하지 않는다.
- Haiku 는 프롬프트가 100K 를 넘으면 단가가 5배가 된다. 짧은 입력에서 가장 유리하다.

## 작업별 시작점

| 작업 | 모델 | 시작 effort |
|---|---|---|
| 일상 엔지니어링·디버깅·여러 PR 에 걸친 기능 | opus | medium → 필요하면 high |
| 분류·라우팅·태깅·대량 추출 | haiku | medium |
| 파일 검색·로그 읽기·요약 (서브에이전트) | haiku 또는 sonnet | 기본값 |
| 대화형 세션 (사람이 기다림) | sonnet (단순 대량 채팅은 haiku) | low~medium |
| 범위가 명확한 코딩 (버그 수정·스펙 기반 기능) | sonnet | medium → 어려우면 high |
| 일상 문서·슬라이드·스프레드시트 | sonnet | medium |
| 복잡한 재무 모델·대량 원자료 기반 문서 | opus | medium |
| 반복되는 조사·리뷰·초안 에이전트 | sonnet | medium |
| 컴퓨터 사용·비전 중심 루프 | opus | medium |
| 대규모 리팩터링·마이그레이션·아키텍처·여러 서브에이전트 지휘 | fable | medium → high |
| 심층 리서치·과학·정량 분석 | fable | medium → high |

## 실측 수치 (판단 근거)

- Opus 5.5 SWE-bench Pro, high 대비: low −8점·비용 약 1/3 · medium −2.5점·약 70% · xhigh +1.4점·2.5배.
- low 로 먼저 돌리고 실패만 high 재실행: 약 97% 통과·작업당 $0.17. 전부 high: 95.3%·$0.29.
- Opus 리드 + Sonnet 워커(최대 25 병렬), 2,200만 토큰 결함 탐색: Opus 단독 대비 비용 약 1/3 감소, 성능 비슷.
- Fable 5.2 high ≈ Opus 5.5 max (FrontierCode 2.0), 작업당 비용은 약 절반.
- Advisor, 실행 모델이 이미 강한 경우 (Opus 5.5 high executor + Fable 5.1 advisor): +1.7점·비용 약 2.1배. 실행 간 노이즈 경계, effort 를 올린 것과 비슷한 정도.
- Advisor 권장 조합 ([advisor 문서](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool)): Sonnet executor + Opus advisor(총비용 비슷하거나 낮음) 또는 + Fable 5.2(품질 최대). Haiku executor + Opus·Fable advisor(Haiku 단독보다 비싸지만 executor 교체보다 쌈). 코딩은 Sonnet medium + Opus advisor ≈ Sonnet 기본 effort, 더 저렴. 결과는 작업마다 다르다.
- 컨텍스트 턴당 캐시 읽기(Opus): 150K ≈ $0.03, 20K ≈ $0.004.
- 20문제 중 2개가 지출의 43%. 평균보다 어려운 작업 기준으로 비교한다.
