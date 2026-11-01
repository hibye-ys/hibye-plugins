import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const RULES_SCRIPT = fileURLToPath(new URL('./rules-skill.mjs', import.meta.url))
const SESSION_SCRIPT = fileURLToPath(new URL('./session-start-state-inject.sh', import.meta.url))
const BUNDLED_TEMPLATE = fileURLToPath(new URL('../../templates/skills/state-ledger-rules/SKILL.md', import.meta.url))
const SKILL = '.agents/skills/state-ledger-rules/SKILL.md'
const BASE = '.agents/skills/state-ledger-rules/.template-base.md'

function template(version, { cap = '6', archive = '사용자 확인 뒤 archive 한다.' } = {}) {
  return [
    '---',
    'name: state-ledger-rules',
    'description: test',
    'metadata:',
    '  template: state-ledger-rules',
    `  template_version: "${version}"`,
    '---',
    '',
    '# STATE',
    '',
    `- §1 활성 cap 은 ${cap} 이다.`,
    '',
    '- 커밋에는 [id=] 를 단다.',
    '',
    `- ${archive}`,
    '',
  ].join('\n')
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'rules-skill-'))
  const templates = mkdtempSync(join(tmpdir(), 'rules-template-'))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(templates, { recursive: true, force: true })
  })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  writeFileSync(join(root, 'STATE.md'), '## 1. 활성\n\n## 2. 다음\n\n## 3. 미래\n\n## 4. 미해결\n')
  const setTemplate = (text) => writeFileSync(join(templates, 'SKILL.md'), text)
  setTemplate(template(1))
  return { root, setTemplate, env: { ...process.env, HOOK_PROJECT_DIR: root, STATE_RULES_TEMPLATE_DIR: templates } }
}

function rules(env, ...args) {
  return spawnSync('node', [RULES_SCRIPT, ...args], { env, encoding: 'utf8' })
}

test('bundled template carries a template version', () => {
  assert.match(readFileSync(BUNDLED_TEMPLATE, 'utf8'), /^\s*template_version: "\d+"$/m)
})

test('install copies the template, keeps a merge base, and links it for Claude', (t) => {
  const { root, env } = fixture(t)
  const result = rules(env, 'install')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(root, SKILL), 'utf8'), template(1))
  assert.equal(readFileSync(join(root, BASE), 'utf8'), template(1))
  assert.equal(readlinkSync(join(root, '.claude/skills/state-ledger-rules')), '../../.agents/skills/state-ledger-rules')
  assert.equal(readFileSync(join(root, '.claude/skills/state-ledger-rules/SKILL.md'), 'utf8'), template(1))

  writeFileSync(join(root, SKILL), template(1, { cap: '3' }))
  const again = rules(env, 'install')
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /kept: .*이미 있다/)
  assert.equal(readFileSync(join(root, SKILL), 'utf8'), template(1, { cap: '3' }))
})

test('install leaves a .claude/skills symlink alone', (t) => {
  const { root, env } = fixture(t)
  mkdirSync(join(root, '.agents/skills'), { recursive: true })
  mkdirSync(join(root, '.claude'), { recursive: true })
  symlinkSync('../.agents/skills', join(root, '.claude/skills'))
  const result = rules(env, 'install')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /kept: \.claude\/skills\/state-ledger-rules -> /)
  assert.ok(lstatSync(join(root, '.claude/skills')).isSymbolicLink())
  assert.ok(existsSync(join(root, '.claude/skills/state-ledger-rules/SKILL.md')))
})

test('install warns when Claude would not read the copy, and a rerun finishes the link', (t) => {
  const { root, env } = fixture(t)
  mkdirSync(join(root, '.claude/skills/state-ledger-rules'), { recursive: true })
  assert.match(rules(env, 'install').stdout, /WARN: .*가리키지 않는다/)

  const broken = fixture(t)
  mkdirSync(join(broken.root, '.claude'), { recursive: true })
  symlinkSync('../nowhere', join(broken.root, '.claude/skills'))
  assert.match(rules(broken.env, 'install').stdout, /WARN: /)

  const file = fixture(t)
  mkdirSync(join(file.root, '.claude'), { recursive: true })
  writeFileSync(join(file.root, '.claude/skills'), '')
  const first = rules(file.env, 'install')
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /installed: .*\nWARN: /)
  rmSync(join(file.root, '.claude/skills'))
  assert.match(rules(file.env, 'install').stdout, /kept: .*이미 있다.*\nlinked: /)
})

test('update is a no-op at the same version and flags unversioned template edits', (t) => {
  const { root, env, setTemplate } = fixture(t)
  rules(env, 'install')
  assert.match(rules(env, 'update').stdout, /^up-to-date: v1$/m)
  setTemplate(template(1, { archive: '바뀐 문장.' }))
  assert.match(rules(env, 'update').stdout, /버전이 같다/)
  assert.equal(readFileSync(join(root, SKILL), 'utf8'), template(1))
})

