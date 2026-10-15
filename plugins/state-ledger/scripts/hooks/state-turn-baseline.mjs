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
import { projectRoot, readStaterc, stateConfig } from './state-config.mjs'

const SNAPSHOT_VERSION = 6
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVE_SESSION_MS = 30 * 60 * 1000
const STATE_SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GIT_MAX_BUFFER = 256 * 1024 * 1024
// 한 번의 판정 범위가 이보다 크면 pull·브랜치 전환으로 들어온 남의 커밋으로 보고 판정을 건너뛴다.
const MAX_JUDGED_COMMITS = 1000
const MAX_PENDING_WORK_PATHS = 2000
// '## 현재'가 이 세션에서 관측한 가장 작은 크기보다 이만큼 넘게 늘면 작업 경과 덧붙이기로 본다.
const CURRENT_APPEND_LIMIT_BYTES = 1024
const DETAIL_PATH_RE = /^docs\/state\/[^/]+\/[^/]+\.md$/
const INDEX_ID_RE = /^- \[([a-z0-9-]{3,12})\]/
// '[id=-]' = STATE 항목과 무관한 작업이라는 명시 표식. 항상 유효하다.
const NO_STATE_TAG = '-'
const COMMIT_TAG_RE = /\[id=([a-z0-9-]{3,12}|-)\]/g
const SHA_REF_RE = /\b[0-9a-f]{7,64}\b/g
const SAFE_BRANCH_RE = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    ...options,
  })
}

// `<rev>` 또는 `<rev>:<path>` 여러 개를 git cat-file 한 번으로 읽는다. 없는 객체는 null.
function readObjects(root, requested) {
  const objects = new Map()
  // 줄바꿈이 든 경로는 batch 입력 정렬을 깨므로 읽지 않는다.
  const specs = [...new Set(requested)].filter((spec) => {
    if (!spec.includes('\n')) return true
    objects.set(spec, null)
    return false
  })
  if (specs.length === 0) return objects
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: `${specs.join('\n')}\n`,
    maxBuffer: GIT_MAX_BUFFER,
  })
  let offset = 0
  for (const spec of specs) {
    const newline = output.indexOf(0x0a, offset)
    if (newline < 0) break
    const header = output.subarray(offset, newline).toString('utf8')
    offset = newline + 1
    const match = header.match(/^[0-9a-f]+ (\S+) (\d+)$/)
    if (!match) {
      objects.set(spec, null)
      continue
    }
    const size = Number(match[2])
    objects.set(spec, { type: match[1], text: output.subarray(offset, offset + size).toString('utf8') })
    offset += size + 1
  }
  return objects
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

