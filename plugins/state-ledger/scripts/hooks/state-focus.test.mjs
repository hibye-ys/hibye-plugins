// 현재 작업 재주입 — 현재 브랜치가 소유한 STATE 항목의 목표·단계·절차를 매 턴·세션 시작에 다시 싣는다.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { blockCleanup, requestCleanup } from './state-cleanup.mjs'
import { INSTRUCTION, MAX_REMINDER_BYTES, MAX_SHORT_BYTES, buildReminder, buildShortReminder, currentBranch, focusFullEvery, focusOutput, focusReminder, forgetFocus, ownedItems } from './state-focus.mjs'

const WIP_CHECK_SCRIPT = fileURLToPath(new URL('../check-state-wip-cap.sh', import.meta.url))
const SESSION_SCRIPT = fileURLToPath(new URL('./session-start-state-inject.sh', import.meta.url))
const SNAPSHOT_SCRIPT = fileURLToPath(new URL('./turn-start-state-snapshot.sh', import.meta.url))
const GLOBAL_SCRIPT = fileURLToPath(new URL('./global-state-hook.sh', import.meta.url))
const FOCUS_SCRIPT = fileURLToPath(new URL('./state-focus.mjs', import.meta.url))
const ANTIGRAVITY_PRE_INVOCATION = fileURLToPath(new URL('../../hooks/antigravity-pre-invocation.sh', import.meta.url))
const FM_STATERC = 'STATE_INDEXES="STATE.md"\nSTATE_DEFAULT_BRANCH="main"\nSTATE_INDEX_SOURCE="frontmatter"\n'
const MANUAL_STATERC = 'STATE_INDEXES="STATE.md"\nSTATE_DEFAULT_BRANCH="main"\n'
const FULL_FIELDS = {
  goal: '노트 영역 하나로 구현 순서 0→5단계 끝 조건을 순서대로 채운다',
  step: '0~3단계 끝(로컬)',
  next_step: '4단계 CI 판정(끝 조건: 구현 순서 4. CI 연결)',
  handoff: 'docs/plans/impl-order.md#구현-순서',
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

// fields: 추가 frontmatter 필드 (값이 ''이면 `key: ` 빈 값 줄).
function detail(id, { section = 'active', title = `${id} 제목`, status = `${id} 상태`, branch = 'feat/x', touched = '2026-11-01T00:00', fields = {}, manual = false } = {}) {
  const body = `\n## 현재\n\n${id} 남은 일 첫 줄.\n${id} 남은 일 둘째 줄.\n\n## 원장\n\n${id} 결정 WHY.\n`
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8)
  const lines = [`id: ${id}`, 'area: root']
  if (!manual) lines.push(`section: ${section}`, `title: ${title}`, `status: ${status}`)
  lines.push('owner: agent', `branch: ${branch}`, `touched: ${touched}`, `hash: ${hash}`)
  for (const [key, value] of Object.entries(fields)) lines.push(`${key}: ${value}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

function repo(t, { staterc = FM_STATERC, branch = 'feat/x' } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'state-focus-test-')))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'focus fixture')
  git(root, 'config', 'user.email', 'focus@example.invalid')
  git(root, 'config', 'core.hooksPath', '/dev/null')
  write(root, '.staterc', staterc)
  write(root, '.gitignore', '/STATE.md\n')
  write(root, 'README.md', 'fixture\n')
  commit(root, 'init [id=-]')
  if (branch !== 'main') git(root, 'checkout', '-q', '-b', branch)
  return root
}

function manualIndex(rows) {
  const section = (n, heading, ids) => `## ${n}. ${heading}\n\n${ids.map(([id, title]) => `- [${id}] ${title} — ${id} 상태`).join('\n')}\n`
  return `# STATE\n\n${section(1, '활성', rows.active ?? [])}\n${section(2, '다음', rows.next ?? [])}\n${section(3, '미래', rows.future ?? [])}\n${section(4, '미해결', rows.unresolved ?? [])}`
}

function run(script, root, { args = [], input = '', env = {} } = {}) {
  const result = spawnSync('bash', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: { ...process.env, HOOK_PROJECT_DIR: root, STATE_HOOK_DATA_DIR: `${root}-hook-data`, STATE_LEDGER_HOST: 'claude', ...env },
  })
  return { status: result.status, stdout: result.stdout, out: `${result.stdout}${result.stderr}` }
}

const payload = (extra = {}) => JSON.stringify({ session_id: 'focus-session', prompt: 'x', ...extra })

function turnStart(root, env = {}) {
  const result = run(SNAPSHOT_SCRIPT, root, { input: payload(), env })
  assert.equal(result.status, 0, result.out)
  return result.stdout.trim()
}

function sessionContext(root, extra = {}) {
  const result = run(SESSION_SCRIPT, root, { input: payload(extra) })
  assert.equal(result.status, 0, result.out)
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext
}

function seedHandoff(root) {
  write(root, 'docs/plans/impl-order.md', '# 구현 순서\n\n## 구현 순서\n\n0~5단계\n')
}

test('owned active item: turn-start injects goal, step, next step, handoff and the instruction', (t) => {
  const root = repo(t)
  seedHandoff(root)
  write(root, 'docs/state/root/notes.md', detail('notes', { title: '노트 영역 구현', fields: FULL_FIELDS }))
  commit(root, 'seed [id=notes]')

  const parsed = JSON.parse(turnStart(root))
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  assert.equal(parsed.systemMessage, undefined)
  const text = parsed.hookSpecificOutput.additionalContext
  assert.match(text, /^=== STATE 현재 작업 — 브랜치 feat\/x \(바뀔 때·10턴마다·세션 시작 때 전체 주입\) ===\n/)
  assert.match(text, /\[notes\] 노트 영역 구현 — docs\/state\/root\/notes\.md \(§1 활성\)/)
  assert.ok(text.includes(`- 목표·완성 기준: ${FULL_FIELDS.goal}`))
  assert.ok(text.includes(`- 지금 단계: ${FULL_FIELDS.step}`))
  assert.ok(text.includes(`- 다음 단계: ${FULL_FIELDS.next_step}`))
  assert.ok(text.trimEnd().endsWith(`- 절차(handoff): ${FULL_FIELDS.handoff}`))
  assert.doesNotMatch(text, /파일 없음|- 상태:|앞부분/)
  assert.equal(text.split(INSTRUCTION).length, 2, 'instruction appears exactly once')
  assert.ok(text.startsWith(`${text.split('\n')[0]}\n${INSTRUCTION}\n`), 'instruction follows the header line')
  console.log(`--- example reminder ---\n${text}\n------------------------`)
})

test('session start places the reminder before the index block', (t) => {
  const root = repo(t)
  seedHandoff(root)
  write(root, 'docs/state/root/notes.md', detail('notes', { fields: FULL_FIELDS }))
  commit(root, 'seed [id=notes]')

  for (const source of ['startup', 'compact']) {
    const context = sessionContext(root, { source })
    const reminder = context.indexOf('=== STATE 현재 작업')
    const index = context.indexOf('=== STATE.md ===')
    assert.ok(reminder >= 0 && index > reminder, `${source}: reminder must precede the index block`)
    assert.ok(context.includes(FULL_FIELDS.goal))
  }
})

test('item without the new fields keeps working: status line, ## 현재 excerpt, instruction, no field warnings', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/legacy.md', detail('legacy', { status: '옛 상태', fields: { handoff: 'docs/plans/missing.md' } }))
  commit(root, 'seed [id=legacy]')

  const text = JSON.parse(turnStart(root)).hookSpecificOutput.additionalContext
  assert.match(text, /- 상태: 옛 상태/)
  assert.doesNotMatch(text, /^- (목표·완성 기준|지금 단계|다음 단계):/m)
  assert.match(text, /detail ## 현재 앞부분 \(frontmatter goal·step·next_step 을 적으면 이 발췌 대신 세 줄이 실린다\):\n {2}legacy 남은 일 첫 줄\.\n {2}legacy 남은 일 둘째 줄\./)
  assert.doesNotMatch(text, /결정 WHY/, 'excerpt stops at the next ## heading')
  assert.ok(text.includes(INSTRUCTION))
  assert.doesNotMatch(run(WIP_CHECK_SCRIPT, root).out, /frontmatter (goal|step|next_step)/)
})

test('partial fields: present lines are shown and the status line replaces the missing ones without an excerpt', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/partial.md', detail('partial', { fields: { goal: '목표 하나', handoff: '-' } }))
  commit(root, 'seed [id=partial]')

  const text = JSON.parse(turnStart(root)).hookSpecificOutput.additionalContext
  assert.match(text, /- 목표·완성 기준: 목표 하나\n- 상태: partial 상태\n- 절차\(handoff\): 없음 — detail ## 현재 가 절차 정본/)
  assert.doesNotMatch(text, /앞부분/)
})

