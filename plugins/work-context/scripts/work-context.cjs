#!/usr/bin/env node
'use strict'
/*
 * work-context — inject the active plan folder (status/inject files) plus the
 * intent and memory indexes into Claude Code conversations.
 *
 * Plan folder: <plans.directory>/<slug>/{status.md,inject.md}. Opt-in config
 * `.work-context.json` at the checkout root. Git queries, path confinement,
 * intent parsing and memory index resolution below are local copies of the
 * project-context implementations (never require() across plugins).
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const WORK_CONTEXT_VERSION = '0.1.1'
const CONFIG_FILE = '.work-context.json'
const ACTIVE_POINTER_FILE = 'work-context-active'
const STATUS_FILE = 'status.md'
const INJECT_FILE = 'inject.md'
const MAX_FULL_CHARS = 9000
const SHORT_GOAL_CHARS = 200

// Fixed checklist, always these three lines verbatim.
const CHECKLIST = Object.freeze([
  '1. 목표 — 먼저 위의 목표를 다시 읽는다. 지금 하려는 일이 목표의 어느 부분인지 확인한다. 어느 부분에도 닿지 않으면 멈추고 사용자에게 말한다.',
  '2. 메모리·intent — 먼저 두 인덱스를 훑는다. 지금 하려는 일에 해당하는 항목이 있으면 그 본문을 읽고 나서 진행한다.',
  '3. 기록 — 사용자가 이번에 새로 준 지시나 결정이 있었는지 돌아본다. 있었으면 계획 폴더의 해당 파일에 적는다.',
])

const STATUS_FIELDS = Object.freeze(['작업 id', '맡은 쪽', '지금 단계', '다음 한 가지', '브랜치', '상태'])
const NOW_FIELDS = Object.freeze(['작업 id', '맡은 쪽', '지금 단계', '다음 한 가지'])
const STATUS_VALUES = Object.freeze(['진행', '멈춤', '끝남'])
const STATUS_DONE = '끝남'
const INJECT_SECTIONS = Object.freeze(['목표', '지시', '읽을 곳'])

// --- git (copied from project-context) -------------------------------------
const GIT_LOCATION_ENV = ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CEILING_DIRECTORIES']
function gitQuery(cwd, args, { git = execFileSync, env = process.env } = {}) {
  const clean = { ...env }
  for (const key of Object.keys(clean)) if (GIT_LOCATION_ENV.includes(key) || /^GIT_CONFIG_(KEY|VALUE)_/.test(key)) delete clean[key]
  return git('git', args, { cwd, env: clean, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function checkoutRoot(repoRoot = process.cwd(), options = {}) {
  return fs.realpathSync(gitQuery(fs.realpathSync(path.resolve(repoRoot)), ['rev-parse', '--show-toplevel'], options))
}
function currentBranch(root, options = {}) {
  try {
    return gitQuery(root, ['rev-parse', '--abbrev-ref', 'HEAD'], options)
  } catch {
    // Unborn HEAD (no commits yet): rev-parse fails, symbolic-ref still names the branch.
    return gitQuery(root, ['symbolic-ref', '--short', 'HEAD'], options)
  }
}
function absoluteGitDir(root, options = {}) {
  try {
    return fs.realpathSync(gitQuery(root, ['rev-parse', '--absolute-git-dir'], options))
  } catch {
    const dir = gitQuery(root, ['rev-parse', '--git-dir'], options)
    return fs.realpathSync(path.isAbsolute(dir) ? dir : path.resolve(root, dir))
  }
}

// --- paths (copied from project-context) ------------------------------------
function relative(value, field) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || value.split('/').some(x => x === '..' || x === '.' || x === '') || /^[A-Za-z]:/.test(value)) throw new Error(`${field} must be a repository-relative path without traversal`)
  return value
}
function confined(root, rel, field) {
  relative(rel, field)
  const target = path.resolve(root, rel)
  let probe = target
  while (!fs.existsSync(probe)) {
    // dangling links must not disappear into the nearest existing parent
    try { if (fs.lstatSync(probe).isSymbolicLink()) throw new Error(`${field} is a dangling symlink`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    probe = path.dirname(probe)
  }
  const real = fs.realpathSync(probe)
  const suffix = path.relative(fs.realpathSync(root), real)
  if (suffix === '..' || suffix.startsWith(`..${path.sep}`) || path.isAbsolute(suffix)) throw new Error(`${field} escapes repository`)
  return target
}
function keys(object, allowed, field) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error(`${field} must be an object`)
  for (const key of Object.keys(object)) if (!allowed.includes(key)) throw new Error(`${field}: unknown key ${key}`)
}

// --- config -----------------------------------------------------------------
function loadWorkContextConfig({ repoRoot = process.cwd(), ...options } = {}) {
  let root
  try {
    root = checkoutRoot(repoRoot, options)
  } catch (error) {
    if (fs.existsSync(path.join(path.resolve(repoRoot), CONFIG_FILE))) throw new Error(`WORK_CONTEXT_CONFIG_FAILED: Git checkout required; ${error.message}`)
    return { enabled: false, repoRoot: path.resolve(repoRoot), configPath: null, plans: false, memory: false, intent: false }
  }
  const configPath = path.join(root, CONFIG_FILE)
  try {
    fs.lstatSync(configPath)
  } catch (error) {
    if (error.code === 'ENOENT') return { enabled: false, repoRoot: root, configPath, plans: false, memory: false, intent: false }
    throw error
  }
  confined(root, CONFIG_FILE, 'config')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  keys(config, ['schema_version', 'plans', 'memory', 'intent'], 'config')
  if (config.schema_version !== 1) throw new Error('config.schema_version must equal 1')
  if (!config.plans || typeof config.plans !== 'object' || Array.isArray(config.plans)) throw new Error('config.plans must be an object with directory')
  keys(config.plans, ['directory'], 'plans')
  relative(config.plans.directory, 'plans.directory')
  for (const name of ['memory', 'intent']) {
    if (config[name] === undefined || config[name] === false) { config[name] = false; continue }
    if (name === 'memory') {
      keys(config.memory, ['directory', 'index'], 'memory')
      relative(config.memory.directory, 'memory.directory')
      relative(config.memory.index, 'memory.index')
    } else {
      keys(config.intent, ['directory'], 'intent')
      relative(config.intent.directory, 'intent.directory')
    }
  }
  return { enabled: true, repoRoot: root, configPath, plans: config.plans, memory: config.memory, intent: config.intent }
}

// --- plan files ---------------------------------------------------------------
function parseStatusHead(text, fileRel) {
  const lines = text.split('\n')
  const head = {}
  const headLines = []
  const errors = []
  if (!lines[0] || !lines[0].startsWith('# ')) errors.push(`${fileRel}: 첫 줄이 '# ...' 제목이 아니다`)
  if (lines.length < 2 || lines[1].trim() !== '') errors.push(`${fileRel}: 제목 바로 다음 줄이 빈 줄이 아니다`)
  STATUS_FIELDS.forEach((field, i) => {
    const line = lines[2 + i]
    if (line === undefined) { errors.push(`${fileRel}: '${field}:' 줄이 없다`); return }
    if (!line.startsWith(`${field}:`)) { errors.push(`${fileRel}: ${i + 3}번째 줄이 '${field}:'로 시작하지 않는다`); return }
    headLines.push(line)
    const value = line.slice(field.length + 1).trim()
    if (!value) { errors.push(`${fileRel}: '${field}:' 값이 비었다`); return }
    head[field] = value
  })
  if (head['상태'] && !STATUS_VALUES.includes(head['상태'])) errors.push(`${fileRel}: '상태:' 값이 '진행|멈춤|끝남'이 아니다`)
  return { head, headLines, errors }
}

function parseInject(text, fileRel) {
  const lines = text.split('\n')
  const sections = {}
  const missing = []
  const problems = []
  if (!(lines[0] || '').startsWith('# 주입')) problems.push(`${fileRel}: 첫 줄이 '# 주입 — <제목>'이 아니다`)
  const at = {}
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    for (const name of INJECT_SECTIONS) {
      if (trimmed === `## ${name}` && at[name] === undefined) at[name] = i
    }
  })
  for (const name of INJECT_SECTIONS) if (at[name] === undefined) missing.push(name)
  const ordered = INJECT_SECTIONS.filter((name) => at[name] !== undefined)
  for (let i = 1; i < ordered.length; i++) {
    if (at[ordered[i]] < at[ordered[i - 1]]) { problems.push(`${fileRel}: '## 목표/지시/읽을 곳' 순서가 바뀌었다`); break }
  }
  for (const name of INJECT_SECTIONS) {
    if (at[name] === undefined) continue
    let end = lines.length
    for (let i = at[name] + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) { end = i; break }
    }
    const body = lines.slice(at[name] + 1, end)
    while (body.length > 0 && body[0].trim() === '') body.shift()
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
    sections[name] = body.join('\n')
  }
  return { sections, missing, problems }
}

// --- intent (copied from project-context) --------------------------------------
const ENTRY_HEADING = /^## ([A-Z]+\d+) · (.+)$/
const FIELD_LINE = /^- (규칙|갱신):\s*(.*)$/
const DESCRIPTION_LINE = /^설명:\s*(.+)$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function parseIntentFile(text, file) {
  const entries = []
  const errors = []
  let current = null
  let description = null
  text.split('\n').forEach((line, index) => {
    const lineNo = index + 1
    const describe = entries.length === 0 ? DESCRIPTION_LINE.exec(line) : null
    if (describe) {
      description = describe[1].trim()
      return
    }
    const heading = ENTRY_HEADING.exec(line)
    if (heading) {
      current = { id: heading[1], title: heading[2], file, line: lineNo, rule: null, updated: null }
      entries.push(current)
      return
    }
    if (line.startsWith('## ')) {
      errors.push(`${file}:${lineNo} 항목 제목은 "## <ID> · <제목>" 형식이어야 한다`)
      current = null
      return
    }
    const field = current === null ? null : FIELD_LINE.exec(line)
    if (field?.[1] === '규칙') current.rule = field[2].trim()
    if (field?.[1] === '갱신') current.updated = field[2].trim()
  })
  for (const entry of entries) {
    const where = `${file}:${entry.line} ${entry.id}`
    if (!entry.rule) errors.push(`${where} 규칙 문장이 없다`)
    if (entry.updated === null || !DATE.test(entry.updated)) errors.push(`${where} 갱신일은 "- 갱신: YYYY-MM-DD" 여야 한다`)
  }
  if (entries.length > 0 && description === null) errors.push(`${file}:1 첫 항목 앞에 "설명: <무엇> — <언제 읽나>" 줄이 없다`)
  return { entries, errors, description }
}

function idLabel(ids) {
  if (ids.length === 0) return '항목 없음'
  if (ids.length === 1) return ids[0]
  const parts = ids.map((id) => /^([A-Z]+)(\d+)$/u.exec(id))
  const contiguous = parts.every((part, index) => part !== null && part[1] === parts[0][1] &&
    Number(part[2]) === Number(parts[0][2]) + index)
  return contiguous ? `${ids[0]}–${ids.at(-1)}` : ids.join(', ')
}

function loadIntentLedger({ repoRoot = process.cwd(), readFile = fs.readFileSync, listDir = fs.readdirSync, config } = {}) {
  const settings = config || loadWorkContextConfig({ repoRoot })
  if (!settings.enabled || !settings.intent) return { entries: [], errors: [], areas: [] }
  repoRoot = settings.repoRoot
  keys(settings.intent, ['directory'], 'intent')
  relative(settings.intent.directory, 'intent.directory')
  const intentDir = settings.intent.directory
  const dir = confined(repoRoot, intentDir, 'intent.directory')
  const files = listDir(dir).filter((name) => name.endsWith('.md') && name !== 'README.md').sort()
  const entries = []
  const errors = []
  const areas = []
  for (const name of files) {
    const rel = `${intentDir}/${name}`
    const parsed = parseIntentFile(readFile(confined(repoRoot, rel, 'intent file'), 'utf8'), rel)
    entries.push(...parsed.entries)
    errors.push(...parsed.errors)
    areas.push({ file: rel, description: parsed.description, ids: parsed.entries.map((entry) => entry.id) })
  }
  const byId = new Map()
  for (const entry of entries) {
    if (byId.has(entry.id)) errors.push(`${entry.file}:${entry.line} ID ${entry.id} 가 ${byId.get(entry.id).file} 와 겹친다`)
    else byId.set(entry.id, entry)
  }
  return { entries, errors, areas }
}

// --- memory -------------------------------------------------------------------
function loadMemoryIndex({ config }) {
  const root = config.repoRoot
  const indexRel = `${config.memory.directory}/${config.memory.index}`
  const indexAbs = confined(root, indexRel, 'memory.index')
  const text = fs.readFileSync(indexAbs, 'utf8')
  const listLines = []
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) listLines.push(`### ${line.slice(3)}`)
    else if (line.startsWith('- [')) listLines.push(line)
  }
  return { indexRel, indexAbs, listLines }
}

// --- active plan ----------------------------------------------------------------
const NO_PLAN = Object.freeze({ planRel: null, planAbs: null, statusRel: null, injectRel: null, via: 'none', others: Object.freeze([]) })

function scanPlanHeads(root, plansDirRel) {
  const plansDirAbs = confined(root, plansDirRel, 'plans.directory')
  let entries
  try {
    entries = fs.readdirSync(plansDirAbs, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []
    throw error
  }
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const rel = `${plansDirRel}/${entry.name}`
    const statusRel = `${rel}/${STATUS_FILE}`
    let statusAbs
    try {
      statusAbs = confined(root, statusRel, 'plan status')
    } catch { continue }
    let text
    try {
      if (!fs.statSync(statusAbs).isFile()) continue
      text = fs.readFileSync(statusAbs, 'utf8')
    } catch { continue }
    const parsed = parseStatusHead(text, statusRel)
    if (parsed.errors.length > 0) continue
    found.push({ rel, abs: path.dirname(statusAbs), head: parsed.head, mtimeMs: fs.statSync(statusAbs).mtimeMs })
  }
  return found
}

const RESUME_ATTACH_LINE = '사용자가 가리킨 폴더가 있으면 그 status.md 머리의 맡은 쪽·브랜치 줄을 자기 것으로 고친다(다음 턴부터 주입된다). 브랜치 줄을 고칠 수 없으면 `<git-dir>/work-context-active` 첫 줄에 폴더 경로를 적는다.'
const MAX_RESUME_CANDIDATES = 8

function resumeCandidateLines(root, plansDirRel) {
  let found
  try {
    found = scanPlanHeads(root, plansDirRel)
  } catch { return [] }
  const candidates = found.filter((c) => c.head['상태'] !== STATUS_DONE)
  candidates.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return candidates.slice(0, MAX_RESUME_CANDIDATES).map((c) => `- ${c.head['작업 id']} · ${c.rel} · ${c.head['맡은 쪽']} · ${c.head['브랜치']}`)
}

function resolveActivePlan({ repoRoot, config, branch, ...options } = {}) {
  const settings = config || loadWorkContextConfig({ repoRoot, ...options })
  if (!settings.enabled || !settings.plans) return { ...NO_PLAN, others: [] }
  const root = settings.repoRoot
  // 1. per-worktree pointer: <git-dir>/work-context-active, first line wins.
  let first = null
  const pointerPath = path.join(absoluteGitDir(root, options), ACTIVE_POINTER_FILE)
  try {
    if (fs.statSync(pointerPath).isFile()) first = fs.readFileSync(pointerPath, 'utf8').split('\n')[0].trim().replace(/\/+$/, '')
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
  }
  if (first) {
    const planAbs = confined(root, first, ACTIVE_POINTER_FILE)
    return { planRel: first, planAbs, statusRel: `${first}/${STATUS_FILE}`, injectRel: `${first}/${INJECT_FILE}`, via: 'pointer', others: [] }
  }
  // 2. scan <plans.directory>/*/status.md for this branch.
  const found = scanPlanHeads(root, settings.plans.directory)
  const resolvedBranch = branch ?? currentBranch(root, options)
  const candidates = found
    .filter((c) => c.head['브랜치'] === resolvedBranch && c.head['상태'] !== STATUS_DONE)
    .map(({ rel, abs, mtimeMs }) => ({ rel, abs, mtimeMs }))
  if (candidates.length === 0) return { ...NO_PLAN, others: [] }
  candidates.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const [best, ...rest] = candidates
  return { planRel: best.rel, planAbs: best.abs, statusRel: `${best.rel}/${STATUS_FILE}`, injectRel: `${best.rel}/${INJECT_FILE}`, via: candidates.length > 1 ? 'newest' : 'scan', others: rest.map((c) => c.rel) }
}

