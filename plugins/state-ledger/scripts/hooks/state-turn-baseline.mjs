#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const SNAPSHOT_VERSION = 5
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVE_SESSION_MS = 30 * 60 * 1000
const DEFAULT_STATE_INDEXES = 'STATE.md'
const DEFAULT_STATE_CODE_RE = String.raw`\.(ts|tsx|js|jsx|sh|py|css|ya?ml|json|sql|toml)$|(^|/)Dockerfile`

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

function readPayload() {
  try {
    const input = readFileSync(0, 'utf8').trim()
    return input ? JSON.parse(input) : {}
  } catch {
    return {}
  }
}

function sha(value) {
  return createHash('sha256').update(value).digest('hex')
}

function projectRoot() {
  const configured = process.env.HOOK_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR
  const root = configured || git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
  return realpathSync(resolve(root))
}

function readStaterc(root, key) {
  try {
    const line = readFileSync(join(root, '.staterc'), 'utf8')
      .split('\n')
      .find((candidate) => new RegExp(`^${key}="[^"]*"\\s*$`).test(candidate))
    return line?.match(/^[A-Z_]+="([^"]*)"\s*$/)?.[1] ?? null
  } catch {
    return null
  }
}

function stateConfig(root) {
  const configuredIndexes = readStaterc(root, 'STATE_INDEXES') || DEFAULT_STATE_INDEXES
  const indexes = [...new Set(configuredIndexes.split(/\s+/).filter(Boolean))]
  const indexByArea = {}
  const areaByIndex = new Map()
  const scopes = []

  for (const path of indexes) {
    if (path.startsWith('/') || path === '..' || path.startsWith('../') || path.includes('/../')) {
      throw new Error(`STATE_INDEXES contains an unsafe path: ${path}`)
    }
    const normalized = path.replace(/^\.\//, '')
    const area = normalized === 'STATE.md' ? 'root' : basename(dirname(normalized))
    if (indexByArea[area] && indexByArea[area] !== normalized) {
      throw new Error(`STATE_INDEXES maps multiple indexes to area ${area}`)
    }
    indexByArea[area] = normalized
    areaByIndex.set(normalized, area)
    if (area !== 'root') scopes.push({ area, prefix: `${dirname(normalized)}/` })
  }

  if (indexes.length === 0) throw new Error('STATE_INDEXES must contain at least one path')

  const codePattern = readStaterc(root, 'STATE_CODE_RE') || DEFAULT_STATE_CODE_RE
  return {
    indexByArea,
    areaByIndex,
    scopes: scopes.sort((a, b) => b.prefix.length - a.prefix.length),
    codeRe: new RegExp(codePattern),
  }
}

function sessionId(payload) {
  const value = payload.session_id ?? payload.sessionID ?? process.env.STATE_HOOK_SESSION_ID
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function dataDirectory() {
  return resolve(process.env.STATE_HOOK_DATA_DIR ?? join(tmpdir(), 'state-ledger-hooks'))
}

function baselinePath(root, id) {
  return join(dataDirectory(), `${sha(root).slice(0, 16)}-${sha(id).slice(0, 24)}.json`)
}

function cleanupOldBaselines(directory) {
  const cutoff = Date.now() - MAX_AGE_MS
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const path = join(directory, entry.name)
    try {
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path)
    } catch {
      // 다른 세션의 동시 cleanup 또는 이미 제거된 파일은 무시한다.
    }
  }
}

function stateArea(path, config) {
  const indexArea = config.areaByIndex.get(path)
  if (indexArea) return indexArea
  const detail = path.match(/^docs\/state\/([^/]+)\/[^/]+\.md$/)
  return detail && config.indexByArea[detail[1]] ? detail[1] : null
}

function isState(path, config) {
  return stateArea(path, config) !== null
}

function stateSemanticDigest(path, text) {
  const detail = /^docs\/state\//.test(path)
    ? text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    : null
  const semanticText = detail
    ? `${detail[1]
        .split('\n')
        .filter((line) => !/^(touched|hash):/.test(line))
        .join('\n')}\n${detail[2]}`
    : text
  const normalized = semanticText
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line && !line.startsWith('<!--'))
    .join('\n')
  return sha(normalized)
}

function stateSemantics(root, config) {
  const paths = Object.values(config.indexByArea)
  for (const area of Object.keys(config.indexByArea)) {
    const directory = join(root, 'docs', 'state', area)
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          paths.push(`docs/state/${area}/${entry.name}`)
        }
      }
    } catch {
      // 아직 detail 디렉터리가 없는 영역은 인덱스 존재성 검사에서 별도로 다룬다.
    }
  }
  const semantics = {}
  for (const path of paths) {
    try {
      semantics[path] = stateSemanticDigest(path, readFileSync(join(root, path), 'utf8'))
    } catch {
      // 삭제·부재 파일은 map에서 빠진 상태 자체가 semantic delta가 된다.
    }
  }
  return semantics
}

