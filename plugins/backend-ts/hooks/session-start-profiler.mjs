#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
const pluginData = process.env.CLAUDE_PLUGIN_DATA

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function detectApiApp(root) {
  for (const relative of ['apps/api', 'packages/api', '.']) {
    const app = resolve(root, relative)
    const pkg = readJson(join(app, 'package.json'))
    if (!pkg) continue
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    const eunhaSignals = [
      join(app, 'src/agent-loop/loop.ts'),
      join(app, 'src/tools/registry.ts'),
      join(app, 'src/middleware/error-rfc7807.ts'),
    ]
    if (deps.hono && deps.typescript && eunhaSignals.every(existsSync)) {
      return relative
    }
  }
  return null
}

function main() {
  const apiApp = detectApiApp(projectDir)
  if (!apiApp) return

  const config = {
    detectedAt: new Date().toISOString(),
    projectDir,
    apiApp,
    skills: [
      'agent-loop-runtime',
      'context-runtime',
      'agent-definition',
      'subagent-runtime',
      'provider-runtime',
      'tool-runtime',
      'mcp-runtime',
      'http-contract',
      'stream-contract',
      'backend-audit',
    ],
  }

  if (pluginData) {
    const path = join(pluginData, 'instance-config.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8')
  }

  const context = [
    '# backend-ts',
    `- API app: \`${apiApp}\``,
    '- Read project AGENTS.md and the API AGENTS.md before editing.',
    '- Current code and tests outrank plugin prose.',
    '- Use only the matching backend-ts skill; do not load the full catalog.',
  ].join('\n')

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    }),
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(
    `backend-ts session hook error: ${error instanceof Error ? error.message : String(error)}\n`,
  )
}
