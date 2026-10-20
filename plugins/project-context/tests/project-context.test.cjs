'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync, spawnSync } = require('node:child_process')
const runtime = require('../scripts/project-context.cjs')
const SCRIPT = path.resolve(__dirname, '../scripts/project-context.cjs')
function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
function fixture(t, config = { schema_version: 1, memory: { directory: 'docs/memory', index: 'MEMORY.md' }, intent: { directory: 'intent' } }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'project-context-test-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const root = path.join(base, "primary space's")
  fs.mkdirSync(root)
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'fixture@example.invalid'); git(root, 'config', 'user.name', 'Fixture')
  fs.mkdirSync(path.join(root, 'docs/memory'), { recursive: true }); fs.mkdirSync(path.join(root, 'intent'))
  fs.writeFileSync(path.join(root, 'docs/memory/MEMORY.md'), '[Shared lesson](detail.md)\n')
  fs.writeFileSync(path.join(root, 'docs/memory/detail.md'), 'PRIVATE_MEMORY_DETAIL_MUST_STAY_LAZY')
  fs.writeFileSync(path.join(root, 'intent/work.md'), '# Work\n설명: Fixture decisions — implementation\n\n## C1 · Decision\n- 규칙: PRIVATE_RULE_MUST_STAY_LAZY\n- 갱신: 2026-10-20\n')
  if (config) fs.writeFileSync(path.join(root, '.project-context.json'), JSON.stringify(config))
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture')
  return { base, root }
}
const context = options => runtime.buildSessionStartContext(options).hookSpecificOutput.additionalContext

