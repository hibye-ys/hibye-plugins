#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const PLUGIN_ID = 'state-ledger@hibye-plugins'
const PLUGIN_NAME = 'state-ledger'
const MARKETPLACE = 'hibye-plugins'
const REQUIRED_CONTRACT_VERSION = 6
const DEFAULT_DISCOVERY_TIMEOUT_MS = 3000
const DEFAULT_ACTION_TIMEOUT_MS = 30000

const ACTIONS = new Map([
  ['session-start', { script: 'scripts/hooks/global-state-hook.sh', args: ['session-start'], stdin: true }],
  ['turn-start', { script: 'scripts/hooks/global-state-hook.sh', args: ['turn-start'], stdin: true }],
  ['stamp', { script: 'scripts/hooks/global-state-hook.sh', args: ['stamp'], stdin: true }],
  ['stop', { script: 'scripts/hooks/global-state-hook.sh', args: ['stop'], stdin: true }],
  ['commit-msg', { script: 'scripts/hooks/commit-msg-state-check.sh', args: [], strict: true }],
  ['cleanup', { script: 'scripts/hooks/state-cleanup.mjs', args: [], node: true, strict: true }],
  ['check-wip', { script: 'scripts/check-state-wip-cap.sh', args: [] }],
  ['check-branch', { script: 'scripts/check-state-branch-sync.sh', args: [] }],
  // STATE_INDEX_SOURCE="frontmatter" 의 로컬 생성 인덱스 갱신 (git hook·수동). 실패는 warn-only.
  ['render', { script: 'scripts/hooks/state-index.mjs', args: ['render', '--write'], runtime: 'node' }],
])

// 프로젝트 루트 선택 순서는 scripts/hooks/state-config.mjs 의 projectRoot() 와 같다:
// HOOK_PROJECT_DIR → 현재 디렉터리의 git toplevel → CLAUDE_PROJECT_DIR → cwd.
// Claude 데스크톱 앱은 linked worktree 세션에서도 CLAUDE_PROJECT_DIR 을 primary checkout 으로 두므로,
// git toplevel 을 먼저 봐야 worktree 자신의 .staterc 로 판정한다.
// lifecycle 액션(session-start/turn-start/stamp/stop)은 dispatcher global-state-hook.sh 로 그대로 전달되고
// 세션별 pin 규칙은 dispatcher 가 따로 적용한다. 그래서 runner 에는 pin 로직을 넣지 않는다.
// 여기서 구한 루트는 .staterc capability 판정(cleanupRequired/frontmatterRequired)에만 쓴다.
let cachedProjectRoot
function projectRoot() {
  if (cachedProjectRoot !== undefined) return cachedProjectRoot
  let root = process.env.HOOK_PROJECT_DIR
  if (!root) {
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const out = top.status === 0 ? (top.stdout || '').trim() : ''
    root = out || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  }
  cachedProjectRoot = root
  return root
}

function cleanupRequired() {
  const root = projectRoot()
  try {
    if (/^STATE_CLEANUP_ENFORCE="1"\s*$/m.test(readFileSync(join(root, '.staterc'), 'utf8'))) return true
  } catch { /* HEAD still protects an uncommitted opt-out */ }
  const head = spawnSync('git', ['-C', root, 'show', 'HEAD:.staterc'], { encoding: 'utf8', timeout: 3000 })
  return head.status === 0 && /^STATE_CLEANUP_ENFORCE="1"\s*$/m.test(head.stdout)
}

// STATE_INDEX_SOURCE="frontmatter" 프로젝트는 그 원천을 아는 설치본(index_source_version 1)만 실행한다.
// 모르는 설치본은 STATE.md 가 없다고 보고 detail 을 고아로 판정하므로 unavailable 로 다룬다(정리 강제면 fail-closed).
function frontmatterRequired() {
  const root = projectRoot()
  const pattern = /^STATE_INDEX_SOURCE="frontmatter"\s*$/m
  try {
    if (pattern.test(readFileSync(join(root, '.staterc'), 'utf8'))) return true
  } catch { /* HEAD still declares a committed source */ }
  const head = spawnSync('git', ['-C', root, 'show', 'HEAD:.staterc'], { encoding: 'utf8', timeout: 3000 })
  return head.status === 0 && pattern.test(head.stdout)
}

function required(action) {
  return action.node || (action.strict && cleanupRequired())
}

function unavailable(strict) {
  warn('활성화된 user-scope state-ledger 설치본을 찾지 못해 검사를 건너뜁니다.')
  if (strict) process.stdout.write('STATE_CLEANUP_BLOCK: cleanup validator is unavailable\n')
  process.exit(strict ? 1 : 0)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function pluginRoot(candidate, expectedVersion = '') {
  if (!candidate) return null
  const root = resolve(candidate)
  const contract = readJson(join(root, 'state-ledger-contract.json'))
  if (contract?.version !== REQUIRED_CONTRACT_VERSION) return null
  if (cleanupRequired() && contract.cleanup_version !== 1) return null
  if (frontmatterRequired() && contract.index_source_version !== 1) return null
  const manifests = [
    join(root, '.codex-plugin', 'plugin.json'),
    join(root, '.claude-plugin', 'plugin.json'),
  ]
  for (const manifestPath of manifests) {
    const manifest = readJson(manifestPath)
    if (manifest?.name !== PLUGIN_NAME) continue
    if (expectedVersion && manifest.version !== expectedVersion) continue
    return root
  }
  return null
}

function boundedTimeout(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10)
  return Number.isInteger(parsed) && parsed >= 10 && parsed <= 60000 ? parsed : fallback
}

