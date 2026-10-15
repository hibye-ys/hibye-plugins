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
import { projectRoot, readStaterc, stateConfig } from './state-config.mjs'

const SNAPSHOT_VERSION = 6
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVE_SESSION_MS = 30 * 60 * 1000
const GIT_MAX_BUFFER = 256 * 1024 * 1024
// 한 번의 판정 범위가 이보다 크면 Stop timeout을 넘지 않도록 판정을 건너뛰고 알린다.
const MAX_JUDGED_COMMITS = 1000
const MAX_PENDING_WORK_PATHS = 2000
// detail 본문이 덧붙임 판정 기준(bodyRef)보다 이만큼 넘게 늘면 작업 경과 덧붙이기로 본다.
const APPEND_LIMIT_BYTES = 1024
const DETAIL_PATH_RE = /^docs\/state\/[^/]+\/[^/]+\.md$/
const INDEX_ID_RE = /^- \[([a-z0-9-]{3,12})\]/
// '[id=-]' = STATE 항목과 무관한 작업이라는 명시 표식. 항상 유효하다.
const NO_STATE_TAG = '-'
const COMMIT_TAG_RE = /\[id=([a-z0-9-]{3,12}|-)\]/g
const SHA_REF_RE = /\b[0-9a-f]{7,64}\b/g
const SAFE_BRANCH_RE = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/
const EMPTY_RANGE = { shas: [], skipped: false }

// git의 stderr는 출력으로 흘리지 않는다 — Stop 스크립트가 엔진 stdout을 JSON으로 읽으며,
// 실패 시 stderr는 예외 메시지에 담긴다.
function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['pipe', 'pipe', 'pipe'],
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
    stdio: ['pipe', 'pipe', 'pipe'],
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

function isState(path, config) {
  if (config.areaByIndex.has(path)) return true
  const detail = path.match(/^docs\/state\/([^/]+)\/[^/]+\.md$/)
  return Boolean(detail && config.indexByArea[detail[1]])
}

// detail별 본문(frontmatter 제외) UTF-8 바이트 수. 덧붙임 판정에 쓴다.
function detailBodyBytes(root, config) {
  const sizes = {}
  for (const area of Object.keys(config.indexByArea)) {
    let entries
    try {
      entries = readdirSync(join(root, 'docs', 'state', area), { withFileTypes: true })
    } catch {
      // 아직 detail 디렉터리가 없는 영역은 인덱스 존재성 검사에서 별도로 다룬다.
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const path = `docs/state/${area}/${entry.name}`
      try {
        const text = readFileSync(join(root, path), 'utf8')
        const body = text.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1] ?? text
        sizes[path] = Buffer.byteLength(body, 'utf8')
      } catch {
        // 동시에 삭제된 파일은 map에서 빠진다.
      }
    }
  }
  return sizes
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
    return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim() || null
  } catch {
    return null
  }
}

function snapshot(root, id, payload, config) {
  const now = new Date().toISOString()
  return {
    version: SNAPSHOT_VERSION,
    root,
    sessionIdHash: sha(id).slice(0, 16),
    turnId: typeof payload.turn_id === 'string' ? payload.turn_id : null,
    capturedAt: now,
    seenAt: now,
    active: true,
    concurrentSessionsSeen: [],
    head: head(root),
    files: dirtyFiles(root, config),
    bodyBytes: detailBodyBytes(root, config),
  }
}

