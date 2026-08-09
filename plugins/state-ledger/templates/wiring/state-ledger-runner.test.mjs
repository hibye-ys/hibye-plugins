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
  write(join(root, 'state-ledger-contract.json'), JSON.stringify({ version: 6 }))
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
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...options.env },
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test('explicit plugin root forwards lifecycle stdin and mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-ledger-runner-plugin-'))
  try {
    fakePlugin(root)
    const payload = { tool_input: { file_path: 'docs/state/root/example.md' } }
    const output = run(['stamp'], {
      env: { STATE_LEDGER_PLUGIN_ROOT: root },
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
      run(['validate'], { env: { STATE_LEDGER_PLUGIN_ROOT: root } }),
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
      run(['validate'], { env: { STATE_LEDGER_PLUGIN_ROOT: root } }),
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
