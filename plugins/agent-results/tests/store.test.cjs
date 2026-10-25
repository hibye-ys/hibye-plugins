'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const store = require('../scripts/store.cjs');

function fixture(t) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-result-store-')));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  return { root: path.join(temporary, 'records'), temporary };
}

const component = { kind: 'skill', id: 'writing', source: '/skills/writing', revision: 'v1', usage: 'evidence_linked' };
function event(root, overrides = {}) {
  const artifact = store.putArtifact(root, '실제 검토 결과');
  return {
    schema: 'agent-results.event.v1',
    source: { kind: 'coding_host', host: 'codex', project: '/project', session_id: 'session1', turn_id: 'turn1' },
    event_id: 'event1', event_type: 'feedback', occurred_at: '2026-10-25T23:00:00+09:00',
    components: [component], artifacts: [{ kind: 'text', digest: artifact.digest }],
    data: { signal: 'explicit_correction', instruction_ref: 'user-message-5' },
    coverage: { status: 'partial', limitations: ['host capture is partial'] }, ...overrides,
  };
}
function noticed(root) {
  const saved = store.storeEvent(root, event(root));
  const recommendation = store.recommend(root, {
    run_key: saved.run_key, target: { kind: component.kind, id: component.id, source: component.source, revision: component.revision },
    reason: '검증 조건 누락', signal: 'explicit_correction', confidence: 'high',
    evidence: [{ event_key: saved.event_key, artifact_digest: saved.event.artifacts[0].digest }],
  });
  return { saved, recommendation };
}

test('exact bytes survive with private permissions; content deduplicates', t => {
  const { root } = fixture(t);
  const bytes = Buffer.from([0, 1, 2, 255]);
  const first = store.putArtifact(root, bytes);
  assert.deepEqual(store.putArtifact(root, bytes), first);
  assert.deepEqual(store.readArtifact(root, first.digest), bytes);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(root, 'blobs', first.digest)).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(path.join(root, 'blobs')).length, 1);
});

test('duplicate event is idempotent while changed bytes for same source ID conflict', t => {
  const { root } = fixture(t);
  const input = event(root);
  const first = store.storeEvent(root, input);
  assert.equal(first.duplicate, false);
  assert.equal(store.storeEvent(root, { ...input }).duplicate, true);
  assert.throws(() => store.storeEvent(root, { ...input, data: { changed: true } }), /conflict/);
  assert.equal(store.readRun(root, first.run_key).events.length, 1);
});

test('one session contains multiple turns, host/project identities stay separate, unknown time stays unknown', t => {
  const { root } = fixture(t);
  const input = event(root);
  const first = store.storeEvent(root, input);
  const second = store.storeEvent(root, { ...input, event_id: 'event2', source: { ...input.source, turn_id: 'turn2' }, occurred_at: 'unknown' });
  assert.equal(first.run_key, second.run_key);
  assert.equal(store.runKey(input.source), first.run_key);
  const elsewhere = store.storeEvent(root, { ...input, source: { ...input.source, project: '/other' } });
  assert.notEqual(elsewhere.run_key, first.run_key);
  assert.equal(store.readRun(root, first.run_key).events[1].occurred_at, 'unknown');
  assert.equal(store.listRuns(root).length, 2);
});

test('new component kinds remain first-class without changes to the store', t => {
  const { root } = fixture(t);
  const input = event(root, { components: [{ ...component, kind: 'custom_workflow' }] });
  const saved = store.storeEvent(root, input);
  assert.equal(store.readRun(root, saved.run_key).events[0].components[0].kind, 'custom_workflow');
  assert.equal(saved.event.coverage.status, 'partial');
});

test('missing artifacts, non-JSON values, malformed schemas and unsafe identifiers are rejected', t => {
  const { root } = fixture(t);
  const input = event(root);
  assert.throws(() => store.storeEvent(root, { ...input, artifacts: [{ kind: 'text', digest: 'a'.repeat(64) }] }), /ENOENT/);
  assert.throws(() => store.storeEvent(root, { ...input, data: { absent: undefined } }), /JSON/);
  assert.throws(() => store.storeEvent(root, { ...input, schema: 'future' }), /schema/);
  assert.throws(() => store.readRun(root, '../outside'), /run key/);
  assert.throws(() => store.readArtifact(root, '../outside'), /digest/);
});

