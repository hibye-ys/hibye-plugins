#!/usr/bin/env python3
"""Local interruption/concurrency regressions using only isolated fake native hosts."""
import errno
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sync = load('sync_plugins', 'sync-plugins.py')
transaction = sync.transaction


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
            if name == 'work-context':
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
                self.active[key] = not (scope == 'local' or name == 'agent-results')
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
        # Like the native CLI, read the registry file each time; the sync may edit it.
        self.registry = json.loads((self.home / 'plugins/installed_plugins.json').read_text())
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
            if '--json' in args:
                raise RuntimeError('native marketplace add does not support --json')
            self.write_known(Path(args[4]))
            # Deliberately keep the old native listing until explicit refresh.
            return '{}'
        if args[:4] == ('claude', 'plugin', 'marketplace', 'update'):
            if '--json' in args:
                raise RuntimeError('native marketplace update does not support --json')
            self.listing = json.loads((self.catalog_root / '.claude-plugin/marketplace.json').read_text())
            return '{}'
        if args[:3] in (('claude', 'plugin', 'update'), ('claude', 'plugin', 'install')):
            if '--json' in args or '-y' in args:
                raise RuntimeError('native plugin mutation received unsupported flags')
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
                cache.parent.mkdir(parents=True, exist_ok=True)
                subprocess.run(['git', 'clone', '--quiet', '--depth=1', publication_root.as_uri(), str(cache)], check=True, capture_output=True)
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


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.fake = FakeNativeHosts(self.root)
        self.addCleanup(patch.stopall)
        patch.multiple(sync, ROOT=self.root, command=self.fake.command).start()
        patch.dict(os.environ, {'CLAUDE_CONFIG_DIR': str(self.fake.home),
                               'CODEX_HOME': str(self.fake.codex_home)}).start()

    def run_cli(self, *args):
        with patch.object(sys, 'argv', ['sync-plugins.py', *args]), patch.object(sync.shutil, 'which', return_value='/fixture/cli'), redirect_stdout(io.StringIO()) as output, redirect_stderr(io.StringIO()) as errors:
            status = sync.main()
        return status, output.getvalue(), errors.getvalue()

    def state(self, root=None):
        target = root or self.root
        return {str(path.relative_to(target)): ('link', os.readlink(path)) if path.is_symlink() else ('file', path.read_bytes(), path.stat().st_mode & 0o777) for path in target.rglob('*') if path.is_file() or path.is_symlink()}

    def mutation_count(self):
        return sum(args[:3] in (('codex', 'plugin', 'add'), ('claude', 'plugin', 'update'),
                               ('claude', 'plugin', 'install'), ('claude', 'plugin', 'marketplace'))
                   for args, _ in self.fake.calls)

    def success_and_repeat(self):
        status, _, error = self.run_cli('--harness')
        self.assertEqual(status, 0, error)
        versions = {name: sync.manifests(name)[1] for name in sync.HARNESS}
        source_bytes = {str(path): path.read_bytes() for path in (self.root / 'plugins').rglob('plugin.json')}
        catalog = sync.catalog_path().read_bytes()
        catalog_mtime = sync.catalog_path().stat().st_mtime_ns
        status, _, error = self.run_cli('--harness')
        self.assertEqual(status, 0, error)
        self.assertEqual(versions, {name: sync.manifests(name)[1] for name in sync.HARNESS})
        self.assertEqual(source_bytes, {str(path): path.read_bytes() for path in (self.root / 'plugins').rglob('plugin.json')})
        self.assertEqual(catalog, sync.catalog_path().read_bytes())
        self.assertEqual(catalog_mtime, sync.catalog_path().stat().st_mtime_ns)
        self.assertFalse(sync.manifest_journal().exists())
        self.assertFalse(sync.alias_journal().exists())
        self.assertFalse(list((self.root / 'plugins').rglob('.plugin-sync-*')))

    def fail_source_once(self):
        original = transaction.atomic_file
        hit = []

        def fail(path, *args, **kwargs):
            if not hit and path == self.root / 'plugins/agent-results/.codex-plugin/plugin.json':
                hit.append(path)
                raise OSError(errno.ENOSPC, 'fixture source staging failure')
            return original(path, *args, **kwargs)

        with patch.object(transaction, 'atomic_file', side_effect=fail):
            status, _, error = self.run_cli('--harness')
        self.assertEqual(status, 1)
        self.assertIn('fixture source staging failure', error)
        self.assertEqual(len(hit), 1)
        self.assertTrue(sync.manifest_journal().exists())
        self.assertEqual(self.mutation_count(), 0)

    def test_partial_staging_write_leaves_valid_original_then_retry_repeat(self):
        target = self.root / '.claude-plugin/marketplace.json'
        before = target.read_bytes()
        original_atomic, original_fdopen = transaction.atomic_file, transaction.os.fdopen
        hit = []

        class PartialStream:
            def __init__(self, stream):
                self.stream = stream
            def __enter__(self):
                return self
            def __exit__(self, *args):
                self.stream.close()
            def write(self, value):
                self.stream.write(value[:7])
                self.stream.flush()
                raise OSError(errno.ENOSPC, 'fixture partial staging write')

        def atomic(path, *args, **kwargs):
            if path == target and not hit:
                hit.append(path)
                with patch.object(transaction.os, 'fdopen', side_effect=lambda *a, **k: PartialStream(original_fdopen(*a, **k))):
                    return original_atomic(path, *args, **kwargs)
            return original_atomic(path, *args, **kwargs)

        with patch.object(transaction, 'atomic_file', side_effect=atomic):
            status, _, error = self.run_cli('--harness')
        self.assertEqual(status, 1)
        self.assertIn('partial staging write', error)
        self.assertEqual(target.read_bytes(), before)
        json.loads(target.read_bytes())
        self.assertEqual(self.mutation_count(), 0)
        self.success_and_repeat()

    def test_coupled_manifest_failure_recovers_before_manifest_validation(self):
        self.fail_source_once()
        marketplace = json.loads((self.root / '.claude-plugin/marketplace.json').read_bytes())
        self.assertNotEqual(marketplace['plugins'][0]['version'], '1.0.0')
        with self.assertRaisesRegex(RuntimeError, 'Marketplace path/version mismatch'):
            sync.manifests('agent-results')
        self.success_and_repeat()

    def test_pending_recovery_rejects_external_source_edit_without_replaying_other_files(self):
        self.fail_source_once()
        target = self.root / 'plugins/work-context/.codex-plugin/plugin.json'
        data = json.loads(target.read_bytes())
        data['description'] = 'external edit after interruption'
        target.write_text(json.dumps(data))
        before = self.state()
        status, _, error = self.run_cli('--harness')
        self.assertEqual(status, 1)
        self.assertIn('external edit preserved', error)
        self.assertEqual(before, self.state())
        self.assertEqual(self.mutation_count(), 0)

    def test_parsed_bytes_are_the_cas_baseline_and_edit_survives_retry(self):
        original = sync.manifests
        target = self.root / 'plugins/agent-results/.codex-plugin/plugin.json'
        edited = []

        def manifests(name, snapshots=None):
            result = original(name, snapshots)
            if snapshots is not None and name == 'agent-results' and not edited:
                data = json.loads(target.read_bytes())
                data['description'] = 'concurrent metadata must survive'
                target.write_text(json.dumps(data))
                edited.append(target.read_bytes())
            return result

        with patch.object(sync, 'manifests', side_effect=manifests):
            status, _, error = self.run_cli('--harness')
        self.assertEqual(status, 1)
        self.assertIn('external edit preserved', error)
        self.assertEqual(target.read_bytes(), edited[0])
        self.assertEqual(self.mutation_count(), 0)
        self.success_and_repeat()
        self.assertEqual(json.loads(target.read_bytes())['description'], 'concurrent metadata must survive')

    def moved_source(self):
        destination = self.root / 'source-b'
        destination.mkdir()
        for relative in ('plugins', '.claude-plugin', '.agents'):
            shutil.copytree(self.root / relative, destination / relative)
        self.fake.root = destination
        sync.ROOT = destination
        return destination

    def fail_alias_ledger_once(self):
        self.assertEqual(self.run_cli('--harness')[0], 0)
        self.fake.calls.clear()
        previous_source = self.root
        destination = self.moved_source()
        ledger = sync.catalog_root() / '.owned-source-links.json'
        old_ledger = ledger.read_bytes()
        original = transaction.atomic_file
        hit = []

        def atomic(path, *args, **kwargs):
            if path == ledger and not hit:
                hit.append(path)
                raise OSError(errno.ENOSPC, 'fixture alias ledger write')
            return original(path, *args, **kwargs)

        with patch.object(transaction, 'atomic_file', side_effect=atomic):
            status, _, error = self.run_cli('--harness')
        self.assertEqual(status, 1)
        self.assertIn('fixture alias ledger write', error)
        alias = sync.catalog_root() / 'plugins/backend-ts'
        self.assertEqual(os.readlink(alias), str(destination / 'plugins/backend-ts'))
        self.assertEqual(ledger.read_bytes(), old_ledger)
        self.assertIn(str(previous_source), old_ledger.decode())
        self.assertTrue(sync.alias_journal().exists())
        self.assertEqual(self.mutation_count(), 0)
        return destination, alias, ledger

    def test_alias_replaced_then_ledger_failure_recovers_on_same_command(self):
        destination, alias, ledger = self.fail_alias_ledger_once()
        status, _, error = self.run_cli('--harness')
        self.assertEqual(status, 0, error)
        self.assertEqual(json.loads(ledger.read_bytes())['plugins/backend-ts'], str(destination / 'plugins/backend-ts'))
        before = alias.lstat().st_ino, ledger.stat().st_mtime_ns, ledger.read_bytes()
        self.assertEqual(self.run_cli('--harness')[0], 0)
        self.assertEqual(before, (alias.lstat().st_ino, ledger.stat().st_mtime_ns, ledger.read_bytes()))
        self.assertFalse(sync.alias_journal().exists())

    def test_codex_only_main_preserves_pending_claude_alias_transaction(self):
        self.fail_alias_ledger_once()
        base = sync.publication.default_base()
        before = self.state(base)
        self.fake.calls.clear()
        # No Claude base is even consulted when only Codex is selected.
        with patch.object(sync.publication, 'default_base', side_effect=AssertionError('Codex-only selected Claude storage')):
            status, _, error = self.run_cli('--plugin', 'work-context', '--host', 'codex')
        self.assertEqual(status, 0, error)
        self.assertEqual(before, self.state(base))
        self.assertTrue(sync.alias_journal().exists())
        self.assertFalse(any(args[0] == 'claude' for args, _ in self.fake.calls))

    def test_alias_recovery_rejects_external_retargeting(self):
        _, alias, _ = self.fail_alias_ledger_once()
        alias.unlink()
        alias.symlink_to(self.root / 'external-owner')
        before = self.state()
        status, _, error = self.run_cli('--harness')
        self.assertEqual(status, 1)
        self.assertIn('external edit preserved', error)
        self.assertEqual(before, self.state())
        self.assertEqual(self.mutation_count(), 0)

    def test_readonly_modes_do_not_create_locks_or_recover_pending_transactions(self):
        for option in ('--preview', '--check'):
            before = self.state()
            self.run_cli('--harness', option)
            self.assertEqual(before, self.state())
        self.assertFalse((self.root / '.plugin-sync.lock').exists())
        self.assertFalse(sync.publication.default_base().exists())
        self.fail_source_once()
        for option in ('--preview', '--check'):
            before = self.state()
            self.assertEqual(self.run_cli('--harness', option)[0], 1)
            self.assertEqual(before, self.state())
        self.assertEqual(self.mutation_count(), 0)
        self.success_and_repeat()

    def test_sigkill_after_first_coupled_replace_recovers_with_same_main_command(self):
        child = os.fork()
        if child == 0:
            original = transaction.os.replace
            def replace(source, target):
                original(source, target)
                if Path(target) == self.root / '.claude-plugin/marketplace.json':
                    os.kill(os.getpid(), signal.SIGKILL)
            with patch.object(transaction.os, 'replace', side_effect=replace):
                self.run_cli('--harness')
            os._exit(92)
        _, status = os.waitpid(child, 0)
        self.assertTrue(os.WIFSIGNALED(status))
        self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
        self.assertTrue(sync.manifest_journal().exists())
        with self.assertRaisesRegex(RuntimeError, 'Marketplace path/version mismatch'):
            sync.manifests('agent-results')
        self.success_and_repeat()

    def test_updaters_serialize_source_and_shared_catalog_without_lost_journal(self):
        # Real forked main calls share persisted fake CLI state, not installations.
        self.assertEqual(self.run_cli('--harness')[0], 0)
        baseline_root = self.root
        second_root = self.moved_source()
        self.fake.root = baseline_root
        sync.ROOT = baseline_root
        (baseline_root / 'plugins/work-context/runtime.cjs').write_text('first updater source edit')
        (second_root / 'plugins/agent-results/runtime.cjs').write_text('second updater source edit')
        state_path = baseline_root / 'fake-native-state.json'

        def save_state():
            temporary = state_path.with_suffix('.new-' + str(os.getpid()))
            temporary.write_text(json.dumps({'registry': self.fake.registry, 'codex': self.fake.codex, 'listing': self.fake.listing}))
            os.replace(temporary, state_path)
        save_state()
        original_command = self.fake.command
        def persistent_command(*args, **kwargs):
            state = json.loads(state_path.read_bytes())
            self.fake.registry, self.fake.codex, self.fake.listing = state['registry'], state['codex'], state['listing']
            result = original_command(*args, **kwargs)
            save_state()
            return result
        sync.command = persistent_command
        prepared_r, prepared_w = os.pipe()
        release_r, release_w = os.pipe()
        attempting_r, attempting_w = os.pipe()
        first = os.fork()
        if first == 0:
            original = transaction.atomic_file
            paused = []
            def atomic(path, *args, **kwargs):
                result = original(path, *args, **kwargs)
                if path == sync.manifest_journal() and not paused:
                    paused.append(True)
                    os.write(prepared_w, b'prepared')
                    os.read(release_r, 1)
                return result
            with patch.object(transaction, 'atomic_file', side_effect=atomic):
                status = self.run_cli('--harness')[0]
            os._exit(status)
        children = [first]
        try:
            self.assertTrue(select.select([prepared_r], [], [], 20)[0], 'first updater did not prepare')
            self.assertEqual(os.read(prepared_r, 8), b'prepared')
            journal_path = sync.manifest_journal()
            journal_before = journal_path.read_bytes()
            second = os.fork()
            if second == 0:
                sync.ROOT = second_root
                self.fake.root = second_root
                original = transaction.fcntl.flock
                calls = []
                def flock(descriptor, operation):
                    calls.append(descriptor)
                    if len(calls) == 2:
                        os.write(attempting_w, b'attempt')
                    return original(descriptor, operation)
                with patch.object(transaction.fcntl, 'flock', side_effect=flock):
                    status, _, error = self.run_cli('--harness')
                if status:
                    os.write(2, error.encode())
                os._exit(status)
            children.append(second)
            self.assertTrue(select.select([attempting_r], [], [], 20)[0], 'second updater did not attempt shared lock')
            self.assertEqual(os.read(attempting_r, 7), b'attempt')
            self.assertEqual(journal_before, journal_path.read_bytes())
            self.assertFalse((second_root / '.plugin-sync-manifests.json').exists())
            os.write(release_w, b'1')
            for child in children:
                _, status = os.waitpid(child, 0)
                self.assertTrue(os.WIFEXITED(status), status)
                self.assertEqual(os.WEXITSTATUS(status), 0)
            children.clear()
        finally:
            for child in children:
                try:
                    os.kill(child, signal.SIGKILL)
                    os.waitpid(child, 0)
                except ProcessLookupError:
                    pass
            for descriptor in (prepared_r, prepared_w, release_r, release_w, attempting_r, attempting_w):
                os.close(descriptor)
        sync.ROOT, self.fake.root = second_root, second_root
        ledger = json.loads((sync.catalog_root() / '.owned-source-links.json').read_bytes())
        self.assertEqual(ledger['plugins/backend-ts'], str(second_root / 'plugins/backend-ts'))
        self.assertEqual(os.readlink(sync.catalog_root() / 'plugins/backend-ts'), ledger['plugins/backend-ts'])
        self.assertFalse(sync.alias_journal().exists())
        self.assertFalse((baseline_root / '.plugin-sync-manifests.json').exists())
        self.assertFalse((second_root / '.plugin-sync-manifests.json').exists())
        for source_root in (baseline_root, second_root):
            with patch.object(sync, 'ROOT', source_root):
                for name in sync.HARNESS:
                    sync.manifests(name)
        self.assertEqual(self.run_cli('--harness')[0], 0)


if __name__ == '__main__':
    unittest.main()
