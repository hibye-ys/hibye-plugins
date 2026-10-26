'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'],
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
}).trim();

function projectContext(cwd) {
  cwd = fs.realpathSync(cwd);
  let checkout;
  try {
    checkout = git(cwd, ['rev-parse', '--show-toplevel']);
    const common = fs.realpathSync(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    const first = git(cwd, ['worktree', 'list', '--porcelain']).split('\n').find(line => line.startsWith('worktree '));
    if (!first) throw new Error('No primary checkout');
    const primary = fs.realpathSync(first.slice(9));
    if (fs.realpathSync(git(primary, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) !== common) {
      throw new Error('Project checkout mismatch');
    }
    let commit = null;
    try { commit = git(cwd, ['rev-parse', '--verify', 'HEAD']); } catch { /* Unborn repositories have no commit yet. */ }
    return { checkout, primary, project: digest(common), root: path.join(primary, '.agent-results'),
      commit, branch: git(cwd, ['branch', '--show-current']) || null };
  } catch (error) {
    if (checkout) throw new Error('Git project context could not be verified');
    // A non-Git project opts in with a nearest .agent-results/config.json.
    let current = cwd;
    while (current !== path.dirname(current) && current !== os.homedir()) {
      if (fs.existsSync(path.join(current, '.agent-results', 'config.json'))) {
        return { checkout: cwd, primary: current, project: digest(current), root: path.join(current, '.agent-results'), commit: null, branch: null };
      }
      current = path.dirname(current);
    }
    return { checkout: cwd, primary: null, project: null, root: path.join(os.homedir(), '.agent-results'), commit: null, branch: null };
  }
}

function secureDirectory(directory) {
  directory = path.resolve(directory);
  for (let ancestor = path.dirname(directory); ancestor !== path.dirname(ancestor); ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('Unsafe results directory ancestor');
  }
  const parent = path.dirname(directory);
  if (!fs.existsSync(parent)) secureDirectory(parent);
  // Refuse redirection of private data through an existing symbolic link.
  let stat;
  try { stat = fs.lstatSync(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Unsafe results directory');
  if (!stat) fs.mkdirSync(directory, { mode: 0o700 });
  if (stat && typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Results directory owner mismatch');
  fs.chmodSync(directory, 0o700);
  return directory;
}

function readConfig(root) {
  try {
    const file = path.join(root, 'config.json');
    if (fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe results config');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(config.max_artifact_bytes) || config.max_artifact_bytes < 1 || config.max_artifact_bytes > 4194304) throw new Error('Invalid artifact size limit');
    return config.schema === 'agent-results.config.v1' && config.enabled === true ? config : null;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function initialize({ cwd = process.cwd(), user = false }) {
  const context = projectContext(cwd);
  if (user) Object.assign(context, { primary: null, project: null, root: path.join(os.homedir(), '.agent-results') });
  else if (!context.primary) Object.assign(context, { primary: fs.realpathSync(cwd), project: digest(fs.realpathSync(cwd)), root: path.join(fs.realpathSync(cwd), '.agent-results') });
  if (!user) ensureIgnored(context);
  secureDirectory(context.root);
  const file = path.join(context.root, 'config.json');
  const config = { schema: 'agent-results.config.v1', enabled: true, scope: user ? 'user' : 'project', max_artifact_bytes: 1048576 };
  if (fs.existsSync(file)) { if (!readConfig(context.root)) throw new Error('Existing configuration must be reviewed'); }
  else fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return context;
}

function ensureIgnored(context) {
  if (!context.primary) return;
  try { git(context.primary, ['rev-parse', '--show-toplevel']); } catch { return; }
  if (git(context.primary, ['ls-files', '--', '.agent-results']).length) throw new Error('Result data is already tracked by Git; review before enabling capture');
  try { git(context.primary, ['check-ignore', '-q', '--', '.agent-results/']); return; } catch { /* Add a private local rule before enabling. */ }
  const exclude = git(context.primary, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']);
  const parent = path.dirname(exclude);
  if (fs.lstatSync(parent).isSymbolicLink()) throw new Error('Unsafe Git exclude directory');
  if (fs.existsSync(exclude) && (!fs.lstatSync(exclude).isFile() || fs.lstatSync(exclude).isSymbolicLink())) throw new Error('Unsafe Git exclude file');
  fs.appendFileSync(exclude, '\n/.agent-results/\n', { mode: 0o600 });
  git(context.primary, ['check-ignore', '-q', '--', '.agent-results/']);
}

function resolveContext(cwd = process.cwd()) {
  const context = projectContext(cwd);
  const config = readConfig(context.root);
  if (!config || (context.project === null && config.scope !== 'user')) return null;
  return { ...context, config };
}

function sensitiveSource(value) {
  return /(?:operator[.-]env|credentials|auth\.json|keychain|(?:^|[\s"'`=:/\\])(?:\.env(?:[.\s"'`/\\]|$)|\.dev\.vars(?:[.\s"'`/\\]|$)|\.(?:envrc|netrc|npmrc|pypirc)(?:[\s"'`/\\]|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:[.\s"'`/\\]|$)|[^\s"'`/\\]+\.(?:pem|key|p12|pfx)(?:[\s"'`/\\]|$)))/i.test(value);
}

function redact(value, field = '') {
  if (/^(authorization|cookie|set-cookie|password|passwd|secret|access_token|refresh_token|api[_-]?key|client_secret)$/i.test(field) ||
      /_(?:key|token|secret|password|passwd)$/i.test(field)) return '[REDACTED]';
  if (typeof value === 'string') return value
    .replace(/-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]* )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]+|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/\b((?:(?:[a-z][a-z0-9_]*_)?(?:password|passwd|key|token|secret)|api[_-]?key|access_token|refresh_token|client_secret)\s*[=:]\s*["']?)[^\s,;"']+/gi, '$1[REDACTED]');
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, key)]));
  return value;
}

function component(file, usage = 'read', kind) {
  const absolute = fs.realpathSync(file);
  if (sensitiveSource(file) || sensitiveSource(absolute)) throw new Error('Sensitive component source omitted');
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > 262144) throw new Error('Component file unavailable or oversized');
  const content = fs.readFileSync(absolute);
  return { kind: kind || (path.basename(absolute) === 'SKILL.md' ? 'skill' : 'instruction'),
    id: path.basename(absolute) === 'SKILL.md' ? path.basename(path.dirname(absolute)) : path.basename(absolute),
    source: absolute, revision: digest(content), usage };
}
module.exports = { digest, git, projectContext, secureDirectory, readConfig, initialize, resolveContext, redact, component, ensureIgnored, sensitiveSource };
