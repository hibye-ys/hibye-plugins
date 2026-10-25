'use strict';
const store = require('./store.cjs');
const { digest } = require('./context.cjs');
const { validate } = require('./schema.cjs');
const schema = require('../contracts/agent-result-evidence.v1.schema.json');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const sequence = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;

// A versioned boundary; unknown versions are retained by the caller for review,
// never silently parsed as this schema. The service remains the authority for auth.
function importServicePage(root, bytes) {
  const page = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!validate(schema, page)) throw new Error('Service evidence does not match the bundled v1 wire contract');
  const source = page.source;
  if (page.schema_version !== 'agent-result-evidence.v1' || page.replay_ready !== false || page.collection_status !== 'partial' ||
      source?.service !== 'api' || !uuid(source.project_id) || !uuid(source.session_id) || !uuid(source.run_id) ||
      page.limits?.max_messages !== 20 || page.limits?.max_field_bytes !== 65536 || !Array.isArray(page.messages) || page.messages.length > 20 ||
      !page.execution || typeof page.exported_at !== 'string' || !Number.isFinite(Date.parse(page.exported_at)) ||
      !(page.next_cursor === null || sequence(page.next_cursor)) ||
      page.coverage?.messages !== 'selected_run_only' || page.coverage?.followup_feedback !== 'not_collected') {
    throw new Error('Unsupported or invalid service evidence page');
  }
  const ids = new Set();
  let previous = -1n;
  for (const message of page.messages) {
    if (!uuid(message.id) || ids.has(message.id) || !sequence(message.sequence) || !sequence(message.version) || BigInt(message.sequence) <= previous ||
        !['stored', 'oversized'].includes(message.content_status) || !['full', 'preview', 'oversized', 'missing', 'not_applicable'].includes(message.tool_result_status) ||
        (message.content_status === 'oversized' && message.content !== null) ||
        (message.content_kind !== 'tool_result' && message.tool_result_status !== 'not_applicable') ||
        (message.content_kind === 'tool_result' && message.tool_result_status === 'not_applicable') ||
        (['oversized', 'missing', 'not_applicable'].includes(message.tool_result_status) && message.tool_result !== null) ||
        (message.tool_result_status === 'full' && (!message.tool_result || !Object.hasOwn(message.tool_result, 'full'))) ||
        (message.tool_result_status === 'preview' && (!message.tool_result || Object.hasOwn(message.tool_result, 'full')))) {
      throw new Error('Invalid service message availability or identity');
    }
    ids.add(message.id); previous = BigInt(message.sequence);
  }
  const blob = store.putArtifact(root, Buffer.from(bytes));
  const nativeSource = { kind: 'service_runtime', host: source.service, project: source.project_id,
    session_id: source.run_id, turn_id: null };
  const event = { schema: 'agent-results.event.v1', source: nativeSource,
    event_id: `service-page:${digest(Buffer.from(bytes))}`, event_type: 'service_evidence_import', occurred_at: page.exported_at,
    components: [], artifacts: [{ kind: 'service_result_page', digest: blob.digest }],
    data: { native_session_id: source.session_id, run_id: source.run_id, message_ids: [...ids], next_cursor: page.next_cursor,
      followup_feedback: 'not_collected', replay_ready: false },
    coverage: { status: 'partial', limitations: ['Selected run only; follow-up feedback requires an explicit link.',
      'Provider inputs and effect state use separate exports.', ...(page.next_cursor !== null ? ['More pages remain.'] : []),
      ...page.messages.filter(message => ['missing', 'oversized', 'preview'].includes(message.tool_result_status)).map(message => `${message.id}:${message.tool_result_status}`)] } };
  return { ...store.storeEvent(root, event), messages: page.messages.length, next_cursor: page.next_cursor };
}
module.exports = { importServicePage };
