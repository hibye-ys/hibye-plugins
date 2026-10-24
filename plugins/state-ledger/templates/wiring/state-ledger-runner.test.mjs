import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const RUNNER = fileURLToPath(new URL('./state-ledger-runner.mjs', import.meta.url))

function write(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  if (mode) chmodSync(path, mode)
}

function fakePlugin(root, version = 'test-version') {
  write(join(root, 'state-ledger-contract.json'), JSON.stringify({ version: 6, cleanup_version: 1 }))
  write(
    join(root, '.codex-plugin/plugin.json'),
    JSON.stringify({ name: 'state-ledger', version }),
  )
  write(
    join(root, 'scripts/hooks/global-state-hook.sh'),
    '#!/bin/bash\ninput=$(cat)\nprintf \'{"mode":"%s","input":%s}\\n\' "$1" "$input"\n',
  )
  write(
    join(root, 'scripts/hooks/commit-msg-state-check.sh'),
    '#!/bin/bash\nprintf \'commit:%s\\n\' "$1"\n',
  )
  write(join(root, 'scripts/check-state-branch-sync.sh'), '#!/bin/bash\necho branch-ok\n')
  write(join(root, 'scripts/check-state-wip-cap.sh'), '#!/bin/bash\necho wip-ok\n')
  write(join(root, 'scripts/hooks/state-cleanup.mjs'), 'process.stdout.write("cleanup-ok\\n")\n')
}

function invoke(args, options = {}) {
  assert.ok(options.env?.HOOK_PROJECT_DIR, 'each runner test must select its own fixture project')
  return spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: options.env.HOOK_PROJECT_DIR,
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...options.env },
  })
}

