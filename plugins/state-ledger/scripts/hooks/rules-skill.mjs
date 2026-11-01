#!/usr/bin/env node
// state-ledger-rules 스킬 템플릿 복사·갱신.
// 플러그인은 templates/skills/state-ledger-rules/ 템플릿만 갖고, 프로젝트는 .agents/skills/state-ledger-rules/에
// 자기 사본(SKILL.md)과 복사 당시 원본(.template-base.md)을 둔다. 템플릿 버전이 오르면 세 판을 3-way 병합한다.
// 충돌이 나면 기준은 그대로 두고 새 템플릿을 .template-pending.json 에 보류한다 — 충돌을 풀면 다음 update 가
// 기준을 올리고, 충돌난 사본을 병합 전으로 되돌렸으면 보류를 버리고 다시 병합한다.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot } from './state-config.mjs'

export const SKILL_NAME = 'state-ledger-rules'
export const PROJECT_SKILL_DIR = join('.agents', 'skills', SKILL_NAME)
const DEFAULT_TEMPLATE_DIR = fileURLToPath(new URL(`../../templates/skills/${SKILL_NAME}`, import.meta.url))
// `=======` 은 Markdown 제목 밑줄과 겹치므로 보지 않는다.
const CONFLICT_RE = /^(<{7}|\|{7}|>{7})( |$)/m

function templateDir() {
  return process.env.STATE_RULES_TEMPLATE_DIR || DEFAULT_TEMPLATE_DIR
}

export function templateVersion(text) {
  const front = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, '\n'))
  const match = front && /^\s*template_version:\s*"?(\d+)"?\s*$/m.exec(front[1])
  return match ? Number(match[1]) : null
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function paths(root) {
  const dir = join(root, PROJECT_SKILL_DIR)
  return { dir, skill: join(dir, 'SKILL.md'), base: join(dir, '.template-base.md'), pending: join(dir, '.template-pending.json') }
}

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

export function rulesStatus(root) {
  const p = paths(root)
  const template = readFileSync(join(templateDir(), 'SKILL.md'), 'utf8')
  const skill = read(p.skill)
  const base = read(p.base)
  const pendingText = read(p.pending)
  const pending = pendingText === null ? null : JSON.parse(pendingText)
  return {
    installed: skill !== null,
    hasBase: base !== null,
    baseVersion: base === null ? null : templateVersion(base),
    templateVersion: templateVersion(template),
    pendingVersion: pending === null ? null : templateVersion(pending.template),
    locallyModified: skill !== null && base !== null && skill !== base,
    template,
    skill,
    base,
    pending,
  }
}

function linkForClaude(root) {
  const p = paths(root)
  const skills = join(root, '.claude', 'skills')
  const entry = join(skills, SKILL_NAME)
  let note = 'kept'
  try {
    let info = null
    try { info = lstatSync(skills) } catch {}
    // .claude/skills 자체가 심링크(.agents/skills 를 가리키는 구성)면 그대로 두고 결과만 확인한다.
    if (!info?.isSymbolicLink()) {
      mkdirSync(skills, { recursive: true })
      let exists = true
      try { lstatSync(entry) } catch { exists = false }
      if (!exists) {
        symlinkSync(join('..', '..', PROJECT_SKILL_DIR), entry)
        note = 'linked'
      }
    }
    if (realpathSync(entry) === realpathSync(p.dir)) return `${note}: .claude/skills/${SKILL_NAME} -> ${PROJECT_SKILL_DIR}`
  } catch {}
  return `WARN: .claude/skills/${SKILL_NAME} 가 ${PROJECT_SKILL_DIR} 를 가리키지 않는다 — Claude 는 이 사본을 읽지 못한다. 그 자리의 기존 폴더·링크를 확인한다`
}

export function installRules(root) {
  const s = rulesStatus(root)
  const p = paths(root)
  const lines = []
  if (s.installed) {
    lines.push(`kept: ${PROJECT_SKILL_DIR}/SKILL.md 가 이미 있다 — 덮어쓰지 않는다. 갱신은 update 를 쓴다`)
  } else {
    mkdirSync(p.dir, { recursive: true })
    writeFileSync(p.skill, s.template)
    writeFileSync(p.base, s.template)
    lines.push(`installed: ${PROJECT_SKILL_DIR} v${s.templateVersion}`)
  }
  lines.push(linkForClaude(root))
  return lines
}

function settlePending(s, p, lines) {
  if (s.pending === null) return
  if (sha256(s.skill) === s.pending.premergeSha256) {
    // 충돌난 사본을 병합 전으로 되돌렸다. 보류한 템플릿은 아직 반영되지 않았으므로 다시 병합한다.
    rmSync(p.pending, { force: true })
    lines.push(`pending dropped: 사본이 병합 전으로 돌아가 v${s.pendingVersion} 을 다시 병합한다`)
    return
  }
  writeFileSync(p.base, s.pending.template)
  rmSync(p.pending, { force: true })
  lines.push(`resolved: 충돌을 푼 사본을 받아들이고 기준을 v${s.pendingVersion} 로 올린다`)
}

