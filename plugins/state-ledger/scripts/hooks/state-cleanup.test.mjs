import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  awaitUser,
  blockCleanup,
  evaluateRequest,
  finishCleanup,
  readRequests,
  requestCleanup,
  resumeCleanup,
  stopCleanup,
  validateCleanupCommit,
} from './state-cleanup.mjs'
import { cleanupLockPath, storeRequests } from './state-cleanup-store.mjs'

const SESSION = 'cleanup-session'
const OTHER_SESSION = 'other-session'
const INDEX = 'STATE.md'
const OWN = 'root/own'
const OTHER = 'root/other'
const MODULE_URL = new URL('./state-cleanup.mjs', import.meta.url).href
const STORE_URL = new URL('./state-cleanup-store.mjs', import.meta.url).href

function git(root, ...args) {
  return execFileSync('git', ['-c', 'core.excludesfile=/dev/null', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

function commit(root, message) {
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', message)
  return git(root, 'rev-parse', 'HEAD')
}

function detailPath(target) {
  return `docs/state/${target}.md`
}

function seed(root, target, sessionId = SESSION, lifecycle = 'active') {
  const [area, id] = target.split('/')
  const body = `\n## 현재\n\n${id}: waiting for the next instruction.\n`
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8)
  write(root, detailPath(target), `---\nid: ${id}\narea: ${area}\nowner: fixture\nbranch: main\ntouched: 2026-10-25T00:00\nhash: ${hash}\nsession_id: ${sessionId}\nlifecycle: ${lifecycle}\n---\n${body}`)
  const index = area === 'root' ? INDEX : `apps/${area}/STATE.md`
  const text = readFileSync(join(root, index), 'utf8')
  write(root, index, text.replace('## 1. 활성\n', `## 1. 활성\n- [${id}] fixture\n`))
}

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'state-cleanup-test-'))
  t.after(() => {
    const lock = cleanupLockPath(root)
    rmSync(root, { recursive: true, force: true })
    rmSync(lock, { force: true })
  })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'cleanup fixture')
  git(root, 'config', 'user.email', 'cleanup@example.invalid')
  // Only the disposable fixture disables hooks; the checkout under test is untouched.
  git(root, 'config', 'core.hooksPath', '/dev/null')
  write(root, '.staterc', 'STATE_INDEXES="STATE.md apps/api/STATE.md apps/web/STATE.md"\nSTATE_DEFAULT_BRANCH="main"\nSTATE_CLEANUP_ENFORCE="1"\n')
  for (const index of [INDEX, 'apps/api/STATE.md', 'apps/web/STATE.md']) {
    write(root, index, '# STATE\n\n## 1. 활성\n\n## 2. 다음\n\n## 3. 미래\n\n## 4. 미해결\n')
  }
  seed(root, OWN)
  seed(root, OTHER, OTHER_SESSION)
  seed(root, 'root/active')
  commit(root, 'seed fixture [id=own] [id=other] [id=active]')
  await awaitUser(root, { target: OWN, sessionId: SESSION })
  await awaitUser(root, { target: OTHER, sessionId: OTHER_SESSION })
  commit(root, 'await user [id=own] [id=other]')
  return root
}

function instruction(extra = {}) {
  return {
    sessionId: SESSION,
    instructionRef: 'chat:cleanup-instruction-1',
    instruction: 'Archive my waiting work and retain only current work.',
    ...extra,
  }
}

async function request(root, extra = {}) {
  const result = await requestCleanup(root, instruction(extra))
  commit(root, 'record authorized cleanup request [id=-]')
  return result
}

function removeTarget(root, target, { keepRow = false } = {}) {
  rmSync(join(root, detailPath(target)))
  if (keepRow) return
  const [area, id] = target.split('/')
  const index = area === 'root' ? INDEX : `apps/${area}/STATE.md`
  const text = readFileSync(join(root, index), 'utf8')
  write(root, index, text.split('\n').filter((line) => !line.startsWith(`- [${id}]`)).join('\n'))
}

function stage(root) {
  git(root, 'add', '-A')
}