function fromCodex() {
  const cli = process.env.CODEX_CLI_PATH || 'codex'
  const listed = spawnSync(cli, ['plugin', 'list', '--marketplace', MARKETPLACE, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: boundedTimeout('STATE_LEDGER_DISCOVERY_TIMEOUT_MS', DEFAULT_DISCOVERY_TIMEOUT_MS),
  })
  if (listed.status !== 0 || !listed.stdout) return { available: false, root: null }

  let catalog
  try {
    catalog = JSON.parse(listed.stdout)
  } catch {
    return { available: false, root: null }
  }
  const installed = catalog?.installed?.find(
    (plugin) => plugin?.pluginId === PLUGIN_ID && plugin?.installed === true && plugin?.enabled === true,
  )
  if (!installed?.version) return { available: true, root: null }

  const userHome = process.env.HOME || homedir()
  const codexHome = process.env.CODEX_HOME || join(userHome, '.codex')
  return {
    available: true,
    root: pluginRoot(
      join(codexHome, 'plugins', 'cache', MARKETPLACE, PLUGIN_NAME, installed.version),
      installed.version,
    ),
  }
}

function fromCodexCache() {
  const userHome = process.env.HOME || homedir()
  const codexHome = process.env.CODEX_HOME || join(userHome, '.codex')
  const cacheRoot = join(codexHome, 'plugins', 'cache', MARKETPLACE, PLUGIN_NAME)
  let versions
  try {
    versions = readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
  } catch {
    return null
  }
  for (const version of versions) {
    const root = pluginRoot(join(cacheRoot, version), version)
    if (root) return root
  }
  return null
}

function fromClaude() {
  const userHome = process.env.HOME || homedir()
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(userHome, '.claude')
  const settings = readJson(join(configDir, 'settings.json'))
  if (settings?.enabledPlugins?.[PLUGIN_ID] !== true) return null

  const registry = readJson(join(configDir, 'plugins', 'installed_plugins.json'))
  const installs = registry?.plugins?.[PLUGIN_ID]
  if (!Array.isArray(installs)) return null
  for (const install of [...installs].reverse()) {
    if (install?.scope !== 'user' || !install?.installPath) continue
    const root = pluginRoot(install.installPath, install.version || '')
    if (root) return root
  }
  return null
}

function resolvePluginRoot() {
  const explicit = pluginRoot(process.env.STATE_LEDGER_PLUGIN_ROOT)
  if (explicit) return explicit
  const codex = fromCodex()
  if (codex.root) return codex.root
  if (!codex.available) {
    const cached = fromCodexCache()
    if (cached) return cached
  }
  return fromClaude()
}

function warn(message) {
  process.stdout.write(`WARN: ${message}\n`)
}

function run(root, action, extraArgs = [], input) {
  const target = join(root, action.script)
  try {
    if (!statSync(target).isFile()) throw new Error('not a regular file')
  } catch {
    warn(`state-ledger 설치본에 ${action.script}가 없어 검사를 건너뜁니다.`)
    if (required(action)) { process.stdout.write('STATE_CLEANUP_BLOCK: cleanup validator is unavailable\n'); process.exitCode = 1 }
    return
  }

  const result = spawnSync(action.node || action.runtime === 'node' ? process.execPath : 'bash', [target, ...action.args, ...extraArgs], {
    env: process.env,
    encoding: 'utf8',
    input,
    maxBuffer: 1024 * 1024,
    timeout: boundedTimeout('STATE_LEDGER_ACTION_TIMEOUT_MS', DEFAULT_ACTION_TIMEOUT_MS),
  })
  for (const output of [result.stdout, result.stderr]) {
    if (!output) continue
    process.stdout.write(output)
    if (!output.endsWith('\n')) process.stdout.write('\n')
  }
  if (result.error || result.status !== 0) {
    if (required(action)) {
      process.stdout.write('STATE_CLEANUP_BLOCK: required validator execution failed\n')
      process.exitCode = result.status || 1
    }
    else warn(`state-ledger ${action.script} 실행 실패; warn-only로 계속합니다.`)
  }
}

const [actionName, ...extraArgs] = process.argv.slice(2)
if (actionName === 'validate') {
  const root = resolvePluginRoot()
  if (!root) {
    unavailable(cleanupRequired())
  }
  run(root, ACTIONS.get('check-branch'))
  run(root, ACTIONS.get('check-wip'))
  if (cleanupRequired()) run(root, ACTIONS.get('cleanup'), ['validate-staged'])
  process.exit(process.exitCode || 0)
}

const action = ACTIONS.get(actionName)
if (!action) {
  process.stderr.write('usage: state-ledger-runner.mjs <session-start|turn-start|stamp|stop|commit-msg|check-wip|check-branch|render|cleanup|validate> [args...]\n')
  process.exit(2)
}

const root = resolvePluginRoot()
if (!root) {
  unavailable(required(action))
}
const input = action.stdin ? readFileSync(0) : undefined
run(root, action, extraArgs, input)
