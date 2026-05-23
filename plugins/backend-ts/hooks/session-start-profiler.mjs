#!/usr/bin/env node
// session-start-profiler.mjs
//
// Claude Code SessionStart hook for backend-ts plugin.
// 표준 plugin 패턴 (vercel plugin 참고):
//   - CLAUDE_PROJECT_DIR 의 package.json / 디렉토리 자동 스캔
//   - framework / 모노레포 / 도메인 자동 감지
//   - ${CLAUDE_PLUGIN_DATA}/instance-config.json 저장 (영구)
//   - JSON output 으로 additionalContext inject (현재 session 컨텍스트)
//
// 백엔드 프로젝트 (TypeScript 의존성 보유) 가 아니면 silent skip.
// 사용자 수동 작업 0 — 표준 plugin 의 "설치하면 즉시 동작" 패턴.

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const PLUGIN_DATA = process.env.CLAUDE_PLUGIN_DATA
const CONFIG_PATH = PLUGIN_DATA ? join(PLUGIN_DATA, 'instance-config.json') : null

// ── 1. package.json 위치 탐색 (monorepo root + apps/api 등 후보) ──
function findPackageJsons(root) {
  const candidates = []
  const rootPkg = join(root, 'package.json')
  if (existsSync(rootPkg)) candidates.push(rootPkg)

  // apps/* / packages/* 1-depth 스캔
  for (const subdir of ['apps', 'packages', 'services']) {
    const dir = join(root, subdir)
    if (!existsSync(dir)) continue
    try {
      for (const name of readdirSync(dir)) {
        const pkg = join(dir, name, 'package.json')
        if (existsSync(pkg)) candidates.push(pkg)
      }
    } catch { /* ignore */ }
  }
  return candidates
}

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')) }
  catch { return null }
}

// ── 2. framework detection (dependency 기반) ──
const FRAMEWORK_PATTERNS = {
  hono: ['hono'],
  express: ['express'],
  fastify: ['fastify'],
  koa: ['koa'],
  nestjs: ['@nestjs/core'],
  elysia: ['elysia'],
}

function detectFramework(allDeps) {
  for (const [name, deps] of Object.entries(FRAMEWORK_PATTERNS)) {
    if (deps.some(d => d in allDeps)) return name
  }
  return null
}

const RUNTIME_PATTERNS = {
  workers: ['wrangler', '@cloudflare/workers-types'],
  bun: ['bun-types'],
  deno: ['@types/deno'],
  node: [],   // default
}

function detectRuntime(allDeps) {
  for (const [name, deps] of Object.entries(RUNTIME_PATTERNS)) {
    if (deps.some(d => d in allDeps)) return name
  }
  return 'node'
}

// ── 3. 모노레포 layout 감지 ──
function detectMonorepoLayout(root) {
  const layout = { type: 'single', apiApp: null }
  if (existsSync(join(root, 'apps'))) {
    layout.type = 'monorepo'
    // apps/api / apps/backend / apps/server 우선 탐색
    for (const candidate of ['api', 'backend', 'server', 'web-api']) {
      if (existsSync(join(root, 'apps', candidate))) {
        layout.apiApp = `apps/${candidate}`
        break
      }
    }
  } else if (existsSync(join(root, 'packages'))) {
    layout.type = 'monorepo'
    for (const candidate of ['api', 'backend', 'server']) {
      if (existsSync(join(root, 'packages', candidate))) {
        layout.apiApp = `packages/${candidate}`
        break
      }
    }
  } else if (existsSync(join(root, 'src'))) {
    layout.type = 'single'
    layout.apiApp = '.'
  }
  return layout
}

// ── 4. 도메인 어휘 후보 추출 (db/schema, models, entities, domain) ──
function extractDomainVocab(root, apiApp) {
  const candidates = []
  const baseDirs = apiApp ? [join(root, apiApp)] : [root]

  for (const base of baseDirs) {
    for (const sub of ['src/domain', 'src/models', 'src/entities', 'src/db/schema', 'src/schema', 'domain', 'models']) {
      const dir = join(base, sub)
      if (!existsSync(dir)) continue
      try {
        for (const name of readdirSync(dir)) {
          // 확장자 제거 + index 제외
          const stem = name.replace(/\.(ts|js|mjs|cjs|tsx)$/, '')
          if (stem !== 'index' && stem !== name && /^[a-z][a-z0-9_-]*$/i.test(stem)) {
            candidates.push(stem.toLowerCase().replace(/-/g, '_'))
          }
        }
      } catch { /* ignore */ }
    }
  }

  // 중복 제거 + 길이 3 미만 제외
  const unique = [...new Set(candidates)].filter(s => s.length >= 3)
  return unique.length > 0 ? unique : null
}

// ── 5. main ──
function main() {
  const pkgs = findPackageJsons(PROJECT_DIR)
  if (pkgs.length === 0) {
    // package.json 없음 — backend 프로젝트 아님, silent exit
    return
  }

  // 모든 package.json 의 dependencies 합집합
  const allDeps = {}
  for (const pkg of pkgs) {
    const data = readJsonSafe(pkg)
    if (!data) continue
    Object.assign(allDeps, data.dependencies ?? {}, data.devDependencies ?? {})
  }

  // TypeScript 백엔드 신호 — typescript 의존성 + framework 의존성 중 하나
  const hasTypescript = 'typescript' in allDeps || '@types/node' in allDeps
  const framework = detectFramework(allDeps)
  if (!hasTypescript || !framework) {
    // backend-ts plugin 의 대상이 아님 — silent skip
    return
  }

  const runtime = detectRuntime(allDeps)
  const layout = detectMonorepoLayout(PROJECT_DIR)
  const domainVocab = extractDomainVocab(PROJECT_DIR, layout.apiApp)

  const config = {
    detectedAt: new Date().toISOString(),
    projectDir: PROJECT_DIR,
    framework,
    runtime,
    layout,
    domainVocab,
  }

  // ${CLAUDE_PLUGIN_DATA}/instance-config.json 영구 저장
  if (CONFIG_PATH) {
    try {
      mkdirSync(dirname(CONFIG_PATH), { recursive: true })
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
    } catch { /* ignore */ }
  }

  // additionalContext 로 inject — Claude Code SessionStart hook 의 표준 JSON output
  const context = [
    '# backend-ts plugin — 자동 감지 결과',
    '',
    `- Framework: **${framework}**`,
    `- Runtime: **${runtime}**`,
    `- Layout: ${layout.type}${layout.apiApp ? ` (api app = \`${layout.apiApp}\`)` : ''}`,
    domainVocab ? `- Domain vocab: ${domainVocab.slice(0, 10).map(v => `\`${v}\``).join(', ')}` : null,
    '',
    'plugin skill 본문의 placeholder 는 위 매핑으로 해석:',
    `- \`<framework>\` → ${framework}`,
    layout.apiApp ? `- \`<api-app>\` → ${layout.apiApp}` : null,
    `- \`<runtime>\` → ${runtime}`,
    domainVocab ? `- \`DOMAIN_VOCAB\` → \`${domainVocab.slice(0, 10).join('|')}\`` : null,
  ].filter(Boolean).join('\n')

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  }
  process.stdout.write(JSON.stringify(output))
}

try {
  main()
} catch (err) {
  // 어떤 에러도 sessionStart 를 차단하면 안 됨 — silent
  process.stderr.write(`backend-ts profiler error: ${err.message}\n`)
}
