'use strict'
// T04 adapter tests: Muse hook normalization + truncation, apply_patch
// post-edit extraction, and the Codex/Muse manifests. Helpers are copied
// from work-context.test.cjs (that file stays untouched).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync, spawnSync } = require('node:child_process')
const runtime = require('../scripts/work-context.cjs')

const SCRIPT = path.resolve(__dirname, '../scripts/work-context.cjs')
const MUSE_HOOK = path.resolve(__dirname, '../hooks/muse-hook.cjs')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const SLUG = '2026-11-24-120000-fixture'
const PLAN_REL = `docs/plans/${SLUG}`
const CONFIG = { schema_version: 1, plans: { directory: 'docs/plans' }, memory: { directory: 'docs/memory', index: 'MEMORY.md' }, intent: { directory: 'intent' } }
const TRUNCATED_LINE = 'WORK_CONTEXT_TRUNCATED: 계획 폴더의 inject.md · status.md 와 두 인덱스를 직접 연다'

function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
function fixture(name) { return fs.readFileSync(path.join(FIXTURES, name), 'utf8') }
function sid(tag) { return `wc-${process.pid}-${tag}` }

function writePlan(root, slug, { branch, id = 'FIXTURE-T03', stage = '구현 중', status = '진행' } = {}) {
  const dir = path.join(root, 'docs/plans', slug)
  fs.mkdirSync(dir, { recursive: true })
  let head = fixture('plan/status.md').replace('__BRANCH__', branch)
  if (id !== 'FIXTURE-T03') head = head.replace('작업 id: FIXTURE-T03', `작업 id: ${id}`)
  if (stage !== '구현 중') head = head.replace('지금 단계: 구현 중', `지금 단계: ${stage}`)
  if (status !== '진행') head = head.replace('상태: 진행', `상태: ${status}`)
  fs.writeFileSync(path.join(dir, 'status.md'), head)
  fs.writeFileSync(path.join(dir, 'inject.md'), fixture('plan/inject.md'))
  return dir
}

function makeRepo(t, { branch = 'fixture-branch', config = CONFIG, plan = true, planBranch = branch, slug = SLUG } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'work-context-test-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const records = fs.mkdtempSync(path.join(os.tmpdir(), 'work-context-records-'))
  t.after(() => fs.rmSync(records, { recursive: true, force: true }))
  const root = path.join(base, 'repo')
  fs.mkdirSync(root)
  git(root, 'init', '-q', '-b', branch)
  git(root, 'config', 'user.email', 'fixture@example.invalid')
  git(root, 'config', 'user.name', 'Fixture')
  if (config) fs.writeFileSync(path.join(root, '.work-context.json'), JSON.stringify(config))
  fs.mkdirSync(path.join(root, 'docs/plans'), { recursive: true })
  if (plan) writePlan(root, slug, { branch: planBranch })
  fs.mkdirSync(path.join(root, 'docs/memory'), { recursive: true })
  fs.writeFileSync(path.join(root, 'docs/memory/MEMORY.md'), fixture('memory/MEMORY.md'))
  fs.writeFileSync(path.join(root, 'docs/memory/detail.md'), fixture('memory/detail.md'))
  fs.writeFileSync(path.join(root, 'docs/memory/other.md'), fixture('memory/other.md'))
  fs.mkdirSync(path.join(root, 'intent'), { recursive: true })
  fs.writeFileSync(path.join(root, 'intent/work.md'), fixture('intent/work.md'))
  return { base, root, records, env: { ...process.env, CLAUDE_PLUGIN_DATA: records } }
}

function hook(repo, mode, input, extraEnv = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, mode], { input: JSON.stringify(input), encoding: 'utf8', env: { ...repo.env, ...extraEnv } })
  assert.equal(result.status, 0, `mode ${mode} exited ${result.status}: ${result.stderr}`)
  return result
}

