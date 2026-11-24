'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync, spawnSync } = require('node:child_process')
const runtime = require('../scripts/work-context.cjs')

const SCRIPT = path.resolve(__dirname, '../scripts/work-context.cjs')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const SLUG = '2026-11-24-120000-fixture'
const PLAN_REL = `docs/plans/${SLUG}`
const CONFIG = { schema_version: 1, plans: { directory: 'docs/plans' }, memory: { directory: 'docs/memory', index: 'MEMORY.md' }, intent: { directory: 'intent' } }

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

function output(result) {
  assert.ok(result.stdout.length > 0, 'expected hook JSON on stdout')
  return JSON.parse(result.stdout).hookSpecificOutput
}

const SHORT_HOME = ['WORK_CONTEXT short · 목표: 픽스처 목표 첫 줄이다.', ...runtime.CHECKLIST].join('\n')

test('a) session-start startup+compact inject the full text in order', t => {
  const repo = makeRepo(t)
  const session_id = sid('a')
  for (const source of ['startup', 'compact']) {
    const out = output(hook(repo, 'session-start', { session_id, cwd: repo.root, hook_event_name: 'SessionStart', source }))
    assert.equal(out.hookEventName, 'SessionStart')
    const text = out.additionalContext
    assert.match(text, /WORK_CONTEXT full/)
    assert.ok(text.includes(`계획 폴더: ${PLAN_REL}`), 'plan path in header')
    assert.ok(text.includes(`checkout: ${fs.realpathSync(repo.root)}`), 'checkout in header')
    for (const needle of [
      '픽스처 목표 첫 줄이다.', '픽스처 목표 둘째 줄이다.',
      '작업 id: FIXTURE-T03', '맡은 쪽: claude', '지금 단계: 구현 중', '다음 한 가지: 훅 스크립트를 작성한다',
      `(source: ${PLAN_REL}/status.md)`,
      '픽스처 지시 본문이다.', '픽스처 읽을 곳 본문이다.',
      ...runtime.CHECKLIST,
      'intent/work.md', 'W1', '픽스처 운영 결정', '본문은 해당 작업 전에 그 파일을 열어 읽는다.',
      'docs/memory/MEMORY.md', '- [픽스처 교훈](detail.md)', '- [다른 교훈](other.md)', '해당 줄의 상세 파일은 그 작업 전에 연다.',
    ]) assert.ok(text.includes(needle), `missing: ${needle}`)
    assert.doesNotMatch(text, /PRIVATE_/)
    const order = ['## 목표', '## 지금', '## 지시', '## 체크리스트', '## 읽을 곳', '## 운영 결정 인덱스', '## 메모리 인덱스']
    const idx = order.map((h) => text.indexOf(h))
    assert.ok(idx.every((i) => i >= 0), 'all sections present')
    assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'sections in order')
  }
})

