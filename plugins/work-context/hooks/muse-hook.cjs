#!/usr/bin/env node
'use strict'
/*
 * work-context — Muse adapter for all three hook events (SessionStart,
 * UserPromptSubmit, PostToolUse). Normalizes the Muse hook payload, then
 * runs the Claude/Codex runtime in-process and fits the envelope under the
 * Muse hook stdout ceiling. Node builtins only. Never exits non-zero.
 */
const fs = require('node:fs')

const EVENT_BY_MODE = Object.freeze({
  'session-start': 'SessionStart',
  turn: 'UserPromptSubmit',
  'post-edit': 'PostToolUse',
})
// Muse hook stdout ceiling is 16384 bytes including JSON escaping.
const MUSE_STDOUT_BUDGET = 16000
const TRUNCATED_SUFFIX = '\nWORK_CONTEXT_TRUNCATED: 계획 폴더의 inject.md · status.md 와 두 인덱스를 직접 연다'

function envelopeLine(eventName, text) {
  return `${JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } })}\n`
}

function fitEnvelope(eventName, text) {
  if (Buffer.byteLength(envelopeLine(eventName, text), 'utf8') <= MUSE_STDOUT_BUDGET) return envelopeLine(eventName, text)
  let cut = text
  while (cut.length > 0 && Buffer.byteLength(envelopeLine(eventName, cut + TRUNCATED_SUFFIX), 'utf8') > MUSE_STDOUT_BUDGET) {
    cut = cut.slice(0, Math.max(0, cut.length - 256))
  }
  return envelopeLine(eventName, cut + TRUNCATED_SUFFIX)
}

function readStdinJson() {
  let raw = ''
  try {
    raw = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8')
  } catch { raw = '' }
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function main() {
  const mode = process.argv[2]
  const eventName = EVENT_BY_MODE[mode] || 'SessionStart'
  try {
    if (!EVENT_BY_MODE[mode]) throw new Error(`unknown mode ${mode}`)
    // A Muse worker launched from a Claude session inherits the parent's
    // project dir; the runtime resolves the checkout from input.cwd only.
    delete process.env.CLAUDE_PROJECT_DIR
    delete process.env.HOOK_PROJECT_DIR
    const input = readStdinJson()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('hook input must be an object')
    const sessionId = input.session_id || input.sessionID || input.sessionId || (input.session && input.session.id)
    if (sessionId) input.session_id = sessionId
    if (!input.cwd || typeof input.cwd !== 'string') {
      const first = Array.isArray(input.workspacePaths) ? input.workspacePaths[0] : null
      input.cwd = (typeof first === 'string' && first) ? first : process.cwd()
    }
    // Muse does not set CLAUDE_PLUGIN_DATA; records fall back to the
    // runtime default (XDG cache or ~/.cache/work-context).
    const runtime = require('../scripts/work-context.cjs')
    let captured = ''
    runtime.runCli({ argv: [mode], input, writeStdout: (value) => { captured += value } })
    if (!captured.trim()) return 0
    let parsed = null
    try {
      parsed = JSON.parse(captured)
    } catch { parsed = null }
    const context = parsed?.hookSpecificOutput?.additionalContext ?? captured.trim()
    const event = parsed?.hookSpecificOutput?.hookEventName || eventName
    process.stdout.write(fitEnvelope(event, context))
    return 0
  } catch (error) {
    process.stdout.write(fitEnvelope(eventName, `WORK_CONTEXT_FAILED: ${error && error.message ? error.message : error} — .work-context.json과 계획 폴더를 확인한다`))
    return 0
  }
}

process.exitCode = main()