function assertRejected(result) {
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.ok(result.violations.length > 0, 'rejection must explain at least one violation')
  for (const violation of result.violations) {
    assert.equal(typeof violation.code, 'string')
    assert.equal(typeof violation.message, 'string')
  }
}

function readAfterRestart(root) {
  const program = `import { readRequests } from ${JSON.stringify(MODULE_URL)}; console.log(JSON.stringify(await readRequests(process.argv[1])))`
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program, root], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
}

function runNativeHook(root, script, payload = {}, args = []) {
  return spawnSync('bash', [fileURLToPath(new URL(`./${script}`, import.meta.url)), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, HOOK_PROJECT_DIR: root, STATE_HOOK_DATA_DIR: join(root, '.hook-data') },
    input: JSON.stringify(payload),
  })
}

function rewriteRequest(root, id, mutate) {
  const text = readFileSync(join(root, INDEX), 'utf8')
  let changed = false
  const updated = text.replace(/^<!-- STATE_CLEANUP_V1 (.+) -->$/m, (_, json) => {
    const metadata = JSON.parse(json)
    const pending = metadata.requests.find((entry) => entry.id === id)
    assert.ok(pending, 'the request being tampered with must already exist')
    mutate(pending)
    changed = true
    return `<!-- STATE_CLEANUP_V1 ${JSON.stringify(metadata)} -->`
  })
  assert.equal(changed, true)
  write(root, INDEX, updated)
}

async function holdCleanupLock(t, root) {
  const lock = cleanupLockPath(root)
  const program = 'process.stdout.write("LOCK_HELD\\n"); process.stdin.resume(); process.stdin.on("end", () => process.exit(0))'
  const child = spawn('lockf', ['-k', '-t0', lock, process.execPath, '-e', program], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => { if (child.exitCode === null) child.stdin.end() })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exited = once(child, 'exit')
  await new Promise((resolve, reject) => {
    let output = ''
    const deadline = setTimeout(() => reject(new Error(`lockf holder did not acquire the lock: ${stderr}`)), 3000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (output.includes('LOCK_HELD\n')) { clearTimeout(deadline); resolve() }
    })
    child.once('error', (error) => { clearTimeout(deadline); reject(error) })
    child.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`lockf holder exited ${code}: ${stderr}`)) })
  })
  return {
    lock,
    pid: child.pid,
    release: async () => {
      child.stdin.end()
      const [code] = await exited
      assert.equal(code, 0, stderr)
    },
  }
}

test('storage regression: a live OS lock rejects writes without changing STATE or replacing the lock file', { timeout: 10_000 }, async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  const holder = await holdCleanupLock(t, root)
  const before = readFileSync(join(root, INDEX), 'utf8')
  const inode = statSync(holder.lock).ino
  await assert.rejects(async () => blockCleanup(root, { requestId: pending.id, sessionId: SESSION, reason: 'Must not overwrite while another writer is alive.' }), /lock/i)
  assert.equal(readFileSync(join(root, INDEX), 'utf8'), before)
  assert.equal(statSync(holder.lock).ino, inode)
  assert.equal(statSync(holder.lock).size, 0)
  await holder.release()
})

test('storage regression: holder exit releases the OS lock and the same empty file can be reacquired', { timeout: 10_000 }, async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  const holder = await holdCleanupLock(t, root)
  const inode = statSync(holder.lock).ino
  await holder.release()
  assert.throws(() => process.kill(holder.pid, 0), { code: 'ESRCH' })
  const reason = 'Previous holder exited; the cleanup still needs user input.'
  await blockCleanup(root, { requestId: pending.id, sessionId: SESSION, reason })
  const saved = readAfterRestart(root).find((entry) => entry.id === pending.id)
  assert.equal(saved.status, 'blocked')
  assert.equal(saved.blocked_reason, reason)
  assert.equal(statSync(holder.lock).ino, inode)
  assert.equal(statSync(holder.lock).size, 0)
})

