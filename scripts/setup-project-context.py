#!/usr/bin/env python3
"""Target-only project-context setup. Preview/check never write or install plugins."""
import argparse
import copy
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import tomllib

# These are complete historical registrations, not a shell grammar. The one
# EUNHA wrapper is preserved verbatim from the original project config. Any
# suffix/prefix/condition/pipeline/substitution variation requires manual review.
EUNHA_LEGACY_CONTEXT_COMMAND = 'unset GIT_DIR GIT_COMMON_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES; CLAUDE_PROJECT_DIR="$(git rev-parse --show-toplevel)" node "$(git rev-parse --show-toplevel)/.agents/hooks/session-start-context.mjs"'
CANONICAL_LEGACY_COMMANDS = frozenset({
    EUNHA_LEGACY_CONTEXT_COMMAND,
    'node .agents/hooks/session-start-context.mjs',
    'node ".agents/hooks/session-start-context.mjs"',
    'node "$CLAUDE_PROJECT_DIR/.agents/hooks/session-start-context.mjs"',
    'node scripts/hooks/intent-ledger.mjs session-start',
    'node "$CLAUDE_PROJECT_DIR/scripts/hooks/intent-ledger.mjs" session-start',
})


def legacy_hook(hook):
    command = hook.get('command', '') if isinstance(hook, dict) else ''
    return isinstance(command, str) and command.strip() in CANONICAL_LEGACY_COMMANDS


RESERVED_CONTEXT_ENTRIES = ('session-start-context.mjs', 'intent-ledger.mjs', 'project-context.cjs', 'project-context.mjs', 'project-context-runner.mjs')


def without_legacy_hooks(data):
    if not isinstance(data, dict):
        raise ValueError('Project settings must be an object')
    result = copy.deepcopy(data)
    hooks = result.get('hooks', {})
    if not isinstance(hooks, dict):
        raise ValueError('hooks must be an object')
    groups = hooks.get('SessionStart', [])
    if not isinstance(groups, list):
        raise ValueError('SessionStart must be an array')
    kept = []
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get('hooks', []), list):
            raise ValueError('Malformed SessionStart hook group')
        clean = [hook for hook in group.get('hooks', []) if not legacy_hook(hook)]
        for hook in clean:
            command = hook.get('command', '') if isinstance(hook, dict) else ''
            if isinstance(command, str) and any(entry in command for entry in RESERVED_CONTEXT_ENTRIES):
                raise ValueError('PROJECT_CONTEXT_RESERVED_REGISTRATION: unsupported project SessionStart reference remains; only native plugin hooks may reference context entrypoints')
        if clean or not group.get('hooks'):
            kept.append({**group, **({'hooks': clean} if 'hooks' in group else {})})
    if 'SessionStart' in hooks:
        if kept:
            hooks['SessionStart'] = kept
        else:
            del hooks['SessionStart']
    if 'hooks' in result and not hooks:
        del result['hooks']
    return result


def statements(source):
    """TOML logical statement spans, respecting strings, arrays, comments and CRLF.

    tomllib validates both documents; this lexer only selects owned spans. It never
    serializes unowned TOML. Any unsupported shape fails the semantic postcondition.
    """
    start = i = depth = 0
    quote = None
    triple = False
    comment = False
    while i < len(source):
        c = source[i]
        if comment:
            if c == '\n':
                comment = False
            else:
                i += 1
                continue
        if quote:
            if c == '\\' and quote == '"':
                i += 2
                continue
            end = quote * (3 if triple else 1)
            if source.startswith(end, i):
                i += len(end)
                quote = None
                continue
        elif c in "\"'":
            quote = c
            triple = source.startswith(c * 3, i)
            i += 3 if triple else 1
            continue
        elif c == '#':
            comment = True
        elif c in '[{':
            depth += 1
        elif c in ']}':
            depth -= 1
        if c == '\n' and not quote and depth == 0:
            yield start, i + 1, source[start:i + 1]
            start = i + 1
        i += 1
    if start < len(source):
        yield start, len(source), source[start:]


