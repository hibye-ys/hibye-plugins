#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const runtime = require('../scripts/project-context.cjs')
let payload
try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { payload = null }
if (!payload || typeof payload !== 'object') {
  process.stdout.write(`${JSON.stringify({ injectSteps: [{ ephemeralMessage: 'PROJECT_CONTEXT_FAILED: invalid hook input; rerun project-context doctor.' }] })}\n`)
} else {
  const repoRoot = runtime.inputProject(payload, process.env)
  const sid = payload.conversationId || payload.session_id || payload.sessionId || payload.sessionID
  const source = payload.source || payload.event || 'startup'
  const key = createHash('sha256').update(`${path.resolve(repoRoot)}\0${sid || ''}`).digest('hex')
  const flag = path.join(os.tmpdir(), `project-context-antigravity-${key}.flag`)
  const repeat = sid && Number(payload.invocationNum || 1) > 1 && fs.existsSync(flag) && source === 'startup'
  if (repeat) process.stdout.write('{}\n')
  else {
    let output = ''
    runtime.runSessionStartContextCli({ repoRoot, host: 'antigravity', event: source, argv: ['session-start'], input: payload, writeStdout: value => { output += value } })
    const context = JSON.parse(output).hookSpecificOutput.additionalContext
    // A failed initialization must be retried; never mark failure as initialized.
    if (sid && !context.includes('PROJECT_CONTEXT_FAILED')) try { fs.writeFileSync(flag, '1', { mode: 0o600 }) } catch {}
    process.stdout.write(`${JSON.stringify(context ? { injectSteps: [{ ephemeralMessage: context }] } : {})}\n`)
  }
}