test('primary memory/current intent across linked worktree, subdir and polluted Git env', t => {
  const { root, base } = fixture(t)
  const linked = path.join(base, "linked space's")
  git(root, 'worktree', 'add', '-qb', 'fixture-linked', linked)
  fs.mkdirSync(path.join(linked, 'sub dir'))
  fs.writeFileSync(path.join(linked, 'intent/work.md'), '# Work\n설명: Linked current decisions\n## C1 · Current\n- 규칙: PRIVATE_LINKED_RULE\n- 갱신: 2026-10-20\n')
  fs.writeFileSync(path.join(linked, 'docs/memory/MEMORY.md'), 'WRONG_LOCAL_MEMORY')
  const env = { ...process.env, GIT_DIR: '/missing/poison', GIT_COMMON_DIR: '/bad', GIT_WORK_TREE: root, GIT_INDEX_FILE: '/bad' }
  const memory = runtime.resolveProjectMemory({ repoRoot: path.join(linked, 'sub dir'), env })
  assert.equal(memory.directory, path.join(fs.realpathSync(root), 'docs/memory'))
  assert.equal(memory.checkout_root, fs.realpathSync(linked))
  const text = context({ repoRoot: linked, env })
  assert.match(text, /Linked current decisions/); assert.doesNotMatch(text, /Fixture decisions|PRIVATE_|WRONG_LOCAL_MEMORY/)
  assert.match(text, /index_sha256/)
})
test('independent clone has independent memory', t => {
  const { root, base } = fixture(t)
  const clone = path.join(base, 'clone'); git(base, 'clone', '-q', root, clone)
  assert.equal(runtime.resolveProjectMemory({ repoRoot: clone }).primary_checkout, fs.realpathSync(clone))
})
test('missing primary index never falls back to linked copy; failure is visible', t => {
  const { root, base } = fixture(t); const linked = path.join(base, 'linked')
  git(root, 'worktree', 'add', '-qb', 'linked', linked)
  fs.unlinkSync(path.join(root, 'docs/memory/MEMORY.md'))
  const text = context({ repoRoot: linked })
  assert.match(text, /PROJECT_CONTEXT_FAILED/); assert.doesNotMatch(text, /index_sha256/)
  assert.match(text, /Fixture decisions/)
  let out = ''; assert.equal(runtime.runSessionStartContextCli({ repoRoot: linked, host: 'codex', input: {}, argv: ['session-start'], writeStdout: x => out += x }), 0)
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /PROJECT_CONTEXT_FAILED/)
})
test('all four events and hosts keep memory and intent bodies lazy; Claude native index never duplicated', t => {
  const { root } = fixture(t)
  for (const host of ['codex', 'claude', 'muse', 'antigravity']) for (const event of runtime.PROJECT_CONTEXT_EVENTS) {
    const text = context({ repoRoot: root, host, event })
    assert.match(text, /PROJECT_MEMORY/); assert.match(text, /Fixture decisions/)
    assert.doesNotMatch(text, /PRIVATE_|\[Shared lesson\]/)
    assert.equal(text.includes('Before relevant work, read this shared memory index'), host !== 'claude')
    assert.match(text, new RegExp(`Session event: ${event}`))
  }
})
test('optional intent and diagnostic failures retain memory pointer', t => {
  const { root } = fixture(t)
  const text = context({ repoRoot: root, intentContext() { throw new Error('intent offline') }, diagnostics() { throw new Error('diagnostic offline') } })
  assert.match(text, /PROJECT_MEMORY/); assert.match(text, /INTENT_CONTEXT_FAILED/); assert.match(text, /DIAGNOSTIC_FAILED/)
  assert.doesNotMatch(text, /PROJECT_CONTEXT_FAILED/)
})
test('unrelated Git and nonGit projects no-op; opted-in nonGit and bare are unsupported', t => {
  const { root, base } = fixture(t, null)
  assert.equal(context({ repoRoot: root }), '')
  const plain = path.join(base, 'plain'); fs.mkdirSync(plain)
  assert.equal(context({ repoRoot: plain }), '')
  fs.writeFileSync(path.join(plain, '.project-context.json'), '{}')
  assert.throws(() => runtime.loadProjectContextConfig({ repoRoot: plain }), /Git checkout required/)
  const bare = path.join(base, 'bare.git'); git(base, 'init', '--bare', '-q', bare)
  fs.writeFileSync(path.join(bare, '.project-context.json'), '{}')
  assert.throws(() => runtime.loadProjectContextConfig({ repoRoot: bare }), /Git checkout required/)
})
test('malformed, unknown, empty and traversal configs rejected', t => {
  const { root } = fixture(t)
  for (const config of ['{', JSON.stringify({ schema_version: 1, memory: false, intent: false }), JSON.stringify({ schema_version: 1, extra: true, intent: { directory: 'intent' } }), ...['../outside', '/absolute', './intent', 'foo/../intent', 'bad\\path'].map(directory => JSON.stringify({ schema_version: 1, intent: { directory } }))]) {
    fs.writeFileSync(path.join(root, '.project-context.json'), config)
    assert.throws(() => runtime.loadProjectContextConfig({ repoRoot: root }))
  }
})
test('config, intent and memory symlink escapes rejected without leaking content', t => {
  const { root, base } = fixture(t)
  fs.mkdirSync(path.join(base, 'outside')); fs.writeFileSync(path.join(base, 'outside/MEMORY.md'), 'OUTSIDE_SECRET')
  fs.renameSync(path.join(root, 'docs/memory'), path.join(root, 'docs/original'))
  fs.symlinkSync(path.join(base, 'outside'), path.join(root, 'docs/memory'))
  assert.match(context({ repoRoot: root }), /PROJECT_CONTEXT_FAILED/)
  assert.doesNotMatch(context({ repoRoot: root }), /OUTSIDE_SECRET/)
  fs.rmSync(path.join(root, 'intent'), { recursive: true }); fs.symlinkSync(path.join(base, 'outside'), path.join(root, 'intent'))
  assert.throws(() => runtime.loadIntentLedger({ repoRoot: root }), /escapes/)
})
test('memory index counts duplicate, missing, nested unindexed and escaping details', t => {
  const { root } = fixture(t)
  fs.mkdirSync(path.join(root, 'docs/memory/nested')); fs.writeFileSync(path.join(root, 'docs/memory/nested/new.md'), 'lazy')
  fs.writeFileSync(path.join(root, 'docs/memory/MEMORY.md'), '[a](detail.md) [dup](detail.md) [missing](missing.md) [escape](../bad.md)')
  const report = runtime.inspectMemoryIndex({ repoRoot: root })
  assert.equal(report.ok, false); assert.deepEqual(report.duplicated, ['detail.md']); assert.deepEqual(report.unindexed, ['nested/new.md']); assert.deepEqual(report.dangling, ['../bad.md', 'missing.md'])
})
test('intent validates descriptions, fields, IDs, dates and emits only descriptions', t => {
  const valid = '설명: A — when\n## C1 · Name\n- 규칙: private\n- 갱신: 2026-10-20\n'
  assert.equal(runtime.parseIntentFile(valid, 'intent/a.md').errors.length, 0)
  for (const bad of ['## Wrong', '## C1 · Missing', valid.replace('설명: A — when\n', ''), valid.replace('2026-10-20', 'bad')]) assert.ok(runtime.parseIntentFile(bad, 'a.md').errors.length)
  const { root } = fixture(t)
  fs.copyFileSync(path.join(root, 'intent/work.md'), path.join(root, 'intent/duplicate.md'))
  assert.match(runtime.loadIntentLedger({ repoRoot: root }).errors.join('\n'), /ID C1/)
  const rendered = runtime.intentSessionContext({ repoRoot: root })
  assert.match(rendered, /intent\/work.md/); assert.doesNotMatch(rendered, /PRIVATE_RULE/)
})
test('CLI chooses input cwd/subdir, explicit overrides, malformed input visible; doctor fails invalid data', t => {
  const { root, base } = fixture(t)
  const result = spawnSync(process.execPath, [SCRIPT, 'session-start', '--host', 'codex'], { cwd: base, input: JSON.stringify({ cwd: root, source: 'compact' }), encoding: 'utf8' })
  assert.equal(result.status, 0); assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /Session event: compact/)
  const malformed = spawnSync(process.execPath, [SCRIPT, 'session-start'], { input: '{', encoding: 'utf8' })
  assert.equal(malformed.status, 0); assert.match(malformed.stdout, /PROJECT_CONTEXT_FAILED/)
  const valid = spawnSync(process.execPath, [SCRIPT, 'doctor', '--project', root], { encoding: 'utf8' }); assert.equal(valid.status, 0)
  fs.unlinkSync(path.join(root, 'docs/memory/detail.md'))
  const invalid = spawnSync(process.execPath, [SCRIPT, 'doctor', '--project', root], { encoding: 'utf8' }); assert.equal(invalid.status, 1)
})
test('Muse response fits byte ceiling, Antigravity source adapter emits lazy context once per session', t => {
  const { root } = fixture(t)
  const muse = spawnSync(process.execPath, [path.resolve(__dirname, '../hooks/muse-session-start.cjs')], { input: JSON.stringify({ cwd: root }), encoding: 'utf8' })
  assert.equal(muse.status, 0); assert.ok(Buffer.byteLength(muse.stdout) <= 16000); assert.match(muse.stdout, /PROJECT_MEMORY/)
  const agScript = path.resolve(__dirname, '../hooks/antigravity-pre-invocation.cjs')
  const sid = `test-${process.pid}-${Date.now()}`
  const first = spawnSync(process.execPath, [agScript], { input: JSON.stringify({ workspacePaths: [root], conversationId: sid, invocationNum: 1 }), encoding: 'utf8' })
  assert.match(JSON.parse(first.stdout).injectSteps[0].ephemeralMessage, /PROJECT_MEMORY/)
  const next = spawnSync(process.execPath, [agScript], { input: JSON.stringify({ workspacePaths: [root], conversationId: sid, invocationNum: 2 }), encoding: 'utf8' })
  assert.deepEqual(JSON.parse(next.stdout), {})
  const resumed = spawnSync(process.execPath, [agScript], { input: JSON.stringify({ cwd: root, conversationId: sid, invocationNum: 3, source: 'resume' }), encoding: 'utf8' })
  assert.match(JSON.parse(resumed.stdout).injectSteps[0].ephemeralMessage, /Session event: resume/)
})

