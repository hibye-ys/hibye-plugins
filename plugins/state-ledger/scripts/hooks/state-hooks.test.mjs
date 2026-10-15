import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const STOP_SCRIPT = fileURLToPath(new URL('./stop-state-reminder.sh', import.meta.url))
const ENGINE_SCRIPT = fileURLToPath(new URL('./state-turn-baseline.mjs', import.meta.url))
const STAMP_SCRIPT = fileURLToPath(new URL('./post-edit-state-stamp.sh', import.meta.url))
const SESSION_SCRIPT = fileURLToPath(new URL('./session-start-state-inject.sh', import.meta.url))
const SNAPSHOT_SCRIPT = fileURLToPath(new URL('./turn-start-state-snapshot.sh', import.meta.url))
const COMMIT_MSG_SCRIPT = fileURLToPath(new URL('./commit-msg-state-check.sh', import.meta.url))
const BRANCH_SYNC_SCRIPT = fileURLToPath(new URL('../check-state-branch-sync.sh', import.meta.url))
const WIP_CHECK_SCRIPT = fileURLToPath(new URL('../check-state-wip-cap.sh', import.meta.url))
const GLOBAL_SCRIPT = fileURLToPath(new URL('./global-state-hook.sh', import.meta.url))
const ANTIGRAVITY_PRE_INVOCATION = fileURLToPath(new URL('../../hooks/antigravity-pre-invocation.sh', import.meta.url))
const ANTIGRAVITY_POST_TOOL_USE = fileURLToPath(new URL('../../hooks/antigravity-post-tool-use.sh', import.meta.url))
const ANTIGRAVITY_STOP = fileURLToPath(new URL('../../hooks/antigravity-stop.sh', import.meta.url))

const EUNHA_WORK_INCLUDE_RE = String.raw`^(\.github/|\.(agents|claude|codex|design-sync|opencode|openai|system-sync)/|(scripts|patches|design|handoff|eslint-rules|supabase)/|docs/(decisions|operations)/|(apps|packages)/)|(^|/)Dockerfile$|^[^/]+\.(ts|tsx|js|jsx|mjs|cjs|sh|py|css|html|svg|ya?ml|json|sql|toml)$`
const EUNHA_WORK_EXCLUDE_RE = String.raw`^(apps|packages)/.*(AGENTS|CLAUDE|README|INVENTORY)\.md$`

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.excludesfile=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
  })
}

function write(root, relative, content) {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function runHook(script, root, payload, extraEnv = {}) {
  const result = spawnSync('bash', [script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOOK_PROJECT_DIR: root,
      STATE_HOOK_DATA_DIR: `${root}-hook-data`,
      ...extraEnv,
    },
    input: JSON.stringify(payload),
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function runGlobalHook(mode, root, payload, extraEnv = {}) {
  const result = spawnSync('bash', [GLOBAL_SCRIPT, mode], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOOK_PROJECT_DIR: root,
      STATE_HOOK_DATA_DIR: `${root}-hook-data`,
      ...extraEnv,
    },
    input: JSON.stringify(payload),
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function runEngine(root, payload, extraEnv = {}) {
  const result = spawnSync(process.execPath, [ENGINE_SCRIPT, 'evaluate'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOOK_PROJECT_DIR: root,
      STATE_HOOK_DATA_DIR: `${root}-hook-data`,
      ...extraEnv,
    },
    input: JSON.stringify(payload),
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function commit(root, paths, message) {
  git(root, ['add', '-A', '--', ...paths])
  git(root, ['commit', '-q', '-m', message])
}

function stop(root, sessionId, extraEnv = {}) {
  return runHook(STOP_SCRIPT, root, {
    session_id: sessionId,
    hook_event_name: 'Stop',
    stop_hook_active: false,
  }, extraEnv)
}

function stopMessage(root, sessionId, extraEnv = {}) {
  const output = stop(root, sessionId, extraEnv)
  assert.notEqual(output, '', 'expected a Stop reminder')
  return JSON.parse(output).systemMessage
}

// 기준점 커밋에 STATE 항목(인덱스 줄 + detail)을 둔다. 기본은 owner가 claim한 §1 활성 항목,
// section 2면 writeDetail처럼 §2 다음에 미착수 항목으로 둔다.
function seedStateItem(root, id, area = 'web', body = 'live item', section = 1) {
  const path = `docs/state/${area}/${id}.md`
  const index = area === 'root' ? 'STATE.md' : `apps/${area}/STATE.md`
  if (section === 1) {
    write(root, path, detail(id, body, false, area, 'agent'))
    const text = readFileSync(join(root, index), 'utf8')
    write(root, index, text.replace(/^(## 1\.[^\n]*\n)/m, `$1- [${id}] fixture\n`))
  } else {
    writeDetail(root, path, detail(id, body, false, area))
  }
  commit(root, [index, path], `seed [id=${id}]`)
  return path
}

function stateIndex(area) {
  return `# ${area} STATE

## 1. 활성

## 2. 다음

## 3. 미래

## 4. 미해결
`
}

function writeDetail(root, relative, content) {
  write(root, relative, content)
  const [, , area, filename] = relative.split('/')
  const id = filename.replace(/\.md$/, '')
  const indexPath = area === 'root' ? 'STATE.md' : `apps/${area}/STATE.md`
  const index = readFileSync(join(root, indexPath), 'utf8')
  if (!index.includes(`- [${id}]`)) {
    write(root, indexPath, index.replace('## 3. 미래', `- [${id}] fixture

## 3. 미래`))
  }
}

function withRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'state-hooks-'))
  try {
    git(root, ['init', '-q', '-b', 'main'])
    git(root, ['config', 'user.email', 'test@example.com'])
    git(root, ['config', 'user.name', 'test'])
    write(
      root,
      '.staterc',
      `STATE_INDEXES="STATE.md apps/api/STATE.md apps/web/STATE.md"\nSTATE_DEFAULT_BRANCH="main"\nSTATE_WORK_INCLUDE_RE="${EUNHA_WORK_INCLUDE_RE}"\nSTATE_WORK_EXCLUDE_RE="${EUNHA_WORK_EXCLUDE_RE}"\nSTATE_BRANCH_EXCLUDE="task-loop/* goal/*-itm-*"\n`,
    )
    write(root, 'STATE.md', stateIndex('root'))
    write(root, 'apps/api/STATE.md', stateIndex('api'))
    write(root, 'apps/web/STATE.md', stateIndex('web'))
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'base'])
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  }
}

function detail(id, body, stale = false, area = 'web', owner = '—') {
  const detailBody = `# ${id}

## 현재

${body}
`
  const serializedBody = `\n${detailBody}`
  const hash = stale ? 'stale' : createHash('sha256').update(serializedBody).digest('hex').slice(0, 8)
  return `---
id: ${id}
area: ${area}
owner: ${owner}
branch: —
touched: —
hash: ${hash}
---
${serializedBody}`
}

const GOAL_TRACK_PATH = 'docs/goal-runs/test-run/TRACK.md'

function executingGoalTrack(updated = '2026-08-09T14:00+09:00') {
  return `---
goal-run: test-run
phase: executing
updated: ${updated}
---

## Waves

| wave | 제목 | 의존 | 상태 | 리뷰 기록 |
| --- | --- | --- | --- | --- |
| w1 | test | - | in_progress | - |

## Items

| id | wave | 제목 | PLAN | 상태 | owner | branch | 검증 | 갱신 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| itm-test | w1 | test | PLAN-w1.md#itm-test | in_progress | worker | goal/test-run-itm-test | - | ${updated} |
`
}

function installExecutingGoal(root) {
  write(root, GOAL_TRACK_PATH, executingGoalTrack())
  git(root, ['add', GOAL_TRACK_PATH])
  git(root, ['commit', '-q', '-m', 'start executing goal'])
}

function headSha(root) {
  return git(root, ['rev-parse', 'HEAD']).trim()
}

function assertStamped(root, relative) {
  const text = readFileSync(join(root, relative), 'utf8')
  const match = text.match(/^---\n(.*?)\n---\n(.*)$/s)
  assert.ok(match)
  const [, frontmatter, body] = match
  const expected = createHash('sha256').update(body).digest('hex').slice(0, 8)
  assert.match(frontmatter, /^touched: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/m)
  assert.match(frontmatter, new RegExp(`^hash: ${expected}$`, 'm'))
}

test('Stop reminder reports an untagged commit in a new directory with the shared message shape', () =>
  withRepo((root) => {
    const sessionId = 'untracked-code'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/e2e/design-lab/graph-appearance/node.ts'
    write(root, codePath, 'export const node = true\n')
    commit(root, [codePath], 'add node fixture')

    const parsed = JSON.parse(stop(root, sessionId))

    const untaggedSha = headSha(root).slice(0, 7)
    assert.match(parsed.systemMessage, new RegExp(`커밋 메시지에 STATE \\[id=\\]가 없는 커밋 — ${untaggedSha} \\(${codePath}\\)\\.`))
    assert.match(parsed.systemMessage, /git commit --allow-empty -m "<sha> \[id=<id>\]"/)
    assert.match(parsed.systemMessage, /직접 만든 미push HEAD 커밋이면 git commit --amend/)
    assert.match(parsed.systemMessage, /정말 무관한 작업만 \[id=-\]/)
    assert.match(parsed.systemMessage, /STATE 내용을 고치거나 덧붙여서는 풀리지 않는다/)
    assert.doesNotMatch(parsed.systemMessage, /dirty STATE/)
    assert.equal(parsed.hookSpecificOutput, undefined)
  }))

test('SessionStart injects the shared STATE context shape', () =>
  withRepo((root) => {
    const output = runHook(SESSION_SCRIPT, root, {
      session_id: 'session-start',
      hook_event_name: 'SessionStart',
      source: 'startup',
    })
    const parsed = JSON.parse(output)

    assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart')
    assert.match(parsed.hookSpecificOutput.additionalContext, /=== STATE\.md ===/)
    assert.match(parsed.hookSpecificOutput.additionalContext, /=== apps\/web\/STATE\.md ===/)
    assert.match(
      parsed.hookSpecificOutput.additionalContext,
      /^STATE = 공유 상태판\. 남은 일·소유·결정이 바뀌면 그 줄을 바꿔 쓴다\. 작업 기록은 커밋 메시지 \[id=<id>\] \(STATE 항목과 무관하면 \[id=-\]\)\.\n\n=== STATE\.md ===/m,
    )
  }))

test('SessionStart rejects STATE_INDEXES traversal before reading outside the repository', () =>
  withRepo((root) => {
    const secretPath = `${root}-secret.txt`
    try {
      writeFileSync(secretPath, 'DO_NOT_EXPOSE_SENTINEL\n')
      write(root, '.staterc', `STATE_INDEXES="../${secretPath.split('/').at(-1)}"\n`)
      const output = runHook(SESSION_SCRIPT, root, {
        session_id: 'unsafe-state-index',
        hook_event_name: 'SessionStart',
        source: 'startup',
      })
      const context = JSON.parse(output).hookSpecificOutput.additionalContext
      assert.match(context, /STATE 설정 거부/)
      assert.doesNotMatch(context, /DO_NOT_EXPOSE_SENTINEL/)
    } finally {
      rmSync(secretPath, { force: true })
    }
  }))

test('SessionStart rejects a STATE index symlink that resolves outside the repository', () =>
  withRepo((root) => {
    const secretPath = `${root}-symlink-secret.txt`
    try {
      writeFileSync(secretPath, 'SYMLINK_SECRET_SENTINEL\n')
      mkdirSync(join(root, 'linked'), { recursive: true })
      symlinkSync(secretPath, join(root, 'linked', 'STATE.md'))
      write(root, '.staterc', 'STATE_INDEXES="linked/STATE.md"\n')
      const output = runHook(SESSION_SCRIPT, root, {
        session_id: 'unsafe-state-symlink',
        hook_event_name: 'SessionStart',
        source: 'startup',
      })
      const context = JSON.parse(output).hookSpecificOutput.additionalContext
      assert.match(context, /resolves outside the repository/)
      assert.doesNotMatch(context, /SYMLINK_SECRET_SENTINEL/)
    } finally {
      rmSync(secretPath, { force: true })
    }
  }))

test('SessionStart skips an oversized STATE index instead of injecting it', () =>
  withRepo((root) => {
    write(root, 'STATE.md', `OVERSIZED_SENTINEL\n${'x'.repeat(17_000)}\n`)
    const output = runHook(SESSION_SCRIPT, root, {
      session_id: 'oversized-state-index',
      hook_event_name: 'SessionStart',
      source: 'startup',
    })
    const context = JSON.parse(output).hookSpecificOutput.additionalContext
    assert.match(context, /주입 cap 16384B를 초과/)
    assert.doesNotMatch(context, /OVERSIZED_SENTINEL/)
  }))

test('SessionStart compact does not overwrite an active turn baseline', () =>
  withRepo((root) => {
    const sessionId = 'compact-mid-turn'
    runHook(SESSION_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'SessionStart',
      source: 'startup',
    })
    const codePath = 'apps/web/src/before-compact.ts'
    write(root, codePath, 'export const beforeCompact = true\n')
    commit(root, [codePath], 'commit before compact')

    runHook(SESSION_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'SessionStart',
      source: 'compact',
    })

    assert.match(stopMessage(root, sessionId), new RegExp(codePath))
  }))

test('Stop reminder stays silent when a STATE detail changed with code', () =>
  withRepo((root) => {
    const sessionId = 'code-with-state'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/changed.ts', 'export const changed = true\n')
    writeDetail(root, 'docs/state/web/work.md', detail('work', 'tracked in STATE'))

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.equal(output, '')
  }))

test('pre-existing STATE dirt does not hide code changed during this turn', () =>
  withRepo((root) => {
    const sessionId = 'old-state-new-code'
    writeDetail(root, 'docs/state/web/old-work.md', detail('old-work', 'older STATE change'))
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })

    const codePath = 'apps/web/src/new-change.ts'
    write(root, codePath, 'export const changedThisTurn = true\n')
    commit(root, [codePath], 'code only')

    assert.match(stopMessage(root, sessionId), new RegExp(codePath))
  }))

