'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`AGENT_RESULTS: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return fail('record must contain JSON values only');
}

function plain(value) { return JSON.parse(canonical(value)); }

function secureDirectory(directory, privateMode = true) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = fs.lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('storage directory must not contain links');
  }
  if (privateMode) {
    const info = fs.statSync(absolute);
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) fail('storage must be owned by current user');
    fs.chmodSync(absolute, 0o700);
  }
  return absolute;
}

function rootPath(root) {
  if (!text(root) || !path.isAbsolute(root)) fail('storage root must be absolute');
  return secureDirectory(root);
}

function directory(root, ...segments) {
  let result = rootPath(root);
  for (const segment of segments) {
    if (!text(segment) || /[\\/]/.test(segment) || segment === '.' || segment === '..') fail('unsafe storage segment');
    result = secureDirectory(path.join(result, segment));
  }
  return result;
}

function readBytes(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) fail('storage entry must be a regular file');
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) fail('storage entry owner mismatch');
  if (info.mode & 0o077) fail('storage entry is not private');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return fs.readFileSync(fd); } finally { fs.closeSync(fd); }
}

// A fully written temporary inode is published atomically. Readers never see
// partial JSON, and competing writers do not need a crash-sensitive lock.
function publish(file, bytes) {
  const temp = path.join(path.dirname(file), `.tmp-${process.pid}-${crypto.randomUUID()}`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  let created = false;
  try {
    try { fs.linkSync(temp, file); created = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { fs.unlinkSync(temp); }
  if (!readBytes(file).equals(bytes)) fail('immutable record conflict');
  const parent = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  return created;
}

function readJson(file) {
  try { return JSON.parse(readBytes(file).toString('utf8')); } catch (error) {
    if (error.code === 'ENOENT') throw error;
    fail(`invalid stored record: ${error.message}`);
  }
}

function ensureHex(value, label) { if (!hex(value)) fail(`invalid ${label}`); return value; }

function putArtifact(root, bytes) {
  if (typeof bytes === 'string') bytes = Buffer.from(bytes, 'utf8');
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) fail('artifact must be bytes or text');
  const body = Buffer.from(bytes);
  const digest = sha(body);
  publish(path.join(directory(root, 'blobs'), digest), body);
  return { digest, size: body.length };
}

function readArtifact(root, digest) {
  ensureHex(digest, 'artifact digest');
  const body = readBytes(path.join(directory(root, 'blobs'), digest));
  if (sha(body) !== digest) fail('artifact integrity mismatch');
  return body;
}

function validateEvent(event) {
  if (!object(event) || event.schema !== 'agent-results.event.v1') fail('unsupported event schema');
  const source = event.source;
  if (!object(source) || !['coding_host', 'service_runtime'].includes(source.kind) || !text(source.host) ||
      !text(source.session_id) || !(source.project === null || text(source.project)) ||
      !(source.turn_id === null || text(source.turn_id))) fail('invalid execution source');
  if (!text(event.event_id) || !text(event.event_type) || !text(event.occurred_at) ||
      !(event.occurred_at === 'unknown' || Number.isFinite(Date.parse(event.occurred_at)))) fail('invalid event identity or time');
  if (!Array.isArray(event.components) || !Array.isArray(event.artifacts)) fail('components and artifacts must be arrays');
  for (const component of event.components) {
    if (!object(component) || !text(component.kind) || !text(component.id) || !text(component.source) ||
        !(component.revision === null || text(component.revision)) ||
        !['read', 'declared', 'evidence_linked', 'unknown'].includes(component.usage)) fail('invalid component');
  }
  for (const artifact of event.artifacts) {
    if (!object(artifact) || !text(artifact.kind) || !hex(artifact.digest) ||
        (artifact.locator !== undefined && !text(artifact.locator))) fail('invalid artifact reference');
  }
  const coverage = event.coverage;
  if (!object(coverage) || !['partial', 'complete', 'missing'].includes(coverage.status) ||
      !Array.isArray(coverage.limitations) || !coverage.limitations.every(text)) fail('invalid collection coverage');
  if (!Object.hasOwn(event, 'data')) fail('event data is required');
  canonical(event);
}

function sourceIdentity(source) {
  return { kind: source.kind, host: source.host, project: source.project, session_id: source.session_id };
}

function runKey(source) { return sha(canonical(sourceIdentity(source))); }

function storeEvent(root, input) {
  const event = plain(input);
  validateEvent(event);
  for (const ref of event.artifacts) readArtifact(root, ref.digest);
  const run_key = runKey(event.source);
  const event_key = sha(event.event_id);
  const body = canonical({ digest: sha(canonical(event)), event });
  const created = publish(path.join(directory(root, 'runs', run_key), `${event_key}.json`), Buffer.from(body));
  return { run_key, event_key, duplicate: !created, event };
}

function readRun(root, runKey) {
  ensureHex(runKey, 'run key');
  const runDirectory = directory(root, 'runs', runKey);
  const events = [];
  for (const name of fs.readdirSync(runDirectory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
    const entry = readJson(path.join(runDirectory, name));
    validateEvent(entry.event);
    if (entry.digest !== sha(canonical(entry.event)) || sha(canonical(sourceIdentity(entry.event.source))) !== runKey ||
        `${sha(entry.event.event_id)}.json` !== name) fail('event integrity mismatch');
    for (const artifact of entry.event.artifacts) readArtifact(root, artifact.digest);
    events.push({ ...entry.event, event_key: name.slice(0, -5) });
  }
  events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.event_key.localeCompare(b.event_key));
  return { run_key: runKey, events };
}

function listRuns(root) {
  const runs = directory(root, 'runs');
  return fs.readdirSync(runs).filter(hex).sort().map(run_key => {
    const run = readRun(root, run_key);
    return { run_key, source: run.events[0] ? sourceIdentity(run.events[0].source) : null,
      event_count: run.events.length, latest_at: run.events.at(-1)?.occurred_at ?? null };
  }).filter(run => run.event_count > 0);
}

function validateEvidence(root, runKey, evidence, target) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail('recommendation needs stored evidence');
  const run = readRun(root, ensureHex(runKey, 'run key'));
  return evidence.map(ref => {
    if (!object(ref) || !hex(ref.event_key) || !hex(ref.artifact_digest)) fail('invalid recommendation evidence');
    const event = run.events.find(item => item.event_key === ref.event_key);
    if (!event || !event.artifacts.some(item => item.digest === ref.artifact_digest)) fail('evidence is not linked to event');
    if (object(event.data) && (event.data.attribution === 'inferred' || event.data.relation === 'inferred')) {
      fail('inferred attribution cannot establish an improvement target');
    }
    readArtifact(root, ref.artifact_digest);
    if (target && !event.components.some(item => item.kind === target.kind && item.id === target.id &&
        item.source === target.source && item.revision === target.revision && item.usage === 'evidence_linked')) {
      fail('target needs observed application evidence');
    }
    return { run_key: runKey, event_key: ref.event_key, artifact_digest: ref.artifact_digest };
  });
}

function recommendationDirectory(root, id) {
  return directory(root, 'recommendations', ensureHex(id, 'recommendation id'));
}

function readRecommendation(root, id) {
  const dir = recommendationDirectory(root, id);
  const initial = readJson(path.join(dir, 'initial.json'));
  if (initial.digest !== sha(canonical(initial.record)) || initial.record.id !== id ||
      sha(canonical({ target: initial.record.target, reason: initial.record.reason, signal: initial.record.signal })) !== id) {
    fail('recommendation integrity mismatch');
  }
  let digest = initial.digest;
  let record = plain(initial.record);
  let sequence = 0;
  const names = fs.readdirSync(dir).filter(name => /^\d{8}\.json$/.test(name)).sort();
  for (const name of names) {
    sequence++;
    if (name !== `${String(sequence).padStart(8, '0')}.json`) fail('recommendation history gap');
    const entry = readJson(path.join(dir, name));
    if (entry.previous_digest !== digest || entry.digest !== sha(canonical({ previous_digest: digest, change: entry.change }))) {
      fail('recommendation history integrity mismatch');
    }
    if (entry.change.evidence) {
      const refs = new Map([...record.evidence, ...entry.change.evidence].map(item => [canonical(item), item]));
      record.evidence = [...refs.values()];
    }
    if (entry.change.status) record.status = entry.change.status;
    if (entry.change.notified !== undefined) record.notified = entry.change.notified;
    record.history.push(entry.change);
    digest = entry.digest;
  }
  for (const ref of record.evidence) validateEvidence(root, ref.run_key, [ref], record.target);
  return { record, sequence, digest };
}

function appendChange(root, id, current, change) {
  const data = { previous_digest: current.digest, change };
  const body = Buffer.from(canonical({ ...data, digest: sha(canonical(data)) }));
  const file = path.join(recommendationDirectory(root, id), `${String(current.sequence + 1).padStart(8, '0')}.json`);
  if (!publish(file, body)) fail('concurrent recommendation update; read current state before retry');
  return readRecommendation(root, id).record;
}

function recommend(root, input) {
  const { target, reason, signal, confidence } = plain(input);
  if (!object(target) || !text(target.kind) || !text(target.id) || !text(target.source) ||
      !(target.revision === null || text(target.revision)) || !text(reason) ||
      !['explicit_correction', 'required_check_failed', 'observed_omission'].includes(signal) ||
      !['high', 'medium', 'low'].includes(confidence)) fail('invalid improvement recommendation');
  const evidence = validateEvidence(root, input.run_key, input.evidence, target);
  const id = sha(canonical({ target, reason, signal }));
  const record = { id, run_key: input.run_key, target, reason, signal, confidence,
    evidence, status: 'noticed', notified: false, history: [] };
  const envelope = { digest: sha(canonical(record)), record };
  const file = path.join(recommendationDirectory(root, id), 'initial.json');
  if (!fs.existsSync(file)) {
    try { publish(file, Buffer.from(canonical(envelope))); } catch (error) {
      if (!error.message.includes('immutable record conflict')) throw error;
      // Another run can report the same issue while its initial record wins.
    }
  }
  const current = readRecommendation(root, id);
  const known = new Set(current.record.evidence.map(canonical));
  const added = evidence.filter(ref => !known.has(canonical(ref)));
  if (!added.length) return current.record;
  const change = { evidence: added };
  if (['noticed', 'reviewed'].includes(current.record.status)) change.notified = false;
  return appendChange(root, id, current, change);
}

function listRecommendations(root) {
  return fs.readdirSync(directory(root, 'recommendations')).filter(hex).sort()
    .filter(id => fs.existsSync(path.join(recommendationDirectory(root, id), 'initial.json')))
    .map(id => readRecommendation(root, id).record);
}

const ALLOWED = Object.freeze({
  noticed: ['reviewed', 'deferred', 'dismissed', 'requested'],
  reviewed: ['deferred', 'dismissed', 'requested'],
  deferred: ['reviewed', 'dismissed', 'requested'],
  dismissed: ['reviewed', 'requested'],
  requested: ['running', 'deferred', 'dismissed'],
  running: ['resolved', 'failed'],
  resolved: [], failed: ['reviewed', 'requested', 'dismissed'],
});

function transitionRecommendation(root, id, input) {
  const change = plain(input);
  if (!object(change) || Object.keys(change).some(key => !['status', 'instruction_ref', 'result_refs', 'note'].includes(key)) ||
      (change.note !== undefined && !text(change.note)) ||
      (change.instruction_ref !== undefined && !text(change.instruction_ref))) fail('invalid recommendation change');
  const current = readRecommendation(root, id);
  if (!ALLOWED[current.record.status]?.includes(change.status)) fail('invalid recommendation transition');
  if (change.status === 'requested' && !text(change.instruction_ref)) fail('user instruction reference is required');
  if (change.status === 'requested' && current.record.history.some(item => item.status === 'requested' &&
      item.instruction_ref === change.instruction_ref)) fail('a new user instruction reference is required');
  if (change.status === 'resolved' && (!Array.isArray(change.result_refs) || change.result_refs.length === 0)) {
    fail('resolution needs stored result evidence');
  }
  if (change.result_refs !== undefined) {
    if (!Array.isArray(change.result_refs)) fail('invalid result references');
    for (const ref of change.result_refs) {
      if (!object(ref) || !hex(ref.run_key) || !hex(ref.event_key) ||
          !readRun(root, ref.run_key).events.some(event => event.event_key === ref.event_key)) fail('result evidence missing');
    }
  }
  // This records the human instruction's location; it does not authenticate the
  // human, grant permission, invoke a model, or execute a proposed improvement.
  return appendChange(root, id, current, change);
}

function markNotified(root, ids) {
  if (!Array.isArray(ids)) fail('notification ids must be an array');
  return ids.map(id => {
    const current = readRecommendation(root, id);
    return current.record.notified ? current.record : appendChange(root, id, current, { notified: true });
  });
}

module.exports = { runKey, storeEvent, readRun, listRuns, putArtifact, readArtifact,
  recommend, listRecommendations, transitionRecommendation, markNotified };
