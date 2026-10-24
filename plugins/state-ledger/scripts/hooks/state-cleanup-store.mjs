import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stateConfig, readStaterc } from './state-config.mjs'

const MARKER = /^<!-- STATE_CLEANUP_V1 (.+) -->\r?\n?/gm
const snapshots = new Map()
export const enabled = (root) => {
  if (readStaterc(realpathSync(root), 'STATE_CLEANUP_ENFORCE') === '1') return true
  // Removing the opt-in alongside an unfinished request must not turn off its guard.
  try { return /^STATE_CLEANUP_ENFORCE="1"\s*$/m.test(git(root, ['show', 'HEAD:.staterc'])) }
  catch (error) { if (error.status === 128) return false; throw error }
}
export const config = (root) => stateConfig(realpathSync(root))

export function git(root, args) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' }
  for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key]
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: 15000 })
}

export function fileText(root, file, revision = null) {
  root = realpathSync(root)
  if (revision !== null) {
    try { return git(root, ['show', revision === ':' ? `:${file}` : `${revision}:${file}`]) }
    catch (error) { if (error.status === 128 || error.status === 1) return null; throw error }
  }
  const path = resolve(root, file)
  const rel = relative(realpathSync(root), path)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error(`unsafe STATE path: ${file}`)
  let parent = path
  while (!existsSync(parent)) {
    try { if (lstatSync(parent).isSymbolicLink()) throw new Error(`dangling STATE symlink: ${file}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const next = resolve(parent, '..'); if (next === parent) break; parent = next
  }
  const resolved = relative(realpathSync(root), realpathSync(parent))
  if (isAbsolute(resolved) || resolved === '..' || resolved.startsWith('../')) throw new Error(`STATE path escapes repository: ${file}`)
  if (!existsSync(path)) return null
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error(`STATE must be a bounded regular file: ${file}`)
  return readFileSync(path, 'utf8')
}

export function target(root, key) {
  const match = /^([A-Za-z0-9_-]+)\/([a-z0-9-]{3,12})$/.exec(key ?? '')
  const index = match && config(root).indexByArea[match[1]]
  if (!index) throw new Error(`unknown STATE target: ${key}`)
  return { key, area: match[1], id: match[2], index, detail: `docs/state/${match[1]}/${match[2]}.md` }
}

export function detailMeta(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text ?? '')
  if (!match) throw new Error('STATE detail frontmatter is missing')
  return Object.fromEntries(match[1].split('\n').map((line) => /^([a-z_]+): (.*)$/.exec(line)).filter(Boolean).map((m) => [m[1], m[2]]))
}

export function hasEntry(text, id) {
  return (text ?? '').split('\n').some((line) => line.startsWith(`- [${id}] `))
}

export function strippedRequests(text) {
  return (text ?? '').replace(MARKER, '')
}

function validString(value, max = 256) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\r\n\0]/.test(value)
}

export function validateRequest(root, r) {
  const allowed = ['id', 'session_id', 'owner_session', 'instruction_ref', 'instruction', 'scope', 'targets', 'base_commit', 'status', 'auto_attempts', 'blocked_reason', 'resume_ref']
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some((k) => !allowed.includes(k))) throw new Error('invalid cleanup request shape')
  const validInstruction = typeof r.instruction === 'string' && r.instruction.trim().length > 0 && r.instruction.length <= 2000 && !r.instruction.includes('\0')
  if (!/^[a-f0-9-]{36}$/.test(r.id ?? '') || !validString(r.session_id) || !validString(r.owner_session) || !validString(r.instruction_ref, 1000) || !validInstruction) throw new Error('cleanup requires a request id, session and original user instruction/reference')
  if (!['session', 'explicit'].includes(r.scope) || !['requested', 'blocked'].includes(r.status) || ![0, 1].includes(r.auto_attempts) || !/^[a-f0-9]{40}$/.test(r.base_commit ?? '')) throw new Error('invalid cleanup scope, status, budget or base commit')
  if (!Array.isArray(r.targets) || r.targets.length < 1 || r.targets.length > 64 || new Set(r.targets).size !== r.targets.length) throw new Error('cleanup target set must be bounded and unique')
  for (const key of r.targets) target(root, key)
  if (r.status === 'blocked' && !validString(r.blocked_reason, 2000)) throw new Error('blocked cleanup requires a concrete reason')
  if (r.status === 'requested' && r.blocked_reason !== null) throw new Error('requested cleanup must not contain a blocked reason')
  if (r.resume_ref !== undefined && !validString(r.resume_ref, 1000)) throw new Error('resume_ref must name an explicit user resume instruction')
  return r
}

export function readRequests(root, revision = null) {
  const text = fileText(root, config(root).indexes[0], revision)
  if (revision === null) snapshots.set(realpathSync(root), text)
  const matches = [...(text ?? '').matchAll(MARKER)]
  if (matches.length > 1) throw new Error('duplicate STATE cleanup metadata')
  if (!matches.length) return []
  const value = JSON.parse(matches[0][1])
  if (value?.version !== 1 || !Array.isArray(value.requests) || value.requests.length > 32 || Object.keys(value).some((k) => !['version', 'requests'].includes(k))) throw new Error('invalid STATE cleanup metadata')
  const requests = value.requests.map((r) => validateRequest(root, r))
  if (new Set(requests.map((r) => r.id)).size !== requests.length) throw new Error('duplicate cleanup request id')
  const assigned = requests.flatMap((r) => r.targets)
  if (new Set(assigned).size !== assigned.length) throw new Error('overlapping cleanup requests')
  return requests
}

export function storeRequests(root, requests) {
  root = realpathSync(root)
  const expected = snapshots.has(root) ? snapshots.get(root) : fileText(root, config(root).indexes[0])
  const lock = cleanupLockPath(root)
  if (existsSync(lock) && (!lstatSync(lock).isFile() || lstatSync(lock).isSymbolicLink())) throw new Error('unsafe STATE cleanup lock path')
  // OS record locks release on process death. The zero-byte temporary lock
  // contains no request; expected text and requests travel only through stdin.
  try {
    execFileSync('lockf', ['-k', '-t', '0', lock, process.execPath, fileURLToPath(import.meta.url), '--write-locked'], {
      timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8',
      input: JSON.stringify({ root, requests, expected }), maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) { throw new Error(`STATE cleanup write lock or replacement failed; reread before retrying (requires BSD lockf): ${String(error.stderr || error.message).slice(0, 500)}`) }
  snapshots.set(root, fileText(root, config(root).indexes[0]))
}

export function cleanupLockPath(root) {
  const key = createHash('sha256').update(`${realpathSync(root)}\0${config(root).indexes[0]}`).digest('hex')
  return join(tmpdir(), `state-ledger-cleanup-${process.getuid?.() ?? 'user'}-${key}.lock`)
}

function storeRequestsLocked(root, requests) {
  for (const r of requests) validateRequest(root, r)
  const index = config(root).indexes[0]
  const text = fileText(root, index)
  if (text === null) throw new Error('STATE index is missing')
  const previous = snapshots.get(realpathSync(root))
  if (previous !== undefined && previous !== text) throw new Error('STATE changed concurrently; reread the request before retrying')
  const body = strippedRequests(text)
  const json = JSON.stringify({ version: 1, requests }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
  const updated = requests.length ? `<!-- STATE_CLEANUP_V1 ${json} -->\n${body}` : body
  const path = join(root, index)
  const temp = `${path}.cleanup-${randomUUID()}.tmp`
  let fd
  try {
    fd = openSync(temp, 'wx', lstatSync(path).mode & 0o777)
    writeFileSync(fd, updated)
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    if (readFileSync(path, 'utf8') !== text) throw new Error('STATE changed concurrently before replacement; no request was overwritten')
    renameSync(temp, path)
    snapshots.set(realpathSync(root), updated)
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

export function allDetails(root, revision = null) {
  const files = revision === null ? git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'docs/state'])
    : git(root, ['ls-tree', '-r', '--name-only', '-z', revision, '--', 'docs/state'])
  return [...new Set(files.split('\0').filter(Boolean))].filter((p) => /^docs\/state\/[^/]+\/[^/]+\.md$/.test(p)).map((p) => {
    const key = p.slice('docs/state/'.length, -3)
    const t = target(root, key)
    const text = fileText(root, p, revision)
    return text === null ? null : { ...t, text, meta: detailMeta(text) }
  }).filter(Boolean)
}

export function writeDetailMeta(root, t, values) {
  const text = fileText(root, t.detail)
  if (text === null) throw new Error(`STATE detail is missing: ${t.key}`)
  detailMeta(text)
  let updated = text
  for (const [key, value] of Object.entries(values)) {
    if (!validString(value, 2000)) throw new Error(`invalid detail field ${key}`)
    const headEnd = updated.indexOf('\n---\n', 4)
    let fm = updated.slice(4, headEnd)
    const re = new RegExp(`^${key}: .*$`, 'm')
    fm = re.test(fm) ? fm.replace(re, `${key}: ${value}`) : `${fm}\n${key}: ${value}`
    updated = `---\n${fm}${updated.slice(headEnd)}`
  }
  writeFileSync(join(root, t.detail), updated)
}

export function requireEnabled(root) {
  if (!enabled(root)) throw new Error('STATE_CLEANUP_ENFORCE="1" is required')
}

export const fingerprint = (r) => createHash('sha256').update(JSON.stringify([r.id, r.owner_session, r.instruction_ref, r.instruction, r.scope, r.targets, r.base_commit])).digest('hex')

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === '--write-locked') {
  try {
    const { root, requests, expected } = JSON.parse(readFileSync(0, 'utf8'))
    snapshots.set(realpathSync(root), expected)
    storeRequestsLocked(root, requests)
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
