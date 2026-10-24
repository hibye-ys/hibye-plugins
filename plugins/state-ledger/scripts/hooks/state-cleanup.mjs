#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { allDetails, config, enabled, fileText, fingerprint, git, hasEntry, readRequests, requireEnabled, storeRequests, target, writeDetailMeta } from './state-cleanup-store.mjs'
import { evaluateRequest, validateCleanupCommit } from './state-cleanup-check.mjs'
import { projectRoot } from './state-config.mjs'

export { readRequests, evaluateRequest, validateCleanupCommit }

export function awaitUser(root, { target: key, sessionId }) {
  requireEnabled(root)
  if (!sessionId) throw new Error('sessionId is required')
  const detail = allDetails(root).find((d) => d.key === key)
  if (!detail || !hasEntry(fileText(root, detail.index), detail.id)) throw new Error(`STATE target is not indexed: ${key}`)
  if (detail.meta.session_id && detail.meta.session_id !== sessionId) throw new Error('another session owns this STATE target')
  writeDetailMeta(root, detail, { session_id: sessionId, lifecycle: 'awaiting_user' })
  return { target: key, lifecycle: 'awaiting_user' }
}

export function requestCleanup(root, { sessionId, instructionRef, instruction, targets = [], scope = 'session' }) {
  requireEnabled(root)
  if (!sessionId || !instructionRef?.trim() || !instruction?.trim()) throw new Error('original user instruction, reference and session are required')
  const base = git(root, ['rev-parse', 'HEAD']).trim()
  const details = allDetails(root, base)
  const keys = targets.length ? targets : details.filter((d) => d.meta.session_id === sessionId && d.meta.lifecycle === 'awaiting_user').map((d) => d.key)
  if (!keys.length) throw new Error('no committed awaiting_user targets belong to this session')
  for (const key of keys) {
    target(root, key)
    const detail = details.find((d) => d.key === key)
    if (!detail || !hasEntry(fileText(root, detail.index, base), detail.id)) throw new Error(`target is not committed/indexed: ${key}`)
    if (fileText(root, detail.detail) !== detail.text) throw new Error(`${key}: commit the current STATE detail before requesting cleanup`)
    if (scope !== 'explicit' && (detail.meta.session_id !== sessionId || detail.meta.lifecycle !== 'awaiting_user')) throw new Error(`${key}: another session or missing awaiting_user confirmation boundary`)
  }
  const requests = readRequests(root)
  if (requests.some((r) => r.targets.some((key) => keys.includes(key)))) throw new Error('a cleanup request already owns one of these targets; resume it')
  const request = { id: randomUUID(), session_id: sessionId, owner_session: sessionId, instruction_ref: instructionRef, instruction, scope, targets: keys, base_commit: base, status: 'requested', auto_attempts: 0, blocked_reason: null }
  storeRequests(root, [...requests, request])
  return request
}

function ownedRequest(root, requestId, sessionId) {
  const requests = reconciledRequests(root)
  const request = requests.find((r) => r.id === requestId)
  if (!request) throw new Error(`cleanup request not found: ${requestId}`)
  if (request.session_id !== sessionId) throw new Error('cleanup request belongs to another session; explicitly resume it first')
  return { requests, request }
}

export function blockCleanup(root, { requestId, sessionId, reason }) {
  requireEnabled(root)
  if (!reason?.trim()) throw new Error('a concrete incomplete reason is required')
  const { requests, request } = ownedRequest(root, requestId, sessionId)
  request.status = 'blocked'; request.blocked_reason = reason
  storeRequests(root, requests)
  return request
}

export function resumeCleanup(root, { requestId, sessionId, instructionRef }) {
  requireEnabled(root)
  if (!sessionId) throw new Error('sessionId is required')
  const requests = reconciledRequests(root)
  const request = requests.find((r) => r.id === requestId)
  if (!request) throw new Error('cleanup request not found')
  if (request.session_id !== sessionId) {
    if (!instructionRef?.trim() || instructionRef === request.instruction_ref) throw new Error('a new user resume instruction reference is required to hand off another session request')
    request.resume_ref = instructionRef
  }
  request.session_id = sessionId; request.status = 'requested'; request.blocked_reason = null
  // User-approved work can move to a new session; its identity and automatic budget cannot reset.
  storeRequests(root, requests)
  return request
}

export function finishCleanup(root, { requestId, sessionId }) {
  requireEnabled(root)
  const { requests, request } = ownedRequest(root, requestId, sessionId)
  const evidence = evaluateRequest(root, request)
  if (!evidence.ok) throw new Error(evidence.violations.map((v) => `${v.code}: ${v.message}`).join('\n'))
  storeRequests(root, requests.filter((r) => r.id !== requestId))
  return { ...evidence, request_id: requestId, state: 'awaiting_final_commit', message: `Commit the verified cleanup-request removal in ${config(root).indexes[0]}; keep the archive history.` }
}

export function cleanupContext(root) {
  if (!enabled(root)) return ''
  const requests = reconciledRequests(root, false)
  if (!requests.length) return ''
  return 'STATE 정리 미완료 요청 — 새 승인·자동 삭제로 해석하지 말고 기존 요청을 재개한다:\n' + requests.map((r) => `${r.id} · ${r.targets.join(', ')} · session=${r.session_id} · ${r.status}${r.blocked_reason ? ` · ${r.blocked_reason}` : ''}`).join('\n')
}