// Muse never sets CLAUDE_PLUGIN_DATA; mirror production by isolating the
// runtime-default record directory in a fresh XDG cache per test.
function museEnv(t, repo) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'work-context-muse-cache-'))
  t.after(() => fs.rmSync(cache, { recursive: true, force: true }))
  const env = { ...repo.env, XDG_CACHE_HOME: cache }
  delete env.CLAUDE_PLUGIN_DATA
  return env
}

function hookMuse(mode, input, env) {
  const result = spawnSync(process.execPath, [MUSE_HOOK, mode], { input: JSON.stringify(input), encoding: 'utf8', env })
  assert.equal(result.status, 0, `muse mode ${mode} exited ${result.status}: ${result.stderr}`)
  return result
}

function output(result) {
  assert.ok(result.stdout.length > 0, 'expected hook JSON on stdout')
  return JSON.parse(result.stdout).hookSpecificOutput
}

const SHORT_HOME = ['WORK_CONTEXT short · 목표: 픽스처 목표 첫 줄이다.', ...runtime.CHECKLIST].join('\n')

test('a) muse-hook session-start normalizes sessionID+workspacePaths and ignores CLAUDE_PROJECT_DIR', t => {
  const repo = makeRepo(t)
  const other = makeRepo(t, { branch: 'other-branch' })
  const otherStatus = path.join(other.root, PLAN_REL, 'status.md')
  fs.writeFileSync(otherStatus, fs.readFileSync(otherStatus, 'utf8').replace('작업 id: FIXTURE-T03', '작업 id: OTHER-PLAN'))
  const env = { ...museEnv(t, repo), CLAUDE_PROJECT_DIR: other.root }
  const sessionID = sid('muse-a')
  const full = output(hookMuse('session-start', { sessionID, workspacePaths: [repo.root], hook_event_name: 'SessionStart', source: 'startup' }, env))
  assert.equal(full.hookEventName, 'SessionStart')
  assert.match(full.additionalContext, /WORK_CONTEXT full/)
  assert.ok(full.additionalContext.includes('작업 id: FIXTURE-T03'), 'right repo plan injected')
  assert.ok(!full.additionalContext.includes('OTHER-PLAN'), 'CLAUDE_PROJECT_DIR repo ignored')
  assert.ok(full.additionalContext.includes(`checkout: ${fs.realpathSync(repo.root)}`))
  const short = output(hookMuse('turn', { sessionID, workspacePaths: [repo.root], hook_event_name: 'UserPromptSubmit' }, env))
  assert.equal(short.hookEventName, 'UserPromptSubmit')
  assert.equal(short.additionalContext, SHORT_HOME)
})

test('b) muse-hook truncates an over-budget envelope to valid JSON ending with the TRUNCATED line', t => {
  const repo = makeRepo(t)
  // A huge inject.md forces the 9000-char hard slice even after both indexes
  // shorten; Korean text then exceeds the 16000-byte Muse stdout ceiling.
  const injectPath = path.join(repo.root, PLAN_REL, 'inject.md')
  const big = Array.from({ length: 600 }, (_, i) => `목표 줄 ${i} — ${'가'.repeat(40)}`).join('\n')
  fs.writeFileSync(injectPath, fs.readFileSync(injectPath, 'utf8').replace('픽스처 목표 둘째 줄이다.', `픽스처 목표 둘째 줄이다.\n${big}`))
  const result = hookMuse('session-start', { sessionID: sid('muse-b'), workspacePaths: [repo.root], hook_event_name: 'SessionStart', source: 'startup' }, museEnv(t, repo))
  assert.ok(result.stdout.length > 0, 'expected hook JSON on stdout')
  assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= 16000, `envelope is ${Buffer.byteLength(result.stdout, 'utf8')} bytes`)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.ok(parsed.hookSpecificOutput.additionalContext.endsWith(TRUNCATED_LINE), 'truncation marker is the last line')
})

