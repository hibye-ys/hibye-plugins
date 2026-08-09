#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_STATE_INDEXES = 'STATE.md'
export const DEFAULT_STATE_WORK_INCLUDE_RE = String.raw`(^|/)\.staterc$|(^|/)Dockerfile$|\.(ts|tsx|js|jsx|mjs|cjs|sh|py|css|html|svg|ya?ml|json|sql|toml|go|rs|java|kt|swift|c|cc|cpp|h|hpp|png|jpe?g|webp|gif|avif|woff2?|ttf|otf)$|(^|/)(prompts?|agents?|skills?|commands?)/.*\.md$`
export const DEFAULT_STATE_WORK_EXCLUDE_RE = String.raw`(^|/)(node_modules|dist|build|coverage|vendor)/`

const MAX_STATERC_BYTES = 64 * 1024
const MAX_STATE_INDEXES = 16
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

export function projectRoot() {
  const configured = process.env.HOOK_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR
  const root = configured || git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
  return realpathSync(resolve(root))
}

export function readStaterc(root, key) {
  const path = join(root, '.staterc')
  try {
    const info = lstatSync(path)
    if (!info.isFile() && !info.isSymbolicLink()) return null
    const real = realpathSync(path)
    if (!staysWithinRoot(root, real)) {
      throw new Error('.staterc resolves outside the repository')
    }
    if (statSync(real).size > MAX_STATERC_BYTES) {
      throw new Error(`.staterc exceeds ${MAX_STATERC_BYTES} bytes`)
    }
    const line = readFileSync(path, 'utf8')
      .split('\n')
      .find((candidate) => new RegExp(`^${key}="[^"]*"\\s*$`).test(candidate))
    return line?.match(/^[A-Z_]+="([^"]*)"\s*$/)?.[1] ?? null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function staysWithinRoot(root, absolute) {
  const rel = relative(root, absolute)
  return rel === '' || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && rel !== '..' && !isAbsolute(rel))
}

function validateIndexPath(root, candidate) {
  if (!candidate || isAbsolute(candidate) || candidate.includes('\\')) {
    throw new Error(`STATE_INDEXES contains an unsafe path: ${candidate}`)
  }
  if (candidate !== normalize(candidate) || candidate.startsWith('./')) {
    throw new Error(`STATE_INDEXES contains a non-normalized path: ${candidate}`)
  }
  const segments = candidate.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || !SAFE_SEGMENT_RE.test(segment))) {
    throw new Error(`STATE_INDEXES contains an unsafe path: ${candidate}`)
  }
  if (segments.at(-1) !== 'STATE.md') {
    throw new Error(`STATE_INDEXES entries must end in STATE.md: ${candidate}`)
  }

  const absolute = resolve(root, candidate)
  if (!staysWithinRoot(root, absolute)) {
    throw new Error(`STATE_INDEXES escapes the repository: ${candidate}`)
  }
  try {
    const real = realpathSync(absolute)
    if (!staysWithinRoot(root, real)) {
      throw new Error(`STATE_INDEXES resolves outside the repository: ${candidate}`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return candidate
}

export function stateConfig(root) {
  const configuredIndexes = readStaterc(root, 'STATE_INDEXES') || DEFAULT_STATE_INDEXES
  const candidates = configuredIndexes.split(/\s+/).filter(Boolean)
  if (candidates.length === 0) throw new Error('STATE_INDEXES must contain at least one path')
  if (candidates.length > MAX_STATE_INDEXES) {
    throw new Error(`STATE_INDEXES exceeds ${MAX_STATE_INDEXES} entries`)
  }

  const indexes = [...new Set(candidates.map((path) => validateIndexPath(root, path)))]
  const indexByArea = {}
  const areaByIndex = new Map()
  const scopes = []

  for (const path of indexes) {
    const area = path === 'STATE.md' ? 'root' : basename(dirname(path))
    if (indexByArea[area] && indexByArea[area] !== path) {
      throw new Error(`STATE_INDEXES maps multiple indexes to area ${area}`)
    }
    indexByArea[area] = path
    areaByIndex.set(path, area)
    if (area !== 'root') scopes.push({ area, prefix: `${dirname(path)}/` })
  }

  const includePattern = readStaterc(root, 'STATE_WORK_INCLUDE_RE') || DEFAULT_STATE_WORK_INCLUDE_RE
  const excludePattern = readStaterc(root, 'STATE_WORK_EXCLUDE_RE') || DEFAULT_STATE_WORK_EXCLUDE_RE
  return {
    indexes,
    indexByArea,
    areaByIndex,
    scopes: scopes.sort((a, b) => b.prefix.length - a.prefix.length),
    workIncludeRe: new RegExp(includePattern),
    workExcludeRe: new RegExp(excludePattern),
  }
}

function main() {
  if (process.argv[2] !== 'indexes') {
    process.stderr.write('usage: state-config.mjs indexes\n')
    process.exitCode = 2
    return
  }
  const config = stateConfig(projectRoot())
  process.stdout.write(`${config.indexes.join('\n')}\n`)
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) main()