test('storage regression: two subprocesses sharing a snapshot cannot overwrite each other', { timeout: 10_000 }, async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  const program = `
    import { readRequests, storeRequests } from ${JSON.stringify(STORE_URL)};
    const [root, label] = process.argv.slice(1);
    const requests = readRequests(root);
    process.send({ ready: true });
    process.once('message', () => {
      requests[0].status = 'blocked';
      requests[0].blocked_reason = label;
      try { storeRequests(root, requests); process.send({ ok: true, label }); }
      catch (error) { process.exitCode = 1; process.send({ ok: false, label, error: error.message }); }
      process.disconnect();
    });
  `
  function writer(label) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, root, label], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill() })
    let report
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('message', (message) => { if ('ok' in message) report = message })
    const ready = once(child, 'message')
    const exited = once(child, 'exit').then(([code]) => ({ code, report, stderr }))
    return { child, ready, exited }
  }
  const writers = [writer('writer-A'), writer('writer-B')]
  const ready = await Promise.all(writers.map((entry) => entry.ready))
  assert.ok(ready.every(([message]) => message.ready), 'both writers must read the original snapshot before either can save')
  for (const entry of writers) entry.child.send('save')
  const completed = await Promise.all(writers.map((entry) => entry.exited))
  const winners = completed.filter((entry) => entry.code === 0 && entry.report?.ok)
  assert.equal(winners.length, 1, JSON.stringify(completed))
  const loser = completed.find((entry) => entry !== winners[0])
  assert.equal(loser.code, 1, JSON.stringify(completed))
  assert.match(loser.report.error, /lock|concurrent/i)
  const saved = readAfterRestart(root).find((entry) => entry.id === pending.id)
  assert.equal(saved.blocked_reason, winners[0].report.label)
  assert.equal(statSync(cleanupLockPath(root)).size, 0)
})

test('storage regression: multiline original instructions round-trip exactly in one metadata comment', async (t) => {
  const root = await fixture(t)
  const original = '  첫 줄의 공백도 보존하세요.\r\n둘째 줄: "따옴표" · <tag> -->\n\n마지막 줄과 개행.\n'
  const pending = await request(root, { instruction: original })
  assert.equal(pending.instruction, original)
  assert.equal(readAfterRestart(root)[0].instruction, original)
  assert.equal((await readRequests(root, 'HEAD'))[0].instruction, original)
  assert.equal(readFileSync(join(root, INDEX), 'utf8').split('\n').filter((line) => line.startsWith('<!-- STATE_CLEANUP_V1 ')).length, 1)
  const records = await readRequests(root)
  storeRequests(root, records)
  assert.equal(readAfterRestart(root)[0].instruction, original)
})

test('regression: lowering a committed repair budget in the worktree cannot restart Stop', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  await stopCleanup(root, { session_id: SESSION, stop_hook_active: false })
  assert.equal(readAfterRestart(root)[0].auto_attempts, 1)
  commit(root, 'persist consumed cleanup attempt [id=-]')
  rewriteRequest(root, pending.id, (entry) => { entry.auto_attempts = 0 })
  for (let restart = 0; restart < 2; restart++) {
    const output = runNativeHook(root, 'stop-state-reminder.sh', {
      session_id: SESSION,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })
    assert.equal(output.status, 0, output.stderr)
    const response = JSON.parse(output.stdout)
    assert.equal(response.continue, false, 'committed auto_attempts=1 must remain a terminal limit')
    assert.notEqual(response.decision, 'block', 'a worktree edit must not grant another automatic repair')
  }
})

test('regression: changing only the working session cannot hide the request from its committed owner', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  rewriteRequest(root, pending.id, (entry) => { entry.session_id = OTHER_SESSION })
  const output = runNativeHook(root, 'stop-state-reminder.sh', {
    session_id: SESSION,
    hook_event_name: 'Stop',
    stop_hook_active: false,
  })
  assert.equal(output.status, 0, output.stderr)
  assert.ok(output.stdout.trim(), 'the committed owner must still receive the unresolved cleanup response')
  const response = JSON.parse(output.stdout)
  assert.ok(response.continue === false || response.decision === 'block', 'an unauthorized reassignment must not fall through to an ordinary Stop')
})

