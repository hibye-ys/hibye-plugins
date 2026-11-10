// STATE_INDEX_SOURCE="frontmatter" — 항목 정본이 detail frontmatter 이고 인덱스는 git 미추적 생성물인 모드.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { finishCleanup, readRequests, requestCleanup, validateCleanupCommit } from './state-cleanup.mjs'
import { cleanupLockPath, readBlobs } from './state-cleanup-store.mjs'
import { checkFrontmatterIndex, detailEntries, entryExists, renderIndex, writeRenderedIndexes } from './state-index.mjs'
import { stateConfig } from './state-config.mjs'

const WIP_CHECK_SCRIPT = fileURLToPath(new URL('../check-state-wip-cap.sh', import.meta.url))
const BRANCH_SYNC_SCRIPT = fileURLToPath(new URL('../check-state-branch-sync.sh', import.meta.url))
const SESSION_SCRIPT = fileURLToPath(new URL('./session-start-state-inject.sh', import.meta.url))
const SNAPSHOT_SCRIPT = fileURLToPath(new URL('./turn-start-state-snapshot.sh', import.meta.url))
const ENGINE_SCRIPT = fileURLToPath(new URL('./state-turn-baseline.mjs', import.meta.url))
const COMMIT_MSG_SCRIPT = fileURLToPath(new URL('./commit-msg-state-check.sh', import.meta.url))
const GLOBAL_SCRIPT = fileURLToPath(new URL('./global-state-hook.sh', import.meta.url))
const STATERC = 'STATE_INDEXES="STATE.md apps/api/STATE.md"\nSTATE_DEFAULT_BRANCH="main"\nSTATE_CLEANUP_ENFORCE="1"\nSTATE_INDEX_SOURCE="frontmatter"\n'
const SESSION = 'fm-session'

