'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { digest, secureDirectory } = require('./context.cjs');

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
  try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return record;
}
function listReferences() {
  const directory = indexDirectory();
  return fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => {
    const file = path.join(directory, name);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.mode & 0o077 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('Unsafe global reference');
      const bytes = fs.readFileSync(fd);
      if (digest(bytes) !== name.slice(0, -5)) throw new Error('Global reference integrity mismatch');
      const ref = JSON.parse(bytes);
      return { ...ref, availability: fs.existsSync(path.join(ref.store, 'runs', ref.run_key)) ? 'available' : 'missing' };
    } finally { fs.closeSync(fd); }
  });
}
module.exports = { linkComponent, listReferences };
