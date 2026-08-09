#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [root, host, hookScript] = process.argv.slice(2)
if (!root || !host || !hookScript) {
  process.stderr.write('usage: detect-local-state-hook.mjs <root> <codex|claude> <hook-script>\n')
  process.exit(2)
}

function containsHookCommand(value) {
  if (Array.isArray(value)) return value.some(containsHookCommand)
  if (!value || typeof value !== 'object') return false
  if (value.type === 'command' && typeof value.command === 'string') {
    const escaped = hookScript.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[/\\s"'])${escaped}([\\s"']|$)`).test(value.command)) return true
  }
  return Object.values(value).some(containsHookCommand)
}

function jsonContains(path) {
  try {
    return containsHookCommand(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return false
  }
}

function stripTomlComment(line) {
  let quote = null
  let escaped = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '#') return line.slice(0, i)
  }
  return line
}

function tomlContains(path) {
  try {
    const escaped = hookScript.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const commandRe = new RegExp(`^\\s*command\\s*=\\s*(["']).*(^|[/\\s])${escaped}([\\s"']|$)`)
    return readFileSync(path, 'utf8')
      .split('\n')
      .map(stripTomlComment)
      .some((line) => commandRe.test(line))
  } catch {
    return false
  }
}

const found = host === 'codex'
  ? jsonContains(join(root, '.codex', 'hooks.json')) || tomlContains(join(root, '.codex', 'config.toml'))
  : jsonContains(join(root, '.claude', 'settings.json')) || jsonContains(join(root, '.claude', 'settings.local.json'))

process.exit(found ? 0 : 1)