// --- context --------------------------------------------------------------------
function loadContext({ startDir = process.cwd(), env = process.env, ...options } = {}) {
  const settings = loadWorkContextConfig({ repoRoot: startDir, env, ...options })
  if (!settings.enabled) return { enabled: false, settings }
  const root = settings.repoRoot
  const branch = currentBranch(root, { env, ...options })
  const plan = resolveActivePlan({ config: settings, branch, env, ...options })
  const ctx = {
    enabled: true, settings, root, branch, plan,
    statusAbs: null, injectAbs: null,
    statusText: null, statusParsed: null, statusError: null,
    injectText: null, injectParsed: null, injectError: null,
    ledger: null, intentError: null, memory: null, memoryError: null,
  }
  if (plan.planRel) {
    ctx.statusAbs = confined(root, plan.statusRel, 'plan status')
    ctx.injectAbs = confined(root, plan.injectRel, 'plan inject')
    try {
      ctx.statusText = fs.readFileSync(ctx.statusAbs, 'utf8')
      ctx.statusParsed = parseStatusHead(ctx.statusText, plan.statusRel)
    } catch (error) { ctx.statusError = error.message }
    try {
      ctx.injectText = fs.readFileSync(ctx.injectAbs, 'utf8')
      ctx.injectParsed = parseInject(ctx.injectText, plan.injectRel)
    } catch (error) { ctx.injectError = error.message }
  }
  if (settings.intent) {
    try {
      ctx.ledger = loadIntentLedger({ repoRoot: root, config: settings })
    } catch (error) { ctx.intentError = error.message }
  }
  if (settings.memory) {
    try {
      ctx.memory = loadMemoryIndex({ config: settings })
    } catch (error) { ctx.memoryError = error.message }
  }
  return ctx
}