test('root/ancestor/blob symlinks never redirect reads or writes', t => {
  const { root, temporary } = fixture(t);
  const outside = path.join(temporary, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, root);
  assert.throws(() => store.putArtifact(root, 'sensitive'), /links/);
  fs.unlinkSync(root);
  const first = store.putArtifact(root, 'actual');
  const file = path.join(root, 'blobs', first.digest);
  fs.unlinkSync(file);
  fs.writeFileSync(path.join(outside, first.digest), 'actual', { mode: 0o600 });
  fs.symlinkSync(path.join(outside, first.digest), file);
  assert.throws(() => store.readArtifact(root, first.digest), /regular file/);
  assert.deepEqual(fs.readdirSync(outside), [first.digest]);
});

test('artifact corruption and relaxed file permissions are visible failures', t => {
  const { root } = fixture(t);
  const first = store.putArtifact(root, 'actual');
  const file = path.join(root, 'blobs', first.digest);
  fs.writeFileSync(file, 'changed');
  assert.throws(() => store.readArtifact(root, first.digest), /integrity/);
  fs.chmodSync(file, 0o644);
  assert.throws(() => store.readArtifact(root, first.digest), /private/);
});

test('event corruption is detected even when JSON remains syntactically valid', t => {
  const { root } = fixture(t);
  const saved = store.storeEvent(root, event(root));
  const file = path.join(root, 'runs', saved.run_key, `${saved.event_key}.json`);
  const entry = JSON.parse(fs.readFileSync(file));
  entry.event.data.changed = true;
  fs.writeFileSync(file, JSON.stringify(entry));
  assert.throws(() => store.readRun(root, saved.run_key), /integrity/);
});

test('caller metadata cannot shadow the stored event key or alter recommendation fields through status change', t => {
  const { root } = fixture(t);
  const input = event(root, { event_id: 'shadow-key', event_key: 'caller-provided-value' });
  const saved = store.storeEvent(root, input);
  assert.equal(store.readRun(root, saved.run_key).events[0].event_key, saved.event_key);
  const { recommendation } = noticed(root);
  assert.throws(() => store.transitionRecommendation(root, recommendation.id,
    { status: 'requested', instruction_ref: 'user:1', evidence: [] }), /invalid recommendation change/);
});

test('recommendations need real linked artifacts and observed component application', t => {
  const { root } = fixture(t);
  const { saved, recommendation } = noticed(root);
  assert.equal(recommendation.status, 'noticed');
  const base = { ...recommendation, run_key: saved.run_key, evidence: [{ event_key: saved.event_key, artifact_digest: saved.event.artifacts[0].digest }] };
  assert.throws(() => store.recommend(root, { ...base, evidence: [] }), /stored evidence/);
  assert.throws(() => store.recommend(root, { ...base, target: { ...base.target, revision: 'v2' } }), /observed application/);
  assert.throws(() => store.recommend(root, { ...base, signal: 'inferred' }), /invalid improvement/);
  const readOnly = store.storeEvent(root, event(root, { event_id: 'read-only', components: [{ ...component, usage: 'read' }] }));
  assert.throws(() => store.recommend(root, { ...base, evidence: [{ event_key: readOnly.event_key, artifact_digest: saved.event.artifacts[0].digest }] }), /observed application/);
  const inferred = store.storeEvent(root, event(root, { event_id: 'inferred', data: { attribution: 'inferred' } }));
  assert.throws(() => store.recommend(root, { ...base, evidence: [{ event_key: inferred.event_key, artifact_digest: saved.event.artifacts[0].digest }] }), /inferred attribution/);
});

test('same issue/version deduplicates across runs while retaining both evidence origins', t => {
  const { root } = fixture(t);
  const { saved, recommendation } = noticed(root);
  store.markNotified(root, [recommendation.id]);
  const input = event(root);
  const other = store.storeEvent(root, { ...input, source: { ...input.source, session_id: 'session2' } });
  const repeated = store.recommend(root, { ...recommendation, run_key: other.run_key,
    evidence: [{ event_key: other.event_key, artifact_digest: other.event.artifacts[0].digest }] });
  assert.equal(repeated.id, recommendation.id);
  assert.equal(repeated.evidence.length, 2);
  assert.deepEqual(new Set(repeated.evidence.map(ref => ref.run_key)), new Set([saved.run_key, other.run_key]));
  assert.equal(repeated.notified, false);
  assert.equal(store.listRecommendations(root).length, 1);
});

