import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadProjectContextRuntime, resolveProjectContextPluginRoot } from '../templates/wiring/project-context-runner.mjs'
const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function fixture(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'context-loader-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const root = path.join(home, '.codex/plugins/cache/hibye-plugins/project-context/0.1.0')
  fs.mkdirSync(path.dirname(root), { recursive: true }); fs.cpSync(SOURCE, root, { recursive: true })
  const listed = () => ({ status: 0, stdout: JSON.stringify({ installed: [{ pluginId: 'project-context@hibye-plugins', installed: true, enabled: true, version: '0.1.0' }] }) })
  return { home, root, listed }
}
test('import does not require an installation; explicit snapshot CJS API loads lazily', t => {
  const { root } = fixture(t)
  const runtime = loadProjectContextRuntime({ pluginRoot: root, host: 'codex' })
  assert.equal(runtime.PROJECT_CONTEXT_CONTRACT_VERSION, 1)
  assert.equal(typeof runtime.resolveProjectMemory, 'function')
})
test('Codex discovery requires enabled native registration and matching snapshot version', t => {
  const { home, root, listed } = fixture(t)
  assert.equal(resolveProjectContextPluginRoot({ host: 'codex', home, env: {}, spawn: listed }), root)
  for (const record of [{ installed: [] }, { installed: [{ pluginId: 'project-context@hibye-plugins', installed: true, enabled: false, version: '0.1.0' }] }, { installed: [{ pluginId: 'project-context@hibye-plugins', installed: true, enabled: true, version: 'wrong' }] }]) {
    assert.throws(() => resolveProjectContextPluginRoot({ host: 'codex', home, env: {}, spawn: () => ({ status: 0, stdout: JSON.stringify(record) }) }), /no enabled/)
  }
  assert.throws(() => resolveProjectContextPluginRoot({ host: 'codex', home, env: { PROJECT_CONTEXT_PLUGIN_ROOT: root }, spawn: () => ({ status: 1 }) }), /no enabled/)
})
test('Claude requires its own enabled user-scope registration; another host cannot mask absence', t => {
  const { home, root, listed } = fixture(t)
  const config = path.join(home, '.claude'); fs.mkdirSync(path.join(config, 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'project-context@hibye-plugins': true } }))
  const registry = scope => ({ plugins: { 'project-context@hibye-plugins': [{ scope, installPath: root, version: '0.1.0' }] } })
  fs.writeFileSync(path.join(config, 'plugins/installed_plugins.json'), JSON.stringify(registry('user')))
  assert.equal(resolveProjectContextPluginRoot({ host: 'claude', home, env: {} }), root)
  fs.writeFileSync(path.join(config, 'plugins/installed_plugins.json'), JSON.stringify(registry('project')))
  assert.throws(() => resolveProjectContextPluginRoot({ host: 'claude', home, env: {}, spawn: listed }), /no enabled/)
})
test('invalid contract/name/version/entry and source links fail before require', t => {
  const { root } = fixture(t)
  const contract = path.join(root, 'project-context-contract.json')
  fs.writeFileSync(contract, JSON.stringify({ version: 2, runtime: 'scripts/project-context.cjs' }))
  assert.throws(() => loadProjectContextRuntime({ pluginRoot: root }), /not a valid/)
  fs.copyFileSync(path.join(SOURCE, 'project-context-contract.json'), contract)
  const link = `${root}-linked`; fs.symlinkSync(root, link)
  assert.throws(() => loadProjectContextRuntime({ pluginRoot: link }), /not a valid/)
  fs.symlinkSync(path.join(SOURCE, 'scripts/project-context.cjs'), path.join(root, 'scripts/source-link.cjs'))
  assert.throws(() => loadProjectContextRuntime({ pluginRoot: root }), /not a valid/)
  fs.unlinkSync(path.join(root, 'scripts/source-link.cjs'))
  fs.renameSync(path.join(root, 'scripts/project-context.cjs'), path.join(root, 'scripts/gone.cjs'))
  assert.throws(() => loadProjectContextRuntime({ pluginRoot: root }), /not a valid/)
})
test('symlink in snapshot parent cannot disguise a source-linked payload', t => {
  const { home, root } = fixture(t)
  const linked = path.join(home, 'source-parent'); fs.symlinkSync(path.dirname(root), linked)
  assert.throws(() => loadProjectContextRuntime({ pluginRoot: path.join(linked, path.basename(root)) }), /not a valid/)
})
test('both native manifests expose one common SessionStart binding with four events', () => {
  const claude = JSON.parse(fs.readFileSync(path.join(SOURCE, '.claude-plugin/plugin.json')))
  assert.equal(claude.hooks, undefined)
  const hooks = JSON.parse(fs.readFileSync(path.join(SOURCE, 'hooks/hooks.json'))).hooks
  assert.equal(hooks.SessionStart.length, 1); assert.equal(hooks.SessionStart[0].hooks.length, 1)
  assert.deepEqual(hooks.SessionStart[0].matcher.split('|'), ['startup', 'resume', 'clear', 'compact'])
  assert.equal(hooks.SessionStart[0].hooks[0].additionalContextLimit, 2500)
  assert.match(hooks.SessionStart[0].hooks[0].command, /\$CLAUDE_PLUGIN_ROOT\/scripts\/project-context.cjs/)
})