// 인덱스 id → 섹션 번호(1~4, heading 전이면 0).
function indexSections(text) {
  const sections = new Map()
  let section = 0
  for (const line of text.split('\n')) {
    const heading = line.match(/^## ([1-4])\./)
    if (heading) {
      section = Number(heading[1])
      continue
    }
    if (line.startsWith('## ')) {
      section = 0
      continue
    }
    const id = line.match(INDEX_ID_RE)?.[1]
    if (id && !sections.has(id)) sections.set(id, section)
  }
  return sections
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

// 작업 트리 STATE 파일의 의미 digest와 detail별 '## 현재' 크기.
function stateFiles(root, config) {
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
  const currentBytes = {}
  for (const path of paths) {
    try {
      const text = readFileSync(join(root, path), 'utf8')
      semantics[path] = stateSemanticDigest(path, text)
      if (DETAIL_PATH_RE.test(path)) currentBytes[path] = currentSectionBytes(text)
    } catch {
      // 삭제·부재 파일은 map에서 빠진 상태 자체가 semantic delta가 된다.
    }
  }
  return { semantics, currentBytes }
}

function isWorkFile(path, config) {
  if (path === '.staterc') return true
  return !isState(path, config) &&
    config.workIncludeRe.test(path) &&
    !config.workExcludeRe.test(path)
}

function isWorkPath(path, config) {
  return !isState(path, config) && isWorkFile(path, config)
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
        // 상위 디렉터리까지 사라진 경우 null로 둔다.
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
  const { semantics, currentBytes } = stateFiles(root, config)
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
    stateSemantics: semantics,
    currentBytes,
    debt,
  }
}

// '## 현재' 덧붙임 판정 기준 = 이 세션에서 관측한 detail별 최소 크기. 커밋 단위로 쪼갠
// 덧붙임과 미커밋 detail에 여러 턴 걸친 덧붙임도 누적량으로 보인다.
function mergeCurrentReference(reference, currentBytes) {
  const merged = {}
  for (const [path, bytes] of Object.entries(currentBytes)) {
    const previous = reference?.[path]
    merged[path] = typeof previous === 'number' ? Math.min(previous, bytes) : bytes
  }
  return merged
}

function persisted(value, extra) {
  const { currentBytes, ...rest } = value
  return { ...rest, ...extra }
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

// 턴 시작 기준점. debt·마지막 판정 HEAD(judgedHead)·Stop 때 미커밋이던 작업 경로(pendingWork)는
// 다음 Stop까지 넘긴다 — 턴 사이에 커밋된 그 작업도 다음 Stop에서 판정하기 위해서다.
function saveSnapshot(root, id, payload, config, onlyIfAbsent = false) {
  const before = readSnapshot(root, id)
  const ownSessionIdHash = sha(id).slice(0, 16)
  const concurrentSessions = activeOtherSessions(root, ownSessionIdHash)
  if (onlyIfAbsent && before.value) return concurrentSessions
  const debt = Array.isArray(before.value?.debt) ? before.value.debt : []
  const current = snapshot(root, id, payload, config, debt)
  writeSnapshot(root, id, persisted(current, {
    concurrentSessionsSeen: concurrentSessions,
    judgedHead: typeof before.value?.judgedHead === 'string' ? before.value.judgedHead : null,
    pendingWork: Array.isArray(before.value?.pendingWork) ? before.value.pendingWork : [],
    currentRef: mergeCurrentReference(before.value?.currentRef, current.currentBytes),
  }))
  return concurrentSessions
}

function changedWorkingTreePaths(before, after) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...paths].filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
}

// 범위 커밋을 오래된 순서로 돌려준다. plumbing(rev-list)만 써서 log.showSignature 같은 사용자
// porcelain 설정에 흔들리지 않는다. 머지 커밋은 제외한다 — 머지된 쪽 커밋은 범위에 함께
// 들어오거나(따로 판정) 이전에 판정됐고, 기본 머지 메시지에는 id가 없다.
function rangeCommits(root, revisions, paths = null) {
  const input = [...revisions, ...(paths ? ['--', ...paths] : [])].join('\n')
  const shas = git(
    root,
    [
      '--literal-pathspecs',
      'rev-list',
      '--topo-order',
      '--no-merges',
      `--max-count=${MAX_JUDGED_COMMITS + 1}`,
      '--stdin',
    ],
    { input: `${input}\n` },
  )
    .split('\n')
    .filter(Boolean)
  if (shas.length > MAX_JUDGED_COMMITS) return { shas: [], skipped: true }
  return { shas: shas.reverse(), skipped: false }
}

// 커밋별 변경 경로(diff-tree --stdin 한 번)와 메시지(cat-file --batch 한 번).
function commitDetails(root, shas) {
  if (shas.length === 0) return []
  const pathsBySha = new Map(shas.map((commitSha) => [commitSha, []]))
  const output = git(
    root,
    ['diff-tree', '--stdin', '--always', '--root', '-r', '-z', '--name-only', '--no-renames'],
    { input: `${shas.join('\n')}\n` },
  )
  let index = -1
  for (const token of output.split('\0')) {
    if (!token) continue
    if (index + 1 < shas.length && token === shas[index + 1]) {
      index += 1
      continue
    }
    if (index >= 0) pathsBySha.get(shas[index]).push(token)
  }
  const objects = readObjects(root, shas)
  return shas.map((commitSha) => {
    const object = objects.get(commitSha)
    const text = object?.type === 'commit' ? object.text : ''
    const separator = text.indexOf('\n\n')
    const message = separator < 0 ? '' : text.slice(separator + 2)
    return {
      sha: commitSha,
      paths: pathsBySha.get(commitSha),
      tags: [...new Set([...message.matchAll(COMMIT_TAG_RE)].map((match) => match[1]))],
      shaRefs: [...new Set(message.match(SHA_REF_RE) ?? [])],
    }
  })
}

