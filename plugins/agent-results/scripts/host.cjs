'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { digest, resolveContext, component, sensitiveSource } = require('./context.cjs');
const { prepareArtifact } = require('./artifact.cjs');
const store = require('./store.cjs');

function observedComponent(payload) {
  const file = payload.tool_input?.file_path || payload.tool_input?.path;
  if (typeof file !== 'string' || path.basename(file) !== 'SKILL.md') return [];
  if (!/^(Read|read_file|view_file)$/i.test(payload.tool_name || '')) return [];
  try { return [component(path.resolve(payload.cwd, file), 'read')]; } catch { return []; }
}

function lastAssistant(transcript) {
  if (typeof transcript !== 'string') return null;
  const fd = fs.openSync(transcript, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Transcript is not a file');
    const start = Math.max(0, stat.size - 1048576);
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start) lines.shift();
    for (const line of lines.reverse()) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      const message = row.type === 'response_item' ? row.payload : row.message;
      // A delayed transcript must not attach the previous turn's reply to the
      // current user request. The host's direct final message is preferred.
      if (message?.role === 'user' || row.type === 'user' || (row.type === 'event_msg' && row.payload?.type === 'user_message')) return null;
      if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
      const texts = message.content.filter(part => ['text', 'output_text'].includes(part.type) && typeof part.text === 'string').map(part => part.text);
      if (texts.length && (message.phase === undefined || message.phase === 'final_answer')) return texts.join('\n');
    }
    return null;
  } finally { fs.closeSync(fd); }
}

function capture(host, payload, collectionFailure = null) {
  if (!['codex', 'claude'].includes(host)) throw new Error('Unknown coding host');
  if (typeof payload.cwd !== 'string' || typeof payload.session_id !== 'string' || !payload.session_id) throw new Error('Missing native source identity');
  const context = resolveContext(payload.cwd);
  if (!context) return { enabled: false };
  const eventType = payload.hook_event_name;
  if (!['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure'].includes(eventType) ||
      (host === 'codex' && ['PostToolUseFailure', 'StopFailure'].includes(eventType))) throw new Error('Unsupported lifecycle event');
  // Subagents keep their own source identity; the parent remains an explicit ref.
  const agent = typeof payload.agent_id === 'string' ? payload.agent_id : null;
  const source = { kind: 'coding_host', host, project: context.project,
    session_id: agent ? `${payload.session_id}:agent:${agent}` : payload.session_id,
    turn_id: typeof payload.turn_id === 'string' ? payload.turn_id : typeof payload.prompt_id === 'string' ? payload.prompt_id : null };
  const limitations = ['Hook coverage is partial; shell reads do not prove skill use.', 'Secrets are filtered by known patterns only; data remains private to this project/user.'];
  const components = collectionFailure ? [] : observedComponent(payload);
  const artifacts = [];
  const artifactProcessing = [];
  const save = (kind, value) => {
    const { bytes, processing } = prepareArtifact(value);
    if (bytes.length > context.config.max_artifact_bytes) {
      limitations.push(`${kind}:oversized:${bytes.length}`);
      return;
    }
    artifacts.push({ kind, ...store.putArtifact(context.root, bytes) });
    artifactProcessing.push({ kind, ...processing });
  };
  const data = { checkout: context.checkout, commit: context.commit, branch: context.branch,
    parent_session_id: agent ? payload.session_id : null, agent_id: agent,
    tool_name: payload.tool_name || null, tool_use_id: payload.tool_use_id || null,
    model: payload.model || null, permission_mode: payload.permission_mode || null,
    artifact_processing: artifactProcessing };
  if (collectionFailure) {
    data.collection_failure = collectionFailure;
    limitations.push(`${collectionFailure.reason}: body omitted (${collectionFailure.input_bytes} bytes).`);
  } else if (eventType === 'SessionStart') {
    for (const file of ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.codex/config.toml']) {
      const full = path.join(context.checkout, file);
      try { components.push(component(full, 'unknown', file.endsWith('.json') || file.endsWith('.toml') ? 'configuration' : 'instruction')); } catch { /* Explicitly partial: missing files are not invented. */ }
    }
    data.plugin_version = require('../.codex-plugin/plugin.json').version;
    limitations.push('Configuration digests describe observed files, not the complete effective host configuration.');
  } else if (eventType === 'UserPromptSubmit') {
    if (typeof payload.prompt === 'string') save('user_message', payload.prompt);
    else limitations.push('User prompt not provided by host.');
  } else if (eventType === 'PostToolUse' || eventType === 'PostToolUseFailure') {
    const input = JSON.stringify(payload.tool_input || {});
    if (sensitiveSource(input)) {
      limitations.push('Sensitive-source tool body omitted.');
    } else {
      save('tool_call_result', { tool_name: payload.tool_name, tool_use_id: payload.tool_use_id,
        input: payload.tool_input ?? null, output: payload.tool_response ?? null,
        error: payload.error ?? null, is_interrupt: payload.is_interrupt ?? null });
    }
    for (const item of components) {
      save('component_snapshot', fs.readFileSync(item.source, 'utf8'));
    }
    const file = payload.tool_input?.file_path;
    if (typeof file === 'string' && /^(Write|Edit)$/i.test(payload.tool_name || '') && !sensitiveSource(file)) {
      try {
        const full = path.resolve(payload.cwd, file);
        if (!fs.lstatSync(full).isSymbolicLink() && fs.statSync(full).isFile() && fs.statSync(full).size <= context.config.max_artifact_bytes) {
          save('written_file_snapshot', fs.readFileSync(full));
          data.written_file = full;
        } else limitations.push('Written file snapshot unavailable or oversized.');
      } catch { limitations.push('Written file snapshot unavailable.'); }
    }
  } else if (eventType === 'StopFailure') {
    save('host_failure', { error: payload.error ?? 'unknown', details: payload.error_details ?? null });
    limitations.push('Host/API failure is not attributed to a skill.');
  } else {
    let message = payload.last_assistant_message;
    if (typeof message !== 'string') {
      try { message = lastAssistant(payload.transcript_path); } catch { limitations.push('Host transcript unavailable.'); }
    }
    if (typeof message === 'string') save('assistant_message', message);
    else limitations.push('Final assistant message not available.');
  }
  // Native payload identity is stable across retries. Capture time is not an invented execution time.
  const identity = { eventType, session: source.session_id, turn: source.turn_id, tool: payload.tool_use_id ?? null,
    prompt: eventType === 'UserPromptSubmit' ? digest(String(payload.prompt ?? '')) : null,
    final: eventType === 'Stop' ? artifacts.map(item => item.digest) : null, start: payload.source ?? null,
    collection_failure: collectionFailure?.reason ?? null };
  if (eventType === 'SessionStart') identity.configuration = { files: components.map(item => item.revision), commit: context.commit, branch: context.branch, plugin: data.plugin_version };
  if (!source.turn_id && !payload.tool_use_id) {
    identity.observation = randomUUID();
    limitations.push('Native occurrence ID unavailable; repeated deliveries may be recorded separately.');
  }
  const event = { schema: 'agent-results.event.v1', source, event_id: digest(JSON.stringify(identity)), event_type: eventType,
    occurred_at: typeof payload.timestamp === 'string' ? payload.timestamp : 'unknown', components, artifacts, data,
    coverage: { status: 'partial', limitations } };
  const result = store.storeEvent(context.root, event);
  return { enabled: true, root: context.root, ...result };
}

