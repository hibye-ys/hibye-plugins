import { posix } from 'node:path'
import { config, detailMeta, enabled, fileText, fingerprint, git, hasEntry, readRequests, strippedRequests, target } from './state-cleanup-store.mjs'

const violation = (code, message) => ({ code, message })
const result = (violations, extra = {}) => ({ ok: violations.length === 0, violations, ...extra })

export function referencesTo(root, targets, snapshot = 'worktree') {
  if (targets.length === 0) return []
  const paths = targets.map((key) => target(root, key).detail)
  const args = ['grep', '-I', '-l', '-z', '-F']
  if (snapshot === 'index') args.push('--cached')
  if (snapshot === 'worktree') args.push('--untracked', '--exclude-standard')
  for (const path of paths) args.push('-e', posix.basename(path))
  // Markdown destinations may encode the basename or use relative definitions.
  args.push('-e', '](', '-e', ']:')
  if (!['index', 'worktree'].includes(snapshot)) args.push(snapshot)
  args.push('--')
  let files
  try { files = git(root, args).split('\0').filter(Boolean) }
  catch (error) { if (error.status === 1) return []; throw error }
  if (!['index', 'worktree'].includes(snapshot)) files = files.map((file) => file.slice(snapshot.length + 1))
  const pinned = new Map()
  const refs = []
  for (const file of files) {
    if (paths.includes(file)) continue
    let text = fileText(root, file, snapshot === 'worktree' ? null : snapshot === 'index' ? ':' : snapshot)
    if (text === null || text.length > 2 * 1024 * 1024 || text.includes('\0')) continue
    if (config(root).indexes.includes(file)) text = strippedRequests(text)
    for (const [n, original] of text.split('\n').entries()) {
      // Strip only a verified immutable coordinate, never the rest of its line.
      const line = original.replace(/\b([a-f0-9]{40}):(docs\/state\/[A-Za-z0-9_-]+\/[a-z0-9-]{3,12}\.md)\b/g, (match, sha, path) => {
        const coordinate = `${sha}:${path}`
        if (!pinned.has(coordinate)) {
          try { git(root, ['cat-file', '-e', coordinate]); pinned.set(coordinate, true) } catch { pinned.set(coordinate, false) }
        }
        return pinned.get(coordinate) ? '' : match
      })
      for (const path of paths) {
        let found = line.includes(path)
        if (/\.md$/i.test(file)) {
          const destinations = [...line.matchAll(/\[[^\]]*\]\(<?([^)>\s]+)>?(?:\s+"[^"]*")?\)/g), ...line.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^>\s]+)>?/g)]
          for (const m of destinations) {
            let href = m[1].split('#')[0]
            if (/^[a-z]+:/i.test(href)) continue
            try { href = decodeURIComponent(href) } catch { /* keep invalid href visible */ }
            const resolved = href.startsWith('/') ? href.slice(1) : posix.normalize(posix.join(posix.dirname(file), href))
            if (resolved === path) found = true
          }
        }
        if (found) refs.push({ file, line: n + 1, target: path })
      }
    }
  }
  return refs
}

function archiveProof(root, request, t) {
  const commits = git(root, ['rev-list', '--max-count=1001', `${request.base_commit}..HEAD`, '--', t.detail]).trim().split('\n').filter(Boolean)
  if (commits.length > 1000) throw new Error('cleanup history exceeds 1000 commits; narrow the request baseline')
  for (const sha of commits) {
    const parents = git(root, ['rev-list', '--parents', '-n', '1', sha]).trim().split(' ').slice(1)
    if (parents.length !== 1) continue
    if (fileText(root, t.detail, sha) !== null || fileText(root, t.detail, parents[0]) !== fileText(root, t.detail, request.base_commit)) continue
    if (hasEntry(fileText(root, t.index, sha), t.id)) continue
    const message = git(root, ['show', '-s', '--format=%B', sha])
    if (new RegExp(`(?:^|[^A-Za-z])archive \\[id=${t.id}\\]`).test(message)) return sha
  }
  return null
}

export function evaluateRequest(root, request) {
  const errors = []
  const archiveCommits = []
  try {
    git(root, ['merge-base', '--is-ancestor', request.base_commit, 'HEAD'])
    for (const key of request.targets) {
      const t = target(root, key)
      if (fileText(root, t.detail) !== null || fileText(root, t.detail, ':') !== null || fileText(root, t.detail, 'HEAD') !== null) errors.push(violation('DETAIL_REMAINS', `${key}: detail removal must be committed and present in neither worktree nor index`))
      if ([null, ':', 'HEAD'].some((rev) => hasEntry(fileText(root, t.index, rev), t.id))) errors.push(violation('INDEX_ENTRY_REMAINS', `${key}: STATE index entry remains`))
      const proof = archiveProof(root, request, t)
      if (!proof) errors.push(violation('ARCHIVE_COMMIT_MISSING', `${key}: no committed deletion with archive [id=${t.id}] after the request baseline`))
      else archiveCommits.push(proof)
    }
    for (const snapshot of ['worktree', 'index', 'HEAD']) {
      for (const ref of referencesTo(root, request.targets, snapshot)) errors.push(violation('DANGLING_REFERENCE', `${snapshot} ${ref.file}:${ref.line} -> ${ref.target}`))
    }
  } catch (error) { errors.push(violation('CHECK_FAILED', error.message)) }
  return result(errors, { archiveCommits: [...new Set(archiveCommits)] })
}

function validateOrigin(root, request) {
  git(root, ['merge-base', '--is-ancestor', request.base_commit, 'HEAD'])
  for (const key of request.targets) {
    const t = target(root, key)
    const text = fileText(root, t.detail, request.base_commit)
    if (text === null || !hasEntry(fileText(root, t.index, request.base_commit), t.id)) throw new Error(`${key}: target must exist at the committed request baseline`)
    if (request.scope === 'session') {
      const meta = detailMeta(text)
      if (meta.lifecycle !== 'awaiting_user' || meta.session_id !== request.owner_session) throw new Error(`${key}: cleanup requires a committed awaiting_user record owned by the original session`)
    }
  }
}

export function validateCleanupCommit(root, { message = null } = {}) {
  if (!enabled(root)) return result([])
  const errors = []
  try {
    const previous = readRequests(root, 'HEAD')
    const staged = readRequests(root, ':')
    if (staged.length && !/^STATE_CLEANUP_ENFORCE="1"\s*$/m.test(fileText(root, '.staterc', ':') ?? '')) errors.push(violation('CLEANUP_DISABLED_PENDING', 'unfinished cleanup requests require STATE_CLEANUP_ENFORCE="1" until verified completion'))
    for (const r of staged) {
      validateOrigin(root, r)
      const before = previous.find((p) => p.id === r.id)
      if (before && (fingerprint(before) !== fingerprint(r) || r.auto_attempts < before.auto_attempts)) errors.push(violation('REQUEST_CHANGED', `${r.id}: request identity, scope and repair budget must not be rewritten`))
      if (before && r.session_id !== before.session_id && (!r.resume_ref || r.resume_ref === before.resume_ref || r.resume_ref === r.instruction_ref)) errors.push(violation('HANDOFF_NOT_REQUESTED', `${r.id}: another processing session requires a new user resume reference`))
    }
    for (const before of previous) {
      if (!staged.some((r) => r.id === before.id)) {
        const complete = evaluateRequest(root, before)
        if (!complete.ok) errors.push(violation('REQUEST_REMOVED_EARLY', `${before.id}: ${complete.violations.map((v) => v.message).join('; ')}`))
      }
    }
    const deleted = git(root, ['diff', '--cached', '--no-renames', '--name-only', '--diff-filter=D', '--', 'docs/state']).trim().split('\n').filter(Boolean)
    const targets = []
    for (const file of deleted) {
      if (!/^docs\/state\/[^/]+\/[^/]+\.md$/.test(file)) continue
      const key = file.slice('docs/state/'.length, -3)
      const t = target(root, key)
      targets.push(key)
      const authorizations = staged.filter((r) => r.targets.includes(key))
      if (authorizations.length !== 1) errors.push(violation('CLEANUP_NOT_REQUESTED', `${key}: no retained user cleanup request authorizes this deletion`))
      if (authorizations.length === 1 && fileText(root, t.detail, 'HEAD') !== fileText(root, t.detail, authorizations[0].base_commit)) errors.push(violation('TARGET_CHANGED', `${key}: target changed after the user cleanup request; preserve it pending a new user decision`))
      if (hasEntry(fileText(root, t.index, ':'), t.id)) errors.push(violation('INDEX_ENTRY_REMAINS', `${key}: remove its STATE index entry in the same archive commit`))
      if (message !== null && !new RegExp(`(?:^|[^A-Za-z])archive \\[id=${t.id}\\]`).test(message)) errors.push(violation('ARCHIVE_TAG_MISSING', `${key}: commit message requires archive [id=${t.id}]`))
    }
    for (const ref of referencesTo(root, targets, 'index')) errors.push(violation('DANGLING_REFERENCE', `index ${ref.file}:${ref.line} -> ${ref.target}`))
  } catch (error) { errors.push(violation('CHECK_FAILED', error.message)) }
  return result(errors)
}
