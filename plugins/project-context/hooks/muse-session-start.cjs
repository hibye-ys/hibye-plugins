#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const runtime = require('../scripts/project-context.cjs')
// Source adapter only: actual Muse product acceptance is validated separately.
let output = ''
runtime.runSessionStartContextCli({ host: 'muse', argv: ['session-start'], input: fs.readFileSync(0, 'utf8'), writeStdout: value => { output += value } })
const parsed = JSON.parse(output)
let context = parsed.hookSpecificOutput.additionalContext
const envelope = text => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } })
// Muse's response ceiling includes JSON escaping. Preserve failure marker when over budget.
if (Buffer.byteLength(JSON.stringify(envelope(context))) > 16000) {
  const suffix = '\nPROJECT_CONTEXT_TRUNCATED: read .project-context.json and the referenced indexes lazily; run project-context doctor for diagnostics.'
  while (context && Buffer.byteLength(JSON.stringify(envelope(context + suffix))) > 16000) context = context.slice(0, Math.max(0, context.length - 128))
  context += suffix
}
process.stdout.write(`${JSON.stringify(envelope(context))}\n`)