test('silent cases: base branch, detached HEAD, no owned item, only §3/§4 ownership', (t) => {
  const onMain = repo(t, { branch: 'main' })
  write(onMain, 'docs/state/root/basework.md', detail('basework', { branch: 'main', fields: FULL_FIELDS }))
  commit(onMain, 'seed [id=basework]')
  assert.equal(focusReminder(onMain), '')
  assert.equal(turnStart(onMain), '')
  assert.doesNotMatch(sessionContext(onMain), /=== STATE 현재 작업/)

  const detached = repo(t)
  write(detached, 'docs/state/root/work.md', detail('work', { fields: FULL_FIELDS }))
  commit(detached, 'seed [id=work]')
  git(detached, 'checkout', '-q', '--detach')
  assert.equal(focusReminder(detached), '')
  assert.equal(turnStart(detached), '')

  const unowned = repo(t, { branch: 'feat/y' })
  write(unowned, 'docs/state/root/work.md', detail('work', { branch: 'feat/x', fields: FULL_FIELDS }))
  commit(unowned, 'seed [id=work]')
  assert.equal(focusReminder(unowned), '')
  assert.equal(turnStart(unowned), '')

  const parked = repo(t)
  write(parked, 'docs/state/root/later.md', detail('later', { section: 'future', fields: FULL_FIELDS }))
  write(parked, 'docs/state/root/ask.md', detail('ask', { section: 'unresolved', fields: FULL_FIELDS }))
  commit(parked, 'seed [id=later] [id=ask]')
  assert.equal(focusReminder(parked), '')
  assert.equal(turnStart(parked), '')
})

test('manual index source: §1 and §2 rows owned by the branch are injected, §3 rows are not', (t) => {
  const root = repo(t, { staterc: MANUAL_STATERC })
  seedHandoff(root)
  write(root, 'STATE.md', manualIndex({ active: [['mwork', '수동 활성']], next: [['mnext', '수동 다음']], future: [['mlater', '수동 미래']] }))
  write(root, 'docs/state/root/mwork.md', detail('mwork', { manual: true, fields: FULL_FIELDS }))
  write(root, 'docs/state/root/mnext.md', detail('mnext', { manual: true, touched: '2026-11-09T00:00' }))
  write(root, 'docs/state/root/mlater.md', detail('mlater', { manual: true, fields: FULL_FIELDS }))
  commit(root, 'seed [id=mwork] [id=mnext] [id=mlater]')
  const text = JSON.parse(turnStart(root)).hookSpecificOutput.additionalContext
  assert.match(text, /\[mwork\] 수동 활성 — docs\/state\/root\/mwork\.md \(§1 활성\)/)
  assert.match(text, /\[mnext\] 수동 다음 — docs\/state\/root\/mnext\.md \(§2 다음\)/)
  assert.ok(text.indexOf('[mwork]') < text.indexOf('[mnext]'), 'active before next')
  assert.doesNotMatch(text, /mlater/)
  assert.ok(text.includes(FULL_FIELDS.goal))
})

test('handoff: missing file is flagged, an existing path with #section is not, no handoff says so', (t) => {
  const root = repo(t)
  seedHandoff(root)
  write(root, 'docs/state/root/missing.md', detail('missing', { touched: '2026-11-03T00:00', fields: { ...FULL_FIELDS, handoff: 'docs/plans/gone.md#절' } }))
  write(root, 'docs/state/root/present.md', detail('present', { touched: '2026-11-02T00:00', fields: FULL_FIELDS }))
  write(root, 'docs/state/root/nohand.md', detail('nohand', { touched: '2026-11-01T00:00', fields: { goal: 'g', step: 's', next_step: 'n' } }))
  commit(root, 'seed')

  const text = focusReminder(root)
  assert.match(text, /- 절차\(handoff\): docs\/plans\/gone\.md#절 \(파일 없음\)/)
  assert.ok(text.includes(`- 절차(handoff): ${FULL_FIELDS.handoff}\n`), 'existing file with #section has no 파일 없음')
  assert.match(text, /- 절차\(handoff\): 없음 — detail ## 현재 가 절차 정본/)
})

test('more than three owned items: three shown (active first, newest first) plus 외 N개, size stays bounded', (t) => {
  const root = repo(t)
  const long = '가'.repeat(200)
  const fields = { goal: long, step: long, next_step: long, handoff: FULL_FIELDS.handoff }
  write(root, 'docs/state/root/a1.md', detail('a1', { touched: '2026-11-01T00:00', fields }))
  write(root, 'docs/state/root/a2.md', detail('a2', { touched: '2026-11-05T00:00', fields }))
  write(root, 'docs/state/root/a3.md', detail('a3', { touched: '2026-11-03T00:00', fields }))
  write(root, 'docs/state/root/n1.md', detail('n1', { section: 'next', touched: '2026-11-09T00:00', fields }))
  write(root, 'docs/state/root/n2.md', detail('n2', { section: 'next', touched: '2026-11-08T00:00', fields }))
  commit(root, 'seed')

  const text = focusReminder(root)
  const order = ['[a2]', '[a3]', '[a1]'].map((id) => text.indexOf(id))
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], 'active items newest first')
  assert.doesNotMatch(text, /\[n1\] .*—/)
  assert.match(text, /\n외 2개: \[n1\] \[n2\]$/)
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_REMINDER_BYTES, `${Buffer.byteLength(text, 'utf8')}B`)
  assert.ok(text.includes(`===\n${INSTRUCTION}\n`), 'instruction survives size shrinking')
  assert.doesNotMatch(text, /�/)
})

test('a single oversized item (long title, excerpt) still fits the byte budget', (t) => {
  const root = repo(t)
  const lines = Array.from({ length: 200 }, (_, i) => `줄 ${i} ${'나'.repeat(40)}`).join('\n')
  const body = `\n## 현재\n\n${lines}\n`
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8)
  write(root, 'docs/state/root/big.md', `---\nid: big\narea: root\nsection: active\ntitle: ${'다'.repeat(300)}\nstatus: ${'라'.repeat(300)}\nowner: agent\nbranch: feat/x\ntouched: 2026-11-01T00:00\nhash: ${hash}\n---\n${body}`)
  commit(root, 'seed')
  const text = focusReminder(root)
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_REMINDER_BYTES)
  assert.ok(text.includes('detail ## 현재 앞부분'))
  assert.ok(text.includes(`===\n${INSTRUCTION}\n`))
})