test('b) turn right after session-start is exactly the short form', t => {
  const repo = makeRepo(t)
  const session_id = sid('b')
  hook(repo, 'session-start', { session_id, cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' })
  const out = output(hook(repo, 'turn', { session_id, cwd: repo.root, hook_event_name: 'UserPromptSubmit' }))
  assert.equal(out.hookEventName, 'UserPromptSubmit')
  assert.equal(out.additionalContext, SHORT_HOME)
})

test('c) editing inject.md makes the next turn full, then short again', t => {
  const repo = makeRepo(t)
  const session_id = sid('c')
  const base = { session_id, cwd: repo.root }
  hook(repo, 'session-start', { ...base, hook_event_name: 'SessionStart', source: 'startup' })
  assert.equal(output(hook(repo, 'turn', { ...base, hook_event_name: 'UserPromptSubmit' })).additionalContext, SHORT_HOME)
  const injectPath = path.join(repo.root, PLAN_REL, 'inject.md')
  fs.writeFileSync(injectPath, fs.readFileSync(injectPath, 'utf8').replace('픽스처 목표 첫 줄이다.', '> "바뀐 목표 첫 줄이다."'))
  const full = output(hook(repo, 'turn', { ...base, hook_event_name: 'UserPromptSubmit' }))
  assert.match(full.additionalContext, /WORK_CONTEXT full/)
  assert.ok(full.additionalContext.includes('바뀐 목표 첫 줄이다.'))
  const short = output(hook(repo, 'turn', { ...base, hook_event_name: 'UserPromptSubmit' }))
  assert.equal(short.additionalContext, ['WORK_CONTEXT short · 목표: "바뀐 목표 첫 줄이다."', ...runtime.CHECKLIST].join('\n'))
})

test('d) head edit triggers full, table-only edit stays short', t => {
  const repo = makeRepo(t)
  const session_id = sid('d')
  const base = { session_id, cwd: repo.root }
  hook(repo, 'session-start', { ...base, hook_event_name: 'SessionStart', source: 'startup' })
  assert.equal(output(hook(repo, 'turn', { ...base, hook_event_name: 'UserPromptSubmit' })).additionalContext, SHORT_HOME)
  const statusPath = path.join(repo.root, PLAN_REL, 'status.md')
  fs.writeFileSync(statusPath, fs.readFileSync(statusPath, 'utf8').replace('지금 단계: 구현 중', '지금 단계: 검증 중'))
  const full = output(hook(repo, 'turn', { ...base, hook_event_name: 'UserPromptSubmit' }))
  assert.match(full.additionalContext, /WORK_CONTEXT full/)
  assert.ok(full.additionalContext.includes('지금 단계: 검증 중'))
  assert.equal(output(hook(repo, 'turn', { ...base, hook_event_name: 'UserPromptSubmit' })).additionalContext, SHORT_HOME)
  fs.writeFileSync(statusPath, fs.readFileSync(statusPath, 'utf8').replace('| 구현 | 진행 |', '| 구현 | 끝남 |'))
  assert.equal(output(hook(repo, 'turn', { ...base, hook_event_name: 'UserPromptSubmit' })).additionalContext, SHORT_HOME)
})

test('e) post-edit emits full only for changed plan files', t => {
  const repo = makeRepo(t)
  const session_id = sid('e')
  const base = { session_id, cwd: repo.root, hook_event_name: 'PostToolUse' }
  hook(repo, 'session-start', { session_id, cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' })
  const injectAbs = path.join(repo.root, PLAN_REL, 'inject.md')
  const edit = (file_path) => hook(repo, 'post-edit', { ...base, tool_name: 'Edit', tool_input: { file_path } })
  assert.equal(edit(injectAbs).stdout, '', 'unchanged plan file prints nothing')
  fs.writeFileSync(injectAbs, fs.readFileSync(injectAbs, 'utf8').replace('픽스처 지시 본문이다.', '바뀐 지시 본문이다.'))
  const full = output(edit(injectAbs))
  assert.equal(full.hookEventName, 'PostToolUse')
  assert.match(full.additionalContext, /WORK_CONTEXT full/)
  assert.ok(full.additionalContext.includes('바뀐 지시 본문이다.'))
  assert.equal(edit(path.join(repo.root, 'src/other.js')).stdout, '', 'unrelated file prints nothing')
  assert.equal(edit(injectAbs).stdout, '', 'no further change prints nothing')
})

test('f) missing config prints nothing', t => {
  const repo = makeRepo(t, { config: null, plan: false })
  const session_id = sid('f')
  assert.equal(hook(repo, 'session-start', { session_id, cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' }).stdout, '')
  assert.equal(hook(repo, 'turn', { session_id, cwd: repo.root, hook_event_name: 'UserPromptSubmit' }).stdout, '')
  assert.equal(hook(repo, 'post-edit', { session_id, cwd: repo.root, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(repo.root, 'x.md') } }).stdout, '')
})

test('g) branch match wins, 끝남 ignored, pointer overrides', t => {
  const repo = makeRepo(t, { branch: 'g-branch', plan: false })
  const session_id = sid('g')
  const start = () => output(hook(repo, 'session-start', { session_id, cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' })).additionalContext
  writePlan(repo.root, '2026-11-24-100000-a', { branch: 'g-branch', id: 'PLAN-A' })
  writePlan(repo.root, '2026-11-24-110000-b', { branch: 'other-branch', id: 'PLAN-B' })
  assert.ok(start().includes('PLAN-A'))
  assert.ok(!start().includes('PLAN-B'))
  const statusA = path.join(repo.root, 'docs/plans/2026-11-24-100000-a/status.md')
  fs.writeFileSync(statusA, fs.readFileSync(statusA, 'utf8').replace('상태: 진행', '상태: 끝남'))
  assert.ok(start().includes('이 브랜치(g-branch)에 맡은 계획 폴더가 없다'))
  const gitDir = git(repo.root, 'rev-parse', '--absolute-git-dir')
  fs.writeFileSync(path.join(gitDir, 'work-context-active'), 'docs/plans/2026-11-24-110000-b\n')
  assert.ok(start().includes('PLAN-B'))
})

test('h) worktree cwd wins over CLAUDE_PROJECT_DIR', t => {
  const repo = makeRepo(t, { branch: 'h-main', plan: false })
  writePlan(repo.root, '2026-11-24-100000-main', { branch: 'h-main', id: 'MAIN-PLAN' })
  git(repo.root, 'add', '.')
  git(repo.root, 'commit', '-qm', 'fixture')
  const linked = path.join(repo.base, 'linked')
  git(repo.root, 'worktree', 'add', '-qb', 'h-work', linked)
  const wtStatus = path.join(linked, 'docs/plans/2026-11-24-100000-main/status.md')
  fs.writeFileSync(wtStatus, fs.readFileSync(wtStatus, 'utf8').replace('작업 id: MAIN-PLAN', '작업 id: WT-PLAN').replace('브랜치: h-main', '브랜치: h-work'))
  const out = output(hook(repo, 'session-start', { session_id: sid('h'), cwd: linked, hook_event_name: 'SessionStart', source: 'startup' }, { CLAUDE_PROJECT_DIR: repo.root }))
  assert.ok(out.additionalContext.includes('WT-PLAN'))
  assert.ok(!out.additionalContext.includes('MAIN-PLAN'))
  assert.ok(out.additionalContext.includes(`checkout: ${fs.realpathSync(linked)}`))
})

test('i) no plan folder keeps checklist, indexes and the missing-plan line', t => {
  const repo = makeRepo(t, { plan: false })
  const out = output(hook(repo, 'session-start', { session_id: sid('i'), cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' }))
  const text = out.additionalContext
  for (const line of runtime.CHECKLIST) assert.ok(text.includes(line))
  assert.ok(text.includes('intent/work.md'))
  assert.ok(text.includes('- [픽스처 교훈](detail.md)'))
  assert.ok(text.includes('이 브랜치(fixture-branch)에 맡은 계획 폴더가 없다. 일을 시작하면 work-context 스킬대로 계획 폴더를 만든다.'))
  assert.ok(!text.includes('## 목표'))
  assert.ok(!text.includes('## 지금'))
})

test('j) over-budget output shortens memory first, then intent', t => {
  const repo = makeRepo(t)
  const lines = ['# 메모리 인덱스', '']
  for (let i = 0; i < 600; i++) lines.push(`- [교훈 ${i} — 설명이 조금 길다](detail-${i}.md)`)
  fs.writeFileSync(path.join(repo.root, 'docs/memory/MEMORY.md'), lines.join('\n'))
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(repo.root, `intent/area${i}.md`), `설명: 영역 ${i} — ${'가'.repeat(400)}\n\n## A${i} · 영역\n- 규칙: SECRET_BODY_${i}\n- 갱신: 2026-11-20\n`)
  }
  const out = output(hook(repo, 'session-start', { session_id: sid('j'), cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' }))
  const text = out.additionalContext
  assert.ok(text.length <= 9000, `full text is ${text.length} chars`)
  assert.ok(text.includes('메모리 인덱스가 길어 줄였다 — docs/memory/MEMORY.md 를 직접 연다'))
  assert.ok(text.includes('운영 결정 인덱스가 길어 줄였다 — intent 를 직접 연다'))
  assert.ok(!text.includes('교훈 599'))
  assert.doesNotMatch(text, /SECRET_BODY/)
})

test('render prints text only and never touches records', t => {
  const repo = makeRepo(t)
  const full = spawnSync(process.execPath, [SCRIPT, 'render', '--mode', 'full', '--cwd', repo.root], { encoding: 'utf8', env: repo.env })
  assert.equal(full.status, 0)
  assert.ok(full.stdout.includes('WORK_CONTEXT full'))
  assert.throws(() => JSON.parse(full.stdout))
  const short = spawnSync(process.execPath, [SCRIPT, 'render', '--mode', 'short', '--cwd', repo.root], { encoding: 'utf8', env: repo.env })
  assert.equal(short.status, 0)
  assert.equal(short.stdout.trim(), SHORT_HOME)
  assert.deepEqual(fs.readdirSync(repo.records), [])
})

test('missing files and malformed heads name the file and field', t => {
  const repo = makeRepo(t)
  const statusPath = path.join(repo.root, PLAN_REL, 'status.md')
  fs.writeFileSync(statusPath, fs.readFileSync(statusPath, 'utf8').split('\n').filter((line) => !line.startsWith('다음 한 가지:')).join('\n'))
  fs.unlinkSync(path.join(repo.root, PLAN_REL, 'inject.md'))
  const gitDir = git(repo.root, 'rev-parse', '--absolute-git-dir')
  fs.writeFileSync(path.join(gitDir, 'work-context-active'), `${PLAN_REL}\n`)
  const out = output(hook(repo, 'session-start', { session_id: sid('malformed'), cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' }))
  assert.ok(out.additionalContext.includes(`${PLAN_REL}/status.md`))
  assert.ok(out.additionalContext.includes('다음 한 가지'))
  assert.ok(out.additionalContext.includes(`${PLAN_REL}/inject.md 없음`))
})

test('newest status.md wins and the others are listed', t => {
  const repo = makeRepo(t, { plan: false })
  const a = writePlan(repo.root, '2026-11-24-100000-a', { branch: 'fixture-branch', id: 'PLAN-A' })
  const b = writePlan(repo.root, '2026-11-24-110000-b', { branch: 'fixture-branch', id: 'PLAN-B' })
  fs.utimesSync(path.join(a, 'status.md'), new Date('2026-11-20T00:00:00Z'), new Date('2026-11-20T00:00:00Z'))
  fs.utimesSync(path.join(b, 'status.md'), new Date('2026-11-24T00:00:00Z'), new Date('2026-11-24T00:00:00Z'))
  const out = output(hook(repo, 'session-start', { session_id: sid('newest'), cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' }))
  assert.ok(out.additionalContext.includes('PLAN-B'))
  assert.ok(out.additionalContext.includes('같은 브랜치의 다른 계획 폴더: docs/plans/2026-11-24-100000-a'))
})

test('short output lists 바뀜 lines right after the goal', t => {
  const repo = makeRepo(t)
  const session_id = sid('bakkwim')
  const injectPath = path.join(repo.root, PLAN_REL, 'inject.md')
  fs.writeFileSync(injectPath, ['# 주입 — 픽스처 작업', '', '## 목표', '> "원래 목표"', '> 바뀜: "그건 빼자"', '', '## 지시', '픽스처 지시 본문이다.', '', '## 읽을 곳', '픽스처 읽을 곳 본문이다.', ''].join('\n'))
  hook(repo, 'session-start', { session_id, cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' })
  const out = output(hook(repo, 'turn', { session_id, cwd: repo.root, hook_event_name: 'UserPromptSubmit' }))
  assert.equal(out.additionalContext, ['WORK_CONTEXT short · 목표: "원래 목표"', '바뀜: "그건 빼자"', ...runtime.CHECKLIST].join('\n'))
})

test('missing session_id always yields full; invalid config fails visibly', t => {
  const repo = makeRepo(t)
  const full = output(hook(repo, 'turn', { cwd: repo.root, hook_event_name: 'UserPromptSubmit' }))
  assert.match(full.additionalContext, /WORK_CONTEXT full/)
  fs.writeFileSync(path.join(repo.root, '.work-context.json'), JSON.stringify({ schema_version: 999, plans: { directory: 'docs/plans' } }))
  const failed = output(hook(repo, 'session-start', { session_id: sid('bad'), cwd: repo.root, hook_event_name: 'SessionStart', source: 'startup' }))
  assert.match(failed.additionalContext, /WORK_CONTEXT_FAILED/)
})
