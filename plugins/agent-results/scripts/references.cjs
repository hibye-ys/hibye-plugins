'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { digest, secureDirectory } = require('./context.cjs');
const { publishPrivate } = require('./store.cjs');

function indexDirectory() {
  return secureDirectory(path.join(fs.realpathSync(os.homedir()), '.agent-results', 'references'));
}
function within(parent, file) {
  const relative = path.relative(parent, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function linkComponent(context, runKey, component) {
  if (!context.project || component.kind !== 'skill' || within(context.checkout, component.source) || within(context.primary, component.source)) return null;
  const record = { schema: 'agent-results.reference.v1', project: context.project,
    project_root: context.primary, store: context.root, run_key: runKey, component };
  const bytes = Buffer.from(JSON.stringify(record));
  const file = path.join(indexDirectory(), `${digest(bytes)}.json`);
  publishPrivate(file, bytes);
  return record;
}
function listReferences() {
  const directory = indexDirectory();
  return fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().map(name => {
    const file = path.join(directory, name);
    let fd;
    try {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('unsafe_entry');
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.mode & 0o077 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('unsafe_entry');
      const bytes = fs.readFileSync(fd);
      if (digest(bytes) !== name.slice(0, -5)) throw new Error('integrity_mismatch');
      let ref;
      try { ref = JSON.parse(bytes); } catch { throw new Error('invalid_json'); }
      if (!validReference(ref)) throw new Error('invalid_reference');
      return { ...ref, availability: fs.existsSync(path.join(ref.store, 'runs', ref.run_key)) ? 'available' : 'missing' };
    } catch (error) {
      // Never return fields parsed from an invalid entry. One damaged or unsafe
      // reference must not hide the independently verified healthy references.
      const known = ['unsafe_entry', 'integrity_mismatch', 'invalid_json', 'invalid_reference'];
      return { reference_file: name, availability: 'invalid', reason: known.includes(error.message) ? error.message : 'unreadable_entry' };
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  });
}
function validReference(ref) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const absolute = value => text(value) && path.isAbsolute(value);
  const item = ref?.component;
  return object(ref) && ref.schema === 'agent-results.reference.v1' && text(ref.project) &&
    absolute(ref.project_root) && absolute(ref.store) && ref.store === path.join(ref.project_root, '.agent-results') &&
    typeof ref.run_key === 'string' && /^[a-f0-9]{64}$/.test(ref.run_key) && object(item) &&
    item.kind === 'skill' && text(item.id) && absolute(item.source) && (item.revision === null || text(item.revision)) &&
    ['read', 'declared', 'evidence_linked', 'unknown'].includes(item.usage);
}
module.exports = { linkComponent, listReferences };
