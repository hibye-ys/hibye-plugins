import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const STOP_SCRIPT = fileURLToPath(new URL('./stop-state-reminder.sh', import.meta.url))
const STAMP_SCRIPT = fileURLToPath(new URL('./post-edit-state-stamp.sh', import.meta.url))
const SESSION_SCRIPT = fileURLToPath(new URL('./session-start-state-inject.sh', import.meta.url))
const SNAPSHOT_SCRIPT = fileURLToPath(new URL('./turn-start-state-snapshot.sh', import.meta.url))
const COMMIT_MSG_SCRIPT = fileURLToPath(new URL('./commit-msg-state-check.sh', import.meta.url))
const BRANCH_SYNC_SCRIPT = fileURLToPath(new URL('../check-state-branch-sync.sh', import.meta.url))
const WIP_CHECK_SCRIPT = fileURLToPath(new URL('../check-state-wip-cap.sh', import.meta.url))
const GLOBAL_SCRIPT = fileURLToPath(new URL('./global-state-hook.sh', import.meta.url))

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

function detail(id, body, stale = false, area = 'web') {
  const detailBody = `# ${id}

## 현재

${body}
`
  const serializedBody = `\n${detailBody}`
  const hash = stale ? 'stale' : createHash('sha256').update(serializedBody).digest('hex').slice(0, 8)
  return `---
id: ${id}
area: ${area}
owner: —
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

function assertStamped(root, relative) {
  const text = readFileSync(join(root, relative), 'utf8')
  const match = text.match(/^---\n(.*?)\n---\n(.*)$/s)
  assert.ok(match)
  const [, frontmatter, body] = match
  const expected = createHash('sha256').update(body).digest('hex').slice(0, 8)
  assert.match(frontmatter, /^touched: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/m)
  assert.match(frontmatter, new RegExp(`^hash: ${expected}$`, 'm'))
}

test('Stop reminder detects code inside an untracked directory and uses the shared message shape', () =>
  withRepo((root) => {
    const sessionId = 'untracked-code'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/e2e/design-lab/graph-appearance/node.ts'
    write(root, codePath, 'export const node = true\n')

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })
    const parsed = JSON.parse(output)

    assert.match(parsed.systemMessage, new RegExp(codePath))
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

    runHook(SESSION_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'SessionStart',
      source: 'compact',
    })
    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.match(JSON.parse(output).systemMessage, new RegExp(codePath))
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
    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.match(JSON.parse(output).systemMessage, new RegExp(codePath))
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

test('content hashing detects another edit to a code file that was already dirty', () =>
  withRepo((root) => {
    const sessionId = 'dirty-code-edited-again'
    const codePath = 'apps/web/src/already-dirty.ts'
    write(root, codePath, 'export const revision = 1\n')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, codePath, 'export const revision = 2\n')

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.match(JSON.parse(output).systemMessage, new RegExp(codePath))
  }))

test('another edit to an already-dirty STATE detail covers this turn code delta', () =>
  withRepo((root) => {
    const sessionId = 'dirty-state-edited-again'
    const statePath = 'docs/state/web/existing.md'
    writeDetail(root, statePath, detail('existing', 'revision 1'))
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/covered.ts', 'export const covered = true\n')
    write(root, statePath, detail('existing', 'revision 2'))

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.equal(output, '')
  }))

test('STATE from the wrong area does not cover a web code delta', () =>
  withRepo((root) => {
    const sessionId = 'wrong-area-state'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/web-only.ts'
    write(root, codePath, 'export const webOnly = true\n')
    writeDetail(root, 'docs/state/api/wrong-area.md', detail('wrong-area', 'API STATE change', false, 'api'))

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.match(JSON.parse(output).systemMessage, new RegExp(`\\[web/working\\] ${codePath}`))
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

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage

    assert.match(message, new RegExp(`\\[worker/working\\] ${codePath}`))
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

    const output = JSON.parse(
      runHook(STOP_SCRIPT, root, {
        session_id: sessionId,
        hook_event_name: 'Stop',
        stop_hook_active: false,
      }),
    ).systemMessage

    for (const path of paths) assert.match(output, new RegExp(path.replaceAll('.', '\\.')))
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

    const output = JSON.parse(
      runHook(STOP_SCRIPT, root, {
        session_id: sessionId,
        hook_event_name: 'Stop',
        stop_hook_active: false,
      }),
    ).systemMessage

    for (const path of paths) assert.match(output, new RegExp(path.replaceAll('.', '\\.')))
  }))

test('deleting a required STATE index cannot cover code work', () =>
  withRepo((root) => {
    const sessionId = 'deleted-state-index'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/deleted-index.ts'
    write(root, codePath, 'export const deletedIndex = true\n')
    rmSync(join(root, 'apps/web/STATE.md'))

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage

    assert.match(message, new RegExp(codePath))
    assert.match(message, /구조 검사를 통과하지 않아/)
  }))

test('a structurally invalid STATE edit cannot clear debt', () =>
  withRepo((root) => {
    const sessionId = 'invalid-state-area'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/invalid-state.ts'
    write(root, codePath, 'export const invalidState = true\n')
    write(root, 'docs/state/web/invalid.md', detail('invalid', 'invalid acknowledgement'))

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    }, { STATE_TEST_STRICT_FAILURE: '1' })).systemMessage

    assert.match(message, new RegExp(codePath))
    assert.match(message, /구조 검사를 통과하지 않아/)
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
    const metadata = readFileSync(join(root, statePath), 'utf8').replace(
      'touched: —',
      'touched: 2026-08-09T16:00',
    )
    write(root, statePath, metadata)

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage

    assert.match(message, new RegExp(codePath))
    assert.match(message, /touched\/hash·주석·공백만/)
  }))

test('an owner claim is a meaningful STATE change', () =>
  withRepo((root) => {
    const statePath = 'docs/state/web/owner-claim.md'
    writeDetail(root, statePath, detail('owner-claim', 'same ledger body'))
    git(root, ['add', statePath])
    git(root, ['commit', '-q', '-m', 'unclaimed state'])
    const sessionId = 'owner-claim-state'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/owner-claim.ts', 'export const ownerClaim = true\n')
    const claimed = readFileSync(join(root, statePath), 'utf8').replace('owner: —', 'owner: Codex')
    write(root, statePath, claimed)

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.equal(output, '')
  }))

test('a STATE edit made before the last code edit cannot cover that code', () =>
  withRepo((root) => {
    const sessionId = 'state-before-code'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const statePath = join(root, 'docs/state/web/early.md')
    const codePath = join(root, 'apps/web/src/later.ts')
    writeDetail(root, 'docs/state/web/early.md', detail('early', 'written first'))
    write(root, 'apps/web/src/later.ts', 'export const later = true\n')
    utimesSync(statePath, new Date(1_000_000), new Date(1_000_000))
    utimesSync(join(root, 'apps/web/STATE.md'), new Date(1_000_000), new Date(1_000_000))
    utimesSync(codePath, new Date(2_000_000), new Date(2_000_000))

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage

    assert.match(message, /apps\/web\/src\/later\.ts/)
    assert.match(message, /마지막 코드 변경보다 먼저/)
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

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.match(JSON.parse(output).systemMessage, new RegExp(`\\[api/working\\] ${promptPath}`))
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

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage

    for (const path of tracked) assert.match(message, new RegExp(path.replaceAll('.', '\\.')))
    assert.doesNotMatch(message, /docs\/goal-runs\/example\/TRACK\.md/)
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

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage
    assert.match(message, /apps\/web\/src\/prompts\/runtime\.md/)
    assert.doesNotMatch(message, /README\.md|goal-runs/)
  }))

test('.staterc is always tracked as root work even when a custom include regex omits it', () =>
  withRepo((root) => {
    const sessionId = 'staterc-is-work'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const current = readFileSync(join(root, '.staterc'), 'utf8')
    write(root, '.staterc', `${current}# behavior changed\n`)

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage
    assert.match(message, /\[root\/working\] \.staterc/)
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
    write(root, '.codex/config.toml', 'command = "bash scripts/hooks/session-start-state-inject.sh"\n')
    const output = runGlobalHook('session-start', root, {
      session_id: 'global-deduplicate',
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

test('unresolved code debt persists until matching-area STATE changes', () =>
  withRepo((root) => {
    const sessionId = 'persistent-debt'
    const codePath = 'apps/web/src/debt.ts'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, codePath, 'export const debt = true\n')

    const firstStop = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })
    assert.match(JSON.parse(firstStop).systemMessage, new RegExp(codePath))

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const secondStop = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })
    assert.match(JSON.parse(secondStop).systemMessage, new RegExp(codePath))

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    writeDetail(root, 'docs/state/web/debt.md', detail('debt', 'debt resolved'))
    const resolvedStop = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })
    assert.equal(resolvedStop, '')
  }))