for (const [field, nextValue] of [['owner', 'another-owner'], ['session_id', OTHER_SESSION], ['lifecycle', 'active']]) {
  test(`regression: committed target ${field} changes invalidate the old archive authorization and proof`, async (t) => {
    const root = await fixture(t)
    const pending = await request(root)
    const path = detailPath(OWN)
    write(root, path, readFileSync(join(root, path), 'utf8').replace(new RegExp(`^${field}: .+$`, 'm'), `${field}: ${nextValue}`))
    commit(root, `target ${field} changed after authorization [id=own]`)
    removeTarget(root, OWN)
    stage(root)
    assertRejected(await validateCleanupCommit(root, { message: 'archive [id=own]' }))
    // Fixture hooks are disabled so proof validation also sees a deletion committed by an external actor.
    commit(root, 'archive [id=own]')
    assertRejected(await evaluateRequest(root, pending))
    await assert.rejects(async () => finishCleanup(root, { requestId: pending.id, sessionId: SESSION }))
  })
}

for (const [kind, file, navigation] of [
  ['percent-encoded inline', 'README.md', '[Archived target](docs/state/root/own%2Emd)'],
  ['reference-style relative', 'docs/plans/resume.md', '[Archived target][resume]\n\n[resume]: ../state/root/own.md'],
]) {
  test(`regression: ${kind} navigation is checked in staged and committed archive snapshots`, async (t) => {
    const root = await fixture(t)
    const pending = await request(root)
    removeTarget(root, OWN)
    write(root, file, `# Resume\n\n${navigation}\n`)
    stage(root)
    const staged = await validateCleanupCommit(root, { message: 'archive [id=own]' })
    assertRejected(staged)
    assert.ok(staged.violations.some((entry) => entry.code === 'DANGLING_REFERENCE'), JSON.stringify(staged))
    commit(root, 'archive [id=own]')
    const archived = await evaluateRequest(root, pending)
    assertRejected(archived)
    assert.ok(archived.violations.some((entry) => entry.code === 'DANGLING_REFERENCE'), JSON.stringify(archived))
  })
}

test('native hook Stop persists its one repair attempt and returns the terminal incomplete response', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  const before = await readRequests(root)
  const unrelated = runNativeHook(root, 'stop-state-reminder.sh', {
    session_id: OTHER_SESSION,
    hook_event_name: 'Stop',
    stop_hook_active: true,
  })
  assert.equal(unrelated.status, 0, unrelated.stderr)
  assert.equal(unrelated.stdout.trim(), '')
  assert.deepEqual(await readRequests(root), before)
  const payload = { session_id: SESSION, hook_event_name: 'Stop', stop_hook_active: false }
  const first = runNativeHook(root, 'stop-state-reminder.sh', payload)
  assert.equal(first.status, 0, first.stderr)
  assert.equal(JSON.parse(first.stdout).decision, 'block')
  assert.equal(readAfterRestart(root).find((entry) => entry.id === pending.id).auto_attempts, 1)
  const second = runNativeHook(root, 'stop-state-reminder.sh', { ...payload, stop_hook_active: true })
  assert.equal(second.status, 0, second.stderr)
  const terminal = JSON.parse(second.stdout)
  assert.equal(terminal.continue, false)
  assert.match(terminal.stopReason, /미완료/)
  assert.ok(terminal.stopReason.includes(pending.id))
  const saved = readAfterRestart(root).find((entry) => entry.id === pending.id)
  assert.equal(saved.status, 'blocked')
  assert.equal(saved.auto_attempts, 1)
})