function git(root, ...args) {
  return execFileSync('git', ['-c', 'core.excludesfile=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
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

function detail(id, { area = 'root', section = 'active', title = `${id} 제목`, status = `${id} 상태`, owner = 'agent', branch = 'main', touched = '2026-11-01T00:00', extra = '' } = {}) {
  const body = `\n## 현재\n\n${id} 남은 일.\n`
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8)
  const fields = [`id: ${id}`, `area: ${area}`]
  if (section !== null) fields.push(`section: ${section}`)
  if (title !== null) fields.push(`title: ${title}`)
  if (status !== null) fields.push(`status: ${status}`)
  fields.push(`owner: ${owner}`, `branch: ${branch}`, `touched: ${touched}`, `hash: ${hash}`)
  if (extra) fields.push(extra)
  return `---\n${fields.join('\n')}\n---\n${body}`
}

function repo(t, { staterc = STATERC } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'state-fm-test-')))
  t.after(() => {
    try { rmSync(cleanupLockPath(root), { force: true }) } catch { /* fixture never stored */ }
    rmSync(root, { recursive: true, force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'fm fixture')
  git(root, 'config', 'user.email', 'fm@example.invalid')
  git(root, 'config', 'core.hooksPath', '/dev/null')
  write(root, '.staterc', staterc)
  write(root, '.gitignore', '/STATE.md\n/apps/api/STATE.md\n')
  mkdirSync(join(root, 'apps/api'), { recursive: true })
  return root
}

function run(script, root, { args = [], input = '', env = {} } = {}) {
  const result = spawnSync('bash', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: { ...process.env, HOOK_PROJECT_DIR: root, STATE_HOOK_DATA_DIR: `${root}-hook-data`, ...env },
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

test('rendered index groups detail frontmatter by section, newest first, in the manual line shape', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/older.md', detail('older', { touched: '2026-11-01T00:00' }))
  write(root, 'docs/state/root/newer.md', detail('newer', { touched: '2026-11-05T00:00' }))
  write(root, 'docs/state/root/later.md', detail('later', { section: 'next', owner: '-' }))
  write(root, 'docs/state/api/apiwork.md', detail('apiwork', { area: 'api', section: 'unresolved' }))
  const config = stateConfig(root)
  const entries = detailEntries(root, null, config)
  const text = renderIndex('root', entries, config)
  const active = text.slice(text.indexOf('## 1.'), text.indexOf('## 2.'))
  assert.match(active, /- \[newer\] newer 제목 — owner=agent; newer 상태\n- \[older\] older 제목 — owner=agent; older 상태/)
  assert.match(text, /## 2\. 다음 \(활성 끝나면 시작\)\n\n- \[later\] later 제목 — later 상태\n/)
  assert.doesNotMatch(text, /apiwork/)
  assert.match(renderIndex('api', entries, config), /## 4\. 미해결 결정 \(의사결정 필요\)\n\n- \[apiwork\]/)
  assert.equal(entryExists(root, 'root', 'newer', null, config), true)
  assert.equal(entryExists(root, 'root', 'absent', null, config), false)
})

test('the generated index is written only where git does not track it', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/work.md', detail('work'))
  write(root, 'apps/api/STATE.md', '# tracked by mistake\n')
  git(root, 'add', '-f', 'apps/api/STATE.md')
  const written = writeRenderedIndexes(root)
  assert.deepEqual(written, ['STATE.md'])
  assert.match(readFileSync(join(root, 'STATE.md'), 'utf8'), /- \[work\] work 제목/)
  assert.equal(readFileSync(join(root, 'apps/api/STATE.md'), 'utf8'), '# tracked by mistake\n')
  assert.equal(git(root, 'status', '--porcelain', '--', 'STATE.md'), '')
  assert.deepEqual(writeRenderedIndexes(root), [], 'unchanged render is not rewritten')
})

test('missing or invalid index fields are routing breaks; caps, owner and line length still warn', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/notitle.md', detail('notitle', { title: null }))
  write(root, 'docs/state/root/nosect.md', detail('nosect', { section: null }))
  write(root, 'docs/state/root/badsect.md', detail('badsect', { section: 'doing' }))
  write(root, 'docs/state/root/noowner.md', detail('noowner', { owner: '-' }))
  write(root, 'docs/state/root/longline.md', detail('longline', { section: 'next', status: '가'.repeat(220) }))
  write(root, 'docs/state/root/nofm.md', '## 현재\n\nno frontmatter\n')
  for (const n of [1, 2, 3, 4, 5, 6]) write(root, `docs/state/root/cap${n}.md`, detail(`cap${n}`))
  const warnings = checkFrontmatterIndex(root).join('\n')
  assert.match(warnings, /docs\/state\/root\/notitle\.md title 없음 \(라우팅 끊김\)/)
  assert.match(warnings, /docs\/state\/root\/nosect\.md section 없음 \(라우팅 끊김\)/)
  assert.match(warnings, /docs\/state\/root\/badsect\.md section 'doing' 유효값 없음 \(라우팅 끊김\)/)
  assert.match(warnings, /docs\/state\/root\/nofm\.md section 없음 \(라우팅 끊김\)/)
  assert.match(warnings, /noowner\.md — §1 활성인데 유효한 frontmatter owner 없음/)
  assert.match(warnings, /STATE\.md "- \[longline\].*자 \(줄 cap 200자 초과\)/)
  assert.match(warnings, /STATE\.md §1 활성 = 8 \(cap 6 초과\)/)
})

test('a tracked index with hand-written rows is a routing break, not a silently ignored source', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/work.md', detail('work'))
  write(root, 'STATE.md', '# STATE\n\n## 1. 활성\n\n- [work] hand row\n')
  git(root, 'add', '-f', 'STATE.md')
  const warnings = checkFrontmatterIndex(root).join('\n')
  assert.match(warnings, /STATE\.md git 추적 중/)
  assert.match(warnings, /STATE\.md \[work\] 손으로 쓴 인덱스 줄 .*\(라우팅 끊김\)/)
})

test('the repository checker reads frontmatter: no orphan, heading or missing-index warnings', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/work.md', detail('work'))
  write(root, 'docs/state/api/apiwork.md', detail('apiwork', { area: 'api', section: 'next' }))
  commit(root, 'seed [id=work] [id=apiwork]')
  const clean = run(WIP_CHECK_SCRIPT, root, { env: { STATE_CHECK_STRICT: '1' } })
  assert.equal(clean.status, 0, clean.out)
  assert.doesNotMatch(clean.out, /고아|heading 없음|인덱스 소실|라우팅 끊김/)

  write(root, 'docs/state/root/broken.md', detail('broken', { status: null }))
  const broken = run(WIP_CHECK_SCRIPT, root, { env: { STATE_CHECK_STRICT: '1' } })
  assert.equal(broken.status, 1)
  assert.match(broken.out, /WARN: docs\/state\/root\/broken\.md status 없음 \(라우팅 끊김\)/)

  write(root, 'docs/state/root/work.md', detail('work').replace(/hash: \w+/, 'hash: 00000000'))
  assert.match(run(WIP_CHECK_SCRIPT, root).out, /work\.md hash 불일치/)
})

test('branch sync follows active and next sections from frontmatter only', (t) => {
  const root = repo(t)
  write(root, 'README.md', 'x\n')
  write(root, 'docs/state/root/gonebr.md', detail('gonebr', { branch: 'feature/vanished' }))
  write(root, 'docs/state/root/later.md', detail('later', { section: 'future', branch: 'feature/also-gone' }))
  commit(root, 'seed [id=gonebr] [id=later]')
  const { out } = run(BRANCH_SYNC_SCRIPT, root)
  assert.match(out, /docs\/state\/root\/gonebr\.md branch=feature\/vanished — 브랜치 소멸/)
  assert.doesNotMatch(out, /later\.md/)
})

test('session start injects the rendered list and refreshes the untracked local index', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/work.md', detail('work'))
  commit(root, 'seed [id=work]')
  const { status, out } = run(SESSION_SCRIPT, root, { input: JSON.stringify({ session_id: SESSION }) })
  assert.equal(status, 0, out)
  const context = JSON.parse(out).hookSpecificOutput.additionalContext
  assert.match(context, /=== STATE\.md ===\n<!-- 자동 생성/)
  assert.match(context, /- \[work\] work 제목 — owner=agent; work 상태/)
  assert.match(context, /항목 정본은 docs\/state\/<area>\/<id>\.md frontmatter/)
  assert.match(readFileSync(join(root, 'STATE.md'), 'utf8'), /- \[work\]/)
  assert.equal(git(root, 'status', '--porcelain'), '')
})

test('editing a detail through the global stamp hook refreshes the local index', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/work.md', detail('work'))
  commit(root, 'seed [id=work]')
  write(root, 'docs/state/root/work.md', detail('work', { status: '바뀐 상태' }))
  const result = spawnSync('bash', [GLOBAL_SCRIPT, 'stamp'], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, HOOK_PROJECT_DIR: root, STATE_HOOK_DATA_DIR: `${root}-hook-data`, STATE_LEDGER_HOST: 'claude' },
    input: JSON.stringify({ tool_input: { file_path: join(root, 'docs/state/root/work.md') } }),
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(readFileSync(join(root, 'STATE.md'), 'utf8'), /work 제목 — owner=agent; 바뀐 상태/)
})

