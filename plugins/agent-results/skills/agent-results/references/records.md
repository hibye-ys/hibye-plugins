# 공통 기록 형식

`node <cli> record --file <file.json>`의 입력 예시다. source는 실제 호스트/서비스 식별자를 사용한다. 문자열을 상상해 채우지 않고 모르는 turn/project는 null로 둔다. occurred_at은 원 시각 또는 `unknown`이다. 원문은 이 JSON을 저장소 밖 임시 파일로 준비하고 필요 후 원래 프로젝트의 보존 규칙에 따른다.

```json
{
  "schema": "agent-results.event.v1",
  "source": { "kind": "coding_host", "host": "codex", "project": null, "session_id": "actual-session", "turn_id": null },
  "event_id": "native-event-or-stable-id",
  "event_type": "feedback",
  "occurred_at": "unknown",
  "components": [],
  "artifacts": [{ "kind": "user_correction", "file": "/absolute/path/to/feedback.txt" }],
  "data": { "relation": "explicit", "feedback_source_ref": "actual-user-message-ref", "target_run_key": "actual-run-key" },
  "coverage": { "status": "partial", "limitations": ["Feedback was explicitly linked; unrelated later edits are not attributed."] }
}
```

`components`의 각 항목은 `{kind,id,source,revision,usage}`다. revision은 파일 SHA256 같은 고정 버전이고 usage는 `read|declared|evidence_linked|unknown`이다. kind는 새로운 문자열 종류를 허용한다. 동일 event_id를 다른 내용으로 덮어쓸 수 없다. 재수집은 같은 내용으로, 갱신은 새로운 event_id로 기록한다.

`recommend --file <file.json>`:

```json
{
  "run_key": "64-character-run-key",
  "target": { "kind": "skill", "id": "actual-skill", "source": "/actual/installed/SKILL.md", "revision": "actual-version" },
  "reason": "실제 사례에서 확인한 문제와 영향",
  "signal": "explicit_correction",
  "confidence": "high",
  "evidence": [{ "event_key": "actual-event-key", "artifact_digest": "actual-stored-artifact-digest" }]
}
```

signal은 `explicit_correction|required_check_failed|observed_omission`이다. evidence event에 해당 target의 evidence_linked component가 있어야 한다. 원문 근거를 열어 확인한 호출자가 의미를 판단하며 파일 경로·고정 문자열·instruction_ref만으로 사람의 승인이나 인과관계가 인증되지는 않는다.

`decide --status resolved --file <result-refs.json>`의 파일은 실제 저장된 수정·검증 event 목록이다:

```json
[{"run_key":"actual-run-key","event_key":"actual-result-event-key"}]
```
