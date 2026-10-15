#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n')
    return
  }

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
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n')
    return
  }

  const hasState = existsSync(path.join(repoRoot, 'STATE.md')) || existsSync(path.join(repoRoot, '.staterc'))
  if (!hasState) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n')
    return
  }

  // Prevent infinite deadlock: if already re-entered (executionNum > 1) or flagged, allow stop
  const sid = j.conversationId || j.session_id || 'default'
  const executionNum = Number(j.executionNum || 1)
  const flagFile = path.join(tmpdir(), `antigravity-state-stop-${sid}.flag`)

  if (executionNum > 1 || existsSync(flagFile)) {
    try {
      unlinkSync(flagFile)
    } catch {}
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n')
    return
  }

  const normalized = {
    session_id: sid,
    sessionID: sid,
    conversationId: sid,
    stop_hook_active: false,
  }

  let stopOut = ''
  try {
    const res = spawnSync('bash', [DISPATCH, 'stop'], {
      cwd: repoRoot,
      env: { ...process.env, STATE_LEDGER_HOST: 'antigravity', HOOK_PROJECT_DIR: repoRoot },
      input: JSON.stringify(normalized),
      encoding: 'utf8',
    })
    stopOut = (res.stdout || '').trim()
  } catch {}

  // stop-state-reminder는 이번 턴 알림(태그 없는 커밋·덧붙임·크기 외 구조 경고)이 있을 때만
  // stateLedgerContinue=true를 낸다. 엔진 오류·동시 세션 보류·크기 경고만 있으면 continue하지 않는다.
  let reminderMsg = ''
  let wantsContinue = false
  if (stopOut) {
    try {
      const parsed = JSON.parse(stopOut)
      reminderMsg = typeof parsed?.systemMessage === 'string' ? parsed.systemMessage.trim() : ''
      wantsContinue = parsed?.stateLedgerContinue === true
    } catch {}
  }

  if (reminderMsg && wantsContinue) {
    try {
      writeFileSync(flagFile, '1')
    } catch {}
    process.stdout.write(
      JSON.stringify({
        decision: 'continue',
        reason: 'STATE 알림:\n' + reminderMsg,
      }) + '\n',
    )
  } else {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n')
  }
}

main()