// Uncommitted edits cannot erase committed ownership or replenish a spent budget.
function reconciledRequests(root, persist = true) {
  const working = readRequests(root)
  const committed = readRequests(root, 'HEAD')
  let repaired = false
  const requests = working.map((r) => {
    const before = committed.find((p) => p.id === r.id)
    if (!before) return r
    const invalidHandoff = r.session_id !== before.session_id && (!r.resume_ref || r.resume_ref === before.resume_ref || r.resume_ref === r.instruction_ref)
    if (fingerprint(r) !== fingerprint(before) || invalidHandoff || r.auto_attempts < before.auto_attempts) {
      repaired = true
      return { ...before, auto_attempts: Math.max(r.auto_attempts, before.auto_attempts), status: 'blocked', blocked_reason: '미커밋 요청이 승인 범위·소유권·자동 보완 상한을 변경하여 기존 요청을 보존했습니다.' }
    }
    return r
  })
  for (const before of committed) if (!working.some((r) => r.id === before.id)) requests.push(before)
  if (repaired && persist) storeRequests(root, requests)
  return requests
}

export function stopCleanup(root, payload = {}) {
  if (!enabled(root)) return null
  const sessionId = payload.session_id ?? payload.sessionID
  if (!sessionId) return null
  const working = readRequests(root)
  const requests = reconciledRequests(root)
  const mine = requests.filter((r) => r.session_id === sessionId)
  if (!mine.length) return null
  const active = requests.filter((r) => r.session_id !== sessionId)
  const reasons = []
  let continuation = false
  for (const request of mine) {
    const evidence = evaluateRequest(root, request)
    const missingRecord = !working.some((r) => r.id === request.id)
    const issues = missingRecord ? ['정리 요청 제거를 마무리 커밋하지 않았습니다.']
      : evidence.ok ? ['아카이브는 검증됐지만 요청 제거와 마무리 커밋이 남았습니다.'] : evidence.violations.map((v) => v.message)
    if (request.status === 'requested' && request.auto_attempts === 0 && !payload.stop_hook_active && !missingRecord) {
      request.auto_attempts = 1
      continuation = true
    } else {
      request.status = 'blocked'
      request.blocked_reason = (request.blocked_reason || `자동 보완 후에도 정리 미완료: ${issues.join('; ')}`).slice(0, 1900)
    }
    active.push(request)
    reasons.push(`${request.id}: ${request.blocked_reason || issues.join('; ')}`)
  }
  // Persist before emitting block: a generated user continuation must not reset the request.
  storeRequests(root, active)
  const message = `STATE 정리 미완료: ${reasons.join('\n')}`
  if (continuation) return { decision: 'block', reason: `${message}\n기존 요청을 한 번 보완하고 check/finish 및 정상 커밋을 수행하세요. 새 사용자 승인이나 새 요청이 아닙니다. 권한·사용자 판단이 필요하면 block 명령으로 실제 이유를 기록하고 미완료로 보고하세요.` }
  return { continue: false, stopReason: message, systemMessage: message }
}

export function runCleanupCli(root, argv, payload = {}) {
  const [action, ...args] = argv
  const { values } = parseArgs({ args, options: { session: { type: 'string' }, target: { type: 'string', multiple: true }, request: { type: 'string' }, 'instruction-ref': { type: 'string' }, instruction: { type: 'string' }, scope: { type: 'string' }, reason: { type: 'string' }, 'message-file': { type: 'string' } } })
  const sessionId = values.session ?? payload.session_id ?? payload.sessionID ?? process.env.STATE_HOOK_SESSION_ID
  const options = { sessionId, requestId: values.request }
  if (action === 'await-user') return awaitUser(root, { ...options, target: values.target?.[0] })
  if (action === 'request') return requestCleanup(root, { ...options, targets: values.target ?? [], instructionRef: values['instruction-ref'], instruction: values.instruction, scope: values.scope ?? 'session' })
  if (action === 'block') return blockCleanup(root, { ...options, reason: values.reason })
  if (action === 'resume') return resumeCleanup(root, { ...options, instructionRef: values['instruction-ref'] })
  if (action === 'finish') return finishCleanup(root, options)
  if (action === 'check') return evaluateRequest(root, ownedRequest(root, options.requestId, sessionId).request)
  if (action === 'validate-staged') return validateCleanupCommit(root, { message: values['message-file'] ? readFileSync(values['message-file'], 'utf8') : null })
  if (action === 'stop') return stopCleanup(root, payload)
  if (action === 'context') return cleanupContext(root)
  throw new Error('usage: state-cleanup.mjs await-user|request|check|block|resume|finish|validate-staged|stop|context [options]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2]
  try {
    let payload = {}
    if (['stop', 'context'].includes(action)) { try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { /* CLI may have no hook input */ } }
    const value = runCleanupCli(projectRoot(), process.argv.slice(2), payload)
    if (value !== null && value !== '') process.stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value)}\n`)
    if (value?.ok === false) { process.stderr.write(`STATE_CLEANUP_BLOCK: ${value.violations.map((v) => `${v.code}: ${v.message}`).join('; ')}\n`); process.exitCode = 1 }
  } catch (error) {
    if (action === 'stop') process.stdout.write(`${JSON.stringify({ continue: false, stopReason: `STATE 정리 판정 실패: ${error.message}`, systemMessage: `STATE 정리 미완료: ${error.message}` })}\n`)
    else { process.stderr.write(`STATE_CLEANUP_BLOCK: ${error.message}\n`); process.exitCode = 1 }
  }
}
