#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

  // Resolve existing workspace directory
  let workspaceRoot = ''
  if (Array.isArray(j.workspacePaths)) {
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

  // Find git repo root
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

  const sid = j.conversationId || j.session_id || j.sessionId || 'default'
  const normalizedInput = JSON.stringify({
    session_id: sid,
    sessionID: sid,
    conversationId: sid,
    workspacePaths: [repoRoot],
  })

  // 1. Snapshot turn start
  try {
    spawnSync('bash', [DISPATCH, 'turn-start'], {
      cwd: repoRoot,
      env: { ...process.env, STATE_LEDGER_HOST: 'antigravity', HOOK_PROJECT_DIR: repoRoot },
      input: normalizedInput,
      encoding: 'utf8',
    })
  } catch {}

  // 2. Inject session start context on first invocation of conversation
  const invocationNum = Number(j.invocationNum || 1)
  const sessionFlag = path.join(tmpdir(), `antigravity-session-inject-${sid}.flag`)
  const isFirstInvocation = invocationNum <= 1 || !existsSync(sessionFlag)

  let injectText = ''
  if (isFirstInvocation) {
    try {
      writeFileSync(sessionFlag, '1')
    } catch {}

    try {
      const sessionRes = spawnSync('bash', [DISPATCH, 'session-start'], {
        cwd: repoRoot,
        env: { ...process.env, STATE_LEDGER_HOST: 'antigravity', HOOK_PROJECT_DIR: repoRoot },
        input: normalizedInput,
        encoding: 'utf8',
      })
      const out = (sessionRes.stdout || '').trim()
      if (out) {
        try {
          const parsed = JSON.parse(out)
          injectText = parsed?.hookSpecificOutput?.additionalContext
            || parsed?.systemMessage
            || (typeof parsed === 'string' ? parsed : '')
        } catch {
          injectText = out
        }
      }
    } catch {}

    // Query project session-start-context if present
    const projectHook = path.join(repoRoot, '.agents/hooks/session-start-context.mjs')
    if (existsSync(projectHook)) {
      try {
        const projRes = spawnSync(process.execPath, [projectHook], {
          cwd: repoRoot,
          env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot, HOOK_PROJECT_DIR: repoRoot },
          encoding: 'utf8',
        })
        const pOut = (projRes.stdout || '').trim()
        if (pOut) {
          let pText = ''
          try {
            const parsed = JSON.parse(pOut)
            pText = parsed?.hookSpecificOutput?.additionalContext || parsed?.systemMessage || ''
          } catch {
            pText = pOut
          }
          if (pText) {
            injectText = injectText ? `${injectText}\n\n---\n\n${pText}` : pText
          }
        }
      } catch {}
    }
  }

  if (injectText) {
    const result = {
      injectSteps: [
        {
          ephemeralMessage: injectText,
        },
      ],
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } else {
    process.stdout.write('{}\n')
  }
}

main()