test('wip-cap warns for empty or over-200-char goal·step·next_step, passes 200, and ignores absent fields', (t) => {
  for (const staterc of [FM_STATERC, MANUAL_STATERC]) {
    const root = repo(t, { staterc })
    const manual = staterc === MANUAL_STATERC
    if (manual) write(root, 'STATE.md', manualIndex({ active: [['over', '길다'], ['empty', '비었다'], ['fine', '정상'], ['plain', '필드 없음']] }))
    write(root, 'docs/state/root/over.md', detail('over', { manual, fields: { goal: '가'.repeat(201), step: '가'.repeat(200) } }))
    write(root, 'docs/state/root/empty.md', detail('empty', { manual, fields: { goal: 'ok', step: '', next_step: '' } }))
    write(root, 'docs/state/root/fine.md', detail('fine', { manual, fields: { goal: '가'.repeat(200), step: '나', next_step: '다' } }))
    write(root, 'docs/state/root/plain.md', detail('plain', { manual }))
    commit(root, 'seed')

    const { out } = run(WIP_CHECK_SCRIPT, root)
    assert.match(out, /WARN: docs\/state\/root\/over\.md frontmatter goal 201자 \(cap 200자 초과\) — 한 줄 요약만, 상세는 ## 현재·handoff 로/, staterc)
    assert.match(out, /WARN: docs\/state\/root\/empty\.md frontmatter step 빈 값 — 지우거나 한 줄로 채운다/, staterc)
    assert.match(out, /WARN: docs\/state\/root\/empty\.md frontmatter next_step 빈 값/, staterc)
    assert.doesNotMatch(out, /over\.md frontmatter step/, 'exactly 200 characters passes')
    assert.doesNotMatch(out, /empty\.md frontmatter goal/)
    assert.doesNotMatch(out, /(fine|plain)\.md frontmatter (goal|step|next_step)/)
    assert.match(out, /구조 3 /, 'the field warnings count as structure warnings, not size')
  }
})

test('engine failure becomes a systemMessage warning and never blocks the snapshot', (t) => {
  const root = repo(t)
  write(root, '.staterc', 'STATE_INDEXES="/etc/STATE.md"\n')
  const parsed = JSON.parse(turnStart(root))
  assert.equal(parsed.hookSpecificOutput, undefined)
  assert.match(parsed.systemMessage, /STATE 현재 작업 알림 실패: /)
  assert.ok(parsed.systemMessage.length <= 800)
  const cli = spawnSync('node', [FOCUS_SCRIPT, 'reminder'], { cwd: root, encoding: 'utf8', env: { ...process.env, HOOK_PROJECT_DIR: root } })
  assert.equal(cli.status, 1)
  assert.match(cli.stderr, /STATE_INDEXES/)
})

// 링크된 worktree 세션: 훅은 CLAUDE_PROJECT_DIR(primary, main)이 아니라 세션 자기 checkout 의 STATE 를 쓴다.
function worktreeFixture(t) {
  const primary = repo(t, { branch: 'main' })
  seedHandoff(primary)
  write(primary, 'docs/state/root/notes.md', detail('notes', { branch: 'main', status: '옛 상태' }))
  commit(primary, 'seed [id=notes]')
  const worktree = `${primary}-wt`
  git(primary, 'worktree', 'add', '-q', '-b', 'feat/x', worktree)
  t.after(() => rmSync(worktree, { recursive: true, force: true }))
  write(worktree, 'docs/state/root/notes.md', detail('notes', { branch: 'feat/x', status: '워크트리 상태', fields: FULL_FIELDS }))
  commit(worktree, 'claim [id=notes]')
  return { primary, worktree: realpathSync(worktree) }
}

function dispatch(mode, { primary, worktree }, extra = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: primary, STATE_HOOK_DATA_DIR: `${primary}-hook-data`, STATE_LEDGER_HOST: 'claude' }
  delete env.HOOK_PROJECT_DIR
  const result = spawnSync('bash', [GLOBAL_SCRIPT, mode], {
    cwd: worktree,
    encoding: 'utf8',
    env,
    input: JSON.stringify({ session_id: 'wt-session', cwd: worktree, prompt: 'x', ...extra }),
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test('dispatcher in a linked worktree injects the worktree item on turn-start and on compact session-start', (t) => {
  const fixture = worktreeFixture(t)
  const turn = JSON.parse(dispatch('turn-start', fixture)).hookSpecificOutput
  assert.equal(turn.hookEventName, 'UserPromptSubmit')
  assert.match(turn.additionalContext, /브랜치 feat\/x/)
  assert.ok(turn.additionalContext.includes(FULL_FIELDS.goal))
  assert.ok(turn.additionalContext.includes(FULL_FIELDS.next_step))

  const session = JSON.parse(dispatch('session-start', fixture, { source: 'compact' })).hookSpecificOutput
  assert.equal(session.hookEventName, 'SessionStart')
  const reminder = session.additionalContext.indexOf('=== STATE 현재 작업 — 브랜치 feat/x')
  assert.ok(reminder >= 0 && reminder < session.additionalContext.indexOf('=== STATE.md ==='))
  assert.ok(session.additionalContext.includes(FULL_FIELDS.goal))

  // primary(main) 자기 세션은 알림이 없다.
  assert.equal(dispatch('turn-start', { primary: fixture.primary, worktree: fixture.primary }), '')
})

test('Antigravity PreInvocation injects the reminder on every invocation without duplicating it on the first', (t) => {
  const root = repo(t)
  seedHandoff(root)
  write(root, 'docs/state/root/notes.md', detail('notes', { fields: FULL_FIELDS }))
  commit(root, 'seed [id=notes]')
  const sid = `focus-anti-${process.pid}-${Date.now()}`
  t.after(() => {
    rmSync(join(tmpdir(), `antigravity-session-inject-${sid}.flag`), { force: true })
    rmSync(join(tmpdir(), `antigravity-state-stop-${sid}.flag`), { force: true })
  })
  const invoke = (invocationNum) => {
    const out = run(ANTIGRAVITY_PRE_INVOCATION, root, { input: JSON.stringify({ conversationId: sid, invocationNum, workspacePaths: [root] }) })
    assert.equal(out.status, 0, out.out)
    return JSON.parse(out.stdout.trim())
  }

  const first = invoke(1).injectSteps[0].ephemeralMessage
  assert.equal(first.split('=== STATE 현재 작업').length, 2, 'reminder appears once on the first invocation')
  assert.ok(first.includes('=== STATE.md ==='), 'first invocation still carries the session-start context')
  assert.ok(first.indexOf('=== STATE 현재 작업') < first.indexOf('=== STATE.md ==='))

  const second = invoke(2).injectSteps[0].ephemeralMessage
  assert.ok(second.includes(FULL_FIELDS.goal) && second.includes(INSTRUCTION))
  assert.doesNotMatch(second, /=== STATE\.md ===/, 'later invocations carry only the reminder')

  // 소유 항목이 없는 브랜치에서는 예전처럼 빈 객체.
  git(root, 'checkout', '-q', 'main')
  assert.deepEqual(invoke(3), {})
})

test('SessionStart order: initialization warning, current-work reminder, warning summary, then the index', (t) => {
  const root = repo(t)
  seedHandoff(root)
  write(root, 'docs/state/root/notes.md', detail('notes', { fields: FULL_FIELDS }))
  // 본문을 바꿔 hash 불일치(정합·예산 요약 대상)를 만든다.
  write(root, 'docs/state/root/stale.md', detail('stale', { branch: 'main' }).replace('stale 남은 일 첫 줄.', 'stale 편집됨.'))
  commit(root, 'seed [id=notes]')
  const result = run(SESSION_SCRIPT, root, { input: payload(), env: { STATE_CHECK_AREA: 'nope' } })
  assert.equal(result.status, 0, result.out)
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext
  const at = (heading) => {
    const index = context.indexOf(heading)
    assert.ok(index >= 0, `${heading} missing in:\n${context}`)
    return index
  }
  const initialization = at('=== STATE 검사 초기화 경고 ===')
  const reminder = at('=== STATE 현재 작업 — 브랜치 feat/x')
  const summary = at('=== STATE 정합·예산 (warn-only) ===')
  const index = at('=== STATE.md ===')
  assert.ok(initialization < reminder && reminder < summary && summary < index, `order: ${[initialization, reminder, summary, index]}`)
})

test('wip-cap checks the goal·step·next_step line format like parseFrontmatter reads it', (t) => {
  const root = repo(t)
  const noSpace = detail('nospace').replace('\nowner:', '\ngoal:값만\nstep:\nnext_step:   \nowner:')
  write(root, 'docs/state/root/nospace.md', noSpace)
  write(root, 'docs/state/root/spaced.md', detail('spaced', { fields: { goal: '가'.repeat(201), step: '정상' } }))
  commit(root, 'seed')
  const { out } = run(WIP_CHECK_SCRIPT, root)
  assert.match(out, /WARN: docs\/state\/root\/nospace\.md frontmatter goal 형식 — 'goal: 값' \(콜론 뒤 공백 하나\)/)
  assert.match(out, /nospace\.md frontmatter step 빈 값/)
  assert.match(out, /nospace\.md frontmatter next_step 빈 값/)
  assert.doesNotMatch(out, /nospace\.md frontmatter (step|next_step) 형식/)
  assert.match(out, /spaced\.md frontmatter goal 201자/)
  assert.doesNotMatch(out, /spaced\.md frontmatter step/)
})

test('a remote-ref STATE_DEFAULT_BRANCH counts the matching local branch as the base, a local slash-named base is not stripped', (t) => {
  const stateRc = (base) => `STATE_INDEXES="STATE.md"\nSTATE_DEFAULT_BRANCH="${base}"\nSTATE_INDEX_SOURCE="frontmatter"\n`
  // origin/main + 실제 refs/remotes/origin/main: main 세션은 조용하다.
  const remote = repo(t, { staterc: stateRc('origin/main'), branch: 'main' })
  write(remote, 'docs/state/root/notes.md', detail('notes', { branch: 'main', fields: FULL_FIELDS }))
  commit(remote, 'seed [id=notes]')
  git(remote, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  assert.equal(focusReminder(remote), '')
  // 같은 설정에서 다른 브랜치의 소유 항목은 여전히 실린다.
  git(remote, 'checkout', '-q', '-b', 'feat/x')
  write(remote, 'docs/state/root/owned.md', detail('owned', { fields: FULL_FIELDS }))
  commit(remote, 'owned [id=owned]')
  assert.match(focusReminder(remote), /브랜치 feat\/x/)

  // refs/remotes/<BASE> 가 없으면 `origin/main` 은 그냥 이름이다 — main 을 기본 브랜치로 보지 않는다.
  const noRemote = repo(t, { staterc: stateRc('origin/main'), branch: 'main' })
  write(noRemote, 'docs/state/root/notes.md', detail('notes', { branch: 'main', fields: FULL_FIELDS }))
  commit(noRemote, 'seed [id=notes]')
  assert.match(focusReminder(noRemote), /브랜치 main/)

  // 로컬 기본 브랜치 release/2026: 그 브랜치는 조용하고, 슬래시 앞부분을 떼어 `2026` 브랜치를 기본으로 오인하지 않는다.
  const local = repo(t, { staterc: stateRc('release/2026'), branch: 'release/2026' })
  write(local, 'docs/state/root/notes.md', detail('notes', { branch: 'release/2026', fields: FULL_FIELDS }))
  commit(local, 'seed [id=notes]')
  assert.equal(focusReminder(local), '')
  git(local, 'checkout', '-q', '-b', '2026')
  write(local, 'docs/state/root/year.md', detail('year', { branch: '2026', fields: FULL_FIELDS }))
  commit(local, 'year [id=year]')
  assert.match(focusReminder(local), /브랜치 2026/)
})

const bytesOf = (text) => Buffer.byteLength(text, 'utf8')
const HEADER_RE = /^=== STATE 현재 작업 — 브랜치 .+ \(매 턴 다시 주입\) ===$/ // 플래그 없는 reminder(레거시, Antigravity)의 머리줄

// ---------- 0.10.1: 현재 작업 알림 보강 ----------

test('M1: a tag named like the branch does not turn the branch into heads/<name>', (t) => {
  const root = repo(t)
  write(root, 'docs/state/root/notes.md', detail('notes', { fields: FULL_FIELDS }))
  commit(root, 'seed [id=notes]')
  git(root, 'tag', 'feat/x')
  assert.equal(git(root, 'symbolic-ref', '--short', 'HEAD'), 'heads/feat/x', 'fixture: git itself reports the ambiguous short name')
  assert.equal(currentBranch(root), 'feat/x')
  const text = focusReminder(root)
  assert.match(text, /^=== STATE 현재 작업 — 브랜치 feat\/x \(/)
  assert.match(text, /\[notes\]/)

  // 기본 브랜치와 같은 이름의 태그가 있어도 기본 브랜치는 조용하다.
  const onMain = repo(t, { branch: 'main' })
  write(onMain, 'docs/state/root/basework.md', detail('basework', { branch: 'main', fields: FULL_FIELDS }))
  commit(onMain, 'seed [id=basework]')
  git(onMain, 'tag', 'main')
  assert.equal(currentBranch(onMain), 'main')
  assert.equal(focusReminder(onMain), '')
  assert.equal(turnStart(onMain), '')

  git(onMain, 'checkout', '-q', '--detach')
  assert.equal(currentBranch(onMain), null)
})

test('H6: the handoff path and #anchor are printed in full while goal/step/next shrink to fit the budget', (t) => {
  const root = repo(t)
  const long = '가'.repeat(200)
  const handoffs = ['a1', 'a2', 'a3'].map((id) => `docs/plans/${'long-plan-directory/'.repeat(5)}${id}-plan.md#${'section-anchor-'.repeat(4)}end`)
  handoffs.forEach((handoff, i) => {
    assert.ok([...handoff].length <= 300 && [...handoff].length > 120, `fixture handoff length ${[...handoff].length}`)
    write(root, `docs/state/root/a${i + 1}.md`, detail(`a${i + 1}`, { touched: `2026-11-0${i + 1}T00:00`, fields: { goal: long, step: long, next_step: long, handoff } }))
  })
  commit(root, 'seed')

  const text = focusReminder(root)
  assert.ok(bytesOf(text) <= MAX_REMINDER_BYTES, `${bytesOf(text)}B`)
  for (const handoff of handoffs) assert.ok(text.includes(`- 절차(handoff): ${handoff} (파일 없음)`), `handoff clipped or item dropped: ${handoff}\n${text}`)
  assert.match(text, /목표·완성 기준: 가+…/, 'long fields were shrunk, not the handoff')
  assert.doesNotMatch(text, /외 \d+개/, 'all three items stay shown')
  assert.doesNotMatch(text, /�/)

  // 300자를 넘는 handoff 는 깨진 접두사 대신 고정 안내.
  const huge = `docs/plans/${'다'.repeat(310)}.md#절`
  write(root, 'docs/state/root/a1.md', detail('a1', { touched: '2026-11-09T00:00', fields: { goal: 'g', step: 's', next_step: 'n', handoff: huge } }))
  commit(root, 'huge handoff')
  const note = focusReminder(root)
  assert.ok(note.includes('- 절차(handoff): (handoff 값이 300자를 넘음 — detail frontmatter 에서 직접 확인)'))
  assert.ok(!note.includes('다'.repeat(20)), 'no broken prefix of the oversized handoff')
})

test('M8: five max-length items keep whole items (title + handoff), the 외 N개 line and the 3000B cap; nothing is cut mid-line', (t) => {
  const root = repo(t)
  const long = '나'.repeat(200)
  const handoff = `docs/plans/${'계획-'.repeat(60)}.md#${'절'.repeat(40)}`
  ;[['a1', 'active', '2026-11-05'], ['a2', 'active', '2026-11-04'], ['a3', 'active', '2026-11-03'], ['n1', 'next', '2026-11-02'], ['n2', 'next', '2026-11-01']].forEach(([id, section, day]) => {
    write(root, `docs/state/root/${id}.md`, detail(id, { section, title: long, touched: `${day}T00:00`, fields: { goal: long, step: long, next_step: long, handoff } }))
  })
  commit(root, 'seed')

  const text = focusReminder(root)
  assert.ok(bytesOf(text) <= MAX_REMINDER_BYTES, `${bytesOf(text)}B`)
  assert.doesNotMatch(text, /�|잘림/)
  const lines = text.split('\n')
  assert.match(lines[0], HEADER_RE)
  assert.equal(lines[1], INSTRUCTION)
  const rest = lines.at(-1)
  const m = /^외 (\d+)개: ((?:\[[a-z0-9-]+\] ?)+)$/.exec(rest)
  assert.ok(m, `last line is the 외 N개 line: ${rest}`)
  const shown = lines.filter((line) => /^\[[a-z0-9-]+\] /.test(line))
  assert.equal(shown.length + Number(m[1]), 5, 'shown + hidden covers all five items')
  assert.equal(m[2].trim().split(' ').length, Number(m[1]))
  assert.ok(shown.length >= 1)
  // 보이는 항목마다 제목 줄 → … → handoff 줄이 온전하고, 줄이 중간에서 잘리지 않았다.
  for (const line of shown) assert.match(line, / — docs\/state\/root\/[a-z0-9]+\.md \(§[12] (활성|다음)\)$/, `title line cut: ${line}`)
  assert.equal(lines.filter((line) => line === `- 절차(handoff): ${handoff} (파일 없음)`).length, shown.length, 'every shown item keeps its full handoff line')
  assert.ok(shown.length < 3, 'the budget forced fewer items instead of cutting bytes')
})

test('M8: as a last resort only the item tail is clipped (with a marker); instruction and 외 N개 line stay, total stays within 3000B', (t) => {
  const root = repo(t)
  // 머리줄의 브랜치 이름은 200B 로 잘리므로, 안전망은 항목 1개의 고정 줄(긴 id·경로, 4바이트 문자 필드, 300자 직전 handoff)로 부른다.
  const branch = 'feat/x'
  const id = `a1${'x'.repeat(240)}`
  const emoji = '😀'.repeat(200)
  const handoff = `docs/plans/${'😀'.repeat(280)}.md#절`
  write(root, `docs/state/root/${id}.md`, detail(id, { branch, title: emoji, fields: { goal: emoji, step: emoji, next_step: emoji, handoff } }))
  write(root, 'docs/state/root/a2.md', detail('a2', { branch, touched: '2026-10-01T00:00' }))
  commit(root, 'seed')
  const text = buildReminder(root, branch, ownedItems(root, branch))
  assert.ok(bytesOf(text) <= MAX_REMINDER_BYTES, `${bytesOf(text)}B`)
  assert.ok(text.includes(`\n${INSTRUCTION}\n`))
  assert.doesNotMatch(text, /�/)
  assert.ok(text.includes('…(잘림)'))
  assert.match(text.trimEnd().split('\n').at(-1), /^외 1개: \[a2\]$/)
})

test('R2: the 3000B safety net is strict — oversized ids in the 외 N개 line shrink, the count stays exact, the result is valid UTF-8 with header and instruction intact', (t) => {
  const root = repo(t)
  const ids = Array.from({ length: 20 }, (_, i) => `${String.fromCharCode(97 + i)}${'x'.repeat(199)}`)
  const handoff = `docs/plans/${'😀'.repeat(60)}.md#${'😀'.repeat(20)}`
  ids.forEach((id, i) => {
    write(root, `docs/state/root/${id}.md`, detail(id, { touched: `2026-11-0${(i % 9) + 1}T00:00`, fields: { goal: 'g', step: 's', next_step: 'n', handoff } }))
  })
  commit(root, 'seed')
  const text = buildReminder(root, 'feat/x', ownedItems(root, 'feat/x'))
  assert.ok(bytesOf(text) <= MAX_REMINDER_BYTES, `${bytesOf(text)}B`)
  assert.equal(Buffer.from(text, 'utf8').toString('utf8'), text)
  assert.doesNotMatch(text, /�/)
  const lines = text.split('\n')
  assert.match(lines[0], HEADER_RE)
  assert.equal(lines[1], INSTRUCTION)
  assert.match(text, /\n외 \d+개: /, 'the 외 N개 line is present')
  const m = /\n외 (\d+)개: /.exec(text)
  const shown = lines.filter((line) => /^\[[a-z]x+\] /.test(line))
  assert.equal(shown.length + Number(m[1]), 20, 'the hidden count stays exact')
})

test('a very long branch name is clipped in the header so the instruction and the 외 N개 line still fit', (t) => {
  const root = repo(t)
  for (let i = 0; i < 12; i += 1) {
    write(root, `docs/state/root/item${i}.md`, detail(`item${i}`, { touched: `2026-11-0${(i % 9) + 1}T00:00`, fields: { goal: 'g'.repeat(300), step: 's'.repeat(300), next_step: 'n', handoff: 'docs/plans/p.md' } }))
  }
  commit(root, 'seed')
  const text = buildReminder(root, `feat/${'가'.repeat(1500)}`, ownedItems(root, 'feat/x'))
  assert.ok(bytesOf(text) <= MAX_REMINDER_BYTES, `${bytesOf(text)}B`)
  const lines = text.split('\n')
  assert.ok(bytesOf(lines[0]) < 350, `header ${bytesOf(lines[0])}B`)
  assert.match(lines[0], /…/)
  assert.equal(lines[1], INSTRUCTION)
  assert.match(text, /\[item\d+\]/)
})

test('instruction sits right after the header line, before any item', (t) => {
  const root = repo(t)
  seedHandoff(root)
  write(root, 'docs/state/root/notes.md', detail('notes', { fields: FULL_FIELDS }))
  commit(root, 'seed [id=notes]')
  const lines = focusReminder(root).split('\n')
  assert.match(lines[0], HEADER_RE)
  assert.equal(lines[1], INSTRUCTION)
  assert.ok(lines.findIndex((line) => line.startsWith('[notes]')) > 1)
  const context = sessionContext(root, { source: 'startup' })
  assert.ok(context.includes(`전체 주입) ===\n${INSTRUCTION}\n`))
})

const PLACEHOLDERS = ['>', '|', '>-', '|-', '""', "''", 'null', '~']

test('YAML placeholders (> | >- |- "" \'\' null ~) count as empty for the engine and wip-cap warns for goal/step/next_step/handoff', (t) => {
  const root = repo(t)
  PLACEHOLDERS.forEach((placeholder, i) => {
    const id = `ph${i}`
    write(root, `docs/state/root/${id}.md`, detail(id, { fields: { goal: placeholder, step: placeholder, next_step: placeholder, handoff: placeholder } }))
    commit(root, `seed ${id}`)
    const text = focusReminder(root)
    assert.ok(text.includes(`[${id}]`), placeholder)
    assert.doesNotMatch(text, /^- (목표·완성 기준|지금 단계|다음 단계):/m, `placeholder ${placeholder} printed as a field`)
    assert.ok(!text.includes(`: ${placeholder}\n`) && !text.endsWith(`: ${placeholder}`), `placeholder ${placeholder} leaked`)
    assert.match(text, new RegExp(`- 상태: ${id} 상태`), placeholder)
    assert.match(text, /- 절차\(handoff\): 없음 — detail ## 현재 가 절차 정본/, placeholder)
    assert.match(text, /detail ## 현재 앞부분/, `${placeholder}: all three empty falls back to the excerpt`)
    const { out } = run(WIP_CHECK_SCRIPT, root)
    for (const key of ['goal', 'step', 'next_step', 'handoff']) {
      assert.match(out, new RegExp(`WARN: docs/state/root/${id}\\.md frontmatter ${key} 형식 — 한 줄 평문 값을 쓴다 \\(YAML 블록·null 표기 불가\\)`), `${placeholder} ${key}`)
    }
    rmSync(join(root, `docs/state/root/${id}.md`))
    commit(root, `drop ${id}`)
  })
  // 정상 한 줄 값과 handoff '-' 는 경고가 없다.
  write(root, 'docs/state/root/fine.md', detail('fine', { fields: { goal: '목표', step: '단계', next_step: '다음', handoff: '-' } }))
  commit(root, 'fine')
  assert.doesNotMatch(run(WIP_CHECK_SCRIPT, root).out, /fine\.md frontmatter/)
})

test('handoff outside the repository is flagged and never stat-ed: absolute path, .. escape, ~ path, symlink out', (t) => {
  const root = repo(t)
  seedHandoff(root)
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'state-focus-outside-')))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  write(outside, 'secret.md', '# 밖\n')
  mkdirSync(join(root, 'docs/plans'), { recursive: true })
  symlinkSync(join(outside, 'secret.md'), join(root, 'docs/plans/link.md'))
  const cases = {
    abs: '/etc/hosts',
    up: '../../x',
    home: '~/.ssh/id_rsa',
    link: 'docs/plans/link.md#절',
    absAnchor: `${outside}/secret.md#절`,
  }
  Object.entries(cases).forEach(([id, handoff], i) => {
    write(root, `docs/state/root/${id.toLowerCase()}.md`, detail(id.toLowerCase(), { touched: `2026-11-0${i + 1}T00:00`, fields: { goal: 'g', step: 's', next_step: 'n', handoff } }))
  })
  // 안쪽의 정상 파일·없는 파일은 밖으로 오인하지 않는다.
  write(root, 'docs/state/root/inside.md', detail('inside', { section: 'next', fields: { goal: 'g', step: 's', next_step: 'n', handoff: FULL_FIELDS.handoff } }))
  write(root, 'docs/state/root/gone.md', detail('gone', { section: 'next', touched: '2026-10-01T00:00', fields: { goal: 'g', step: 's', next_step: 'n', handoff: 'docs/plans/gone.md' } }))
  commit(root, 'seed')
  const text = focusReminder(root)
  // MAX_ITEMS(3) 제한이 있으므로 항목별로 buildReminder 를 따로 부른다.
  const render = (id) => buildReminder(root, 'feat/x', ownedItems(root, 'feat/x').filter((item) => item.id === id))
  for (const [id, handoff] of Object.entries(cases)) {
    assert.ok(render(id.toLowerCase()).includes(`- 절차(handoff): ${handoff} (저장소 밖 경로 — 무시)`), `${id}: ${handoff}`)
  }
  assert.ok(render('inside').includes(`- 절차(handoff): ${FULL_FIELDS.handoff}\n`) || render('inside').trimEnd().endsWith(`- 절차(handoff): ${FULL_FIELDS.handoff}`))
  assert.ok(render('gone').includes('- 절차(handoff): docs/plans/gone.md (파일 없음)'))
  assert.doesNotMatch(render('gone'), /저장소 밖/)
  assert.ok(text.length > 0)
})

test('Antigravity first invocation with an independent-verifier verdict block: reminder once, verdict once, session context kept', (t) => {
  const root = repo(t)
  seedHandoff(root)
  write(root, 'docs/state/root/notes.md', detail('notes', { fields: FULL_FIELDS }))
  commit(root, 'seed [id=notes]')

  // turn-start 만 판정 블록을 덧붙이는 대역 dispatcher (실제 Antigravity 에서는 verify 가 no-op 이라 직접 재현할 수 없다).
  const ledger = realpathSync(mkdtempSync(join(tmpdir(), 'state-focus-ledger-')))
  t.after(() => rmSync(ledger, { recursive: true, force: true }))
  mkdirSync(join(ledger, 'scripts/hooks'), { recursive: true })
  const stub = join(ledger, 'scripts/hooks/global-state-hook.sh')
  writeFileSync(stub, `#!/bin/bash
mode="$1"
input=$(cat)
case "$mode" in
  turn-start)
    focus=$(HOOK_PROJECT_DIR="$HOOK_PROJECT_DIR" node ${JSON.stringify(FOCUS_SCRIPT)} reminder)
    verdict=$'=== STATE 독립 검증 결과 (step, opus) ===\\n판정: drift/order — 대역 판정'
    jq -n --arg ctx "$focus"$'\\n\\n'"$verdict" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
    ;;
  session-start)
    printf '%s' "$input" | HOOK_PROJECT_DIR="$HOOK_PROJECT_DIR" bash ${JSON.stringify(SESSION_SCRIPT)}
    ;;
esac
`)
  chmodSync(stub, 0o755)
  const sid = `focus-anti-verdict-${process.pid}-${Date.now()}`
  t.after(() => {
    rmSync(join(tmpdir(), `antigravity-session-inject-${sid}.flag`), { force: true })
    rmSync(join(tmpdir(), `antigravity-state-stop-${sid}.flag`), { force: true })
  })
  const invoke = (invocationNum) => {
    const out = run(ANTIGRAVITY_PRE_INVOCATION, root, { input: JSON.stringify({ conversationId: sid, invocationNum, workspacePaths: [root] }), env: { STATE_LEDGER_ROOT: ledger } })
    assert.equal(out.status, 0, out.out)
    return JSON.parse(out.stdout.trim()).injectSteps[0].ephemeralMessage
  }
  const count = (text, needle) => text.split(needle).length - 1

  const first = invoke(1)
  assert.equal(count(first, '=== STATE 현재 작업'), 1, `reminder duplicated:\n${first}`)
  assert.equal(count(first, '=== STATE 독립 검증 결과'), 1)
  assert.equal(count(first, INSTRUCTION), 1)
  assert.ok(first.includes('=== STATE.md ==='), 'session-start context is still injected')

  const second = invoke(2)
  assert.equal(count(second, '=== STATE 현재 작업'), 1)
  assert.equal(count(second, '=== STATE 독립 검증 결과'), 1)
  assert.doesNotMatch(second, /=== STATE\.md ===/)
})

test('SessionStart: a long cleanup-request list is capped so the reminder stays inside the first 5000 bytes', async (t) => {
  const root = repo(t, { staterc: `${FM_STATERC}STATE_CLEANUP_ENFORCE="1"\n` })
  seedHandoff(root)
  write(root, 'docs/state/root/notes.md', detail('notes', { fields: FULL_FIELDS }))
  for (const id of ['kk1', 'kk2', 'kk3', 'kk4', 'kk5']) write(root, `docs/state/root/${id}.md`, detail(id, { branch: 'other' }))
  commit(root, 'seed [id=notes]')
  for (const id of ['kk1', 'kk2', 'kk3', 'kk4', 'kk5']) {
    const request = await requestCleanup(root, { sessionId: 'focus-session', scope: 'explicit', targets: [`root/${id}`], instructionRef: 'chat:1', instruction: '정리해' })
    await blockCleanup(root, { requestId: request.id, sessionId: 'focus-session', reason: '긴 사유 '.repeat(300) })
  }
  const context = sessionContext(root, { source: 'startup' })
  const previousHost = process.env.STATE_LEDGER_HOST
  process.env.STATE_LEDGER_HOST = 'claude' // 훅 프로세스와 같은 호스트여야 머리줄의 N 이 같다
  const reminder = buildReminder(root, 'feat/x', ownedItems(root, 'feat/x'), 'periodic') // SessionStart 는 --session-start 머리줄
  if (previousHost === undefined) delete process.env.STATE_LEDGER_HOST
  else process.env.STATE_LEDGER_HOST = previousHost
  const at = context.indexOf(reminder)
  assert.ok(at >= 0, 'reminder present in full')
  assert.ok(bytesOf(context.slice(0, at + reminder.length)) <= 5000, `reminder ends at ${bytesOf(context.slice(0, at + reminder.length))}B`)
  assert.match(context, /…\(2개 더\)/)
  assert.ok(context.indexOf('STATE 정리 미완료 요청') < at, 'cleanup list still comes first')
})

// ---------- 0.10.3: 바뀌지 않은 턴은 요약(SHORT)만 ----------

const SHORT_HEADER_RE = /^=== STATE 현재 작업 — 브랜치 .+ \(마지막 전체 알림 뒤 변경 없음 — 전체는 바뀔 때·\d+턴마다·세션 시작 때\) ===$/
const SHORT_RULE_LINE = '계획 순서를 벗어나려면 먼저 사용자에게 묻는다(이번 턴 사용자의 명시 지시가 우선). 절차(handoff)·끝 조건은 앞선 전체 알림에 있고, 대화에 보이지 않으면(압축·되감기 뒤) 위 detail 의 frontmatter·handoff 를 다시 읽는다. 앞선 전체 알림과 다르면 이 요약과 detail 이 최신이다.'

// 한 세션의 훅 데이터 폴더를 쓰는 focusOutput 호출 도구. 데이터 폴더는 repo 옆 임시 폴더(repo() 가 정리한다).
function focusFixture(t, { staterc = FM_STATERC, fields = FULL_FIELDS } = {}) {
  const root = repo(t, { staterc })
  seedHandoff(root)
  write(root, 'docs/state/root/notes.md', detail('notes', { title: '노트 영역 구현', fields }))
  commit(root, 'seed [id=notes]')
  const dataDir = `${root}-hook-data`
  const saved = { STATE_HOOK_DATA_DIR: process.env.STATE_HOOK_DATA_DIR, STATE_LEDGER_HOST: process.env.STATE_LEDGER_HOST, STATE_HOOK_SESSION_ID: process.env.STATE_HOOK_SESSION_ID }
  process.env.STATE_HOOK_DATA_DIR = dataDir
  process.env.STATE_LEDGER_HOST = 'claude'
  delete process.env.STATE_HOOK_SESSION_ID
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const sid = 'focus-session' // payload() 와 같은 세션 — 스크립트 호출과 기록을 공유한다
  const stdin = JSON.stringify({ session_id: sid })
  const hash32 = createHash('sha256').update(sid).digest('hex').slice(0, 32)
  const file = join(dataDir, `focus-${hash32}.json`)
  const tempFile = join(dataDir, `.focus-${hash32}.${process.pid}.tmp.json`)
  const turn = (input = stdin) => focusOutput(root, 'turn', input)
  const start = (input = stdin) => focusOutput(root, 'session-start', input)
  const isShort = (text) => text.startsWith('=== STATE 현재 작업') && text.split('\n')[0].includes('변경 없음')
  const isFull = (text) => text.startsWith('=== STATE 현재 작업') && text.includes(INSTRUCTION)
  return { root, dataDir, file, tempFile, turn, start, isShort, isFull }
}

test('SHORT: first turn is full, the identical second turn is short with header, id, path, goal/step/next and the rule line', (t) => {
  const f = focusFixture(t)
  const first = f.turn()
  assert.ok(f.isFull(first))
  assert.ok(first.includes(`- 절차(handoff): ${FULL_FIELDS.handoff}`))
  const second = f.turn()
  assert.ok(f.isShort(second), second)
  assert.ok(bytesOf(second) <= MAX_SHORT_BYTES, `${bytesOf(second)}B`)
  const lines = second.split('\n')
  assert.match(lines[0], SHORT_HEADER_RE)
  assert.equal(lines[1], '[notes] 노트 영역 구현 — docs/state/root/notes.md')
  assert.ok(second.includes(`- 목표: ${FULL_FIELDS.goal}`))
  assert.ok(second.includes(`- 지금 단계: ${FULL_FIELDS.step}`))
  assert.ok(second.includes(`- 다음 단계: ${FULL_FIELDS.next_step}`))
  assert.ok(lines.includes(`- 절차: ${FULL_FIELDS.handoff}`), 'the handoff path survives in the short form')
  assert.equal(lines.at(-1), SHORT_RULE_LINE)
  assert.doesNotMatch(second, /handoff\): docs|INSTRUCTION|제안·시작·전환하기 전에/)
  assert.ok(!second.includes(INSTRUCTION))
  assert.equal(JSON.parse(readFileSyncText(f.file)).sinceFull, 1)
})

function readFileSyncText(path) {
  return spawnSync('cat', [path], { encoding: 'utf8' }).stdout
}

test('SHORT: goal/step/next lines are omitted when missing, the status line stands in when all are missing', (t) => {
  const f = focusFixture(t, { fields: { step: '지금 이 단계' } })
  f.turn()
  const second = f.turn()
  assert.ok(f.isShort(second))
  assert.ok(second.includes('- 지금 단계: 지금 이 단계'))
  assert.ok(second.includes('- 절차: detail ## 현재'), 'no handoff → pointer to the detail ## 현재')
  assert.doesNotMatch(second, /- 목표:|- 다음 단계:|- 상태:/)
  const bare = focusFixture(t, { fields: {} })
  bare.turn()
  const bareSecond = bare.turn()
  assert.ok(bare.isShort(bareSecond))
  assert.ok(bareSecond.includes('- 상태: notes 상태'))
  assert.doesNotMatch(bareSecond, /- 목표:|- 지금 단계:|- 다음 단계:/)
})

test('SHORT: a content change (detail step edit) goes full again, then short again', (t) => {
  const f = focusFixture(t)
  f.turn()
  assert.ok(f.isShort(f.turn()))
  write(f.root, 'docs/state/root/notes.md', detail('notes', { title: '노트 영역 구현', fields: { ...FULL_FIELDS, step: '4단계 시작' } }))
  const changed = f.turn()
  assert.ok(f.isFull(changed) && changed.includes('- 지금 단계: 4단계 시작'))
  const after = f.turn()
  assert.ok(f.isShort(after) && after.includes('- 지금 단계: 4단계 시작'))
})

test('SHORT: a branch change goes full (the record keeps the branch)', (t) => {
  const f = focusFixture(t)
  git(f.root, 'checkout', '-q', '-b', 'feat/y')
  write(f.root, 'docs/state/root/other.md', detail('other', { branch: 'feat/y', fields: FULL_FIELDS }))
  commit(f.root, 'other [id=other]')
  f.turn()
  assert.ok(f.isShort(f.turn()))
  git(f.root, 'checkout', '-q', 'feat/x')
  const back = f.turn()
  assert.ok(f.isFull(back) && back.includes('브랜치 feat/x'))
})

test('SHORT: every N-th turn is full (STATE_FOCUS_FULL_EVERY=3 → full, short, short, full, short)', (t) => {
  const f = focusFixture(t, { staterc: `${FM_STATERC}STATE_FOCUS_FULL_EVERY="3"\n` })
  const kinds = [1, 2, 3, 4, 5].map(() => (f.isFull(f.turn()) ? 'F' : 'S'))
  assert.equal(kinds.join(''), 'FSSFS')
  assert.match(f.turn().split('\n')[0], /3턴마다/)
})

test('SHORT: STATE_FOCUS_FULL_EVERY=1 is always full; invalid values fall back to 10', (t) => {
  const one = focusFixture(t, { staterc: `${FM_STATERC}STATE_FOCUS_FULL_EVERY="1"\n` })
  assert.ok([1, 2, 3].every(() => one.isFull(one.turn())))
  for (const bad of ['0', '101', 'abc', '2.5', '-3', '']) {
    const f = focusFixture(t, { staterc: `${FM_STATERC}STATE_FOCUS_FULL_EVERY="${bad}"\n` })
    const kinds = Array.from({ length: 11 }, () => (f.isFull(f.turn()) ? 'F' : 'S')).join('')
    assert.equal(kinds, 'FSSSSSSSSSF', `value ${JSON.stringify(bad)}`)
  }
  const hundred = focusFixture(t, { staterc: `${FM_STATERC}STATE_FOCUS_FULL_EVERY="100"\n` })
  assert.match(hundred.turn().split('\n')[0], /100턴마다/)
})

test('SHORT: no session id → always full and no record is written', (t) => {
  const f = focusFixture(t)
  for (const input of ['', '{}', 'not json', JSON.stringify({ session_id: '  ' })]) {
    assert.ok(f.isFull(f.turn(input)), input)
    assert.ok(f.isFull(f.turn(input)), input)
  }
  assert.ok(!existsSync(f.dataDir) || readdirSync(f.dataDir).filter((name) => name.startsWith('focus-')).length === 0)
  // sessionID / sessionId 철자도 읽는다.
  f.turn(JSON.stringify({ sessionID: 'alt-1' }))
  assert.ok(f.isShort(f.turn(JSON.stringify({ sessionID: 'alt-1' }))))
  f.turn(JSON.stringify({ sessionId: 'alt-2' }))
  assert.ok(f.isShort(f.turn(JSON.stringify({ sessionId: 'alt-2' }))))
})

test('SHORT: an unsafe data directory (symlink) is never read or written; the output is full', (t) => {
  const f = focusFixture(t)
  const elsewhere = `${f.root}-elsewhere`
  mkdirSync(elsewhere)
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }))
  rmSync(f.dataDir, { recursive: true, force: true })
  symlinkSync(elsewhere, f.dataDir)
  assert.ok(f.isFull(f.turn()))
  assert.ok(f.isFull(f.turn()))
  assert.ok(f.isFull(f.start()))
  assert.deepEqual(readdirSync(elsewhere), [])
})

