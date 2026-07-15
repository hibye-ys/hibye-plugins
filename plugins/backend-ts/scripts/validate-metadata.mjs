#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = join(pluginDir, 'skills')
const expectedSkills = process.argv.slice(2)

function fail(message) {
  throw new Error(message)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
}

function parseFrontmatter(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  if (lines[0] !== '---') fail(`${path}: frontmatter must start on line 1`)
  const end = lines.indexOf('---', 1)
  if (end < 0) fail(`${path}: frontmatter closing delimiter missing`)
  const values = new Map()
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) fail(`${path}: unsupported frontmatter line: ${line}`)
    const [, key, value] = match
    if (values.has(key)) fail(`${path}: duplicate frontmatter key: ${key}`)
    values.set(key, value.trim())
  }
  for (const key of values.keys()) {
    if (key !== 'name' && key !== 'description') {
      fail(`${path}: unsupported frontmatter key: ${key}`)
    }
  }
  return values
}

function parseQuotedYamlString(raw, path, key) {
  try {
    const value = JSON.parse(raw)
    if (typeof value !== 'string') fail(`${path}: ${key} must be a quoted string`)
    return value
  } catch (error) {
    fail(`${path}: ${key} must be a valid double-quoted string (${error instanceof Error ? error.message : String(error)})`)
  }
}

function parseOpenAiInterface(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  if (lines[0] !== 'interface:') fail(`${path}: top-level interface block is required`)
  const values = new Map()
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue
    const match = /^  ([a-z_]+):\s*(.+)$/.exec(line)
    if (!match) fail(`${path}: unsupported YAML line: ${line}`)
    const [, key, raw] = match
    if (values.has(key)) fail(`${path}: duplicate interface key: ${key}`)
    values.set(key, parseQuotedYamlString(raw, path, key))
  }
  return values
}

function validateSkill(skill) {
  const dir = join(skillsDir, skill)
  const skillMd = join(dir, 'SKILL.md')
  const openAi = join(dir, 'agents', 'openai.yaml')
  if (!existsSync(skillMd)) fail(`${skill}: SKILL.md missing`)
  if (!existsSync(openAi)) fail(`${skill}: agents/openai.yaml missing`)

  const frontmatter = parseFrontmatter(skillMd)
  if (frontmatter.get('name') !== skill) fail(`${skill}: frontmatter name mismatch`)
  const description = frontmatter.get('description') ?? ''
  if (description.length === 0 || description.length > 1024) {
    fail(`${skill}: description must be 1-1024 characters`)
  }
  if (description.includes('<') || description.includes('>')) {
    fail(`${skill}: description must not contain angle brackets`)
  }

  const ui = parseOpenAiInterface(openAi)
  for (const key of ['display_name', 'short_description', 'default_prompt']) {
    if (!ui.get(key)) fail(`${skill}: interface.${key} is required`)
  }
  const shortDescription = ui.get('short_description')
  if (shortDescription.length < 25 || shortDescription.length > 64) {
    fail(`${skill}: short_description must be 25-64 characters`)
  }
  if (!ui.get('default_prompt').includes(`$${skill}`)) {
    fail(`${skill}: default_prompt must mention $${skill}`)
  }
}

function validateManifest() {
  const codexPath = join(pluginDir, '.codex-plugin', 'plugin.json')
  const claudePath = join(pluginDir, '.claude-plugin', 'plugin.json')
  const codex = readJson(codexPath)
  const claude = readJson(claudePath)
  const pluginName = basename(pluginDir)

  if (codex.name !== pluginName || claude.name !== pluginName) {
    fail('plugin directory and manifest names must match')
  }
  if (typeof codex.version !== 'string' || typeof claude.version !== 'string') {
    fail('both manifests require a version')
  }
  if (codex.version.split('+')[0] !== claude.version) {
    fail('Claude and Codex base versions must match')
  }
  if (codex.skills !== './skills/' || !existsSync(skillsDir)) {
    fail('Codex manifest skills must point to ./skills/')
  }
  for (const key of ['description', 'author', 'interface']) {
    if (!codex[key]) fail(`Codex manifest missing ${key}`)
  }
  const ui = codex.interface
  for (const key of [
    'displayName',
    'shortDescription',
    'longDescription',
    'developerName',
    'capabilities',
    'category',
    'brandColor',
    'composerIcon',
    'defaultPrompt',
  ]) {
    if (!ui[key] || (Array.isArray(ui[key]) && ui[key].length === 0)) {
      fail(`Codex manifest interface.${key} is required`)
    }
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(ui.brandColor)) {
    fail('Codex manifest interface.brandColor must be a 6-digit hex color')
  }
  if (!existsSync(resolve(pluginDir, ui.composerIcon))) {
    fail(`Codex manifest composerIcon missing: ${ui.composerIcon}`)
  }
}

try {
  if (expectedSkills.length === 0) fail('pass the expected skill names as arguments')
  for (const skill of expectedSkills) validateSkill(skill)
  validateManifest()
  console.log(`validate-metadata: PASS (${expectedSkills.length} skills + 2 manifests)`)
} catch (error) {
  console.error(`validate-metadata: FAIL — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