test('code committed during the turn is still compared with STATE', () =>
  withRepo((root) => {
    const sessionId = 'committed-code'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/committed.ts'
    write(root, codePath, 'export const committed = true\n')
    git(root, ['add', codePath])
    git(root, ['commit', '-q', '-m', 'code only'])

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.match(JSON.parse(output).systemMessage, new RegExp(codePath))
  }))

test('a STATE commit before a later code commit does not cover the code', () =>
  withRepo((root) => {
    const sessionId = 'state-commit-before-code'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    writeDetail(root, 'docs/state/web/early-commit.md', detail('early-commit', 'state first'))
    git(root, ['add', 'apps/web/STATE.md', 'docs/state/web/early-commit.md'])
    git(root, ['commit', '-q', '-m', 'state first'])
    const codePath = 'apps/web/src/code-after-state.ts'
    write(root, codePath, 'export const codeAfterState = true\n')
    git(root, ['add', codePath])
    git(root, ['commit', '-q', '-m', 'code after state'])

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage

    assert.match(message, new RegExp(codePath))
    assert.match(message, /마지막 코드 변경보다 먼저/)
  }))

test('a STATE commit after a code commit covers the code', () =>
  withRepo((root) => {
    const sessionId = 'state-commit-after-code'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/code-before-state.ts'
    write(root, codePath, 'export const codeBeforeState = true\n')
    git(root, ['add', codePath])
    git(root, ['commit', '-q', '-m', 'code first'])
    writeDetail(root, 'docs/state/web/late-commit.md', detail('late-commit', 'state after code'))
    git(root, ['add', 'apps/web/STATE.md', 'docs/state/web/late-commit.md'])
    git(root, ['commit', '-q', '-m', 'state after code'])

    const output = runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })

    assert.equal(output, '')
  }))