def table_path(statement):
    text = statement.lstrip()
    if not text.startswith('['):
        return None
    try:
        data = tomllib.loads(text + '\n__hibye_span_marker__ = true\n')
    except tomllib.TOMLDecodeError:
        return None
    path = []
    while isinstance(data, (dict, list)):
        if isinstance(data, list):
            data = data[0]
        elif '__hibye_span_marker__' in data:
            return tuple(path)
        elif len(data) == 1:
            key, data = next(iter(data.items()))
            path.append(key)
        else:
            return None
    return None


def patch_toml(source, memory_enabled):
    before = tomllib.loads(source)
    expected = without_legacy_hooks(before)
    if memory_enabled:
        memories = expected.setdefault('memories', {})
        if not isinstance(memories, dict):
            raise ValueError('memories must be a table')
        memories.update(use_memories=False, generate_memories=False)
    spans = list(statements(source))
    headers = [(n, table_path(text)) for n, (_, _, text) in enumerate(spans) if table_path(text) is not None]
    edits = []
    # Each native [[hooks.SessionStart.hooks]] is isolated by the next table.
    for pos, (n, path) in enumerate(headers):
        end_n = headers[pos + 1][0] if pos + 1 < len(headers) else len(spans)
        start, end = spans[n][0], spans[end_n - 1][1]
        if path == ('hooks', 'SessionStart', 'hooks'):
            fragment = tomllib.loads(source[start:end])
            hook = fragment['hooks']['SessionStart']['hooks'][0]
            if legacy_hook(hook):
                edits.append((start, end, ''))
    # Remove a parent only if every child in its group is owned legacy context.
    parent_headers = [(n, path) for n, path in headers if path == ('hooks', 'SessionStart')]
    for group_index, (n, _) in enumerate(parent_headers):
        groups = before.get('hooks', {}).get('SessionStart', [])
        if group_index >= len(groups):
            raise ValueError('Unsupported SessionStart TOML shape')
        hooks = groups[group_index].get('hooks', [])
        if hooks and all(legacy_hook(hook) for hook in hooks):
            next_header = next((j for j, _ in headers if j > n), len(spans))
            edits.append((spans[n][0], spans[next_header - 1][1], ''))
    for start, end, replacement in sorted(edits, reverse=True):
        source = source[:start] + replacement + source[end:]
    if memory_enabled:
        # Work only on assignments inside [memories], including quoted keys.
        spans = list(statements(source))
        current = ()
        owned = set()
        edits = []
        table_end = None
        for start, end, text in spans:
            header = table_path(text)
            if header is not None:
                if current == ('memories',) and table_end is None:
                    table_end = start
                current = header
                continue
            stripped = text.lstrip()
            if not stripped or stripped.startswith('#'):
                continue
            try:
                parsed = tomllib.loads(text)
            except tomllib.TOMLDecodeError:
                continue
            for key in ('use_memories', 'generate_memories'):
                if current == ('memories',) and key in parsed:
                    # Assignment's trailing comment is retained byte for byte.
                    match = re.match(r'(\s*(?:"' + key + r'"|\'' + key + r'\'|' + key + r')\s*=\s*)(true|false)(.*)', text, re.S)
                    if not match:
                        raise ValueError('Unsupported memory assignment; no files were changed')
                    edits.append((start, end, match[1] + 'false' + match[3]))
                    owned.add(key)
                elif not current and isinstance(parsed.get('memories'), dict):
                    raise ValueError('Use a [memories] table for project-context setup; no files were changed')
        missing = [key for key in ('use_memories', 'generate_memories') if key not in owned]
        if missing:
            insertion = ''.join(f'{key} = false\n' for key in missing)
            has_table = any(table_path(text) == ('memories',) for _, _, text in spans)
            if has_table:
                offset = table_end if table_end is not None else len(source)
                edits.append((offset, offset, ('\n' if offset and source[offset - 1] != '\n' else '') + insertion))
            else:
                edits.append((len(source), len(source), ('\n' if source and not source.endswith('\n') else '') + '\n[memories]\n' + insertion))
        for start, end, replacement in sorted(edits, reverse=True):
            source = source[:start] + replacement + source[end:]
    after = tomllib.loads(source)
    # Removing an empty hooks table is semantically equivalent and intentional.
    if after.get('hooks') == {} and 'hooks' not in expected:
        del after['hooks']
    if after != expected:
        raise ValueError('Unsupported TOML layout: preservation check failed; no files were changed')
    return source