test('pre-existing code dirt does not create a false reminder for an unchanged turn', () =>
  withRepo((root) => {
    const sessionId = 'old-code-no-change'
    write(root, 'apps/web/src/older-change.ts', 'export const older = true\n')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.equal(output, '')
  }))

test('STATE reminder is unchanged when an executing goal exists', () =>
  withRepo((root) => {
    installExecutingGoal(root)
    const sessionId = 'state-independent-from-goal'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/state-still-global.ts'
    write(root, codePath, 'export const stateStillGlobal = true\n')
    commit(root, [codePath], 'code only')

    const output = JSON.parse(
      runHook(STOP_SCRIPT, root, {
        session_id: sessionId,
        hook_event_name: 'Stop',
        stop_hook_active: false,
      }),
    )

    assert.match(output.systemMessage, new RegExp(codePath))
    assert.equal(output.decision, undefined)
  }))

test('content hashing detects another edit to a code file that was already dirty without creating debt', () =>
  withRepo((root) => {
    const sessionId = 'dirty-code-edited-again'
    const codePath = 'apps/web/src/already-dirty.ts'
    write(root, codePath, 'export const revision = 1\n')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, codePath, 'export const revision = 2\n')

    const result = runEngine(root, { session_id: sessionId })

    assert.deepEqual(result.codeChanged, [codePath])
    assert.deepEqual(result.debt, [])
  }))

test('another edit to an already-dirty STATE detail is a meaningful STATE change', () =>
  withRepo((root) => {
    const sessionId = 'dirty-state-edited-again'
    const statePath = 'docs/state/web/existing.md'
    writeDetail(root, statePath, detail('existing', 'revision 1'))
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, statePath, detail('existing', 'revision 2'))

    const result = runEngine(root, { session_id: sessionId })

    assert.deepEqual(result.stateChanged, [statePath])
  }))

test('STATE from the wrong area does not cover a web code delta', () =>
  withRepo((root) => {
    const sessionId = 'wrong-area-state'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/web-only.ts'
    write(root, codePath, 'export const webOnly = true\n')
    commit(root, [codePath], 'web code')
    writeDetail(root, 'docs/state/api/wrong-area.md', detail('wrong-area', 'API STATE change', false, 'api'))
    commit(root, ['apps/api/STATE.md', 'docs/state/api/wrong-area.md'], 'api state')

    assert.match(stopMessage(root, sessionId), new RegExp(`[0-9a-f]{7} \\(${codePath}\\)`))
  }))

test('custom STATE_INDEXES derive a non-EUNHA area without hardcoded paths', () =>
  withRepo((root) => {
    write(
      root,
      '.staterc',
      'STATE_INDEXES="STATE.md services/worker/STATE.md"\nSTATE_DEFAULT_BRANCH="main"\nSTATE_WORK_INCLUDE_RE=".*"\nSTATE_WORK_EXCLUDE_RE="a^"\nSTATE_BRANCH_EXCLUDE="task-loop/*"\n',
    )
    write(root, 'services/worker/STATE.md', '# worker STATE\n')
    git(root, ['add', '.staterc', 'services/worker/STATE.md'])
    git(root, ['commit', '-q', '-m', 'configure worker ledger'])

    const sessionId = 'custom-worker-area'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'services/worker/src/job.ts'
    write(root, codePath, 'export const job = true\n')
    commit(root, [codePath], 'worker job')

    assert.match(stopMessage(root, sessionId), new RegExp(`[0-9a-f]{7} \\(${codePath}\\)`))
  }))

test('web SVG HTML and PNG changes are tracked as work files', () =>
  withRepo((root) => {
    const sessionId = 'web-assets'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const paths = [
      'apps/web/public/icons/new-mark.svg',
      'apps/web/e2e/harness/new-view.html',
      'apps/web/src/assets/new-scene.png',
    ]
    for (const path of paths) write(root, path, `asset:${path}\n`)
    commit(root, paths, 'web assets')

    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt.map((item) => item.path), [...paths].sort())
  }))

test('root infrastructure and Supabase files are tracked as work files', () =>
  withRepo((root) => {
    const sessionId = 'root-infrastructure'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const paths = [
      '.github/actions/setup/action.yml',
      'eslint-rules/no-example-rule.js',
      'supabase/config.toml',
      '.agents/hooks/example.mjs',
      '.design-sync/previews/NewSurface.tsx',
      '.system-sync/system/root/overview.md',
      'docs/decisions/new-runtime-rule.md',
      'docs/operations/new-runbook.md',
    ]
    for (const path of paths) write(root, path, `fixture:${path}\n`)
    commit(root, paths, 'root infrastructure')

    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt.map((item) => item.path), [...paths].sort())
  }))

test('deleting a required STATE index cannot cover code work', () =>
  withRepo((root) => {
    const sessionId = 'deleted-state-index'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/deleted-index.ts'
    write(root, codePath, 'export const deletedIndex = true\n')
    commit(root, [codePath], 'code only')
    rmSync(join(root, 'apps/web/STATE.md'))
    commit(root, ['apps/web/STATE.md'], 'drop web index')

    const message = stopMessage(root, sessionId)

    assert.match(message, new RegExp(codePath))
    assert.match(message, /apps\/web\/STATE\.md 없음 — 필수 STATE 인덱스 소실/)
  }))

test('a structurally invalid STATE edit cannot clear debt', () =>
  withRepo((root) => {
    const sessionId = 'invalid-state-area'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/invalid-state.ts'
    write(root, codePath, 'export const invalidState = true\n')
    commit(root, [codePath], 'code only')
    write(root, 'docs/state/web/invalid.md', detail('invalid', 'invalid acknowledgement'))
    commit(root, ['docs/state/web/invalid.md'], 'orphan detail')

    const message = stopMessage(root, sessionId)

    assert.match(message, new RegExp(codePath))
    assert.match(message, /docs\/state\/web\/invalid\.md — apps\/web\/STATE\.md 인덱스에 없음/)
  }))