test('linked config drift keeps primary memory authoritative and diagnoses mismatch', t => {
  const { root, base } = fixture(t); const linked = path.join(base, 'linked')
  git(root, 'worktree', 'add', '-qb', 'drift', linked)
  fs.writeFileSync(path.join(linked, '.project-context.json'), JSON.stringify({ schema_version: 1, memory: { directory: 'other-memory', index: 'OTHER.md' }, intent: { directory: 'intent' } }))
  const memory = runtime.resolveProjectMemory({ repoRoot: linked })
  assert.equal(memory.index_path, path.join(fs.realpathSync(root), 'docs/memory/MEMORY.md'))
  assert.match(context({ repoRoot: linked }), /PROJECT_MEMORY_CONFIG_MISMATCH/)
})
test('individual index and intent file symlink escapes fail before reading', t => {
  const { root, base } = fixture(t)
  const outside = path.join(base, 'secret.md'); fs.writeFileSync(outside, 'SECRET_OUTSIDE')
  const index = path.join(root, 'docs/memory/MEMORY.md'); fs.unlinkSync(index); fs.symlinkSync(outside, index)
  assert.match(context({ repoRoot: root }), /PROJECT_CONTEXT_FAILED/)
  const intent = path.join(root, 'intent/work.md'); fs.unlinkSync(intent); fs.symlinkSync(outside, intent)
  assert.match(context({ repoRoot: root }), /INTENT_CONTEXT_FAILED/)
  assert.doesNotMatch(context({ repoRoot: root }), /SECRET_OUTSIDE/)
})
test('large intent descriptions and file count stay bounded with core pointer and requery marker', t => {
  const { root } = fixture(t)
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(root, `intent/area${i}.md`), `설명: ${'가'.repeat(2000)}\n## A${i} · Area\n- 규칙: SECRET_BODY\n- 갱신: 2026-10-20\n`)
  const text = context({ repoRoot: root, diagnostics() { throw new Error('optional source offline') } })
  assert.match(text, /PROJECT_CONTEXT_DIAGNOSTIC_FAILED/)
  assert.ok(Buffer.byteLength(text) <= 12000); assert.match(text, /PROJECT_MEMORY/); assert.match(text, /PROJECT_CONTEXT_TRUNCATED/); assert.match(text, /doctor/); assert.doesNotMatch(text, /SECRET_BODY/)
})

