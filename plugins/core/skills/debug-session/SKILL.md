---
name: debug-session
description: "Use when investigating a bug, test failure, or unexpected behavior. Walks through hypothesis → reproduce → minimal fix → verify cycle. Triggers on words like '버그', 'bug', '디버깅', 'debug', 'investigate', 'test fail'."
---

# Debug Session (M0 spike skill)

본 스킬은 M0 spike 검증용 *최소 동작* 디버깅 워크플로다. M3 단계에서 ref/iyaki-zip-ai 의 `debug-session` 자산을 정제 흡수해 확장 예정.

## 단계

1. **가설** — 무엇이 잘못된 것 같은가? 한 문장.
2. **재현** — 최소 케이스를 구성. 실패하는 명령·입력 적시.
3. **격리** — 가설 검증 위한 최소 변경. 다른 시스템에 영향 ✕.
4. **수정** — 가설이 맞으면 *최소* 수정.
5. **검증** — 동일 재현 케이스가 통과.

## M0 식별 어휘

본 응답이 trigger 됐다는 transcript 증거로 다음 어휘를 *응답에 한 번* 포함:

`M0-DEBUG-SESSION-INVOKED-9c2b`