test('STATE release warnings stay silent when no debt remains', () =>
  withRepo((root) => {
    const statePath = 'docs/state/web/quiet.md'
    writeDetail(root, statePath, detail('quiet', 'unchanged ledger body'))
    commit(root, ['apps/web/STATE.md', statePath], 'state baseline [id=quiet]')
    const sessionId = 'quiet-release-warnings'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/quiet.ts', 'export const quiet = true\n')
    write(root, statePath, readFileSync(join(root, statePath), 'utf8').replace('touched: —', 'touched: 2026-08-09T16:00'))

    const result = runEngine(root, { session_id: sessionId })

    assert.deepEqual(result.debt, [])
  }))

test('metadata-only STATE changes cannot clear debt', () =>
  withRepo((root) => {
    const statePath = 'docs/state/web/metadata.md'
    writeDetail(root, statePath, detail('metadata', 'unchanged ledger body'))
    git(root, ['add', statePath])
    git(root, ['commit', '-q', '-m', 'state baseline'])
    const sessionId = 'metadata-only-state'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/metadata-only.ts'
    write(root, codePath, 'export const metadataOnly = true\n')
    commit(root, [codePath], 'code only')
    const metadata = readFileSync(join(root, statePath), 'utf8').replace(
      'touched: —',
      'touched: 2026-08-09T16:00',
    )
    write(root, statePath, metadata)
    commit(root, [statePath], 'touch state metadata')

    const message = stopMessage(root, sessionId)

    assert.match(message, new RegExp(codePath))
    assert.doesNotMatch(message, /touched\/hash·주석·공백만/)
  }))

test('an owner claim is a meaningful STATE change but does not release commit debt', () =>
  withRepo((root) => {
    const statePath = 'docs/state/web/owner-claim.md'
    writeDetail(root, statePath, detail('owner-claim', 'same ledger body'))
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'unclaimed state'])
    const sessionId = 'owner-claim-state'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/owner-claim.ts', 'export const ownerClaim = true\n')
    commit(root, ['apps/web/src/owner-claim.ts'], 'code only')
    const claimed = readFileSync(join(root, statePath), 'utf8').replace('owner: —', 'owner: Codex')
    write(root, statePath, claimed)
    commit(root, [statePath], 'claim [id=owner-claim]')

    const result = runEngine(root, { session_id: sessionId })
    assert.deepEqual(result.debt.map((item) => item.path), ['apps/web/src/owner-claim.ts'])
  }))

test('uncommitted work alone creates no debt and drops legacy working debt', () =>
  withRepo((root) => {
    const sessionId = 'uncommitted-only'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const dataDir = `${root}-hook-data`
    const [snapshotFile] = readdirSync(dataDir).filter((name) => name.endsWith('.json'))
    const snapshotPath = join(dataDir, snapshotFile)
    const saved = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    const headSha = git(root, ['rev-parse', 'HEAD']).trim()
    const carried = {
      path: 'apps/web/src/old-committed.ts',
      channel: 'committed',
      sha: headSha,
      reason: 'untagged',
      ids: [],
    }
    saved.debt = [
      { path: 'apps/web/src/old-working.ts', area: 'web', channel: 'working' },
      { path: 'apps/web/src/old-legacy.ts', area: 'web' },
      { path: 'apps/web/src/old-v03-committed.ts', area: 'web', channel: 'committed' },
      carried,
    ]
    writeFileSync(snapshotPath, `${JSON.stringify(saved)}\n`)
    write(root, 'apps/web/src/dirty-only.ts', 'export const dirtyOnly = true\n')

    const result = runEngine(root, { session_id: sessionId })

    assert.deepEqual(result.codeChanged, ['apps/web/src/dirty-only.ts'])
    assert.deepEqual(result.debt, [carried])
    assert.deepEqual(result.freshDebt, [])
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const message = stopMessage(root, sessionId)
    assert.match(message, /old-committed\.ts/)
    assert.doesNotMatch(message, /old-working|old-legacy|old-v03|dirty-only/)
  }))

test('global branch sync ignores goal item branches but still reports ordinary orphan branches', () =>
  withRepo((root) => {
    const baseBranch = git(root, ['branch', '--show-current']).trim()
    git(root, ['branch', 'goal/test-run'])
    git(root, ['checkout', '-q', '-b', 'goal/test-run-itm-orphan', 'goal/test-run'])
    write(root, 'goal-item.txt', 'goal item\n')
    git(root, ['add', 'goal-item.txt'])
    git(root, ['commit', '-q', '-m', 'goal item'])
    git(root, ['checkout', '-q', baseBranch])
    git(root, ['checkout', '-q', '-b', 'feature-orphan'])
    write(root, 'ordinary.txt', 'ordinary\n')
    git(root, ['add', 'ordinary.txt'])
    git(root, ['commit', '-q', '-m', 'ordinary branch'])
    git(root, ['checkout', '-q', baseBranch])

    const result = spawnSync('bash', [BRANCH_SYNC_SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOOK_PROJECT_DIR: root },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stdout, /goal\/test-run-itm-orphan/)
    assert.match(result.stdout, /feature-orphan/)
  }))

test('commit-msg requires every changed detail id, not an unrelated id', () =>
  withRepo((root) => {
    write(root, 'docs/state/web/actual-id.md', detail('actual-id', 'changed'))
    git(root, ['add', 'docs/state/web/actual-id.md'])
    const messagePath = join(root, '.git/COMMIT_EDITMSG')
    writeFileSync(messagePath, 'test [id=wrong-id]\n')

    const result = spawnSync('bash', [COMMIT_MSG_SCRIPT, messagePath], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0)
    assert.match(result.stderr, /\[id=actual-id\]/)
  }))

test('commit-msg derives ids from index-only STATE changes', () =>
  withRepo((root) => {
    write(root, 'apps/web/STATE.md', '# web STATE\n- [index-only] changed\n')
    git(root, ['add', 'apps/web/STATE.md'])
    const messagePath = join(root, '.git/COMMIT_EDITMSG')
    writeFileSync(messagePath, 'index update\n')

    const result = spawnSync('bash', [COMMIT_MSG_SCRIPT, messagePath], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0)
    assert.match(result.stderr, /\[id=index-only\]/)
  }))

test('commit-msg treats a renamed detail as an archive of the old id', () =>
  withRepo((root) => {
    writeDetail(root, 'docs/state/web/old-id.md', detail('old-id', 'before rename'))
    git(root, ['add', 'apps/web/STATE.md', 'docs/state/web/old-id.md'])
    git(root, ['commit', '-q', '-m', 'add old id'])

    git(root, ['mv', 'docs/state/web/old-id.md', 'docs/state/web/new-id.md'])
    write(root, 'docs/state/web/new-id.md', detail('new-id', 'after rename'))
    const index = readFileSync(join(root, 'apps/web/STATE.md'), 'utf8')
    write(root, 'apps/web/STATE.md', index.replace('[old-id]', '[new-id]'))
    git(root, ['add', 'apps/web/STATE.md', 'docs/state/web/new-id.md'])
    const messagePath = join(root, '.git/COMMIT_EDITMSG')
    writeFileSync(messagePath, 'rename [id=old-id] [id=new-id]\n')

    const result = spawnSync('bash', [COMMIT_MSG_SCRIPT, messagePath], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0)
    assert.match(result.stderr, /archive \[id=old-id\]/)
  }))