def git_root(project):
    env = {key: value for key, value in os.environ.items() if key not in {'GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'}}
    def git(*args):
        result = subprocess.run(['git', '-C', str(project), *args], env=env, text=True, capture_output=True)
        if result.returncode:
            raise ValueError('A non-bare Git project is required: ' + result.stderr.strip())
        return result.stdout.strip()
    root = Path(git('rev-parse', '--show-toplevel')).resolve()
    if git('rev-parse', '--is-bare-repository') == 'true':
        raise ValueError('Bare repositories are unsupported')
    records = git('worktree', 'list', '--porcelain', '-z').split('\0')
    primary_record = next((record for record in records if record.startswith('worktree ')), None)
    primary = Path(primary_record[len('worktree '):]).resolve() if primary_record else None
    if primary is None or not (primary / '.git').exists():
        raise ValueError('Cannot resolve primary checkout; separate-git-dir layouts are unsupported')
    return root, primary


def relative(value):
    if not isinstance(value, str) or not value or '\\' in value or PurePosixPath(value).is_absolute() or any(part in ('', '.', '..') for part in value.split('/')):
        raise ValueError('Expected a safe repository-relative path: ' + value)
    return value


def validate_config(value):
    if not isinstance(value, dict) or set(value) != {'schema_version', 'memory', 'intent'} or value['schema_version'] != 1 or isinstance(value['schema_version'], bool):
        raise ValueError('Invalid .project-context.json schema')
    for kind, keys in (('memory', {'directory', 'index'}), ('intent', {'directory'})):
        setting = value[kind]
        if setting is False:
            continue
        if not isinstance(setting, dict) or set(setting) != keys:
            raise ValueError('Invalid project-context ' + kind)
        for key in keys:
            relative(setting[key])
    if value['memory'] is False and value['intent'] is False:
        raise ValueError('Enable at least memory or intent')
    return value


def safe_target(root, path):
    ancestors = []
    parent = path
    while parent != root and parent != parent.parent:
        ancestors.append(parent)
        parent = parent.parent
    if any(entry.is_symlink() for entry in ancestors) or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Refusing linked or escaped setup target: ' + str(path))
    if path.exists() and not path.is_file():
        raise ValueError('Setup target is not a file: ' + str(path))