// 덧붙임 판정 기준(bodyRef) = detail 본문 크기. 처음 본 크기로 시작하고, 이 세션의 턴에서 그 detail을
// 바꿨을 때만 움직인다: 줄면 내려가고, 1KB 넘게 늘어 알린 뒤에는 그 크기로 올라간다(같은 증가를 한 번만
// 알린다). pull·checkout·턴 사이 편집처럼 이 세션이 바꾸지 않은 크기 변화는 그 크기로 기준을 다시 잡는다.
function nextBodyReference(reference, sizes, previousSizes, changed = new Set(), reported = new Set()) {
  const next = {}
  for (const [path, bytes] of Object.entries(sizes)) {
    const ref = reference?.[path]
    if (typeof ref !== 'number' || reported.has(path)) next[path] = bytes
    else if (changed.has(path)) next[path] = Math.min(ref, bytes)
    else next[path] = previousSizes?.[path] === bytes ? ref : bytes
  }
  return next
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
    if (value?.version !== SNAPSHOT_VERSION || value?.root !== root || !value?.files) {
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

function lastSeen(value) {
  return Date.parse(value?.seenAt ?? value?.capturedAt)
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
          const seen = lastSeen(value)
          if (
            value?.version === SNAPSHOT_VERSION &&
            value?.root === root &&
            value?.active === true &&
            value?.sessionIdHash !== ownSessionIdHash &&
            Number.isFinite(seen) &&
            seen >= cutoff
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

// 0.4.0 debt = 원 커밋 sha를 가진 committed 항목뿐. 0.3.x의 working·legacy·sha 없는 committed
// debt는 'STATE 차분이 없다'는 다른 규칙의 결과라서 버린다.
function carriedDebt(items) {
  if (!Array.isArray(items)) return []
  return items
    .filter(
      (item) =>
        item?.channel === 'committed' &&
        typeof item.path === 'string' &&
        typeof item.sha === 'string' &&
        /^[0-9a-f]{7,64}$/.test(item.sha),
    )
    .map((item) => ({
      path: item.path,
      channel: 'committed',
      sha: item.sha,
      reason: item.reason === 'unknown-id' ? 'unknown-id' : 'untagged',
      ids: Array.isArray(item.ids) ? item.ids.filter((tagId) => typeof tagId === 'string') : [],
    }))
}

// 표시용: debt를 원 커밋 단위로 묶는다. 해제도 커밋 단위다.
function debtCommits(debt) {
  const bySha = new Map()
  for (const item of debt) {
    const entry = bySha.get(item.sha) ?? { sha: item.sha, reason: item.reason, ids: item.ids, paths: [] }
    entry.paths.push(item.path)
    bySha.set(item.sha, entry)
  }
  return [...bySha.values()].map((entry) => {
    const ids = entry.ids.map((tagId) => ` [id=${tagId}]`).join('')
    const more = entry.paths.length > 1 ? ` 외 ${entry.paths.length - 1}개` : ''
    return { ...entry, label: `${entry.sha.slice(0, 7)}${ids} (${entry.paths[0]}${more})` }
  })
}

// 턴 시작 기준점. debt·마지막 판정 시점(judgedHead·judgedAt)·Stop 때 미커밋이던 작업 경로(pendingWork)는
// 다음 Stop까지 넘긴다 — 턴 사이에 커밋된 그 작업도 다음 Stop에서 판정하기 위해서다.
// Stop 없이 끝난 턴(사용자 중단 등) 뒤 30분 안에 온 프롬프트는 같은 턴으로 이어 본다 — 중단된 턴의
// 커밋도 다음 Stop에서 턴 커밋으로 판정한다.
function saveSnapshot(root, id, payload, config, onlyIfAbsent = false) {
  const before = readSnapshot(root, id).value
  const concurrentSessions = activeOtherSessions(root, sha(id).slice(0, 16))
  const debt = carriedDebt(before?.debt)
  const result = { concurrentSessions, debtCommits: debtCommits(debt) }
  if (onlyIfAbsent && before) return result
  const now = new Date()
  if (
    !onlyIfAbsent &&
    before?.active === true &&
    before.prompted === true &&
    now.getTime() - lastSeen(before) < ACTIVE_SESSION_MS
  ) {
    writeSnapshot(root, id, {
      ...before,
      seenAt: now.toISOString(),
      concurrentSessionsSeen: [...new Set([...(before.concurrentSessionsSeen ?? []), ...concurrentSessions])].sort(),
    })
    return result
  }
  const current = snapshot(root, id, payload, config)
  writeSnapshot(root, id, {
    ...current,
    prompted: !onlyIfAbsent,
    concurrentSessionsSeen: concurrentSessions,
    debt,
    judgedHead: typeof before?.judgedHead === 'string' ? before.judgedHead : null,
    judgedAt: typeof before?.judgedAt === 'string' ? before.judgedAt : null,
    pendingWork: Array.isArray(before?.pendingWork) ? before.pendingWork : [],
    bodyRef: nextBodyReference(before?.bodyRef, current.bodyBytes, before?.bodyBytes),
    notifiedIds: Array.isArray(before?.notifiedIds) ? before.notifiedIds : [],
  })
  return result
}

function changedWorkingTreePaths(before, after) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...paths].filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
}

// 범위 안에서 since(ISO 시각) 이후에 만든 커밋을 오래된 순서로 돌려준다. 그보다 먼저 만든 커밋은
// pull·merge·checkout으로 들어온 커밋이므로 판정하지 않는다(--max-age = committer 시각).
// plumbing(rev-list)만 써서 log.showSignature 같은 사용자 porcelain 설정에 흔들리지 않는다.
// 머지 커밋은 제외한다 — 머지된 쪽 커밋은 범위에 함께 들어오거나 이전에 판정됐고, 기본 머지
// 메시지에는 id가 없다. 기준 커밋이 사라졌으면(gc 등) 빈 범위다.
function rangeCommits(root, revisions, since) {
  const args = ['rev-list', '--topo-order', '--no-merges', `--max-count=${MAX_JUDGED_COMMITS + 1}`]
  const sinceMs = Date.parse(since)
  if (Number.isFinite(sinceMs)) args.push(`--max-age=${Math.floor(sinceMs / 1000)}`)
  let output
  try {
    output = git(root, [...args, '--stdin'], { input: `${revisions.join('\n')}\n` })
  } catch {
    return EMPTY_RANGE
  }
  const shas = output.split('\n').filter(Boolean)
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

// 판정 대상 = 현재 HEAD에서 닿는 커밋 중
//   이번 턴: 턴 시작 HEAD에서 닿지 않고 턴 시작 이후 만든 커밋 — 모든 작업 경로가 debt 후보.
//   턴 사이: 마지막 Stop 이후 만든 그 밖의 커밋 — Stop 때 미커밋이던 경로만 debt 후보.
// 둘 다 debt 해제(sha를 적은 커밋, 같은 경로를 바꾼 이후 [id=] 커밋)에는 경로와 무관하게 쓴다.
function judgedCommits(root, before, current, config) {
  if (!before || !current.head) return { commits: [], skipped: false }
  const turn = before.head === current.head
    ? EMPTY_RANGE
    : rangeCommits(root, before.head ? [`^${before.head}`, current.head] : [current.head], before.capturedAt)
  // 턴 사이에 HEAD가 움직였으면 마지막 Stop 이후 만든 커밋을 함께 본다(빈 저장소에서 끝난 Stop 포함).
  const since = typeof before.judgedAt === 'string' && before.judgedHead !== before.head
    ? rangeCommits(root, before.judgedHead ? [`^${before.judgedHead}`, current.head] : [current.head], before.judgedAt)
    : EMPTY_RANGE
  const turnShas = new Set(turn.shas)
  const sinceShas = new Set(since.shas)
  const shas = [...since.shas, ...turn.shas.filter((commitSha) => !sinceShas.has(commitSha))]
  const pending = new Set(Array.isArray(before.pendingWork) ? before.pendingWork : [])
  const commits = commitDetails(root, shas).map((commit) => {
    const inTurn = turnShas.has(commit.sha)
    const workPaths = commit.paths.filter((path) => isWorkPath(path, config))
    return {
      ...commit,
      inTurn,
      workPaths,
      debtPaths: inTurn ? workPaths : workPaths.filter((path) => pending.has(path)),
    }
  })
  return { commits, skipped: turn.skipped || since.skipped }
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
// claimedIds = 기본 브랜치에서 §1에 있는 id (feature worktree의 STATE 사본이 낡았어도 claim으로 본다).
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
  const branchPrefix = branch ? `refs/heads/${branch}:` : null
  if (branch) revs.add(`refs/heads/${branch}`)
  for (const commit of commits) {
    if (commit.tags.some((tag) => tag !== NO_STATE_TAG)) revs.add(commit.sha)
    if (commit.paths.some((path) => config.areaByIndex.has(path))) revs.add(commit.sha)
  }
  const specs = [...revs].flatMap((rev) => config.indexes.map((index) => `${rev}:${index}`))
  const claimedIds = new Set()
  for (const [spec, object] of readObjects(root, specs)) {
    if (object?.type !== 'blob') continue
    const onDefault = branchPrefix !== null && spec.startsWith(branchPrefix)
    for (const [id, section] of indexSections(object.text)) {
      validIds.add(id)
      if (onDefault && section === 1) claimedIds.add(id)
    }
  }
  return { validIds, workingSections, claimedIds }
}

// HEAD와 로컬 브랜치 어디에서도 닿지 않는 커밋(amend·rebase·reset·브랜치 삭제로 버려진 커밋).
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

// 이번 턴에 바뀐 detail 중 본문이 덧붙임 기준(bodyRef)보다 1KB 넘게 늘어난 것. 기준이 없는 detail
// (이번 턴에 처음 생긴 파일)은 생성이므로 제외한다 — 크기는 cap이 본다.
function appendedDetails(reference, sizes, stateChanged) {
  if (!reference || typeof reference !== 'object') return []
  return stateChanged
    .filter((path) => DETAIL_PATH_RE.test(path))
    .flatMap((path) => {
      const baseline = reference[path]
      const after = sizes[path]
      if (typeof baseline !== 'number' || typeof after !== 'number') return []
      return after - baseline > APPEND_LIMIT_BYTES ? [{ path, before: baseline, after }] : []
    })
}

// 판정 규칙(0.4.0~):
// - 작업 기록은 커밋 메시지가 맡는다. 작업 파일을 바꾼 커밋 메시지에 유효 [id=<id>]
//   ([id=-] = STATE 항목과 무관)가 있으면 그 경로는 debt가 아니다.
// - 커밋은 오래된 순서로 본다. 한 경로의 마지막 커밋이 태그 없음(또는 인덱스에 없는 id)이면 debt다.
// - debt 해제: 원 커밋 sha(7자 이상)와 유효 태그를 함께 적은 이후 커밋(빈 커밋 가능), 같은 경로를 바꾼
//   이후의 실제 id 태그 커밋([id=-]는 앞선 작업의 기록이 아니므로 제외), amend·rebase·reset으로 원 커밋이
//   HEAD·로컬 브랜치에서 사라짐, 원 커밋의 id가 나중에 인덱스에 등재됨. STATE 수정은 debt를 해제하지 않는다.
// - 미커밋 작업은 debt가 아니다. Stop 때 미커밋이던 작업이 턴 사이에 커밋되면 다음 Stop에서 판정한다.
// - 같은 worktree의 다른 활성 세션이 보이면 새 debt·claim 알림을 보류하고 해제만 반영한다.
function evaluate(root, id, payload, config) {
  const beforeResult = readSnapshot(root, id)
  const before = beforeResult.value
  const current = snapshot(root, id, payload, config)
  const workingChanged = before ? changedWorkingTreePaths(before.files, current.files) : Object.keys(current.files)
  const { commits, skipped } = judgedCommits(root, before, current, config)
  const turnCommitted = commits.filter((commit) => commit.inTurn).flatMap((commit) => commit.paths)
  const changed = [...new Set([...workingChanged, ...turnCommitted])].sort()
  const codeChanged = changed.filter((path) => isWorkPath(path, config))
  const stateChanged = changed.filter((path) => isState(path, config))

  const concurrentSessions = [...new Set([
    ...activeOtherSessions(root, current.sessionIdHash),
    ...(Array.isArray(before?.concurrentSessionsSeen) ? before.concurrentSessionsSeen : []),
  ])].sort()
  const held = concurrentSessions.length > 0

  const priorDebt = carriedDebt(before?.debt)
  const needsIds =
    commits.some((commit) => commit.tags.some((tag) => tag !== NO_STATE_TAG)) ||
    priorDebt.some((item) => item.ids.length)
  const { validIds, workingSections, claimedIds } = needsIds
    ? stateIdContext(root, before, current, commits, config)
    : { validIds: new Set([NO_STATE_TAG]), workingSections: new Map(), claimedIds: new Set() }

  const untagged = new Map()
  const releasedPaths = new Set()
  const releasedRefs = new Set()
  const unclaimedIds = new Map()
  for (const commit of commits) {
    const validTags = commit.tags.filter((tag) => validIds.has(tag))
    if (validTags.length === 0) {
      if (held) continue
      const ids = commit.tags.filter((tag) => tag !== NO_STATE_TAG)
      const reason = ids.length ? 'unknown-id' : 'untagged'
      for (const path of commit.debtPaths) untagged.set(path, { sha: commit.sha, reason, ids })
      continue
    }
    for (const ref of commit.shaRefs) if (!commit.sha.startsWith(ref)) releasedRefs.add(ref)
    const itemTags = validTags.filter((tag) => tag !== NO_STATE_TAG)
    if (itemTags.length === 0) continue
    for (const path of commit.workPaths) {
      untagged.delete(path)
      releasedPaths.add(path)
    }
    if (held || commit.debtPaths.length === 0) continue
    for (const tag of itemTags) {
      const where = workingSections.get(tag)
      if (where && where.section !== 1 && !claimedIds.has(tag)) unclaimedIds.set(tag, where)
    }
  }

  const refReleased = (commitSha) => [...releasedRefs].some((ref) => commitSha.startsWith(ref))
  const candidates = priorDebt.filter(
    (item) =>
      !releasedPaths.has(item.path) &&
      !refReleased(item.sha) &&
      !item.ids.some((tagId) => validIds.has(tagId)),
  )
  const unreachable = unreachableCommits(root, [...new Set(candidates.map((item) => item.sha))], current.head)
  const kept = new Map(candidates.filter((item) => !unreachable.has(item.sha)).map((item) => [item.path, item]))
  for (const [path, entry] of untagged) {
    if (refReleased(entry.sha)) continue
    kept.set(path, { path, channel: 'committed', sha: entry.sha, reason: entry.reason, ids: entry.ids })
  }
  const debt = [...kept.values()].sort((a, b) => a.path.localeCompare(b.path))
  const priorKeys = new Set(priorDebt.map((item) => `${item.path}\0${item.sha}`))
  const freshDebt = debt.filter((item) => !priorKeys.has(`${item.path}\0${item.sha}`))

  // §1 밖 id 알림은 세션당 id별 한 번만 낸다.
  const notified = new Set(Array.isArray(before?.notifiedIds) ? before.notifiedIds : [])
  const unclaimed = [...unclaimedIds]
    .filter(([tagId]) => !notified.has(tagId))
    .map(([tagId, where]) => ({ id: tagId, index: where.index, section: where.section }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const appended = appendedDetails(before?.bodyRef, current.bodyBytes, stateChanged)

  writeSnapshot(root, id, {
    ...current,
    active: false,
    prompted: false,
    debt,
    judgedHead: current.head,
    judgedAt: current.capturedAt,
    pendingWork: Object.keys(current.files)
      .filter((path) => isWorkPath(path, config))
      .slice(0, MAX_PENDING_WORK_PATHS),
    bodyRef: nextBodyReference(
      before?.bodyRef,
      current.bodyBytes,
      before?.bodyBytes,
      new Set(stateChanged),
      new Set(appended.map((entry) => entry.path)),
    ),
    notifiedIds: [...new Set([...notified, ...unclaimed.map((entry) => entry.id)])].sort(),
  })

  return {
    baselineError: beforeResult.error,
    codeChanged,
    stateChanged,
    appendedDetails: appended,
    unclaimedTaggedIds: unclaimed,
    commitRangeSkipped: skipped,
    concurrentSessions,
    debt,
    freshDebt,
    debtCommits: debtCommits(debt),
  }
}

function main() {
  const mode = process.argv[2]
  const payload = readPayload()
  const root = projectRoot()
  const config = stateConfig(root)
  const id = sessionId(payload)

  if (!id) throw new Error('hook payload session_id is required')

  if (mode === 'snapshot' || mode === 'snapshot-if-absent') {
    const result = saveSnapshot(root, id, payload, config, mode === 'snapshot-if-absent')
    process.stdout.write(`${JSON.stringify(result)}\n`)
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