test('strict structural check fails when a required STATE index is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-check-missing-'))
  try {
    write(root, '.staterc', 'STATE_INDEXES="STATE.md apps/web/STATE.md"\n')
    const result = spawnSync('bash', [WIP_CHECK_SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, STATE_CHECK_AREA: 'web', STATE_CHECK_STRICT: '1' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /apps\/web\/STATE\.md 없음/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('repository checkers resolve their helper when invoked by a relative script path', () =>
  withRepo((root) => {
    const pluginRoot = dirname(dirname(dirname(dirname(WIP_CHECK_SCRIPT))))
    const relativeWip = WIP_CHECK_SCRIPT.slice(pluginRoot.length + 1)
    const relativeBranch = BRANCH_SYNC_SCRIPT.slice(pluginRoot.length + 1)
    for (const script of [relativeWip, relativeBranch]) {
      const result = spawnSync('bash', [script], {
        cwd: pluginRoot,
        encoding: 'utf8',
        env: { ...process.env, HOOK_PROJECT_DIR: root },
      })
      assert.equal(result.status, 0, result.stderr)
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Cannot find module|No such file or directory/)
    }
  }))

test('strict structural check rejects a placeholder owner in the active section', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-check-owner-'))
  try {
    write(root, '.staterc', 'STATE_INDEXES="STATE.md apps/web/STATE.md"\n')
    write(root, 'apps/web/STATE.md', `# web STATE

## 1. 활성

- [work] active

## 2. 다음

## 3. 미래

## 4. 미해결
`)
    write(root, 'docs/state/web/work.md', detail('work', 'active work'))
    const result = spawnSync('bash', [WIP_CHECK_SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, STATE_CHECK_AREA: 'web', STATE_CHECK_STRICT: '1' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /유효한 frontmatter owner 없음/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('API prompt Markdown changes are tracked as API work', () =>
  withRepo((root) => {
    const sessionId = 'api-prompt-markdown'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const promptPath = 'apps/api/src/prompts/agents/new-agent.md'
    write(root, promptPath, '# runtime prompt\n')
    commit(root, [promptPath], 'prompt only')

    assert.match(stopMessage(root, sessionId), new RegExp(`[0-9a-f]{7} \\(${promptPath}\\)`))
  }))

test('shipped defaults track runtime assets and prompts but ignore goal-run Markdown', () =>
  withRepo((root) => {
    write(
      root,
      '.staterc',
      'STATE_INDEXES="STATE.md apps/api/STATE.md apps/web/STATE.md"\nSTATE_DEFAULT_BRANCH="main"\nSTATE_BRANCH_EXCLUDE="task-loop/* goal/*-itm-*"\n',
    )
    git(root, ['add', '.staterc'])
    git(root, ['commit', '-q', '-m', 'use shipped work classifier'])

    const sessionId = 'default-work-classifier'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const tracked = [
      '.agents/hooks/session.mjs',
      'apps/api/src/prompts/agents/runtime.md',
      'apps/web/public/scene.png',
    ]
    for (const path of tracked) write(root, path, `fixture:${path}\n`)
    write(root, 'docs/goal-runs/example/TRACK.md', '# goal-only bookkeeping\n')
    commit(root, [...tracked, 'docs/goal-runs/example/TRACK.md'], 'runtime assets')

    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt.map((item) => item.path), [...tracked].sort())
  }))

test('work include and exclude use one JavaScript RegExp contract', () =>
  withRepo((root) => {
    write(
      root,
      '.staterc',
      'STATE_INDEXES="STATE.md apps/api/STATE.md apps/web/STATE.md"\nSTATE_WORK_INCLUDE_RE="^(?!docs/goal-runs/).*\\.md$"\nSTATE_WORK_EXCLUDE_RE="(^|/)README\\.md$"\n',
    )
    git(root, ['add', '.staterc'])
    git(root, ['commit', '-q', '-m', 'configure JavaScript regex'])

    const sessionId = 'javascript-regexp'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/prompts/runtime.md', '# tracked\n')
    write(root, 'apps/web/README.md', '# excluded\n')
    write(root, 'docs/goal-runs/example/TRACK.md', '# excluded goal\n')
    commit(root, ['apps/web/src/prompts/runtime.md', 'apps/web/README.md', 'docs/goal-runs/example/TRACK.md'], 'markdown')

    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt.map((item) => item.path), ['apps/web/src/prompts/runtime.md'])
  }))

test('.staterc is always tracked as root work even when a custom include regex omits it', () =>
  withRepo((root) => {
    const sessionId = 'staterc-is-work'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const current = readFileSync(join(root, '.staterc'), 'utf8')
    write(root, '.staterc', `${current}# behavior changed\n`)
    commit(root, ['.staterc'], 'tune staterc')

    assert.match(stopMessage(root, sessionId), /[0-9a-f]{7} \(\.staterc\)/)
  }))

test('global dispatcher is inert outside an onboarded STATE repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-global-noop-'))
  try {
    git(root, ['init', '-q', '-b', 'main'])
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-noop',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'codex' })
    assert.equal(output, '')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  }
})

test('global dispatcher runs plugin-owned lifecycle without project script copies', () =>
  withRepo((root) => {
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-plugin-runtime',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'codex' })
    assert.match(JSON.parse(output).hookSpecificOutput.additionalContext, /=== STATE\.md ===/)
  }))

test('global dispatcher suppresses an active project-local Codex TOML hook during migration', () =>
  withRepo((root) => {
    write(root, '.codex/config.toml', '[[hooks.SessionStart.hooks]]\ncommand = "bash scripts/hooks/session-start-state-inject.sh"\n')
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-deduplicate',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'codex' })
    assert.equal(output, '')
  }))

test('global dispatcher detects multiline Codex TOML hook commands', () =>
  withRepo((root) => {
    write(root, '.codex/config.toml', `[[hooks.SessionStart.hooks]]
type = "command"
command = """
bash scripts/hooks/session-start-state-inject.sh
"""
`)
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-multiline-deduplicate',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'codex' })
    assert.equal(output, '')
  }))

test('global dispatcher detects inline-table Codex TOML hook commands', () =>
  withRepo((root) => {
    write(root, '.codex/config.toml', `hooks = [{ type = "command", command = 'bash scripts/hooks/session-start-state-inject.sh' }]
`)
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-inline-table-deduplicate',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'codex' })
    assert.equal(output, '')
  }))

test('global dispatcher detects a project-local hook through a regular config symlink', () =>
  withRepo((root) => {
    write(root, '.codex/config.shared.toml', `[[hooks.SessionStart.hooks]]
"command" = '''
bash scripts/hooks/session-start-state-inject.sh
'''
`)
    symlinkSync('config.shared.toml', join(root, '.codex/config.toml'))
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-symlinked-config-deduplicate',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'codex' })
    assert.equal(output, '')
  }))

test('global dispatcher ignores a commented-out project-local Codex hook', () =>
  withRepo((root) => {
    write(root, '.codex/config.toml', '# command = "bash scripts/hooks/session-start-state-inject.sh"\n')
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-comment-is-not-hook',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'codex' })
    assert.match(JSON.parse(output).hookSpecificOutput.additionalContext, /=== STATE\.md ===/)
  }))

test('global dispatcher ignores unrelated TOML strings that mention a hook script', () =>
  withRepo((root) => {
    write(root, '.codex/config.toml', `description = "example: command = bash scripts/hooks/session-start-state-inject.sh"
[mcp_servers.lookalike]
command = "bash scripts/hooks/session-start-state-inject.sh"
`)
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-unrelated-string',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'codex' })
    assert.match(JSON.parse(output).hookSpecificOutput.additionalContext, /=== STATE\.md ===/)
  }))

test('global dispatcher detects an active project-local Codex hooks.json command', () =>
  withRepo((root) => {
    write(root, '.codex/hooks.json', JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'bash scripts/hooks/session-start-state-inject.sh' }] }],
      },
    }))
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-hooks-json-deduplicate',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'codex' })
    assert.equal(output, '')
  }))

test('global dispatcher detects only typed Claude command hooks', () =>
  withRepo((root) => {
    write(root, '.claude/settings.json', JSON.stringify({
      note: 'bash scripts/hooks/session-start-state-inject.sh',
      unrelated: { type: 'command', command: 'bash scripts/hooks/session-start-state-inject.sh' },
      hooks: {
        SessionStart: [{ hooks: [{ type: 'prompt', command: 'bash scripts/hooks/session-start-state-inject.sh' }] }],
      },
    }))
    const firstOutput = runGlobalHook('session-start', root, {
      session_id: 'global-claude-non-command',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'claude' })
    assert.match(JSON.parse(firstOutput).hookSpecificOutput.additionalContext, /=== STATE\.md ===/)

    write(root, '.claude/settings.local.json', JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'bash scripts/hooks/session-start-state-inject.sh' }] }],
      },
    }))
    const secondOutput = runGlobalHook('session-start', root, {
      session_id: 'global-claude-command',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'claude' })
    assert.equal(secondOutput, '')
  }))

test('a local Claude hook does not suppress the opencode adapter', () =>
  withRepo((root) => {
    write(root, '.claude/settings.json', JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{
          type: 'command',
          command: 'bash scripts/hooks/session-start-state-inject.sh',
        }] }],
      },
    }))
    const output = runGlobalHook('session-start', root, {
      session_id: 'opencode-not-claude',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, { STATE_LEDGER_HOST: 'opencode' })
    assert.match(JSON.parse(output).hookSpecificOutput.additionalContext, /=== STATE\.md ===/)
  }))

test('baseline storage failure is visible instead of silently downgrading', () =>
  withRepo((root) => {
    const sessionId = 'baseline-write-failure'
    const invalidDataDir = '/dev/null/eunha-state-hooks'
    const snapshotOutput = runHook(
      SNAPSHOT_SCRIPT,
      root,
      { session_id: sessionId },
      { STATE_HOOK_DATA_DIR: invalidDataDir },
    )
    assert.match(JSON.parse(snapshotOutput).systemMessage, /기준점 저장 실패/)

    const codePath = 'apps/web/src/failure-visible.ts'
    write(root, codePath, 'export const visible = true\n')
    const stopOutput = runHook(
      STOP_SCRIPT,
      root,
      {
        session_id: sessionId,
        hook_event_name: 'Stop',
        stop_hook_active: false,
      },
      { STATE_HOOK_DATA_DIR: invalidDataDir },
    )

    const message = JSON.parse(stopOutput).systemMessage
    assert.match(message, /기준점 평가 실패/)
    assert.doesNotMatch(message, /coarse fallback/)
  }))

test('a commit tagged with a live STATE id creates no debt', () =>
  withRepo((root) => {
    seedStateItem(root, 'live-item')
    const sessionId = 'tagged-commit'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/tagged.ts'
    write(root, codePath, 'export const tagged = true\n')
    commit(root, [codePath], 'implement tagged work [id=live-item]')
    write(root, 'apps/web/src/chore.ts', 'export const chore = true\n')
    commit(root, ['apps/web/src/chore.ts'], 'bump tooling unrelated to any item [id=-]')

    const result = runEngine(root, { session_id: sessionId })
    assert.deepEqual(result.debt, [])
    assert.deepEqual(result.freshDebt, [])
  }))

test('a tagged commit needs no STATE edit even when Stop runs the full hook', () =>
  withRepo((root) => {
    seedStateItem(root, 'hook-item')
    const sessionId = 'tagged-commit-hook'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/api/src/route.ts', 'export const route = true\n')
    write(root, 'apps/web/src/view.ts', 'export const view = true\n')
    commit(root, ['apps/api/src/route.ts', 'apps/web/src/view.ts'], 'cross-area work [id=hook-item]')

    assert.equal(stop(root, sessionId), '')
  }))

test('a commit tagged with an unknown id is still debt', () =>
  withRepo((root) => {
    seedStateItem(root, 'real-id')
    const sessionId = 'unknown-tag'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/unknown-tag.ts'
    write(root, codePath, 'export const unknownTag = true\n')
    commit(root, [codePath], 'work [id=no-such-id]')

    assert.match(stopMessage(root, sessionId), new RegExp(`[0-9a-f]{7} \\[id=no-such-id\\] \\(${codePath}\\)`))
  }))

test('a path changed by both tagged and untagged commits stays in debt', () =>
  withRepo((root) => {
    seedStateItem(root, 'mixed')
    const sessionId = 'mixed-tags'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/mixed.ts'
    write(root, codePath, 'export const version = 1\n')
    commit(root, [codePath], 'first pass [id=mixed]')
    write(root, codePath, 'export const version = 2\n')
    commit(root, [codePath], 'quick fix')

    const quickFix = git(root, ['rev-parse', 'HEAD']).trim()

    const result = runEngine(root, { session_id: sessionId })
    assert.deepEqual(result.debt, [
      { path: codePath, channel: 'committed', sha: quickFix, reason: 'untagged', ids: [] },
    ])
  }))