test('native hook commit-msg blocks missing archive tags and retains the existing attribution warning', async (t) => {
  const root = await fixture(t)
  await request(root)
  removeTarget(root, OWN)
  const active = detailPath('root/active')
  write(root, active, readFileSync(join(root, active), 'utf8').replace(/^owner: fixture$/m, 'owner: fixture-updated'))
  stage(root)
  const messageFile = join(root, '.git', 'fixture-COMMIT_MSG')
  writeFileSync(messageFile, 'remove state [id=own]\n')
  const denied = runNativeHook(root, 'commit-msg-state-check.sh', {}, [messageFile])
  assert.equal(denied.status, 1, `${denied.stdout}\n${denied.stderr}`)
  assert.match(`${denied.stdout}\n${denied.stderr}`, /ARCHIVE_MESSAGE|archive \[id=own\]/)
  writeFileSync(messageFile, 'archive [id=own]\n')
  const allowed = runNativeHook(root, 'commit-msg-state-check.sh', {}, [messageFile])
  assert.equal(allowed.status, 0, `${allowed.stdout}\n${allowed.stderr}`)
  assert.match(`${allowed.stdout}\n${allowed.stderr}`, /WARN:.*\[id=active\]/)
})

test('native hook SessionStart injects the persisted incomplete request without changing the target', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  const targetBefore = readFileSync(join(root, detailPath(OWN)), 'utf8')
  const response = runNativeHook(root, 'session-start-state-inject.sh', {
    session_id: SESSION,
    hook_event_name: 'SessionStart',
  })
  assert.equal(response.status, 0, response.stderr)
  const output = JSON.parse(response.stdout).hookSpecificOutput
  assert.equal(output.hookEventName, 'SessionStart')
  assert.ok(output.additionalContext.includes(pending.id))
  assert.match(output.additionalContext, /STATE 정리 미완료 요청/)
  assert.ok(output.additionalContext.includes(pending.status))
  assert.equal(readFileSync(join(root, detailPath(OWN)), 'utf8'), targetBefore)
  assert.equal(readAfterRestart(root).find((entry) => entry.id === pending.id).auto_attempts, 0)
})

test('awaiting_user alone does not block normal Stop', async (t) => {
  const root = await fixture(t)
  const before = git(root, 'status', '--porcelain')
  assert.equal(await stopCleanup(root, { session_id: SESSION, stop_hook_active: false }), null)
  assert.equal(git(root, 'status', '--porcelain'), before)
  assert.deepEqual(await readRequests(root), [])
})

test('an opt-out commit cannot abandon an unfinished cleanup request', async (t) => {
  const root = await fixture(t)
  await request(root)
  const rc = readFileSync(join(root, '.staterc'), 'utf8')
  write(root, '.staterc', rc.replace('STATE_CLEANUP_ENFORCE="1"', 'STATE_CLEANUP_ENFORCE="0"'))
  stage(root)
  assert.ok(validateCleanupCommit(root).violations.some((v) => v.code === 'CLEANUP_DISABLED_PENDING'))
})

test('default request snapshots only the session-owned committed awaiting_user targets', async (t) => {
  const root = await fixture(t)
  seed(root, 'root/local', SESSION, 'awaiting_user')
  const result = await requestCleanup(root, instruction())
  assert.deepEqual(result.targets, [OWN])
  assert.ok(result.id)
  assert.equal(result.auto_attempts, 0)
  assert.deepEqual(readAfterRestart(root), await readRequests(root))
  assert.match(readFileSync(join(root, INDEX), 'utf8'), /^<!-- STATE_CLEANUP_V1 \{.*\} -->$/m)
})

test('instruction and instructionRef are both required before persisting authorization', async (t) => {
  const root = await fixture(t)
  for (const missing of [{ instruction: '' }, { instructionRef: '' }]) {
    await assert.rejects(async () => requestCleanup(root, instruction(missing)))
    assert.deepEqual(await readRequests(root), [])
  }
})

test('another session target requires explicit scope', async (t) => {
  const root = await fixture(t)
  await assert.rejects(async () => requestCleanup(root, instruction({ targets: [OTHER] })))
  assert.deepEqual(await readRequests(root), [])
  const result = await requestCleanup(root, instruction({ targets: [OTHER], scope: 'explicit' }))
  assert.deepEqual(result.targets, [OTHER])
})