// --- rendering ------------------------------------------------------------------
function injectSectionLines(ctx, name) {
  const fileRel = ctx.plan.injectRel
  if (ctx.injectText === null) return [`${fileRel} 없음${ctx.injectError ? ` (${ctx.injectError})` : ''}`]
  if (name === '목표' && ctx.injectParsed.problems.length > 0 && ctx.injectParsed.missing.length === INJECT_SECTIONS.length) return [...ctx.injectParsed.problems]
  if (ctx.injectParsed.missing.includes(name)) return [`${fileRel}: '## ${name}' 절이 없다`]
  const body = ctx.injectParsed.sections[name] ?? ''
  if (body === '') return [`${fileRel}의 '## ${name}' 본문이 비었다`]
  if (name === '목표' && ctx.injectParsed.problems.length > 0) return [...ctx.injectParsed.problems, body]
  return [body]
}

function nowLines(ctx) {
  const fileRel = ctx.plan.statusRel
  if (ctx.statusText === null) return [`${fileRel} 없음${ctx.statusError ? ` (${ctx.statusError})` : ''}`]
  if (ctx.statusParsed.errors.length > 0) return [...ctx.statusParsed.errors]
  const verbatim = ctx.statusParsed.headLines.length === STATUS_FIELDS.length
    ? ctx.statusParsed.headLines.slice(0, NOW_FIELDS.length)
    : NOW_FIELDS.map((field) => `${field}: ${ctx.statusParsed.head[field]}`)
  return [...verbatim, `(source: ${fileRel})`]
}

