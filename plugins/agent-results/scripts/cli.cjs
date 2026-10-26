#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { initialize, resolveContext, component, digest, sensitiveSource } = require('./context.cjs');
const { prepareArtifact } = require('./artifact.cjs');
const store = require('./store.cjs');

function options(args) {
  const result = {};
  const allowed = new Set(['project', 'user', 'file', 'artifact', 'run', 'usage', 'kind', 'host', 'id', 'status', 'instruction-ref', 'note', 'event', 'digest']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !allowed.has(key) || Object.hasOwn(result, key)) throw new Error(`Unknown or repeated option: ${args[i]}`);
    if (key === 'user') result[key] = true;
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing --${key} value`); result[key] = args[++i]; }
  }
  return result;
}
function fileBytes(file) {
  if (typeof file !== 'string') throw new Error('--file is required');
  if (sensitiveSource(file) || sensitiveSource(path.resolve(file))) throw new Error('Sensitive evidence source omitted');
  const fd = fs.openSync(path.resolve(file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 4194304) throw new Error('Input file unavailable or larger than 4MiB');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function contextFor(opts) {
  const context = resolveContext(opts.project || process.cwd());
  if (!context) throw new Error('Capture is not enabled here. Run init --project <path> or init --user.');
  return context;
}
function main(args) {
  const command = args.shift() || 'help';
  const opts = options(args);
  if (command === 'help') return { commands: ['init --project <path> | --user', 'list', 'references', 'show --run <key>',
    'record --file <event.json>', 'declare --run <key> --file <component> --usage declared|evidence_linked [--artifact <outcome>]',
    'import-service --file <page.json>', 'recommend --file <recommendation.json>', 'pending',
    'decide --id <id> --status <status> [--instruction-ref <user-message-ref>]', 'notify', 'artifact --digest <sha256>'],
    boundary: 'Local records only. Recommendations and requested status never execute improvements.' };
  if (command === 'init') return initialize({ cwd: opts.project || process.cwd(), user: !!opts.user });
  if (command === 'references') return require('./references.cjs').listReferences();
  const context = contextFor(opts);
  if (command === 'list') return store.listRuns(context.root);
  if (command === 'show') return store.readRun(context.root, opts.run);
  if (command === 'artifact') return { digest: opts.digest, content: store.readArtifact(context.root, opts.digest).toString('utf8') };
  if (command === 'record') {
    const event = JSON.parse(fileBytes(opts.file));
    const processing = [];
    event.artifacts = (event.artifacts || []).map(item => {
      if (!item.file) return item;
      const prepared = prepareArtifact(fileBytes(item.file));
      const blob = store.putArtifact(context.root, prepared.bytes);
      processing.push({ kind: item.kind, ...prepared.processing });
      return { kind: item.kind, digest: blob.digest, locator: path.resolve(item.file) };
    });
    if (processing.length) event.data = { ...(event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : { original_data: event.data ?? null }), artifact_processing: processing };
    const result = store.storeEvent(context.root, event);
    for (const item of event.components) require('./references.cjs').linkComponent(context, result.run_key, item);
    return result;
  }
  if (command === 'declare') {
    const run = store.readRun(context.root, opts.run);
    if (!run.events.length) throw new Error('Unknown run');
    if (!['declared', 'evidence_linked', 'read'].includes(opts.usage || 'declared')) throw new Error('Unknown usage');
    if (opts.usage === 'evidence_linked' && !opts.artifact) throw new Error('evidence_linked requires an actual outcome artifact');
    const item = component(opts.file, opts.usage || 'declared', opts.kind);
    const prepared = prepareArtifact(fileBytes(opts.file));
    const definition = store.putArtifact(context.root, prepared.bytes);
    const artifacts = [{ kind: 'component_snapshot', digest: definition.digest }];
    const processing = [{ kind: 'component_snapshot', ...prepared.processing }];
    if (opts.artifact) {
      const outcome = prepareArtifact(fileBytes(opts.artifact));
      artifacts.push({ kind: 'outcome', ...store.putArtifact(context.root, outcome.bytes) });
      processing.push({ kind: 'outcome', ...outcome.processing });
    }
    const event = { schema: 'agent-results.event.v1', source: run.events[0].source, event_id: digest(JSON.stringify({ item, artifacts, note: opts.note || '' })),
      event_type: 'component_application', occurred_at: new Date().toISOString(), components: [item], artifacts,
      data: { relation: 'explicit', note: opts.note || 'Agent declaration; verify actual application against linked evidence.', artifact_processing: processing },
      coverage: { status: 'partial', limitations: ['Application declaration is not proof of sole causal responsibility or quality.'] } };
    const existing = run.events.find(previous => previous.event_id === event.event_id);
    if (existing) event.occurred_at = existing.occurred_at;
    const result = store.storeEvent(context.root, event);
    require('./references.cjs').linkComponent(context, result.run_key, item);
    return result;
  }
  if (command === 'import-service') return require('./service.cjs').importServicePage(context.root, fileBytes(opts.file));
  if (command === 'recommend') return store.recommend(context.root, JSON.parse(fileBytes(opts.file)));
  if (command === 'pending') return store.listRecommendations(context.root).filter(item => ['noticed', 'reviewed', 'requested', 'running', 'deferred'].includes(item.status));
  if (command === 'decide') {
    const change = { status: opts.status };
    if (opts['instruction-ref']) change.instruction_ref = opts['instruction-ref'];
    if (opts.note) change.note = opts.note;
    if (opts.file) change.result_refs = JSON.parse(fileBytes(opts.file));
    return store.transitionRecommendation(context.root, opts.id, change);
  }
  if (command === 'notify') {
    const pending = store.listRecommendations(context.root).filter(item => !item.notified && ['noticed', 'reviewed'].includes(item.status));
    store.markNotified(context.root, pending.map(item => item.id));
    return { recommendations: pending, automatic_changes: 0 };
  }
  throw new Error(`Unknown command: ${command}`);
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) { process.stderr.write(`AGENT_RESULTS: ${error.message}\n`); process.exitCode = 1; }
}
module.exports = { main, options, fileBytes };
