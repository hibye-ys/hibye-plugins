#!/usr/bin/env node
/**
 * Codex SessionStart 훅이 프로젝트에 실제로 설치돼 있는지 판정한다.
 *
 * Codex 는 훅을 `.codex/hooks.json` 또는 `.codex/config.toml` 의 inline
 * `[[hooks.SessionStart.hooks]]` 중 하나로 선언한다. 둘을 함께 두면 Codex 가
 * merge 하며 경고하므로 선언한 소스를 전부 출력하고 판정은 호출자가 한다.
 *
 * 출력: 훅을 선언한 소스 경로를 한 줄에 하나씩 (없으면 빈 출력).
 *
 * 경계 — 이건 shell 파서가 아니다. command 안에서 profiler 경로 토큰을 찾아
 * 그 앞 접두사만 본다. 리터럴 절대경로면 프로젝트 아래여야 하고, shell 확장
 * (`$(git rev-parse --show-toplevel)/`, `$CLAUDE_PROJECT_DIR/`) 이나 상대경로는
 * 인정한다. 목적은 "다른 절대경로를 가리켜 훅이 조용히 안 도는" 상태를 잡는
 * 것이지 임의의 shell 을 평가하는 게 아니다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MARKER = '.agents/hooks/session-start-profiler.mjs'
const TOKEN_DELIMITERS = new Set([' ', '\t', '"', "'", '=', ';', '&', '|'])

function parseArgs(argv) {
  let project = null
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') {
      project = argv[i + 1]
      i += 1
    }
  }
  if (!project) {
    process.stderr.write('usage: detect-codex-hook.mjs --project <repo>\n')
    process.exit(2)
  }
  return resolve(project)
}

function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * command 가 이 프로젝트의 profiler 를 가리키는가.
 * 같은 접미사로 끝나는 남의 절대경로는 거부한다.
 */
function declaresProfiler(command, project) {
  if (typeof command !== 'string') return false
  for (let at = command.indexOf(MARKER); at !== -1; at = command.indexOf(MARKER, at + 1)) {
    let start = at
    while (start > 0 && !TOKEN_DELIMITERS.has(command[start - 1])) start -= 1
    const prefix = command.slice(start, at)
    if (!prefix.startsWith('/') || prefix === `${project}/`) return true
  }
  return false
}

function commandsFromHooksJson(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const rows = data?.hooks?.SessionStart ?? []
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => (Array.isArray(row?.hooks) ? row.hooks : [])).map((hook) => hook?.command)
}

/**
 * `[[hooks.SessionStart.hooks]]` 테이블 안의 command 값만 수집한다.
 * TOML 은 bare key 와 quoted key 를 모두 허용하므로 셋 다 인정한다.
 */
function commandsFromConfigToml(text) {
  const HEADER = /^\[+([^\]]+)\]+\s*(?:#.*)?$/
  const COMMAND_KEY = /^\s*(?:command|"command"|'command')\s*=\s*(.*)$/
  const commands = []
  let inSessionStartHook = false

  for (const line of text.split(/\r?\n/)) {
    const header = HEADER.exec(line.trim())
    if (header) {
      inSessionStartHook = header[1].trim() === 'hooks.SessionStart.hooks'
      continue
    }
    if (!inSessionStartHook) continue
    const match = COMMAND_KEY.exec(line)
    if (match) commands.push(unquote(match[1].trim()))
  }
  return commands
}

function unquote(raw) {
  const quote = raw[0]
  if ((quote === '"' || quote === "'") && raw.endsWith(quote) && raw.length > 1) {
    return raw.slice(1, -1)
  }
  return raw
}

function main() {
  const project = parseArgs(process.argv.slice(2))
  const sources = [
    { path: '.codex/hooks.json', extract: commandsFromHooksJson },
    { path: '.codex/config.toml', extract: commandsFromConfigToml },
  ]

  for (const { path, extract } of sources) {
    const text = readOrNull(resolve(project, path))
    if (text === null) continue
    if (extract(text).some((command) => declaresProfiler(command, project))) {
      process.stdout.write(`${path}\n`)
    }
  }
}

main()