// 판정 대상 커밋 = (턴 사이: 마지막 판정 HEAD..턴 시작 HEAD 중 pendingWork 경로를 바꾼 커밋)
//                + (이번 턴: 턴 시작 HEAD..현재 HEAD). 빈 저장소에서 시작한 턴은 현재 HEAD 전체.
function judgedCommits(root, before, current, config) {
  if (!before || !current.head) return { commits: [], skipped: false }
  let between = { shas: [], skipped: false }
  const pending = Array.isArray(before.pendingWork)
    ? before.pendingWork.filter((path) => typeof path === 'string' && path && !path.includes('\n'))
    : []
  if (before.judgedHead && before.head && before.judgedHead !== before.head && pending.length) {
    try {
      between = rangeCommits(root, [`^${before.judgedHead}`, before.head], pending)
    } catch {
      // 기준 커밋이 사라졌으면(gc 등) 턴 사이 범위는 판정하지 않는다.
    }
  }
  let turn = { shas: [], skipped: false }
  if (!before.head) turn = rangeCommits(root, [current.head])
  else if (before.head !== current.head) turn = rangeCommits(root, [`^${before.head}`, current.head])

  const pendingSet = new Set(pending)
  const betweenShas = new Set(between.shas)
  const commits = commitDetails(root, [...between.shas, ...turn.shas]).map((commit, index) => ({
    ...commit,
    rank: index + 1,
    inTurn: !betweenShas.has(commit.sha),
    workPaths: commit.paths
      .filter((path) => isWorkPath(path, config))
      .filter((path) => !betweenShas.has(commit.sha) || pendingSet.has(path)),
  }))
  return { commits, skipped: between.skipped || turn.skipped }
}

function defaultBranch(root) {
  try {
    const value = readStaterc(root, 'STATE_DEFAULT_BRANCH') || 'main'
    return SAFE_BRANCH_RE.test(value) && !value.includes('..') ? value : null
  } catch {
    return null
  }
}

// 커밋 태그가 가리킬 수 있는 id = 다음 시점 인덱스 id의 합집합:
// 작업 트리(미커밋 등재 포함) · 기준점 HEAD(이번 턴에 archive된 id 포함) · 현재 HEAD ·
// 기본 브랜치(STATE_DEFAULT_BRANCH, worktree 분리 운영) · 범위 안에서 인덱스를 바꾼 커밋 ·
// 태그가 달린 커밋 자신의 트리(커밋 당시 유효했던 id).
function stateIdContext(root, before, current, commits, config) {
  const validIds = new Set([NO_STATE_TAG])
  const workingSections = new Map()
  for (const index of config.indexes) {
    let text
    try {
      text = readFileSync(join(root, index), 'utf8')
    } catch {
      continue
    }
    for (const [id, section] of indexSections(text)) {
      validIds.add(id)
      if (!workingSections.has(id)) workingSections.set(id, { index, section })
    }
  }
  const revs = new Set([before?.head, current.head].filter(Boolean))
  const branch = defaultBranch(root)
  if (branch) revs.add(`refs/heads/${branch}`)
  for (const commit of commits) {
    if (commit.tags.some((tag) => tag !== NO_STATE_TAG)) revs.add(commit.sha)
    if (commit.paths.some((path) => config.areaByIndex.has(path))) revs.add(commit.sha)
  }
  const specs = [...revs].flatMap((rev) => config.indexes.map((index) => `${rev}:${index}`))
  for (const object of readObjects(root, specs).values()) {
    if (object?.type !== 'blob') continue
    for (const id of indexSections(object.text).keys()) validIds.add(id)
  }
  return { validIds, workingSections }
}

