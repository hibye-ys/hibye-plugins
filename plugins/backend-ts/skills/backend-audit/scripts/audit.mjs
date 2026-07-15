#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function usage() {
  console.error('usage: audit.mjs [--project <repo>] [--api-app <path>] [--full] [--print]')
}

function parseArgs(argv) {
  const out = { project: process.cwd(), apiApp: null, full: false, print: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--full') out.full = true
    else if (arg === '--print') out.print = true
    else if (arg === '--project' && argv[i + 1]) out.project = argv[++i]
    else if (arg === '--api-app' && argv[i + 1]) out.apiApp = argv[++i]
    else {
      usage()
      throw new Error(`unknown or incomplete argument: ${arg}`)
    }
  }
  return out
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function findRepoRoot(start) {
  let cursor = resolve(start)
  for (;;) {
    if (existsSync(join(cursor, 'package.json'))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error(`package.json not found from ${start}`)
    cursor = parent
  }
}

function findApiApp(root, explicit) {
  if (explicit) return resolve(root, explicit)
  for (const candidate of ['apps/api', 'packages/api', '.']) {
    const path = resolve(root, candidate)
    if (!existsSync(join(path, 'package.json'))) continue
    const pkg = readJson(join(path, 'package.json'))
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    if (deps.hono && deps.typescript) return path
  }
  throw new Error('TypeScript Hono API package not found; pass --api-app')
}

function task(label, command, args, cwd) {
  return { label, command, args, cwd }
}

function display(t) {
  return `(${t.cwd}) ${t.command} ${t.args.join(' ')}`
}

function run(t, printOnly) {
  console.log(`\n== ${t.label} ==`)
  console.log(display(t))
  if (printOnly) return
  const result = spawnSync(t.command, t.args, { cwd: t.cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${t.label} failed with exit ${result.status ?? 'unknown'}`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = findRepoRoot(args.project)
  const apiApp = findApiApp(root, args.apiApp)
  const apiPkg = readJson(join(apiApp, 'package.json'))
  const rootPkg = readJson(join(root, 'package.json'))
  const filter = apiPkg.name || basename(apiApp)
  const packageManager = String(rootPkg.packageManager ?? 'pnpm').split('@')[0]
  if (packageManager !== 'pnpm') {
    throw new Error(`unsupported package manager: ${packageManager}`)
  }

  const tasks = []
  for (const script of ['typecheck', 'lint']) {
    if (apiPkg.scripts?.[script]) {
      tasks.push(task(`api ${script}`, 'pnpm', ['--filter', filter, 'run', script], root))
    }
  }
  if (args.full && apiPkg.scripts?.test) {
    tasks.push(task('api test', 'pnpm', ['--filter', filter, 'run', 'test'], root))
  }
  if (args.full && rootPkg.scripts?.knip) {
    tasks.push(task('workspace knip', 'pnpm', ['run', 'knip', '--reporter', 'compact'], root))
  }
  if (tasks.length === 0) throw new Error('no audit scripts found in package.json')

  console.log(`backend-audit: project=${root} api=${apiApp} mode=${args.full ? 'full' : 'quick'}`)
  for (const t of tasks) run(t, args.print)
  console.log(`\nbackend-audit: PASS (${tasks.length} command${tasks.length === 1 ? '' : 's'})`)
}

try {
  main()
} catch (error) {
  console.error(`backend-audit: FAIL — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
