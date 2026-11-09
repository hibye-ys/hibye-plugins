'use strict'
// Project-owned skill copies from plugin templates.
// The plugin ships templates/skills/<name>/SKILL.md only; a project keeps its own
// .agents/skills/<name>/SKILL.md plus the pristine copy it started from (.template-base.md).
// A template_version bump is merged three-way into the project copy. On conflict the base
// stays put and the new template waits in .template-pending.json: the next update raises the
// base once the conflict is resolved, or drops the pending template and merges again when the
// copy was reverted to its pre-merge content.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')

// `=======` doubles as a Markdown heading underline, so it is not checked.
const CONFLICT_RE = /^(<{7}|\|{7}|>{7})( |$)/m
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function templatesRoot(env = process.env) {
  return env.PROJECT_CONTEXT_TEMPLATES_DIR || path.resolve(__dirname, '../templates/skills')
}
function templateVersion(text) {
  const front = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, '\n'))
  const match = front && /^\s*template_version:\s*"?(\d+)"?\s*$/m.exec(front[1])
  return match ? Number(match[1]) : null
}
function sha256(text) { return createHash('sha256').update(text).digest('hex') }
function templateNames(env = process.env) {
  const root = templatesRoot(env)
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root).filter(name => NAME_RE.test(name) && fs.existsSync(path.join(root, name, 'SKILL.md'))).sort()
}
function paths(repoRoot, name) {
  if (!NAME_RE.test(name)) throw new Error(`invalid skill name ${name}`)
  const rel = path.join('.agents', 'skills', name)
  const dir = path.join(repoRoot, rel)
  return { rel, dir, skill: path.join(dir, 'SKILL.md'), base: path.join(dir, '.template-base.md'), pending: path.join(dir, '.template-pending.json') }
}
function read(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null }

function skillStatus(repoRoot, name, env = process.env) {
  const templateFile = path.join(templatesRoot(env), name, 'SKILL.md')
  if (!fs.existsSync(templateFile)) throw new Error(`no template ${name}`)
  const p = paths(repoRoot, name)
  const template = fs.readFileSync(templateFile, 'utf8')
  const skill = read(p.skill)
  const base = read(p.base)
  const pendingText = read(p.pending)
  const pending = pendingText === null ? null : JSON.parse(pendingText)
  return {
    name, template, skill, base, pending, templateFile,
    installed: skill !== null,
    hasBase: base !== null,
    baseVersion: base === null ? null : templateVersion(base),
    templateVersion: templateVersion(template),
    pendingVersion: pending === null ? null : templateVersion(pending.template),
    locallyModified: skill !== null && base !== null && skill !== base,
  }
}

function linkForClaude(repoRoot, name) {
  const p = paths(repoRoot, name)
  const skills = path.join(repoRoot, '.claude', 'skills')
  const entry = path.join(skills, name)
  let note = 'kept'
  try {
    let info = null
    try { info = fs.lstatSync(skills) } catch {}
    // A .claude/skills symlink (pointing at .agents/skills) is left alone; only the result is checked.
    if (!(info && info.isSymbolicLink())) {
      fs.mkdirSync(skills, { recursive: true })
      let exists = true
      try { fs.lstatSync(entry) } catch { exists = false }
      if (!exists) { fs.symlinkSync(path.join('..', '..', '.agents', 'skills', name), entry); note = 'linked' }
    }
    if (fs.realpathSync(entry) === fs.realpathSync(p.dir)) return `${note}: .claude/skills/${name} -> ${p.rel}`
  } catch {}
  return `WARN: .claude/skills/${name} 가 ${p.rel} 를 가리키지 않는다 — Claude 는 이 사본을 읽지 못한다. 그 자리의 기존 폴더·링크를 확인한다`
}

function installSkill(repoRoot, name, env = process.env) {
  const s = skillStatus(repoRoot, name, env)
  const p = paths(repoRoot, name)
  const lines = []
  if (s.installed) lines.push(`kept: ${p.rel}/SKILL.md 가 이미 있다 — 덮어쓰지 않는다. 갱신은 update 를 쓴다`)
  else {
    fs.mkdirSync(p.dir, { recursive: true })
    fs.writeFileSync(p.skill, s.template)
    fs.writeFileSync(p.base, s.template)
    lines.push(`installed: ${p.rel} v${s.templateVersion}`)
  }
  lines.push(linkForClaude(repoRoot, name))
  return lines
}

function settlePending(s, p, lines) {
  if (s.pending === null) return
  if (sha256(s.skill) === s.pending.premergeSha256) {
    // The conflicted copy was reverted, so the pending template never landed: merge it again.
    fs.rmSync(p.pending, { force: true })
    lines.push(`pending dropped: 사본이 병합 전으로 돌아가 v${s.pendingVersion} 을 다시 병합한다`)
    return
  }
  fs.writeFileSync(p.base, s.pending.template)
  fs.rmSync(p.pending, { force: true })
  lines.push(`resolved: 충돌을 푼 사본을 받아들이고 기준을 v${s.pendingVersion} 로 올린다`)
}