def needs_update(path, value):
    if not path.exists():
        return True
    existing = path.read_text()
    if existing == value:
        return False
    if path.suffix == '.json':
        # Preserve formatter layout, key order, escapes, permissions and bytes
        # when content is unchanged. Canonical JSON also distinguishes bools
        # from integers, unlike Python's True == 1 dictionary comparison.
        def canonical(text):
            return json.dumps(json.loads(text), ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        return canonical(existing) != canonical(value)
    return True


def plan_setup(project, tools, config=None):
    root, primary = git_root(Path(project))
    optin = root / '.project-context.json'
    safe_target(root, optin)
    if config is None:
        config = json.loads(optin.read_text()) if optin.exists() else {'schema_version': 1, 'memory': {'directory': 'docs/memory', 'index': 'MEMORY.md'}, 'intent': {'directory': 'intent'}}
    validate_config(config)
    if root != primary and config['memory'] is not False:
        primary_optin = primary / '.project-context.json'
        safe_target(primary, primary_optin)
        if not primary_optin.is_file():
            raise ValueError('PRIMARY_MEMORY_CONFIG_REQUIRED: set up shared memory in the primary checkout first')
        primary_config = validate_config(json.loads(primary_optin.read_text()))
        if primary_config['memory'] is False:
            raise ValueError('PRIMARY_MEMORY_CONFIG_REQUIRED: primary checkout must opt in to shared memory')
        if config['memory'] != primary_config['memory']:
            raise ValueError('PRIMARY_MEMORY_CONFIG_MISMATCH: linked memory configuration differs from the authoritative primary checkout; no files were changed')
    if 'claude' in tools and config['memory'] is not False and config['memory']['index'] != 'MEMORY.md':
        raise ValueError('CLAUDE_NATIVE_MEMORY_UNSUPPORTED: Claude native memory requires memory.directory/MEMORY.md; select --tools codex explicitly for a custom index')
    for kind, base in (('memory', primary), ('intent', root)):
        if config[kind] is not False:
            directory = base / config[kind]['directory']
            if not directory.resolve().is_relative_to(base) or not directory.is_dir():
                raise ValueError(f'{kind} directory missing or escaped: {directory}')
            if kind == 'memory' and (not (directory / config[kind]['index']).is_file() or not (directory / config[kind]['index']).resolve().is_relative_to(directory.resolve())):
                raise ValueError('Memory index missing or escaped')
    changes = {optin: json.dumps(config, ensure_ascii=False, indent=2) + '\n'}
    if 'codex' in tools:
        path = root / '.codex/config.toml'
        safe_target(root, path)
        changes[path] = patch_toml(path.read_text() if path.exists() else '', config['memory'] is not False)
        hooks_path = root / '.codex/hooks.json'
        safe_target(root, hooks_path)
        if hooks_path.exists():
            data = without_legacy_hooks(json.loads(hooks_path.read_text()))
            changes[hooks_path] = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    if 'claude' in tools:
        path = root / '.claude/settings.json'
        safe_target(root, path)
        data = without_legacy_hooks(json.loads(path.read_text()) if path.exists() else {})
        if config['memory'] is not False:
            data['autoMemoryDirectory'] = str(primary / config['memory']['directory'])
        data.setdefault('enabledPlugins', {})['project-context@hibye-plugins'] = True
        changes[path] = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    return {path: value for path, value in changes.items() if needs_update(path, value)}


def apply_changes(changes):
    previous = {path: path.read_bytes() if path.exists() else None for path in changes}
    written = []
    try:
        for path, value in changes.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            # Preserve original permissions. Never follow a target symlink.
            mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
                temporary.write(value.encode())
                temporary_path = Path(temporary.name)
            try:
                temporary_path.chmod(mode)
                os.replace(temporary_path, path)
            finally:
                temporary_path.unlink(missing_ok=True)
            written.append(path)
    except BaseException:
        for path in reversed(written):
            if previous[path] is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(previous[path])
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project')
    parser.add_argument('--tools', default='codex,claude')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--preview', action='store_true')
    modes.add_argument('--check', action='store_true')
    parser.add_argument('--memory-directory')
    parser.add_argument('--memory-index')
    parser.add_argument('--intent-directory')
    parser.add_argument('--no-memory', action='store_true')
    parser.add_argument('--no-intent', action='store_true')
    args = parser.parse_args()
    try:
        tools = args.tools.split(',')
        if not tools or len(set(tools)) != len(tools) or set(tools) - {'claude', 'codex'}:
            raise ValueError('Supported tools: codex,claude')
        config = None
        if args.no_memory and (args.memory_directory or args.memory_index) or args.no_intent and args.intent_directory:
            raise ValueError('Conflicting enable/disable options')
        if any((args.memory_directory, args.memory_index, args.intent_directory, args.no_memory, args.no_intent)):
            root, _ = git_root(Path(args.project))
            optin = root / '.project-context.json'
            safe_target(root, optin)
            config = json.loads(optin.read_text()) if optin.exists() else {'schema_version': 1, 'memory': {'directory': 'docs/memory', 'index': 'MEMORY.md'}, 'intent': {'directory': 'intent'}}
            validate_config(config)
            if args.no_memory:
                config['memory'] = False
            elif args.memory_directory or args.memory_index:
                memory = config['memory'] if config['memory'] is not False else {'directory': 'docs/memory', 'index': 'MEMORY.md'}
                config['memory'] = {**memory, **({'directory': args.memory_directory} if args.memory_directory else {}), **({'index': args.memory_index} if args.memory_index else {})}
            if args.no_intent:
                config['intent'] = False
            elif args.intent_directory:
                config['intent'] = {'directory': args.intent_directory}
        changes = plan_setup(args.project, tools, config)
        print(json.dumps({'mode': 'preview' if args.preview else 'check' if args.check else 'apply', 'changes': [str(path) for path in changes]}, indent=2))
        if args.check:
            return 1 if changes else 0
        if not args.preview:
            apply_changes(changes)
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print('PROJECT SETUP FAILED: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