test('an archive commit for an id removed from STATE covers the work it carries', () =>
  withRepo((root) => {
    const detailPath = seedStateItem(root, 'gone', 'root')
    const sessionId = 'archive-tag'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'STATE.md', readFileSync(join(root, 'STATE.md'), 'utf8').replace('- [gone] fixture\n', ''))
    rmSync(join(root, detailPath))
    const codePath = 'apps/web/src/finished.ts'
    write(root, codePath, 'export const finished = true\n')
    commit(root, ['STATE.md', detailPath, codePath], 'finish the work archive [id=gone]')

    const result = runEngine(root, { session_id: sessionId })
    assert.doesNotMatch(readFileSync(join(root, 'STATE.md'), 'utf8'), /\[gone\]/)
    assert.deepEqual(result.debt, [])
  }))

test('merge commits are not judged on their own', () =>
  withRepo((root) => {
    seedStateItem(root, 'merge-item')
    git(root, ['checkout', '-q', '-b', 'feature'])
    write(root, 'apps/web/src/feature.ts', 'export const feature = true\n')
    commit(root, ['apps/web/src/feature.ts'], 'feature work [id=merge-item]')
    git(root, ['checkout', '-q', 'main'])
    write(root, 'apps/api/src/mainline.ts', 'export const mainline = true\n')
    commit(root, ['apps/api/src/mainline.ts'], 'mainline work [id=merge-item]')
    const sessionId = 'merge-commit'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['merge', '-q', '--no-ff', '-m', "Merge branch 'feature'", 'feature'])

    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])
  }))

test('untagged committed debt survives STATE edits and is released by a commit naming its sha', () =>
  withRepo((root) => {
    seedStateItem(root, 'debt')
    const sessionId = 'persistent-debt'
    const codePath = 'apps/web/src/debt.ts'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, codePath, 'export const debt = true\n')
    commit(root, [codePath], 'code only')
    const untaggedSha = git(root, ['rev-parse', 'HEAD']).trim()
    assert.match(stopMessage(root, sessionId), new RegExp(`${untaggedSha.slice(0, 7)} \\(${codePath}\\)`))

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    assert.match(stopMessage(root, sessionId), new RegExp(codePath))

    // 0.3.x처럼 STATE에 경과를 덧붙여 커밋해도 debt는 풀리지 않는다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'docs/state/web/debt.md', detail('debt', 'live item\n\n- 턴 경과: debt.ts 구현 완료', false, 'web', 'agent'))
    commit(root, ['docs/state/web/debt.md'], 'record progress [id=debt]')
    assert.match(stopMessage(root, sessionId), new RegExp(codePath))

    // 커밋 메시지에 남긴 [id=-]만으로는 sha가 없으면 해제되지 않는다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['commit', '-q', '--allow-empty', '-m', 'unrelated note [id=-]'])
    assert.match(stopMessage(root, sessionId), new RegExp(codePath))

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['commit', '-q', '--allow-empty', '-m', `record ${untaggedSha.slice(0, 7)} as debt work [id=debt]`])
    assert.equal(stop(root, sessionId), '')
  }))

test('untagged committed debt is released by a later tagged commit to the same path', () =>
  withRepo((root) => {
    seedStateItem(root, 'tag-later')
    const sessionId = 'debt-released-by-tag'
    const codePath = 'apps/web/src/tag-later.ts'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, codePath, 'export const version = 1\n')
    commit(root, [codePath], 'untagged change')
    assert.match(stopMessage(root, sessionId), new RegExp(codePath))

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/other.ts', 'export const other = true\n')
    commit(root, ['apps/web/src/other.ts'], 'other work [id=tag-later]')
    assert.match(stopMessage(root, sessionId), new RegExp(codePath))

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, codePath, 'export const version = 2\n')
    commit(root, [codePath], 'follow-up [id=tag-later]')
    assert.equal(stop(root, sessionId), '')
  }))

test('code committed during the turn is still compared with STATE', () =>
  withRepo((root) => {
    const sessionId = 'committed-code'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/committed.ts'
    write(root, codePath, 'export const committed = true\n')
    commit(root, [codePath], 'code only')

    assert.match(stopMessage(root, sessionId), new RegExp(codePath))
  }))

test('STATE edits never cover untagged commits, whatever their order or channel', () =>
  withRepo((root) => {
    const cases = [
      ['state-commit-before', (codePath) => {
        writeDetail(root, 'docs/state/web/early.md', detail('early', 'state first'))
        commit(root, ['apps/web/STATE.md', 'docs/state/web/early.md'], 'state first [id=early]')
        write(root, codePath, 'export const v = 1\n')
        commit(root, [codePath], 'code after state')
      }],
      ['state-commit-after', (codePath) => {
        write(root, codePath, 'export const v = 1\n')
        commit(root, [codePath], 'code first')
        writeDetail(root, 'docs/state/web/late.md', detail('late', 'state after code'))
        commit(root, ['apps/web/STATE.md', 'docs/state/web/late.md'], 'state after code [id=late]')
      }],
      ['dirty-state', (codePath) => {
        write(root, codePath, 'export const v = 1\n')
        commit(root, [codePath], 'commit code only')
        writeDetail(root, 'docs/state/web/dirty.md', detail('dirty', 'dirty state later'))
      }],
    ]
    for (const [sessionId, act] of cases) {
      runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
      const codePath = `apps/web/src/${sessionId}.ts`
      act(codePath)
      const message = stopMessage(root, sessionId)
      assert.match(message, new RegExp(`[0-9a-f]{7} \\(${codePath}\\)`), sessionId)
      assert.doesNotMatch(message, /앞서|아직 커밋되지 않아|dirty STATE/, sessionId)
      git(root, ['add', '-A'])
      git(root, ['commit', '-q', '--allow-empty', '-m', `settle ${sessionId} [id=-]`])
    }
  }))

test('concurrent sessions hold new attribution but still apply releases', () =>
  withRepo((root) => {
    seedStateItem(root, 'held')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: 'concurrent-a' })
    write(root, 'apps/web/src/held.ts', 'export const version = 1\n')
    commit(root, ['apps/web/src/held.ts'], 'untagged held work')
    assert.match(stopMessage(root, 'concurrent-a'), /held\.ts/)

    runHook(SNAPSHOT_SCRIPT, root, { session_id: 'concurrent-a' })
    runHook(SNAPSHOT_SCRIPT, root, { session_id: 'concurrent-b' })
    write(root, 'apps/web/src/concurrent.ts', 'export const concurrent = true\n')
    commit(root, ['apps/web/src/concurrent.ts'], 'untagged concurrent work')
    write(root, 'apps/web/src/held.ts', 'export const version = 2\n')
    commit(root, ['apps/web/src/held.ts'], 'tagged follow-up [id=held]')

    // 보류 중에도 같은 경로의 [id=] 커밋은 이전 debt를 푼다. id 없는 새 커밋은 debt로 만들지 않는다.
    const message = stopMessage(root, 'concurrent-a')
    assert.match(message, /다른 활성 세션 1개/)
    assert.doesNotMatch(message, /held\.ts|concurrent\.ts/)
    assert.deepEqual(runEngine(root, { session_id: 'concurrent-a' }).debt, [])

    const secondMessage = stopMessage(root, 'concurrent-b')
    assert.match(secondMessage, /다른 활성 세션 1개/)
    assert.doesNotMatch(secondMessage, /커밋 메시지에 STATE \[id=\]가 없는 커밋/)
  }))

test('Stop flags a detail body that grew by more than 1KB once and stays quiet on rewrites', () =>
  withRepo((root) => {
    const statePath = seedStateItem(root, 'grow', 'web', 'short summary')
    const sessionId = 'appended-body'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const appendedBody = `short summary\n\n${'- 작업 경과 기록\n'.repeat(80)}`
    write(root, statePath, detail('grow', appendedBody, false, 'web', 'agent'))
    assert.match(
      stopMessage(root, sessionId),
      /docs\/state\/web\/grow\.md 본문이 \d+ B 늘었습니다 — 작업 경과를 덧붙이지 말고 남은 일·결정·WHY를 바꿔 쓰세요\./,
    )

    // 알린 증가는 다시 알리지 않는다. 다음 턴의 작은 편집은 조용하다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, statePath, detail('grow', `${appendedBody}- 한 줄 더\n`, false, 'web', 'agent'))
    assert.deepEqual(runEngine(root, { session_id: sessionId }).appendedDetails, [])

    // 바꿔 쓰기와 새 항목 생성은 덧붙임이 아니다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, statePath, detail('grow', 'rewritten summary — 남은 일과 결정만', false, 'web', 'agent'))
    writeDetail(root, 'docs/state/web/fresh.md', detail('fresh', 'n'.repeat(1500)))
    assert.deepEqual(runEngine(root, { session_id: sessionId }).appendedDetails, [])

    // ## 원장에 쌓는 경과도 같은 본문 기준으로 본다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, statePath, detail('grow', `rewritten summary\n\n## 원장\n\n${'- 턴 실측 기록\n'.repeat(80)}`, false, 'web', 'agent'))
    assert.deepEqual(runEngine(root, { session_id: sessionId }).appendedDetails.map((entry) => entry.path), [statePath])
  }))