function updateSkill(repoRoot, name, env = process.env) {
  const p = paths(repoRoot, name)
  let s = skillStatus(repoRoot, name, env)
  if (!s.installed) throw new Error(`${p.rel}/SKILL.md 가 없다 — install 을 먼저 쓴다`)
  if (!s.hasBase || s.baseVersion === null) throw new Error(`${p.rel}/.template-base.md 가 없거나 버전이 없다 — 병합 기준을 사용자와 정한다`)
  if (CONFLICT_RE.test(s.skill)) throw new Error('SKILL.md 에 풀리지 않은 병합 충돌 표시가 있다 — 먼저 푼다')
  if ([s.skill, s.base, s.template].some(text => text.includes('\r'))) throw new Error('CRLF 줄바꿈이 섞여 있다 — 사본·기준·템플릿을 LF 로 맞춘 뒤 갱신한다')
  const lines = []
  settlePending(s, p, lines)
  s = skillStatus(repoRoot, name, env)
  if (s.templateVersion < s.baseVersion) throw new Error(`템플릿(v${s.templateVersion})이 기준(v${s.baseVersion})보다 낮다 — 플러그인 설치 버전을 확인한다`)
  if (s.templateVersion === s.baseVersion) {
    lines.push(s.template !== s.base ? `up-to-date: v${s.baseVersion} (템플릿 내용이 기준과 다르지만 버전이 같다 — 템플릿 버전을 올린 뒤 갱신한다)` : `up-to-date: v${s.baseVersion}`)
    return lines
  }
  const premergeSha256 = sha256(s.skill)
  const next = path.join(p.dir, '.template-next.md')
  fs.writeFileSync(next, s.template)
  let merged
  try {
    merged = spawnSync('git', ['merge-file', '--diff3',
      '-L', '프로젝트', '-L', `템플릿 v${s.baseVersion}`, '-L', `템플릿 v${s.templateVersion}`,
      p.skill, p.base, next], { encoding: 'utf8' })
    if (merged.status === null || merged.status >= 128) throw new Error(`git merge-file 실패: ${merged.stderr || merged.error}`)
    if (merged.status === 0) fs.writeFileSync(p.base, s.template)
    else fs.writeFileSync(p.pending, `${JSON.stringify({ template: s.template, premergeSha256 })}\n`)
  } finally { fs.rmSync(next, { force: true }) }
  lines.push(`merged: v${s.baseVersion} -> v${s.templateVersion}, 충돌 ${merged.status}곳`)
  if (merged.status > 0) lines.push(`${p.rel}/SKILL.md 의 <<<<<<< ~ >>>>>>> 구간을 사용자와 정해 푼 뒤 update 를 다시 실행하고 커밋한다. 기준은 그때 v${s.templateVersion} 로 오른다`)
  return lines
}

function skillDiff(repoRoot, name, env = process.env) {
  const s = skillStatus(repoRoot, name, env)
  if (!s.hasBase) throw new Error(`${paths(repoRoot, name).rel}/.template-base.md 가 없다`)
  return spawnSync('git', ['diff', '--no-index', '--', paths(repoRoot, name).base, s.templateFile], { encoding: 'utf8' }).stdout
}

// One line per project copy with an unresolved merge or a merge base behind the bundled template.
function templateNotices(repoRoot, env = process.env) {
  const lines = []
  for (const name of templateNames(env)) {
    try {
      const s = skillStatus(repoRoot, name, env)
      if (s.pending !== null) { lines.push(`SKILL_TEMPLATE_UPDATE ${name}: 사본에 v${s.pendingVersion} 병합 충돌이 남아 있다. 충돌을 사용자와 정해 푼 뒤 setup-project-context 의 템플릿 갱신(update)을 다시 실행한다.`); continue }
      if (!s.hasBase || s.baseVersion === null || s.templateVersion === null) continue
      if (s.templateVersion > s.baseVersion) lines.push(`SKILL_TEMPLATE_UPDATE ${name}: 새 템플릿(v${s.templateVersion})이 있다. 이 프로젝트 사본의 기준은 v${s.baseVersion}이다. 변경을 사용자와 확인한 뒤 setup-project-context 의 템플릿 갱신으로 병합한다.`)
    } catch {}
  }
  return lines
}

function projectRoot(argv, env) {
  const i = argv.indexOf('--project')
  const start = i >= 0 && argv[i + 1] ? argv[i + 1] : (env.HOOK_PROJECT_DIR || process.cwd())
  return fs.realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: start, encoding: 'utf8' }).trim())
}

function runCli({ argv = process.argv.slice(2), env = process.env, writeStdout = v => process.stdout.write(v), writeStderr = v => process.stderr.write(v) } = {}) {
  const [command, name] = argv
  try {
    const root = projectRoot(argv, env)
    if (command === 'list') { writeStdout(`${templateNames(env).join('\n')}\n`); return 0 }
    if (command === 'notice') { const lines = templateNotices(root, env); if (lines.length) writeStdout(`${lines.join('\n')}\n`); return 0 }
    if (!name || name.startsWith('--')) throw new Error('skill name required')
    if (command === 'status') {
      const s = skillStatus(root, name, env)
      writeStdout(`${JSON.stringify({ name, installed: s.installed, baseVersion: s.baseVersion, templateVersion: s.templateVersion, pendingVersion: s.pendingVersion, locallyModified: s.locallyModified })}\n`)
    } else if (command === 'install') writeStdout(`${installSkill(root, name, env).join('\n')}\n`)
    else if (command === 'update') writeStdout(`${updateSkill(root, name, env).join('\n')}\n`)
    else if (command === 'diff') writeStdout(skillDiff(root, name, env))
    else { writeStderr('usage: skill-template <list|notice|status|install|diff|update> [skill] [--project <path>]\n'); return 2 }
    return 0
  } catch (error) { writeStderr(`${error.message}\n`); return 1 }
}

module.exports = { templateVersion, templateNames, skillStatus, installSkill, updateSkill, skillDiff, templateNotices, runCli }
if (require.main === module) process.exitCode = runCli()