function isWorkFile(path, config) {
  return !isState(path, config) && config.codeRe.test(path)
}

function workArea(path, config) {
  const scoped = config.scopes.find(({ prefix }) => path.startsWith(prefix))
  if (scoped) return scoped.area
  if (config.indexByArea.root) return 'root'
  return Object.keys(config.indexByArea)[0]
}

function dirtyFiles(root, config) {
  const output = git(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--no-renames',
    '--untracked-files=all',
  ])
  const files = {}

  for (const entry of output.split('\0')) {
    if (!entry) continue
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    if (!isState(path, config) && !isWorkFile(path, config)) continue

    const absolute = join(root, path)
    let digest = null
    let mtimeMs = null
    try {
      const info = lstatSync(absolute)
      mtimeMs = info.mtimeMs
      if (info.isSymbolicLink()) {
        digest = sha(`link:${readlinkSync(absolute)}`)
      } else if (info.isFile()) {
        digest = sha(readFileSync(absolute))
      }
    } catch {
      // 삭제 파일은 상위 디렉터리 mtime으로 삭제 순서를 근사한다.
      try {
        mtimeMs = statSync(dirname(absolute)).mtimeMs
      } catch {
        // 상위 디렉터리까지 사라진 경우 null로 두고 Stop 시각을 사용한다.
      }
    }
    files[path] = { status, digest, mtimeMs }
  }

  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}

function head(root) {
  try {
    return git(root, ['rev-parse', 'HEAD']).trim()
  } catch {
    return null
  }
}

function snapshot(root, id, payload, config, debt = []) {
  return {
    version: SNAPSHOT_VERSION,
    root,
    sessionIdHash: sha(id).slice(0, 16),
    turnId: typeof payload.turn_id === 'string' ? payload.turn_id : null,
    capturedAt: new Date().toISOString(),
    active: true,
    concurrentSessionsSeen: [],
    head: head(root),
    files: dirtyFiles(root, config),
    stateSemantics: stateSemantics(root, config),
    debt,
  }
}

function writeSnapshot(root, id, value) {
  const directory = dataDirectory()
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  cleanupOldBaselines(directory)

  const path = baselinePath(root, id)
  const temp = join(directory, `.${basename(path)}-${process.pid}.tmp`)
  writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temp, path)
}

function readSnapshot(root, id) {
  try {
    const value = JSON.parse(readFileSync(baselinePath(root, id), 'utf8'))
    if (value?.version !== SNAPSHOT_VERSION || value?.root !== root || !value?.files || !value?.stateSemantics) {
      return { value: null, error: 'invalid-or-stale-baseline' }
    }
    return { value, error: null }
  } catch (error) {
    return {
      value: null,
      error: error?.code === 'ENOENT' ? 'missing-baseline' : 'unreadable-baseline',
    }
  }
}

function activeOtherSessions(root, ownSessionIdHash) {
  const directory = dataDirectory()
  const cutoff = Date.now() - ACTIVE_SESSION_MS
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .flatMap((entry) => {
        try {
          const value = JSON.parse(readFileSync(join(directory, entry.name), 'utf8'))
          const capturedAt = Date.parse(value?.capturedAt)
          if (
            value?.version === SNAPSHOT_VERSION &&
            value?.root === root &&
            value?.active === true &&
            value?.sessionIdHash !== ownSessionIdHash &&
            Number.isFinite(capturedAt) &&
            capturedAt >= cutoff
          ) {
            return [value.sessionIdHash]
          }
        } catch {
          // 손상되었거나 동시에 교체된 다른 세션 파일은 건너뛴다.
        }
        return []
      })
      .filter(Boolean)
      .sort()
  } catch {
    return []
  }
}

function saveSnapshot(root, id, payload, config, onlyIfAbsent = false) {
  const before = readSnapshot(root, id)
  const ownSessionIdHash = sha(id).slice(0, 16)
  const concurrentSessions = activeOtherSessions(root, ownSessionIdHash)
  if (onlyIfAbsent && before.value) return concurrentSessions
  const debt = Array.isArray(before.value?.debt) ? before.value.debt : []
  writeSnapshot(root, id, {
    ...snapshot(root, id, payload, config, debt),
    concurrentSessionsSeen: concurrentSessions,
  })
  return concurrentSessions
}

function changedWorkingTreePaths(before, after) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...paths].filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
}