test('commit tags resolve against frontmatter entries; unknown ids are still reported', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/work.md', detail('work'))
  write(root, 'src/a.ts', 'export const a = 1\n')
  commit(root, 'seed [id=work]')
  const env = { ...process.env, HOOK_PROJECT_DIR: root, STATE_HOOK_DATA_DIR: `${root}-hook-data` }
  const payload = JSON.stringify({ session_id: SESSION })
  assert.equal(spawnSync('bash', [SNAPSHOT_SCRIPT], { cwd: root, env, input: payload }).status, 0)
  write(root, 'src/a.ts', 'export const a = 2\n')
  commit(root, 'work [id=work]')
  write(root, 'src/a.ts', 'export const a = 3\n')
  commit(root, 'work [id=nosuch]')
  const evaluated = JSON.parse(execFileSync(process.execPath, [ENGINE_SCRIPT, 'evaluate'], { cwd: root, env, input: payload, encoding: 'utf8' }))
  assert.deepEqual(evaluated.untaggedCommits, [])
  assert.deepEqual(evaluated.unknownIdCommits.map((c) => c.ids), [['nosuch']])
})

test('removing hand index rows while migrating does not demand every id in the commit message', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/work.md', detail('work'))
  write(root, 'STATE.md', '# STATE\n\n## 1. 활성\n\n- [work] hand row\n- [other] hand row\n')
  git(root, 'add', '-f', 'STATE.md')
  commit(root, 'manual era [id=work]')
  git(root, 'rm', '-q', '--cached', 'STATE.md')
  const message = join(root, '.git', 'MSG')
  writeFileSync(message, 'move STATE rows into frontmatter [id=-]\n')
  const { out } = run(COMMIT_MSG_SCRIPT, root, { args: [message] })
  assert.doesNotMatch(out, /\[id=other\]|\[id=work\]/)
})

