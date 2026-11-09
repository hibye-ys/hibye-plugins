#!/usr/bin/env node
// STATE 인덱스 원천 선택.
//   manual (기본)      — STATE.md 등의 `- [id] …` 줄을 손으로 쓴다 (0.7.x 동작 그대로).
//   frontmatter        — 항목 정본은 docs/state/<area>/<id>.md frontmatter(section·title·status)다.
//                        STATE.md 는 git 에 올리지 않는 생성물이고 PR 은 자기 detail 파일만 바꾼다.
//                        → 병렬 PR 이 같은 인덱스 줄을 건드려 충돌하는 일이 구조적으로 없다.
// 프로젝트 설정: `.staterc` STATE_INDEX_SOURCE="frontmatter".

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot, readStaterc, stateConfig } from './state-config.mjs'

export const SECTIONS = Object.freeze([
  Object.freeze({ key: 'active', n: 1, heading: '1. 활성 (지금 작업 중)', label: '활성', cap: 6 }),
  Object.freeze({ key: 'next', n: 2, heading: '2. 다음 (활성 끝나면 시작)', label: '다음', cap: 6 }),
  Object.freeze({ key: 'future', n: 3, heading: '3. 미래 placeholder (조건부 트리거 대기)', label: '미래', cap: 5 }),
  Object.freeze({ key: 'unresolved', n: 4, heading: '4. 미해결 결정 (의사결정 필요)', label: '미해결', cap: 8 }),
])
export const CLEANUP_DIR = 'docs/state/.cleanup'
export const LINE_CHAR_CAP = 200
export const FILE_BYTE_CAP = 4096
const SOURCES = new Set(['manual', 'frontmatter'])
const ID_RE = /^[a-z0-9-]{3,12}$/
const SOURCE_LINE_RE = /^STATE_INDEX_SOURCE="([^"]*)"\s*$/m

function git(root, args) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key]
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: 15000 })
}

// revision: null = 작업 트리, ':' = git index, 그 밖 = 커밋.
export function gitText(root, file, revision) {
  try { return git(root, ['show', revision === ':' ? `:${file}` : `${revision}:${file}`]) }
  catch (error) { if (error.status === 128 || error.status === 1) return null; throw error }
}

function parseSource(value) {
  const source = value || 'manual'
  if (!SOURCES.has(source)) throw new Error(`STATE_INDEX_SOURCE must be manual or frontmatter: ${source}`)
  return source
}

// 리비전마다 그 시점의 .staterc 로 판정한다 — 이전 전 커밋(manual)의 증거를 이전 뒤에도 그대로 읽기 위해.
export function indexSource(root, revision = null) {
  if (revision === null) return parseSource(readStaterc(realpathSync(root), 'STATE_INDEX_SOURCE'))
  const text = gitText(root, '.staterc', revision)
  return parseSource(text?.match(SOURCE_LINE_RE)?.[1] ?? null)
}

export function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text ?? '')
  if (!match) return null
  return Object.fromEntries(match[1].split('\n').map((line) => /^([a-z_]+): (.*)$/.exec(line)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
}

export function sectionOf(key) {
  return SECTIONS.find((section) => section.key === key) ?? null
}

// manual 인덱스 줄 존재 판정 (0.7.x hasEntry 와 같은 규칙).
export function hasIndexLine(text, id) {
  return (text ?? '').split('\n').some((line) => line.startsWith(`- [${id}] `))
}

function detailPaths(root, area, revision) {
  const prefix = `docs/state/${area}/`
  if (revision === null) {
    let entries
    try { entries = readdirSync(join(root, prefix), { withFileTypes: true }) } catch { return [] }
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => `${prefix}${entry.name}`).sort()
  }
  let listed
  try {
    listed = revision === ':' ? git(root, ['ls-files', '--cached', '-z', '--', prefix]) : git(root, ['ls-tree', '-r', '--name-only', '-z', revision, '--', prefix])
  } catch (error) { if (error.status === 128) return []; throw error }
  return listed.split('\0').filter((path) => path.startsWith(prefix) && path.endsWith('.md') && !path.slice(prefix.length).includes('/')).sort()
}

function readDetail(root, path, revision) {
  if (revision !== null) return gitText(root, path, revision)
  const absolute = join(root, path)
  const info = lstatSync(absolute)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return null
  return readFileSync(absolute, 'utf8')
}

