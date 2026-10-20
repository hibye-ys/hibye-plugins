#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const LEDGER_ROOT = process.env.STATE_LEDGER_ROOT || path.resolve(SCRIPT_DIR, '..')
const DISPATCH = path.join(LEDGER_ROOT, 'scripts/hooks/global-state-hook.sh')

function main() {
  let input = ''
  try {
    input = readFileSync(0, 'utf8')
  } catch {}

  let j = {}
  try {
    j = JSON.parse(input || '{}')
  } catch {}
  if (j === null || typeof j !== 'object') j = {}

  if (!existsSync(DISPATCH)) {
    process.stdout.write('{}\n')
    return
  }

  const toolCall = j.toolCall || {}
  const args = toolCall.args || {}

  let workspaceRoot = ''
  if (args.Cwd && existsSync(args.Cwd)) {
    workspaceRoot = args.Cwd
  }
  if (!workspaceRoot && Array.isArray(j.workspacePaths)) {
    for (const p of j.workspacePaths) {
      if (p && typeof p === 'string' && existsSync(p)) {
        try {
          if (statSync(p).isDirectory()) {
            workspaceRoot = p
            break
          }
        } catch {}
      }
    }
  }
  if (!workspaceRoot && j.cwd && existsSync(j.cwd)) {
    workspaceRoot = j.cwd
  }
  if (!workspaceRoot) {
    workspaceRoot = process.cwd()
  }

  let repoRoot = ''
  try {
    const gitRes = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    })
    if (gitRes.status === 0 && gitRes.stdout) {
      repoRoot = gitRes.stdout.trim()
    }
  } catch {}

  if (!repoRoot || !existsSync(repoRoot)) {
    process.stdout.write('{}\n')
    return
  }

  const hasState = existsSync(path.join(repoRoot, 'STATE.md')) || existsSync(path.join(repoRoot, '.staterc'))
  if (!hasState) {
    process.stdout.write('{}\n')
    return
  }

  let targetFile = args.TargetFile || args.file_path || args.filePath || args.path || args.file || ''
  const command = args.CommandLine || args.command || ''

  if (!targetFile && command) {
    const stateMatch = /(?:^|[\s"'\\])(docs\/state\/[^\s"'\\]+\.md)/.exec(command)
    if (stateMatch) {
      targetFile = stateMatch[1]
    }
  }

  const sid = j.conversationId || j.session_id || j.sessionId || ''
  const normalized = {
    tool_name: toolCall.name || '',
    tool_input: {
      file_path: targetFile,
      command: command,
    },
    conversationId: sid,
    session_id: sid,
    sessionID: sid,
    stepIdx: j.stepIdx ?? 0,
  }

  // 1. Run stamp hook
  try {
    spawnSync('bash', [DISPATCH, 'stamp'], {
      cwd: repoRoot,
      env: { ...process.env, STATE_LEDGER_HOST: 'antigravity', HOOK_PROJECT_DIR: repoRoot },
      input: JSON.stringify(normalized),
      encoding: 'utf8',
    })
  } catch {}

  process.stdout.write('{}\n')
}

main()
