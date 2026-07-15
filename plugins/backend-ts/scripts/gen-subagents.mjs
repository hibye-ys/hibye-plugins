#!/usr/bin/env node
// gen-subagents.mjs — Codex subagent (.codex/agents/*.toml) 를 SoT 로
// Claude Code (agents/*.md) 와 OpenCode (opencode/agents/*.md) 포맷으로 생성한다.
//
// 단일 SoT = Codex .toml (name / description / sandbox_mode / developer_instructions).
//   - Claude .md   : frontmatter(name, description) + body
//   - OpenCode .md : frontmatter(description, mode: subagent[, tools]) + body
//     sandbox_mode="read-only" → OpenCode tools.write=false, tools.edit=false 매핑
//
// Usage:
//   node scripts/gen-subagents.mjs           # 생성 (in-place)
//   node scripts/gen-subagents.mjs --check   # drift 검증 (무수정, drift 시 exit 1)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(PLUGIN_DIR, '.codex', 'agents');
const CLAUDE_DIR = join(PLUGIN_DIR, 'agents');
const OPENCODE_DIR = join(PLUGIN_DIR, 'opencode', 'agents');

const CHECK = process.argv.includes('--check');

// 본 포맷에 특화된 경량 TOML 파서 (의존성 없이).
// 지원: key = "..." (single-line), key = """...""" (multi-line block).
function parseToml(text) {
  const out = {};
  // multi-line block 먼저 추출
  const blockRe = /^([a-z_]+)\s*=\s*"""\r?\n([\s\S]*?)\r?\n?"""\s*$/m;
  let rest = text;
  let m;
  while ((m = blockRe.exec(rest)) !== null) {
    out[m[1]] = m[2];
    rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length);
  }
  // single-line key = "value"
  for (const line of rest.split(/\r?\n/)) {
    const sm = /^([a-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line.trim());
    if (sm) out[sm[1]] = sm[2].replace(/\\"/g, '"');
  }
  return out;
}

// YAML double-quoted scalar 로 안전 직렬화 (한 줄).
function yamlString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function renderClaude({ name, description, body, readonly }) {
  let fm = `---\nname: ${name}\ndescription: ${yamlString(description)}\n`;
  // Claude plugin agents ignore permissionMode. Keep review agents capable of
  // shell-based diagnostics while excluding direct Edit/Write tools; the
  // generated body remains responsible for prohibiting mutation through Bash.
  if (readonly) fm += 'tools: Read, Grep, Glob, Bash\n';
  fm += '---\n';
  return `${fm}\n${body.trim()}\n`;
}

function renderOpenCode({ description, body, readonly }) {
  let fm = `---\ndescription: ${yamlString(description)}\nmode: subagent\n`;
  if (readonly) fm += `tools:\n  write: false\n  edit: false\n`;
  fm += `---\n`;
  return `${fm}\n${body.trim()}\n`;
}

function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.toml')).sort();
const expectedGenerated = new Set(files.map((f) => `${basename(f, '.toml')}.md`));
let drift = 0;
const written = [];

for (const dir of [CLAUDE_DIR, OPENCODE_DIR]) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    if (expectedGenerated.has(file)) continue;
    const path = join(dir, file);
    if (CHECK) {
      console.error(`STALE: ${path.replace(PLUGIN_DIR + '/', '')}`);
      drift++;
    } else {
      unlinkSync(path);
      written.push(`${path.replace(PLUGIN_DIR + '/', '')} (removed)`);
    }
  }
}

for (const f of files) {
  const toml = parseToml(readFileSync(join(SRC_DIR, f), 'utf8'));
  const name = toml.name || basename(f, '.toml');
  const description = toml.description || '(no description)';
  const body = toml.developer_instructions || '';
  const readonly = toml.sandbox_mode === 'read-only';

  const targets = [
    { path: join(CLAUDE_DIR, `${name}.md`), content: renderClaude({ name, description, body, readonly }) },
    { path: join(OPENCODE_DIR, `${name}.md`), content: renderOpenCode({ description, body, readonly }) },
  ];

  for (const t of targets) {
    const cur = existsSync(t.path) ? readFileSync(t.path, 'utf8') : null;
    if (cur === t.content) continue;
    if (CHECK) {
      console.error(`DRIFT: ${t.path.replace(PLUGIN_DIR + '/', '')}`);
      drift++;
    } else {
      ensureDir(dirname(t.path));
      writeFileSync(t.path, t.content);
      written.push(t.path.replace(PLUGIN_DIR + '/', ''));
    }
  }
}

if (CHECK) {
  if (drift > 0) { console.error(`gen-subagents: ${drift} file(s) out of date — run without --check`); process.exit(1); }
  console.log(`gen-subagents --check: OK (${files.length} agents, 2 formats)`);
} else {
  console.log(`gen-subagents: ${files.length} agents → Claude + OpenCode (${written.length} written/updated)`);
  for (const w of written) console.log(`  ${w}`);
}
