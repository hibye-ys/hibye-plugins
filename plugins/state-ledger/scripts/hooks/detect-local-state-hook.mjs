#!/usr/bin/env node

import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_CONFIG_BYTES = 1024 * 1024

const [root, host, hookScript] = process.argv.slice(2)
if (!root || !host || !hookScript) {
  process.stderr.write('usage: detect-local-state-hook.mjs <root> <codex|claude> <hook-script>\n')
  process.exit(2)
}

const escapedHookScript = hookScript.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hookCommandPattern = new RegExp(`(^|[/\\s"'])${escapedHookScript}([\\s"']|$)`)

function isHookCommand(command) {
  return hookCommandPattern.test(command)
}

function containsHookCommand(value) {
  if (Array.isArray(value)) return value.some(containsHookCommand)
  if (!value || typeof value !== 'object') return false
  if (value.type === 'command' && typeof value.command === 'string') {
    if (isHookCommand(value.command)) return true
  }
  return Object.values(value).some(containsHookCommand)
}

function readConfig(path) {
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return null
    return readFileSync(fd, 'utf8')
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function jsonContains(path) {
  try {
    const source = readConfig(path)
    if (source === null) return false
    const parsed = JSON.parse(source)
    return containsHookCommand(parsed?.hooks)
  } catch {
    return false
  }
}

function skipHorizontalSpace(source, start) {
  let i = start
  while (source[i] === ' ' || source[i] === '\t') i += 1
  return i
}

function readTomlString(source, start) {
  const quote = source[start]
  if (quote !== '"' && quote !== "'") return null
  const multiline = source.slice(start, start + 3) === quote.repeat(3)
  const delimiterLength = multiline ? 3 : 1
  let i = start + delimiterLength
  let value = ''

  while (i < source.length) {
    if (multiline && source.slice(i, i + 3) === quote.repeat(3)) {
      return { value, end: i + 3 }
    }
    if (!multiline && source[i] === quote) return { value, end: i + 1 }
    if (!multiline && source[i] === '\n') return null
    if (quote === '"' && source[i] === '\\' && i + 1 < source.length) {
      value += source[i]
      value += source[i + 1]
      i += 2
      continue
    }
    value += source[i]
    i += 1
  }
  return null
}

function readTomlKey(source, start) {
  if (source[start] === '"' || source[start] === "'") {
    const string = readTomlString(source, start)
    return string && { key: string.value, end: string.end }
  }
  const match = /^[A-Za-z0-9_-]+/.exec(source.slice(start))
  return match && { key: match[0], end: start + match[0].length }
}

function readTomlTableHeader(source, start) {
  const arrayTable = source.slice(start, start + 2) === '[['
  let i = start + (arrayTable ? 2 : 1)
  i = skipHorizontalSpace(source, i)
  const firstKey = readTomlKey(source, i)
  if (!firstKey) return null

  const closing = arrayTable ? ']]' : ']'
  i = firstKey.end
  while (i < source.length && source[i] !== '\n') {
    if (source[i] === '"' || source[i] === "'") {
      const string = readTomlString(source, i)
      if (!string) return null
      i = string.end
      continue
    }
    if (source.slice(i, i + closing.length) === closing) {
      return { firstKey: firstKey.key, end: i + closing.length }
    }
    i += 1
  }
  return null
}

function inlineHooksValueContains(source, start) {
  if (source[start] !== '[' && source[start] !== '{') return false
  const stack = []
  let i = start

  while (i < source.length) {
    if (source[i] === '#') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (source[i] === '"' || source[i] === "'") {
      const string = readTomlString(source, i)
      if (!string) return false
      const after = skipHorizontalSpace(source, string.end)
      if (string.value === 'command' && source[after] === '=') {
        const valueStart = skipHorizontalSpace(source, after + 1)
        const value = readTomlString(source, valueStart)
        if (value && isHookCommand(value.value)) return true
      }
      i = string.end
      continue
    }
    if (source[i] === '[' || source[i] === '{') {
      stack.push(source[i])
      i += 1
      continue
    }
    if (source[i] === ']' || source[i] === '}') {
      const expected = source[i] === ']' ? '[' : '{'
      if (stack.pop() !== expected) return false
      i += 1
      if (stack.length === 0) return false
      continue
    }

    const key = readTomlKey(source, i)
    if (key) {
      const after = skipHorizontalSpace(source, key.end)
      if (key.key === 'command' && source[after] === '=') {
        const valueStart = skipHorizontalSpace(source, after + 1)
        const value = readTomlString(source, valueStart)
        if (value && isHookCommand(value.value)) return true
      }
      i = key.end
      continue
    }
    i += 1
  }
  return false
}

function tomlContains(path) {
  const source = readConfig(path)
  if (source === null) return false

  let i = 0
  let lineStart = true
  let tableFirstKey = null
  while (i < source.length) {
    if (source[i] === '\n') {
      lineStart = true
      i += 1
      continue
    }
    if (source[i] === ' ' || source[i] === '\t' || source[i] === '\r') {
      i += 1
      continue
    }
    if (source[i] === '#') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }

    if (lineStart && source[i] === '[') {
      const header = readTomlTableHeader(source, i)
      if (header) {
        tableFirstKey = header.firstKey
        lineStart = false
        i = header.end
        continue
      }
    }
    lineStart = false

    if (source[i] === '"' || source[i] === "'") {
      const string = readTomlString(source, i)
      if (!string) return false
      const after = skipHorizontalSpace(source, string.end)
      if (tableFirstKey === 'hooks' && string.value === 'command' && source[after] === '=') {
        const valueStart = skipHorizontalSpace(source, after + 1)
        const value = readTomlString(source, valueStart)
        if (value && isHookCommand(value.value)) return true
      }
      i = string.end
      continue
    }

    const key = readTomlKey(source, i)
    if (key) {
      const after = skipHorizontalSpace(source, key.end)
      if (tableFirstKey === 'hooks' && key.key === 'command' && source[after] === '=') {
        const valueStart = skipHorizontalSpace(source, after + 1)
        const value = readTomlString(source, valueStart)
        if (value && isHookCommand(value.value)) return true
      }
      if (tableFirstKey === null && key.key === 'hooks' && source[after] === '=') {
        const valueStart = skipHorizontalSpace(source, after + 1)
        if (inlineHooksValueContains(source, valueStart)) return true
      }
      i = key.end
      continue
    }

    i += 1
  }
  return false
}

let found
if (host === 'codex') {
  found = jsonContains(join(root, '.codex', 'hooks.json')) || tomlContains(join(root, '.codex', 'config.toml'))
} else if (host === 'claude') {
  found = jsonContains(join(root, '.claude', 'settings.json')) || jsonContains(join(root, '.claude', 'settings.local.json'))
} else if (host === 'antigravity') {
  found = jsonContains(join(root, '.agents', 'hooks.json'))
} else if (host === 'muse') {
  found = false
} else if (host === 'opencode') {
  // opencode lifecycle은 프로젝트 adapter 자체가 소유한다. Claude/Codex 로컬
  // 설정은 다른 host의 중복 배선이므로 opencode 이벤트를 억제하면 안 된다.
  found = false
} else {
  process.stderr.write(`unsupported state-ledger host: ${host}\n`)
  process.exit(2)
}

process.exit(found ? 0 : 1)
