'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync, spawnSync } = require('node:child_process')
const runtime = require('../scripts/project-context.cjs')
const SCRIPT = path.resolve(__dirname, '../scripts/skill-template.cjs')
const BUNDLED = path.resolve(__dirname, '../templates/skills')

function template(version, { folder = 'ops/contracts/', rule = '문서는 기록이다.' } = {}) {
  return ['---', 'name: docs-boundary', 'description: test', 'metadata:', '  template: docs-boundary', `  template_version: "${version}"`, '---', '',
    '# docs', '', `- 계약 폴더는 ${folder} 이다.`, '', '- 결정은 intent 에 둔다.', '', `- ${rule}`, ''].join('\n')
}
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-template-test-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const root = path.join(base, 'repo'); const templates = path.join(base, 'templates')
  fs.mkdirSync(root); fs.mkdirSync(path.join(templates, 'docs-boundary'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: root })
  fs.mkdirSync(path.join(root, 'intent'))
  fs.writeFileSync(path.join(root, '.project-context.json'), JSON.stringify({ schema_version: 1, memory: false, intent: { directory: 'intent' } }))
  const setTemplate = text => fs.writeFileSync(path.join(templates, 'docs-boundary', 'SKILL.md'), text)
  setTemplate(template(1))
  return { root, setTemplate, env: { ...process.env, PROJECT_CONTEXT_TEMPLATES_DIR: templates } }
}
const cli = (env, ...args) => spawnSync('node', [SCRIPT, ...args], { env, encoding: 'utf8' })
const SKILL = '.agents/skills/docs-boundary/SKILL.md'
const BASE = '.agents/skills/docs-boundary/.template-base.md'

test('bundled templates carry a template version and are not global skills', () => {
  for (const name of fs.readdirSync(BUNDLED)) assert.match(fs.readFileSync(path.join(BUNDLED, name, 'SKILL.md'), 'utf8'), /^\s*template_version: "\d+"$/m)
  assert.ok(!fs.existsSync(path.resolve(__dirname, '../skills/docs-boundary')))
})

test('install copies the template with a merge base and a Claude link, never overwriting', t => {
  const { root, env } = fixture(t)
  const result = cli(env, 'install', 'docs-boundary', '--project', root)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(path.join(root, SKILL), 'utf8'), template(1))
  assert.equal(fs.readFileSync(path.join(root, BASE), 'utf8'), template(1))
  assert.equal(fs.readlinkSync(path.join(root, '.claude/skills/docs-boundary')), '../../.agents/skills/docs-boundary')
  fs.writeFileSync(path.join(root, SKILL), template(1, { folder: 'x/' }))
  const again = cli(env, 'install', 'docs-boundary', '--project', root)
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /kept: .*이미 있다.*\nkept: \.claude\/skills\/docs-boundary -> /)
  assert.equal(fs.readFileSync(path.join(root, SKILL), 'utf8'), template(1, { folder: 'x/' }))
})

test('install warns when an existing .claude/skills entry hides the copy', t => {
  const { root, env } = fixture(t)
  fs.mkdirSync(path.join(root, '.claude/skills/docs-boundary'), { recursive: true })
  const result = cli(env, 'install', 'docs-boundary', '--project', root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /installed: .*\nWARN: .*가리키지 않는다/)
})

test('a template bump merges into a locally edited copy and SessionStart notices it until then', t => {
  const { root, env, setTemplate } = fixture(t)
  cli(env, 'install', 'docs-boundary', '--project', root)
  fs.writeFileSync(path.join(root, SKILL), template(1, { folder: 'packages/contracts/schema/' }))
  const context = () => runtime.buildSessionStartContext({ repoRoot: root, host: 'codex', env }).hookSpecificOutput.additionalContext
  assert.doesNotMatch(context(), /SKILL_TEMPLATE_UPDATE/)
  setTemplate(template(2, { rule: '문서는 기록이고 실행 입력이 아니다.' }))
  assert.match(context(), /SKILL_TEMPLATE_UPDATE docs-boundary: 새 템플릿\(v2\)이 있다\. 이 프로젝트 사본의 기준은 v1이다/)
  assert.match(cli(env, 'diff', 'docs-boundary', '--project', root).stdout, /실행 입력이 아니다/)

  const result = cli(env, 'update', 'docs-boundary', '--project', root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /merged: v1 -> v2, 충돌 0곳/)
  assert.equal(fs.readFileSync(path.join(root, SKILL), 'utf8'), template(2, { folder: 'packages/contracts/schema/', rule: '문서는 기록이고 실행 입력이 아니다.' }))
  assert.equal(fs.readFileSync(path.join(root, BASE), 'utf8'), template(2, { rule: '문서는 기록이고 실행 입력이 아니다.' }))
  assert.doesNotMatch(context(), /SKILL_TEMPLATE_UPDATE/)
  assert.deepEqual(JSON.parse(cli(env, 'status', 'docs-boundary', '--project', root).stdout), { name: 'docs-boundary', installed: true, baseVersion: 2, templateVersion: 2, pendingVersion: null, locallyModified: true })
})

