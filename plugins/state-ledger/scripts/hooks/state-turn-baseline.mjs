#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot, stateConfig } from './state-config.mjs'

const SNAPSHOT_VERSION = 6
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVE_SESSION_MS = 30 * 60 * 1000
const STATE_SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// '## 현재'가 이번 턴 기준(before.head) 대비 이만큼 넘게 늘면 작업 경과 덧붙이기로 본다.
const CURRENT_APPEND_LIMIT_BYTES = 1024
const DETAIL_PATH_RE = /^docs\/state\/[^/]+\/[^/]+\.md$/
const INDEX_ID_RE = /^- \[([a-z0-9-]{3,12})\]/gm
const COMMIT_TAG_RE = /\[id=([a-z0-9-]{3,12})\]/g

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

// `<rev>:<path>` 여러 개를 git cat-file 한 번으로 읽는다. 없는 객체는 null.
function readBlobs(root, requested) {
  const blobs = new Map()
  // 줄바꿈이 든 경로는 batch 입력 정렬을 깨므로 읽지 않는다.
  const specs = requested.filter((spec) => {
    if (!spec.includes('\n')) return true
    blobs.set(spec, null)
    return false
  })
  if (specs.length === 0) return blobs
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: `${specs.join('\n')}\n`,
    maxBuffer: 256 * 1024 * 1024,
  })
  let offset = 0
  for (const spec of specs) {
    const newline = output.indexOf(0x0a, offset)
    if (newline < 0) break
    const header = output.subarray(offset, newline).toString('utf8')
    offset = newline + 1
    const match = header.match(/^[0-9a-f]+ (\S+) (\d+)$/)
    if (!match) {
      blobs.set(spec, null)
      continue
    }
    const size = Number(match[2])
    blobs.set(spec, match[1] === 'blob' ? output.subarray(offset, offset + size).toString('utf8') : null)
    offset += size + 1
  }
  return blobs
}

// '## 현재' 줄부터 다음 '## ' heading 직전까지의 UTF-8 바이트 수.
// check-state-wip-cap.sh의 '## 현재' cap과 같은 경계로 잰다.
function currentSectionBytes(text) {
  const body = text.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1] ?? text
  const lines = body.split('\n')
  const start = lines.indexOf('## 현재')
  if (start < 0) return 0
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  if (end < 0) end = lines.length
  return Buffer.byteLength(lines.slice(start, end).join('\n'), 'utf8')
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
  if (path === '.staterc') return true
  return !isState(path, config) &&
    config.workIncludeRe.test(path) &&
    !config.workExcludeRe.test(path)
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