function hook(host, payload, collectionFailure = null) {
  const result = capture(host, payload, collectionFailure);
  if (!result.enabled) return {};
  if (collectionFailure) return { systemMessage: '큰 입력 본문을 생략하고 실행 결과 수집 누락을 기록했습니다. agent-results에서 누락 범위를 확인해 주세요.' };
  if (payload.hook_event_name === 'SessionStart') return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
    `AGENT_RESULTS_ENABLED: ${result.root}\n실행 결과를 로컬에 보존합니다. 스킬·훅·workflow를 실제 적용했다면 agent-results 전역 스킬의 record/declare로 출처·버전과 결과 근거를 연결하세요. 파일 열람만으로 적용/결함을 단정하지 않습니다. 개선 필요가 실제 근거로 확인되면 권고를 기록하고 사용자에게 알리세요. 사용자의 개선 지시 전에는 후보 실행·수정을 시작하지 않습니다.` } };
  if (payload.hook_event_name !== 'Stop') return {};
  const pending = store.listRecommendations(result.root).filter(item => !item.notified && ['noticed', 'reviewed'].includes(item.status));
  if (!pending.length) return {};
  // No block/continuation: recording cannot restart or prevent completion of the user's task.
  const ids = pending.map(item => item.id);
  store.markNotified(result.root, ids);
  const summary = pending.slice(0, 3).map(item => `${item.id}: ${JSON.stringify(item.target.id)} — ${JSON.stringify(item.reason.slice(0, 180))} (근거 ${item.evidence.length}건)`).join('\n');
  return { systemMessage: `개선 검토 권고 ${pending.length}건\n${summary}\nagent-results로 원문 근거를 확인한 뒤 개선할 항목을 지시해 주세요. 자동 수정은 수행하지 않았습니다.` };
}
module.exports = { capture, hook, lastAssistant };