test('SHORT: session-start is full and records, the next turn is short; a compact session-start resets the interval', (t) => {
  const f = focusFixture(t, { staterc: `${FM_STATERC}STATE_FOCUS_FULL_EVERY="3"\n` })
  assert.ok(f.isFull(f.start()))
  assert.ok(f.isShort(f.turn()))
  assert.equal(JSON.parse(readFileSyncText(f.file)).sinceFull, 1)
  assert.ok(f.isFull(f.start()))
  assert.equal(JSON.parse(readFileSyncText(f.file)).sinceFull, 0)
  assert.ok(f.isShort(f.turn()))
  assert.ok(f.isShort(f.turn()))
  assert.ok(f.isFull(f.turn()))
})

test('SHORT: no owned items → nothing printed and the record is removed so the next owned turn is full', (t) => {
  const f = focusFixture(t)
  f.turn()
  assert.ok(f.isShort(f.turn()))
  assert.ok(existsSync(f.file))
  git(f.root, 'checkout', '-q', 'main')
  assert.equal(f.turn(), '')
  assert.equal(f.start(), '')
  assert.ok(!existsSync(f.file))
  git(f.root, 'checkout', '-q', 'feat/x')
  assert.ok(f.isFull(f.turn()))
})

test('SHORT: unparsable or foreign records are treated as missing (full), and a record write failure still prints full', (t) => {
  const f = focusFixture(t)
  f.turn()
  writeFileSync(f.file, '{broken')
  assert.ok(f.isFull(f.turn()))
  writeFileSync(f.file, JSON.stringify({ v: 2, root: f.root, branch: 'feat/x', hash: 'x', sinceFull: 0 }))
  assert.ok(f.isFull(f.turn()))
  assert.ok(f.isShort(f.turn()))
  // 기록 자리가 폴더라 rename 이 실패한다 → 요약이 아니라 전체.
  rmSync(f.file)
  mkdirSync(f.file)
  assert.ok(f.isFull(f.turn()))
  assert.ok(f.isFull(f.turn()))
  assert.deepEqual(readdirSync(f.dataDir).filter((name) => name.endsWith('.tmp')), [])
})

