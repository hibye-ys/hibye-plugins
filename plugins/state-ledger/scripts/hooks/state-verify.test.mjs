// 여러 턴 독립 검증 (opt-in) — 별도 로컬 검사 세션이 목표·계획 순서를 지키는지 보고 훅이 판정에 따라 움직인다.
// 검사 세션은 STATE_VERIFY_COMMAND 스텁으로 대체한다(실제 claude/codex 는 부르지 않는다).
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildRunnerCommand,
  claudeCommand,
  extractVerdict,
  mergeTriggers,
  normalizeVerdict,
  selectModel,
  stepChanges,
  transcriptTail,
} from './state-verify.mjs'

const VERIFY = fileURLToPath(new URL('./state-verify.mjs', import.meta.url))
const GLOBAL_SCRIPT = fileURLToPath(new URL('./global-state-hook.sh', import.meta.url))
const FM_STATERC = 'STATE_INDEXES="STATE.md"\nSTATE_DEFAULT_BRANCH="main"\nSTATE_INDEX_SOURCE="frontmatter"\n'
const SESSION = 'verify-session'
const HANDOFF = 'docs/plans/impl-order.md#구현-순서'
const FIELDS_A = {
  goal: '노트 영역 하나로 구현 순서 0→5단계 끝 조건을 순서대로 채운다',
  step: '0~3단계 끝(로컬)',
  next_step: '4단계 CI 판정(끝 조건: 구현 순서 4. CI 연결)',
  handoff: HANDOFF,
}
const FIELDS_B = { ...FIELDS_A, step: '4단계 CI 판정', next_step: '5단계 배포(끝 조건: 구현 순서 5)' }
const FIELDS_C = { ...FIELDS_A, step: '5단계 배포', next_step: '없음(마지막 단계)' }
const ON_TRACK = { verdict: 'on_track', kind: 'none', summary: '계획대로 진행 중', evidence: ['a.js:1'], missing: [] }
const DRIFT_STEP = { verdict: 'drift', kind: 'step_unmet', summary: '3단계 끝 조건(테스트 통과)이 충족되지 않음', evidence: ['docs/plans/impl-order.md:12'], missing: ['테스트 통과 로그', 'CI 연결 확인'] }
const DRIFT_ORDER = { verdict: 'drift', kind: 'order', summary: '4단계를 건너뛰고 5단계 작업을 제안함', evidence: ['transcript'], missing: [] }
const DRIFT_SCOPE = { verdict: 'drift', kind: 'scope', summary: '요청 밖 리팩터링으로 범위가 넓어짐', evidence: ['abc1234'], missing: ['범위 축소'] }
const UNCLEAR = { verdict: 'unclear', kind: 'other', summary: '근거 파일을 읽지 못해 판단 불가', evidence: [], missing: [] }

const sha = (value) => createHash('sha256').update(value).digest('hex')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, { timeout = 10000, interval = 20, what = 'condition' } = {}) {
  const end = Date.now() + timeout
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(interval)
  }
}

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
}

