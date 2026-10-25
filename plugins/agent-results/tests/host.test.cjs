'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const store = require('../scripts/store.cjs');
const plugin = fs.realpathSync(path.join(__dirname, '..'));

function fixture(t, git = true) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-host-flow-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home');
  const project = path.join(temp, 'project');
  fs.mkdirSync(home); fs.mkdirSync(project);
  const env = { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    PLUGIN_ROOT: plugin, CLAUDE_PLUGIN_ROOT: plugin };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  const gitRun = (args, cwd = project) => execFileSync('git', ['-C', cwd, ...args],
    { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git) {
    gitRun(['init', '-q']);
    gitRun(['config', 'core.hooksPath', '/dev/null']);
    gitRun(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
  }
  const cliResult = (args, cwd = project) => spawnSync(process.execPath, [path.join(plugin, 'scripts/cli.cjs'), ...args],
    { cwd, env, encoding: 'utf8' });
  const cli = (args, cwd) => {
    const result = cliResult(args, cwd);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const hookResult = (host, event, cwd = project) => spawnSync(process.execPath,
    [path.join(plugin, 'scripts/hook.cjs'), ...(host ? [host] : [])],
    { cwd, env, encoding: 'utf8', input: JSON.stringify({ cwd, session_id: 'native-session',
      turn_id: 'turn-1', ...event }) });
  const hook = (host, event, cwd) => {
    const result = hookResult(host, event, cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '', result.stderr);
    return JSON.parse(result.stdout);
  };
  const json = (name, value) => {
    const file = path.join(temp, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  return { temp, home, project, env, gitRun, cliResult, cli, hookResult, hook, json };
}

function allEvents(f, cwd = f.project) {
  return f.cli(['list'], cwd).flatMap(run => f.cli(['show', '--run', run.run_key], cwd).events);
}

test('project opt-in excludes private records before collecting native Codex/Claude results; retry is idempotent', t => {
  const f = fixture(t);
  assert.deepEqual(f.hook('codex', { hook_event_name: 'UserPromptSubmit', prompt: 'before opt-in' }), {});
  const initialized = f.cli(['init', '--project', f.project]);
  assert.equal(spawnSync('git', ['-C', f.project, 'check-ignore', '.agent-results/config.json'], { env: f.env }).status, 0,
    'init must exclude private result data before enabling capture');
  const event = { hook_event_name: 'PostToolUse', tool_name: 'read_file', tool_use_id: 'native-tool-1',
    tool_input: { path: 'report.txt' }, tool_response: { result: '실제 도구 결과' } };
  f.hook(null, event); f.hook(null, event);
  f.hook('codex', { hook_event_name: 'Stop', last_assistant_message: '코덱스 최종 결과' });
  f.hook('claude', { hook_event_name: 'Stop', last_assistant_message: '클로드 최종 결과' });
  const events = allEvents(f);
  assert.equal(events.filter(item => item.event_type === 'PostToolUse').length, 1);
  assert.deepEqual(new Set(events.map(item => item.source.host)), new Set(['codex', 'claude']));
  const bodies = events.flatMap(item => item.artifacts.map(ref => store.readArtifact(initialized.root, ref.digest).toString('utf8')));
  assert.ok(bodies.some(value => value.includes('실제 도구 결과')));
  assert.ok(bodies.includes('코덱스 최종 결과'));
  assert.ok(bodies.includes('클로드 최종 결과'));
});

test('new skill versions and custom hook kind connect to real outcomes; user instruction gates manual improvement', t => {
  const f = fixture(t);
  const initialized = f.cli(['init', '--project', f.project]);
  const skill = path.join(f.project, '.agents/skills/future-skill/SKILL.md');
  fs.mkdirSync(path.dirname(skill), { recursive: true }); fs.writeFileSync(skill, '# version one\n');
  f.hook('codex', { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'skill-read',
    tool_input: { file_path: skill }, tool_response: { text: '# version one\n' } });
  const runKey = f.cli(['list'])[0].run_key;
  const first = f.cli(['show', '--run', runKey]);
  assert.equal(first.events[0].components[0].usage, 'read');
  const outcome = path.join(f.temp, 'actual-outcome.txt'); fs.writeFileSync(outcome, '관찰된 실제 결과\n');
  const application = f.cli(['declare', '--run', runKey, '--file', skill, '--usage', 'evidence_linked', '--artifact', outcome, '--note', '실제 산출물 조건 확인']);
  const item = application.event.components[0];
  const target = { kind: item.kind, id: item.id, source: item.source, revision: item.revision };
  const recommendationFile = f.json('recommendation.json', { run_key: runKey, target,
    reason: '사용자가 실제 결과의 누락을 교정함', signal: 'explicit_correction', confidence: 'high',
    evidence: [{ event_key: application.event_key, artifact_digest: application.event.artifacts.find(ref => ref.kind === 'outcome').digest }] });
  const recommendation = f.cli(['recommend', '--file', recommendationFile]);
  assert.equal(f.cliResult(['decide', '--id', recommendation.id, '--status', 'running']).status, 1);
  assert.equal(f.cliResult(['decide', '--id', recommendation.id, '--status', 'requested']).status, 1);
  assert.equal(fs.readFileSync(skill, 'utf8'), '# version one\n');
  const notice = f.hook('codex', { hook_event_name: 'Stop', last_assistant_message: '결과 저장 완료' });
  assert.match(notice.systemMessage, new RegExp(recommendation.id));
  assert.equal(notice.decision, undefined);
  assert.deepEqual(f.hook('codex', { hook_event_name: 'Stop', last_assistant_message: '결과 저장 완료' }), {});
  f.cli(['decide', '--id', recommendation.id, '--status', 'requested', '--instruction-ref', 'user:fixture-message-2']);
  f.cli(['decide', '--id', recommendation.id, '--status', 'running']);
  fs.writeFileSync(skill, '# version two\n');
  const second = f.cli(['declare', '--run', runKey, '--file', skill, '--usage', 'declared']);
  assert.notEqual(second.event.components[0].revision, item.revision);
  assert.equal(store.readArtifact(initialized.root, application.event.artifacts[0].digest).toString('utf8'), '# version one\n');
  const hookFile = path.join(f.temp, 'new-hook.cjs'); fs.writeFileSync(hookFile, '/* future hook */\n');
  const custom = f.cli(['declare', '--run', runKey, '--file', hookFile, '--kind', 'custom-hook', '--usage', 'declared']);
  assert.equal(custom.event.components[0].kind, 'custom-hook');
  const resultFile = f.json('validation.json', { schema: 'agent-results.event.v1', source: first.events[0].source,
    event_id: 'validation-after-user-request', event_type: 'validation_result', occurred_at: 'unknown',
    components: second.event.components, artifacts: [{ kind: 'validation', file: outcome }],
    data: { result: 'fixture actual validation passed' }, coverage: { status: 'partial', limitations: ['Operational effect not measured'] } });
  const result = f.cli(['record', '--file', resultFile]);
  const refs = f.json('result-refs.json', [{ run_key: result.run_key, event_key: result.event_key }]);
  const resolved = f.cli(['decide', '--id', recommendation.id, '--status', 'resolved', '--file', refs]);
  assert.equal(resolved.status, 'resolved');
  assert.equal(f.cli(['pending']).length, 0);
});

test('relative sensitive source bodies are omitted rather than relying on secret-name redaction', t => {
  const f = fixture(t);
  const initialized = f.cli(['init', '--project', f.project]);
  f.hook('codex', { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'read-env',
    tool_input: { file_path: '.env' }, tool_response: 'DATABASE_URL=postgres://local:fixture-password@localhost/db' });
  const event = allEvents(f)[0];
  assert.ok(event.coverage.limitations.some(value => /Sensitive-source/i.test(value)));
  assert.equal(event.artifacts.length, 0);
  assert.ok(!fs.existsSync(path.join(initialized.root, 'blobs')) || fs.readdirSync(path.join(initialized.root, 'blobs')).length === 0);
});

test('non-Git project and projectless user records remain separate; initialized user does not enable unrelated Git projects', t => {
  const f = fixture(t, false);
  const project = f.cli(['init', '--project', f.project]);
  const nested = path.join(f.project, 'nested'); fs.mkdirSync(nested);
  f.hook('claude', { hook_event_name: 'UserPromptSubmit', prompt: '비Git 프로젝트 요청', turn_id: undefined, prompt_id: 'native-prompt-1' }, nested);
  const projectEvent = allEvents(f)[0];
  assert.equal(projectEvent.source.project, project.project);
  assert.equal(projectEvent.source.turn_id, 'native-prompt-1');
  const global = f.cli(['init', '--user'], f.home);
  f.hook('codex', { hook_event_name: 'Stop', last_assistant_message: '프로젝트 없는 결과' }, f.home);
  const globalEvents = allEvents(f, f.home);
  assert.equal(globalEvents.length, 1);
  assert.equal(globalEvents[0].source.project, null);
  assert.notEqual(global.root, project.root);
  const unrelated = path.join(f.temp, 'unrelated'); fs.mkdirSync(unrelated); f.gitRun(['init', '-q'], unrelated);
  assert.deepEqual(f.hook('codex', { hook_event_name: 'UserPromptSubmit', prompt: 'uninitialized git project' }, unrelated), {});
  assert.equal(allEvents(f, f.home).length, 1, 'new Git project must not be mistaken for projectless global execution');
});

test('linked worktree results remain queryable after the checkout is removed', t => {
  const f = fixture(t);
  const initialized = f.cli(['init', '--project', f.project]);
  const linked = path.join(f.temp, 'linked'); f.gitRun(['worktree', 'add', '-q', '-b', 'fixture-linked', linked]);
  f.hook('codex', { hook_event_name: 'Stop', last_assistant_message: 'linked checkout outcome' }, linked);
  const event = allEvents(f)[0];
  assert.equal(event.data.checkout, linked);
  assert.equal(event.source.project, initialized.project);
  f.gitRun(['worktree', 'remove', linked]);
  assert.equal(allEvents(f).length, 1);
  assert.equal(store.readArtifact(initialized.root, event.artifacts[0].digest).toString('utf8'), 'linked checkout outcome');
});

test('same-session configuration and checkout changes get new observations rather than immutable conflicts', t => {
  const f = fixture(t);
  f.cli(['init', '--project', f.project]);
  const instructions = path.join(f.project, 'AGENTS.md'); fs.writeFileSync(instructions, 'first instructions');
  const event = { hook_event_name: 'SessionStart', source: 'resume' };
  f.hook('codex', event);
  fs.writeFileSync(instructions, 'second instructions'); f.hook('codex', event);
  f.gitRun(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-q', '--allow-empty', '-m', 'next checkout version']);
  f.hook('codex', event);
  assert.equal(allEvents(f).length, 3);
});

test('missing/current-turn transcript gaps never substitute a previous turn final response', t => {
  const f = fixture(t);
  f.cli(['init', '--project', f.project]);
  const transcript = path.join(f.temp, 'transcript.jsonl');
  fs.writeFileSync(transcript, [
    { type: 'response_item', payload: { role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'previous turn final' }] } },
    { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'new turn request without final yet' }] } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  f.hook('codex', { hook_event_name: 'Stop', turn_id: 'new-turn', transcript_path: transcript });
  const event = allEvents(f)[0];
  assert.equal(event.artifacts.length, 0, 'previous final must not be attributed to a newer turn');
  assert.ok(event.coverage.limitations.some(value => /not available|not.*verified|unsupported/i.test(value)));
});

test('unsupported hook failure is visible without blocking the user or creating continuation', t => {
  const f = fixture(t);
  f.cli(['init', '--project', f.project]);
  const failed = f.hookResult('codex', { hook_event_name: 'UnsupportedEvent' });
  assert.equal(failed.status, 0);
  assert.match(failed.stderr, /AGENT_RESULTS_CAPTURE_FAILED/);
  const output = JSON.parse(failed.stdout);
  assert.equal(output.decision, undefined);
  assert.equal(output.continue, undefined);
});

test('missing native occurrence IDs and oversized bodies stay explicitly partial; child agents remain distinct', t => {
  const f = fixture(t);
  f.cli(['init', '--project', f.project]);
  f.hook('codex', { hook_event_name: 'UserPromptSubmit', prompt: 'same prompt', turn_id: undefined });
  f.hook('codex', { hook_event_name: 'UserPromptSubmit', prompt: 'same prompt', turn_id: undefined });
  f.hook('codex', { hook_event_name: 'Stop', last_assistant_message: 'x'.repeat(1_100_000), turn_id: 'large-turn' });
  f.hook('claude', { hook_event_name: 'PostToolUseFailure', turn_id: undefined, prompt_id: 'prompt-failure', agent_id: 'worker-1',
    tool_use_id: 'failed-tool', tool_name: 'Read', tool_input: { file_path: 'missing.txt' }, error: 'fixture tool failure' });
  const events = allEvents(f);
  const prompts = events.filter(event => event.event_type === 'UserPromptSubmit');
  assert.equal(prompts.length, 2);
  assert.ok(prompts.every(event => event.coverage.limitations.some(value => /occurrence ID unavailable/i.test(value))));
  const large = events.find(event => event.event_type === 'Stop');
  assert.equal(large.artifacts.length, 0);
  assert.ok(large.coverage.limitations.some(value => /oversized/.test(value)));
  const child = events.find(event => event.event_type === 'PostToolUseFailure');
  assert.equal(child.source.session_id, 'native-session:agent:worker-1');
  assert.equal(child.data.parent_session_id, 'native-session');
  assert.equal(child.source.turn_id, 'prompt-failure');
});

function servicePage() {
  const id = '9e281ebc-501d-46ed-88ad-dd3fb83b5961';
  return { schema_version: 'agent-result-evidence.v1', source: { service: 'api', project_id: id, session_id: id, run_id: id },
    exported_at: '2026-10-25T14:00:00.000Z', collection_status: 'partial', replay_ready: false,
    coverage: { messages: 'selected_run_only', followup_feedback: 'not_collected', provider_calls: 'separate_export', effect_records: 'dispatch_receipts_only' },
    limits: { max_messages: 20, max_field_bytes: 65536 },
    execution: { owner_user_id: id, run_status: 'completed', status: 'completed', can_cancel_run: false,
      unsettled_operation_ids: [], finality: 'settled', delegated_task: null, main_reply: null,
      recovery: { delivery_kind: null, lease: 'not_required', delivery_status: null, checkpoint_available: null } },
    messages: [{ id, parent_message_id: null, sequence: '1', version: '9007199254740993', role: 'tool', content_kind: 'tool_result',
      content: { tool_call_id: 'fixture' }, content_status: 'stored', tool_result: { full: null }, tool_result_status: 'full',
      dispatch_receipt: null, created_at: '2026-10-25T14:00:00.000Z', updated_at: '2026-10-25T14:00:00.000Z' }], next_cursor: '1' };
}

test('service pages retain exact evidence/partial coverage across pagination and reject contradictory wire', t => {
  const f = fixture(t);
  const initialized = f.cli(['init', '--project', f.project]);
  const page = servicePage();
  const input = f.json('service-page.json', page);
  const first = f.cli(['import-service', '--file', input]);
  assert.equal(first.messages, 1); assert.equal(first.next_cursor, '1');
  assert.equal(f.cli(['import-service', '--file', input]).duplicate, true);
  assert.deepEqual(store.readArtifact(initialized.root, first.event.artifacts[0].digest), fs.readFileSync(input));
  assert.ok(first.event.coverage.limitations.some(value => /More pages remain/.test(value)));
  const second = { ...page, exported_at: '2026-10-25T14:00:01.000Z', messages: [], next_cursor: null };
  const next = f.cli(['import-service', '--file', f.json('service-page-2.json', second)]);
  assert.equal(next.run_key, first.run_key);
  assert.equal(next.event.coverage.status, 'partial'); assert.equal(next.event.data.replay_ready, false);
  const invalidCases = [
    { ...page, execution: {} },
    { ...page, messages: [{ ...page.messages[0], role: 'invented-role' }] },
    { ...page, messages: [{ ...page.messages[0], content_kind: 'text', tool_result_status: 'full' }] },
    { ...page, coverage: { ...page.coverage, provider_calls: 'complete' } },
  ];
  const statuses = invalidCases.map((value, i) => f.cliResult(['import-service', '--file', f.json(`invalid-page-${i}.json`, value)]).status);
  assert.deepEqual(statuses, [1, 1, 1, 1], 'invalid execution, role, kind/result and coverage must be rejected');
});