test('same-line edits leave diff3 conflict markers and block another update', t => {
  const { root, env, setTemplate } = fixture(t)
  cli(env, 'install', 'docs-boundary', '--project', root)
  fs.writeFileSync(path.join(root, SKILL), template(1, { folder: 'a/' }))
  setTemplate(template(2, { folder: 'b/' }))
  assert.match(cli(env, 'update', 'docs-boundary', '--project', root).stdout, /충돌 1곳/)
  assert.match(fs.readFileSync(path.join(root, SKILL), 'utf8'), /<<<<<<< 프로젝트\n- 계약 폴더는 a\/ 이다\.\n\|\|\|\|\|\|\| 템플릿 v1\n- 계약 폴더는 ops\/contracts\/ 이다\.\n=======\n- 계약 폴더는 b\/ 이다\.\n>>>>>>> 템플릿 v2/)
  assert.equal(fs.readFileSync(path.join(root, BASE), 'utf8'), template(1))
  const context = () => runtime.buildSessionStartContext({ repoRoot: root, host: 'codex', env }).hookSpecificOutput.additionalContext
  assert.match(context(), /SKILL_TEMPLATE_UPDATE docs-boundary: 사본에 v2 병합 충돌이 남아 있다/)
  const again = cli(env, 'update', 'docs-boundary', '--project', root)
  assert.equal(again.status, 1)
  assert.match(again.stderr, /충돌 표시/)

  fs.writeFileSync(path.join(root, SKILL), template(2, { folder: 'a/' }))
  assert.match(cli(env, 'update', 'docs-boundary', '--project', root).stdout, /resolved: .*\nup-to-date: v2/)
  assert.equal(fs.readFileSync(path.join(root, BASE), 'utf8'), template(2, { folder: 'b/' }))
  assert.doesNotMatch(context(), /SKILL_TEMPLATE_UPDATE/)
})

test('a thrown-away conflicted merge is offered again; CRLF is refused', t => {
  const { root, env, setTemplate } = fixture(t)
  cli(env, 'install', 'docs-boundary', '--project', root)
  const local = template(1, { folder: 'a/' })
  fs.writeFileSync(path.join(root, SKILL), local)
  setTemplate(template(2, { folder: 'b/', rule: '새 공통 문장.' }))
  assert.match(cli(env, 'update', 'docs-boundary', '--project', root).stdout, /충돌 1곳/)
  fs.writeFileSync(path.join(root, SKILL), local)
  assert.match(cli(env, 'update', 'docs-boundary', '--project', root).stdout, /pending dropped: .*\nmerged: v1 -> v2, 충돌 1곳/)
  assert.match(fs.readFileSync(path.join(root, SKILL), 'utf8'), /새 공통 문장\./)

  fs.writeFileSync(path.join(root, SKILL), local.replace(/\n/g, '\r\n'))
  fs.rmSync(path.join(root, '.agents/skills/docs-boundary/.template-pending.json'))
  assert.match(cli(env, 'update', 'docs-boundary', '--project', root).stderr, /CRLF/)
})

test('unversioned template edits do not propagate; projects without a copy get no notice', t => {
  const { root, env, setTemplate } = fixture(t)
  assert.deepEqual(runtime.buildSessionStartContext({ repoRoot: root, host: 'codex', env }).hookSpecificOutput.additionalContext.match(/SKILL_TEMPLATE_UPDATE/g), null)
  cli(env, 'install', 'docs-boundary', '--project', root)
  setTemplate(template(1, { rule: '바뀐 문장.' }))
  assert.match(cli(env, 'update', 'docs-boundary', '--project', root).stdout, /버전이 같다/)
  assert.equal(fs.readFileSync(path.join(root, SKILL), 'utf8'), template(1))
})
