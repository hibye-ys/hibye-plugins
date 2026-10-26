#!/usr/bin/env python3
"""Isolated setup/native distribution regression; no native installations."""
import importlib.util
import io
from contextlib import redirect_stdout, redirect_stderr
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


setup = load('setup_context', 'setup-project-context.py')
sync = load('sync_plugins', 'sync-plugins.py')
merge = load('merge_hooks', 'merge-project-hooks.py')


TOML = '''# user comment
model = "x" # preserve
multiline = """hello
[[not.a.table]]
use_memories = true
"""
["memories"] # quoted table
"use_memories" = true # retained owned-key comment
'generate_memories' = true
custom = { nested = [1, 2], value = "# not comment" }
[mcp_servers.example]
command = "server"
args = [
 "--preserve", # comment
 "[[hooks.SessionStart]]"
]
[[hooks.SessionStart]]
matcher = "startup|resume|clear|compact"
[[hooks.SessionStart.hooks]]
type = "command"
command = 'node "$CLAUDE_PROJECT_DIR/.agents/hooks/session-start-context.mjs"'
[[hooks.SessionStart.hooks]]
type = "command"
command = "user-session-hook"
[[hooks.PostToolUse]]
matcher = "apply_patch"
[[hooks.PostToolUse.hooks]]
type = "command"
command = "knip"
'''