function intentLines(ctx, shorten) {
  const dirRel = ctx.settings.intent.directory
  if (ctx.intentError) return [`intent 디렉토리를 읽을 수 없다: ${dirRel} (${ctx.intentError})`]
  if (shorten) return [`운영 결정 인덱스가 길어 줄였다 — ${dirRel} 를 직접 연다`]
  const lines = ctx.ledger.areas.map((area) => `- ${area.file} (${idLabel(area.ids)}): ${area.description ?? '설명 없음'}`)
  if (lines.length === 0) lines.push(`운영 결정 파일이 없다: ${dirRel}`)
  if (ctx.ledger.errors.length > 0) lines.push(`INTENT_LEDGER_INVALID ${ctx.ledger.errors.length}건: ${ctx.ledger.errors[0]}`)
  lines.push('본문은 해당 작업 전에 그 파일을 열어 읽는다.')
  return lines
}

function memoryLines(ctx, shorten) {
  if (ctx.memoryError) {
    const indexRel = `${ctx.settings.memory.directory}/${ctx.settings.memory.index}`
    return [`${indexRel} 읽기 실패: ${ctx.memoryError}`]
  }
  if (shorten) return [ctx.memory.indexRel, `메모리 인덱스가 길어 줄였다 — ${ctx.memory.indexRel} 를 직접 연다`]
  return [ctx.memory.indexRel, ...ctx.memory.listLines, '해당 줄의 상세 파일은 그 작업 전에 연다.']
}