test('cleanup request survives target deletion and an archive commit', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  removeTarget(root, OWN)
  stage(root)
  assert.equal((await validateCleanupCommit(root, { message: 'archive [id=own]' })).ok, true)
  const archived = commit(root, 'archive [id=own]')
  const persisted = readAfterRestart(root)
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].id, pending.id)
  assert.deepEqual(persisted[0].targets, [OWN])
  const evaluation = await evaluateRequest(root, persisted[0])
  assert.equal(evaluation.ok, true, JSON.stringify(evaluation))
  assert.ok(evaluation.archiveCommits.length > 0)
  assert.ok(JSON.stringify(evaluation.archiveCommits).includes(archived), 'archive evidence must identify the actual commit')
  assert.equal(existsSync(join(root, detailPath(OTHER))), true)
})

test('commit validation rejects deleting a target outside the authorized request', async (t) => {
  const root = await fixture(t)
  await request(root)
  removeTarget(root, OTHER)
  stage(root)
  assertRejected(await validateCleanupCommit(root, { message: 'archive [id=other]' }))
})

test('commit validation rejects an archive that leaves the target index row', async (t) => {
  const root = await fixture(t)
  await request(root)
  removeTarget(root, OWN, { keepRow: true })
  stage(root)
  assertRejected(await validateCleanupCommit(root, { message: 'archive [id=own]' }))
})

test('request metadata cannot disappear before the target archive is committed', async (t) => {
  const root = await fixture(t)
  await request(root)
  const text = readFileSync(join(root, INDEX), 'utf8')
  write(root, INDEX, text.replace(/^<!-- STATE_CLEANUP_V1 .* -->\r?\n?/m, ''))
  stage(root)
  assertRejected(await validateCleanupCommit(root, { message: 'finish cleanup [id=-]' }))
})

test('archive deletion requires the matching archive message', async (t) => {
  const root = await fixture(t)
  await request(root)
  removeTarget(root, OWN)
  stage(root)
  assertRejected(await validateCleanupCommit(root, { message: 'remove old state [id=own]' }))
})

test('new navigation to an archived target is rejected', async (t) => {
  const root = await fixture(t)
  await request(root)
  removeTarget(root, OWN)
  write(root, 'README.md', '# Resume\n\n[Current work](docs/state/root/own.md)\n')
  stage(root)
  assertRejected(await validateCleanupCommit(root, { message: 'archive [id=own]' }))
})

test('fixed Git blob references preserve evidence and allow finishing with a metadata commit', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  const source = git(root, 'rev-parse', 'HEAD')
  assert.match(git(root, 'show', `${source}:${detailPath(OWN)}`), /## 현재/)
  removeTarget(root, OWN)
  write(root, 'README.md', `# Archived work\n\nRead the historical record: \`git show ${source}:${detailPath(OWN)}\`.\n`)
  stage(root)
  assert.equal((await validateCleanupCommit(root, { message: 'archive [id=own]' })).ok, true)
  commit(root, 'archive [id=own]')
  await finishCleanup(root, { requestId: pending.id, sessionId: SESSION })
  assert.deepEqual(await readRequests(root), [])
  stage(root)
  const finished = await validateCleanupCommit(root, { message: 'finish cleanup [id=-]' })
  assert.equal(finished.ok, true, JSON.stringify(finished))
  commit(root, 'finish cleanup [id=-]')
  assert.deepEqual(readAfterRestart(root), [])
  assert.equal(await stopCleanup(root, { session_id: SESSION, stop_hook_active: false }), null)
})

test('a blocked reason survives restart and cannot be changed by another session', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  const reason = 'Archived source belongs to an unavailable worktree; user decision required.'
  await blockCleanup(root, { requestId: pending.id, sessionId: SESSION, reason })
  const blocked = readAfterRestart(root).find((entry) => entry.id === pending.id)
  assert.equal(blocked.status, 'blocked')
  assert.ok(JSON.stringify(blocked).includes(reason))
  await assert.rejects(async () => resumeCleanup(root, { requestId: pending.id, sessionId: OTHER_SESSION }))
  assert.deepEqual(await readRequests(root), [blocked])
})

