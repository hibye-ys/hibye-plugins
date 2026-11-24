# 작은 예 — README 설치 명령 한 줄 고치기

작은 일도 네 파일을 쓰되 작은 만큼 짧게 쓴다.

spec.md

```md
# README 설치 명령 고치기 — 스펙
개정: 1 · 상태: confirmed · 만든 시각: 2026-11-24T16:30:00+09:00
## 목표
> "README 설치 명령 한 줄만 고쳐 줘"
- A1: 고친 명령을 돌려 설치가 끝나면 통과
```

plan.md

```md
# README 설치 명령 고치기 — 계획
개정: 1 · 상태: ready · 스펙: [spec.md](./spec.md) 개정 1
순서: T01 → T02 · T01 고칠 줄 정하기 · T02 고치고 A1 확인하기
```

inject.md

```md
# 주입 — README 설치 명령 고치기
## 목표
> "README 설치 명령 한 줄만 고쳐 줘"
## 지시
- README 말고 다른 파일은 고치지 않는다 — 사용자 원문: "다른 건 손대지 마"
## 읽을 곳
- [spec.md](./spec.md) — 언제 읽는지: 고칠 한 줄을 정할 때
- [plan.md](./plan.md) — 언제 읽는지: 순서를 볼 때
- [status.md](./status.md) — 언제 읽는지: 지금 단계를 볼 때
```

status.md

```md
# README 설치 명령 고치기 — 진행 표

작업 id: readme-install
맡은 쪽: Claude 세션(이 브랜치의 worktree)
지금 단계: T01 고칠 줄 정하기
다음 한 가지: README 를 읽는다
브랜치: fix/readme-install
상태: 진행
계획: [plan.md](./plan.md) · 개정 1 · 스펙: [spec.md](./spec.md) · 개정 1

| 과업 | 상태 | 맡은 쪽 | 과업 카드 · 근거 | 막힌 것 / 다음 |
| --- | --- | --- | --- | --- |
| T01 | 진행 | Claude 세션 | [T01](./tasks/T01.md) | 없음 |
```