test('c) post-edit understands apply_patch tool_input', t => {
  const repo = makeRepo(t)
  const session_id = sid('c-apply')
  const base = { session_id, cwd: repo.root, hook_event_name: 'PostToolUse' }
  hook(repo, 'session-start', { session_id, cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' })
  const patchFor = (file) => ({ command: ['apply_patch', `*** Begin Patch\n*** Update File: ${file}\n@@ -1 +1 @@\n-old\n+new\n*** End Patch`] })
  const postEdit = (tool_input) => hook(repo, 'post-edit', { ...base, tool_name: 'apply_patch', tool_input })
  assert.equal(postEdit(patchFor(`${PLAN_REL}/status.md`)).stdout, '', 'unchanged plan file prints nothing')
  const statusPath = path.join(repo.root, PLAN_REL, 'status.md')
  const injectAbs = path.join(repo.root, PLAN_REL, 'inject.md')
  fs.writeFileSync(statusPath, fs.readFileSync(statusPath, 'utf8').replace('지금 단계: 구현 중', '지금 단계: 검증 중'))
  const full = output(postEdit(patchFor(`${PLAN_REL}/status.md`)))
  assert.equal(full.hookEventName, 'PostToolUse')
  assert.match(full.additionalContext, /WORK_CONTEXT full/)
  assert.ok(full.additionalContext.includes('지금 단계: 검증 중'))
  assert.equal(postEdit(patchFor('src/other.js')).stdout, '', 'patch touching another file prints nothing')
  // Remaining candidate shapes resolve the same way.
  fs.writeFileSync(injectAbs, `${fs.readFileSync(injectAbs, 'utf8')}\n추가 줄이다.\n`)
  const added = output(postEdit({ command: ['apply_patch', `*** Begin Patch\n*** Add File: ${PLAN_REL}/inject.md\n@@\n+추가 줄이다.\n*** End Patch`] }))
  assert.match(added.additionalContext, /WORK_CONTEXT full/)
  fs.writeFileSync(statusPath, fs.readFileSync(statusPath, 'utf8').replace('지금 단계: 검증 중', '지금 단계: 마무리 중'))
  const moved = output(postEdit({ output: [`*** Begin Patch\n*** Move to: ${PLAN_REL}/status.md\n*** End Patch`] }))
  assert.match(moved.additionalContext, /WORK_CONTEXT full/)
  fs.writeFileSync(injectAbs, `${fs.readFileSync(injectAbs, 'utf8')}\n둘째 추가 줄이다.\n`)
  const viaPath = output(postEdit({ path: injectAbs }))
  assert.match(viaPath.additionalContext, /WORK_CONTEXT full/)
  assert.equal(postEdit({ notebook_path: path.join(repo.root, 'notebooks/other.ipynb') }).stdout, '', 'unrelated notebook prints nothing')
  // hooks.json must route Codex apply_patch calls to post-edit.
  const hooksJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../hooks/hooks.json'), 'utf8'))
  const matcher = hooksJson.hooks.PostToolUse[0].matcher
  assert.ok(matcher.split('|').includes('apply_patch'), `matcher lacks apply_patch: ${matcher}`)
})

test('d) codex and muse manifests parse with the claude plugin name and version', () => {
  const dir = path.resolve(__dirname, '..')
  const claude = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8'))
  const codex = JSON.parse(fs.readFileSync(path.join(dir, '.codex-plugin/plugin.json'), 'utf8'))
  const muse = JSON.parse(fs.readFileSync(path.join(dir, '.muse-plugin/plugin.json'), 'utf8'))
  for (const manifest of [codex, muse]) {
    assert.equal(manifest.name, 'work-context')
    assert.equal(manifest.version, claude.version)
  }
  assert.equal(codex.skills, './skills/')
  assert.deepEqual(muse.capabilities.hooks.map((h) => [h.event, h.id, h.timeoutMs]), [
    ['SessionStart', 'session-start', 30000],
    ['UserPromptSubmit', 'turn', 15000],
    ['PostToolUse', 'post-edit', 15000],
  ])
  for (const h of muse.capabilities.hooks) assert.deepEqual(h.command, ['node', `hooks/muse-${h.id}.cjs`])
  assert.deepEqual(muse.capabilities.skills, [])
})