function renderFullText(ctx, { shortenMemory = false, shortenIntent = false } = {}) {
  const blocks = []
  if (ctx.plan.planRel) {
    const head = [`WORK_CONTEXT full · 계획 폴더: ${ctx.plan.planRel} · checkout: ${ctx.root}`]
    if (ctx.plan.others.length > 0) head.push(`같은 브랜치의 다른 계획 폴더: ${ctx.plan.others.join(', ')}`)
    blocks.push(head.join('\n'))
    blocks.push(['## 목표', ...injectSectionLines(ctx, '목표')].join('\n'))
    blocks.push(['## 지금', ...nowLines(ctx)].join('\n'))
    blocks.push(['## 지시', ...injectSectionLines(ctx, '지시')].join('\n'))
    blocks.push(['## 체크리스트', ...CHECKLIST].join('\n'))
    blocks.push(['## 읽을 곳', ...injectSectionLines(ctx, '읽을 곳')].join('\n'))
  } else {
    blocks.push(`WORK_CONTEXT full · 계획 폴더: 없음 · checkout: ${ctx.root}`)
    const missing = [`이 브랜치(${ctx.branch})에 맡은 계획 폴더가 없다. 일을 시작하면 work-context 스킬대로 계획 폴더를 만든다.`]
    const resume = resumeCandidateLines(ctx.root, ctx.settings.plans.directory)
    if (resume.length > 0) missing.push(...resume, RESUME_ATTACH_LINE)
    blocks.push(missing.join('\n'))
    blocks.push(['## 체크리스트', ...CHECKLIST].join('\n'))
  }
  if (ctx.settings.intent) blocks.push(['## 운영 결정 인덱스', ...intentLines(ctx, shortenIntent)].join('\n'))
  if (ctx.settings.memory) blocks.push(['## 메모리 인덱스', ...memoryLines(ctx, shortenMemory)].join('\n'))
  return blocks.join('\n\n')
}