export function updateRules(root) {
  const p = paths(root)
  let s = rulesStatus(root)
  if (!s.installed) throw new Error(`${PROJECT_SKILL_DIR}/SKILL.md 가 없다 — install 을 먼저 쓴다`)
  if (!s.hasBase || s.baseVersion === null) throw new Error(`${PROJECT_SKILL_DIR}/.template-base.md 가 없거나 버전이 없다 — 병합 기준을 사용자와 정한다`)
  if (CONFLICT_RE.test(s.skill)) throw new Error('SKILL.md 에 풀리지 않은 병합 충돌 표시가 있다 — 먼저 푼다')
  if ([s.skill, s.base, s.template].some((text) => text.includes('\r'))) throw new Error('CRLF 줄바꿈이 섞여 있다 — 사본·기준·템플릿을 LF 로 맞춘 뒤 갱신한다')
  const lines = []
  settlePending(s, p, lines)
  s = rulesStatus(root)
  if (s.templateVersion < s.baseVersion) throw new Error(`템플릿(v${s.templateVersion})이 기준(v${s.baseVersion})보다 낮다 — 플러그인 설치 버전을 확인한다`)
  if (s.templateVersion === s.baseVersion) {
    if (s.template !== s.base) lines.push(`up-to-date: v${s.baseVersion} (템플릿 내용이 기준과 다르지만 버전이 같다 — 템플릿 버전을 올린 뒤 갱신한다)`)
    else lines.push(`up-to-date: v${s.baseVersion}`)
    return lines
  }
  const premergeSha256 = sha256(s.skill)
  const next = join(p.dir, '.template-next.md')
  writeFileSync(next, s.template)
  let merged
  try {
    merged = spawnSync('git', [
      'merge-file', '--diff3',
      '-L', '프로젝트', '-L', `템플릿 v${s.baseVersion}`, '-L', `템플릿 v${s.templateVersion}`,
      p.skill, p.base, next,
    ], { encoding: 'utf8' })
    if (merged.status === null || merged.status >= 128) throw new Error(`git merge-file 실패: ${merged.stderr || merged.error}`)
    if (merged.status === 0) writeFileSync(p.base, s.template)
    else writeFileSync(p.pending, `${JSON.stringify({ template: s.template, premergeSha256 })}\n`)
  } finally {
    rmSync(next, { force: true })
  }
  lines.push(`merged: v${s.baseVersion} -> v${s.templateVersion}, 충돌 ${merged.status}곳`)
  if (merged.status > 0) {
    lines.push(`${PROJECT_SKILL_DIR}/SKILL.md 의 <<<<<<< ~ >>>>>>> 구간을 사용자와 정해 푼 뒤 update 를 다시 실행하고 커밋한다. 기준은 그때 v${s.templateVersion} 로 오른다`)
  }
  return lines
}

export function rulesDiff(root) {
  const s = rulesStatus(root)
  if (!s.hasBase) throw new Error(`${PROJECT_SKILL_DIR}/.template-base.md 가 없다`)
  const result = spawnSync('git', ['diff', '--no-index', '--', paths(root).base, join(templateDir(), 'SKILL.md')], { encoding: 'utf8' })
  return result.stdout
}

export function rulesNotice(root) {
  try {
    const s = rulesStatus(root)
    if (s.pending !== null) return `state-ledger-rules 사본에 v${s.pendingVersion} 병합 충돌이 남아 있다. 충돌을 사용자와 정해 푼 뒤 setup-state 의 템플릿 갱신(update)을 다시 실행한다.`
    if (!s.hasBase || s.baseVersion === null || s.templateVersion === null) return ''
    if (s.templateVersion <= s.baseVersion) return ''
    return `state-ledger-rules 새 템플릿(v${s.templateVersion})이 있다. 이 프로젝트 사본의 기준은 v${s.baseVersion}이다. 변경을 사용자와 확인한 뒤 setup-state 의 템플릿 갱신으로 병합한다.`
  } catch {
    return ''
  }
}

function main() {
  const command = process.argv[2]
  const root = projectRoot()
  try {
    if (command === 'status') {
      const s = rulesStatus(root)
      process.stdout.write(`${JSON.stringify({
        installed: s.installed,
        baseVersion: s.baseVersion,
        templateVersion: s.templateVersion,
        pendingVersion: s.pendingVersion,
        locallyModified: s.locallyModified,
      })}\n`)
    } else if (command === 'install') {
      process.stdout.write(`${installRules(root).join('\n')}\n`)
    } else if (command === 'update') {
      process.stdout.write(`${updateRules(root).join('\n')}\n`)
    } else if (command === 'diff') {
      process.stdout.write(rulesDiff(root))
    } else if (command === 'notice') {
      const line = rulesNotice(root)
      if (line) process.stdout.write(`${line}\n`)
    } else {
      process.stderr.write('usage: rules-skill.mjs status|install|diff|update|notice\n')
      process.exitCode = 2
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) main()