function committedPathRanks(root, beforeHead, afterHead, config) {
  const ranks = new Map()
  if (!beforeHead || !afterHead || beforeHead === afterHead) return ranks
  const commits = git(root, ['rev-list', '--reverse', '--topo-order', `${beforeHead}..${afterHead}`])
    .trim()
    .split('\n')
    .filter(Boolean)

  commits.forEach((commit, index) => {
    const paths = git(root, [
      'diff-tree',
      '--root',
      '-m',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      '--no-renames',
      commit,
    ])
      .split('\0')
      .filter(Boolean)
      .filter((path) => isState(path, config) || isWorkFile(path, config))
    for (const path of paths) ranks.set(path, index + 1)
  })
  return ranks
}

function requiredArea(codePaths, config) {
  const areas = new Set(codePaths.map((path) => workArea(path, config)))
  if (areas.size === 1) return [...areas][0]
  return config.indexByArea.root ? 'root' : [...areas].sort()[0]
}

function stateAreaIsValid(root, area, config) {
  const index = config.indexByArea[area]
  if (!index) return false
  try {
    if (!lstatSync(join(root, index)).isFile()) return false
    execFileSync('bash', [join(root, 'scripts/check-state-wip-cap.sh')], {
      cwd: root,
      env: {
        ...process.env,
        STATE_CHECK_AREA: area,
        STATE_CHECK_STRICT: '1',
      },
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function pathRank(path, workingChanged, committedRanks, current) {
  if (workingChanged.has(path)) {
    return {
      phase: 2,
      order: current.files[path]?.mtimeMs ?? Date.parse(current.capturedAt),
    }
  }
  return { phase: 1, order: committedRanks.get(path) ?? 0 }
}

function latestRank(paths, workingChanged, committedRanks, current) {
  return paths.reduce((latest, path) => {
    const rank = pathRank(path, workingChanged, committedRanks, current)
    if (!latest || rank.phase > latest.phase || (rank.phase === latest.phase && rank.order > latest.order)) {
      return rank
    }
    return latest
  }, null)
}

function rankAtOrAfter(candidate, reference) {
  if (!candidate || !reference) return false
  return candidate.phase > reference.phase ||
    (candidate.phase === reference.phase && candidate.order >= reference.order)
}

function turnDelta(root, id, payload, config) {
  const beforeResult = readSnapshot(root, id)
  const before = beforeResult.value
  const current = snapshot(root, id, payload, config)
  const workingChanged = new Set(before ? changedWorkingTreePaths(before.files, current.files) : Object.keys(current.files))
  const committedRanks = before ? committedPathRanks(root, before.head, current.head, config) : new Map()
  const changed = before
    ? new Set([
        ...workingChanged,
        ...committedRanks.keys(),
      ])
    : new Set(Object.keys(current.files))
  const allChanged = [...changed].sort()
  const codeChanged = allChanged.filter((path) => !isState(path, config) && isWorkFile(path, config))
  const stateChanged = allChanged.filter((path) => isState(path, config))

  return {
    beforeResult,
    before,
    current,
    workingChanged,
    committedRanks,
    allChanged,
    codeChanged,
    stateChanged,
  }
}

function publicTurnDelta(delta) {
  return {
    baselineFound: delta.before !== null,
    baselineError: delta.beforeResult.error,
    headChanged: delta.before !== null && delta.before.head !== delta.current.head,
    allChanged: delta.allChanged,
    codeChanged: delta.codeChanged,
    stateChanged: delta.stateChanged,
  }
}

function evaluate(root, id, payload, config) {
  const delta = turnDelta(root, id, payload, config)
  const { before, current, codeChanged, stateChanged, workingChanged, committedRanks } = delta
  const stateAreas = new Set(stateChanged.map((path) => stateArea(path, config)).filter(Boolean))
  const structurallyValidStateAreas = new Set(
    [...stateAreas].filter((area) => stateAreaIsValid(root, area, config)),
  )
  const semanticStateChanged = stateChanged.filter(
    (path) => before?.stateSemantics?.[path] !== current.stateSemantics[path],
  )
  const semanticStateAreas = new Set(
    semanticStateChanged.map((path) => stateArea(path, config)).filter(Boolean),
  )
  const validStateAreas = new Set(
    [...structurallyValidStateAreas].filter((area) => semanticStateAreas.has(area)),
  )
  const workingStatePaths = semanticStateChanged.filter((path) => workingChanged.has(path))
  const committedStatePaths = semanticStateChanged.filter(
    (path) => committedRanks.has(path) && !workingChanged.has(path),
  )
  const workingStateAreas = new Set(
    workingStatePaths.map((path) => stateArea(path, config)).filter((area) => validStateAreas.has(area)),
  )
  const committedStateAreas = new Set(
    committedStatePaths.map((path) => stateArea(path, config)).filter((area) => validStateAreas.has(area)),
  )
  const concurrentSessions = [...new Set([
    ...activeOtherSessions(root, current.sessionIdHash),
    ...(Array.isArray(before?.concurrentSessionsSeen) ? before.concurrentSessionsSeen : []),
  ])].sort()

  const priorDebt = Array.isArray(before?.debt) ? before.debt : []
  const debt = concurrentSessions.length
    ? [...priorDebt]
    : priorDebt.filter((item) => {
        if (item.channel === 'working') return !workingStateAreas.has(item.area)
        return !committedStateAreas.has(item.area)
      })
  const stateBeforeWorkAreas = new Set()
  const stateChannelMismatchAreas = new Set()
  if (codeChanged.length && concurrentSessions.length === 0) {
    const area = requiredArea(codeChanged, config)
    const workingCodePaths = codeChanged.filter((path) => workingChanged.has(path))
    const committedCodePaths = codeChanged.filter((path) => committedRanks.has(path))
    const areaWorkingStatePaths = workingStatePaths.filter((path) => stateArea(path, config) === area)
    const areaCommittedStatePaths = committedStatePaths.filter((path) => stateArea(path, config) === area)

    const workingOrdered = workingCodePaths.length === 0 || rankAtOrAfter(
      latestRank(areaWorkingStatePaths, workingChanged, committedRanks, current),
      latestRank(workingCodePaths, workingChanged, committedRanks, current),
    )
    const committedOrdered = committedCodePaths.length === 0 || rankAtOrAfter(
      latestRank(areaCommittedStatePaths, workingChanged, committedRanks, current),
      latestRank(committedCodePaths, workingChanged, committedRanks, current),
    )
    const workingCovered = before !== null && workingStateAreas.has(area) && workingOrdered
    const committedCovered = before !== null && committedStateAreas.has(area) && committedOrdered

    if (workingCodePaths.length && workingStateAreas.has(area) && !workingOrdered) {
      stateBeforeWorkAreas.add(area)
    }
    if (committedCodePaths.length && committedStateAreas.has(area) && !committedOrdered) {
      stateBeforeWorkAreas.add(area)
    }
    if (workingCodePaths.length && !workingStateAreas.has(area) && validStateAreas.has(area)) {
      stateChannelMismatchAreas.add(area)
    }
    if (committedCodePaths.length && !committedStateAreas.has(area) && validStateAreas.has(area)) {
      stateChannelMismatchAreas.add(area)
    }
    if (!workingCovered) {
      for (const path of workingCodePaths) debt.push({ path, area, channel: 'working' })
    }
    if (!committedCovered) {
      for (const path of committedCodePaths) debt.push({ path, area, channel: 'committed' })
    }
  }

  const uniqueDebt = [...new Map(debt.map((item) => [`${item.area}:${item.channel ?? 'legacy'}:${item.path}`, item])).values()].sort(
    (a, b) => a.path.localeCompare(b.path),
  )
  writeSnapshot(root, id, { ...current, active: false, debt: uniqueDebt })

  return {
    ...publicTurnDelta(delta),
    stateAreas: [...stateAreas].sort(),
    validStateAreas: [...validStateAreas].sort(),
    invalidStateAreas: [...stateAreas].filter((area) => !structurallyValidStateAreas.has(area)).sort(),
    metadataOnlyStateAreas: [...structurallyValidStateAreas]
      .filter((area) => !semanticStateAreas.has(area))
      .sort(),
    stateBeforeWorkAreas: [...stateBeforeWorkAreas].sort(),
    stateChannelMismatchAreas: [...stateChannelMismatchAreas].sort(),
    concurrentSessions,
    requiredArea: codeChanged.length ? requiredArea(codeChanged, config) : null,
    debt: uniqueDebt,
  }
}

function main() {
  const mode = process.argv[2]
  const payload = readPayload()
  const root = projectRoot()
  const config = stateConfig(root)
  const id = sessionId(payload)

  if (!id) throw new Error('hook payload session_id is required')

  if (mode === 'snapshot') {
    process.stdout.write(`${JSON.stringify({ concurrentSessions: saveSnapshot(root, id, payload, config) })}\n`)
    return
  }
  if (mode === 'snapshot-if-absent') {
    process.stdout.write(
      `${JSON.stringify({ concurrentSessions: saveSnapshot(root, id, payload, config, true) })}\n`,
    )
    return
  }
  if (mode === 'evaluate') {
    process.stdout.write(`${JSON.stringify(evaluate(root, id, payload, config))}\n`)
    return
  }

  process.stderr.write('usage: state-turn-baseline.mjs snapshot|snapshot-if-absent|evaluate\n')
  process.exitCode = 2
}

main()
