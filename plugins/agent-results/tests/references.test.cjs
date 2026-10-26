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

test('damaged, unsafe and invalid references are isolated without returning their content or hiding healthy entries', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-result-refs-')));
  const previous = process.env.HOME;
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  process.env.HOME = home;
  t.after(() => { process.env.HOME = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const primary = path.join(root, 'project'); const store = path.join(primary, '.agent-results'); const key = 'a'.repeat(64);
  fs.mkdirSync(path.join(store, 'runs', key), { recursive: true });
  const context = { primary, checkout: primary, project: 'project-id', root: store };
  const component = { kind: 'skill', id: 'valid', source: path.join(home, 'global/SKILL.md'), revision: 'v1', usage: 'declared' };
  linkComponent(context, key, component);
  const directory = path.join(home, '.agent-results/references');
  const good = fs.readdirSync(directory)[0];
  fs.writeFileSync(path.join(directory, `${'b'.repeat(64)}.json`), '{"store":"DO_NOT_RETURN', { mode: 0o600 });
  const privateTarget = path.join(root, 'outside.json'); fs.writeFileSync(privateTarget, 'DO_NOT_READ', { mode: 0o600 });
  fs.symlinkSync(privateTarget, path.join(directory, `${'c'.repeat(64)}.json`));
  fs.writeFileSync(path.join(directory, `${'d'.repeat(64)}.json`), '{}', { mode: 0o644 });
  const invalidBytes = Buffer.from('{"store":"DO_NOT_RETURN"}');
  const invalidName = `${require('node:crypto').createHash('sha256').update(invalidBytes).digest('hex')}.json`;
  fs.writeFileSync(path.join(directory, invalidName), invalidBytes, { mode: 0o600 });
  const refs = listReferences();
  assert.equal(refs.filter(item => item.availability === 'available').length, 1);
  assert.equal(refs.filter(item => item.availability === 'invalid').length, 4);
  assert.equal(JSON.stringify(refs).includes('DO_NOT_'), false);
  assert.equal(fs.readFileSync(privateTarget, 'utf8'), 'DO_NOT_READ');
  assert.deepEqual(refs.filter(item => item.availability === 'invalid').map(item => Object.keys(item).sort()),
    Array.from({ length: 4 }, () => ['availability', 'reason', 'reference_file']));
  fs.writeFileSync(path.join(directory, good), 'changed');
  assert.throws(() => linkComponent(context, key, component), /immutable record conflict/);
  assert.equal(fs.readFileSync(path.join(directory, good), 'utf8'), 'changed', 'invalid immutable references are not overwritten');
});

test('reference publication exposes only a fully written inode and failed publication leaves no partial reference', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-result-refs-')));
  const previous = process.env.HOME;
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  process.env.HOME = home;
  t.after(() => { process.env.HOME = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const primary = path.join(root, 'project'); const store = path.join(primary, '.agent-results'); const key = 'a'.repeat(64);
  const context = { primary, checkout: primary, project: 'project-id', root: store };
  const component = { kind: 'skill', id: 'valid', source: path.join(home, 'global/SKILL.md'), revision: 'v1', usage: 'declared' };
  const original = fs.linkSync;
  let publications = 0;
  fs.linkSync = (temp, file) => {
    publications++;
    assert.equal(fs.existsSync(file), false);
    assert.equal(JSON.parse(fs.readFileSync(temp)).component.id, 'valid');
    assert.equal(fs.statSync(temp).mode & 0o777, 0o600);
    const error = new Error('simulated publication interruption'); error.code = 'EIO'; throw error;
  };
  try { assert.throws(() => linkComponent(context, key, component), /publication interruption/); }
  finally { fs.linkSync = original; }
  assert.equal(publications, 1);
  assert.deepEqual(fs.readdirSync(path.join(home, '.agent-results/references')), []);
  linkComponent(context, key, component);
  assert.equal(listReferences()[0].availability, 'missing');
});