test('detail and ## 현재 size caps warn without failing the strict structural check', () =>
  withRepo((root) => {
    const sessionId = 'size-caps'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/size-caps.ts'
    write(root, codePath, 'export const sizeCaps = true\n')
    commit(root, [codePath], 'tooling tweak [id=-]')
    writeDetail(root, 'docs/state/web/heavy-now.md', detail('heavy-now', 'x'.repeat(4200)))
    writeDetail(
      root,
      'docs/state/web/heavy-log.md',
      detail('heavy-log', `short\n\n## 원장\n\n${'y'.repeat(8300)}`),
    )
    commit(
      root,
      ['apps/web/STATE.md', 'docs/state/web/heavy-now.md', 'docs/state/web/heavy-log.md'],
      'state after code',
    )

    const strict = spawnSync('bash', [WIP_CHECK_SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOOK_PROJECT_DIR: root, STATE_CHECK_AREA: 'web', STATE_CHECK_STRICT: '1' },
    })
    assert.equal(strict.status, 0, strict.stderr)
    assert.match(
      strict.stderr,
      /WARN: docs\/state\/web\/heavy-now\.md ## 현재 \d+B \(cap 4096B\) — 완료 경과는 커밋 메시지로, 남은 일·결정·WHY만 남긴다/,
    )
    assert.match(strict.stderr, /WARN: docs\/state\/web\/heavy-log\.md \d+B \(detail cap 8192B 초과\)/)
    assert.doesNotMatch(strict.stderr, /heavy-log\.md ## 현재/)
    assert.doesNotMatch(strict.stderr, /heavy-now\.md \d+B \(detail cap/)

    const message = stopMessage(root, sessionId)
    assert.doesNotMatch(message, /커밋 메시지에 STATE \[id=\]가 없는 커밋/)
    assert.match(message, /heavy-now\.md ## 현재 \d+B \(cap 4096B\)/)
  }))

test('a later tagged commit to the same path clears an untagged one within the same turn', () =>
  withRepo((root) => {
    seedStateItem(root, 'alpha')
    const sessionId = 'same-turn-follow-up'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/app.ts'
    write(root, codePath, 'export const v = 1\n')
    commit(root, [codePath], 'wip')
    write(root, codePath, 'export const v = 2\n')
    commit(root, [codePath], 'finish [id=alpha]')

    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])
  }))

test('a commit naming the untagged sha releases its debt even when the path was deleted', () =>
  withRepo((root) => {
    seedStateItem(root, 'alpha')
    write(root, 'apps/web/src/old.ts', 'export const old = true\n')
    commit(root, ['apps/web/src/old.ts'], 'add old [id=alpha]')
    const sessionId = 'sha-reference'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    rmSync(join(root, 'apps/web/src/old.ts'))
    commit(root, ['apps/web/src/old.ts'], 'remove dead code')
    const removal = headSha(root)
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt.map((item) => item.sha), [removal])

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['commit', '-q', '--allow-empty', '-m', 'ack removal [id=alpha]'])
    assert.equal(runEngine(root, { session_id: sessionId }).debt.length, 1)

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['commit', '-q', '--allow-empty', '-m', `${removal.slice(0, 7)} removed dead code for alpha [id=alpha]`])
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])
  }))

test('amending or dropping the untagged commit clears its debt', () =>
  withRepo((root) => {
    seedStateItem(root, 'alpha')
    const sessionId = 'amend-or-drop'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/a.ts', 'export const a = true\n')
    commit(root, ['apps/web/src/a.ts'], 'quick fix')
    assert.equal(runEngine(root, { session_id: sessionId }).debt.length, 1)

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['commit', '-q', '--amend', '-m', 'quick fix [id=alpha]'])
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/b.ts', 'export const b = true\n')
    commit(root, ['apps/web/src/b.ts'], 'throwaway')
    assert.equal(runEngine(root, { session_id: sessionId }).debt.length, 1)

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['reset', '-q', '--hard', 'HEAD~1'])
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])
  }))

test('a working-tree registration makes an id valid and a later registration releases unknown-id debt', () =>
  withRepo((root) => {
    const sessionId = 'register-later'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    writeDetail(root, 'docs/state/web/newid.md', detail('newid', 'new item'))
    write(root, 'apps/web/src/n.ts', 'export const n = true\n')
    commit(root, ['apps/web/src/n.ts'], 'implement new item [id=newid]')
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/m.ts', 'export const m = true\n')
    commit(root, ['apps/web/src/m.ts'], 'start the later item [id=later]')
    const message = stopMessage(root, sessionId)
    assert.match(
      message,
      /\[id=\]가 STATE 인덱스에 없는 커밋 — [0-9a-f]{7} \[id=later\] \(apps\/web\/src\/m\.ts\)\. 오타·archive된 id면 올바른 id로 다시 기록하고, 정말 새 항목일 때만/,
    )
    assert.doesNotMatch(message, /커밋 메시지에 STATE \[id=\]가 없는 커밋/)

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    writeDetail(root, 'docs/state/web/later.md', detail('later', 'registered after the commit'))
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])
  }))

test('an id registered on the default branch is valid from a feature branch', () =>
  withRepo((root) => {
    git(root, ['checkout', '-q', '-b', 'feature'])
    git(root, ['checkout', '-q', 'main'])
    seedStateItem(root, 'mainid')
    git(root, ['checkout', '-q', 'feature'])
    const sessionId = 'feature-branch'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/feature.ts', 'export const feature = true\n')
    commit(root, ['apps/web/src/feature.ts'], 'implement on feature [id=mainid]')

    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])
  }))

test('a tag stays valid when its item was archived on the branch it merges into', () =>
  withRepo((root) => {
    const detailPath = seedStateItem(root, 'old', 'root')
    git(root, ['checkout', '-q', '-b', 'feature'])
    write(root, 'apps/web/src/f.ts', 'export const f = true\n')
    commit(root, ['apps/web/src/f.ts'], 'feature work [id=old]')
    git(root, ['checkout', '-q', 'main'])
    write(root, 'STATE.md', readFileSync(join(root, 'STATE.md'), 'utf8').replace('- [old] fixture\n', ''))
    rmSync(join(root, detailPath))
    commit(root, ['STATE.md', detailPath], 'archive [id=old]')
    const sessionId = 'merge-after-archive'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['merge', '-q', '--no-ff', '-m', "Merge branch 'feature'", 'feature'])

    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])
  }))

test('work left uncommitted at Stop is judged when it is committed between turns', () =>
  withRepo((root) => {
    const sessionId = 'between-turns'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/x.ts', 'export const x = true\n')
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])

    // 턴 사이에 사람이 id 없이 커밋한다. Stop 때 미커밋이던 경로만 판정한다.
    write(root, 'apps/api/src/unrelated.ts', 'export const unrelated = true\n')
    commit(root, ['apps/web/src/x.ts', 'apps/api/src/unrelated.ts'], 'wip')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })

    const result = runEngine(root, { session_id: sessionId })
    assert.deepEqual(result.debt.map((item) => item.path), ['apps/web/src/x.ts'])
    assert.deepEqual(result.codeChanged, [])
  }))

test('the first commits of an empty repository are judged', () =>
  withEmptyRepo((root) => {
    const sessionId = 'empty-repository'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'STATE.md', stateIndex('root'))
    write(root, 'src/a.ts', 'export const a = true\n')
    commit(root, ['STATE.md', 'src/a.ts'], 'initial untagged work')
    write(root, 'src/b.ts', 'export const b = true\n')
    commit(root, ['src/b.ts'], 'second untagged work')

    const result = runEngine(root, { session_id: sessionId })
    assert.deepEqual(result.debt.map((item) => item.path), ['src/a.ts', 'src/b.ts'])
  }))

function withEmptyRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'state-hooks-empty-'))
  try {
    git(root, ['init', '-q', '-b', 'main'])
    git(root, ['config', 'user.email', 'test@example.com'])
    git(root, ['config', 'user.name', 'test'])
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  }
}

// 팀원이 오래전에 만든 커밋을 흉내 낸다(committer 시각이 기준점보다 이르다).
function commitAt(root, paths, message, date = '2020-01-01T00:00:00Z') {
  git(root, ['add', '-A', '--', ...paths])
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  })
}

test('a first commit made between turns in an empty repository is judged', () =>
  withEmptyRepo((root) => {
    const sessionId = 'empty-between'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'STATE.md', stateIndex('root'))
    write(root, 'src/a.ts', 'export const a = true\n')
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])

    commit(root, ['STATE.md', 'src/a.ts'], 'initial import')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt.map((item) => item.path), ['src/a.ts'])
  }))

test('git errors in an empty repository do not hide Stop warnings', () =>
  withEmptyRepo((root) => {
    const sessionId = 'empty-stderr'
    write(root, 'STATE.md', stateIndex('root'))
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'docs/state/root/broken.md', 'no frontmatter\n')
    assert.match(stopMessage(root, sessionId), /docs\/state\/root\/broken\.md frontmatter 없음/)
  }))

test('release commits made between turns clear debt, with or without touching the path', () =>
  withRepo((root) => {
    seedStateItem(root, 'rel')
    const sessionId = 'between-release'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/a.ts', 'export const a = 1\n')
    write(root, 'apps/web/src/b.ts', 'export const b = 1\n')
    commit(root, ['apps/web/src/a.ts'], 'add a')
    const shaA = headSha(root)
    commit(root, ['apps/web/src/b.ts'], 'add b')
    assert.deepEqual(
      runEngine(root, { session_id: sessionId }).debt.map((item) => item.path),
      ['apps/web/src/a.ts', 'apps/web/src/b.ts'],
    )

    // 턴 사이에 사람이 터미널에서 sha를 적은 빈 커밋과 같은 경로의 [id=] 커밋을 남긴다.
    git(root, ['commit', '-q', '--allow-empty', '-m', `record ${shaA.slice(0, 7)} [id=rel]`])
    write(root, 'apps/web/src/b.ts', 'export const b = 2\n')
    commit(root, ['apps/web/src/b.ts'], 'finish b [id=rel]')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])
  }))

test('[id=-] on a later commit to the same path does not release earlier debt', () =>
  withRepo((root) => {
    seedStateItem(root, 'feat')
    const sessionId = 'dash-follow-up'
    const codePath = 'apps/web/src/feature.ts'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, codePath, 'export const feature = 1\n')
    commit(root, [codePath], 'feature without id')
    const featureSha = headSha(root)
    assert.equal(runEngine(root, { session_id: sessionId }).debt.length, 1)

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, codePath, 'export const feature = 1 // typo\n')
    commit(root, [codePath], 'typo [id=-]')
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt.map((item) => item.sha), [featureSha])
  }))

test('a release commit on a parallel branch clears debt whatever the topological order', () =>
  withRepo((root) => {
    seedStateItem(root, 'topo')
    const sessionId = 'topo-release'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['checkout', '-q', '-b', 'side'])
    write(root, 'apps/web/src/a.ts', 'export const a = true\n')
    commit(root, ['apps/web/src/a.ts'], 'add a')
    const sideSha = headSha(root)
    git(root, ['checkout', '-q', 'main'])
    git(root, ['commit', '-q', '--allow-empty', '-m', `release ${sideSha.slice(0, 7)} [id=topo]`])
    git(root, ['merge', '-q', '--no-ff', '-m', "Merge branch 'side'", 'side'])

    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])
  }))