test('SHORT: the record is private (0600), holds only {v, root, branch, hash, sinceFull}, and sits in the data dir as focus-<32 hex>.json', (t) => {
  const f = focusFixture(t)
  const first = f.turn()
  assert.match(f.file, /focus-[0-9a-f]{32}\.json$/)
  const record = JSON.parse(readFileSyncText(f.file))
  assert.deepEqual(Object.keys(record).sort(), ['branch', 'hash', 'root', 'sinceFull', 'v'])
  assert.equal(record.v, 1)
  assert.equal(record.hash, createHash('sha256').update(first).digest('hex'))
  assert.equal(statSync(f.file).mode & 0o777, 0o600)
})

test('SHORT: with three max-size items the short text stays within the cap, keeps header and rule, and lists the rest', (t) => {
  const root = repo(t)
  const long = { goal: '목'.repeat(300), step: '단'.repeat(300), next_step: '다'.repeat(300), handoff: 'docs/plans/p.md' }
  for (let i = 0; i < 5; i += 1) write(root, `docs/state/root/item${i}.md`, detail(`item${i}`, { title: '제'.repeat(200), touched: `2026-11-0${i + 1}T00:00`, fields: long }))
  commit(root, 'seed')
  const text = buildShortReminder(root, 'feat/x', ownedItems(root, 'feat/x'))
  assert.ok(bytesOf(text) <= MAX_SHORT_BYTES, `${bytesOf(text)}B`)
  assert.equal(Buffer.from(text, 'utf8').toString('utf8'), text)
  const lines = text.split('\n')
  assert.match(lines[0], SHORT_HEADER_RE)
  assert.equal(lines.at(-1), SHORT_RULE_LINE)
  assert.match(text, /^외 \d+개: \[item\d\]/m)
  assert.match(text, /\[item\d\] .+ — docs\/state\/root\/item\d\.md/)
  // 아주 긴 브랜치 이름도 상한을 넘기지 않는다.
  const longBranch = buildShortReminder(root, `feat/${'가'.repeat(1500)}`, ownedItems(root, 'feat/x'))
  assert.ok(bytesOf(longBranch) <= MAX_SHORT_BYTES)
  assert.equal(longBranch.split('\n').at(-1), SHORT_RULE_LINE)
})

