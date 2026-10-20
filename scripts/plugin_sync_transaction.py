"""Recoverable local updater writes; advisory locks serialize cooperating updaters.

A journal is durable before any target replacement. Recovery only accepts the
recorded before/after states; unrelated edits require operator resolution.
This is process-interruption recovery, not a claim about all power-loss/storage
failure modes. Uncooperative writers must not edit across the final CAS/rename.
"""
import base64
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import stat
import tempfile
import uuid


def unlinked(path):
    path = Path(path).absolute()
    if any(item.is_symlink() for item in (path, *path.parents)):
        raise RuntimeError('Transaction path contains a link: ' + str(path))
    return path


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@contextmanager
def locks(*paths):
    """Acquire source then shared-installation lock; callers use this order."""
    descriptors = []
    try:
        for path in paths:
            path = unlinked(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            descriptors.append(descriptor)
            fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def encoded(data):
    return None if data is None else base64.b64encode(data).decode('ascii')


def file_state(path):
    unlinked(path)
    if not path.exists():
        return None
    if not stat.S_ISREG(path.stat().st_mode):
        raise RuntimeError('Transaction target is not a regular file: ' + str(path))
    return encoded(path.read_bytes())


def link_state(path):
    unlinked(path.parent)
    if path.is_symlink():
        return os.readlink(path)
    if path.exists():
        raise RuntimeError('Refusing to replace a non-link catalog entry: ' + str(path))
    return None


def current(path, kind):
    return file_state(path) if kind == 'file' else link_state(path)


def changed(path):
    raise RuntimeError('Transaction target changed concurrently; external edit preserved: ' + str(path))


def atomic_file(path, data, mode=0o644, expected=None, candidate=None):
    """Stage complete bytes and CAS immediately before atomic replacement."""
    unlinked(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if candidate is None:
        descriptor, temporary = tempfile.mkstemp(prefix='.plugin-sync-', dir=path.parent)
        candidate = Path(temporary)
    else:
        unlinked(candidate)
        descriptor = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), mode)
        if expected is not None and file_state(path) != expected[0]:
            changed(path)
        os.replace(candidate, path)
        sync_directory(path.parent)
    finally:
        candidate.unlink(missing_ok=True)


def file_entry(root, path, before, after):
    unlinked(path)
    return {'path': path.relative_to(root).as_posix(), 'kind': 'file',
            'before': encoded(before), 'after': encoded(after),
            'mode': path.stat().st_mode & 0o777 if path.exists() else 0o644}


def link_entry(root, path, before, after):
    return {'path': path.relative_to(root).as_posix(), 'kind': 'link',
            'before': before, 'after': after}


def entries_for(root, journal):
    if journal.get('schema') != 1 or not isinstance(journal.get('token'), str) or len(journal['token']) != 32 or any(character not in '0123456789abcdef' for character in journal['token']):
        raise RuntimeError('Invalid updater transaction journal')
    seen = set()
    for entry in journal['entries']:
        relative = Path(entry['path'])
        if relative.is_absolute() or not relative.parts or any(part in ('.', '..') for part in relative.parts) or entry['kind'] not in ('file', 'link') or relative.as_posix() in seen:
            raise RuntimeError('Unsafe updater transaction entry')
        seen.add(relative.as_posix())
        path = root / relative
        if entry['kind'] == 'file':
            for value in (entry['before'], entry['after']):
                if value is not None:
                    base64.b64decode(value, validate=True)
            if entry['after'] is None:
                raise RuntimeError('File deletion is not supported by updater transactions')
        yield path, entry


def recover(root, journal_path):
    """Roll a prepared transaction forward before parsing coupled manifests."""
    root, journal_path = unlinked(root), unlinked(journal_path)
    if not journal_path.exists():
        return False
    journal_bytes = journal_path.read_bytes()
    journal = json.loads(journal_bytes)
    entries = list(entries_for(root, journal))
    # Validate the complete unit first: do not overwrite any unrelated edit, nor
    # partially resume a unit whose other member was edited externally.
    for path, entry in entries:
        if current(path, entry['kind']) not in (entry['before'], entry['after']):
            changed(path)
    for index, (path, entry) in enumerate(entries):
        candidate = path.with_name('.plugin-sync-' + journal['token'] + '-' + str(index))
        # This exact reserved name is recorded by the journal before creation.
        # It may contain a partial write from an interrupted staging operation.
        unlinked(candidate.parent)
        if candidate.is_symlink() or candidate.is_file():
            candidate.unlink()
        elif candidate.exists():
            raise RuntimeError('Transaction temporary path is not a file: ' + str(candidate))
        actual = current(path, entry['kind'])
        if actual == entry['after']:
            continue
        if actual != entry['before']:
            changed(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        if entry['kind'] == 'file':
            atomic_file(path, base64.b64decode(entry['after']), entry['mode'], (entry['before'],), candidate)
        elif entry['after'] is None:
            if link_state(path) != entry['before']:
                changed(path)
            path.unlink()
            sync_directory(path.parent)
        else:
            try:
                candidate.symlink_to(entry['after'], target_is_directory=True)
                if link_state(path) != entry['before']:
                    changed(path)
                os.replace(candidate, path)
                sync_directory(path.parent)
            finally:
                candidate.unlink(missing_ok=True)
    for path, entry in entries:
        if current(path, entry['kind']) != entry['after']:
            changed(path)
    if journal_path.read_bytes() != journal_bytes:
        changed(journal_path)
    journal_path.unlink()
    sync_directory(journal_path.parent)
    return True


def commit(root, journal_path, entries):
    """The caller holds updater locks across recovery, planning and commit."""
    root, journal_path = unlinked(root), unlinked(journal_path)
    if journal_path.exists():
        raise RuntimeError('Pending updater transaction must be recovered first: ' + str(journal_path))
    if not any(entry['before'] != entry['after'] for entry in entries):
        return
    journal = {'schema': 1, 'token': uuid.uuid4().hex, 'entries': entries}
    for path, entry in entries_for(root, journal):
        if current(path, entry['kind']) != entry['before']:
            changed(path)
    atomic_file(journal_path, (json.dumps(journal, indent=2) + '\n').encode(), 0o600, (None,))
    recover(root, journal_path)