test('a between-turn commit dropped during the turn leaves no debt', () =>
  withRepo((root) => {
    const sessionId = 'between-dropped'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/a.ts', 'export const a = true\n')
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt, [])

    commit(root, ['apps/web/src/a.ts'], 'wip')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['reset', '-q', '--hard', 'HEAD~1'])
    const result = runEngine(root, { session_id: sessionId })
    assert.deepEqual(result.debt, [])
    assert.deepEqual(result.freshDebt, [])
  }))

test('commits made before the turn or the last Stop are not judged when merged in', () =>
  withRepo((root) => {
    write(root, 'apps/web/src/a.ts', '1\n2\n3\n4\n5\n')
    commit(root, ['apps/web/src/a.ts'], 'add a [id=-]')
    git(root, ['checkout', '-q', '-b', 'up'])
    write(root, 'apps/web/src/t.ts', 'export const teammate = true\n')
    commitAt(root, ['apps/web/src/t.ts'], 'teammate change')
    git(root, ['checkout', '-q', '-b', 'up2'])
    write(root, 'apps/web/src/a.ts', 'T\n2\n3\n4\n5\n')
    commitAt(root, ['apps/web/src/a.ts'], 'teammate edit of a')
    git(root, ['checkout', '-q', 'main'])

    // 턴 안의 pull(fast-forward)로 들어온 남의 커밋.
    const sessionId = 'teammate-commits'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['merge', '-q', '--ff-only', 'up'])
    assert.equal(stop(root, sessionId), '')

    // Stop 때 미커밋이던 경로를 바꾼 남의 커밋이 턴 사이에 들어와도 이 세션의 debt가 아니다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/a.ts', '1\n2\n3\n4\nL\n')
    assert.equal(stop(root, sessionId), '')
    git(root, ['stash', '-q'])
    git(root, ['merge', '-q', '--ff-only', 'up2'])
    git(root, ['stash', 'pop', '-q'])
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    assert.equal(stop(root, sessionId), '')
  }))

test('commits from a turn that ended without Stop are judged with the next turn', () =>
  withRepo((root) => {
    const sessionId = 'interrupted-turn'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    assert.equal(stop(root, sessionId), '')

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/a.ts', 'export const a = true\n')
    commit(root, ['apps/web/src/a.ts'], 'add a')
    // 사용자 중단: Stop 없이 다음 프롬프트가 온다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    assert.deepEqual(runEngine(root, { session_id: sessionId }).debt.map((item) => item.path), ['apps/web/src/a.ts'])
  }))

test('debt is listed per commit with an overflow count', () =>
  withRepo((root) => {
    const sessionId = 'per-commit'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const big = Array.from({ length: 13 }, (_, i) => `apps/web/src/m${String(i).padStart(2, '0')}.ts`)
    for (const path of big) write(root, path, `export const v = '${path}'\n`)
    commit(root, big, 'big untagged')
    const bigSha = headSha(root).slice(0, 7)
    for (let i = 0; i < 6; i += 1) {
      write(root, `apps/web/src/z${i}.ts`, `export const z = ${i}\n`)
      commit(root, [`apps/web/src/z${i}.ts`], `small untagged ${i}`)
    }

    const message = stopMessage(root, sessionId)
    assert.match(message, new RegExp(`${bigSha} \\(apps/web/src/m00\\.ts 외 12개\\)`))
    assert.match(message, /z4\.ts\) 외 1개 커밋\./)
    assert.doesNotMatch(message, /\[web\]/)
  }))

test('the next turn start tells the agent about carried debt', () =>
  withRepo((root) => {
    const sessionId = 'inject-debt'
    assert.equal(runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId }), '')
    write(root, 'apps/web/src/a.ts', 'export const a = true\n')
    commit(root, ['apps/web/src/a.ts'], 'untagged')
    stopMessage(root, sessionId)

    const output = JSON.parse(runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId }))
    assert.equal(output.systemMessage, undefined)
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
    assert.match(
      output.hookSpecificOutput.additionalContext,
      /커밋 메시지에 유효 \[id=\]가 없는 커밋이 남아 있습니다 — [0-9a-f]{7} \(apps\/web\/src\/a\.ts\)\. 다음 커밋 메시지에 그 sha와 \[id=<id>\]/,
    )
  }))

test('the §1 claim notice is shown once per id and respects a claim on the default branch', () =>
  withRepo((root) => {
    seedStateItem(root, 'gamma', 'web', 'live item', 2)
    seedStateItem(root, 'omega', 'web', 'live item', 2)
    git(root, ['branch', 'feature'])
    const sessionId = 'claim-once'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/g.ts', 'export const g = 1\n')
    commit(root, ['apps/web/src/g.ts'], 'work [id=gamma]')
    assert.match(stopMessage(root, sessionId), /\[id=gamma\]\(§2\)/)

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/g.ts', 'export const g = 2\n')
    commit(root, ['apps/web/src/g.ts'], 'more work [id=gamma]')
    assert.equal(stop(root, sessionId), '')

    // 기본 브랜치에서 omega를 §1로 claim했으면 feature의 낡은 STATE 사본이 §2여도 알리지 않는다.
    const index = readFileSync(join(root, 'apps/web/STATE.md'), 'utf8')
      .replace('- [omega] fixture\n\n', '')
      .replace('## 1. 활성\n', '## 1. 활성\n- [omega] fixture\n')
    write(root, 'apps/web/STATE.md', index)
    commit(root, ['apps/web/STATE.md'], 'claim [id=omega]')
    git(root, ['checkout', '-q', 'feature'])
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/o.ts', 'export const o = 1\n')
    commit(root, ['apps/web/src/o.ts'], 'work [id=omega]')
    assert.equal(stop(root, sessionId), '')
  }))

const HAS_SSH_KEYGEN = spawnSync('ssh-keygen', ['-?'], { stdio: 'ignore' }).error === undefined

test(
  'user log.showSignature does not break commit judgement',
  { skip: HAS_SSH_KEYGEN ? false : 'ssh-keygen unavailable' },
  () =>
    withRepo((root) => {
      seedStateItem(root, 'signed')
      const key = join(root, '.git', 'test-signing-key')
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key])
      git(root, ['config', 'gpg.format', 'ssh'])
      git(root, ['config', 'user.signingkey', key])
      git(root, ['config', 'commit.gpgsign', 'true'])
      git(root, ['config', 'log.showSignature', 'true'])
      const sessionId = 'signed-commits'
      runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
      write(root, 'apps/web/src/a.ts', 'export const a = true\n')
      commit(root, ['apps/web/src/a.ts'], 'signed work [id=signed]')
      write(root, 'apps/web/src/b.ts', 'export const b = true\n')
      commit(root, ['apps/web/src/b.ts'], 'signed untagged work')
      assert.match(git(root, ['cat-file', 'commit', 'HEAD']), /gpgsig/)

      const result = runEngine(root, { session_id: sessionId })
      assert.deepEqual(result.debt.map((item) => item.path), ['apps/web/src/b.ts'])
    }),
)

test('a commit range above the judgement cap is skipped instead of timing out', () =>
  withRepo((root) => {
    const sessionId = 'large-range'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const parent = headSha(root)
    const now = Math.floor(Date.now() / 1000)
    let stream = ''
    for (let i = 1; i <= 1001; i += 1) {
      const content = `export const n = ${i}\n`
      stream += `commit refs/heads/main\ncommitter t <t@example.com> ${now + i} +0000\ndata 4\nbulk\n`
      if (i === 1) stream += `from ${parent}\n`
      stream += `M 100644 inline apps/web/src/bulk.ts\ndata ${Buffer.byteLength(content)}\n${content}\n`
    }
    execFileSync('git', ['fast-import', '--quiet', '--force'], { cwd: root, input: stream })
    git(root, ['reset', '-q', '--hard', 'main'])

    const message = stopMessage(root, sessionId)
    assert.match(message, /판정 상한\(1000개\)을 넘어/)
    assert.doesNotMatch(message, /커밋 메시지에 STATE \[id=\]가 없는 커밋/)
  }))

test('small detail appends add up across turns, including an uncommitted new detail', () =>
  withRepo((root) => {
    const statePath = seedStateItem(root, 'steady', 'web', 'short summary')
    const newPath = 'docs/state/web/delta.md'
    const sessionId = 'cumulative-append'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    let deltaBody = 'p'.repeat(600)
    writeDetail(root, newPath, detail('delta', deltaBody))
    assert.deepEqual(runEngine(root, { session_id: sessionId }).appendedDetails, [])

    let steadyBody = 'short summary'
    const flagged = []
    for (let turn = 2; turn <= 4; turn += 1) {
      runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
      steadyBody += `\n- 턴${turn} 경과: ${'q'.repeat(400)}`
      write(root, statePath, detail('steady', steadyBody, false, 'web', 'agent'))
      commit(root, [statePath], 'progress [id=steady]')
      deltaBody += `\n- 턴${turn} 경과: ${'r'.repeat(600)}`
      write(root, newPath, detail('delta', deltaBody))
      flagged.push(runEngine(root, { session_id: sessionId }).appendedDetails.map((entry) => entry.path).sort())
    }
    // 각 증가는 1KB를 넘긴 턴에 한 번만 알린다.
    assert.deepEqual(flagged, [[], [newPath], [statePath]])
  }))

