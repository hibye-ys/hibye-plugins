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
import { basename, join, resolve } from 'node:path'
import { projectRoot, readStaterc, stateConfig } from './state-config.mjs'

const SNAPSHOT_VERSION = 6
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVE_SESSION_MS = 30 * 60 * 1000
const GIT_MAX_BUFFER = 256 * 1024 * 1024
// 이번 턴 커밋이 이보다 많으면 Stop timeout을 넘지 않도록 태그 판정을 건너뛰고 알린다.
const MAX_TURN_COMMITS = 1000
// detail 본문이 턴 시작보다 이만큼 넘게 늘면 작업 경과 덧붙이기로 본다.
const APPEND_LIMIT_BYTES = 1024
const SUBJECT_MAX_CHARS = 72
const INDEX_ID_RE = /^- \[([a-z0-9-]{3,12})\]/
// '[id=-]' = STATE 항목과 무관한 잡무라는 명시 표식. 항상 유효하다.
const NO_STATE_TAG = '-'
const COMMIT_TAG_RE = /\[id=([a-z0-9-]{3,12}|-)\]/g
const SAFE_BRANCH_RE = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/

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
// 입력은 sha와 검증된 ref·인덱스 경로뿐이라 줄바꿈이 없다.
function readObjects(root, requested) {
  const objects = new Map()
  const specs = [...new Set(requested)]
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

function isWorkFile(path, config) {
  if (path === '.staterc') return true
  return !isState(path, config) &&
    config.workIncludeRe.test(path) &&
    !config.workExcludeRe.test(path)
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

function fileDigest(absolute) {
  try {
    const info = lstatSync(absolute)
    if (info.isSymbolicLink()) return sha(`link:${readlinkSync(absolute)}`)
    return info.isFile() ? sha(readFileSync(absolute)) : null
  } catch {
    return null
  }
}

// dirty STATE 파일의 status·content hash. 커밋하지 않은 STATE 변경도 이번 턴 변경으로 본다.
function dirtyStateFiles(root, config) {
  const output = git(root, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'])
  const files = {}
  for (const entry of output.split('\0')) {
    if (!entry) continue
    const path = entry.slice(3)
    if (isState(path, config)) files[path] = { status: entry.slice(0, 2), digest: fileDigest(join(root, path)) }
  }
  return files
}

function head(root) {
  try {
    return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim() || null
  } catch {
    return null
  }
}

function snapshot(root, id, config) {
  return {
    version: SNAPSHOT_VERSION,
    root,
    sessionIdHash: sha(id).slice(0, 16),
    capturedAt: new Date().toISOString(),
    active: true,
    concurrentSessionsSeen: [],
    head: head(root),
    files: dirtyStateFiles(root, config),
    bodyBytes: detailBodyBytes(root, config),
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

// 이전 버전 스냅샷의 이월 필드(debt·judgedHead·pendingWork·bodyRef 등)는 읽지 않는다.
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

// 턴 시작 기준점. 이전 턴의 판정 결과는 넘기지 않는다 — Stop은 이번 턴 것만 알린다.
function saveSnapshot(root, id, config) {
  const concurrentSessions = activeOtherSessions(root, sha(id).slice(0, 16))
  writeSnapshot(root, id, { ...snapshot(root, id, config), concurrentSessionsSeen: concurrentSessions })
  return { concurrentSessions }
}

function changedWorkingTreePaths(before, after) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...paths].filter(
    (path) => before[path]?.status !== after[path]?.status || before[path]?.digest !== after[path]?.digest,
  )
}

// 이번 턴 커밋 = 턴 시작 HEAD에서 닿지 않고 현재 HEAD에서 닿는, 턴 시작 이후에 만들고(committer 시각)
// 작성한(author 시각) 커밋(오래된 순서). committer 시각이 이르면 pull·merge·checkout으로 들어온 커밋이고,
// author 시각만 이르면 이전 턴 커밋을 rebase·cherry-pick·amend로 다시 쓴 커밋이라 다시 알리지 않는다.
// plumbing(rev-list·diff-tree·cat-file)만 써서 log.showSignature 같은 사용자 설정에 흔들리지 않는다.
function turnCommits(root, before, current) {
  if (!before || !current.head || before.head === current.head) return { commits: [], skipped: false }
  const args = ['rev-list', '--topo-order', `--max-count=${MAX_TURN_COMMITS + 1}`]
  const since = Math.floor(Date.parse(before.capturedAt) / 1000)
  if (Number.isFinite(since)) args.push(`--max-age=${since}`)
  let shas
  try {
    const input = `${before.head ? `^${before.head}\n` : ''}${current.head}\n`
    shas = git(root, [...args, '--stdin'], { input }).split('\n').filter(Boolean)
  } catch {
    // 턴 시작 커밋이 사라졌으면(gc 등) 판정하지 않는다.
    return { commits: [], skipped: false }
  }
  if (shas.length > MAX_TURN_COMMITS) return { commits: [], skipped: true }
  const commits = commitDetails(root, shas.reverse()).filter((commit) => !(commit.authoredAt < since))
  return { commits, skipped: false }
}

// 커밋별 변경 경로(diff-tree --stdin 한 번)와 제목·[id=] 태그·author 시각·머지 여부(cat-file --batch 한 번).
// --cc는 머지 커밋에서 모든 부모와 다른 경로(충돌 해결)만 낸다 — 머지된 쪽 변경은 들어오지 않는다.
function commitDetails(root, shas) {
  if (shas.length === 0) return []
  const pathsBySha = new Map(shas.map((commitSha) => [commitSha, []]))
  const output = git(
    root,
    ['diff-tree', '--stdin', '--always', '--root', '--cc', '-r', '-z', '--name-only', '--no-renames'],
    { input: `${shas.join('\n')}\n` },
  )
  let index = -1
  for (const token of output.split('\0')) {
    if (!token) continue
    if (token === shas[index + 1]) index += 1
    else if (index >= 0) pathsBySha.get(shas[index]).push(token)
  }
  const objects = readObjects(root, shas)
  return shas.map((commitSha) => {
    const object = objects.get(commitSha)
    const text = object?.type === 'commit' ? object.text : ''
    const separator = text.indexOf('\n\n')
    const header = separator < 0 ? text : text.slice(0, separator)
    const message = separator < 0 ? '' : text.slice(separator + 2)
    const subject = message.split('\n')[0].trim()
    return {
      sha: commitSha,
      subject: subject.length > SUBJECT_MAX_CHARS ? `${subject.slice(0, SUBJECT_MAX_CHARS - 1)}…` : subject,
      paths: pathsBySha.get(commitSha),
      tags: [...new Set([...message.matchAll(COMMIT_TAG_RE)].map((match) => match[1]))],
      authoredAt: Number(header.match(/^author .* (\d+) [+-]\d{4}$/m)?.[1] ?? NaN),
      merge: (header.match(/^parent /gm) ?? []).length > 1,
    }
  })
}

function defaultBranchRef(root) {
  try {
    const branch = readStaterc(root, 'STATE_DEFAULT_BRANCH') || 'main'
    return SAFE_BRANCH_RE.test(branch) && !branch.includes('..') ? `refs/heads/${branch}` : null
  } catch {
    return null
  }
}

// 커밋 태그가 가리킬 수 있는 id = 작업 트리(미커밋 등재 포함)와 revs — 턴 시작 HEAD(이번 턴에 archive한 id)·
// 현재 HEAD·기본 브랜치(STATE_DEFAULT_BRANCH, worktree 분리 운영)·태그 커밋 자신(한 턴에 등재·archive한 id) —
// 의 STATE 인덱스 id.
function stateIds(root, revs, config) {
  const texts = []
  for (const index of config.indexes) {
    try {
      texts.push(readFileSync(join(root, index), 'utf8'))
    } catch {
      // 없는 인덱스는 checker가 알린다.
    }
  }
  const specs = revs.filter(Boolean).flatMap((rev) => config.indexes.map((index) => `${rev}:${index}`))
  for (const object of readObjects(root, specs).values()) {
    if (object?.type === 'blob') texts.push(object.text)
  }
  const ids = new Set()
  for (const text of texts) {
    for (const line of text.split('\n')) {
      const id = line.match(INDEX_ID_RE)?.[1]
      if (id) ids.add(id)
    }
  }
  return ids
}

// 이번 턴에 바뀐 detail 중 본문이 턴 시작보다 1KB 넘게 늘어난 것. 턴 시작에 없던 detail
// (이번 턴에 만든 파일)은 생성이므로 제외한다 — 크기는 cap이 본다.
function appendedDetails(beforeSizes, sizes, stateChanged) {
  return stateChanged.flatMap((path) => {
    const before = beforeSizes?.[path]
    const after = sizes[path]
    return typeof before === 'number' && typeof after === 'number' && after - before > APPEND_LIMIT_BYTES
      ? [{ path, before, after }]
      : []
  })
}

// 판정 규칙: 이번 턴 커밋 중 작업 파일을 바꾼 커밋의 메시지에 유효 [id=<id>](archive [id=<id>] 포함)나
// [id=-]가 없으면 알린다. 태그는 있는데 id가 인덱스에 없으면 따로 알린다. 미커밋 작업은 판정하지 않는다.
// 같은 worktree의 다른 활성 세션이 보이면 변경 귀속이 불명확하므로 태그·덧붙임 판정을 보류한다.
// 결과는 다음 턴으로 넘기지 않는다. Stop 시점을 새 기준점으로 저장해 같은 알림을 반복하지 않는다.
function evaluate(root, id, config) {
  const { value: before, error: baselineError } = readSnapshot(root, id)
  const current = snapshot(root, id, config)
  const { commits, skipped } = turnCommits(root, before, current)
  const workingChanged = before ? changedWorkingTreePaths(before.files, current.files) : Object.keys(current.files)
  const stateChanged = [...new Set([...workingChanged, ...commits.flatMap((commit) => commit.paths)])]
    .filter((path) => isState(path, config))
    .sort()

  const concurrentSessions = [...new Set([
    ...activeOtherSessions(root, current.sessionIdHash),
    ...(Array.isArray(before?.concurrentSessionsSeen) ? before.concurrentSessionsSeen : []),
  ])].sort()
  const held = concurrentSessions.length > 0

  // 머지 커밋의 기본 메시지에는 id가 없고, 머지된 쪽 커밋은 따로 판정된다.
  const workCommits = held
    ? []
    : commits.filter((commit) => !commit.merge && commit.paths.some((path) => isWorkFile(path, config)))
  const tagged = workCommits.filter((commit) => commit.tags.some((tag) => tag !== NO_STATE_TAG))
  const validIds = tagged.length > 0
    ? stateIds(root, [before?.head, current.head, defaultBranchRef(root), ...tagged.map((commit) => commit.sha)], config)
    : new Set()
  const untaggedCommits = []
  const unknownIdCommits = []
  for (const { sha: commitSha, subject, tags } of workCommits) {
    if (tags.includes(NO_STATE_TAG) || tags.some((tag) => validIds.has(tag))) continue
    if (tags.length > 0) unknownIdCommits.push({ sha: commitSha, subject, ids: tags })
    else untaggedCommits.push({ sha: commitSha, subject })
  }

  writeSnapshot(root, id, { ...current, active: false })

  return {
    baselineError,
    stateChanged,
    untaggedCommits,
    unknownIdCommits,
    appendedDetails: held ? [] : appendedDetails(before?.bodyBytes, current.bodyBytes, stateChanged),
    commitRangeSkipped: skipped && !held,
    concurrentSessions,
  }
}

function main() {
  const mode = process.argv[2]
  const payload = readPayload()
  const root = projectRoot()
  const config = stateConfig(root)
  const id = sessionId(payload)

  if (!id) throw new Error('hook payload session_id is required')

  let result
  if (mode === 'snapshot') {
    result = saveSnapshot(root, id, config)
  } else if (mode === 'sessions') {
    // SessionStart는 동시 세션을 읽기만 한다. 프롬프트 없이 열린 세션을 활성으로 잡지 않는다.
    result = { concurrentSessions: activeOtherSessions(root, sha(id).slice(0, 16)) }
  } else if (mode === 'evaluate') {
    result = evaluate(root, id, config)
  } else {
    process.stderr.write('usage: state-turn-baseline.mjs snapshot|sessions|evaluate\n')
    process.exitCode = 2
    return
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

main()
