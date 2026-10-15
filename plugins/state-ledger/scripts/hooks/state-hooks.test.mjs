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
const UNTAGGED_GUIDANCE = '작업 기록은 커밋 메시지 [id=<id>]로 남긴다(STATE 항목과 무관한 잡무는 [id=-]). 직접 만든 미push 직전 커밋이면 git commit --amend로 붙이고, 아니면 다음 커밋부터 붙인다. STATE에 경과를 적어 대신하지 않는다.'

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

// 경로마다 따로 커밋하고 sha를 돌려준다 (작업 파일 분류 검사용).
function commitEach(root, paths) {
  return paths.map((path) => {
    commit(root, [path], `change ${path}`)
    return headSha(root)
  })
}

// 팀원이 오래전에 만든 커밋을 흉내 낸다 (committer 시각이 기준점보다 이르다).
function commitAt(root, paths, message, date = '2020-01-01T00:00:00Z') {
  git(root, ['add', '-A', '--', ...paths])
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  })
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

function untaggedShas(root, sessionId) {
  return runEngine(root, { session_id: sessionId }).untaggedCommits.map((entry) => entry.sha)
}

// 기준점 커밋에 owner가 claim한 §1 활성 STATE 항목(인덱스 줄 + detail)을 둔다.
function seedStateItem(root, id, area = 'web', body = 'live item') {
  const path = `docs/state/${area}/${id}.md`
  const index = area === 'root' ? 'STATE.md' : `apps/${area}/STATE.md`
  write(root, path, detail(id, body, false, area, 'agent'))
  const text = readFileSync(join(root, index), 'utf8')
  write(root, index, text.replace(/^(## 1\.[^\n]*\n)/m, `$1- [${id}] fixture\n`))
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

function short(commitSha) {
  return commitSha.slice(0, 7)
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

test('Stop lists an untagged commit of this turn with the shared message shape', () =>
  withRepo((root) => {
    const sessionId = 'untracked-code'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/e2e/design-lab/graph-appearance/node.ts'
    write(root, codePath, 'export const node = true\n')
    commit(root, [codePath], 'add node fixture')
    // stop_hook_active 재진입은 판정 없이 끝난다.
    assert.equal(runHook(STOP_SCRIPT, root, { session_id: sessionId, stop_hook_active: true }), '')

    const parsed = JSON.parse(stop(root, sessionId))

    assert.equal(
      parsed.systemMessage,
      `STATE reminder: 이번 턴 커밋 중 STATE id 태그가 없는 커밋 — ${short(headSha(root))} add node fixture. ${UNTAGGED_GUIDANCE}`,
    )
    assert.equal(parsed.hookSpecificOutput, undefined)
    assert.equal(parsed.stateLedgerContinue, undefined)
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

test('SessionStart only reads concurrent sessions and writes no baseline', () =>
  withRepo((root) => {
    // 프롬프트 없이 열기만 한 세션은 활성 세션이 아니다 — 다른 세션의 판정을 보류시키지 않는다.
    runHook(SESSION_SCRIPT, root, { session_id: 'idle-b', hook_event_name: 'SessionStart', source: 'startup' })
    const sessionId = 'busy-a'
    assert.equal(runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId }), '')
    write(root, 'apps/web/src/busy.ts', 'export const busy = true\n')
    commit(root, ['apps/web/src/busy.ts'], 'untagged busy work')
    assert.match(stopMessage(root, sessionId), /^STATE reminder: 이번 턴 커밋 중 STATE id 태그가 없는 커밋 — [0-9a-f]{7} untagged busy work\. /)

    // compact/resume의 SessionStart는 진행 중인 턴의 기준점을 바꾸지 않는다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/before-compact.ts', 'export const beforeCompact = true\n')
    commit(root, ['apps/web/src/before-compact.ts'], 'commit before compact')
    runHook(SESSION_SCRIPT, root, { session_id: sessionId, hook_event_name: 'SessionStart', source: 'compact' })
    assert.match(stopMessage(root, sessionId), /[0-9a-f]{7} commit before compact\./)
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

test('pre-existing STATE dirt does not hide code committed during this turn', () =>
  withRepo((root) => {
    const sessionId = 'old-state-new-code'
    writeDetail(root, 'docs/state/web/old-work.md', detail('old-work', 'older STATE change'))
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })

    const codePath = 'apps/web/src/new-change.ts'
    write(root, codePath, 'export const changedThisTurn = true\n')
    commit(root, [codePath], 'code only')

    assert.match(stopMessage(root, sessionId), new RegExp(`${short(headSha(root))} code only\\.`))
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

test('uncommitted work is never judged, only commits are', () =>
  withRepo((root) => {
    const sessionId = 'dirty-code-edited-again'
    const codePath = 'apps/web/src/already-dirty.ts'
    write(root, codePath, 'export const revision = 1\n')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, codePath, 'export const revision = 2\n')
    write(root, 'apps/web/src/new-file.ts', 'export const fresh = true\n')

    assert.equal(stop(root, sessionId), '')
  }))

test('STATE reminder is unchanged when an executing goal exists', () =>
  withRepo((root) => {
    installExecutingGoal(root)
    const sessionId = 'state-independent-from-goal'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/state-still-global.ts'
    write(root, codePath, 'export const stateStillGlobal = true\n')
    commit(root, [codePath], 'code only')

    const output = JSON.parse(stop(root, sessionId))

    assert.match(output.systemMessage, /[0-9a-f]{7} code only\./)
    assert.equal(output.decision, undefined)
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
    write(root, 'services/worker/src/job.ts', 'export const job = true\n')
    commit(root, ['services/worker/src/job.ts'], 'worker job')
    // 설정된 인덱스 경로는 작업 파일이 아니다 (include가 .*여도).
    write(root, 'services/worker/STATE.md', '# worker STATE\n\n## 1. 활성\n')
    commit(root, ['services/worker/STATE.md'], 'worker ledger only')

    assert.match(stopMessage(root, sessionId), / — [0-9a-f]{7} worker job\. /)
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
    const shas = commitEach(root, paths)

    assert.deepEqual(untaggedShas(root, sessionId), shas)
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
    const shas = commitEach(root, paths)

    assert.deepEqual(untaggedShas(root, sessionId), shas)
  }))

test('deleting a required STATE index is reported next to the untagged commit', () =>
  withRepo((root) => {
    const sessionId = 'deleted-state-index'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/deleted-index.ts'
    write(root, codePath, 'export const deletedIndex = true\n')
    commit(root, [codePath], 'code only')
    rmSync(join(root, 'apps/web/STATE.md'))
    commit(root, ['apps/web/STATE.md'], 'drop web index')

    const message = stopMessage(root, sessionId)

    assert.match(message, / — [0-9a-f]{7} code only\. /)
    assert.match(message, /apps\/web\/STATE\.md 없음 — 필수 STATE 인덱스 소실/)
  }))

test('an orphan detail is reported next to the untagged commit', () =>
  withRepo((root) => {
    const sessionId = 'invalid-state-area'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/invalid-state.ts'
    write(root, codePath, 'export const invalidState = true\n')
    commit(root, [codePath], 'code only')
    write(root, 'docs/state/web/invalid.md', detail('invalid', 'invalid acknowledgement'))
    commit(root, ['docs/state/web/invalid.md'], 'orphan detail')

    const message = stopMessage(root, sessionId)

    assert.match(message, / — [0-9a-f]{7} code only\. /)
    assert.match(message, /docs\/state\/web\/invalid\.md — apps\/web\/STATE\.md 인덱스에 없음/)
  }))

test('fields carried by older snapshots are ignored and dropped', () =>
  withRepo((root) => {
    const statePath = seedStateItem(root, 'legacy', 'web', 'short summary')
    write(root, 'apps/web/src/old.ts', 'export const old = true\n')
    commit(root, ['apps/web/src/old.ts'], 'old untagged work')
    const oldSha = headSha(root)
    const sessionId = 'legacy-snapshot'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const dataDir = `${root}-hook-data`
    const [snapshotFile] = readdirSync(dataDir).filter((name) => name.endsWith('.json'))
    const snapshotPath = join(dataDir, snapshotFile)
    const saved = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    // 0.3.x·0.4.0 초안이 남긴 이월 필드. 읽었다면 old.ts 커밋·덧붙임·claim을 다시 알렸을 것이다.
    const legacy = {
      debt: [
        { path: 'apps/web/src/old.ts', channel: 'committed', sha: oldSha, reason: 'untagged', ids: [] },
        { path: 'apps/web/src/old-working.ts', area: 'web', channel: 'working' },
      ],
      judgedHead: git(root, ['rev-parse', 'HEAD~1']).trim(),
      judgedAt: '2020-01-01T00:00:00.000Z',
      pendingWork: ['apps/web/src/old.ts'],
      bodyRef: { [statePath]: 1 },
      notifiedIds: [],
      prompted: true,
      seenAt: saved.capturedAt,
      stateSemantics: {},
    }
    writeFileSync(snapshotPath, `${JSON.stringify({ ...saved, ...legacy })}\n`)
    // 턴 시작보다 1000B 늘린다 (옛 bodyRef 1B 기준이면 1KB를 넘는다).
    write(root, statePath, detail('legacy', `short summary${'s'.repeat(1000)}`, false, 'web', 'agent'))

    assert.equal(stop(root, sessionId), '')
    const after = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    for (const key of Object.keys(legacy)) assert.equal(after[key], undefined, key)
    assert.equal(runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId }), '')
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

    assert.match(stopMessage(root, sessionId), / — [0-9a-f]{7} prompt only\. /)
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
    const shas = commitEach(root, [...tracked, 'docs/goal-runs/example/TRACK.md'])

    assert.deepEqual(untaggedShas(root, sessionId), shas.slice(0, tracked.length))
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
    const [tracked] = commitEach(root, [
      'apps/web/src/prompts/runtime.md',
      'apps/web/README.md',
      'docs/goal-runs/example/TRACK.md',
    ])

    assert.deepEqual(untaggedShas(root, sessionId), [tracked])
  }))

test('.staterc is always tracked as work even when a custom include regex omits it', () =>
  withRepo((root) => {
    const sessionId = 'staterc-is-work'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const current = readFileSync(join(root, '.staterc'), 'utf8')
    write(root, '.staterc', `${current}# behavior changed\n`)
    commit(root, ['.staterc'], 'tune staterc')

    assert.match(stopMessage(root, sessionId), / — [0-9a-f]{7} tune staterc\. /)
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

test('commits tagged with a live id, [id=-] or archive [id=] are not reported', () =>
  withRepo((root) => {
    seedStateItem(root, 'live-item')
    const gonePath = seedStateItem(root, 'gone', 'root')
    const sessionId = 'tagged-commits'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/api/src/route.ts', 'export const route = true\n')
    write(root, 'apps/web/src/view.ts', 'export const view = true\n')
    commit(root, ['apps/api/src/route.ts', 'apps/web/src/view.ts'], 'cross-area work [id=live-item]')
    write(root, 'apps/web/src/chore.ts', 'export const chore = true\n')
    commit(root, ['apps/web/src/chore.ts'], 'bump tooling unrelated to any item [id=-]')
    // 이번 턴에 archive한 id는 턴 시작 HEAD의 인덱스에 있으므로 유효하다. 태그는 본문에 있어도 된다.
    write(root, 'STATE.md', readFileSync(join(root, 'STATE.md'), 'utf8').replace('- [gone] fixture\n', ''))
    rmSync(join(root, gonePath))
    write(root, 'apps/web/src/finished.ts', 'export const finished = true\n')
    commit(root, ['STATE.md', gonePath, 'apps/web/src/finished.ts'], 'finish the work\n\narchive [id=gone]')

    assert.doesNotMatch(readFileSync(join(root, 'STATE.md'), 'utf8'), /\[gone\]/)
    assert.equal(stop(root, sessionId), '')
  }))

test('a tag whose id is in no STATE index is reported apart from untagged commits', () =>
  withRepo((root) => {
    seedStateItem(root, 'real-id')
    const sessionId = 'unknown-tag'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/unknown-tag.ts', 'export const unknownTag = true\n')
    commit(root, ['apps/web/src/unknown-tag.ts'], 'work [id=no-such-id]')

    const result = runEngine(root, { session_id: sessionId })
    assert.deepEqual(result.untaggedCommits, [])
    assert.deepEqual(result.unknownIdCommits, [{ sha: headSha(root), subject: 'work [id=no-such-id]', ids: ['no-such-id'] }])

    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/unknown-tag.ts', 'export const unknownTag = 2\n')
    commit(root, ['apps/web/src/unknown-tag.ts'], 'more work [id=no-such-id]')
    assert.equal(
      stopMessage(root, sessionId),
      `STATE reminder: 이번 턴 커밋의 [id=no-such-id]가 STATE 인덱스에 없다 — ${short(headSha(root))} more work [id=no-such-id]. 오타·archive된 id인지 확인하고, 새 작업이면 인덱스에 한 줄 등재한다.`,
    )
  }))

test('each commit of the turn is judged by its own message', () =>
  withRepo((root) => {
    seedStateItem(root, 'mixed')
    const sessionId = 'mixed-tags'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const codePath = 'apps/web/src/mixed.ts'
    write(root, codePath, 'export const version = 1\n')
    commit(root, [codePath], 'wip')
    const wip = headSha(root)
    write(root, codePath, 'export const version = 2\n')
    commit(root, [codePath], 'first pass [id=mixed]')
    write(root, codePath, 'export const version = 3\n')
    commit(root, [codePath], 'quick fix')
    const quickFix = headSha(root)
    // 작업 파일을 바꾸지 않은 커밋(빈 커밋, STATE만 바꾼 커밋)은 판정하지 않는다.
    git(root, ['commit', '-q', '--allow-empty', '-m', 'empty note'])
    writeDetail(root, 'docs/state/web/note.md', detail('note', 'next step'))
    commit(root, ['apps/web/STATE.md', 'docs/state/web/note.md'], 'note next step')

    assert.deepEqual(runEngine(root, { session_id: sessionId }).untaggedCommits, [
      { sha: wip, subject: 'wip' },
      { sha: quickFix, subject: 'quick fix' },
    ])
  }))

test('commits brought in by pull or merge and merge commits are not judged', () =>
  withRepo((root) => {
    git(root, ['checkout', '-q', '-b', 'up'])
    write(root, 'apps/web/src/t.ts', 'export const teammate = true\n')
    commitAt(root, ['apps/web/src/t.ts'], 'teammate change')
    git(root, ['checkout', '-q', '-b', 'side', 'main'])
    write(root, 'apps/api/src/side.ts', 'export const side = true\n')
    commitAt(root, ['apps/api/src/side.ts'], 'teammate side change')
    git(root, ['checkout', '-q', 'main'])

    const sessionId = 'teammate-commits'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    git(root, ['merge', '-q', '--ff-only', 'up'])
    git(root, ['merge', '-q', '--no-ff', '-m', "Merge branch 'side'", 'side'])

    assert.equal(git(root, ['rev-list', '--merges', '--count', 'HEAD']).trim(), '1')
    assert.equal(stop(root, sessionId), '')
  }))

test('a previous-turn commit rewritten by rebase is not reported again', () =>
  withRepo((root) => {
    git(root, ['checkout', '-q', '-b', 'feat'])
    write(root, 'apps/web/src/feat.ts', 'export const feat = true\n')
    commitAt(root, ['apps/web/src/feat.ts'], 'untagged earlier-turn work', '2026-01-01T00:00:00Z')
    git(root, ['checkout', '-q', 'main'])
    write(root, 'apps/api/src/main.ts', 'export const main = true\n')
    commitAt(root, ['apps/api/src/main.ts'], 'main moves on [id=-]', '2026-01-02T00:00:00Z')
    git(root, ['checkout', '-q', 'feat'])

    const sessionId = 'rebase-only'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    // rebase는 committer 시각을 새로 쓰지만 author 시각은 이전 턴 그대로 둔다.
    git(root, ['rebase', '-q', 'main'])
    assert.ok(Number(git(root, ['log', '-1', '--format=%ct']).trim()) > Date.parse('2026-01-02T00:00:00Z') / 1000)
    write(root, 'apps/web/src/new.ts', 'export const fresh = true\n')
    commit(root, ['apps/web/src/new.ts'], 'untagged new work')

    assert.deepEqual(untaggedShas(root, sessionId), [headSha(root)])
  }))

test('Stop rechecks STATE resolved by hand in a merge commit of this turn', () =>
  withRepo((root) => {
    seedStateItem(root, 'shared', 'root')
    git(root, ['checkout', '-q', '-b', 'other'])
    write(root, 'STATE.md', readFileSync(join(root, 'STATE.md'), 'utf8').replace('- [shared] fixture', '- [shared] other side'))
    commitAt(root, ['STATE.md'], 'other side [id=shared]')
    git(root, ['checkout', '-q', 'main'])
    write(root, 'STATE.md', readFileSync(join(root, 'STATE.md'), 'utf8').replace('- [shared] fixture', '- [shared] main side'))
    commit(root, ['STATE.md'], 'main side [id=shared]')

    const sessionId = 'merge-resolution'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    const merge = spawnSync('git', ['merge', '-q', 'other'], { cwd: root, encoding: 'utf8' })
    assert.notEqual(merge.status, 0, 'expected a STATE.md conflict')
    write(
      root,
      'STATE.md',
      readFileSync(join(root, 'STATE.md'), 'utf8')
        .replace(/<<<<<<<[\s\S]*?>>>>>>> other\n/, '- [shared] merged\n- no id line from bad resolution\n'),
    )
    git(root, ['add', 'STATE.md'])
    git(root, ['commit', '-q', '--no-edit'])
    assert.equal(git(root, ['status', '--porcelain']).trim(), '')

    // 머지 커밋은 태그 판정에서 빠지지만, 머지에서 직접 고친 STATE 경로는 구조 재검한다.
    const message = stopMessage(root, sessionId)
    assert.match(message, /STATE\.md "- no id line from bad resolution…" id 없는 항목/)
    assert.doesNotMatch(message, /태그가 없는 커밋/)
  }))

test('STATE edits never cover untagged commits, whatever their order or channel', () =>
  withRepo((root) => {
    const cases = [
      ['state-commit-before', (codePath) => {
        writeDetail(root, 'docs/state/web/early.md', detail('early', 'state first'))
        commit(root, ['apps/web/STATE.md', 'docs/state/web/early.md'], 'state first [id=early]')
        write(root, codePath, 'export const v = 1\n')
        commit(root, [codePath], 'code only state-commit-before')
      }],
      ['state-commit-after', (codePath) => {
        write(root, codePath, 'export const v = 1\n')
        commit(root, [codePath], 'code only state-commit-after')
        writeDetail(root, 'docs/state/web/late.md', detail('late', 'state after code'))
        commit(root, ['apps/web/STATE.md', 'docs/state/web/late.md'], 'state after code [id=late]')
      }],
      ['dirty-state', (codePath) => {
        write(root, codePath, 'export const v = 1\n')
        commit(root, [codePath], 'code only dirty-state')
        writeDetail(root, 'docs/state/web/dirty.md', detail('dirty', 'dirty state later'))
      }],
    ]
    for (const [sessionId, act] of cases) {
      runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
      act(`apps/web/src/${sessionId}.ts`)
      assert.match(stopMessage(root, sessionId), new RegExp(` — [0-9a-f]{7} code only ${sessionId}\\. `), sessionId)
    }
  }))

test('a concurrent session in the same worktree holds tag and append judgement', () =>
  withRepo((root) => {
    const statePath = seedStateItem(root, 'held', 'web', 'short summary')
    runHook(SNAPSHOT_SCRIPT, root, { session_id: 'concurrent-a' })
    // 세션 단위 경고는 SessionStart가 한 번 내고, 턴 시작은 오류만 출력한다.
    const sessionStart = JSON.parse(runHook(SESSION_SCRIPT, root, {
      session_id: 'concurrent-b',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }))
    assert.match(
      sessionStart.hookSpecificOutput.additionalContext,
      /다른 활성 세션 1개가 감지됐습니다\. 변경 귀속이 불명확하므로 Stop의 커밋 태그·덧붙임 판정은 보류됩니다\./,
    )
    assert.equal(runHook(SNAPSHOT_SCRIPT, root, { session_id: 'concurrent-b' }), '')
    write(root, 'apps/web/src/concurrent.ts', 'export const concurrent = true\n')
    commit(root, ['apps/web/src/concurrent.ts'], 'untagged concurrent work')
    write(root, statePath, detail('held', `short summary\n${'- 경과\n'.repeat(300)}`, false, 'web', 'agent'))

    const parsed = JSON.parse(stop(root, 'concurrent-a', { STATE_LEDGER_HOST: 'antigravity' }))
    assert.equal(
      parsed.systemMessage,
      'STATE reminder: 같은 worktree의 다른 활성 세션 1개가 감지되어 이번 턴의 커밋 태그·덧붙임 판정을 보류했습니다. worktree를 분리하세요.',
    )
    assert.equal(parsed.stateLedgerContinue, false)
  }))

test('Stop flags a detail body that grew by more than 1KB during the turn', () =>
  withRepo((root) => {
    const statePath = seedStateItem(root, 'grow', 'web', 'short summary')
    const sessionId = 'appended-body'
    const appended = () => runEngine(root, { session_id: sessionId }).appendedDetails
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    let body = `short summary\n\n${'- 작업 경과 기록\n'.repeat(80)}`
    write(root, statePath, detail('grow', body, false, 'web', 'agent'))
    const parsed = JSON.parse(stop(root, sessionId, { STATE_LEDGER_HOST: 'antigravity' }))
    assert.match(
      parsed.systemMessage,
      /^STATE reminder: docs\/state\/web\/grow\.md 본문이 이번 턴에 \d+ B 늘었습니다 — 작업 경과를 덧붙이지 말고 남은 일·결정·WHY를 바꿔 쓰세요\.$/,
    )
    assert.equal(parsed.stateLedgerContinue, true)

    // 다음 턴은 그 턴 시작 크기와 비교한다: 정확히 1024B 증가·새 detail은 알리지 않는다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    body += 'x'.repeat(1024)
    write(root, statePath, detail('grow', body, false, 'web', 'agent'))
    writeDetail(root, 'docs/state/web/fresh.md', detail('fresh', 'n'.repeat(1500)))
    assert.deepEqual(appended(), [])

    // 바꿔 쓰기는 덧붙임이 아니다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, statePath, detail('grow', 'rewritten summary — 남은 일과 결정만', false, 'web', 'agent'))
    assert.deepEqual(appended(), [])

    // ## 원장에 쌓는 경과도 본문 전체로 잰다. 커밋한 증가도 같다.
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, statePath, detail('grow', `rewritten summary\n\n## 원장\n\n${'- 턴 실측 기록\n'.repeat(80)}`, false, 'web', 'agent'))
    commit(root, [statePath], 'record [id=grow]')
    assert.deepEqual(appended().map((entry) => entry.path), [statePath])
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
    assert.doesNotMatch(message, /STATE id 태그가 없는 커밋/)
    assert.match(message, /heavy-now\.md ## 현재 \d+B \(cap 4096B\)/)
  }))

test('index line and file cap warnings send progress to commit messages', () =>
  withRepo((root) => {
    const longLines = Array.from({ length: 5 }, (_, i) => `- placeholder ${i} ${'x'.repeat(900)}`).join('\n')
    write(root, 'STATE.md', stateIndex('root').replace('## 4. 미해결', `${longLines}\n\n## 4. 미해결`))
    const result = spawnSync('bash', [WIP_CHECK_SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOOK_PROJECT_DIR: root, STATE_CHECK_AREA: 'root' },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stderr,
      /자 \(줄 cap 200자 초과\) — 줄은 제목·짧은 상태만, 남은 일·결정·WHY는 detail로, 완료 경과는 커밋 메시지로/,
    )
    assert.match(
      result.stderr,
      /B \(파일 cap 4096B 초과\) — 인덱스는 1줄 항목만, 남은 일·결정·WHY는 detail로, 완료 경과는 커밋 메시지로/,
    )
    assert.doesNotMatch(result.stderr, /서사는/)
  }))

test('amending or dropping an untagged commit within the turn leaves nothing to report', () =>
  withRepo((root) => {
    seedStateItem(root, 'alpha')
    const sessionId = 'amend-or-drop'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'apps/web/src/a.ts', 'export const a = true\n')
    commit(root, ['apps/web/src/a.ts'], 'quick fix')
    git(root, ['commit', '-q', '--amend', '-m', 'quick fix [id=alpha]'])
    write(root, 'apps/web/src/b.ts', 'export const b = true\n')
    commit(root, ['apps/web/src/b.ts'], 'throwaway')
    git(root, ['reset', '-q', '--hard', 'HEAD~1'])

    assert.equal(stop(root, sessionId), '')
  }))

test('an id registered only in the uncommitted working tree is valid', () =>
  withRepo((root) => {
    const sessionId = 'register-in-working-tree'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    writeDetail(root, 'docs/state/web/newid.md', detail('newid', 'new item'))
    write(root, 'apps/web/src/n.ts', 'export const n = true\n')
    commit(root, ['apps/web/src/n.ts'], 'implement new item [id=newid]')

    const result = runEngine(root, { session_id: sessionId })
    assert.deepEqual(result.untaggedCommits, [])
    assert.deepEqual(result.unknownIdCommits, [])
  }))

test('an id registered and archived within one turn is valid through its own commit', () =>
  withRepo((root) => {
    const sessionId = 'register-and-archive'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    writeDetail(root, 'docs/state/root/bar.md', detail('bar', 'short lived', false, 'root'))
    write(root, 'apps/web/src/bar.ts', 'export const bar = true\n')
    commit(root, ['STATE.md', 'docs/state/root/bar.md', 'apps/web/src/bar.ts'], 'add bar [id=bar]')
    write(root, 'STATE.md', readFileSync(join(root, 'STATE.md'), 'utf8').replace('- [bar] fixture\n', ''))
    rmSync(join(root, 'docs/state/root/bar.md'))
    commit(root, ['STATE.md', 'docs/state/root/bar.md'], 'archive [id=bar]')

    // 턴 시작·현재 HEAD·작업 트리·기본 브랜치 어디에도 bar가 없지만 태그 커밋 자신의 트리에는 있다.
    assert.equal(stop(root, sessionId, { STATE_LEDGER_HOST: 'antigravity' }), '')
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

    assert.doesNotMatch(readFileSync(join(root, 'apps/web/STATE.md'), 'utf8'), /mainid/)
    const result = runEngine(root, { session_id: sessionId })
    assert.deepEqual(result.untaggedCommits, [])
    assert.deepEqual(result.unknownIdCommits, [])
  }))

test('the first commits of an empty repository are judged', () =>
  withEmptyRepo((root) => {
    const sessionId = 'empty-repository'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'STATE.md', stateIndex('root'))
    write(root, 'src/a.ts', 'export const a = true\n')
    commit(root, ['STATE.md', 'src/a.ts'], 'initial untagged work')
    const first = headSha(root)
    write(root, 'src/b.ts', 'export const b = true\n')
    commit(root, ['src/b.ts'], 'second untagged work')

    assert.deepEqual(untaggedShas(root, sessionId), [first, headSha(root)])
  }))

test('git errors in an empty repository do not hide Stop warnings', () =>
  withEmptyRepo((root) => {
    const sessionId = 'empty-stderr'
    write(root, 'STATE.md', stateIndex('root'))
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    write(root, 'docs/state/root/broken.md', 'no frontmatter\n')
    assert.match(stopMessage(root, sessionId), /docs\/state\/root\/broken\.md frontmatter 없음/)
  }))

test('a reported commit is not repeated and commits between turns are not judged', () =>
  withRepo((root) => {
    const sessionId = 'turn-only'
    assert.equal(runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId }), '')
    write(root, 'apps/web/src/a.ts', 'export const a = true\n')
    commit(root, ['apps/web/src/a.ts'], 'untagged a')
    assert.match(stopMessage(root, sessionId), / — [0-9a-f]{7} untagged a\. /)
    // 같은 턴에 Stop이 다시 와도 반복하지 않는다.
    assert.equal(stop(root, sessionId), '')

    // 턴 사이에 만든 커밋은 판정하지 않고, 다음 턴 시작은 이전 판정을 주입하지 않는다.
    write(root, 'apps/web/src/b.ts', 'export const b = true\n')
    commit(root, ['apps/web/src/b.ts'], 'untagged b between turns')
    assert.equal(runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId }), '')
    assert.equal(stop(root, sessionId), '')
  }))

test('untagged commits are listed up to six with an overflow count', () =>
  withRepo((root) => {
    const sessionId = 'per-commit'
    runHook(SNAPSHOT_SCRIPT, root, { session_id: sessionId })
    for (let i = 0; i < 7; i += 1) {
      write(root, `apps/web/src/z${i}.ts`, `export const z = ${i}\n`)
      commit(root, [`apps/web/src/z${i}.ts`], i === 0 ? `small untagged 0 ${'w'.repeat(100)}` : `small untagged ${i}`)
    }

    const message = stopMessage(root, sessionId)
    assert.match(message, / — [0-9a-f]{7} small untagged 0 w+…, [0-9a-f]{7} small untagged 1, /)
    assert.match(message, /small untagged 5 외 1개\. /)
    assert.doesNotMatch(message, /small untagged 6/)
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

      assert.deepEqual(runEngine(root, { session_id: sessionId }).untaggedCommits, [
        { sha: headSha(root), subject: 'signed untagged work' },
      ])
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

    const parsed = JSON.parse(stop(root, sessionId, { STATE_LEDGER_HOST: 'antigravity' }))
    assert.equal(
      parsed.systemMessage,
      'STATE reminder: 이번 턴 커밋이 판정 상한(1000개)을 넘어 커밋 태그 판정을 건너뛰었습니다.',
    )
    assert.equal(parsed.stateLedgerContinue, false)
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

test('Antigravity Stop continues once for this turn\'s reminders and allows otherwise', () => {
  const root = mkdtempSync(join(tmpdir(), 'antigravity-stop-debt-'))
  try {
    git(root, ['init', '-b', 'main'])
    write(root, 'STATE.md', '# STATE\n\n## 1. 활성 (지금 작업 중)\n- [test] Title — note\n\n## 2. 다음\n\n## 3. 미래\n\n## 4. 미해결\n')
    write(root, 'docs/state/root/test.md', detail('test', 'initial', true))
    write(root, 'app.js', 'console.log("initial");\n')
    git(root, ['add', '.'])
    git(root, ['commit', '-m', 'init [id=test]'])

    const sid = `test-anti-stop-${Date.now()}`
    const turn = (invocationNum) =>
      runHook(ANTIGRAVITY_PRE_INVOCATION, root, { conversationId: sid, invocationNum, workspacePaths: [root] })
    const stopOnce = (executionNum = 1) =>
      JSON.parse(runHook(ANTIGRAVITY_STOP, root, { conversationId: sid, executionNum, workspacePaths: [root] }))

    // 미커밋 작업은 알리지 않는다.
    turn(1)
    write(root, 'app.js', 'console.log("changed work");\n')
    assert.equal(stopOnce().decision, 'allow')

    // 이번 턴의 태그 없는 커밋은 1회 continue, 재진입은 allow.
    turn(2)
    git(root, ['add', 'app.js'])
    git(root, ['commit', '-q', '-m', 'change without an id'])
    const reminded = stopOnce()
    assert.equal(reminded.decision, 'continue')
    assert.match(reminded.reason, /^STATE 알림:\nSTATE reminder: 이번 턴 커밋 중 STATE id 태그가 없는 커밋 — [0-9a-f]{7} change without an id\. /)
    assert.equal(stopOnce(2).decision, 'allow')

    // 다음 턴은 이전 턴 커밋을 다시 알리지 않는다. 태그 있는 커밋도 allow.
    turn(3)
    write(root, 'app.js', 'console.log("tagged work");\n')
    git(root, ['add', 'app.js'])
    git(root, ['commit', '-q', '-m', 'tagged work [id=test]'])
    assert.equal(stopOnce().decision, 'allow')

    // 크기 외 구조 경고(인덱스에 없는 detail)는 continue.
    turn(4)
    write(root, 'docs/state/root/orphan.md', detail('orphan', 'not indexed', false, 'root'))
    const structural = stopOnce()
    assert.equal(structural.decision, 'continue')
    assert.match(structural.reason, /docs\/state\/root\/orphan\.md — STATE\.md 인덱스에 없음/)

    // 동시 세션 보류 알림만 있으면 continue하지 않는다.
    turn(5)
    runHook(SNAPSHOT_SCRIPT, root, { session_id: `${sid}-other` })
    write(root, 'app.js', 'console.log("held work");\n')
    git(root, ['add', 'app.js'])
    git(root, ['commit', '-q', '-m', 'held change without an id'])
    assert.equal(stopOnce().decision, 'allow')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(`${root}-hook-data`, { recursive: true, force: true })
  }
})
