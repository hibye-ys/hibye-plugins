'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { linkComponent, listReferences } = require('../scripts/references.cjs');

test('global skills used in a project retain only references, survive worktree removal, and report unavailable originals', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-result-refs-')));
  const previous = process.env.HOME;
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  process.env.HOME = home;
  t.after(() => { process.env.HOME = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const primary = path.join(root, 'project'); const checkout = path.join(root, 'linked');
  const store = path.join(primary, '.agent-results'); const key = 'a'.repeat(64);
  fs.mkdirSync(path.join(store, 'runs', key), { recursive: true }); fs.mkdirSync(checkout);
  const context = { primary, checkout, project: 'project-id', root: store };
  const component = { kind: 'skill', id: 'global-skill', source: path.join(home, '.agents/skills/global-skill/SKILL.md'), revision: 'b'.repeat(64), usage: 'declared' };
  linkComponent(context, key, component); linkComponent(context, key, component);
  fs.rmSync(checkout, { recursive: true });
  const refs = listReferences(); assert.equal(refs.length, 1); assert.equal(refs[0].availability, 'available');
  assert.equal(refs[0].store, store); assert.equal(refs[0].run_key, key);
  const bytes = fs.readFileSync(path.join(home, '.agent-results/references', fs.readdirSync(path.join(home, '.agent-results/references'))[0]), 'utf8');
  assert.equal(bytes.includes('artifacts'), false); assert.equal(bytes.includes('content'), false);
  fs.rmSync(primary, { recursive: true }); assert.equal(listReferences()[0].availability, 'missing');
  assert.equal(linkComponent(context, key, { ...component, source: path.join(primary, '.agents/skills/local/SKILL.md') }), null);
  assert.equal(linkComponent({ ...context, project: null }, key, component), null);
});