test('Stop persists one automatic attempt, then stops the loop; resume never resets it', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  const otherRequest = await request(root, { sessionId: OTHER_SESSION, instructionRef: 'chat:other-cleanup' })
  const otherBefore = readFileSync(join(root, detailPath(OTHER)), 'utf8')
  const persistedBefore = await readRequests(root)
  const current = () => readAfterRestart(root).find((entry) => entry.id === pending.id)
  const otherPersisted = () => readAfterRestart(root).find((entry) => entry.id === otherRequest.id)
  const otherRequestBefore = otherPersisted()
  assert.equal(await stopCleanup(root, { session_id: 'unrelated-session', stop_hook_active: false }), null)
  assert.deepEqual(await readRequests(root), persistedBefore)
  const first = await stopCleanup(root, { session_id: SESSION, stop_hook_active: false })
  assert.equal(first.decision, 'block')
  assert.equal(current().auto_attempts, 1)
  const second = await stopCleanup(root, { session_id: SESSION, stop_hook_active: true })
  assert.equal(second.continue, false)
  const blocked = current()
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.auto_attempts, 1)
  await resumeCleanup(root, { requestId: pending.id, sessionId: SESSION })
  assert.equal(current().auto_attempts, 1)
  const resumed = await stopCleanup(root, { session_id: SESSION, stop_hook_active: false })
  assert.equal(resumed.continue, false)
  assert.equal(current().auto_attempts, 1)
  assert.deepEqual(otherPersisted(), otherRequestBefore)
  assert.equal(readFileSync(join(root, detailPath(OTHER)), 'utf8'), otherBefore)
})

test('a new user resume instruction permits session handoff without renewing the repair budget', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  await stopCleanup(root, { session_id: SESSION, stop_hook_active: false })
  await stopCleanup(root, { session_id: SESSION, stop_hook_active: true })
  const before = readAfterRestart(root).find((entry) => entry.id === pending.id)
  assert.equal(before.status, 'blocked')
  assert.equal(before.auto_attempts, 1)
  const nextSession = 'new-resuming-session'
  await resumeCleanup(root, {
    requestId: pending.id,
    sessionId: nextSession,
    instructionRef: 'chat:new-user-resume',
  })
  const after = readAfterRestart(root).find((entry) => entry.id === pending.id)
  assert.equal(after.id, before.id)
  assert.equal(after.owner_session, before.owner_session)
  assert.equal(after.auto_attempts, before.auto_attempts)
  assert.equal(after.session_id, nextSession)
})

test('working-tree deletion cannot satisfy committed archive evidence', async (t) => {
  const root = await fixture(t)
  const pending = await request(root)
  removeTarget(root, OWN)
  assertRejected(await evaluateRequest(root, pending))
  await assert.rejects(async () => finishCleanup(root, { requestId: pending.id, sessionId: SESSION }))
  assert.equal((await readRequests(root))[0].id, pending.id)
})

test('request target cannot escape through a symlink to another worktree', async (t) => {
  const root = await fixture(t)
  const outside = mkdtempSync(join(tmpdir(), 'state-cleanup-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  // Keep the target otherwise valid so malformed frontmatter cannot mask a path escape.
  const sentinel = readFileSync(join(root, detailPath(OWN)), 'utf8').replace(/^id: own$/m, 'id: escape')
  writeFileSync(join(outside, 'outside.md'), sentinel)
  symlinkSync(join(outside, 'outside.md'), join(root, 'docs/state/root/escape.md'))
  const text = readFileSync(join(root, INDEX), 'utf8')
  write(root, INDEX, text.replace('## 1. 활성\n', '## 1. 활성\n- [escape] external\n'))
  commit(root, 'seed symlink fixture [id=escape]')
  await assert.rejects(async () => requestCleanup(root, instruction({ targets: ['root/escape'], scope: 'explicit' })))
  assert.equal(readFileSync(join(outside, 'outside.md'), 'utf8'), sentinel)
  assert.deepEqual(await readRequests(root), [])
})