test('SHORT: turn-start script gives full then short for one session; the verify block and error handling are untouched', (t) => {
  const f = focusFixture(t)
  const first = JSON.parse(turnStart(f.root)).hookSpecificOutput.additionalContext
  assert.ok(f.isFull(first))
  const second = JSON.parse(turnStart(f.root)).hookSpecificOutput.additionalContext
  assert.ok(f.isShort(second))
  // Antigravity 는 ephemeralMessage 라 기록 없이 매번 전체를 받는다.
  const anti = (extra) => JSON.parse(run(SNAPSHOT_SCRIPT, f.root, { input: payload(extra), env: { STATE_LEDGER_HOST: 'antigravity' } }).stdout).hookSpecificOutput.additionalContext
  assert.ok(f.isFull(anti({ session_id: 'anti-s' })) && f.isFull(anti({ session_id: 'anti-s' })))
})

test('SHORT: dispatcher turn-start gives full, short, then full again after a detail step edit', (t) => {
  const fixture = worktreeFixture(t)
  const ctx = () => JSON.parse(dispatch('turn-start', fixture)).hookSpecificOutput.additionalContext
  const first = ctx()
  assert.ok(first.includes(INSTRUCTION) && first.includes(FULL_FIELDS.goal))
  const second = ctx()
  assert.ok(!second.includes(INSTRUCTION) && second.includes('변경 없음') && second.includes(`- 목표: ${FULL_FIELDS.goal}`))
  assert.ok(bytesOf(second) <= MAX_SHORT_BYTES)
  write(fixture.worktree, 'docs/state/root/notes.md', detail('notes', { branch: 'feat/x', status: '워크트리 상태', fields: { ...FULL_FIELDS, step: '4단계 시작' } }))
  const third = ctx()
  assert.ok(third.includes(INSTRUCTION) && third.includes('- 지금 단계: 4단계 시작'))
})