class SetupTests(unittest.TestCase):
    def fixture(self, root):
        root.mkdir()
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        (root / 'docs/memory').mkdir(parents=True)
        (root / 'docs/memory/MEMORY.md').write_text('Index; do not rewrite.\n')
        (root / 'intent').mkdir()
        (root / '.codex').mkdir()
        (root / '.codex/config.toml').write_text(TOML)
        (root / '.claude').mkdir()
        (root / '.claude/settings.json').write_text(json.dumps({'autoMemoryDirectory': 'old', 'hooks': {'SessionStart': [{'hooks': [{'type': 'command', 'command': 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/intent-ledger.mjs" session-start'}, {'type': 'command', 'command': 'user'}]}], 'PostToolUse': [{'hooks': [{'command': 'knip'}]}]}, 'enabledMcpjsonServers': ['my-server'], 'enabledPlugins': {'other': False}}))

    def test_legacy_detection_requires_real_node_script_invocation(self):
        for command in ("printf '%s' '.agents/hooks/session-start-context.mjs'", "node other.mjs .agents/hooks/session-start-context.mjs", "printf '%s' node '.agents/hooks/session-start-context.mjs'", "node -e 'console.log(1)' .agents/hooks/session-start-context.mjs"):
            self.assertFalse(setup.legacy_hook({'command': command}), command)
        self.assertTrue(setup.legacy_hook({'command': setup.EUNHA_LEGACY_CONTEXT_COMMAND}))

    def test_reserved_noncanonical_session_hook_fails_without_deleting_user_command(self):
        for command in ("printf '%s' '.agents/hooks/session-start-context.mjs'", 'node --title=context .agents/hooks/session-start-context.mjs', 'node other.mjs project-context-runner.mjs', 'node scripts/hooks/intent-ledger.mjs check'):
            settings = {'hooks': {'SessionStart': [{'hooks': [{'type': 'command', 'command': command}]}]}}
            before = json.dumps(settings)
            with self.assertRaisesRegex(ValueError, 'PROJECT_CONTEXT_RESERVED_REGISTRATION'):
                setup.without_legacy_hooks(settings)
            self.assertEqual(json.dumps(settings), before)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / 'repo'
            self.fixture(root)
            settings = root / '.claude/settings.json'
            data = json.loads(settings.read_text())
            data['hooks']['SessionStart'][0]['hooks'].append({'type': 'command', 'command': 'echo project-context.cjs'})
            settings.write_text(json.dumps(data))
            before = {str(path.relative_to(root)): path.read_bytes() for path in root.rglob('*') if path.is_file()}
            with self.assertRaisesRegex(ValueError, 'PROJECT_CONTEXT_RESERVED_REGISTRATION'):
                setup.plan_setup(root, ['codex', 'claude'])
            self.assertEqual(before, {str(path.relative_to(root)): path.read_bytes() for path in root.rglob('*') if path.is_file()})

    def test_compound_reserved_hooks_are_never_automatically_deleted(self):
        script = 'node .agents/hooks/session-start-context.mjs'
        commands = (
            script + "; printf '%s' 'KEEP_USER_OUTPUT'",
            "printf '%s' 'KEEP_USER_OUTPUT'; " + script,
            'false && ' + script,
            script + ' || echo fallback',
            script + ' | cat',
            script + '\necho keep',
            'node "$(printf /tmp)/.agents/hooks/session-start-context.mjs"',
            setup.EUNHA_LEGACY_CONTEXT_COMMAND + '; echo KEEP_USER_OUTPUT',
        )
        for command in commands:
            settings = {'hooks': {'SessionStart': [{'hooks': [{'type': 'command', 'command': command}]}]}}
            before = json.dumps(settings)
            self.assertFalse(setup.legacy_hook({'command': command}), command)
            with self.assertRaisesRegex(ValueError, 'PROJECT_CONTEXT_RESERVED_REGISTRATION'):
                setup.without_legacy_hooks(settings)
            self.assertEqual(json.dumps(settings), before)
        # The observed original EUNHA registration and standalone Claude command
        # remain exact migration inputs; this does not generalize shell parsing.
        self.assertEqual(setup.without_legacy_hooks({'hooks': {'SessionStart': [{'hooks': [{'type': 'command', 'command': setup.EUNHA_LEGACY_CONTEXT_COMMAND}]}]}}), {})

    def test_toml_preserves_unowned_values_comments_and_mixed_hooks(self):
        after = setup.patch_toml(TOML, True)
        self.assertIn('# retained owned-key comment', after)
        self.assertIn(' "--preserve", # comment', after)
        self.assertIn('[[not.a.table]]', after)
        self.assertIn('custom = { nested = [1, 2], value = "# not comment" }', after)
        data = tomllib.loads(after)
        self.assertEqual(data['hooks']['SessionStart'][0]['hooks'], [{'type': 'command', 'command': 'user-session-hook'}])
        self.assertEqual(data['hooks']['PostToolUse'], tomllib.loads(TOML)['hooks']['PostToolUse'])
        self.assertEqual(setup.patch_toml(after, True), after)

    def test_all_legacy_group_removed_without_other_hook_changes(self):
        text = TOML.replace('[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "user-session-hook"\n', '')
        parsed = tomllib.loads(setup.patch_toml(text, True))
        self.assertNotIn('SessionStart', parsed['hooks'])
        self.assertIn('PostToolUse', parsed['hooks'])

    def test_new_flags_insert_before_next_table_and_preserve_other_keys(self):
        text = '[memories]\ncustom = true\n[mcp_servers.x]\nurl="url"\n'
        parsed = tomllib.loads(setup.patch_toml(text, True))
        self.assertEqual(parsed['memories'], {'custom': True, 'use_memories': False, 'generate_memories': False})
        self.assertEqual(parsed['mcp_servers'], {'x': {'url': 'url'}})
        self.assertIn('custom = true', setup.patch_toml(text, True))

    def test_unsupported_inline_memories_fails_without_rewriting(self):
        with self.assertRaisesRegex(ValueError, 'table'):
            setup.patch_toml('memories = { use_memories = true, custom = 7 }\n', True)

    def test_target_preview_apply_idempotence_and_global_isolation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / 'repo'
            self.fixture(root)
            before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            changes = setup.plan_setup(root, ['codex', 'claude'])
            self.assertEqual(before, {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()})
            setup.apply_changes(changes)
            self.assertFalse(setup.plan_setup(root, ['codex', 'claude']))
            settings = json.loads((root / '.claude/settings.json').read_text())
            self.assertEqual(settings['autoMemoryDirectory'], str(root / 'docs/memory'))
            self.assertEqual(settings['enabledMcpjsonServers'], ['my-server'])
            self.assertFalse(settings['enabledPlugins']['other'])
            self.assertEqual(settings['hooks']['SessionStart'][0]['hooks'][0]['command'], 'user')
            self.assertEqual((root / 'docs/memory/MEMORY.md').read_text(), 'Index; do not rewrite.\n')
            # Actual CLI preview/check is read-only and check reports pending work.
            (root / '.project-context.json').unlink()
            result = subprocess.run([sys.executable, str(HERE / 'setup-project-context.py'), str(root), '--preview'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((root / '.project-context.json').exists())
            self.assertEqual(subprocess.run([sys.executable, str(HERE / 'setup-project-context.py'), str(root), '--check'], capture_output=True).returncode, 1)

    def test_formatter_only_json_layout_keeps_existing_bytes_and_check_passes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / 'repo'
            self.fixture(root)
            setup.apply_changes(setup.plan_setup(root, ['codex', 'claude']))
            hooks = root / '.codex/hooks.json'
            hooks.write_text(json.dumps({'hooks': {'SessionStart': [{'hooks': [{'type': 'command', 'command': 'user-hook'}]}]}, 'custom': {'keep': '한글'}}))
            json_paths = [root / '.project-context.json', root / '.claude/settings.json', hooks]
            for index, path in enumerate(json_paths):
                data = json.loads(path.read_text())
                # Prettier may collapse small objects; other formatters may
                # reorder keys or choose Unicode escapes. None changes data.
                if index == 0:
                    path.write_text('{\n  "intent": { "directory": "intent" },\n  "memory": { "directory": "docs/memory", "index": "MEMORY.md" },\n  "schema_version": 1\n}\n')
                else:
                    path.write_text(json.dumps(data, ensure_ascii=True, sort_keys=True, separators=(',', ':')))
                path.chmod(0o640)
            before = {path: (path.read_bytes(), path.stat().st_mode & 0o777) for path in json_paths}
            self.assertEqual(setup.plan_setup(root, ['codex', 'claude']), {})
            result = subprocess.run([sys.executable, str(HERE / 'setup-project-context.py'), str(root), '--check'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['changes'], [])
            setup.apply_changes(setup.plan_setup(root, ['codex', 'claude']))
            self.assertEqual(before, {path: (path.read_bytes(), path.stat().st_mode & 0o777) for path in json_paths})
            # True and 1 must not be treated as equal native activation values.
            settings = root / '.claude/settings.json'
            data = json.loads(settings.read_text())
            data['enabledPlugins']['project-context@hibye-plugins'] = 1
            settings.write_text(json.dumps(data))
            changes = setup.plan_setup(root, ['codex', 'claude'])
            self.assertEqual(set(changes), {settings})
            setup.apply_changes(changes)
            # A real path-value change still receives one normalization apply.
            data = json.loads(settings.read_text())
            data['autoMemoryDirectory'] += '/'
            settings.write_text(json.dumps(data))
            changes = setup.plan_setup(root, ['codex', 'claude'])
            self.assertEqual(set(changes), {settings})
            setup.apply_changes(changes)
            self.assertEqual(setup.plan_setup(root, ['codex', 'claude']), {})
            self.assertEqual(settings.stat().st_mode & 0o777, 0o640)

    def test_linked_worktree_uses_primary_memory_current_intent(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            root = base / 'main'
            self.fixture(root)
            setup.apply_changes(setup.plan_setup(root, ['claude']))
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Fixture', '-c', 'user.email=test@example.test', 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Fixture', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'], check=True)
            linked = base / 'linked'
            subprocess.run(['git', '-C', str(root), 'worktree', 'add', '-q', '--detach', str(linked)], check=True)
            (linked / 'intent').mkdir(exist_ok=True)
            (linked / 'docs/memory/MEMORY.md').write_text('stale linked index')
            setup.apply_changes(setup.plan_setup(linked, ['claude']))
            self.assertEqual(json.loads((linked / '.claude/settings.json').read_text())['autoMemoryDirectory'], str(root / 'docs/memory'))

    def test_linked_memory_drift_and_missing_primary_optin_fail_before_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            root = base / 'main'
            self.fixture(root)
            setup.apply_changes(setup.plan_setup(root, ['claude']))
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Fixture', '-c', 'user.email=test@example.test', 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Fixture', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'], check=True)
            linked = base / 'linked'
            subprocess.run(['git', '-C', str(root), 'worktree', 'add', '-q', '--detach', str(linked)], check=True)
            (linked / 'intent').mkdir(exist_ok=True)
            (root / 'other-memory').mkdir()
            (root / 'other-memory/MEMORY.md').write_text('must not become authority')
            optin = linked / '.project-context.json'
            current = json.loads(optin.read_text())
            current['memory']['directory'] = 'other-memory'
            optin.write_text(json.dumps(current))
            before = {str(path.relative_to(linked)): path.read_bytes() for path in linked.rglob('*') if path.is_file()}
            with self.assertRaisesRegex(ValueError, 'PRIMARY_MEMORY_CONFIG_MISMATCH'):
                setup.plan_setup(linked, ['codex', 'claude'])
            self.assertEqual(before, {str(path.relative_to(linked)): path.read_bytes() for path in linked.rglob('*') if path.is_file()})
            (root / '.project-context.json').unlink()
            with self.assertRaisesRegex(ValueError, 'PRIMARY_MEMORY_CONFIG_REQUIRED'):
                setup.plan_setup(linked, ['codex', 'claude'])
            self.assertEqual(before, {str(path.relative_to(linked)): path.read_bytes() for path in linked.rglob('*') if path.is_file()})

    def test_separate_git_directory_still_uses_primary_checkout(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            repo = base / 'repo'
            repo.mkdir()
            subprocess.run(['git', 'init', '-q', '--separate-git-dir', str(base / 'git-storage'), str(repo)], check=True)
            (repo / 'docs/memory').mkdir(parents=True)
            (repo / 'docs/memory/MEMORY.md').write_text('index')
            (repo / 'intent').mkdir()
            with self.assertRaisesRegex(ValueError, 'separate-git-dir'):
                setup.plan_setup(repo, ['claude'])
            self.assertFalse((repo / '.project-context.json').exists())

    def test_intent_only_does_not_disable_native_memory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / 'repo'
            self.fixture(root)
            setup.apply_changes(setup.plan_setup(root, ['codex'], {'schema_version': 1, 'memory': False, 'intent': {'directory': 'intent'}}))
            self.assertTrue(tomllib.loads((root / '.codex/config.toml').read_text())['memories']['use_memories'])

    def test_malformed_json_or_toml_fails_before_first_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / 'repo'
            self.fixture(root)
            for path in (root / '.claude/settings.json', root / '.codex/config.toml'):
                old = path.read_text()
                path.write_text('{broken')
                with self.assertRaises(ValueError):
                    setup.plan_setup(root, ['codex', 'claude'])
                self.assertFalse((root / '.project-context.json').exists())
                path.write_text(old)

    def test_one_option_preserves_existing_other_channel_and_conflicts_fail(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / 'repo'
            self.fixture(root)
            (root / 'decisions').mkdir()
            (root / 'shared-memory').mkdir()
            (root / 'shared-memory/INDEX.md').write_text('index')
            config = {'schema_version': 1, 'memory': {'directory': 'shared-memory', 'index': 'INDEX.md'}, 'intent': {'directory': 'intent'}}
            (root / '.project-context.json').write_text(json.dumps(config))
            result = subprocess.run([sys.executable, str(HERE / 'setup-project-context.py'), str(root), '--tools', 'codex', '--intent-directory', 'decisions'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            actual = json.loads((root / '.project-context.json').read_text())
            self.assertEqual(actual['memory'], config['memory'])
            self.assertEqual(actual['intent'], {'directory': 'decisions'})
            before = (root / '.project-context.json').read_bytes()
            result = subprocess.run([sys.executable, str(HERE / 'setup-project-context.py'), str(root), '--no-memory', '--memory-directory', 'docs/memory'], capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual((root / '.project-context.json').read_bytes(), before)

    def test_custom_index_rejected_before_write_for_claude_and_default_but_codex_supported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / 'repo'
            self.fixture(root)
            (root / 'docs/memory/INDEX.md').write_text('custom index')
            config = {'schema_version': 1, 'memory': {'directory': 'docs/memory', 'index': 'INDEX.md'}, 'intent': {'directory': 'intent'}}
            (root / '.project-context.json').write_text(json.dumps(config))
            before = {str(path.relative_to(root)): path.read_bytes() for path in root.rglob('*') if path.is_file()}
            for options in ([], ['--tools', 'claude'], ['--tools', 'codex,claude'], ['--preview'], ['--check']):
                result = subprocess.run([sys.executable, str(HERE / 'setup-project-context.py'), str(root), *options], capture_output=True, text=True)
                self.assertEqual(result.returncode, 1, result.stdout)
                self.assertIn('CLAUDE_NATIVE_MEMORY_UNSUPPORTED', result.stderr)
                self.assertEqual(before, {str(path.relative_to(root)): path.read_bytes() for path in root.rglob('*') if path.is_file()})
            result = subprocess.run([sys.executable, str(HERE / 'setup-project-context.py'), str(root), '--tools', 'codex'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads((root / '.project-context.json').read_text()), config)
            self.assertEqual((root / 'docs/memory/INDEX.md').read_text(), 'custom index')
            self.assertEqual((root / '.claude/settings.json').read_bytes(), before['.claude/settings.json'])

    def test_partial_write_failure_rolls_back(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            first, second = root / 'first', root / 'second'
            first.write_text('old')
            original = setup.os.replace
            def fail(source, destination):
                if destination == second:
                    raise OSError('fixture write failure')
                return original(source, destination)
            with patch.object(setup.os, 'replace', side_effect=fail):
                with self.assertRaises(OSError):
                    setup.apply_changes({first: 'new', second: 'new'})
            self.assertEqual(first.read_text(), 'old')
            self.assertFalse(second.exists())

    def test_json_hook_merge_preserves_same_event_and_is_idempotent(self):
        old = {'mcpServers': {'own': 1}, 'hooks': {'SessionStart': [{'hooks': [{'command': 'user'}]}]}}
        snippet = {'hooks': {'SessionStart': [{'hooks': [{'command': 'plugin'}]}]}}
        merged = merge.merge_hooks(old, snippet)
        self.assertEqual(len(merged['hooks']['SessionStart']), 2)
        self.assertEqual(merge.merge_hooks(merged, snippet), merged)
        self.assertEqual(old['mcpServers'], merged['mcpServers'])


class SnapshotTests(unittest.TestCase):
    def test_claude_runtime_markers_do_not_hide_payload_drift_or_unsafe_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary).resolve() / 'cache'
            (cache / '.codex-plugin').mkdir(parents=True)
            manifest = {'name': 'fixture', 'version': '1.0.0'}
            (cache / '.codex-plugin/plugin.json').write_text(json.dumps(manifest))
            expected = sync.tree_hashes(cache)
            marker = cache / '.in_use' / '12345'
            marker.parent.mkdir()
            marker.write_text('')
            sync.verify_snapshot(cache, manifest, expected, native_host='claude')
            with self.assertRaisesRegex(RuntimeError, 'extra='):
                sync.verify_snapshot(cache, manifest, expected, native_host='codex')
            (cache / 'extra.cjs').write_text('unexpected')
            with self.assertRaisesRegex(RuntimeError, 'extra='):
                sync.verify_snapshot(cache, manifest, expected, native_host='claude')
            (cache / 'extra.cjs').unlink()
            marker.unlink()
            marker.symlink_to(cache / '.codex-plugin/plugin.json')
            with self.assertRaisesRegex(RuntimeError, 'source link'):
                sync.verify_snapshot(cache, manifest, expected, native_host='claude')
            marker.unlink()
            marker.write_text('')
            marker.chmod(0o700)
            with self.assertRaisesRegex(RuntimeError, 'Invalid native Claude'):
                sync.verify_snapshot(cache, manifest, expected, native_host='claude')
            # Source/publication capture still includes markers as payload.
            self.assertIn('.in_use/12345', sync.tree_hashes(cache))

    def test_entire_payload_drift_and_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source, cache = root / 'source', root / 'cache'
            (source / '.codex-plugin').mkdir(parents=True)
            manifest = {'name': 'fixture', 'version': '1.0.0'}
            (source / '.codex-plugin/plugin.json').write_text(json.dumps(manifest))
            (source / 'hooks').mkdir()
            (source / 'hooks/runtime.cjs').write_text('original')
            shutil.copytree(source, cache)
            expected = sync.tree_hashes(source)
            sync.verify_snapshot(cache, manifest, expected)
            (cache / 'hooks/runtime.cjs').write_text('drift')
            with self.assertRaisesRegex(RuntimeError, 'changed='):
                sync.verify_snapshot(cache, manifest, expected)
            (cache / 'hooks/runtime.cjs').unlink()
            (cache / 'hooks/runtime.cjs').symlink_to(source / 'hooks/runtime.cjs')
            with self.assertRaisesRegex(RuntimeError, 'source link'):
                sync.verify_snapshot(cache, manifest, expected)
            (root / 'linked').symlink_to(source, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, 'unlinked'):
                sync.tree_hashes(root / 'linked')

    def test_selected_manifest_build_marker_preserves_other_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            plugin = root / 'plugins/fixture'
            for host in ('codex', 'claude', 'muse'):
                directory = plugin / f'.{host}-plugin'
                directory.mkdir(parents=True)
                (directory / 'plugin.json').write_text(json.dumps({'name': 'fixture', 'version': '1.2.3', 'custom': {'preserve': True}}))
            for family in ('.claude-plugin', '.agents/plugins'):
                directory = root / family
                directory.mkdir(parents=True)
                entry = {'name': 'fixture', 'version': '1.2.3', 'source': './plugins/fixture'} if family == '.claude-plugin' else {'name': 'fixture', 'source': {'source': 'local', 'path': './plugins/fixture'}}
                (directory / 'marketplace.json').write_text(json.dumps({'name': 'hibye-plugins', 'plugins': [entry, {'name': 'other', 'version': '9'}]}))
            with patch.object(sync, 'ROOT', root):
                versions = sync.refresh_build_versions(['fixture'])
                _, version, _ = sync.manifests('fixture')
                self.assertEqual(versions['fixture'], version)
                self.assertTrue(version.startswith('1.2.3+build.'))
                for host in ('codex', 'claude', 'muse'):
                    self.assertEqual(sync.read_json(plugin / f'.{host}-plugin/plugin.json'), {'name': 'fixture', 'version': version, 'custom': {'preserve': True}})
                self.assertEqual(sync.read_json(root / '.claude-plugin/marketplace.json')['plugins'][1], {'name': 'other', 'version': '9'})
                (plugin / '.muse-plugin/plugin.json').write_text(json.dumps({'name': 'fixture', 'version': 'wrong'}))
                with self.assertRaisesRegex(RuntimeError, 'Muse manifest'):
                    sync.manifests('fixture')

    def test_sync_only_calls_selected_native_host_then_readback(self):
        with patch.object(sync, 'manifests', return_value=(Path('/fixture'), '1', {})), patch.object(sync, 'tree_hashes', return_value={'runtime.cjs': 'digest'}), patch.object(sync, 'command', return_value='{}') as command, patch.object(sync, 'check_plugin') as check:
            sync.sync_plugin('fixture', ['codex'])
            command.assert_called_once_with('codex', 'plugin', 'add', 'fixture@hibye-plugins', '--json')
            check.assert_called_once_with('fixture', ['codex'], {'runtime.cjs': 'digest'})

    def test_native_failure_stops_before_next_host(self):
        calls = []
        def fail(*args):
            calls.append(args)
            raise RuntimeError('native failed')
        with patch.object(sync, 'manifests', return_value=(Path('/fixture'), '1', {})), patch.object(sync, 'tree_hashes', return_value={}), patch.object(sync, 'command', side_effect=fail), patch.object(sync, 'check_plugin') as check:
            with self.assertRaisesRegex(RuntimeError, 'native failed'):
                sync.sync_plugin('fixture', ['codex', 'claude'])
            self.assertEqual(len(calls), 1)
            check.assert_not_called()

    def test_inactive_installation_is_not_success(self):
        with patch.object(sync, 'manifests', return_value=(Path('/fixture'), '1', {'codex': {}})), patch.object(sync, 'tree_hashes', return_value={}), patch.object(sync, 'inspect_host', return_value={'version': '1', 'active': False, 'cache': Path('/fixture')}):
            with self.assertRaisesRegex(RuntimeError, 'activation mismatch'):
                sync.check_plugin('fixture', ['codex'])

    def test_link_cache_protects_snapshot_plugins_but_preserves_other_behavior(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / 'scripts').mkdir()
            shutil.copyfile(HERE / 'link-cache.sh', root / 'scripts/link-cache.sh')
            home = root / 'home'
            for name in ('state-ledger', 'project-context', 'spec-plan', 'agent-results', 'other'):
                source = root / 'plugins' / name
                (source / 'skills').mkdir(parents=True)
                for host in ('claude', 'codex'):
                    (source / f'.{host}-plugin').mkdir()
                    (source / f'.{host}-plugin/plugin.json').write_text(json.dumps({'name': name, 'version': '1.0.0'}))
                    cache = home / f'.{host}/plugins/cache/hibye-plugins' / name / '1.0.0'
                    cache.mkdir(parents=True)
                    (cache / 'sentinel').write_text('keep snapshot')
            for args in ([], ['--codex-dev-links']):
                subprocess.run(['bash', str(root / 'scripts/link-cache.sh'), *args], env={**os.environ, 'HIBYE_PLUGIN_CACHE_HOME': str(home)}, check=True, capture_output=True)
                for name in ('state-ledger', 'project-context', 'spec-plan', 'agent-results'):
                    for host in ('claude', 'codex'):
                        cache = home / f'.{host}/plugins/cache/hibye-plugins' / name
                        self.assertFalse((cache / '1.0.0').is_symlink())
                        self.assertEqual((cache / '1.0.0/sentinel').read_text(), 'keep snapshot')
                        self.assertFalse((cache / 'current').exists())
                self.assertTrue((home / '.claude/plugins/cache/hibye-plugins/other/1.0.0').is_symlink())



class FakeNativeHosts:
    """In-memory CLI behavior plus isolated registry/cache files; no native CLI runs."""
    def __init__(self, root):
        self.root = root
        self.home = root / 'claude-config'
        self.codex_home = root / 'codex-config'
        self.project = root / 'project'
        self.project.mkdir()
        self.project2 = root / 'project-two'
        self.project2.mkdir()
        self.calls = []
        self.fail = None
        self.skip_scope = None
        self.tamper_activation = False
        self.registry = {'version': 2, 'plugins': {}}
        self.codex = {}
        self.active = {}
        portable = {'name': 'hibye-plugins', 'owner': {'name': 'fixture'}, 'plugins': []}
        codex_catalog = {'name': 'hibye-plugins', 'plugins': []}
        for name in (*sync.HARNESS, 'backend-ts'):
            source = root / 'plugins' / name
            for host in ('codex', 'claude'):
                folder = source / f'.{host}-plugin'
                folder.mkdir(parents=True)
                (folder / 'plugin.json').write_text(json.dumps({'name': name, 'version': '1.0.0'}))
            (source / 'runtime.cjs').write_text('fixed original ' + name)
            portable['plugins'].append({'name': name, 'source': './plugins/' + name,
                'version': '1.0.0', 'custom': {'preserve': [name, 3]}})
            codex_catalog['plugins'].append({'name': name,
                'source': {'source': 'local', 'path': './plugins/' + name}})
            if name == 'backend-ts':
                continue
            cache = self.codex_home / 'plugins/cache/hibye-plugins' / name / '1.0.0'
            shutil.copytree(source, cache)
            self.codex[name] = {'pluginId': name + '@hibye-plugins', 'version': '1.0.0', 'enabled': True}
            targets = [('user', None)]
            if name == 'project-context':
                targets += [('project', str(self.project)), ('project', str(self.project2)), ('local', str(self.project))]
            records = []
            for scope, project in targets:
                cache = self.home / 'plugins/cache/hibye-plugins' / name / '1.0.0'
                if not cache.exists():
                    shutil.copytree(source, cache)
                record = {'scope': scope, 'version': '1.0.0', 'installPath': str(cache), 'gitCommitSha': 'old-development-head'}
                if project:
                    record['projectPath'] = project
                records.append(record)
                key = (name, scope, project)
                self.active[key] = not (scope == 'local' or name == 'state-ledger')
                normalized = {'scope': scope, 'projectPath': project}
                settings = self.settings_path(normalized)
                settings.parent.mkdir(parents=True, exist_ok=True)
                value = json.loads(settings.read_text()) if settings.exists() else {'unrelated': {'keep': True}}
                value.setdefault('enabledPlugins', {})[name + '@hibye-plugins'] = self.active[key]
                settings.write_text(json.dumps(value))
            self.registry['plugins'][name + '@hibye-plugins'] = records
        for folder, content in (('.claude-plugin', portable), ('.agents/plugins', codex_catalog)):
            path = root / folder / 'marketplace.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(content))
        self.write_registry()
        self.write_known(root)
        self.listing = portable

    def settings_path(self, record):
        if record['scope'] == 'user':
            return self.home / 'settings.json'
        return Path(record['projectPath']) / '.claude' / ('settings.local.json' if record['scope'] == 'local' else 'settings.json')

    def write_registry(self):
        path = self.home / 'plugins/installed_plugins.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.registry))

    def write_known(self, location):
        self.catalog_root = Path(location)
        path = self.home / 'plugins/known_marketplaces.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'hibye-plugins': {'source': {'source': 'directory', 'path': str(location)}, 'installLocation': str(location)}}))

    def command(self, *args, cwd=None):
        self.calls.append((args, str(cwd) if cwd else None))
        if self.fail and self.fail(args, cwd):
            raise RuntimeError('fixture native partial failure')
        if args[:3] == ('codex', 'plugin', 'list'):
            return json.dumps({'installed': list(self.codex.values())})
        if args[:3] == ('codex', 'plugin', 'add'):
            name = args[3].split('@')[0]
            source = self.root / 'plugins' / name
            version = json.loads((source / '.codex-plugin/plugin.json').read_text())['version']
            cache = self.codex_home / 'plugins/cache/hibye-plugins' / name / version
            if not cache.exists():
                shutil.copytree(source, cache)
            self.codex[name] = {'pluginId': name + '@hibye-plugins', 'version': version, 'enabled': True}
            return '{}'
        if args[:3] == ('claude', 'plugin', 'list'):
            result = []
            for plugin_id, records in self.registry['plugins'].items():
                name = plugin_id.split('@')[0]
                for record in records:
                    item = {'id': plugin_id, **record, 'enabled': self.active[(name, record['scope'], record.get('projectPath'))]}
                    source = next(entry for entry in self.listing['plugins'] if entry['name'] == name)['source']
                    if isinstance(source, str):
                        item['readFromFolder'] = str(self.root / source[2:])
                    result.append(item)
            return json.dumps(result)
        if args[:4] == ('claude', 'plugin', 'marketplace', 'add'):
            self.write_known(Path(args[4]))
            # Deliberately keep the old native listing until explicit refresh.
            return '{}'
        if args[:4] == ('claude', 'plugin', 'marketplace', 'update'):
            self.listing = json.loads((self.catalog_root / '.claude-plugin/marketplace.json').read_text())
            return '{}'
        if args[:3] in (('claude', 'plugin', 'update'), ('claude', 'plugin', 'install')):
            name = args[3].split('@')[0]
            scope = args[args.index('--scope') + 1]
            project = str(cwd) if scope != 'user' else None
            if (scope, project) == self.skip_scope:
                return '{}'
            entry = next(item for item in self.listing['plugins'] if item['name'] == name)
            if not isinstance(entry['source'], dict) or entry['source'].get('source') != 'url':
                raise RuntimeError('fixture refuses in-place selected source')
            from urllib.parse import urlparse, unquote
            publication_root = Path(unquote(urlparse(entry['source']['url']).path))
            version = entry['version']
            cache = self.home / 'plugins/cache/hibye-plugins' / name / version
            # Like a native cache, an existing same-version snapshot is reused.
            if not cache.exists():
                cache.mkdir(parents=True)
                for source in publication_root.iterdir():
                    if source.name == '.git':
                        continue
                    target = cache / source.name
                    shutil.copytree(source, target) if source.is_dir() else shutil.copy2(source, target)
            records = self.registry['plugins'].setdefault(name + '@hibye-plugins', [])
            item = next((record for record in records if record['scope'] == scope and record.get('projectPath') == project), None)
            if item is None:
                item = {'scope': scope}
                if project:
                    item['projectPath'] = project
                records.append(item)
                self.active[(name, scope, project)] = True
            item.update(version=version, installPath=str(cache), gitCommitSha=sync.publication.git(publication_root, 'rev-parse', 'HEAD'))
            if self.tamper_activation:
                path = self.settings_path({'scope': scope, 'projectPath': project})
                data = json.loads(path.read_text())
                data['enabledPlugins'][name + '@hibye-plugins'] = True
                path.write_text(json.dumps(data))
            self.write_registry()
            return '{}'
        raise AssertionError('Unexpected fake CLI operation: ' + repr(args))


class HarnessUpdateTests(unittest.TestCase):
    def configured(self, root):
        fake = FakeNativeHosts(root)
        return fake, patch.multiple(sync, ROOT=root, command=fake.command), patch.dict(os.environ, {
            'CLAUDE_CONFIG_DIR': str(fake.home), 'CODEX_HOME': str(fake.codex_home)})

    def run_cli(self, *args):
        with patch.object(sys, 'argv', ['sync-plugins.py', *args]), patch.object(sync.shutil, 'which', return_value='/fixture/cli'), redirect_stdout(io.StringIO()) as output, redirect_stderr(io.StringIO()) as errors:
            status = sync.main()
        return status, output.getvalue(), errors.getvalue()

    def file_state(self, root):
        return {str(path.relative_to(root)): ('link', os.readlink(path)) if path.is_symlink() else ('file', path.read_bytes(), path.stat().st_mode & 0o777) for path in root.rglob('*') if path.is_file() or path.is_symlink()}

    def test_red_old_local_relative_read_from_folder_is_not_snapshot_acceptance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            with patched, environment:
                # Bytes and native installPath already match source; this was the
                # old false positive. readFromFolder is the effective execution.
                with self.assertRaisesRegex(RuntimeError, 'in-place readFromFolder'):
                    sync.inspect_host('claude', 'project-context')
                status, _, error = self.run_cli('--harness', '--check')
                self.assertEqual(status, 1)
                self.assertIn('canonical publication catalog root', error)

    def test_harness_publishes_both_hosts_all_scopes_preserves_activation_and_other_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            with patched, environment:
                activations = {path: path.read_bytes() for path in (fake.home / 'settings.json', fake.project / '.claude/settings.json', fake.project / '.claude/settings.local.json', fake.project2 / '.claude/settings.json')}
                portable = (root / '.claude-plugin/marketplace.json').read_bytes()
                status, output, error = self.run_cli('--harness')
                self.assertEqual(status, 0, error)
                self.assertIn('All selected installations verified', output)
                self.assertEqual(activations, {path: path.read_bytes() for path in activations})
                catalog = json.loads(sync.catalog_path().read_text())
                other = next(item for item in catalog['plugins'] if item['name'] == 'backend-ts')
                self.assertEqual(other, json.loads(portable)['plugins'][-1])
                alias = sync.catalog_root() / 'plugins/backend-ts'
                self.assertTrue(alias.is_symlink())
                self.assertEqual(alias.resolve(), root / 'plugins/backend-ts')
                self.assertFalse(any('backend-ts@' in ' '.join(args) for args, _ in fake.calls))
                updates = [(args, cwd) for args, cwd in fake.calls if args[:3] == ('claude', 'plugin', 'update') and args[3] == 'project-context@hibye-plugins']
                self.assertEqual({(args[args.index('--scope')+1], cwd) for args, cwd in updates}, {('user', None), ('project', str(fake.project)), ('project', str(fake.project2)), ('local', str(fake.project))})
                self.assertTrue(any(args[:4] == ('claude', 'plugin', 'marketplace', 'update') for args, _ in fake.calls))
                self.assertEqual(self.run_cli('--harness', '--check')[0], 0)

    def test_preview_and_check_do_not_publish_bump_write_catalog_or_mutate_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            with patched, environment:
                before = self.file_state(root)
                self.assertEqual(self.run_cli('--harness', '--preview')[0], 0)
                self.assertEqual(before, self.file_state(root))
                self.assertEqual(self.run_cli('--harness', '--check')[0], 1)
                self.assertEqual(before, self.file_state(root))
                self.assertFalse(any(args[:3] in (('codex', 'plugin', 'add'), ('claude', 'plugin', 'update'), ('claude', 'plugin', 'install')) or args[:3] == ('claude', 'plugin', 'marketplace') for args, _ in fake.calls))

    def test_changed_payload_only_bumps_that_plugin_and_second_run_is_stable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            with patched, environment:
                self.assertEqual(self.run_cli('--harness')[0], 0)
                old = {name: sync.manifests(name)[1] for name in sync.HARNESS}
                old_catalog = sync.catalog_path().read_bytes()
                old_publications = sorted(str(path) for path in sync.publication.default_base().glob('*/*') if path.is_dir())
                self.assertEqual(self.run_cli('--harness')[0], 0)
                self.assertEqual(old, {name: sync.manifests(name)[1] for name in sync.HARNESS})
                self.assertEqual(old_catalog, sync.catalog_path().read_bytes())
                self.assertEqual(old_publications, sorted(str(path) for path in sync.publication.default_base().glob('*/*') if path.is_dir()))
                target, payload = sync.publication_for('project-context')
                published_before = self.file_state(target)
                (root / 'plugins/project-context/runtime.cjs').write_text('edited development payload')
                self.assertEqual(published_before, self.file_state(target))
                result = self.run_cli('--harness')
                self.assertEqual(result[0], 0, result[2])
                new = {name: sync.manifests(name)[1] for name in sync.HARNESS}
                self.assertNotEqual(old['project-context'], new['project-context'])
                self.assertEqual(old['state-ledger'], new['state-ledger'])
                self.assertEqual(old['spec-plan'], new['spec-plan'])
                self.assertEqual(published_before, self.file_state(target))

    def test_bundle_conflicts_fail_before_native_calls(self):
        with patch.object(sync, 'command') as command:
            for args in (('--harness', '--plugin', 'backend-ts'), ('--harness', '--host', 'muse'), ('--harness', '--build-marker')):
                self.assertEqual(self.run_cli(*args)[0], 1)
            command.assert_not_called()

    def test_native_partial_failure_is_nonzero_names_scope_and_preserves_existing_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            with patched, environment:
                fake.fail = lambda args, cwd: args[:3] == ('claude', 'plugin', 'update') and cwd == fake.project
                status, output, error = self.run_cli('--harness')
                self.assertEqual(status, 1)
                self.assertIn('scope=project', error)
                self.assertIn('Partial update possible', error)
                self.assertNotIn('All selected installations verified', output)
                self.assertEqual(len(fake.registry['plugins']['project-context@hibye-plugins']), 4)
                self.assertFalse(any(args[:3] == ('claude', 'plugin', 'uninstall') for args, _ in fake.calls))

    def test_stale_or_silently_skipped_scope_and_activation_changes_are_failures(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            with patched, environment:
                fake.skip_scope = ('project', str(fake.project))
                status, _, error = self.run_cli('--harness')
                self.assertEqual(status, 1)
                self.assertIn('scope=project', error)
                fake.skip_scope = None
                fake.tamper_activation = True
                status, _, error = self.run_cli('--harness')
                self.assertEqual(status, 1)
                self.assertIn('activation setting', error)

    def test_missing_scope_directory_fails_before_any_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            shutil.rmtree(fake.project2)
            with patched, environment:
                before = self.file_state(root)
                self.assertEqual(self.run_cli('--harness')[0], 1)
                self.assertEqual(before, self.file_state(root))

    def test_codex_disabled_anywhere_in_bundle_fails_before_first_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            fake.codex['spec-plan']['enabled'] = False
            with patched, environment:
                before = self.file_state(root)
                status, _, error = self.run_cli('--harness')
                self.assertEqual(status, 1)
                self.assertIn('codex/spec-plan is disabled', error)
                self.assertEqual(before, self.file_state(root))
                self.assertFalse(any(args[:3] == ('codex', 'plugin', 'add') or args[:3] == ('claude', 'plugin', 'marketplace') for args, _ in fake.calls))

    def test_current_unselected_metadata_and_moved_source_root_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            with patched, environment:
                self.assertEqual(self.run_cli('--harness')[0], 0)
                portable_path = root / '.claude-plugin/marketplace.json'
                portable = json.loads(portable_path.read_text())
                other = next(item for item in portable['plugins'] if item['name'] == 'backend-ts')
                other.update(source='./plugins/backend-ts-moved', version='2.0.0', custom={'new': ['metadata']})
                (root / 'plugins/backend-ts').rename(root / 'plugins/backend-ts-moved')
                portable_path.write_text(json.dumps(portable))
                result = self.run_cli('--harness')
                self.assertEqual(result[0], 0, result[2])
                generated = json.loads(sync.catalog_path().read_text())
                self.assertEqual(next(item for item in generated['plugins'] if item['name'] == 'backend-ts'), other)
                self.assertFalse((sync.catalog_root() / 'plugins/backend-ts').exists())
                self.assertFalse((sync.catalog_root() / 'plugins/backend-ts').is_symlink())
                self.assertEqual((sync.catalog_root() / 'plugins/backend-ts-moved').resolve(), root / 'plugins/backend-ts-moved')

    def test_published_payload_and_git_metadata_are_read_only_and_mutation_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fake, patched, environment = self.configured(root)
            with patched, environment:
                self.assertEqual(self.run_cli('--harness')[0], 0)
                target, payload = sync.publication_for('project-context')
                self.assertEqual(sync.publication.publish('project-context', payload), target)
                file = target / 'runtime.cjs'
                self.assertFalse(file.stat().st_mode & 0o222)
                file.chmod(0o644)
                with self.assertRaisesRegex(RuntimeError, 'writable'):
                    sync.publication.verify_publication(target, payload)



if __name__ == '__main__':
    unittest.main()