test('a dirty STATE edit cannot cover a committed code change even when written first', () =>
  withRepo((root) => {
    const sessionId = 'dirty-state-before-commit'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    writeDetail(root, 'docs/state/web/dirty-first.md', detail('dirty-first', 'dirty state first'))
    const codePath = 'apps/web/src/committed-after-dirty-state.ts'
    write(root, codePath, 'export const committedAfterDirtyState = true\n')
    git(root, ['add', codePath])
    git(root, ['commit', '-q', '-m', 'commit code only'])

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage

    assert.match(message, new RegExp(codePath))
    assert.match(message, /dirty\/commit 상태가 작업과 맞지 않아/)
  }))

test('a dirty STATE edit cannot cover a committed code change even when written later', () =>
  withRepo((root) => {
    const sessionId = 'dirty-state-after-commit'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/committed-before-dirty-state.ts'
    write(root, codePath, 'export const committedBeforeDirtyState = true\n')
    git(root, ['add', codePath])
    git(root, ['commit', '-q', '-m', 'commit code first'])
    writeDetail(root, 'docs/state/web/dirty-later.md', detail('dirty-later', 'dirty state later'))

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: sessionId,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage

    assert.match(message, new RegExp(codePath))
    assert.match(message, /dirty\/commit 상태가 작업과 맞지 않아/)
  }))

test('concurrent sessions make worktree attribution inconclusive instead of clearing or adding debt', () =>
  withRepo((root) => {
    runHook(SNAPSHOT_SCRIPT, root, { session_id: 'concurrent-a' })
    runHook(SNAPSHOT_SCRIPT, root, { session_id: 'concurrent-b' })
    write(root, 'apps/web/src/concurrent.ts', 'export const concurrent = true\n')
    writeDetail(root, 'docs/state/web/concurrent.md', detail('concurrent', 'other session state'))

    const message = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: 'concurrent-a',
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage

    assert.match(message, /다른 활성 세션 1개/)
    assert.doesNotMatch(message, /미해결 코드↔STATE debt/)

    const secondMessage = JSON.parse(runHook(STOP_SCRIPT, root, {
      session_id: 'concurrent-b',
      hook_event_name: 'Stop',
      stop_hook_active: false,
    })).systemMessage
    assert.match(secondMessage, /다른 활성 세션 1개/)
    assert.doesNotMatch(secondMessage, /미해결 코드↔STATE debt/)
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
