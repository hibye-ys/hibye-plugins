'use strict';
const MAX_INPUT_BYTES = 4194304;
const FIELDS = new Set(['cwd', 'session_id', 'turn_id', 'prompt_id', 'agent_id', 'hook_event_name', 'tool_name', 'tool_use_id', 'timestamp']);

// Extract only bounded top-level string identity while draining stdin. Field
// order and nested strings cannot turn a discarded tool body into identity.
function identityScanner() {
  let depth = 0, inString = false, escaped = false, keyExpected = false;
  let pendingKey = null, token = '', role = null, truncated = false;
  const fields = {};
  return { fields, feed(chunk) {
    for (const char of chunk) {
      if (inString) {
        if (role && !truncated) { token += char; if (token.length > 16384) { token = ''; truncated = true; } }
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if (char !== '"') continue;
        inString = false;
        if (role && !truncated) {
          let value; try { value = JSON.parse(token); } catch { value = null; }
          if (role === 'key') { pendingKey = value; keyExpected = false; }
          else if (typeof value === 'string') fields[pendingKey] = value;
        } else if (role === 'key') { pendingKey = null; keyExpected = false; }
        if (role === 'value') pendingKey = null;
        role = null; token = ''; continue;
      }
      if (char === '"') {
        inString = true; escaped = false; truncated = false;
        role = depth === 1 ? (keyExpected ? 'key' : FIELDS.has(pendingKey) ? 'value' : null) : null;
        token = role ? '"' : ''; continue;
      }
      if (char === '{' || char === '[') { depth++; if (depth === 1 && char === '{') keyExpected = true; }
      else if (char === '}' || char === ']') depth--;
      else if (char === ',' && depth === 1) { keyExpected = true; pendingKey = null; }
    }
  } };
}

function readInput(stream) {
  return new Promise((resolve, reject) => {
    const scanner = identityScanner();
    let chunks = [], inputBytes = 0, oversized = false;
    stream.setEncoding('utf8');
    stream.on('error', reject);
    stream.on('data', chunk => {
      inputBytes += Buffer.byteLength(chunk);
      scanner.feed(chunk);
      if (inputBytes > MAX_INPUT_BYTES) { oversized = true; chunks = []; }
      else if (!oversized) chunks.push(chunk);
    });
    stream.on('end', () => resolve({ input: chunks.join(''), metadata: scanner.fields, oversized, inputBytes }));
  });
}
module.exports = { readInput, identityScanner, MAX_INPUT_BYTES };
