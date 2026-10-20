#!/usr/bin/env python3
"""Publication failure-boundary regressions; only isolated temporary repositories."""
import errno
import importlib.util
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('plugin_publication', HERE / 'plugin_publication.py')
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)
PAYLOAD = {'plugin.json': (b'{"name":"fixture"}\n', False),
           'runtime/run.cjs': (b'#!/usr/bin/env node\nconsole.log("fixture");\n', True)}


def make_writable(directory):
    for path in (directory, *directory.rglob('*')):
        if path.is_dir() and not path.is_symlink():
            path.chmod(path.stat().st_mode | 0o700)


def writable_repository(target):
    target.mkdir(parents=True)
    for name, (data, executable) in PAYLOAD.items():
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(0o755 if executable else 0o644)
    publication.git(target, 'init', '--quiet')
    publication.git(target, 'add', '--all')
    publication.git(target, 'commit', '--quiet', '-m', 'fixture')


CHILD = r'''
import importlib.util, os, pathlib, signal, sys, time
module_path, base, mode, marker, gate = sys.argv[1:]
spec = importlib.util.spec_from_file_location('publication', module_path)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
payload = {'plugin.json': (b'{"name":"fixture"}\n', False),
           'runtime/run.cjs': (b'#!/usr/bin/env node\nconsole.log("fixture");\n', True)}
original = p.os.rename
def rename(source, target):
    p.verify_publication(source, payload)
    if mode == 'after':
        original(source, target)
    pathlib.Path(marker).write_text(str(source))
    if mode == 'concurrent':
        deadline = time.monotonic() + 15
        while not pathlib.Path(gate).exists():
            if time.monotonic() >= deadline:
                raise RuntimeError('publication test gate timed out')
            time.sleep(0.01)
        return original(source, target)
    signal.pause()
p.os.rename = rename
p.publish('fixture', payload, pathlib.Path(base))
'''


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix='publication-regression-')
        self.root = Path(self.fixture.name).resolve()
        self.base = self.root / 'publications'
        self.target = publication.publication_path('fixture', PAYLOAD, self.base)

    def tearDown(self):
        make_writable(self.root)
        self.fixture.cleanup()

    def publish(self):
        return publication.publish('fixture', PAYLOAD, self.base)

    def assert_complete(self):
        self.assertEqual(publication.verify_publication(self.target, PAYLOAD), self.target)
        self.assertEqual(self.publish(), self.target)
        self.assertEqual(self.publish(), self.target)

    def assert_no_staging(self):
        self.assertEqual(list(self.target.parent.glob('.publishing-*')), [])

    def child(self, mode, marker, gate=None):
        return subprocess.Popen([sys.executable, '-B', '-c', CHILD,
            str(HERE / 'plugin_publication.py'), str(self.base), mode,
            str(marker), str(gate or self.root / 'unused-gate')],
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def await_marker(self, child, marker):
        deadline = time.monotonic() + 15
        while not marker.exists():
            if child.poll() is not None:
                stdout, stderr = child.communicate()
                self.fail(f'child exited before boundary: {stdout}\n{stderr}')
            if time.monotonic() >= deadline:
                self.fail('child did not reach publication boundary')
            time.sleep(0.01)

    def test_single_chmod_failure_leaves_no_public_target_and_retry_succeeds(self):
        chmod = Path.chmod
        failed = False
        def fail_once(path, mode, *args, **kwargs):
            nonlocal failed
            if not failed and not mode & 0o222:
                failed = True
                raise OSError(errno.EIO, 'injected seal failure')
            return chmod(path, mode, *args, **kwargs)
        with patch.object(Path, 'chmod', fail_once):
            with self.assertRaisesRegex(OSError, 'injected seal failure'):
                self.publish()
        self.assertTrue(failed)
        self.assertFalse(self.target.exists())
        self.assert_no_staging()
        self.publish()
        self.assert_complete()

    def test_rename_failure_cleans_read_only_staging_then_retry_succeeds(self):
        def fail_rename(source, target):
            publication.verify_publication(source, PAYLOAD)
            raise OSError(errno.EIO, 'injected rename failure')
        with patch.object(publication.os, 'rename', fail_rename):
            with self.assertRaisesRegex(OSError, 'injected rename failure'):
                self.publish()
        self.assertFalse(self.target.exists())
        self.assert_no_staging()
        self.publish()
        self.assert_complete()

    def test_real_process_kill_before_and_after_rename_recovers(self):
        for boundary in ('before', 'after'):
            with self.subTest(boundary=boundary):
                # Different content address bases keep both boundaries independent.
                self.base = self.root / boundary
                self.target = publication.publication_path('fixture', PAYLOAD, self.base)
                marker = self.root / (boundary + '.ready')
                child = self.child(boundary, marker)
                try:
                    self.await_marker(child, marker)
                    stage = Path(marker.read_text())
                    self.assertEqual(self.target.exists(), boundary == 'after')
                    if boundary == 'before':
                        publication.verify_publication(stage, PAYLOAD)
                    else:
                        publication.verify_publication(self.target, PAYLOAD)
                    child.kill()
                    child.communicate(timeout=10)
                    self.assertEqual(child.returncode, -signal.SIGKILL)
                    self.publish()
                    self.assert_complete()
                finally:
                    if child.poll() is None:
                        child.kill()
                    child.communicate(timeout=10)

    def test_writable_old_publication_recovers_after_seal_failure(self):
        writable_repository(self.target)
        chmod = Path.chmod
        failed = False
        def fail_once(path, mode, *args, **kwargs):
            nonlocal failed
            if not failed and not mode & 0o222:
                failed = True
                raise OSError(errno.EIO, 'injected recovery seal failure')
            return chmod(path, mode, *args, **kwargs)
        with patch.object(Path, 'chmod', fail_once):
            with self.assertRaisesRegex(OSError, 'injected recovery seal failure'):
                self.publish()
        self.assertTrue(failed)
        publication.verify_publication(self.target, PAYLOAD, require_read_only=False)
        self.publish()
        self.assert_complete()

    def test_same_digest_concurrent_publishers_both_accept_verified_winner(self):
        gate = self.root / 'go'
        markers = [self.root / ('ready-' + str(index)) for index in range(2)]
        children = [self.child('concurrent', marker, gate) for marker in markers]
        try:
            for child, marker in zip(children, markers):
                self.await_marker(child, marker)
            gate.write_text('go')
            for child in children:
                stdout, stderr = child.communicate(timeout=15)
                self.assertEqual(child.returncode, 0, stdout + stderr)
            self.assert_no_staging()
            self.assert_complete()
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                child.communicate(timeout=10)

    def test_writable_content_and_executable_mode_tampering_are_not_repaired(self):
        for tampering in ('content', 'mode'):
            with self.subTest(tampering=tampering):
                self.base = self.root / tampering
                self.target = publication.publication_path('fixture', PAYLOAD, self.base)
                writable_repository(self.target)
                path = self.target / 'plugin.json'
                if tampering == 'content':
                    path.write_bytes(b'changed payload')
                else:
                    path.chmod(0o755)
                before = (path.read_bytes(), path.stat().st_mode)
                with self.assertRaisesRegex(RuntimeError, 'payload changed'):
                    self.publish()
                self.assertEqual((path.read_bytes(), path.stat().st_mode), before)

    def test_writable_git_tree_bytes_and_modes_are_not_repaired(self):
        for tampering in ('bytes', 'mode'):
            with self.subTest(tampering=tampering):
                self.base = self.root / tampering
                self.target = publication.publication_path('fixture', PAYLOAD, self.base)
                writable_repository(self.target)
                path = self.target / 'plugin.json'
                if tampering == 'bytes':
                    path.write_bytes(b'other committed content')
                    publication.git(self.target, 'add', '--all')
                else:
                    publication.git(self.target, 'update-index', '--chmod=+x', 'plugin.json')
                publication.git(self.target, 'commit', '--quiet', '-m', 'changed')
                path.write_bytes(PAYLOAD['plugin.json'][0])
                before = path.stat().st_mode
                with self.assertRaisesRegex(RuntimeError, 'committed bytes/modes'):
                    self.publish()
                self.assertEqual(path.stat().st_mode, before)

    def test_missing_and_corrupt_git_blobs_are_rejected_before_repair(self):
        for tampering in ('missing', 'corrupt'):
            with self.subTest(tampering=tampering):
                self.base = self.root / tampering
                self.target = publication.publication_path('fixture', PAYLOAD, self.base)
                writable_repository(self.target)
                blob = publication.git(self.target, 'rev-parse', 'HEAD:plugin.json')
                obj = self.target / '.git/objects' / blob[:2] / blob[2:]
                obj.chmod(0o644)
                if tampering == 'missing':
                    obj.unlink()
                else:
                    obj.write_bytes(b'corrupt git object')
                with self.assertRaisesRegex(RuntimeError, 'Git operation failed'):
                    publication.verify_publication(self.target, PAYLOAD, require_read_only=False)
                with self.assertRaisesRegex(RuntimeError, 'Git operation failed'):
                    self.publish()
                self.assertTrue(self.target.stat().st_mode & 0o222)

    def test_git_replace_ref_cannot_hide_different_original_commit(self):
        writable_repository(self.target)
        expected = publication.git(self.target, 'rev-parse', 'HEAD')
        path = self.target / 'plugin.json'
        path.write_bytes(b'different original Git object')
        publication.git(self.target, 'add', '--all')
        publication.git(self.target, 'commit', '--quiet', '-m', 'changed')
        changed = publication.git(self.target, 'rev-parse', 'HEAD')
        publication.git(self.target, 'replace', changed, expected)
        path.write_bytes(PAYLOAD['plugin.json'][0])
        with self.assertRaisesRegex(RuntimeError, 'committed bytes/modes'):
            self.publish()
        self.assertTrue(self.target.stat().st_mode & 0o222)

    def test_external_git_object_store_is_not_accepted_for_repair(self):
        writable_repository(self.target)
        external = self.root / 'external-objects'
        shutil.copytree(self.target / '.git/objects', external)
        blob = publication.git(self.target, 'rev-parse', 'HEAD:plugin.json')
        (self.target / '.git/objects' / blob[:2] / blob[2:]).unlink()
        (self.target / '.git/objects/info/alternates').write_text(str(external) + '\n')
        # Git itself accepts the external store; publication must be portable.
        publication.git(self.target, 'fsck', '--full', '--strict', '--no-dangling')
        with self.assertRaisesRegex(RuntimeError, 'self-contained'):
            self.publish()
        self.assertTrue(self.target.stat().st_mode & 0o222)

    def test_promisor_pack_cannot_hide_missing_blobs_or_trigger_lazy_fetch(self):
        writable_repository(self.target)
        objects = self.target / '.git/objects'
        blobs = [publication.git(self.target, 'rev-parse', 'HEAD:' + name) for name in PAYLOAD]
        commits_and_trees = [publication.git(self.target, 'rev-parse', expression)
                             for expression in ('HEAD', 'HEAD^{tree}', 'HEAD:runtime')]
        environment = {**publication.git_environment(),
                       'GIT_NO_LAZY_FETCH': '1', 'GIT_ALLOW_PROTOCOL': ''}
        packed = subprocess.run(['git', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
            '-C', str(self.target), 'pack-objects', '.git/objects/pack/pack'],
            env=environment, input='\n'.join(commits_and_trees) + '\n',
            text=True, capture_output=True, check=True)
        (objects / 'pack' / ('pack-' + packed.stdout.strip() + '.promisor')).write_bytes(b'')
        publication.git(self.target, 'config', 'remote.origin.promisor', 'true')
        publication.git(self.target, 'config', 'remote.origin.url', str(self.root / 'absent-local-remote'))
        for identifier in (*commits_and_trees, *blobs):
            (objects / identifier[:2] / identifier[2:]).unlink()
        fsck = subprocess.run(['git', '-C', str(self.target), 'fsck', '--full', '--strict',
                               '--no-dangling'], env=environment, capture_output=True)
        self.assertEqual(fsck.returncode, 0, fsck.stderr)
        # Reject storage metadata before any object query can lazy-fetch a blob.
        with patch.object(publication, 'git', wraps=publication.git) as query:
            with self.assertRaisesRegex(RuntimeError, 'self-contained'):
                self.publish()
            self.assertEqual(query.call_count, 0)
        self.assertTrue(self.target.stat().st_mode & 0o222)
        self.assertTrue(all(not (objects / identifier[:2] / identifier[2:]).exists()
                            for identifier in blobs))


if __name__ == '__main__':
    unittest.main()