// ---------- 0.10.3 리뷰 보강 ----------

const readRecord = (f) => JSON.parse(readFileSync(f.file, 'utf8'))
const writeRecord = (f, patch) => writeFileSync(f.file, `${JSON.stringify({ ...readRecord(f), ...patch })}\n`)

test('M2: a SHORT-path record write failure with a valid record still prints full (temp create fails)', (t) => {
  const f = focusFixture(t)
  f.turn()
  assert.ok(f.isShort(f.turn()), 'the record is valid, so the next turn would be short')
  writeFileSync(f.tempFile, 'occupied') // `wx` 가 EEXIST 로 실패한다
  const blocked = f.turn()
  assert.ok(f.isFull(blocked), blocked)
  assert.equal(readRecord(f).sinceFull, 1, 'a failed write leaves the record as it was')
  assert.ok(f.isShort(f.turn()), 'once the write works again the interval continues')
})

test('M2: a root change with identical text goes full (only record.root differs)', (t) => {
  const f = focusFixture(t)
  f.turn()
  assert.ok(f.isShort(f.turn()))
  writeRecord(f, { root: `${f.root}-other-clone` })
  assert.ok(f.isFull(f.turn()))
  assert.equal(readRecord(f).root, f.root)
  assert.ok(f.isShort(f.turn()))
})

test('M2: a branch change with an identical hash goes full (only record.branch differs)', (t) => {
  const f = focusFixture(t)
  f.turn()
  assert.ok(f.isShort(f.turn()))
  writeRecord(f, { branch: 'feat/z' })
  assert.ok(f.isFull(f.turn()))
  assert.equal(readRecord(f).branch, 'feat/x')
  assert.ok(f.isShort(f.turn()))
})

test('M1: the default interval follows the host (claude 10, others 3) and .staterc overrides it', (t) => {
  const f = focusFixture(t)
  const withHost = (host, check) => {
    const previous = process.env.STATE_LEDGER_HOST
    if (host === undefined) delete process.env.STATE_LEDGER_HOST
    else process.env.STATE_LEDGER_HOST = host
    try { check() } finally { process.env.STATE_LEDGER_HOST = previous }
  }
  withHost('claude', () => assert.equal(focusFullEvery(f.root), 10))
  for (const host of ['codex', 'muse', 'opencode', '', undefined]) withHost(host, () => assert.equal(focusFullEvery(f.root), 3, String(host)))
  withHost('codex', () => {
    assert.equal(f.turn().split('\n')[0].includes('3턴마다'), true)
    assert.equal(f.turn().split('\n')[0].includes('3턴마다'), true)
  })
  write(f.root, '.staterc', `${FM_STATERC}STATE_FOCUS_FULL_EVERY="7"\n`)
  withHost('codex', () => assert.equal(focusFullEvery(f.root), 7))
  withHost('claude', () => assert.equal(focusFullEvery(f.root), 7))
  write(f.root, '.staterc', `${FM_STATERC}STATE_FOCUS_FULL_EVERY="0"\n`)
  withHost('codex', () => assert.equal(focusFullEvery(f.root), 3))
  withHost('claude', () => assert.equal(focusFullEvery(f.root), 10))
})