function run(args, options = {}) {
  const result = invoke(args, options)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test('explicit plugin root forwards lifecycle stdin and mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-plugin-'))
  try {
    fakePlugin(root)
    const payload = { tool_input: { file_path: 'docs/state/root/example.md' } }
    const output = run(['stamp'], {
      env: { STATE_LEDGER_PLUGIN_ROOT: root, HOOK_PROJECT_DIR: root },
      input: JSON.stringify(payload),
    })
    assert.deepEqual(JSON.parse(output), { mode: 'stamp', input: payload })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Codex catalog resolves the enabled versioned installation cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-codex-'))
  try {
    const codexHome = join(root, 'codex-home')
    const pluginRoot = join(
      codexHome,
      'plugins/cache/hibye-plugins/state-ledger/test-version',
    )
    fakePlugin(pluginRoot)
    const cli = join(root, 'codex')
    write(
      cli,
      `#!/bin/bash
cat <<'JSON'
{"installed":[{"pluginId":"state-ledger@hibye-plugins","name":"state-ledger","marketplaceName":"hibye-plugins","version":"test-version","installed":true,"enabled":true}]}
JSON
`,
      0o755,
    )

    assert.equal(
      run(['commit-msg', 'message.txt'], {
        env: {
          HOOK_PROJECT_DIR: root,
          STATE_LEDGER_PLUGIN_ROOT: '',
          CODEX_CLI_PATH: cli,
          CODEX_HOME: codexHome,
          CLAUDE_CONFIG_DIR: join(root, 'no-claude'),
        },
      }),
      'commit:message.txt',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Codex cache fallback is bounded when the CLI hangs', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-cache-fallback-'))
  try {
    const codexHome = join(root, 'codex-home')
    const pluginRoot = join(codexHome, 'plugins/cache/hibye-plugins/state-ledger/test-version')
    fakePlugin(pluginRoot)
    const cli = join(root, 'codex')
    write(cli, '#!/bin/bash\nsleep 2\n', 0o755)

    const started = Date.now()
    assert.equal(
      run(['check-wip'], {
        env: {
          HOOK_PROJECT_DIR: root,
          STATE_LEDGER_PLUGIN_ROOT: '',
          STATE_LEDGER_DISCOVERY_TIMEOUT_MS: '50',
          CODEX_CLI_PATH: cli,
          CODEX_HOME: codexHome,
          CLAUDE_CONFIG_DIR: join(root, 'no-claude'),
        },
      }),
      'wip-ok',
    )
    assert.ok(Date.now() - started < 1000)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an authoritative disabled catalog does not activate a stale cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-disabled-'))
  try {
    const codexHome = join(root, 'codex-home')
    fakePlugin(join(codexHome, 'plugins/cache/hibye-plugins/state-ledger/test-version'))
    const cli = join(root, 'codex')
    write(
      cli,
      '#!/bin/bash\necho \'{"installed":[{"pluginId":"state-ledger@hibye-plugins","version":"test-version","installed":true,"enabled":false}]}\'\n',
      0o755,
    )

    assert.match(
      run(['check-wip'], {
        env: {
          HOOK_PROJECT_DIR: root,
          STATE_LEDGER_PLUGIN_ROOT: '',
          CODEX_CLI_PATH: cli,
          CODEX_HOME: codexHome,
          CLAUDE_CONFIG_DIR: join(root, 'no-claude'),
        },
      }),
      /활성화된 user-scope state-ledger 설치본을 찾지 못해/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Claude user installation is used when Codex discovery is unavailable', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-claude-'))
  try {
    const pluginRoot = join(root, 'plugin')
    fakePlugin(pluginRoot, '0.3.0')
    const claude = join(root, 'claude')
    write(
      join(claude, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'state-ledger@hibye-plugins': true } }),
    )
    write(
      join(claude, 'plugins/installed_plugins.json'),
      JSON.stringify({
        plugins: {
          'state-ledger@hibye-plugins': [
            { scope: 'user', installPath: pluginRoot, version: '0.3.0' },
          ],
        },
      }),
    )

    assert.equal(
      run(['check-wip'], {
        env: {
          HOOK_PROJECT_DIR: root,
          STATE_LEDGER_PLUGIN_ROOT: '',
          CODEX_CLI_PATH: join(root, 'no-codex'),
          CODEX_HOME: join(root, 'no-codex-home'),
          CLAUDE_CONFIG_DIR: claude,
        },
      }),
      'wip-ok',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validate runs both plugin-owned checkers', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-validate-'))
  try {
    fakePlugin(root)
    assert.equal(
      run(['validate'], { env: { STATE_LEDGER_PLUGIN_ROOT: root, HOOK_PROJECT_DIR: root } }),
      'branch-ok\nwip-ok',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('checker stderr is normalized onto runner stdout', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-stderr-'))
  try {
    fakePlugin(root)
    write(join(root, 'scripts/check-state-wip-cap.sh'), '#!/bin/bash\necho wip-warning >&2\n')
    assert.equal(
      run(['validate'], { env: { STATE_LEDGER_PLUGIN_ROOT: root, HOOK_PROJECT_DIR: root } }),
      'branch-ok\nwip-warning',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an incompatible plugin contract remains warn-only', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-contract-'))
  try {
    fakePlugin(root)
    write(join(root, 'state-ledger-contract.json'), JSON.stringify({ version: 5 }))
    assert.match(
      run(['check-wip'], {
        env: {
          HOOK_PROJECT_DIR: root,
          STATE_LEDGER_PLUGIN_ROOT: root,
          CODEX_CLI_PATH: join(root, 'no-codex'),
          CODEX_HOME: join(root, 'no-codex-home'),
          CLAUDE_CONFIG_DIR: join(root, 'no-claude'),
        },
      }),
      /활성화된 user-scope state-ledger 설치본을 찾지 못해/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('missing installation remains warn-only', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-missing-'))
  try {
    assert.match(
      run(['check-wip'], {
        env: {
          HOOK_PROJECT_DIR: root,
          HOME: root,
          STATE_LEDGER_PLUGIN_ROOT: join(root, 'missing'),
          CODEX_CLI_PATH: join(root, 'no-codex'),
          CODEX_HOME: join(root, 'no-codex-home'),
          CLAUDE_CONFIG_DIR: join(root, 'no-claude'),
        },
      }),
      /WARN: 활성화된 user-scope state-ledger 설치본을 찾지 못해 검사를 건너뜁니다/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function cleanupFixture(t, { optIn = true, capability = true, installed = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-cleanup-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const plugin = join(root, 'plugin')
  if (installed) {
    fakePlugin(plugin)
    if (!capability) write(join(plugin, 'state-ledger-contract.json'), JSON.stringify({ version: 6 }))
  }
  write(join(root, '.staterc'), `STATE_CLEANUP_ENFORCE="${optIn ? '1' : '0'}"\n`)
  return {
    root,
    plugin,
    env: {
      HOOK_PROJECT_DIR: root,
      STATE_LEDGER_PLUGIN_ROOT: plugin,
      CODEX_CLI_PATH: join(root, 'no-codex'),
      CODEX_HOME: join(root, 'no-codex-home'),
      CLAUDE_CONFIG_DIR: join(root, 'no-claude'),
    },
  }
}

test('cleanup opt-in validates the supported capability after the ordinary checkers', (t) => {
  const fixture = cleanupFixture(t)
  const result = invoke(['validate'], { env: fixture.env })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'branch-ok\nwip-ok\ncleanup-ok')
})

for (const optIn of [false, true]) {
  test(`v6 installation without cleanup capability ${optIn ? 'fails closed when opted in' : 'preserves ordinary validation when opted out'}`, (t) => {
    const fixture = cleanupFixture(t, { optIn, capability: false })
    const result = invoke(['validate'], { env: fixture.env })
    assert.equal(result.status, optIn ? 1 : 0, `${result.stdout}\n${result.stderr}`)
    if (optIn) {
      assert.match(result.stdout, /STATE_CLEANUP_BLOCK/)
      assert.doesNotMatch(result.stdout, /(?:branch|wip|cleanup)-ok/)
    } else {
      assert.equal(result.stdout.trim(), 'branch-ok\nwip-ok')
    }
  })
}

for (const optIn of [false, true]) {
  test(`missing installation validate ${optIn ? 'fails closed when opted in' : 'remains warn-only when opted out'}`, (t) => {
    const fixture = cleanupFixture(t, { optIn, installed: false })
    const result = invoke(['validate'], { env: fixture.env })
    assert.equal(result.status, optIn ? 1 : 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /활성화된 user-scope state-ledger 설치본을 찾지 못해/)
    if (optIn) assert.match(result.stdout, /STATE_CLEANUP_BLOCK/)
    else assert.doesNotMatch(result.stdout, /STATE_CLEANUP_BLOCK/)
  })
}

test('cleanup validator exit 1 propagates through validate and the explicit cleanup action', (t) => {
  const fixture = cleanupFixture(t)
  write(join(fixture.plugin, 'scripts/hooks/state-cleanup.mjs'), 'process.stderr.write("fixture-cleanup-rejected\\n"); process.exitCode = 1\n')
  for (const args of [['validate'], ['cleanup', 'validate-staged']]) {
    const result = invoke(args, { env: fixture.env })
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /fixture-cleanup-rejected/)
    assert.match(result.stdout, /STATE_CLEANUP_BLOCK/)
    assert.doesNotMatch(result.stdout, /warn-only로 계속/)
  }
})

test('opted-in commit-msg preserves the validator failure exit status', (t) => {
  const fixture = cleanupFixture(t)
  write(join(fixture.plugin, 'scripts/hooks/commit-msg-state-check.sh'), '#!/bin/bash\necho fixture-commit-rejected >&2\nexit 1\n')
  const result = invoke(['commit-msg', join(fixture.root, 'message.txt')], { env: fixture.env })
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /fixture-commit-rejected/)
  assert.doesNotMatch(result.stdout, /warn-only로 계속/)
})

test('a capability claim without the cleanup validator cannot make opted-in validation pass', (t) => {
  const fixture = cleanupFixture(t)
  rmSync(join(fixture.plugin, 'scripts/hooks/state-cleanup.mjs'))
  const result = invoke(['validate'], { env: fixture.env })
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /STATE_CLEANUP_BLOCK/)
})

test('ordinary checker failures stay warn-only while the cleanup validator still runs', (t) => {
  const fixture = cleanupFixture(t)
  write(join(fixture.plugin, 'scripts/check-state-wip-cap.sh'), '#!/bin/bash\necho fixture-wip-failed >&2\nexit 7\n')
  const result = invoke(['validate'], { env: fixture.env })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /fixture-wip-failed/)
  assert.match(result.stdout, /warn-only로 계속/)
  assert.match(result.stdout, /cleanup-ok/)
})
