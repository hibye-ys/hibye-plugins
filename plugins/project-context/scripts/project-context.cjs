#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const PROJECT_CONTEXT_CONTRACT_VERSION = 1
const PROJECT_CONTEXT_EVENTS = Object.freeze(['startup', 'resume', 'clear', 'compact'])
const INTENT_DIR = 'intent'
const GIT_LOCATION_ENV = ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CEILING_DIRECTORIES']
function gitQuery(cwd, args, { git = execFileSync, env = process.env } = {}) {
  const clean = { ...env }
  for (const key of Object.keys(clean)) if (GIT_LOCATION_ENV.includes(key) || /^GIT_CONFIG_(KEY|VALUE)_/.test(key)) delete clean[key]
  return git('git', args, { cwd, env: clean, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function checkoutRoot(repoRoot = process.cwd(), options = {}) {
  return fs.realpathSync(gitQuery(fs.realpathSync(path.resolve(repoRoot)), ['rev-parse', '--show-toplevel'], options))
}
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
function loadProjectContextConfig({ repoRoot = process.cwd(), validateIntent = true, ...options } = {}) {
  let root
  try { root = checkoutRoot(repoRoot, options) } catch (error) {
    if (fs.existsSync(path.join(path.resolve(repoRoot), '.project-context.json'))) throw new Error(`PROJECT_CONTEXT_CONFIG_FAILED: Git checkout required; ${error.message}`)
    return { enabled: false, repoRoot: path.resolve(repoRoot), configPath: null, memory: false, intent: false }
  }
  const configPath = path.join(root, '.project-context.json')
  try { fs.lstatSync(configPath) } catch (error) { if (error.code === 'ENOENT') return { enabled: false, repoRoot: root, configPath, memory: false, intent: false }; throw error }
  confined(root, '.project-context.json', 'config')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  keys(config, ['schema_version', 'memory', 'intent'], 'config')
  if (config.schema_version !== 1) throw new Error('config.schema_version must equal 1')
  for (const name of ['memory', 'intent']) {
    if (config[name] === undefined || config[name] === false) { config[name] = false; continue }
    if (name === 'intent' && !validateIntent) continue
    keys(config[name], name === 'memory' ? ['directory', 'index'] : ['directory'], name)
    relative(config[name].directory, `${name}.directory`)
    if (name === 'memory') relative(config[name].index, 'memory.index')
    // Intent's filesystem boundary is checked only when loading intent, never while resolving memory.
  }
  if (!config.memory && !config.intent) throw new Error('config must enable memory or intent')
  return { enabled: true, repoRoot: root, configPath, memory: config.memory, intent: config.intent }
}
function resolveProjectMemory({ repoRoot = process.cwd(), config, ...options } = {}) {
  try {
    const settings = config || loadProjectContextConfig({ repoRoot, ...options, validateIntent: false })
    if (!settings.enabled || !settings.memory) throw new Error('project memory is not opted in')
    const checkout = checkoutRoot(repoRoot, options)
    const common = fs.realpathSync(gitQuery(checkout, ['rev-parse', '--path-format=absolute', '--git-common-dir'], options))
    const fields = gitQuery(checkout, ['worktree', 'list', '--porcelain', '-z'], options).split('\0\0', 1)[0].split('\0')
    const primaryField = fields.find(field => field.startsWith('worktree '))
    if (!primaryField || fields.includes('bare')) throw new Error('Git common directory has no primary checkout')
    const primary = fs.realpathSync(primaryField.slice('worktree '.length))
    if (checkoutRoot(primary, options) !== primary || fs.realpathSync(gitQuery(primary, ['rev-parse', '--path-format=absolute', '--git-common-dir'], options)) !== common) throw new Error('primary checkout does not match Git common directory')
    const primaryConfig = primary === checkout ? settings : loadProjectContextConfig({ repoRoot: primary, ...options, validateIntent: false })
    if (!primaryConfig.enabled || !primaryConfig.memory) throw new Error('primary checkout must opt in to shared memory')
    const mismatch = primaryConfig.memory.directory !== settings.memory.directory || primaryConfig.memory.index !== settings.memory.index
    const directory = confined(primary, primaryConfig.memory.directory, 'memory.directory')
    const indexPath = confined(primary, `${primaryConfig.memory.directory}/${primaryConfig.memory.index}`, 'memory.index')
    return Object.freeze({ contract_version: 1, checkout_root: checkout, primary_checkout: primary, git_common_dir: common, directory, index_path: indexPath, ...(mismatch ? { configuration_warning: 'linked memory config differs from primary; primary memory config is authoritative' } : {}) })
  } catch (error) { throw new Error(`PROJECT_MEMORY_ROOT_FAILED: ${error.message}; inspect git worktree list --porcelain and the primary checkout`, { cause: error }) }
}
function inspectMemoryIndex({ repoRoot = process.cwd(), resolveMemory = resolveProjectMemory, ...options } = {}) {
  const { directory, index_path: indexPath } = resolveMemory({ repoRoot, ...options })
  const index = fs.readFileSync(indexPath, 'utf8')
  const counts = new Map()
  const invalid = []
  for (const match of index.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const link = match[1].split('#', 1)[0].replace(/^\.\//, '')
    const target = path.posix.join(path.relative(directory, path.dirname(indexPath)).split(path.sep).join('/'), link)
    if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link) || !link.endsWith('.md')) continue
    if (path.resolve(directory, target) === indexPath) continue
    try { if (path.posix.isAbsolute(link)) throw new Error('absolute link'); confined(directory, target, 'memory link') } catch { invalid.push(target); continue }
    counts.set(target, (counts.get(target) || 0) + 1)
  }
  const files = []
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = `${prefix}${entry.name}`
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}/`)
      else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.md') && path.join(directory, rel) !== indexPath) {
        try { confined(directory, rel, 'memory detail'); if (!fs.statSync(path.join(directory, rel)).isFile()) throw new Error('not file'); files.push(rel) } catch { invalid.push(rel) }
      }
    }
  }
  walk(directory)
  files.sort()
  const stable = values => [...new Set(values)].sort()
  const dangling = stable([...invalid, ...[...counts.keys()].filter(name => !files.includes(name))])
  const unindexed = files.filter(name => !counts.has(name))
  const duplicated = stable([...counts].filter(([,count]) => count !== 1).map(([name]) => name))
  return Object.freeze({ schema_version: 1, kind: 'ProjectMemoryIndexContractV1', memory_directory: directory, directory, index_path: indexPath, ok: !dangling.length && !unindexed.length && !duplicated.length, indexed_file_count: counts.size, detail_file_count: files.length, dangling, unindexed, duplicated })
}
const ENTRY_HEADING = /^## ([A-Z]+\d+) · (.+)$/
const FIELD_LINE = /^- (규칙|갱신):\s*(.*)$/
// 영역 파일 설명 = 스킬 description 처럼 세션에 주입되는 한 줄(무엇 — 언제 읽나). 첫 항목 앞에 둔다.
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

function loadIntentLedger({ repoRoot = process.cwd(), readFile = fs.readFileSync, listDir = fs.readdirSync, config } = {}) {
  const settings = config || loadProjectContextConfig({ repoRoot })
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

// 스킬 목록처럼 영역 파일의 설명·경로만 주입하고 규칙 본문은 관련 작업 때 파일을 읽게 한다(C12).
function renderIntentContext(ledger) {
  const lines = [
    'PROJECT_INTENT_BEGIN',
    '프로젝트 운영 결정(intent/) — 해당 작업 전에 그 파일을 읽는다. AGENTS.md·스킬·메모리 문구가 결정과 어긋나면 임의로 고르지 말고 사용자에게 알린다.',
    ...ledger.areas.map((area) => `- ${area.file} (${idLabel(area.ids)}): ${area.description ?? '설명 없음'}`),
  ]
  if (ledger.errors.length > 0) lines.push(`INTENT_LEDGER_INVALID ${ledger.errors.length}건: ${ledger.errors[0]}`)
  lines.push('PROJECT_INTENT_END')
  return lines.join('\n')
}

// ID 표기: 없으면 "항목 없음", 번호가 이어지면 범위, 끊기면 ID 를 나열한다.
function idLabel(ids) {
  if (ids.length === 0) return '항목 없음'
  if (ids.length === 1) return ids[0]
  const parts = ids.map((id) => /^([A-Z]+)(\d+)$/u.exec(id))
  const contiguous = parts.every((part, index) => part !== null && part[1] === parts[0][1] &&
    Number(part[2]) === Number(parts[0][2]) + index)
  return contiguous ? `${ids[0]}–${ids.at(-1)}` : ids.join(', ')
}

function intentSessionContext({ repoRoot = process.cwd(), load = loadIntentLedger } = {}) {
  return renderIntentContext(load({ repoRoot }))
}


function boundedContext(text, maxBytes = 12000) {
  if (Buffer.byteLength(text) <= maxBytes) return text
  const suffix = '\nPROJECT_CONTEXT_TRUNCATED: read .project-context.json and its configured source directories lazily; run project-context doctor to inspect all configured sources.'
  const points = Array.from(text)
  let end = Math.min(points.length, maxBytes)
  while (end && Buffer.byteLength(points.slice(0, end).join('') + suffix) > maxBytes) end -= 32
  return points.slice(0, Math.max(0, end)).join('') + suffix
}
function hookOutput(context) {
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }
}
function detectHost(env = process.env, input = {}) {
  // SessionStart input belongs to this invocation; arbitrary inherited flags do not.
  if (input.hook_event_name !== 'SessionStart' || typeof input.session_id !== 'string' || !input.session_id) throw new Error('PROJECT_CONTEXT_HOST_UNRESOLVED: native SessionStart/session_id proof is absent; pass --host codex|claude for a raw CLI call')
  const claude = env.CLAUDE_CODE_SESSION_ID === input.session_id
  const runtimeRoot = fs.realpathSync(path.resolve(__dirname, '..'))
  const matchesRuntime = value => {
    if (typeof value !== 'string' || !value) return false
    try { return fs.realpathSync(path.resolve(value)) === runtimeRoot } catch { return false }
  }
  const codex = matchesRuntime(env.PLUGIN_ROOT) && matchesRuntime(env.CLAUDE_PLUGIN_ROOT)
  if (claude && codex) throw new Error('PROJECT_CONTEXT_HOST_AMBIGUOUS: both native host proofs match this invocation; use an explicit --host adapter')
  if (claude) return 'claude'
  if (codex) return 'codex'
  throw new Error('PROJECT_CONTEXT_HOST_UNRESOLVED: no current native host proof matches; pass --host codex|claude for a raw CLI call')
}
function buildSessionStartContext({ repoRoot = process.cwd(), host = 'codex', event = 'startup', resolveMemory = resolveProjectMemory, intentContext = intentSessionContext, readFile = fs.readFileSync, diagnostics, ...options } = {}) {
  if (!['codex', 'claude', 'muse', 'antigravity'].includes(host)) throw new Error(`unknown host ${host}`)
  if (!PROJECT_CONTEXT_EVENTS.includes(event)) throw new Error(`unsupported session event ${event}`)
  const config = loadProjectContextConfig({ repoRoot, ...options, validateIntent: false })
  if (!config.enabled) return hookOutput('')
  const lines = [`PROJECT_CONTEXT_V1`, `PROJECT_CHECKOUT ${config.repoRoot}`]
  if (config.memory) {
    try {
      const memory = resolveMemory({ repoRoot: config.repoRoot, config, ...options })
      assertHostMemorySupport(memory, host)
      const index = readFile(memory.index_path, 'utf8')
      // Claude's native autoMemoryDirectory already loads this same index.
      lines.push(`PROJECT_MEMORY ${JSON.stringify({ directory: memory.directory, index_path: memory.index_path, index_sha256: createHash('sha256').update(index).digest('hex'), native_index: host === 'claude' })}`)
      if (host !== 'claude') lines.push('Before relevant work, read this shared memory index, then only matching detail files.')
      if (memory.configuration_warning) lines.push(`PROJECT_MEMORY_CONFIG_MISMATCH: ${memory.configuration_warning}`)
      lines.push('Read and write the same shared directory; never substitute a worktree copy. Re-read immediately before editing and preserve other writers. Follow the host permission boundary when the primary path is outside this checkout.')
    } catch (error) { lines.push(`PROJECT_CONTEXT_FAILED: ${error.message}\nRecovery: inspect .project-context.json, git worktree list --porcelain, and the primary memory index. Do not substitute a checkout-local copy.`) }
  }
  if (config.intent) {
    try { lines.push(boundedContext(intentContext({ repoRoot: config.repoRoot, config }), 7000)) } catch (error) { lines.push(`INTENT_CONTEXT_FAILED: ${error.message}; inspect ${config.intent.directory} in PROJECT_CHECKOUT`) }
  }
  if (typeof diagnostics === 'function') {
    try { const detail = diagnostics({ repoRoot: config.repoRoot }); if (detail) lines.push(`PROJECT_CONTEXT_DIAGNOSTIC ${String(detail).slice(0, 500)}`) } catch (error) { lines.push(`PROJECT_CONTEXT_DIAGNOSTIC_FAILED: ${error.message}`) }
  }
  lines.push(`Session event: ${event}. On resume/clear/compact recover the active project plan and current work before acting; read relevant shared memory evidence lazily. Intent and code belong to PROJECT_CHECKOUT.`)
  return hookOutput(boundedContext(lines.join('\n')))
}
function assertHostMemorySupport(memory, host) {
  if ((host === 'claude' || host === 'all') && memory.index_path !== path.join(memory.directory, 'MEMORY.md')) throw new Error('CLAUDE_NATIVE_MEMORY_UNSUPPORTED: initial v1 Claude native memory requires index MEMORY.md directly inside the configured memory directory; choose --host codex for generic custom-index inspection')
}
function inspectProjectContext({ repoRoot = process.cwd(), host = 'all', ...options } = {}) {
  const errors = []
  let config, memory, intent
  try { config = loadProjectContextConfig({ repoRoot, ...options, validateIntent: false }) } catch (error) { return { ok: false, enabled: true, errors: [error.message] } }
  if (!config.enabled) return { ok: true, enabled: false, config, errors }
  if (config.memory) try { memory = inspectMemoryIndex({ repoRoot: config.repoRoot, ...options }); if (!memory.ok) errors.push('memory index has dangling, unindexed or duplicated entries'); assertHostMemorySupport(memory, host) } catch (error) { errors.push(error.message) }
  if (config.intent) try { intent = loadIntentLedger({ repoRoot: config.repoRoot, config }); errors.push(...intent.errors) } catch (error) { errors.push(error.message) }
  return { ok: errors.length === 0, enabled: true, config, memory, intent, errors }
}
function parseCli(argv) {
  let command = argv[0] || 'session-start'
  const result = { command }
  for (let i = 1; i < argv.length; i++) {
    const name = argv[i]
    if (!['--project', '--host', '--event'].includes(name) || !argv[i + 1]) throw new Error(`invalid argument ${name}`)
    result[{ '--project': 'repoRoot', '--host': 'host', '--event': 'event' }[name]] = argv[++i]
  }
  return result
}
function inputProject(input, env) {
  return input.cwd || (Array.isArray(input.workspacePaths) && input.workspacePaths.find(p => typeof p === 'string' && fs.existsSync(p))) || env.CLAUDE_PROJECT_DIR || env.HOOK_PROJECT_DIR || process.cwd()
}
function runSessionStartContextCli({ argv = process.argv.slice(2), repoRoot, host, event, env = process.env, input, writeStdout = value => process.stdout.write(value) } = {}) {
  let output
  try {
    const args = parseCli(argv[0]?.startsWith('--') ? ['session-start', ...argv] : argv)
    let payload = input
    if (payload === undefined) { try { payload = fs.readFileSync(0, 'utf8') } catch { payload = '' } }
    if (typeof payload === 'string') payload = JSON.parse(payload || '{}')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('hook input must be an object')
    const project = repoRoot || args.repoRoot || inputProject(payload, env)
    let selectedHost = host || args.host
    if (!selectedHost) {
      // Unrelated projects stay no-op even when called outside a native host.
      if (!loadProjectContextConfig({ repoRoot: project, env, validateIntent: false }).enabled) {
        writeStdout(`${JSON.stringify(hookOutput(''))}\n`)
        return 0
      }
      selectedHost = detectHost(env, payload)
    }
    output = buildSessionStartContext({ repoRoot: project, host: selectedHost, event: event || args.event || payload.source || 'startup', env })
  } catch (error) { output = hookOutput(`PROJECT_CONTEXT_FAILED: ${error.message}\nRecovery: check the project opt-in and installed project-context snapshot, then rerun doctor.`) }
  writeStdout(`${JSON.stringify(output)}\n`)
  // Hook failures stay visible in additionalContext; nonzero host exits can discard it.
  return 0
}
function runIntentCli({ argv = process.argv.slice(2), repoRoot = process.cwd(), writeStdout = value => process.stdout.write(value), writeStderr = value => process.stderr.write(value), ...options } = {}) {
  if (argv[0] === 'session-start') {
    let text
    try { text = boundedContext(intentSessionContext({ repoRoot, ...options }), 7000) } catch (error) { text = `INTENT_CONTEXT_FAILED: ${error.message}` }
    writeStdout(`${JSON.stringify(hookOutput(text))}\n`)
    return 0
  }
  if (argv[0] === 'check') {
    try { const { errors } = loadIntentLedger({ repoRoot, ...options }); for (const error of errors) writeStderr(`intent: ${error}\n`); return errors.length ? 1 : 0 } catch (error) { writeStderr(`intent: ${error.message}\n`); return 1 }
  }
  writeStderr('usage: intent-ledger <session-start|check>\n'); return 2
}
function runCli({ argv = process.argv.slice(2), writeStdout = value => process.stdout.write(value), writeStderr = value => process.stderr.write(value), ...options } = {}) {
  let args
  try { args = parseCli(argv) } catch (error) { writeStderr(`${error.message}\n`); return 2 }
  const opts = { ...options, ...args, writeStdout, writeStderr }
  if (args.command === 'session-start') return runSessionStartContextCli({ ...opts, argv })
  if (args.command === 'intent-session-start') return runIntentCli({ ...opts, argv: ['session-start'] })
  if (args.command === 'intent-check') return runIntentCli({ ...opts, argv: ['check'] })
  try {
    const report = args.command === 'doctor' ? inspectProjectContext(opts) : args.command === 'check-memory' ? inspectMemoryIndex(opts) : null
    if (!report) { writeStderr('usage: project-context <session-start|check-memory|intent-check|intent-session-start|doctor> [--project <path>] [--host <host>] [--event <event>]\n'); return 2 }
    writeStdout(`${JSON.stringify(report)}\n`); return report.ok ? 0 : 1
  } catch (error) { writeStderr(`PROJECT_CONTEXT_FAILED: ${error.message}\n`); return 1 }
}
module.exports = { PROJECT_CONTEXT_CONTRACT_VERSION, PROJECT_CONTEXT_EVENTS, INTENT_DIR, loadProjectContextConfig, resolveProjectMemory, inspectMemoryIndex, parseIntentFile, loadIntentLedger, renderIntentContext, intentSessionContext, runIntentCli, buildSessionStartContext, runSessionStartContextCli, inspectProjectContext, runCli, detectHost, inputProject }
if (require.main === module) process.exitCode = runCli()