test('only new evidence reopens notification for noticed/reviewed; deferred/dismissed/resolved stay quiet', t => {
  const { root } = fixture(t);
  for (const status of ['noticed', 'reviewed', 'deferred', 'dismissed', 'resolved']) {
    const caseRoot = path.join(root, status);
    const { saved, recommendation } = noticed(caseRoot);
    if (status === 'resolved') {
      store.transitionRecommendation(caseRoot, recommendation.id, { status: 'requested', instruction_ref: 'user:resolve' });
      store.transitionRecommendation(caseRoot, recommendation.id, { status: 'running' });
      store.transitionRecommendation(caseRoot, recommendation.id, { status: 'resolved',
        result_refs: [{ run_key: saved.run_key, event_key: saved.event_key }] });
    } else if (status !== 'noticed') {
      store.transitionRecommendation(caseRoot, recommendation.id, { status });
    }
    store.markNotified(caseRoot, [recommendation.id]);
    const repeated = { ...recommendation, run_key: saved.run_key,
      evidence: [{ event_key: saved.event_key, artifact_digest: saved.event.artifacts[0].digest }] };
    assert.equal(store.recommend(caseRoot, repeated).notified, true, `${status}: duplicate stays quiet`);
    const next = store.storeEvent(caseRoot, event(caseRoot, { event_id: 'new-observation' }));
    const updated = store.recommend(caseRoot, { ...repeated,
      evidence: [{ event_key: next.event_key, artifact_digest: next.event.artifacts[0].digest }] });
    assert.equal(updated.notified, !['noticed', 'reviewed'].includes(status), `${status}: notification policy`);
    assert.equal(updated.status, status, `${status}: new evidence never changes review disposition`);
    assert.equal(updated.evidence.length, 2);
  }
});

test('user instruction is required before requested/running; status changes execute nothing', t => {
  const { root } = fixture(t);
  const { recommendation } = noticed(root);
  assert.throws(() => store.transitionRecommendation(root, recommendation.id, { status: 'running' }), /transition/);
  assert.throws(() => store.transitionRecommendation(root, recommendation.id, { status: 'requested' }), /instruction/);
  const requested = store.transitionRecommendation(root, recommendation.id, { status: 'requested', instruction_ref: 'user:message-6' });
  assert.equal(requested.status, 'requested');
  assert.equal(store.transitionRecommendation(root, recommendation.id, { status: 'running' }).status, 'running');
  assert.deepEqual(fs.readdirSync(root).sort(), ['blobs', 'recommendations', 'runs']);
});

test('deferred/dismissed recommendations cannot run, and new requests need a fresh instruction', t => {
  const { root } = fixture(t);
  const { recommendation } = noticed(root);
  store.transitionRecommendation(root, recommendation.id, { status: 'requested', instruction_ref: 'user:1' });
  store.transitionRecommendation(root, recommendation.id, { status: 'deferred' });
  assert.throws(() => store.transitionRecommendation(root, recommendation.id, { status: 'running' }), /transition/);
  assert.throws(() => store.transitionRecommendation(root, recommendation.id, { status: 'requested', instruction_ref: 'user:1' }), /new user/);
  store.transitionRecommendation(root, recommendation.id, { status: 'dismissed' });
  assert.throws(() => store.transitionRecommendation(root, recommendation.id, { status: 'requested' }), /instruction/);
  assert.equal(store.transitionRecommendation(root, recommendation.id, { status: 'requested', instruction_ref: 'user:2' }).status, 'requested');
});

test('resolved requires existing result events; append-only status history preserves instruction provenance', t => {
  const { root } = fixture(t);
  const { saved, recommendation } = noticed(root);
  store.transitionRecommendation(root, recommendation.id, { status: 'requested', instruction_ref: 'user:1' });
  store.transitionRecommendation(root, recommendation.id, { status: 'running' });
  assert.throws(() => store.transitionRecommendation(root, recommendation.id, { status: 'resolved' }), /stored result/);
  assert.throws(() => store.transitionRecommendation(root, recommendation.id, { status: 'resolved', result_refs: [{ run_key: saved.run_key, event_key: 'a'.repeat(64) }] }), /missing/);
  const result = store.storeEvent(root, event(root, { event_id: 'result', event_type: 'validation_result', data: { passed: true } }));
  const resolved = store.transitionRecommendation(root, recommendation.id, { status: 'resolved', result_refs: [{ run_key: result.run_key, event_key: result.event_key }] });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.history[0].instruction_ref, 'user:1');
  assert.equal(resolved.history.length, 3);
});

test('multiple real processes publish exact complete events without locks or duplicate copies', async t => {
  const { root } = fixture(t);
  const input = event(root);
  const modulePath = require.resolve('../scripts/store.cjs');
  const source = `const s=require(process.argv[1]); s.storeEvent(process.argv[2],JSON.parse(process.argv[3]));`;
  await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', source, modulePath, root, JSON.stringify(input)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
  })));
  assert.equal(store.readRun(root, store.runKey(input.source)).events.length, 1);
  assert.equal(fs.readdirSync(path.join(root, 'runs', store.runKey(input.source))).length, 1);
});