test('cleanup in frontmatter mode stores one file per request and finishes after the archive commit', async (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/own.md', detail('own', { extra: `session_id: ${SESSION}` }))
  write(root, 'docs/state/root/keep.md', detail('keep'))
  commit(root, 'seed [id=own] [id=keep]')
  const request = await requestCleanup(root, { sessionId: SESSION, scope: 'explicit', targets: ['root/own'], instructionRef: 'chat:1', instruction: '정리해' })
  const file = `docs/state/.cleanup/${request.id}.json`
  assert.ok(existsSync(join(root, file)))
  assert.equal(git(root, 'status', '--porcelain', '--', 'STATE.md'), '')
  assert.deepEqual((await readRequests(root)).map((r) => r.id), [request.id])
  commit(root, 'record cleanup request [id=-]')

  rmSync(join(root, 'docs/state/root/own.md'))
  git(root, 'add', '-A')
  assert.equal((await validateCleanupCommit(root, { message: 'archive [id=own]' })).ok, true)
  commit(root, 'archive [id=own]')
  await finishCleanup(root, { requestId: request.id, sessionId: SESSION })
  assert.equal(existsSync(join(root, file)), false)
  git(root, 'add', '-A')
  const finished = await validateCleanupCommit(root, { message: 'finish cleanup [id=-]' })
  assert.equal(finished.ok, true, JSON.stringify(finished))
})

test('deleting a frontmatter entry without a retained request is still rejected', async (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/own.md', detail('own'))
  commit(root, 'seed [id=own]')
  rmSync(join(root, 'docs/state/root/own.md'))
  git(root, 'add', '-A')
  const result = await validateCleanupCommit(root, { message: 'archive [id=own]' })
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((v) => v.code === 'CLEANUP_NOT_REQUESTED'), JSON.stringify(result))
})

test('migrating a manual ledger keeps a pending request identical and its manual baseline valid', async (t) => {
  const root = repo(t, { staterc: STATERC.replace('STATE_INDEX_SOURCE="frontmatter"\n', '') })
  write(root, '.gitignore', '')
  write(root, 'STATE.md', '# STATE\n\n## 1. 활성\n\n- [own] old row\n- [keep] kept row\n\n## 2. 다음\n\n## 3. 미래\n\n## 4. 미해결\n')
  write(root, 'apps/api/STATE.md', '# STATE\n\n## 1. 활성\n\n## 2. 다음\n\n## 3. 미래\n\n## 4. 미해결\n')
  const manual = (id) => detail(id, { section: null, title: null, status: null, extra: `session_id: ${SESSION}` })
  write(root, 'docs/state/root/own.md', manual('own'))
  write(root, 'docs/state/root/keep.md', manual('keep'))
  commit(root, 'manual era [id=own] [id=keep]')
  const pending = await requestCleanup(root, { sessionId: SESSION, scope: 'explicit', targets: ['root/own'], instructionRef: 'chat:1', instruction: '정리해' })
  commit(root, 'manual request [id=-]')
  assert.match(git(root, 'show', 'HEAD:STATE.md'), /STATE_CLEANUP_V1/)

  // 이전 커밋: 설정 전환, 행을 frontmatter 로, 인덱스는 추적 해제, 요청은 파일로 (내용 동일).
  write(root, '.staterc', STATERC)
  write(root, '.gitignore', '/STATE.md\n/apps/api/STATE.md\n')
  write(root, 'docs/state/root/own.md', detail('own', { title: 'old row', status: '-', extra: `session_id: ${SESSION}` }))
  write(root, 'docs/state/root/keep.md', detail('keep', { title: 'kept row', status: '-', extra: `session_id: ${SESSION}` }))
  write(root, `docs/state/.cleanup/${pending.id}.json`, `${JSON.stringify({ version: 1, request: pending }, null, 2)}\n`)
  git(root, 'add', '-A')
  git(root, 'rm', '-q', '--cached', 'STATE.md', 'apps/api/STATE.md')
  const migrated = await validateCleanupCommit(root, { message: 'migrate [id=-]' })
  assert.equal(migrated.ok, true, JSON.stringify(migrated))
  commit(root, 'migrate [id=-]')
  assert.deepEqual((await readRequests(root)).map((r) => r.id), [pending.id])

  // 옮기면서 요청을 바꾸면 거부된다.
  write(root, `docs/state/.cleanup/${pending.id}.json`, `${JSON.stringify({ version: 1, request: { ...pending, targets: ['root/keep'] } }, null, 2)}\n`)
  git(root, 'add', '-A')
  const changed = await validateCleanupCommit(root, { message: 'tamper [id=-]' })
  assert.ok(changed.violations.some((v) => v.code === 'REQUEST_CHANGED'), JSON.stringify(changed))
})

