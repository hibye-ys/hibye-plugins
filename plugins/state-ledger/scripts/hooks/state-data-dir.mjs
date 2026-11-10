#!/usr/bin/env node

// 훅 데이터 폴더(repo 밖): 턴 기준점·세션 root 고정(pin)·독립 검증 상태와 job 폴더.
// 기본값은 사용자별 경로다 — Linux 처럼 TMPDIR 없이 공유 /tmp 를 쓰는 머신에서 다른 로컬 사용자가
// 같은 이름의 폴더나 심링크를 미리 만들어 두면 그 안에서 읽고·쓰고·지우게 되는 것을 막는다.
// global-state-hook.sh 의 pin 폴더도 같은 경로 규칙을 쓴다(`${STATE_HOOK_DATA_DIR:-${TMPDIR%/}/state-ledger-hooks-$(id -u)}`).

import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null
}

export function dataDirectory() {
  if (process.env.STATE_HOOK_DATA_DIR) return resolve(process.env.STATE_HOOK_DATA_DIR)
  const uid = currentUid()
  return resolve(join(tmpdir(), uid === null ? 'state-ledger-hooks' : `state-ledger-hooks-${uid}`))
}

// `directory` 가 없으면 0700 으로 만든다. 그 자리가 심링크가 아닌 실제 폴더이고 이 사용자 소유일 때만 true 를 돌려주며,
// group·other 권한 비트가 있으면 0700 으로 좁힌다. false 면 호출자는 그 안에서 읽기·쓰기·정리를 하지 않는다.
// 마지막 경로 성분만 lstat 하므로 /tmp → /private/tmp 같은 상위 심링크는 문제 삼지 않는다.
export function ensureOwnedPrivateDirectory(directory) {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') return false
  }
  let info
  try {
    info = lstatSync(directory)
  } catch {
    return false
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return false
  const uid = currentUid()
  if (uid !== null && info.uid !== uid) return false
  if ((info.mode & 0o077) !== 0) {
    try {
      chmodSync(directory, 0o700)
    } catch {
      return false
    }
  }
  return true
}

// 데이터 폴더 아래 하위 폴더(예: verify-jobs)도 같은 검사를 거친다. 상위가 통과하지 못하면 하위도 쓰지 않는다.
export function ensureOwnedPrivateSubdirectory(name) {
  const base = dataDirectory()
  if (!ensureOwnedPrivateDirectory(base)) return null
  const directory = join(base, name)
  return ensureOwnedPrivateDirectory(directory) ? directory : null
}
