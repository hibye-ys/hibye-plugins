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
])

function cleanupRequired() {
  const root = process.env.HOOK_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  try {
    if (/^STATE_CLEANUP_ENFORCE="1"\s*$/m.test(readFileSync(join(root, '.staterc'), 'utf8'))) return true
  } catch { /* HEAD still protects an uncommitted opt-out */ }
  const head = spawnSync('git', ['-C', root, 'show', 'HEAD:.staterc'], { encoding: 'utf8', timeout: 3000 })
  return head.status === 0 && /^STATE_CLEANUP_ENFORCE="1"\s*$/m.test(head.stdout)
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

  const result = spawnSync(action.node ? process.execPath : 'bash', [target, ...action.args, ...extraArgs], {
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
  process.stderr.write('usage: state-ledger-runner.mjs <session-start|turn-start|stamp|stop|commit-msg|check-wip|check-branch|cleanup|validate> [args...]\n')
  process.exit(2)
}

const root = resolvePluginRoot()
if (!root) {
  unavailable(required(action))
}
const input = action.stdin ? readFileSync(0) : undefined
run(root, action, extraArgs, input)