function buildFullText(ctx) {
  let text = renderFullText(ctx)
  if (text.length <= MAX_FULL_CHARS) return text
  text = renderFullText(ctx, { shortenMemory: true })
  if (text.length <= MAX_FULL_CHARS) return text
  text = renderFullText(ctx, { shortenMemory: true, shortenIntent: true })
  if (text.length <= MAX_FULL_CHARS) return text
  return Array.from(text).slice(0, MAX_FULL_CHARS).join('')
}

function renderShortText(ctx) {
  if (!ctx.plan.planRel) return [...CHECKLIST].join('\n')
  let goal = ''
  let changed = []
  if (ctx.injectText !== null && !ctx.injectParsed.missing.includes('목표')) {
    const stripped = (ctx.injectParsed.sections['목표'] || '').split('\n').map((line) => line.trim().replace(/^>\s*/, '').trim()).filter((line) => line !== '')
    goal = stripped[0] || ''
    changed = stripped.slice(1).filter((line) => line.startsWith('바뀜:'))
  }
  if (!goal) goal = `(${ctx.plan.injectRel}의 '## 목표' 없음)`
  const cut = (line) => Array.from(line).slice(0, SHORT_GOAL_CHARS).join('')
  return [`WORK_CONTEXT short · 목표: ${cut(goal)}`, ...changed.map(cut), ...CHECKLIST].join('\n')
}

// --- fingerprint + per-session records -------------------------------------------
function fingerprintOf(ctx) {
  const headPart = ctx.statusText !== null && ctx.statusParsed && ctx.statusParsed.errors.length === 0
    ? ctx.statusParsed.headLines.join('\n')
    : (ctx.statusText ?? '')
  return createHash('sha256').update(`${ctx.plan.planRel ?? ''}\n${ctx.injectText ?? ''}\n${headPart}`, 'utf8').digest('hex')
}

function recordDirectory(env = process.env) {
  if (env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, 'work-context')
  return path.join(os.homedir(), '.cache', 'work-context')
}

function recordPath(sessionId, root, env = process.env) {
  return path.join(recordDirectory(env), `${createHash('sha256').update(`${sessionId}${root}`, 'utf8').digest('hex')}.json`)
}