function detail(id, { branch = 'feat/x', fields = FIELDS_A } = {}) {
  const body = `\n## 현재\n\n${id} 남은 일 첫 줄.\n\n## 원장\n\n${id} 결정 WHY.\n`
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8)
  const lines = [`id: ${id}`, 'area: root', 'section: active', `title: ${id} 제목`, `status: ${id} 상태`, 'owner: agent', `branch: ${branch}`, 'touched: 2026-11-01T00:00', `hash: ${hash}`]
  for (const [key, value] of Object.entries(fields)) lines.push(`${key}: ${value}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

// 검사 세션 스텁: prompt(stdin)·모델·환경을 call-N.json 으로 남기고 설정된 출력을 낸다.
const STUB_SOURCE = `import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = process.env.STUB_DIR
const prompt = readFileSync(0, 'utf8')
const n = readdirSync(dir).filter((f) => /^call-\\d+\\.json$/.test(f)).length + 1
const found = prompt.match(/(\\/[^\\s]+\\.transcript\\.txt)/)
const transcript = found && existsSync(found[1]) ? readFileSync(found[1], 'utf8') : null
const read = (name, fallback) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : fallback)
writeFileSync(join(dir, 'call-' + n + '.json'), JSON.stringify({
  prompt, transcript, model: process.env.STATE_VERIFY_MODEL_SELECTED, child: process.env.STATE_LEDGER_VERIFY_CHILD ?? null,
  cwd: process.cwd(), claudecode: process.env.CLAUDECODE ?? null, claudeProjectDir: process.env.CLAUDE_PROJECT_DIR ?? null,
}))
const ms = Number(read('sleep', '0'))
if (ms > 0) await new Promise((r) => setTimeout(r, ms))
if (existsSync(join(dir, 'exit'))) {
  process.stderr.write(read('stderr', ''))
  process.exit(Number(read('exit', '1')))
}
process.stdout.write(read('output', ${JSON.stringify(JSON.stringify(ON_TRACK))}))
`

// staterc 추가 줄과 fixture 를 갖춘 저장소. 브랜치 feat/x 가 [notes] 항목을 소유한다.
function setup(t, { staterc = 'STATE_VERIFY="1"\nSTATE_VERIFY_EVERY="0"\n', branch = 'feat/x', itemBranch = 'feat/x', env = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'state-verify-test-')))
  const dataDir = `${root}-hook-data`
  const stubDir = `${root}-stub`
  const jobsDir = join(dataDir, 'verify-jobs')
  t.after(async () => {
    // 분리된 worker 는 job 파일을 마지막에 지운다 — 끝나기 전에 임시 디렉터리를 지우지 않는다.
    await waitFor(() => !existsSync(jobsDir) || readdirSync(jobsDir).every((name) => !name.endsWith('.job.json')), { timeout: 8000 }).catch(() => {})
    for (const dir of [root, dataDir, stubDir]) rmSync(dir, { recursive: true, force: true })
  })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'verify fixture')
  git(root, 'config', 'user.email', 'verify@example.invalid')
  git(root, 'config', 'core.hooksPath', '/dev/null')
  write(root, '.staterc', FM_STATERC + staterc)
  write(root, '.gitignore', '/STATE.md\n')
  write(root, 'README.md', 'fixture\n')
  write(root, 'docs/plans/impl-order.md', '# 구현 순서\n\n## 구현 순서\n\n0~5단계. 3단계 끝 조건: 테스트 통과.\n')
  write(root, 'docs/state/root/notes.md', detail('notes', { branch: itemBranch }))
  commit(root, 'init [id=-]')
  if (branch !== 'main') git(root, 'checkout', '-q', '-b', branch)

  mkdirSync(stubDir)
  const stub = join(stubDir, 'runner.mjs')
  writeFileSync(stub, `#!${process.execPath}\n${STUB_SOURCE}`)
  chmodSync(stub, 0o755)
  const control = {
    sleep: (ms) => writeFileSync(join(stubDir, 'sleep'), String(ms)),
    output: (value) => writeFileSync(join(stubDir, 'output'), typeof value === 'string' ? value : JSON.stringify(value)),
    fail: (code, stderr) => { writeFileSync(join(stubDir, 'exit'), String(code)); writeFileSync(join(stubDir, 'stderr'), stderr) },
    calls: () => readdirSync(stubDir).filter((name) => /^call-\d+\.json$/.test(name)).sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10))
      .map((name) => JSON.parse(readFileSync(join(stubDir, name), 'utf8'))),
  }
  const hookEnv = {
    ...process.env,
    HOOK_PROJECT_DIR: root,
    STATE_HOOK_DATA_DIR: dataDir,
    STATE_VERIFY_COMMAND: stub,
    STUB_DIR: stubDir,
    STATE_LEDGER_HOST: '',
    ...env,
  }
  delete hookEnv.STATE_LEDGER_VERIFY_CHILD
  for (const key of Object.keys(env)) if (env[key] === undefined) delete hookEnv[key]
  const ctx = { root, dataDir, stubDir, jobsDir, stub: control, env: hookEnv }

  ctx.engine = (command, payload = {}, extraEnv = {}) => {
    const result = spawnSync(process.execPath, [VERIFY, command], { cwd: root, encoding: 'utf8', input: JSON.stringify({ session_id: SESSION, ...payload }), env: { ...hookEnv, ...extraEnv } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  ctx.dispatch = (mode, payload = {}, extraEnv = {}) => {
    const result = spawnSync('bash', [GLOBAL_SCRIPT, mode], { cwd: root, encoding: 'utf8', input: JSON.stringify({ session_id: SESSION, ...payload }), env: { ...hookEnv, ...extraEnv } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  ctx.turnStart = (payload = {}) => ctx.engine('turn-start', { prompt: 'x', ...payload })
  ctx.stop = (payload = {}) => ctx.engine('stop', { hook_event_name: 'Stop', stop_hook_active: false, ...payload })
  ctx.setFields = (fields, opts = {}) => write(root, 'docs/state/root/notes.md', detail('notes', { fields, ...opts }))
  ctx.statePath = () => join(dataDir, `verify-${sha(root).slice(0, 16)}-${sha(SESSION).slice(0, 24)}.json`)
  ctx.state = () => JSON.parse(readFileSync(ctx.statePath(), 'utf8'))
  ctx.writeState = (state) => writeFileSync(ctx.statePath(), JSON.stringify(state))
  ctx.results = () => (existsSync(jobsDir) ? readdirSync(jobsDir).filter((name) => name.endsWith('.result.json')) : [])
  ctx.verifyFiles = () => (existsSync(dataDir) ? readdirSync(dataDir).filter((name) => name.startsWith('verify-')) : [])
  ctx.waitCalls = (count) => waitFor(() => ctx.stub.calls().length >= count && ctx.stub.calls(), { what: `${count} stub call(s)` })
  ctx.waitResult = () => waitFor(() => ctx.results().length > 0, { what: 'a result file' })
  // 한 턴: turn-start → step 변경 → Stop. 첫 검사를 시작하고 호출 기록을 돌려준다.
  ctx.launchStepCheck = async (payload = {}, { expectCall = true } = {}) => {
    ctx.turnStart()
    ctx.setFields(FIELDS_B)
    assert.equal(ctx.stop(payload), '')
    if (expectCall) await ctx.waitCalls(1)
    await ctx.waitResult()
  }
  return ctx
}

function transcriptFile(root) {
  const path = join(`${root}-stub`, 'transcript.jsonl')
  const lines = [
    { type: 'user', message: { role: 'user', content: '3단계 끝났으니 4단계 시작해줘 (사용자 지시)' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '네, 3단계를 마쳤고 다음으로 5단계를 제안합니다.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'SECRET-TOOL-OUTPUT' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'SECRET-THINKING' }, { type: 'text', text: 'TAIL-MARKER 마지막 에이전트 문장' }] } },
  ]
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return path
}

// ---------- 꺼짐·범위 ----------

test('off by default: no state file, no output, no spawn even with a step change', async (t) => {
  const ctx = setup(t, { staterc: '' })
  assert.equal(ctx.turnStart(), '')
  ctx.setFields(FIELDS_B)
  write(ctx.root, 'src/a.js', 'x\n')
  commit(ctx.root, 'work [id=notes]')
  assert.equal(ctx.engine('session-start', { source: 'compact' }), '')
  assert.equal(ctx.stop(), '')
  await sleep(150)
  assert.deepEqual(ctx.verifyFiles(), [])
  assert.equal(existsSync(ctx.jobsDir), false)
  assert.equal(ctx.stub.calls().length, 0)

  // 디스패처 경로도 같다: turn-start 는 기존 알림만, 검증 문구는 없다.
  const turn = JSON.parse(ctx.dispatch('turn-start', { prompt: 'x' }))
  assert.doesNotMatch(turn.hookSpecificOutput.additionalContext, /독립 검증/)
  assert.equal(ctx.stub.calls().length, 0)
})

test('STATE_VERIFY="0" and unsupported hosts stay off', async (t) => {
  const ctx = setup(t, { staterc: 'STATE_VERIFY="0"\n' })
  ctx.turnStart()
  ctx.setFields(FIELDS_B)
  assert.equal(ctx.stop(), '')
  const muse = setup(t, { env: { STATE_LEDGER_HOST: 'muse' } })
  muse.turnStart()
  muse.setFields(FIELDS_B)
  assert.equal(muse.stop(), '')
  const antigravity = setup(t, { env: { STATE_LEDGER_HOST: 'antigravity' } })
  antigravity.turnStart()
  antigravity.setFields(FIELDS_B)
  assert.equal(antigravity.stop(), '')
  await sleep(150)
  for (const each of [ctx, muse, antigravity]) {
    assert.deepEqual(each.verifyFiles(), [])
    assert.equal(each.stub.calls().length, 0)
  }
})

test('base branch, detached HEAD and a branch that owns no §1/§2 item are silent', async (t) => {
  const onMain = setup(t, { branch: 'main', itemBranch: 'main' })
  onMain.turnStart()
  onMain.setFields(FIELDS_B, { branch: 'main' })
  assert.equal(onMain.stop(), '')
  assert.deepEqual(onMain.verifyFiles(), [])

  const detached = setup(t)
  git(detached.root, 'checkout', '-q', '--detach')
  detached.turnStart()
  detached.setFields(FIELDS_B)
  assert.equal(detached.stop(), '')
  assert.deepEqual(detached.verifyFiles(), [])

  const other = setup(t, { itemBranch: 'feat/other' })
  assert.equal(other.turnStart(), '')
  assert.equal(other.stop(), '')
  other.setFields(FIELDS_B, { branch: 'feat/other' })
  assert.equal(other.stop(), '')
  await sleep(150)
  assert.deepEqual(other.verifyFiles(), [])
  for (const each of [onMain, detached, other]) assert.equal(each.stub.calls().length, 0)
})

test('a payload without a session id is a no-op', async (t) => {
  const ctx = setup(t)
  const result = spawnSync(process.execPath, [VERIFY, 'stop'], { cwd: ctx.root, encoding: 'utf8', input: '{}', env: ctx.env })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.deepEqual(ctx.verifyFiles(), [])
})

// ---------- 계기 ----------

test('step change at Stop launches one check with the STEP model and a complete prompt', async (t) => {
  const ctx = setup(t)
  assert.equal(ctx.turnStart(), '')
  write(ctx.root, 'src/step3.js', 'export const done = true\n')
  commit(ctx.root, 'finish step 3 [id=notes]')
  ctx.setFields(FIELDS_B)
  const started = Date.now()
  assert.equal(ctx.stop({ transcript_path: transcriptFile(ctx.root) }), '')
  assert.ok(Date.now() - started < 3000)

  const [call, ...rest] = await ctx.waitCalls(1)
  assert.equal(rest.length, 0)
  assert.equal(call.model, 'opus')
  assert.equal(call.child, '1')
  assert.equal(call.cwd, ctx.root)
  assert.match(call.prompt, /^너는 독립 검증자다\. 읽기만 한다\./)
  assert.match(call.prompt, /\[notes\]/)
  assert.ok(call.prompt.includes('step "0~3단계 끝(로컬)" → "4단계 CI 판정"'), 'from → to')
  assert.ok(call.prompt.includes('next_step "4단계 CI 판정(끝 조건: 구현 순서 4. CI 연결)" → "5단계 배포(끝 조건: 구현 순서 5)"'))
  assert.ok(call.prompt.includes(`절차(handoff): ${HANDOFF}`))
  assert.ok(call.prompt.includes('docs/state/root/notes.md'))
  assert.match(call.prompt, /finish step 3 \[id=notes\]/, 'commit log')
  assert.match(call.prompt, /git diff --stat/)
  assert.match(call.prompt, /src\/step3\.js/)
  assert.match(call.prompt, /"verdict":"on_track\|drift\|unclear"/)
  assert.equal(call.prompt.includes('/transcript.jsonl'), false, 'the original transcript path is not handed over')
  // 대화 기록 끝부분: 사용자·에이전트 텍스트만
  assert.match(call.transcript, /사용자: 3단계 끝났으니 4단계 시작해줘/)
  assert.match(call.transcript, /에이전트: 네, 3단계를 마쳤고/)
  assert.match(call.transcript, /TAIL-MARKER/)
  assert.doesNotMatch(call.transcript, /SECRET-TOOL-OUTPUT|SECRET-THINKING/)

  const state = ctx.state()
  assert.equal(state.running.model, 'opus')
  assert.equal(state.running.triggers[0].type, 'step')
  assert.equal(state.lastLaunchHead, git(ctx.root, 'rev-parse', 'HEAD'))
  assert.equal(state.pendingTriggers.length, 0)

  // 끝난 검사는 다음 Stop 에서 거두고, 같은 변경으로 다시 시작하지 않는다.
  await ctx.waitResult()
  assert.equal(ctx.stop(), '')
  const after = ctx.state()
  assert.equal(after.running, null)
  assert.equal(after.verdicts.length, 1)
  assert.equal(after.verdicts[0].verdict, 'on_track')
  assert.equal(ctx.stub.calls().length, 1)
  assert.deepEqual(ctx.results(), [], 'result file is removed once reaped')
  assert.deepEqual(readdirSync(ctx.jobsDir), [], 'job and transcript temp files are cleaned up')
})

test('a branch item that appears with a step during the turn counts as a step change', async (t) => {
  const ctx = setup(t, { itemBranch: 'feat/other' })
  ctx.turnStart()
  ctx.setFields(FIELDS_A, { branch: 'feat/x' }) // 이번 턴에 claim
  assert.equal(ctx.stop(), '')
  const [call] = await ctx.waitCalls(1)
  assert.equal(call.model, 'opus')
  assert.match(call.prompt, /새로 소유한 항목/)
})

test('periodic check runs every N user turns with the regular model and never twice for one turn', async (t) => {
  const ctx = setup(t, { staterc: 'STATE_VERIFY="1"\nSTATE_VERIFY_EVERY="2"\n' })
  ctx.turnStart()
  assert.equal(ctx.stop(), '')
  await sleep(150)
  assert.equal(ctx.stub.calls().length, 0, 'turn 1 is not a multiple of 2')
  ctx.turnStart()
  assert.equal(ctx.stop(), '')
  const [call] = await ctx.waitCalls(1)
  assert.equal(call.model, 'sonnet')
  assert.match(call.prompt, /주기 점검: 사용자 턴 2번째 \(2턴마다\)/)
  await ctx.waitResult()
  assert.equal(ctx.stop(), '', 'a second Stop in the same turn adds nothing')
  assert.equal(ctx.stub.calls().length, 1)
  ctx.turnStart()
  assert.equal(ctx.stop(), '')
  await sleep(150)
  assert.equal(ctx.stub.calls().length, 1, 'turn 3 is not a multiple of 2')
})

test('STATE_VERIFY_EVERY="0" disables periodic checks', async (t) => {
  const ctx = setup(t, { staterc: 'STATE_VERIFY="1"\nSTATE_VERIFY_EVERY="0"\n' })
  for (let turn = 0; turn < 6; turn += 1) {
    ctx.turnStart()
    assert.equal(ctx.stop(), '')
  }
  await sleep(150)
  assert.equal(ctx.stub.calls().length, 0)
  assert.equal(ctx.state().turnCount, 6)
})

test('an invalid STATE_VERIFY_EVERY falls back to 5 and warns once in the Stop message', async (t) => {
  const ctx = setup(t, { staterc: 'STATE_VERIFY="1"\nSTATE_VERIFY_EVERY="soon"\n' })
  ctx.turnStart()
  const first = JSON.parse(ctx.stop())
  assert.match(first.systemMessage, /STATE_VERIFY_EVERY="soon".*기본값 5/)
  ctx.turnStart()
  assert.equal(ctx.stop(), '', 'the warning is shown once')
  for (let turn = 0; turn < 3; turn += 1) { ctx.turnStart(); ctx.stop() }
  await ctx.waitCalls(1) // 5번째 턴 Stop
  assert.match(ctx.stub.calls()[0].prompt, /5턴마다/)
})

test('compaction queues a check that launches at the next Stop, once', async (t) => {
  const ctx = setup(t)
  assert.equal(ctx.engine('session-start', { source: 'startup' }), '')
  assert.deepEqual(ctx.verifyFiles(), [], 'only a compact start is recorded')
  assert.equal(ctx.engine('session-start', { source: 'compact' }), '')
  assert.equal(ctx.state().pendingTriggers[0].type, 'compact')
  ctx.turnStart()
  assert.equal(ctx.stop(), '')
  const [call] = await ctx.waitCalls(1)
  assert.equal(call.model, 'sonnet')
  assert.match(call.prompt, /compaction 직후/)
  assert.match(call.prompt, /대화 기록 없음/)
  assert.equal(call.transcript, null)
  assert.equal(ctx.state().pendingTriggers.length, 0)
  await ctx.waitResult()
  ctx.stop()
  assert.equal(ctx.stub.calls().length, 1)
})

test('configured models, one merged check for several triggers, and the STEP model wins', async (t) => {
  const ctx = setup(t, { staterc: 'STATE_VERIFY="1"\nSTATE_VERIFY_EVERY="1"\nSTATE_VERIFY_MODEL="haiku"\nSTATE_VERIFY_STEP_MODEL="sonnet"\n' })
  ctx.turnStart()
  assert.equal(ctx.stop(), '')
  const [periodic] = await ctx.waitCalls(1)
  assert.equal(periodic.model, 'haiku')
  await ctx.waitResult()
  ctx.stop() // reap
  ctx.engine('session-start', { source: 'compact' })
  ctx.turnStart()
  ctx.setFields(FIELDS_B)
  assert.equal(ctx.stop(), '')
  const calls = await ctx.waitCalls(2)
  assert.equal(calls.length, 2, 'step + periodic + compact => one check')
  assert.equal(calls[1].model, 'sonnet')
  for (const text of ['단계 변경', '주기 점검', 'compaction 직후']) assert.ok(calls[1].prompt.includes(text), text)
})

test('a running check blocks a second launch; the trigger waits and launches after the verdict is reaped', async (t) => {
  const ctx = setup(t)
  ctx.stub.sleep(1500)
  ctx.turnStart()
  ctx.setFields(FIELDS_B)
  assert.equal(ctx.stop(), '')
  await ctx.waitCalls(1)

  ctx.turnStart()
  ctx.setFields(FIELDS_C)
  assert.equal(ctx.stop(), '')
  await sleep(200)
  assert.equal(ctx.stub.calls().length, 1, 'no second check while one is running')
  const queued = ctx.state()
  assert.ok(queued.running)
  assert.equal(queued.pendingTriggers.length, 1)
  assert.equal(queued.pendingTriggers[0].type, 'step')
  assert.equal(queued.pendingTriggers[0].changes[0].to.step, FIELDS_C.step)

  await ctx.waitResult()
  ctx.stub.sleep(0)
  assert.equal(ctx.stop(), '')
  const calls = await ctx.waitCalls(2)
  assert.match(calls[1].prompt, /5단계 배포/)
  const after = ctx.state()
  assert.equal(after.pendingTriggers.length, 0)
  assert.equal(after.verdicts.length, 1)
})

// ---------- 판정 반영 ----------

for (const [name, verdict] of [['step_unmet', DRIFT_STEP], ['order', DRIFT_ORDER]]) {
  test(`drift/${name} blocks the next Stop exactly once`, async (t) => {
    const ctx = setup(t)
    ctx.stub.output(verdict)
    await ctx.launchStepCheck()

    const blocked = JSON.parse(ctx.stop())
    assert.equal(blocked.decision, 'block')
    assert.ok(blocked.reason.includes(verdict.summary))
    for (const missing of verdict.missing) assert.ok(blocked.reason.includes(`- ${missing}`), missing)
    assert.match(blocked.reason, /handoff 의 해당 단계 절과 끝 조건을 다시 읽고 바로잡거나, 계획을 바꿔야 하면 사용자에게 묻고 끝내세요/)
    assert.match(blocked.systemMessage, new RegExp(`STATE 독립 검증.*drift/${name}.*막았습니다`))
    assert.equal(ctx.state().verdicts.at(-1).blocked, true)

    assert.equal(ctx.stop(), '', 'a verdict blocks at most once')
    assert.equal(ctx.stop({ stop_hook_active: true }), '')
    // 막은 판정도 다음 사용자 턴에는 에이전트에게 전달된다.
    const turn = JSON.parse(ctx.dispatch('turn-start', { prompt: 'x' }))
    assert.match(turn.hookSpecificOutput.additionalContext, new RegExp(`판정: drift/${name} — `))
  })
}

test('stop_hook_active never blocks; the verdict stays blockable for the next real Stop', async (t) => {
  const ctx = setup(t)
  ctx.stub.output(DRIFT_STEP)
  await ctx.launchStepCheck()
  assert.equal(ctx.stop({ stop_hook_active: true }), '')
  assert.equal(JSON.parse(ctx.stop()).decision, 'block')
  assert.equal(ctx.stop(), '')
})

for (const [name, verdict] of [['drift/scope', DRIFT_SCOPE], ['unclear', UNCLEAR]]) {
  test(`${name} is reported with a systemMessage only, then delivered once at the next turn start`, async (t) => {
    const ctx = setup(t)
    ctx.stub.output(verdict)
    await ctx.launchStepCheck()

    const reported = JSON.parse(ctx.stop())
    assert.equal(reported.decision, undefined)
    assert.match(reported.systemMessage, new RegExp(`STATE 독립 검증\\(step, opus\\): ${verdict.verdict}/${verdict.kind}`))
    assert.ok(reported.systemMessage.includes(verdict.summary.slice(0, 20)))
    assert.equal(ctx.stop(), '', 'reported once')

    const first = ctx.turnStart()
    assert.ok(first.startsWith('=== STATE 독립 검증 결과 (step, opus) ==='), first)
    assert.ok(first.includes(`판정: ${verdict.verdict}/${verdict.kind} — ${verdict.summary}`))
    if (verdict.missing.length) assert.ok(first.includes(`미충족: ${verdict.missing.join('; ')}`))
    if (verdict.evidence.length) assert.ok(first.includes(`근거: ${verdict.evidence.join('; ')}`))
    assert.match(first, /작업 에이전트가 아닌 별도 검사 세션의 것이다\. 맞으면 바로잡고, 틀렸다고 보면 근거를 들어 사용자에게 알린다\.$/)
    assert.equal(ctx.turnStart(), '', 'delivered once')
  })
}

test('turn-start appends the verdict after the focus reminder through the dispatcher', async (t) => {
  const ctx = setup(t)
  ctx.stub.output(DRIFT_SCOPE)
  await ctx.launchStepCheck()
  const out = JSON.parse(ctx.dispatch('turn-start', { prompt: 'next' }))
  const text = out.hookSpecificOutput.additionalContext
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  assert.ok(text.indexOf('=== STATE 현재 작업') >= 0)
  assert.ok(text.indexOf('=== STATE 독립 검증 결과') > text.indexOf('=== STATE 현재 작업'))
  assert.equal(out.systemMessage, undefined)
  const again = JSON.parse(ctx.dispatch('turn-start', { prompt: 'again' }))
  assert.doesNotMatch(again.hookSpecificOutput.additionalContext, /독립 검증 결과/)
})

test('on_track stays silent everywhere and is never delivered', async (t) => {
  const ctx = setup(t)
  ctx.stub.output(ON_TRACK)
  await ctx.launchStepCheck()
  assert.equal(ctx.stop(), '')
  assert.doesNotMatch(ctx.turnStart(), /독립 검증/)
  assert.equal(ctx.state().verdicts[0].verdict, 'on_track')
})

test('a newer verdict replaces an unhandled older one; the next check sees the previous verdict and a fresh commit range', async (t) => {
  const ctx = setup(t)
  ctx.stub.output(DRIFT_STEP)
  write(ctx.root, 'src/first.js', '1\n')
  ctx.turnStart()
  commit(ctx.root, 'first range commit [id=notes]')
  ctx.setFields(FIELDS_B)
  assert.equal(ctx.stop(), '')
  await ctx.waitCalls(1)
  await ctx.waitResult()
  // 아직 거두지 않은 채 다음 계기 → Stop 이 먼저 거두고 차단한다. 그다음 두 번째 검사가 on_track 이면 조용하다.
  ctx.stub.output(ON_TRACK)
  ctx.turnStart()
  write(ctx.root, 'src/second.js', '2\n')
  commit(ctx.root, 'second range commit [id=notes]')
  ctx.setFields(FIELDS_C)
  assert.equal(JSON.parse(ctx.stop()).decision, 'block')
  const [first, second] = await ctx.waitCalls(2)
  assert.match(first.prompt, /first range commit/)
  assert.doesNotMatch(first.prompt, /직전 판정/)
  assert.match(second.prompt, /직전 판정\ndrift\/step_unmet — 3단계 끝 조건/)
  assert.match(second.prompt, /second range commit/)
  assert.doesNotMatch(second.prompt, /first range commit/, 'the range restarts at the previous launch')
  await ctx.waitResult()
  assert.equal(ctx.stop(), '')
  assert.equal(ctx.turnStart(), '', 'the latest verdict is on_track: nothing to deliver')
})

// ---------- 실패·정리 ----------

test('runner failure and garbage output become unclear with the error text and never block', async (t) => {
  const failing = setup(t)
  failing.stub.fail(3, 'boom: claude exploded')
  await failing.launchStepCheck()
  const failed = JSON.parse(failing.stop())
  assert.equal(failed.decision, undefined)
  assert.match(failed.systemMessage, /unclear\/other.*검사 세션 실패: boom: claude exploded/)
  assert.match(failing.turnStart(), /판정: unclear\/other — 검사 세션 실패: boom: claude exploded/)

  const garbage = setup(t)
  garbage.stub.output('죄송하지만 판정할 수 없습니다. JSON 이 아닙니다.')
  await garbage.launchStepCheck()
  const reported = JSON.parse(garbage.stop())
  assert.equal(reported.decision, undefined)
  assert.match(reported.systemMessage, /unclear\/other.*검사 세션 실패: 판정 JSON 을 찾지 못함/)

  const invalid = setup(t)
  invalid.stub.output('{"verdict":"maybe","kind":"x"}')
  await invalid.launchStepCheck()
  assert.match(JSON.parse(invalid.stop()).systemMessage, /unclear\/other.*판정 형식 오류/)

  const missing = setup(t, { env: { STATE_VERIFY_COMMAND: '/nonexistent/runner' } })
  await missing.launchStepCheck({}, { expectCall: false })
  assert.match(JSON.parse(missing.stop()).systemMessage, /unclear\/other.*검사 세션 실패: .*ENOENT/)
})

test('a runner that finishes with the claude JSON wrapper and fenced verdict is understood', async (t) => {
  const ctx = setup(t)
  ctx.stub.output(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `검토 결과입니다.\n\`\`\`json\n${JSON.stringify(DRIFT_SCOPE)}\n\`\`\`` }))
  await ctx.launchStepCheck()
  assert.match(JSON.parse(ctx.stop()).systemMessage, /drift\/scope/)
})

test('a running check whose worker died without a result is reaped as unclear', async (t) => {
  const ctx = setup(t)
  ctx.turnStart()
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
  const state = ctx.state()
  state.running = { jobId: 'dead-job', pid: Number(dead.stdout), startedAt: new Date().toISOString(), triggers: [{ type: 'step', changes: [] }], model: 'opus', head: null, jobFile: join(ctx.jobsDir, 'dead-job.job.json'), resultFile: join(ctx.jobsDir, 'dead-job.result.json') }
  ctx.writeState(state)
  const reported = JSON.parse(ctx.stop())
  assert.match(reported.systemMessage, /unclear\/other.*검사 세션이 결과 없이 끝남/)
  assert.equal(reported.decision, undefined)
  assert.equal(ctx.state().running, null)
})

test('a check running for more than 20 minutes is reaped as unclear even if its pid is alive', async (t) => {
  const ctx = setup(t)
  ctx.turnStart()
  const state = ctx.state()
  state.running = { jobId: 'old-job', pid: process.pid, startedAt: new Date(Date.now() - 21 * 60 * 1000).toISOString(), triggers: [{ type: 'periodic', turn: 1, every: 5 }], model: 'sonnet', head: null, jobFile: join(ctx.jobsDir, 'old-job.job.json'), resultFile: join(ctx.jobsDir, 'old-job.result.json') }
  ctx.writeState(state)
  assert.match(JSON.parse(ctx.stop()).systemMessage, /검사 세션이 결과 없이 끝남/)
})

test('a corrupt state file starts fresh instead of failing the hook', async (t) => {
  const ctx = setup(t)
  ctx.turnStart()
  writeFileSync(ctx.statePath(), '{not json')
  assert.equal(ctx.turnStart(), '')
  assert.equal(ctx.state().turnCount, 1)
  writeFileSync(ctx.statePath(), JSON.stringify({ version: 1, root: ctx.root, turnCount: 'many', verdicts: 'x', running: 7, pendingTriggers: [null] }))
  assert.equal(ctx.stop(), '')
  assert.equal(ctx.state().turnCount, 0)
})

// ---------- 재귀 가드·시간·통합 ----------

test('recursion guard: inside a verification session every dispatcher mode prints nothing and writes nothing', async (t) => {
  const ctx = setup(t)
  const child = { STATE_LEDGER_VERIFY_CHILD: '1' }
  for (const [mode, payload] of [
    ['session-start', { source: 'compact' }],
    ['turn-start', { prompt: 'x' }],
    ['stamp', { tool_input: { file_path: 'docs/state/root/notes.md' } }],
    ['stop', { hook_event_name: 'Stop', stop_hook_active: false }],
  ]) {
    assert.equal(ctx.dispatch(mode, payload, child), '', mode)
  }
  ctx.setFields(FIELDS_B)
  assert.equal(ctx.engine('stop', {}, child), '', 'the engine itself is off in a child')
  await sleep(150)
  assert.equal(existsSync(ctx.dataDir), false, 'no baseline, pin or verify file')
  assert.equal(ctx.stub.calls().length, 0)
})

test('the launched check runs as a child session: guard variable set, Claude parent variables removed', async (t) => {
  const ctx = setup(t)
  ctx.turnStart()
  ctx.setFields(FIELDS_B)
  assert.equal(ctx.stop(), '')
  const [call] = await ctx.waitCalls(1)
  assert.equal(call.child, '1')
  assert.equal(call.claudecode, null)
  assert.equal(call.claudeProjectDir, null)
  const parentEnv = { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SSE_PORT: '1234', CLAUDE_PROJECT_DIR: '/somewhere/else' }
  const other = setup(t, { env: parentEnv })
  other.turnStart()
  other.setFields(FIELDS_B)
  other.stop()
  const [seen] = await other.waitCalls(1)
  assert.equal(seen.claudecode, null)
  assert.equal(seen.claudeProjectDir, null)
  assert.equal(seen.child, '1')
})

test('Stop returns quickly while the detached check keeps running for seconds', async (t) => {
  const ctx = setup(t)
  ctx.stub.sleep(2500)
  ctx.dispatch('turn-start', { prompt: 'x' })
  ctx.setFields(FIELDS_B)
  const started = Date.now()
  const out = ctx.dispatch('stop', { hook_event_name: 'Stop', stop_hook_active: false })
  const elapsed = Date.now() - started
  assert.ok(elapsed < 2000, `Stop took ${elapsed} ms`)
  assert.equal(out, '')
  await ctx.waitCalls(1)
  assert.ok(ctx.state().running, 'the check is still running after Stop returned')
  await ctx.waitResult()
})

test('dispatcher Stop prints the block JSON alone when a verdict blocks', async (t) => {
  const ctx = setup(t)
  ctx.stub.output(DRIFT_STEP)
  await ctx.launchStepCheck()
  write(ctx.root, 'src/untagged.js', 'x\n')
  commit(ctx.root, 'untagged work')
  const out = JSON.parse(ctx.dispatch('stop', { hook_event_name: 'Stop', stop_hook_active: false }))
  assert.equal(out.decision, 'block')
  assert.ok(out.reason.includes(DRIFT_STEP.summary))
  assert.doesNotMatch(out.systemMessage, /STATE reminder/, 'the existing reminders are not merged into the block')
})

test('dispatcher Stop keeps the existing tag and append reminders next to a verify report', async (t) => {
  const ctx = setup(t)
  ctx.stub.output(DRIFT_SCOPE)
  await ctx.launchStepCheck()

  assert.doesNotMatch(ctx.dispatch('turn-start', { prompt: 'turn two' }), /^$/)
  write(ctx.root, 'src/untagged.js', 'export const x = 1\n')
  commit(ctx.root, 'untagged work')
  const out = JSON.parse(ctx.dispatch('stop', { hook_event_name: 'Stop', stop_hook_active: false }))
  assert.equal(out.decision, undefined)
  assert.match(out.systemMessage, /STATE reminder: 이번 턴 커밋 중 STATE id 태그가 없는 커밋 — [0-9a-f]{7} untagged work/)
  assert.match(out.systemMessage, /STATE 독립 검증\(step, opus\): drift\/scope/)
})

test('dispatcher Stop with only a verify report prints just that systemMessage', async (t) => {
  const ctx = setup(t)
  ctx.stub.output(UNCLEAR)
  await ctx.launchStepCheck()
  const out = JSON.parse(ctx.dispatch('stop', { hook_event_name: 'Stop', stop_hook_active: false }))
  assert.deepEqual(Object.keys(out), ['systemMessage'])
  assert.match(out.systemMessage, /unclear\/other/)
})

// ---------- 실제 CLI 경로 (가짜 claude/codex 실행 파일) ----------

// PATH 앞에 가짜 claude/codex 를 두고 명령줄·환경·출력 해석을 확인한다. 실제 모델은 부르지 않는다.
function fakeClis(t, ctx) {
  const bin = `${ctx.root}-bin`
  mkdirSync(bin)
  t.after(() => rmSync(bin, { recursive: true, force: true }))
  const common = `import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const prompt = readFileSync(0, 'utf8')
const verdict = ${JSON.stringify(DRIFT_SCOPE)}
const record = (name) => writeFileSync(process.env.STUB_DIR + '/cli-' + name + '.json', JSON.stringify({ args, prompt, cwd: process.cwd(), child: process.env.STATE_LEDGER_VERIFY_CHILD ?? null, claudecode: process.env.CLAUDECODE ?? null }))
`
  const scripts = {
    claude: `${common}record('claude')
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '검토 끝.\\n' + JSON.stringify(verdict) }))
`,
    codex: `${common}record('codex')
writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(verdict))
process.stdout.write('codex progress noise without any json\\n')
`,
  }
  for (const [name, source] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), `#!${process.execPath}\n${source}`)
    chmodSync(join(bin, name), 0o755)
  }
  return { PATH: `${bin}:${process.env.PATH}`, STATE_VERIFY_COMMAND: undefined }
}

const readCli = (ctx, name) => JSON.parse(readFileSync(join(ctx.stubDir, `cli-${name}.json`), 'utf8'))

test('default runner invokes claude -p with read-only tools in the repository and parses its JSON wrapper', async (t) => {
  const ctx = setup(t, { env: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: '/elsewhere' } })
  Object.assign(ctx.env, fakeClis(t, ctx))
  delete ctx.env.STATE_VERIFY_COMMAND
  await ctx.launchStepCheck({}, { expectCall: false })
  const call = readCli(ctx, 'claude')
  assert.equal(call.cwd, ctx.root)
  assert.equal(call.child, '1')
  assert.equal(call.claudecode, null)
  assert.deepEqual(call.args.slice(0, 6), ['-p', '--model', 'opus', '--output-format', 'json', '--no-session-persistence'])
  assert.equal(call.args[call.args.indexOf('--add-dir') + 1], realpathSync(ctx.jobsDir))
  assert.match(call.prompt, /^너는 독립 검증자다\./)
  assert.match(JSON.parse(ctx.stop()).systemMessage, /STATE 독립 검증\(step, opus\): drift\/scope/)
})

test('codex runner uses a read-only ephemeral sandbox, reads the last-message file and passes -m only when configured', async (t) => {
  const withoutModel = setup(t, { staterc: 'STATE_VERIFY="1"\nSTATE_VERIFY_EVERY="0"\nSTATE_VERIFY_RUNNER="codex"\n' })
  Object.assign(withoutModel.env, fakeClis(t, withoutModel))
  delete withoutModel.env.STATE_VERIFY_COMMAND
  await withoutModel.launchStepCheck({}, { expectCall: false })
  const plain = readCli(withoutModel, 'codex')
  assert.deepEqual(plain.args.slice(0, 6), ['exec', '--sandbox', 'read-only', '--ephemeral', '-C', withoutModel.root])
  assert.equal(plain.args.includes('-m'), false, 'no model configured => codex default')
  assert.equal(plain.args.at(-1), '-')
  assert.equal(plain.cwd, withoutModel.root)
  assert.match(JSON.parse(withoutModel.stop()).systemMessage, /drift\/scope/, 'verdict comes from the -o file, not the noisy stdout')

  const withModel = setup(t, { staterc: 'STATE_VERIFY="1"\nSTATE_VERIFY_EVERY="0"\nSTATE_VERIFY_RUNNER="codex"\nSTATE_VERIFY_STEP_MODEL="gpt-x"\n' })
  Object.assign(withModel.env, fakeClis(t, withModel))
  delete withModel.env.STATE_VERIFY_COMMAND
  await withModel.launchStepCheck({}, { expectCall: false })
  const configured = readCli(withModel, 'codex')
  assert.equal(configured.args[configured.args.indexOf('-m') + 1], 'gpt-x')
})

// ---------- 단위 ----------

test('runner command lines: claude read-only tools, codex read-only sandbox, command override', () => {
  const base = { jobId: 'j1', root: '/repo', jobsDir: '/data/verify-jobs', model: 'sonnet', runner: 'claude', command: null }
  const claude = buildRunnerCommand(base)
  assert.equal(claude.command, claudeCommand())
  assert.deepEqual(claude.args.slice(0, 7), ['-p', '--model', 'sonnet', '--output-format', 'json', '--no-session-persistence', '--add-dir'])
  assert.equal(claude.args.includes('--bare'), false)
  const allowed = claude.args[claude.args.indexOf('--allowedTools') + 1]
  for (const tool of ['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git status:*)']) assert.ok(allowed.split(',').includes(tool), tool)
  assert.deepEqual(claude.args[claude.args.indexOf('--disallowedTools') + 1].split(','), ['Edit', 'Write', 'NotebookEdit'])
  assert.equal(claude.env.STATE_LEDGER_VERIFY_CHILD, '1')

  const codex = buildRunnerCommand({ ...base, runner: 'codex', model: 'gpt-x' })
  assert.deepEqual(codex.args, ['exec', '--sandbox', 'read-only', '--ephemeral', '-C', '/repo', '-m', 'gpt-x', '-o', '/data/verify-jobs/j1.codex-last.txt', '-'])
  assert.equal(codex.outputFile, '/data/verify-jobs/j1.codex-last.txt')
  assert.equal(buildRunnerCommand({ ...base, runner: 'codex', model: null }).args.includes('-m'), false)

  const custom = buildRunnerCommand({ ...base, command: '/bin/stub' })
  assert.equal(custom.command, '/bin/stub')
  assert.equal(custom.env.STATE_VERIFY_MODEL_SELECTED, 'sonnet')
})

test('claude binary falls back to the parent CLAUDE_CODE_EXECPATH when PATH has none', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'state-verify-bin-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const exec = join(dir, 'claude-from-app')
  writeFileSync(exec, '#!/bin/sh\n')
  chmodSync(exec, 0o755)
  const empty = join(dir, 'empty')
  mkdirSync(empty)
  const withClaude = join(dir, 'bin')
  mkdirSync(withClaude)
  writeFileSync(join(withClaude, 'claude'), '#!/bin/sh\n')
  chmodSync(join(withClaude, 'claude'), 0o755)
  assert.equal(claudeCommand({ PATH: withClaude, CLAUDE_CODE_EXECPATH: exec }), 'claude')
  assert.equal(claudeCommand({ PATH: empty, CLAUDE_CODE_EXECPATH: exec }), exec)
  assert.equal(claudeCommand({ PATH: empty, CLAUDE_CODE_EXECPATH: join(dir, 'missing') }), 'claude')
  assert.equal(claudeCommand({ PATH: empty }), 'claude')
})

test('model selection: claude defaults, codex only when set explicitly', () => {
  const claude = { runner: 'claude', model: null, stepModel: null }
  assert.equal(selectModel(claude, false), 'sonnet')
  assert.equal(selectModel(claude, true), 'opus')
  assert.equal(selectModel({ runner: 'claude', model: 'haiku', stepModel: 'fable' }, true), 'fable')
  const codex = { runner: 'codex', model: null, stepModel: null }
  assert.equal(selectModel(codex, true), null)
  assert.equal(selectModel({ ...codex, stepModel: 'gpt-x' }, true), 'gpt-x')
  assert.equal(selectModel({ ...codex, stepModel: 'gpt-x' }, false), null)
})

test('verdict extraction and validation', () => {
  const direct = extractVerdict(JSON.stringify(DRIFT_STEP))
  assert.equal(direct.verdict.verdict, 'drift')
  assert.equal(extractVerdict(`앞말 {"a":1} 본문 ${JSON.stringify(ON_TRACK)} 뒷말`).verdict.verdict, 'on_track')
  assert.equal(extractVerdict(`{"note":"{\\"x\\"}","verdict":"unclear","kind":"other","summary":"s \\"}\\" t"}`).verdict.summary, 's "}" t')
  const wrapped = extractVerdict(JSON.stringify({ type: 'result', is_error: false, result: `\`\`\`json\n${JSON.stringify(DRIFT_ORDER)}\n\`\`\`` }))
  assert.equal(wrapped.verdict.kind, 'order')
  assert.match(extractVerdict(JSON.stringify({ type: 'result', is_error: true, result: 'rate limited' })).error, /rate limited/)
  assert.match(extractVerdict('').error, /아무것도 출력하지 않음/)
  assert.match(extractVerdict('JSON 없음').error, /판정 JSON 을 찾지 못함/)
  assert.match(extractVerdict('{"verdict":"maybe"}').error, /판정 형식 오류/)

  const long = normalizeVerdict({
    verdict: 'drift',
    kind: 'bogus',
    summary: 'x'.repeat(900),
    evidence: Array.from({ length: 12 }, (_, i) => `${i}${'e'.repeat(400)}`),
    missing: 'single string',
  })
  assert.equal(long.kind, 'other', 'unknown kind => other')
  assert.equal([...long.summary].length, 800)
  assert.equal(long.evidence.length, 8)
  assert.ok(long.evidence.every((entry) => [...entry].length <= 300))
  assert.deepEqual(long.missing, ['single string'])
  assert.equal(normalizeVerdict({ verdict: 'on_track', kind: 'step_unmet' }).kind, 'none')
  assert.equal(normalizeVerdict({ verdict: 'drift', kind: 'none' }).kind, 'other')
  assert.equal(normalizeVerdict({ verdict: 'nope' }), null)
  assert.equal(normalizeVerdict('x'), null)
})

test('step changes and trigger merging', () => {
  const before = [{ area: 'root', id: 'a', step: 's1', next_step: 'n1' }, { area: 'root', id: 'b', step: '', next_step: '' }]
  const now = [
    { area: 'root', id: 'a', step: 's2', next_step: 'n1' },
    { area: 'root', id: 'b', step: '', next_step: '' },
    { area: 'root', id: 'c', step: 's9', next_step: '' },
    { area: 'root', id: 'd', step: '', next_step: '' },
  ]
  const changes = stepChanges(before, now)
  assert.deepEqual(changes.map((change) => change.id), ['a', 'c'])
  assert.equal(changes[0].from.step, 's1')
  assert.equal(changes[1].from, null)
  const merged = mergeTriggers(
    [{ type: 'step', changes: [{ area: 'root', id: 'a', from: { step: 's1', next_step: '' }, to: { step: 's2', next_step: '' } }] }, { type: 'compact' }],
    [{ type: 'step', changes: [{ area: 'root', id: 'a', from: { step: 's2', next_step: '' }, to: { step: 's3', next_step: '' } }] }, { type: 'compact' }, { type: 'periodic', turn: 5, every: 5 }],
  )
  assert.deepEqual(merged.map((trigger) => trigger.type), ['step', 'compact', 'periodic'])
  assert.equal(merged[0].changes[0].from.step, 's1', 'oldest from is kept')
  assert.equal(merged[0].changes[0].to.step, 's3', 'newest to is kept')
})

test('transcript tail keeps only recent user and agent text within the byte budget', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'state-verify-tail-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 't.jsonl')
  const filler = Array.from({ length: 1500 }, (_, i) => JSON.stringify({ type: 'user', message: { role: 'user', content: `OLD-${i} ${'가'.repeat(300)}` } }))
  const tail = [
    { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'SIDECHAIN' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>HIDDEN</system-reminder>끝부분 사용자 말' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'CODEX-REPLY' }] } },
    { type: 'response_item', payload: { type: 'function_call_output', output: 'TOOL-OUT' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'LAST-ONE' }] } },
  ].map((line) => JSON.stringify(line))
  writeFileSync(path, `${[...filler, ...tail].join('\n')}\n`)
  assert.ok(readFileSync(path).length > 512 * 1024, 'fixture is larger than the read window')
  const text = transcriptTail(path)
  assert.ok(Buffer.byteLength(text) <= 20 * 1024 + 2048)
  assert.match(text, /사용자: 끝부분 사용자 말/)
  assert.match(text, /에이전트: CODEX-REPLY/)
  assert.match(text, /에이전트: LAST-ONE$/)
  assert.doesNotMatch(text, /HIDDEN|SIDECHAIN|TOOL-OUT|OLD-0 /)
  assert.match(text, /OLD-14\d\d/, 'older text fills the remaining budget')
  assert.equal(transcriptTail(join(dir, 'missing.jsonl')), '')
})