test('dangling opt-in config is invalid and huge optional diagnostics stay bounded', t => {
  const { root, base } = fixture(t)
  const text = context({ repoRoot: root, diagnostics: () => Array(10000).fill('warning').join('\n') })
  assert.match(text, /PROJECT_MEMORY/); assert.ok(Buffer.byteLength(text) < 5000)
  fs.unlinkSync(path.join(root, '.project-context.json')); fs.symlinkSync(path.join(base, 'missing.json'), path.join(root, '.project-context.json'))
  assert.throws(() => runtime.loadProjectContextConfig({ repoRoot: root }), /dangling symlink/)
})

test('intent directory and malformed primary intent never erase valid current or linked memory', t => {
  const { root, base } = fixture(t); const linked = path.join(base, 'linked')
  git(root, 'worktree', 'add', '-qb', 'isolated-intent', linked)
  const outside = path.join(base, 'outside'); fs.mkdirSync(outside)
  fs.renameSync(path.join(root, 'intent'), path.join(root, 'intent-original')); fs.symlinkSync(outside, path.join(root, 'intent'))
  for (const target of [root, linked]) {
    const text = context({ repoRoot: target })
    assert.match(text, /PROJECT_MEMORY/); assert.doesNotMatch(text, /PROJECT_CONTEXT_FAILED|PROJECT_MEMORY_ROOT_FAILED/)
    if (target === root) assert.match(text, /INTENT_CONTEXT_FAILED/)
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, '.project-context.json')))
  config.intent = { directory: '../outside', unknown: true }; fs.writeFileSync(path.join(root, '.project-context.json'), JSON.stringify(config))
  assert.match(context({ repoRoot: linked }), /PROJECT_MEMORY/)
  assert.match(context({ repoRoot: root }), /INTENT_CONTEXT_FAILED/)
})
test('Claude native MEMORY.md-only contract rejects custom indexes in doctor and session, while Codex retains support', t => {
  const { root } = fixture(t)
  fs.renameSync(path.join(root, 'docs/memory/MEMORY.md'), path.join(root, 'docs/memory/INDEX.md'))
  const config = JSON.parse(fs.readFileSync(path.join(root, '.project-context.json'))); config.memory.index = 'INDEX.md'
  fs.writeFileSync(path.join(root, '.project-context.json'), JSON.stringify(config))
  assert.equal(runtime.inspectProjectContext({ repoRoot: root }).ok, false)
  assert.equal(runtime.inspectProjectContext({ repoRoot: root, host: 'claude' }).ok, false)
  assert.equal(runtime.inspectProjectContext({ repoRoot: root, host: 'codex' }).ok, true)
  const text = context({ repoRoot: root, host: 'claude' })
  assert.match(text, /CLAUDE_NATIVE_MEMORY_UNSUPPORTED/); assert.doesNotMatch(text, /native_index.*true/)
  assert.match(context({ repoRoot: root, host: 'codex' }), /PROJECT_MEMORY/)
})
test('public direct intent session CLI applies the same budget and requery marker', t => {
  const { root } = fixture(t)
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(root, `intent/large${i}.md`), `설명: ${'한글'.repeat(2000)}\n## Z${i} · Area\n- 규칙: PRIVATE_RULE\n- 갱신: 2026-10-20\n`)
  const result = spawnSync(process.execPath, [SCRIPT, 'intent-session-start', '--project', root], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext
  assert.ok(Buffer.byteLength(text) <= 7000); assert.match(text, /PROJECT_CONTEXT_TRUNCATED/); assert.match(text, /doctor/); assert.doesNotMatch(text, /PRIVATE_RULE/)
})