function readRecord(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data || typeof data.fingerprint !== 'string') return null
    return data
  } catch { return null }
}

function writeRecord(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(data))
  } catch { /* records never block injection */ }
}

function sessionIdOf(input) {
  return input && typeof input.session_id === 'string' && input.session_id ? input.session_id : null
}

function writeFullRecord(file, input, ctx) {
  writeRecord(file, { version: 1, session_id: input.session_id, root: ctx.root, fingerprint: fingerprintOf(ctx), plan_folder: ctx.plan.planRel, updated_at: new Date().toISOString() })
}

function sameFile(root, filePath, targetAbs) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath)
  try {
    return fs.realpathSync(abs) === fs.realpathSync(targetAbs)
  } catch {
    return path.normalize(abs) === path.normalize(targetAbs)
  }
}

// --- hook modes -------------------------------------------------------------------
function hookJson(eventName, text) {
  return `${JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } })}\n`
}

function failText(error, root = null) {
  return `WORK_CONTEXT_FAILED: ${error.message} — .work-context.json과 계획 폴더를 확인한다${root ? ` (${root})` : ''}`
}

// Never consult CLAUDE_PROJECT_DIR: the desktop app passes the primary checkout
// there even for worktree sessions, which would inject another branch's plan.
function startDirFromInput(input) {
  if (input && typeof input.cwd === 'string' && input.cwd) return input.cwd
  return process.cwd()
}

function runSessionStart({ input, env = process.env, writeStdout = (value) => process.stdout.write(value) } = {}) {
  let root = null
  try {
    const ctx = loadContext({ startDir: startDirFromInput(input), env })
    if (!ctx.enabled) return 0
    root = ctx.root
    const sessionId = sessionIdOf(input)
    if (sessionId) writeFullRecord(recordPath(sessionId, ctx.root, env), input, ctx)
    writeStdout(hookJson('SessionStart', buildFullText(ctx)))
  } catch (error) { writeStdout(hookJson('SessionStart', failText(error, root))) }
  return 0
}

function runTurn({ input, env = process.env, writeStdout = (value) => process.stdout.write(value) } = {}) {
  let root = null
  try {
    const ctx = loadContext({ startDir: startDirFromInput(input), env })
    if (!ctx.enabled) return 0
    root = ctx.root
    const sessionId = sessionIdOf(input)
    const record = sessionId ? readRecord(recordPath(sessionId, ctx.root, env)) : null
    if (!record || record.fingerprint !== fingerprintOf(ctx)) {
      if (sessionId) writeFullRecord(recordPath(sessionId, ctx.root, env), input, ctx)
      writeStdout(hookJson('UserPromptSubmit', buildFullText(ctx)))
    } else {
      writeStdout(hookJson('UserPromptSubmit', renderShortText(ctx)))
    }
  } catch (error) { writeStdout(hookJson('UserPromptSubmit', failText(error, root))) }
  return 0
}

// Codex edits via apply_patch: its tool_input carries no file_path, only the
// patch text. Collect every candidate path: the known file fields plus any
// apply_patch "*** (Add|Update|Delete) File:" / "*** Move to:" line found in
// any string nested inside tool_input (depth <= 4).
const APPLY_PATCH_FILE_LINE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/
const APPLY_PATCH_MOVE_LINE = /^\*\*\* Move to: (.+)$/
function collectEditCandidates(toolInput) {
  const candidates = []
  if (!toolInput || typeof toolInput !== 'object') return candidates
  for (const key of ['file_path', 'path', 'notebook_path']) {
    if (typeof toolInput[key] === 'string' && toolInput[key]) candidates.push(toolInput[key])
  }
  const scan = (value, depth) => {
    if (typeof value === 'string') {
      for (const raw of value.split('\n')) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        const found = APPLY_PATCH_FILE_LINE.exec(line) || APPLY_PATCH_MOVE_LINE.exec(line)
        if (found && found[1].trim()) candidates.push(found[1].trim())
      }
      return
    }
    if (value === null || typeof value !== 'object' || depth >= 4) return
    for (const child of Array.isArray(value) ? value : Object.values(value)) scan(child, depth + 1)
  }
  scan(toolInput, 0)
  return candidates
}