test('update merges a template bump into a locally edited copy', (t) => {
  const { root, env, setTemplate } = fixture(t)
  rules(env, 'install')
  writeFileSync(join(root, SKILL), template(1, { cap: '3' }))
  setTemplate(template(2, { archive: '사용자 확인 뒤 archive 하고 참조를 정리한다.' }))

  assert.match(rules(env, 'notice').stdout, /새 템플릿\(v2\)이 있다\. 이 프로젝트 사본의 기준은 v1이다/)
  assert.match(rules(env, 'diff').stdout, /참조를 정리한다/)

  const result = rules(env, 'update')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /merged: v1 -> v2, 충돌 0곳/)
  assert.equal(readFileSync(join(root, SKILL), 'utf8'), template(2, { cap: '3', archive: '사용자 확인 뒤 archive 하고 참조를 정리한다.' }))
  assert.equal(readFileSync(join(root, BASE), 'utf8'), template(2, { archive: '사용자 확인 뒤 archive 하고 참조를 정리한다.' }))
  assert.equal(rules(env, 'notice').stdout, '')
  assert.ok(!existsSync(join(root, '.agents/skills/state-ledger-rules/.template-next.md')))
  assert.deepEqual(JSON.parse(rules(env, 'status').stdout), { installed: true, baseVersion: 2, templateVersion: 2, pendingVersion: null, locallyModified: true })
})

test('update leaves conflict markers when both sides changed the same line', (t) => {
  const { root, env, setTemplate } = fixture(t)
  rules(env, 'install')
  writeFileSync(join(root, SKILL), template(1, { cap: '3' }))
  setTemplate(template(2, { cap: '8' }))

  const result = rules(env, 'update')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /충돌 1곳/)
  const merged = readFileSync(join(root, SKILL), 'utf8')
  assert.match(merged, /<<<<<<< 프로젝트\n- §1 활성 cap 은 3 이다\.\n\|\|\|\|\|\|\| 템플릿 v1\n- §1 활성 cap 은 6 이다\.\n=======\n- §1 활성 cap 은 8 이다\.\n>>>>>>> 템플릿 v2/)

  assert.equal(readFileSync(join(root, BASE), 'utf8'), template(1))
  assert.match(rules(env, 'notice').stdout, /v2 병합 충돌이 남아 있다/)
  const again = rules(env, 'update')
  assert.equal(again.status, 1)
  assert.match(again.stderr, /충돌 표시/)

  writeFileSync(join(root, SKILL), template(2, { cap: '3' }))
  const resolved = rules(env, 'update')
  assert.equal(resolved.status, 0, resolved.stderr)
  assert.match(resolved.stdout, /resolved: .*\nup-to-date: v2/)
  assert.equal(readFileSync(join(root, BASE), 'utf8'), template(2, { cap: '8' }))
  assert.equal(readFileSync(join(root, SKILL), 'utf8'), template(2, { cap: '3' }))
  assert.equal(rules(env, 'notice').stdout, '')
})

test('a conflicted merge that is thrown away is offered again, not lost', (t) => {
  const { root, env, setTemplate } = fixture(t)
  rules(env, 'install')
  const local = template(1, { cap: '3' })
  writeFileSync(join(root, SKILL), local)
  setTemplate(template(2, { cap: '8', archive: '새 공통 문장.' }))
  assert.match(rules(env, 'update').stdout, /충돌 1곳/)

  writeFileSync(join(root, SKILL), local)
  assert.match(rules(env, 'notice').stdout, /병합 충돌이 남아 있다/)
  const retry = rules(env, 'update')
  assert.equal(retry.status, 0, retry.stderr)
  assert.match(retry.stdout, /pending dropped: .*\nmerged: v1 -> v2, 충돌 1곳/)
  assert.match(readFileSync(join(root, SKILL), 'utf8'), /새 공통 문장\./)
  assert.equal(readFileSync(join(root, BASE), 'utf8'), template(1))
})

test('update refuses CRLF files and leftover diff3 base markers', (t) => {
  const { root, env, setTemplate } = fixture(t)
  rules(env, 'install')
  setTemplate(template(2))
  writeFileSync(join(root, SKILL), template(1).replace(/\n/g, '\r\n'))
  const crlf = rules(env, 'update')
  assert.equal(crlf.status, 1)
  assert.match(crlf.stderr, /CRLF/)
  writeFileSync(join(root, SKILL), `${template(1)}||||||| 템플릿 v1\n`)
  assert.match(rules(env, 'update').stderr, /충돌 표시/)
})

test('SessionStart shows the template notice only while the copy is behind', (t) => {
  const { root, env, setTemplate } = fixture(t)
  rules(env, 'install')
  const session = () => spawnSync('bash', [SESSION_SCRIPT], { env, input: '{}', encoding: 'utf8' }).stdout
  assert.doesNotMatch(session(), /STATE 규칙 스킬/)
  setTemplate(template(2))
  assert.match(session(), /=== STATE 규칙 스킬 ===\\nstate-ledger-rules 새 템플릿\(v2\)/)
})