// HEAD와 로컬 브랜치 어디에서도 닿지 않는 커밋(amend·rebase·reset으로 버려진 커밋).
function unreachableCommits(root, shas, currentHead) {
  const unreachable = new Set()
  if (shas.length === 0) return unreachable
  try {
    const existing = []
    const checked = git(root, ['cat-file', '--batch-check'], { input: `${shas.join('\n')}\n` })
      .split('\n')
      .filter(Boolean)
    shas.forEach((commitSha, index) => {
      if (/ commit \d+$/.test(checked[index] ?? '')) existing.push(commitSha)
      else unreachable.add(commitSha)
    })
    if (existing.length === 0) return unreachable
    const orphaned = new Set(
      git(root, ['rev-list', ...existing, '--not', '--branches', ...(currentHead ? [currentHead] : [])])
        .split('\n')
        .filter(Boolean),
    )
    for (const commitSha of existing) if (orphaned.has(commitSha)) unreachable.add(commitSha)
  } catch {
    // 판정할 수 없으면 debt를 보수적으로 유지한다.
  }
  return unreachable
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

// 0.4.0 debt = 원 커밋 sha를 가진 committed 항목뿐. 0.3.x의 working·legacy·sha 없는 committed
// debt는 'STATE 차분이 없다'는 다른 규칙의 결과라서 평가 때 버린다.
function carriedDebt(items) {
  if (!Array.isArray(items)) return []
  return items.filter(
    (item) =>
      item?.channel === 'committed' &&
      typeof item.path === 'string' &&
      typeof item.area === 'string' &&
      typeof item.sha === 'string' &&
      /^[0-9a-f]{7,64}$/.test(item.sha),
  )
}

// '## 현재'가 세션 기준(관측 최소 크기)보다 1KB 넘게 늘어난, 이번 턴에 바뀐 detail.
// 기준이 없는 detail(이번 턴에 처음 생긴 파일)은 생성이므로 제외한다 — 크기는 cap이 본다.
function appendedCurrentSections(before, current, stateChanged) {
  const reference = before?.currentRef
  if (!reference || typeof reference !== 'object') return []
  return stateChanged
    .filter((path) => DETAIL_PATH_RE.test(path))
    .flatMap((path) => {
      const baseline = reference[path]
      const after = current.currentBytes[path]
      if (typeof baseline !== 'number' || typeof after !== 'number') return []
      return after - baseline > CURRENT_APPEND_LIMIT_BYTES ? [{ path, before: baseline, after }] : []
    })
}

// 판정 규칙(0.4.0~):
// - 작업 기록은 커밋 메시지가 맡는다. 작업 파일을 바꾼 커밋 메시지에 유효 [id=<id>]
//   ([id=-] = STATE 항목과 무관)가 있으면 그 경로는 debt가 아니다.
// - 커밋은 오래된 순서로 본다. 한 경로의 마지막 커밋이 태그 없음(또는 인덱스에 없는 id)이면 debt다.
//   턴 안이든 턴을 넘든 같은 규칙이다.
// - debt 해제: 같은 경로를 바꾼 이후의 유효 태그 커밋, 원 커밋 sha(7자 이상)와 유효 태그를 함께
//   적은 이후 커밋(빈 커밋 가능), amend·rebase·reset으로 원 커밋이 HEAD·로컬 브랜치에서 사라짐,
//   원 커밋의 id가 나중에 인덱스에 등재됨. STATE 수정은 debt를 해제하지 않는다.
// - 미커밋 작업은 debt가 아니다. Stop 때 미커밋이던 작업이 턴 사이에 커밋되면 다음 Stop에서 판정한다.
// - 같은 worktree의 다른 활성 세션이 보이면 새 귀속 판정을 보류하고 기존 debt를 그대로 둔다.
function evaluate(root, id, payload, config) {
  const beforeResult = readSnapshot(root, id)
  const before = beforeResult.value
  const current = snapshot(root, id, payload, config)
  const workingChanged = new Set(
    before ? changedWorkingTreePaths(before.files, current.files) : Object.keys(current.files),
  )
  const { commits, skipped } = judgedCommits(root, before, current, config)
  const turnCommitted = new Set(commits.filter((commit) => commit.inTurn).flatMap((commit) => commit.paths))
  const allChanged = [
    ...new Set([
      ...workingChanged,
      ...[...turnCommitted].filter((path) => isState(path, config) || isWorkFile(path, config)),
    ]),
  ].sort()
  const codeChanged = allChanged.filter((path) => isWorkPath(path, config))
  const stateChanged = allChanged.filter((path) => isState(path, config))

  // 정보용: 이번 턴에 의미 있게 바뀌고 구조 검사를 통과한 STATE 영역. debt 판정에는 쓰지 않는다.
  const semanticStateAreas = new Set(
    stateChanged
      .filter((path) => before?.stateSemantics?.[path] !== current.stateSemantics[path])
      .map((path) => stateArea(path, config))
      .filter(Boolean),
  )
  const validStateAreas = [...semanticStateAreas].filter((area) => stateAreaIsValid(root, area, config)).sort()
  const stateAreas = [...new Set(stateChanged.map((path) => stateArea(path, config)).filter(Boolean))].sort()

  const concurrentSessions = [...new Set([
    ...activeOtherSessions(root, current.sessionIdHash),
    ...(Array.isArray(before?.concurrentSessionsSeen) ? before.concurrentSessionsSeen : []),
  ])].sort()

  const priorDebt = carriedDebt(before?.debt)
  const needsIds =
    commits.some((commit) => commit.tags.some((tag) => tag !== NO_STATE_TAG)) ||
    priorDebt.some((item) => Array.isArray(item.ids) && item.ids.length)
  const { validIds, workingSections } = needsIds
    ? stateIdContext(root, before, current, commits, config)
    : { validIds: new Set([NO_STATE_TAG]), workingSections: new Map() }

  let debt = priorDebt
  let unclaimed = []
  let area = null
  if (concurrentSessions.length === 0) {
    const untagged = new Map()
    const releasedPaths = new Set()
    const releasedRefs = new Set()
    const unclaimedIds = new Map()
    for (const commit of commits) {
      const validTags = commit.tags.filter((tag) => validIds.has(tag))
      if (validTags.length === 0) {
        const reason = commit.tags.length ? 'unknown-id' : 'untagged'
        const ids = commit.tags.filter((tag) => tag !== NO_STATE_TAG)
        for (const path of commit.workPaths) untagged.set(path, { sha: commit.sha, reason, ids })
        continue
      }
      for (const path of commit.workPaths) {
        untagged.delete(path)
        releasedPaths.add(path)
      }
      for (const ref of commit.shaRefs) {
        if (ref === commit.sha.slice(0, ref.length)) continue
        releasedRefs.add(ref)
        for (const [path, entry] of untagged) if (entry.sha.startsWith(ref)) untagged.delete(path)
      }
      if (commit.workPaths.length === 0) continue
      for (const tag of validTags) {
        const where = workingSections.get(tag)
        if (tag !== NO_STATE_TAG && where && where.section !== 1) unclaimedIds.set(tag, where)
      }
    }

    const candidates = priorDebt.filter(
      (item) =>
        !releasedPaths.has(item.path) &&
        ![...releasedRefs].some((ref) => item.sha.startsWith(ref)) &&
        !(Array.isArray(item.ids) && item.ids.some((tagId) => validIds.has(tagId))),
    )
    const unreachable = unreachableCommits(root, [...new Set(candidates.map((item) => item.sha))], current.head)
    const kept = new Map(candidates.filter((item) => !unreachable.has(item.sha)).map((item) => [item.path, item]))

    const newPaths = [...untagged.keys()].sort()
    area = newPaths.length ? requiredArea(newPaths, config) : null
    for (const path of newPaths) {
      const entry = untagged.get(path)
      kept.set(path, { path, area, channel: 'committed', sha: entry.sha, reason: entry.reason, ids: entry.ids })
    }
    debt = [...kept.values()]
    unclaimed = [...unclaimedIds]
      .map(([tagId, where]) => ({ id: tagId, index: where.index, section: where.section }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
  debt = [...debt].sort((a, b) => a.path.localeCompare(b.path))
  const priorKeys = new Set(priorDebt.map((item) => `${item.path}\0${item.sha}`))
  const freshDebt = debt.filter((item) => !priorKeys.has(`${item.path}\0${item.sha}`))
  const appended = appendedCurrentSections(before, current, stateChanged)

  writeSnapshot(root, id, persisted(current, {
    active: false,
    debt,
    judgedHead: current.head,
    pendingWork: Object.keys(current.files)
      .filter((path) => isWorkPath(path, config))
      .slice(0, MAX_PENDING_WORK_PATHS),
    currentRef: mergeCurrentReference(before?.currentRef, current.currentBytes),
  }))

  return {
    baselineFound: before !== null,
    baselineError: beforeResult.error,
    headChanged: before !== null && before.head !== current.head,
    allChanged,
    codeChanged,
    stateChanged,
    stateAreas,
    validStateAreas,
    // 0.3.x에서 'STATE 차분으로 debt를 풀지 못한 이유'를 담던 필드. STATE 수정은 더 이상 debt를
    // 해제하지 않으므로 항상 빈 배열이며, Stop 스키마 하위 호환을 위해서만 남긴다.
    invalidStateAreas: [],
    metadataOnlyStateAreas: [],
    stateBeforeWorkAreas: [],
    stateChannelMismatchAreas: [],
    appendedCurrentSections: appended,
    unclaimedTaggedIds: unclaimed,
    commitRangeSkipped: skipped,
    concurrentSessions,
    requiredArea: area,
    debt,
    freshDebt,
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