// 기준점 이후 커밋을 오래된 순서로 돌려준다. 머지 커밋은 제외한다 — 머지된 쪽 커밋은
// 범위에 함께 들어오거나(따로 판정) 이전 턴에 이미 판정됐고, 기본 머지 메시지에는 id가 없다.
function committedCommits(root, beforeHead, afterHead, config) {
  if (!beforeHead || !afterHead || beforeHead === afterHead) return []
  const log = git(root, [
    'log',
    '--reverse',
    '--topo-order',
    '--no-merges',
    '--format=%H%x00%B%x1e',
    `${beforeHead}..${afterHead}`,
  ])
  return log
    .split('\x1e')
    .map((entry) => entry.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((entry, index) => {
      const separator = entry.indexOf('\0')
      const sha = entry.slice(0, separator)
      const message = entry.slice(separator + 1)
      const paths = git(root, [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--name-only',
        '-r',
        '-z',
        '--no-renames',
        sha,
      ])
        .split('\0')
        .filter(Boolean)
        .filter((path) => isState(path, config) || isWorkFile(path, config))
      const tags = [...new Set([...message.matchAll(COMMIT_TAG_RE)].map((match) => match[1]))]
      return { sha, rank: index + 1, paths, tags }
    })
}

function committedPathRanks(commits) {
  const ranks = new Map()
  for (const commit of commits) {
    for (const path of commit.paths) ranks.set(path, commit.rank)
  }
  return ranks
}

// 커밋 태그가 가리킬 수 있는 id = 기준점·현재 HEAD·범위 안에서 인덱스를 바꾼 커밋 시점의
// 인덱스 id 합집합. archive로 지워진 id와 턴 안에서 추가 후 archive된 id도 포함된다.
function validStateIds(root, before, current, commits, config) {
  const ids = new Set()
  if (!commits.some((commit) => commit.tags.length)) return ids
  const revs = new Set([before?.head, current.head].filter(Boolean))
  for (const commit of commits) {
    if (commit.paths.some((path) => config.areaByIndex.has(path))) revs.add(commit.sha)
  }
  const specs = [...revs].flatMap((rev) => config.indexes.map((index) => `${rev}:${index}`))
  for (const text of readBlobs(root, specs).values()) {
    if (!text) continue
    for (const match of text.matchAll(INDEX_ID_RE)) ids.add(match[1])
  }
  return ids
}

// 이번 턴에 바뀐 detail마다 '## 현재' 크기를 기준점 HEAD의 내용과 비교한다. 기준점에 없던
// 새 detail은 생성이지 덧붙이기가 아니므로 제외한다(크기는 check-state-wip-cap.sh의 cap이 본다).
function appendedCurrentSections(root, delta) {
  const baseRev = delta.before?.head ?? delta.current.head
  const details = delta.stateChanged.filter((path) => DETAIL_PATH_RE.test(path))
  if (!baseRev || details.length === 0) return []
  const blobs = readBlobs(root, details.map((path) => `${baseRev}:${path}`))
  const appended = []
  for (const path of details) {
    const base = blobs.get(`${baseRev}:${path}`)
    if (base == null) continue
    let text
    try {
      text = readFileSync(join(root, path), 'utf8')
    } catch {
      continue
    }
    const beforeBytes = currentSectionBytes(base)
    const afterBytes = currentSectionBytes(text)
    if (afterBytes - beforeBytes > CURRENT_APPEND_LIMIT_BYTES) {
      appended.push({ path, before: beforeBytes, after: afterBytes })
    }
  }
  return appended
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
    execFileSync('bash', [join(STATE_SCRIPTS_DIR, 'check-state-wip-cap.sh')], {
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

// 이전 버전의 working(미커밋) 채널·channel 없는 legacy debt는 더 이상 판정 대상이 아니다.
function committedDebt(items) {
  if (!Array.isArray(items)) return []
  return items.filter(
    (item) => item?.channel === 'committed' && typeof item.path === 'string' && typeof item.area === 'string',
  )
}

function turnDelta(root, id, payload, config) {
  const beforeResult = readSnapshot(root, id)
  const before = beforeResult.value
  const current = snapshot(root, id, payload, config)
  const workingChanged = new Set(before ? changedWorkingTreePaths(before.files, current.files) : Object.keys(current.files))
  const commits = before ? committedCommits(root, before.head, current.head, config) : []
  const committedRanks = committedPathRanks(commits)
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
    commits,
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

// 판정 규칙(0.4.0~):
// - 작업 기록은 커밋 메시지가 맡는다. 기준점 이후 작업 파일을 바꾼 커밋의 메시지에 유효
//   [id=<id>]가 있으면 그 경로는 debt가 아니다. 한 경로를 바꾼 커밋 중 하나라도 태그가 없으면 debt.
// - 태그 없는 committed 작업은 대응 영역 STATE의 의미 있는 committed 차분(그 커밋 이후)으로도
//   덮인다. 상태가 실제로 바뀐 경우를 위한 기존 경로다.
// - 미커밋 작업은 debt를 만들지 않는다. 커밋될 때 위 규칙으로 판정한다.
// - 이전 턴의 committed debt는 같은 영역의 committed STATE 차분 또는 같은 경로를 바꾼 태그 커밋으로 해제한다.
// - 같은 worktree의 다른 활성 세션이 보이면 새 귀속 판정을 보류하고 기존 debt를 그대로 둔다.
function evaluate(root, id, payload, config) {
  const delta = turnDelta(root, id, payload, config)
  const { before, current, stateChanged, workingChanged, commits, committedRanks } = delta
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

  const validIds = validStateIds(root, before, current, commits, config)
  const untaggedCodeRanks = new Map()
  const taggedCodePaths = new Set()
  for (const commit of commits) {
    const tagged = commit.tags.some((tag) => validIds.has(tag))
    for (const path of commit.paths) {
      if (isState(path, config) || !isWorkFile(path, config)) continue
      if (tagged) taggedCodePaths.add(path)
      else untaggedCodeRanks.set(path, commit.rank)
    }
  }

  const priorDebt = committedDebt(before?.debt)
  const debt = concurrentSessions.length
    ? [...priorDebt]
    : priorDebt.filter((item) => !committedStateAreas.has(item.area) && !taggedCodePaths.has(item.path))
  const stateBeforeWorkAreas = new Set()
  const stateChannelMismatchAreas = new Set()
  const untaggedCodePaths = [...untaggedCodeRanks.keys()].sort()
  const area = untaggedCodePaths.length ? requiredArea(untaggedCodePaths, config) : null
  if (area && concurrentSessions.length === 0) {
    const codeRank = Math.max(...untaggedCodePaths.map((path) => untaggedCodeRanks.get(path)))
    const stateRank = Math.max(
      0,
      ...committedStatePaths
        .filter((path) => stateArea(path, config) === area)
        .map((path) => committedRanks.get(path) ?? 0),
    )
    const covered = before !== null && committedStateAreas.has(area) && stateRank >= codeRank
    if (!covered) {
      // 경고는 debt가 실제로 남을 때만: STATE 커밋이 코드 커밋보다 앞섰거나, STATE 변경이 미커밋인 경우.
      if (committedStateAreas.has(area)) stateBeforeWorkAreas.add(area)
      else if (workingStateAreas.has(area)) stateChannelMismatchAreas.add(area)
      for (const path of untaggedCodePaths) debt.push({ path, area, channel: 'committed' })
    }
  }

  const uniqueDebt = [...new Map(debt.map((item) => [`${item.area}:${item.channel}:${item.path}`, item])).values()].sort(
    (a, b) => a.path.localeCompare(b.path),
  )
  const appended = appendedCurrentSections(root, delta)
  writeSnapshot(root, id, { ...current, active: false, debt: uniqueDebt })

  // STATE 갱신은 더 이상 필수가 아니므로 '해제에 쓰지 못한 STATE' 경고는 그 영역에 debt가 남을 때만 낸다.
  const releaseRelevantAreas = concurrentSessions.length
    ? new Set()
    : new Set(uniqueDebt.map((item) => item.area))
  return {
    ...publicTurnDelta(delta),
    stateAreas: [...stateAreas].sort(),
    validStateAreas: [...validStateAreas].sort(),
    invalidStateAreas: [...stateAreas]
      .filter((stateAreaName) => !structurallyValidStateAreas.has(stateAreaName))
      .filter((stateAreaName) => releaseRelevantAreas.has(stateAreaName))
      .sort(),
    metadataOnlyStateAreas: [...structurallyValidStateAreas]
      .filter((stateAreaName) => !semanticStateAreas.has(stateAreaName))
      .filter((stateAreaName) => releaseRelevantAreas.has(stateAreaName))
      .sort(),
    stateBeforeWorkAreas: [...stateBeforeWorkAreas].sort(),
    stateChannelMismatchAreas: [...stateChannelMismatchAreas].sort(),
    appendedCurrentSections: appended,
    concurrentSessions,
    requiredArea: area,
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