test('native host proof ignores stale flags in both nesting directions; ambiguous and absent proof fail visibly', t => {
  const { root, base } = fixture(t)
  const runtimeRoot = path.resolve(__dirname, '..')
  const invoke = (env, payload = { hook_event_name: 'SessionStart', session_id: 'current', cwd: root }, args = []) => {
    let output = ''
    runtime.runSessionStartContextCli({ env: { ...process.env, ...env }, input: payload, argv: ['session-start', ...args], writeStdout: text => { output += text } })
    return JSON.parse(output).hookSpecificOutput.additionalContext
  }
  // Claude launched from Codex: current Claude ID replaces the parent ID; inherited Codex plugin root is not this executed snapshot.
  const claude = invoke({ CLAUDE_CODE_SESSION_ID: 'current', CODEX_THREAD_ID: 'parent-codex', CODEX_SESSION_ID: 'parent-codex', PLUGIN_ROOT: base, CLAUDE_PLUGIN_ROOT: runtimeRoot })
  assert.match(claude, /"native_index":true/); assert.doesNotMatch(claude, /Before relevant work, read this shared memory index/)
  // Codex launched from Claude: its current plugin root is authoritative; the inherited Claude identity is for another session.
  const codex = invoke({ CLAUDE_CODE_SESSION_ID: 'parent-claude', CLAUDECODE: '1', PLUGIN_ROOT: runtimeRoot, CLAUDE_PLUGIN_ROOT: runtimeRoot })
  assert.match(codex, /"native_index":false/); assert.match(codex, /Before relevant work, read this shared memory index/)
  assert.match(invoke({ CLAUDE_CODE_SESSION_ID: 'current', PLUGIN_ROOT: runtimeRoot, CLAUDE_PLUGIN_ROOT: runtimeRoot }), /PROJECT_CONTEXT_HOST_AMBIGUOUS/)
  assert.match(invoke({ CLAUDE_CODE_SESSION_ID: 'stale', CODEX_THREAD_ID: 'current', PLUGIN_ROOT: base, CLAUDE_PLUGIN_ROOT: runtimeRoot }), /PROJECT_CONTEXT_HOST_UNRESOLVED/)
  assert.match(invoke({ CLAUDE_CODE_SESSION_ID: 'current', PLUGIN_ROOT: runtimeRoot, CLAUDE_PLUGIN_ROOT: runtimeRoot }, undefined, ['--host', 'codex']), /"native_index":false/)
})
