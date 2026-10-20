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
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('distribution_fixture', HERE / 'test-project-context-distribution.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sync = fixture.sync
transaction = sync.transaction


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.fake = fixture.FakeNativeHosts(self.root)
        self.addCleanup(patch.stopall)
        patch.multiple(sync, ROOT=self.root, command=self.fake.command).start()
        patch.dict(os.environ, {'CLAUDE_CONFIG_DIR': str(self.fake.home),
                               'CODEX_HOME': str(self.fake.codex_home)}).start()

    def run_cli(self, *args):
        return fixture.HarnessUpdateTests().run_cli(*args)

    def state(self, root=None):
        return fixture.HarnessUpdateTests().file_state(root or self.root)

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
            if not hit and path == self.root / 'plugins/state-ledger/.codex-plugin/plugin.json':
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
            sync.manifests('state-ledger')
        self.success_and_repeat()

    def test_pending_recovery_rejects_external_source_edit_without_replaying_other_files(self):
        self.fail_source_once()
        target = self.root / 'plugins/spec-plan/.codex-plugin/plugin.json'
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
        target = self.root / 'plugins/state-ledger/.codex-plugin/plugin.json'
        edited = []

        def manifests(name, snapshots=None):
            result = original(name, snapshots)
            if snapshots is not None and name == 'state-ledger' and not edited:
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
            status, _, error = self.run_cli('--plugin', 'project-context', '--host', 'codex')
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
            sync.manifests('state-ledger')
        self.success_and_repeat()

    def test_updaters_serialize_source_and_shared_catalog_without_lost_journal(self):
        # Real forked main calls share persisted fake CLI state, not installations.
        self.assertEqual(self.run_cli('--harness')[0], 0)
        baseline_root = self.root
        second_root = self.moved_source()
        self.fake.root = baseline_root
        sync.ROOT = baseline_root
        (baseline_root / 'plugins/project-context/runtime.cjs').write_text('first updater source edit')
        (second_root / 'plugins/state-ledger/runtime.cjs').write_text('second updater source edit')
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