test('parallel branches adding, editing and archiving different entries merge without conflicts', (t) => {
  const root = repo(t)
  for (const id of ['alpha', 'beta', 'gamma', 'delta']) write(root, `docs/state/root/${id}.md`, detail(id))
  commit(root, 'seed [id=alpha]')
  git(root, 'checkout', '-q', '-b', 'pr-a')
  write(root, 'docs/state/root/newa.md', detail('newa'))
  write(root, 'docs/state/root/alpha.md', detail('alpha', { status: 'A 가 바꾼 상태' }))
  rmSync(join(root, 'docs/state/root/gamma.md'))
  commit(root, 'pr-a [id=newa]\n\narchive [id=gamma]')
  git(root, 'checkout', '-q', 'main')
  git(root, 'checkout', '-q', '-b', 'pr-b')
  write(root, 'docs/state/root/newb.md', detail('newb'))
  write(root, 'docs/state/root/beta.md', detail('beta', { status: 'B 가 바꾼 상태' }))
  rmSync(join(root, 'docs/state/root/delta.md'))
  commit(root, 'pr-b [id=newb]\n\narchive [id=delta]')
  git(root, 'checkout', '-q', 'main')
  git(root, 'merge', '-q', '--no-ff', '-m', 'merge a', 'pr-a')
  git(root, 'merge', '-q', '--no-ff', '-m', 'merge b', 'pr-b')
  assert.equal(git(root, 'diff', '--name-only', '--diff-filter=U'), '')
  assert.deepEqual(readdirSync(join(root, 'docs/state/root')).sort(), ['alpha.md', 'beta.md', 'newa.md', 'newb.md'])
  const text = renderIndex('root', detailEntries(root), stateConfig(root))
  assert.match(text, /A 가 바꾼 상태/)
  assert.match(text, /B 가 바꾼 상태/)
})

test('batched blob reads keep order, multi-byte text and missing objects', (t) => {
  const root = repo(t)
  write(root, 'a.md', '한글 첫 줄\n둘째 줄\n')
  write(root, 'b.md', '')
  commit(root, 'blobs [id=-]')
  write(root, 'a.md', 'staged 한글\n')
  git(root, 'add', 'a.md')
  assert.deepEqual(readBlobs(root, ['HEAD:a.md', 'HEAD:missing.md', 'HEAD:b.md', ':a.md']), ['한글 첫 줄\n둘째 줄\n', null, '', 'staged 한글\n'])
})

// 유령 브랜치 검사는 이 checkout 작업 트리·기본 브랜치 트리·그 브랜치 자기 트리 어디서든 등재를 인정한다.
function ghostFixture(t) {
  const root = repo(t)
  write(root, 'README.md', 'x\n')
  write(root, 'docs/state/root/basereg.md', detail('basereg', { branch: 'feat/base-reg' }))
  // 본문 서사의 언급은 등재가 아니다 (frontmatter 밖에 `branch:` 줄이 있어도).
  write(root, 'docs/state/root/bodyref.md', `${detail('bodyref')}branch: feat/body-only\n- feat/body-own 은 아직 정해지지 않았다\n`)
  commit(root, 'seed [id=-]')
  const branch = (name, files) => {
    git(root, 'checkout', '-q', '-b', name, 'main')
    for (const [path, text] of Object.entries(files)) write(root, path, text)
    commit(root, `${name} work [id=-]`)
    git(root, 'checkout', '-q', 'main')
  }
  branch('feat/base-reg', { 'a.txt': 'a\n' })
  branch('feat/self', { 'docs/state/root/selfreg.md': detail('selfreg', { branch: 'feat/self' }) })
  branch('feat/body-only', { 'b.txt': 'b\n' })
  branch('feat/body-own', { 'docs/state/root/ownbody.md': `${detail('ownbody', { branch: 'main' })}branch: feat/body-own\n` })
  branch('feat/unreg', { 'c.txt': 'c\n' })
  return root
}

