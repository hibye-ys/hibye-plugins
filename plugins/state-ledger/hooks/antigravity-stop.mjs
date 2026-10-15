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

  let reminderMsg = ''
  // stop-state-reminder는 이번 턴에 새로 생긴 항목(새 debt·덧붙임·이번 턴 STATE 구조 경고)이
  // 있을 때만 stateLedgerContinue=true를 낸다. 이전 턴에서 이월된 debt·엔진 오류·정보성 알림만
  // 남았으면 에이전트를 강제로 이어 돌리지 않는다. 필드가 없는 이전 버전 출력은 기존처럼 continue.
  let wantsContinue = true
  if (stopOut) {
    try {
      const parsed = JSON.parse(stopOut)
      reminderMsg = parsed?.systemMessage || parsed?.hookSpecificOutput?.additionalContext || ''
      if (parsed?.stateLedgerContinue === false) wantsContinue = false
    } catch {
      reminderMsg = stopOut
    }
  }

  if (reminderMsg && reminderMsg.trim() && wantsContinue) {
    try {
      writeFileSync(flagFile, '1')
    } catch {}
    process.stdout.write(
      JSON.stringify({
        decision: 'continue',
        reason: 'STATE 알림:\n' + reminderMsg.trim(),
      }) + '\n',
    )
  } else {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n')
  }
}

main()
