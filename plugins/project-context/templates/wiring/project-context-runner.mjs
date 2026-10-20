#!/usr/bin/env node
// Copy byte-for-byte; project policy and content belong outside this adapter.
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const ID = 'project-context@hibye-plugins'
const ENTRY = 'scripts/project-context.cjs'
function json(file) { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
function snapshot(root, version, host) {
  if (!root) return null
  root = path.resolve(root)
  try {
    // Reject source links anywhere in the distributed payload, including root.
    function walk(dir) {
      if (lstatSync(dir).isSymbolicLink()) throw new Error('source link')
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        if (item.isSymbolicLink()) throw new Error('payload link')
        if (item.isDirectory()) walk(path.join(dir, item.name))
      }
    }
    const systemNormalized = root.replace(/^\/tmp\//, '/private/tmp/').replace(/^\/var\//, '/private/var/')
    if (realpathSync(root) !== systemNormalized) return null
    walk(root)
    const contract = json(path.join(root, 'project-context-contract.json'))
    if (contract?.version !== 1 || contract.runtime !== ENTRY) return null
    const hosts = host ? [host] : ['codex', 'claude']
    if (!hosts.some(name => { const manifest = json(path.join(root, `.${name}-plugin/plugin.json`)); return manifest?.name === 'project-context' && typeof manifest.version === 'string' && manifest.version && (!version || manifest.version === version) })) return null
    if (!lstatSync(path.join(root, ENTRY)).isFile()) return null
    return root
  } catch { return null }
}
export function resolveProjectContextPluginRoot({ pluginRoot, host, home = homedir(), env = process.env, spawn = spawnSync } = {}) {
  if (host && !['codex', 'claude'].includes(host)) throw new Error(`unsupported installed host ${host}`)
  if (pluginRoot !== undefined) {
    const root = snapshot(pluginRoot, '', host)
    if (!root) throw new Error('PROJECT_CONTEXT_FAILED: explicit pluginRoot is not a valid project-context snapshot')
    return root
  }
  if (!host || host === 'codex') {
    const codexHome = env.CODEX_HOME || path.join(home, '.codex')
    const listed = spawn('codex', ['plugin', 'list', '--marketplace', 'hibye-plugins', '--json'], { env, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
    if (listed.status === 0) {
      let catalog
      try { catalog = JSON.parse(listed.stdout) } catch {}
      const install = catalog?.installed?.find(p => p?.pluginId === ID && p.installed === true && p.enabled === true && (!p.scope || p.scope === 'user'))
      if (install?.version) {
        const root = snapshot(path.join(codexHome, 'plugins/cache/hibye-plugins/project-context', install.version), install.version, 'codex')
        if (root) return root
      }
    }
  }
  if (!host || host === 'claude') {
    const config = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
    if (json(path.join(config, 'settings.json'))?.enabledPlugins?.[ID] === true) {
      const installs = json(path.join(config, 'plugins/installed_plugins.json'))?.plugins?.[ID]
      if (Array.isArray(installs)) for (const install of [...installs].reverse()) {
        if (install?.scope !== 'user' || !install.installPath || !install.version) continue
        const root = snapshot(install.installPath, install.version, 'claude')
        if (root) return root
      }
    }
  }
  throw new Error('PROJECT_CONTEXT_FAILED: no enabled user project-context snapshot found; install/enable project-context@hibye-plugins and rerun project setup/doctor')
}
export function loadProjectContextRuntime(options = {}) {
  const runtime = require(path.join(resolveProjectContextPluginRoot(options), ENTRY))
  if (runtime.PROJECT_CONTEXT_CONTRACT_VERSION !== 1 || typeof runtime.runCli !== 'function') throw new Error('PROJECT_CONTEXT_FAILED: runtime contract mismatch')
  return runtime
}
export function runProjectContextCli({ argv = process.argv.slice(2), ...options } = {}) {
  try { return loadProjectContextRuntime(options).runCli({ argv }) } catch (error) {
    if ((argv[0] || 'session-start') === 'session-start') {
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `${error.message}\nRecovery: install/enable the project-context snapshot and rerun doctor.` } })}\n`)
      return 0
    }
    process.stderr.write(`${error.message}\n`); return 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = runProjectContextCli()