function runPostEdit({ input, env = process.env, writeStdout = (value) => process.stdout.write(value) } = {}) {
  let root = null
  try {
    const ctx = loadContext({ startDir: startDirFromInput(input), env })
    if (!ctx.enabled) return 0
    root = ctx.root
    const candidates = collectEditCandidates(input?.tool_input)
    if (candidates.length === 0 || !ctx.plan.planRel) return 0
    const touches = candidates.some((filePath) => [ctx.injectAbs, ctx.statusAbs].some((target) => target && sameFile(ctx.root, filePath, target)))
    if (!touches) return 0
    const sessionId = sessionIdOf(input)
    const record = sessionId ? readRecord(recordPath(sessionId, ctx.root, env)) : null
    if (record && record.fingerprint === fingerprintOf(ctx)) return 0
    if (sessionId) writeFullRecord(recordPath(sessionId, ctx.root, env), input, ctx)
    writeStdout(hookJson('PostToolUse', buildFullText(ctx)))
  } catch (error) { writeStdout(hookJson('PostToolUse', failText(error, root))) }
  return 0
}

function runRender({ mode = 'full', cwd = null, env = process.env, writeStdout = (value) => process.stdout.write(value), writeStderr = (value) => process.stderr.write(value) } = {}) {
  if (mode !== 'full' && mode !== 'short') { writeStderr('usage: work-context render --mode full|short --cwd <dir>\n'); return 0 }
  let root = null
  try {
    const ctx = loadContext({ startDir: cwd || process.cwd(), env })
    if (!ctx.enabled) return 0
    root = ctx.root
    writeStdout(`${mode === 'full' ? buildFullText(ctx) : renderShortText(ctx)}\n`)
  } catch (error) { writeStdout(`${failText(error, root)}\n`) }
  return 0
}

function readHookInput(input) {
  if (input !== undefined) return input
  let raw = ''
  try {
    raw = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8')
  } catch { raw = '' }
  return JSON.parse(raw || '{}')
}

function runCli({ argv = process.argv.slice(2), env = process.env, input, writeStdout, writeStderr } = {}) {
  const out = writeStdout || ((value) => process.stdout.write(value))
  const err = writeStderr || ((value) => process.stderr.write(value))
  const command = argv[0]
  const usage = 'usage: work-context <session-start|turn|post-edit|render> [--mode full|short] [--cwd <dir>]\n'
  try {
    if (command === 'render') {
      let mode = 'full'
      let cwd = null
      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--mode' && argv[i + 1]) mode = argv[++i]
        else if (argv[i] === '--cwd' && argv[i + 1]) cwd = argv[++i]
        else if (argv[i].startsWith('--mode=')) mode = argv[i].slice('--mode='.length)
        else if (argv[i].startsWith('--cwd=')) cwd = argv[i].slice('--cwd='.length)
        else throw new Error(`invalid argument ${argv[i]}`)
      }
      return runRender({ mode, cwd, env, writeStdout: out, writeStderr: err })
    }
    if (command === 'session-start' || command === 'turn' || command === 'post-edit') {
      const payload = readHookInput(input)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('hook input must be an object')
      if (command === 'session-start') return runSessionStart({ input: payload, env, writeStdout: out })
      if (command === 'turn') return runTurn({ input: payload, env, writeStdout: out })
      return runPostEdit({ input: payload, env, writeStdout: out })
    }
    err(usage)
    return 0
  } catch (error) {
    if (command === 'render') { out(`${failText(error)}\n`); return 0 }
    if (command === 'session-start') { out(hookJson('SessionStart', failText(error))); return 0 }
    if (command === 'turn') { out(hookJson('UserPromptSubmit', failText(error))); return 0 }
    if (command === 'post-edit') { out(hookJson('PostToolUse', failText(error))); return 0 }
    err(usage)
    return 0
  }
}

module.exports = { WORK_CONTEXT_VERSION, MAX_FULL_CHARS, CHECKLIST, STATUS_FIELDS, INJECT_SECTIONS, loadWorkContextConfig, parseStatusHead, parseInject, parseIntentFile, idLabel, loadIntentLedger, loadMemoryIndex, resolveActivePlan, loadContext, renderFullText, buildFullText, renderShortText, fingerprintOf, recordDirectory, recordPath, readRecord, runSessionStart, runTurn, runPostEdit, runRender, runCli }
if (require.main === module) process.exitCode = runCli()