test('Stop rechecks only warnings that mention STATE paths changed this turn', () =>
  withRepo((root) => {
    const bigPath = seedStateItem(root, 'bigitem', 'web', 'z'.repeat(7000))
    const otherPath = seedStateItem(root, 'other', 'web', 'small')
    const sessionId = 'scoped-recheck'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, otherPath, readFileSync(join(root, otherPath), 'utf8').replace('owner: agent', 'owner: Codex'))
    commit(root, [otherPath], 'claim [id=other]')
    assert.equal(stop(root, sessionId), '')

    // 크기 경고만 있는 턴은 Antigravity를 강제로 이어 돌리지 않는다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, bigPath, detail('bigitem', 'y'.repeat(7000), false, 'web', 'agent'))
    const parsed = JSON.parse(stop(root, sessionId, { STATE_LEDGER_HOST: 'antigravity' }))
    assert.match(parsed.systemMessage, /docs\/state\/web\/bigitem\.md ## 현재 \d+B \(cap 4096B\)/)
    assert.doesNotMatch(parsed.systemMessage, /other\.md/)
    assert.equal(parsed.stateLedgerContinue, false)
  }))

test('committing work under an id outside §1 suggests claiming it instead of appending', () =>
  withRepo((root) => {
    const detailPath = seedStateItem(root, 'gamma', 'web', 'live item', 2)
    const sessionId = 'unclaimed-id'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/g.ts', 'export const g = 1\n')
    commit(root, ['apps/web/src/g.ts'], 'work [id=gamma]')
    const message = stopMessage(root, sessionId)
    assert.match(message, /\[id=gamma\]\(§2\) 로 작업을 커밋했지만 그 항목이 STATE §1 활성에 없습니다/)
    assert.doesNotMatch(message, /커밋 메시지에 STATE \[id=\]가 없는 커밋/)

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const index = readFileSync(join(root, 'apps/web/STATE.md'), 'utf8')
      .replace('- [gamma] fixture\n\n', '')
      .replace('## 1. 활성\n', '## 1. 활성\n- [gamma] fixture\n')
    write(root, 'apps/web/STATE.md', index)
    write(root, detailPath, readFileSync(join(root, detailPath), 'utf8').replace('owner: —', 'owner: Codex'))
    commit(root, ['apps/web/STATE.md', detailPath], 'claim [id=gamma]')
    write(root, 'apps/web/src/g.ts', 'export const g = 2\n')
    commit(root, ['apps/web/src/g.ts'], 'more work [id=gamma]')
    assert.equal(stop(root, sessionId), '')
  }))

test('Stop rechecks structural STATE warnings when STATE changed without a code delta', () =>
  withRepo((root) => {
    const sessionId = 'state-warning'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'docs/state/web/warning.md', detail('warning', 'changed this turn'))

    const output = runHook(
      STOP_SCRIPT,
      root,
      {
        session_id: sessionId,
        hook_event_name: 'Stop',
        stop_hook_active: false,
      },
      {},
    )

    assert.match(JSON.parse(output).systemMessage, /인덱스에 없음/)
  }))

test('STATE stamp accepts Claude file_path input', () =>
  withRepo((root) => {
    const relative = 'docs/state/web/claude.md'
    write(root, relative, detail('claude', 'Claude edit', true))

    runHook(STAMP_SCRIPT, root, { tool_input: { file_path: relative } })

    assertStamped(root, relative)
  }))

test('STATE stamp accepts Codex multi-file apply_patch input', () =>
  withRepo((root) => {
    const first = 'docs/state/web/codex-a.md'
    const second = 'docs/state/web/codex-b.md'
    write(root, first, detail('codex-a', 'Codex edit A', true))
    write(root, second, detail('codex-b', 'Codex edit B', true))

    runHook(STAMP_SCRIPT, root, {
      tool_input: {
        command: `*** Begin Patch\n*** Update File: ${first}\n*** Update File: ${second}\n*** End Patch`,
      },
    })

    assertStamped(root, first)
    assertStamped(root, second)
  }))

test('STATE stamp rejects a detail symlink that resolves outside the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-stamp-symlink-'))
  const outside = join(tmpdir(), `${basename(root)}-outside.md`)
  try {
    mkdirSync(join(root, 'docs/state/web'), { recursive: true })
    writeFileSync(outside, detail('outside', 'must not change', true))
    const before = readFileSync(outside, 'utf8')
    symlinkSync(outside, join(root, 'docs/state/web/link.md'))

    runHook(STAMP_SCRIPT, root, { tool_input: { file_path: 'docs/state/web/link.md' } })

    assert.equal(readFileSync(outside, 'utf8'), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  }
})

test('STATE stamp rejects a traversal path that resolves outside the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-stamp-traversal-'))
  const outside = join(tmpdir(), `${basename(root)}-outside.md`)
  try {
    mkdirSync(join(root, 'docs/state/web'), { recursive: true })
    writeFileSync(outside, detail('outside', 'must not change', true))
    const before = readFileSync(outside, 'utf8')
    const escaped = `${root}/docs/state/web/../../../../${basename(outside)}`

    runHook(STAMP_SCRIPT, root, { tool_input: { file_path: escaped } })

    assert.equal(readFileSync(outside, 'utf8'), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  }
})

test('Antigravity PreInvocation injects session start on invocation 1 and suppresses on invocation 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'antigravity-pre-invoc-'))
  try {
    git(root, ['init', '-b', 'main'])
    write(root, 'STATE.md', '# STATE\n\n## 1. 활성 (지금 작업 중)\n- [test] Title — note\n\n## 2. 다음\n\n## 3. 미래\n\n## 4. 미해결\n')
    write(root, 'docs/state/root/test.md', detail('test', 'first', true))
    git(root, ['add', '.'])
    git(root, ['commit', '-m', 'init [id=test]'])

    const sid = `test-anti-${Date.now()}`
    const p1 = { conversationId: sid, invocationNum: 1, workspacePaths: [root] }
    const out1 = JSON.parse(runHook(ANTIGRAVITY_PRE_INVOCATION, root, p1))
    assert.ok(out1.injectSteps?.[0]?.ephemeralMessage)

    const p2 = { conversationId: sid, invocationNum: 2, workspacePaths: [root] }
    const out2 = JSON.parse(runHook(ANTIGRAVITY_PRE_INVOCATION, root, p2))
    assert.deepEqual(out2, {})
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  }
})

test('Antigravity PostToolUse stamps state detail file from TargetFile', () => {
  const root = mkdtempSync(join(tmpdir(), 'antigravity-post-tool-'))
  try {
    git(root, ['init', '-b', 'main'])
    write(root, 'STATE.md', '# STATE\n\n## 1. 활성 (지금 작업 중)\n- [test] Title — note\n\n## 2. 다음\n\n## 3. 미래\n\n## 4. 미해결\n')
    write(root, 'docs/state/root/test.md', detail('test', 'before', true))
    git(root, ['add', '.'])
    git(root, ['commit', '-m', 'init [id=test]'])

    const target = join(root, 'docs/state/root/test.md')
    const before = readFileSync(target, 'utf8')
    write(root, 'docs/state/root/test.md', detail('test', 'after modification', true))

    const payload = {
      toolCall: {
        name: 'replace_file_content',
        args: { TargetFile: target },
      },
      workspacePaths: [root],
    }
    const out = runHook(ANTIGRAVITY_POST_TOOL_USE, root, payload)
    assert.equal(out, '{}')

    const after = readFileSync(target, 'utf8')
    assert.notEqual(after, before)
    assert.match(after, /hash: [0-9a-f]{8}/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  }
})

test('Antigravity Stop allows uncommitted work and returns continue for an untagged commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'antigravity-stop-debt-'))
  try {
    git(root, ['init', '-b', 'main'])
    write(root, 'STATE.md', '# STATE\n\n## 1. 활성 (지금 작업 중)\n- [test] Title — note\n\n## 2. 다음\n\n## 3. 미래\n\n## 4. 미해결\n')
    write(root, 'docs/state/root/test.md', detail('test', 'initial', true))
    write(root, 'app.js', 'console.log("initial");\n')
    git(root, ['add', '.'])
    git(root, ['commit', '-m', 'init [id=test]'])

    const sid = `test-anti-stop-${Date.now()}`
    runHook(ANTIGRAVITY_PRE_INVOCATION, root, { conversationId: sid, invocationNum: 1, workspacePaths: [root] })

    // 미커밋 작업은 STATE 갱신 없이도 debt가 아니다.
    write(root, 'app.js', 'console.log("changed work");\n')
    const dirtyStop = JSON.parse(runHook(ANTIGRAVITY_STOP, root, { conversationId: sid, executionNum: 1, workspacePaths: [root] }))
    assert.equal(dirtyStop.decision, 'allow')

    // id 없는 커밋은 다음 턴에 debt로 알린다.
    runHook(ANTIGRAVITY_PRE_INVOCATION, root, { conversationId: sid, invocationNum: 2, workspacePaths: [root] })
    git(root, ['add', 'app.js'])
    git(root, ['commit', '-q', '-m', 'change without an id'])

    const stopPayload = { conversationId: sid, executionNum: 1, workspacePaths: [root] }
    const out1 = JSON.parse(runHook(ANTIGRAVITY_STOP, root, stopPayload))
    assert.equal(out1.decision, 'continue')
    assert.match(out1.reason, /^STATE 알림:/)
    assert.doesNotMatch(out1.reason, /원장 검토 필요/)
    assert.match(out1.reason, /커밋 메시지에 STATE \[id=\]가 없는 커밋 — [0-9a-f]{7} \(app\.js\)/)

    // Re-entry allows exit to avoid deadlock
    const reEntryPayload = { conversationId: sid, executionNum: 2, workspacePaths: [root] }
    const out2 = JSON.parse(runHook(ANTIGRAVITY_STOP, root, reEntryPayload))
    assert.equal(out2.decision, 'allow')

    // 이전 턴에서 이월된 debt만 남은 턴은 강제로 이어 돌리지 않는다.
    runHook(ANTIGRAVITY_PRE_INVOCATION, root, { conversationId: sid, invocationNum: 3, workspacePaths: [root] })
    const carried = JSON.parse(runHook(ANTIGRAVITY_STOP, root, { conversationId: sid, executionNum: 1, workspacePaths: [root] }))
    assert.equal(carried.decision, 'allow')
    const plain = JSON.parse(stop(root, sid))
    assert.match(plain.systemMessage, /[0-9a-f]{7} \(app\.js\)/)
    assert.doesNotMatch(plain.systemMessage, /해제:/)
    assert.equal(plain.stateLedgerContinue, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  }
})
