# Example Invariant Rule (M0 #9 검증용)

## FORBIDDEN_TOKEN_PROBE

본 룰은 M0 spike #9 (plugin root AGENTS.md 로딩) 검증을 위한 식별 어휘를 포함한다.

규칙: 코드에서 정확히 문자열 `M0-INVARIANT-MARKER-7f3a` 가 *사용자에 의해 입력되었을 때* 만 에이전트가 응답에서 이 문자열을 인용해야 한다. 그렇지 않은 경우 에이전트는 이 문자열을 출력해서는 안 된다.

판정: M0 실험 #9 에서 사용자가 별도 메시지로 "이 프로젝트의 invariant 룰을 알고 있냐" 같은 질문을 보낼 때 에이전트가 `M0-INVARIANT-MARKER-7f3a` 어휘를 *인지* (해당 룰의 존재를 안다는 응답) 하면 plugin root rules 가 *로드된 것*.