const ghostLines = (out) => out.split('\n').filter((line) => line.includes('유령 브랜치')).sort()
const ghostLine = (name) => `WARN: 유령 브랜치 ${name} — main 에 없는 커밋 1개, STATE 미등재 (등재 또는 폐기 결정 필요)`

test('ghost branch check counts a branch registered in its own tree or in the base tree', (t) => {
  const root = ghostFixture(t)
  const { out } = run(BRANCH_SYNC_SCRIPT, root)
  assert.deepEqual(ghostLines(out), [ghostLine('feat/body-only'), ghostLine('feat/body-own'), ghostLine('feat/unreg')])
})

test('ghost branch check from another checkout: a base-tree registration survives a changed pointer here', (t) => {
  const root = ghostFixture(t)
  git(root, 'checkout', '-q', '-b', 'work', 'main')
  write(root, 'docs/state/root/basereg.md', detail('basereg', { branch: 'feat/moved' }))
  write(root, 'docs/state/root/workitem.md', detail('workitem', { branch: 'work' }))
  commit(root, 'move pointer [id=-]')
  const { out } = run(BRANCH_SYNC_SCRIPT, root)
  // feat/base-reg 는 기본 브랜치 트리에만 이름이 남았고, work 는 이 checkout 작업 트리가 등재한다 — 둘 다 유령이 아니다.
  assert.deepEqual(ghostLines(out), [ghostLine('feat/body-only'), ghostLine('feat/body-own'), ghostLine('feat/unreg')])
  assert.match(out, /basereg\.md branch=feat\/moved — 브랜치 소멸/)
})

test('ghost branch check reports only the lookup failure, not every candidate, when the registration lookup fails', (t) => {
  const root = ghostFixture(t)
  // git 래퍼: 등재 조회가 쓰는 `cat-file --batch` 만 실패시킨다 (검사 스크립트 자체는 cat-file 을 쓰지 않는다).
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const shimDir = `${root}-shim`
  mkdirSync(shimDir, { recursive: true })
  t.after(() => rmSync(shimDir, { recursive: true, force: true }))
  writeFileSync(join(shimDir, 'git'), `#!/bin/sh\nif [ "$1" = cat-file ]; then echo 'injected cat-file failure' >&2; exit 3; fi\nexec "${realGit}" "$@"\n`, { mode: 0o755 })
  const { out } = run(BRANCH_SYNC_SCRIPT, root, { env: { PATH: `${shimDir}:${process.env.PATH}` } })
  assert.match(out, /WARN: STATE 브랜치 등재 조회 실패/)
  assert.deepEqual(ghostLines(out), [])
})

test('state-index branches lists frontmatter branch values per revision, ignoring missing revisions', (t) => {
  const root = ghostFixture(t)
  const revs = ['refs/heads/main', 'refs/heads/feat/self', 'refs/heads/feat/base-reg', 'refs/heads/missing']
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./state-index.mjs', import.meta.url)), 'branches', ...revs.flatMap((rev) => ['--rev', rev])], {
    cwd: root, encoding: 'utf8', env: { ...process.env, HOOK_PROJECT_DIR: root },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split('\n').sort(), [
    'refs/heads/feat/base-reg\tfeat/base-reg',
    'refs/heads/feat/base-reg\tmain',
    'refs/heads/feat/self\tfeat/base-reg',
    'refs/heads/feat/self\tfeat/self',
    'refs/heads/feat/self\tmain',
    'refs/heads/main\tfeat/base-reg',
    'refs/heads/main\tmain',
  ].sort())
})