// frontmatter 원천의 항목 목록. section 이 없거나 틀린 detail 도 돌려준다(검사가 알린다).
export function detailEntries(root, revision = null, config = null) {
  root = realpathSync(root)
  config ??= stateConfig(root)
  const entries = []
  for (const area of Object.keys(config.indexByArea)) {
    for (const path of detailPaths(root, area, revision)) {
      const id = path.slice(`docs/state/${area}/`.length, -3)
      const text = readDetail(root, path, revision)
      if (text === null) continue
      const meta = parseFrontmatter(text)
      entries.push({ area, id, path, index: config.indexByArea[area], meta, section: sectionOf(meta?.section)?.key ?? null })
    }
  }
  return entries
}

// 리비전의 원천 규칙대로 "id 가 STATE 항목으로 등재돼 있는가".
export function entryExists(root, area, id, revision = null, config = null) {
  root = realpathSync(root)
  config ??= stateConfig(root)
  if (indexSource(root, revision) === 'manual') {
    const index = config.indexByArea[area]
    const text = revision === null ? (existsSync(join(root, index)) ? readFileSync(join(root, index), 'utf8') : null) : gitText(root, index, revision)
    return hasIndexLine(text, id)
  }
  const path = `docs/state/${area}/${id}.md`
  const text = revision === null ? (existsSync(join(root, path)) ? readDetail(root, path, null) : null) : gitText(root, path, revision)
  return text !== null && sectionOf(parseFrontmatter(text)?.section) !== null
}

export function entryLine(entry) {
  const owner = entry.meta?.owner
  const status = entry.meta?.status ?? ''
  const tail = owner && owner !== '-' && owner !== '—' ? `owner=${owner}; ${status}` : status
  return `- [${entry.id}] ${entry.meta?.title ?? ''} — ${tail}`.trimEnd()
}

function byRecency(a, b) {
  const ta = a.meta?.touched ?? ''
  const tb = b.meta?.touched ?? ''
  return ta === tb ? a.id.localeCompare(b.id) : tb.localeCompare(ta)
}

