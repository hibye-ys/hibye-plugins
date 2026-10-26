'use strict';
const { isUtf8 } = require('node:buffer');
const { redact, digest } = require('./context.cjs');

// Binary originals are never passed through a lossy text decoder. Text may be
// redacted; callers preserve that distinction alongside the resulting blob.
function prepareArtifact(value) {
  const binary = Buffer.isBuffer(value) && (!isUtf8(value) || value.includes(0));
  const original = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const bytes = binary ? original : Buffer.from(typeof value === 'object' && !Buffer.isBuffer(value)
    ? JSON.stringify(redact(value)) : redact(original.toString('utf8')));
  const changed = !bytes.equals(original);
  return { bytes, processing: { format: binary ? 'binary' : typeof value === 'object' && !Buffer.isBuffer(value) ? 'json' : 'utf8',
    representation: changed ? 'redacted' : 'original', ...(changed ? { original_digest: digest(original) } : {}) } };
}
module.exports = { prepareArtifact };