// 호스트를 지정(host)하거나 비워(undefined) dispatcher 가 정하게 한다. pluginRoot 가 있으면 PLUGIN_ROOT(Codex 표지)를 준다.
function dispatchWithHost(t, mode, { primary, worktree }, { host, pluginRoot, sid = 'host-session' } = {}) {
  const dataDir = `${primary}-hook-data-host`
  t.after(() => rmSync(dataDir, { recursive: true, force: true }))
  const env = { ...process.env, CLAUDE_PROJECT_DIR: primary, STATE_HOOK_DATA_DIR: dataDir }
  delete env.HOOK_PROJECT_DIR
  delete env.STATE_LEDGER_HOST
  delete env.PLUGIN_ROOT
  if (host !== undefined) env.STATE_LEDGER_HOST = host
  if (pluginRoot) env.PLUGIN_ROOT = pluginRoot
  const result = spawnSync('bash', [GLOBAL_SCRIPT, mode], { cwd: worktree, encoding: 'utf8', env, input: JSON.stringify({ session_id: sid, cwd: worktree, prompt: 'x' }) })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function turnKinds(t, fixture, options, count) {
  const contexts = Array.from({ length: count }, () => JSON.parse(dispatchWithHost(t, 'turn-start', fixture, options)).hookSpecificOutput.additionalContext)
  return { kinds: contexts.map((text) => (text.includes(INSTRUCTION) ? 'F' : 'S')).join(''), header: contexts[0].split('\n')[0] }
}

test('M1: the dispatcher passes the host to the hook script (explicit codex host gets the 3-turn default)', (t) => {
  const fixture = worktreeFixture(t)
  const { kinds, header } = turnKinds(t, fixture, { host: 'codex' }, 4)
  assert.equal(kinds, 'FSSF')
  assert.match(header, /3턴마다/)
})

test('M1: with STATE_LEDGER_HOST unset the dispatcher derives the host — PLUGIN_ROOT means codex (3 turns), otherwise claude (10 turns)', (t) => {
  const codex = turnKinds(t, worktreeFixture(t), { pluginRoot: '/opt/plugin-root' }, 4)
  assert.equal(codex.kinds, 'FSSF')
  assert.match(codex.header, /3턴마다/)
  const claude = turnKinds(t, worktreeFixture(t), {}, 4)
  assert.equal(claude.kinds, 'FSSS')
  assert.match(claude.header, /10턴마다/)
})

test('L6: the session id falls back to STATE_HOOK_SESSION_ID like the baseline and cleanup engines', (t) => {
  const f = focusFixture(t)
  process.env.STATE_HOOK_SESSION_ID = 'env-session'
  assert.ok(f.isFull(f.turn('')))
  assert.ok(f.isShort(f.turn('')))
  assert.ok(f.isShort(f.turn('{}')))
  // payload 의 id 가 우선한다.
  assert.ok(f.isFull(f.turn(JSON.stringify({ session_id: 'payload-session' }))))
  assert.equal(readdirSync(f.dataDir).filter((name) => name.startsWith('focus-')).length, 2)
})

test('L7: the temp file ends in .json (covered by the 7-day cleanup) and the baseline readers skip it', (t) => {
  const f = focusFixture(t)
  f.turn()
  // 임시 파일이 남은 상태를 흉내 내어 기준점 읽기가 건너뛰는지 본다.
  writeFileSync(f.tempFile, '{"v":1,"root":"x"')
  assert.match(f.tempFile, /\.tmp\.json$/)
  const turn = run(SNAPSHOT_SCRIPT, f.root, { input: payload() })
  assert.equal(turn.status, 0, turn.out)
  assert.doesNotMatch(turn.out, /systemMessage/)
})

test('L4: forget removes the record and never fails; session-start with a settings error forgets the record', (t) => {
  const f = focusFixture(t)
  f.start()
  assert.ok(existsSync(f.file))
  forgetFocus(JSON.stringify({ session_id: 'someone-else' }))
  forgetFocus('not json')
  assert.ok(existsSync(f.file))
  forgetFocus(JSON.stringify({ session_id: 'focus-session' }))
  assert.ok(!existsSync(f.file))
  const cli = spawnSync('node', [FOCUS_SCRIPT, 'forget'], { cwd: f.root, encoding: 'utf8', input: '', env: { ...process.env, HOOK_PROJECT_DIR: f.root } })
  assert.equal(cli.status, 0)

  // 정상 SessionStart 는 기록을 남기고 다음 턴이 요약이 된다.
  sessionContext(f.root, { source: 'startup' })
  assert.ok(existsSync(f.file))
  assert.equal(readRecord(f).sinceFull, 0)
  assert.ok(f.isShort(f.turn()))
  // 설정 오류로 알림을 건너뛰면 기록을 지운다 → 다음 턴은 전체.
  write(f.root, '.staterc', 'STATE_INDEXES="/etc/STATE.md"\n')
  run(SESSION_SCRIPT, f.root, { input: payload({ source: 'compact' }) })
  assert.ok(!existsSync(f.file))
})

test('SHORT: a handoff that does not fit is replaced by the fixed pointer, never printed clipped', (t) => {
  const root = repo(t)
  const longHandoff = `docs/plans/${'a'.repeat(100)}.md#구현-순서`
  const exact = `docs/plans/${'b'.repeat(69)}` // 정확히 80B
  assert.equal(bytesOf(exact), 80)
  write(root, 'docs/state/root/longho.md', detail('longho', { fields: { ...FULL_FIELDS, handoff: longHandoff } }))
  write(root, 'docs/state/root/exactho.md', detail('exactho', { touched: '2026-10-01T00:00', fields: { ...FULL_FIELDS, handoff: exact } }))
  commit(root, 'seed')
  const text = buildShortReminder(root, 'feat/x', ownedItems(root, 'feat/x'))
  assert.ok(text.includes('- 절차: detail frontmatter handoff 참고'))
  assert.ok(text.includes(`- 절차: ${exact}`), 'a path that fits is printed whole')
  assert.ok(!text.includes('aaaaa'), 'no clipped path')
  assert.doesNotMatch(text, /- 절차: docs\/plans\/a/)
  assert.ok(bytesOf(text) <= MAX_SHORT_BYTES)
})

// ---------- SessionStart 가 전체 알림이 닿지 못했을 때 기록을 지우는 경로 ----------

// node 대역: 경고 요약 호출만 가짜 JSON 을 내고 나머지는 진짜 node 로 넘긴다 (초기화 경고가 앞에서 커지는 상황을 만든다).
function nodeShim(t, initialization) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'state-focus-shim-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const json = join(dir, 'summary.json')
  writeFileSync(json, JSON.stringify({ initialization, summary: '=== STATE 정합·예산 (warn-only) ===' }))
  writeFileSync(join(dir, 'node'), `#!/bin/bash
case "$1" in
  *session-start-warning-summary.mjs) cat ${JSON.stringify(json)}; exit 0 ;;
esac
exec ${JSON.stringify(process.execPath)} "$@"
`)
  chmodSync(join(dir, 'node'), 0o755)
  return dir
}

function sessionStartWith(f, env = {}) {
  const result = run(SESSION_SCRIPT, f.root, { input: payload({ source: 'startup' }), env })
  assert.equal(result.status, 0, result.out)
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext
}

test('L4: SessionStart keeps the record when the focus block ends inside 5000B and forgets it when the block is pushed past 5000B', (t) => {
  const f = focusFixture(t)
  // 대조군: 초기화 경고가 작으면 알림 끝이 5000B 안 — 기록이 남는다.
  const small = sessionStartWith(f, { PATH: `${nodeShim(t, '=== STATE 검사 초기화 경고 ===\n- 작은 경고')}:${process.env.PATH}` })
  const smallEnd = bytesOf(small.slice(0, small.indexOf('\n\n=== STATE 정합·예산')))
  assert.ok(smallEnd <= 5000, `${smallEnd}B`)
  assert.ok(existsSync(f.file), 'record kept when the reminder fits')
  assert.equal(readRecord(f).sinceFull, 0)

  // 초기화 경고가 4000B 를 먹으면 알림 끝이 5000B 를 넘는다 — 기록을 지운다.
  const big = sessionStartWith(f, { PATH: `${nodeShim(t, `=== STATE 검사 초기화 경고 ===\n${'초'.repeat(1400)}`)}:${process.env.PATH}` })
  const focusAt = big.indexOf('=== STATE 현재 작업')
  assert.ok(focusAt >= 0 && bytesOf(big.slice(0, focusAt)) > 4000)
  assert.ok(bytesOf(big.slice(0, big.indexOf('\n\n=== STATE 정합·예산'))) > 5000)
  assert.ok(!existsSync(f.file), 'record forgotten when the reminder is pushed past the 5000B limit')
  assert.ok(f.isFull(f.turn()), 'so the next turn is full')
})

test('L4: SessionStart forgets the record when the focus step itself fails', (t) => {
  const f = focusFixture(t)
  sessionContext(f.root, { source: 'startup' })
  assert.ok(existsSync(f.file))
  const detailPath = join(f.root, 'docs/state/root/notes.md')
  chmodSync(detailPath, 0o000) // 읽을 수 없는 detail → 알림 엔진이 던진다
  t.after(() => { try { chmodSync(detailPath, 0o644) } catch { /* root 폴더가 먼저 지워졌을 수 있다 */ } })
  const context = sessionContext(f.root, { source: 'startup' })
  assert.match(context, /STATE 현재 작업 알림 실패/, 'the failure is shown in place of the reminder')
  assert.ok(!existsSync(f.file), 'record forgotten after a failed focus step')
})