export function renderIndex(area, entries, config) {
  const own = entries.filter((entry) => entry.area === area && entry.section)
  const others = config.indexes.filter((index) => index !== config.indexByArea[area])
  const lines = [
    '<!-- 자동 생성 (state-ledger, STATE_INDEX_SOURCE="frontmatter") — 직접 고치지 않는다. git 에 올리지 않는다. -->',
    `<!-- 항목 = docs/state/${area}/<id>.md frontmatter section·title·status. WIP cap: ${SECTIONS.map((s) => `${s.key}≤${s.cap}`).join(', ')} -->`,
    '',
    `# STATE — ${area}`,
    '',
    `> 항목 상세·meta = docs/state/${area}/<id>.md${others.length ? ` · 다른 영역: ${others.join(', ')}` : ''}`,
  ]
  for (const section of SECTIONS) {
    lines.push('', `## ${section.heading}`)
    const items = own.filter((entry) => entry.section === section.key).sort(byRecency)
    if (items.length) lines.push('', ...items.map(entryLine))
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

function isTracked(root, path) {
  try { git(root, ['ls-files', '--error-unmatch', '--', path]); return true }
  catch (error) { if (error.status === 1) return false; throw error }
}

// 생성 인덱스를 작업 트리에 쓴다. git 이 추적 중인 파일이나 symlink 는 덮어쓰지 않는다(검사가 알린다).
export function writeRenderedIndexes(root, config = null) {
  root = realpathSync(root)
  config ??= stateConfig(root)
  if (indexSource(root) !== 'frontmatter') return []
  const entries = detailEntries(root, null, config)
  const written = []
  for (const [area, index] of Object.entries(config.indexByArea)) {
    const path = join(root, index)
    if (isTracked(root, index)) continue
    if (existsSync(path)) {
      const info = lstatSync(path)
      if (!info.isFile() || info.isSymbolicLink()) continue
    }
    const text = renderIndex(area, entries, config)
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue
    if (!existsSync(join(path, '..'))) continue
    const temp = `${path}.render-${randomUUID()}.tmp`
    try {
      writeFileSync(temp, text, { flag: 'wx' })
      renameSync(temp, path)
      written.push(index)
    } finally {
      try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  return written
}

// frontmatter 원천의 구조·예산 경고. 문구는 manual 검사와 같은 분류어를 쓴다
// (라우팅 끊김 = 항목 등재 결함 → 프로젝트 adapter 가 blocking 으로 분류할 수 있다).
export function checkFrontmatterIndex(root, { area: targetArea = '' } = {}, config = null) {
  root = realpathSync(root)
  config ??= stateConfig(root)
  const warnings = []
  const entries = detailEntries(root, null, config)
  for (const [area, index] of Object.entries(config.indexByArea)) {
    if (targetArea && targetArea !== area) continue
    const own = entries.filter((entry) => entry.area === area)
    for (const section of SECTIONS) {
      const count = own.filter((entry) => entry.section === section.key).length
      if (count > section.cap) warnings.push(`${index} §${section.n} ${section.label} = ${count} (cap ${section.cap} 초과)`)
    }
    for (const entry of own) {
      if (!ID_RE.test(entry.id)) warnings.push(`${entry.path} [${entry.id}] id 토큰 계약 위반 (3–12자 [a-z0-9-]만)`)
      if (!entry.meta) {
        warnings.push(`${entry.path} section 없음 (라우팅 끊김) — frontmatter 가 없어 STATE 항목이 아니다`)
        continue
      }
      if (!entry.meta.section) warnings.push(`${entry.path} section 없음 (라우팅 끊김) — section: ${SECTIONS.map((s) => s.key).join('|')}`)
      else if (!entry.section) warnings.push(`${entry.path} section '${entry.meta.section}' 유효값 없음 (라우팅 끊김) — ${SECTIONS.map((s) => s.key).join('|')}`)
      for (const key of ['title', 'status']) {
        if (!entry.meta[key]) warnings.push(`${entry.path} ${key} 없음 (라우팅 끊김) — 인덱스 줄을 만들 수 없다`)
      }
      if (entry.section === 'active' && ['', '-', '—', undefined].includes(entry.meta.owner)) warnings.push(`${entry.path} — §1 활성인데 유효한 frontmatter owner 없음`)
      const line = entryLine(entry)
      const chars = [...line].length
      if (entry.section && chars > LINE_CHAR_CAP) warnings.push(`${index} "${[...line].slice(0, 36).join('')}…" ${chars}자 (줄 cap ${LINE_CHAR_CAP}자 초과) — title·status 는 짧게, 남은 일·결정·WHY는 detail 본문으로, 완료 경과는 커밋 메시지로`)
    }
    const bytes = Buffer.byteLength(renderIndex(area, entries, config), 'utf8')
    if (bytes > FILE_BYTE_CAP) warnings.push(`${index} ${bytes}B (파일 cap ${FILE_BYTE_CAP}B 초과) — 인덱스는 1줄 항목만, 남은 일·결정·WHY는 detail로, 완료 경과는 커밋 메시지로`)
    const staged = gitText(root, index, ':')
    if (staged !== null) {
      warnings.push(`${index} git 추적 중 — frontmatter 원천의 인덱스는 생성물이다 (.gitignore 에 넣고 git rm --cached)`)
      for (const line of staged.split('\n')) {
        const id = /^- \[([^\]]+)\]/.exec(line)?.[1]
        if (id) warnings.push(`${index} [${id}] 손으로 쓴 인덱스 줄 — frontmatter 원천에서는 무시된다, docs/state/${area}/${id}.md frontmatter 로 옮길 것 (라우팅 끊김)`)
      }
    }
  }
  return warnings
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  const root = projectRoot()
  const config = stateConfig(root)
  if (command === 'source') {
    process.stdout.write(`${indexSource(root)}\n`)
  } else if (command === 'render') {
    // render [--write]: --write 는 생성 인덱스를 파일로 쓰고, 없으면 영역별 렌더 결과를 출력한다.
    if (args.includes('--write')) { writeRenderedIndexes(root, config); return }
    const entries = detailEntries(root, null, config)
    for (const [area, index] of Object.entries(config.indexByArea)) process.stdout.write(`=== ${index} ===\n${renderIndex(area, entries, config)}\n`)
  } else if (command === 'print') {
    const index = args[0]
    const area = config.areaByIndex.get(index)
    if (!area) throw new Error(`unknown STATE index: ${index}`)
    process.stdout.write(renderIndex(area, detailEntries(root, null, config), config))
  } else if (command === 'ids') {
    // ids [--sections active,next]: "<area> <id>" 줄.
    const wanted = args[0] === '--sections' ? new Set((args[1] ?? '').split(',').filter(Boolean)) : null
    for (const entry of detailEntries(root, null, config)) {
      if (!entry.section || (wanted && !wanted.has(entry.section))) continue
      process.stdout.write(`${entry.area} ${entry.id}\n`)
    }
  } else if (command === 'check') {
    const areaIndex = args.indexOf('--area')
    for (const warning of checkFrontmatterIndex(root, { area: areaIndex >= 0 ? args[areaIndex + 1] : '' }, config)) process.stdout.write(`${warning}\n`)
  } else {
    process.stderr.write('usage: state-index.mjs source|render [--write]|print <index>|ids [--sections a,b]|check [--area X]\n')
    process.exitCode = 2
  }
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : null
if (invoked && invoked === realpathSync(fileURLToPath(import.meta.url))) {
  try { main() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
