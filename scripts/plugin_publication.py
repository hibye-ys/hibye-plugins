"""Write-once, content-addressed Git publications for native Claude installation."""
import hashlib
import errno
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile


def unlinked(path):
    path = Path(path)
    if any(item.is_symlink() for item in (path, *path.parents)):
        raise RuntimeError(f'Payload contains a source link; an unlinked directory is required: {path}')
    return path


def capture_payload(source, claude_usage_markers=False):
    source = unlinked(source)
    if not source.is_dir():
        raise RuntimeError(f'Payload directory missing: {source}')
    result = {}
    for path in sorted(source.rglob('*')):
        unlinked(path)
        relative = path.relative_to(source).as_posix()
        if claude_usage_markers and relative.split('/')[0] == '.in_use':
            # Native Claude creates/removes PID markers during normal use. This
            # exception is installed-cache-only; source/publication calls stay
            # exact. Never hide links, nested paths or executable payload here.
            parts = relative.split('/')
            if len(parts) == 1 and path.is_dir():
                continue
            if len(parts) == 2 and parts[1].isdigit():
                try:
                    marker = path.lstat()
                except FileNotFoundError:
                    continue
                if stat.S_ISREG(marker.st_mode) and not marker.st_mode & 0o111:
                    continue
            raise RuntimeError(f'Invalid native Claude usage marker: {path}')
        if relative.split('/')[0] == '.git':
            raise RuntimeError('Plugin payload must not contain .git')
        if path.is_file():
            result[relative] = (path.read_bytes(), bool(path.stat().st_mode & 0o111))
        elif not path.is_dir():
            raise RuntimeError(f'Non-regular payload entry: {path}')
    return result


def digest(payload):
    metadata = [[name, hashlib.sha256(data).hexdigest(), executable]
                for name, (data, executable) in sorted(payload.items())]
    return hashlib.sha256(json.dumps(metadata, separators=(',', ':')).encode()).hexdigest()


def git_environment():
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
               GIT_OPTIONAL_LOCKS='0', GIT_NO_REPLACE_OBJECTS='1',
               GIT_NO_LAZY_FETCH='1', GIT_ALLOW_PROTOCOL='',
               GIT_AUTHOR_NAME='hibye snapshot publisher',
               GIT_AUTHOR_EMAIL='snapshot@localhost', GIT_COMMITTER_NAME='hibye snapshot publisher',
               GIT_COMMITTER_EMAIL='snapshot@localhost', GIT_AUTHOR_DATE='2000-01-01T00:00:00Z',
               GIT_COMMITTER_DATE='2000-01-01T00:00:00Z')
    return env


def git(directory, *args, input_text=None):
    env = git_environment()
    result = subprocess.run(['git', '-c', 'core.hooksPath=' + os.devnull,
        '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false',
        '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-C', str(directory), *args],
        env=env, input=input_text, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Publication Git operation failed: ' + ' '.join(args[:2]))
    return result.stdout.strip()


def verify_publication(target, payload, require_read_only=True):
    target = unlinked(target)
    if not target.is_dir() or not (target / '.git').is_dir():
        raise RuntimeError(f'Invalid published Git repository: {target}')
    if (any((target / '.git' / name).exists()
            for name in ('commondir', 'config.worktree', 'shallow',
                         'objects/info/alternates', 'objects/info/http-alternates'))
            or any((target / '.git/objects/pack').glob('*.promisor'))):
        raise RuntimeError('Published Git objects must be self-contained')
    actual = {}
    for path in sorted(target.rglob('*')):
        unlinked(path)
        relative = path.relative_to(target)
        if not path.is_file() and not path.is_dir():
            raise RuntimeError(f'Non-regular publication entry: {path}')
        if require_read_only and path.stat().st_mode & 0o222:
            raise RuntimeError(f'Published repository entry is writable: {path}')
        if relative.parts[0] == '.git':
            continue
        if path.is_file():
            if require_read_only and path.stat().st_mode & 0o222:
                raise RuntimeError(f'Published payload is writable: {path}')
            actual[relative.as_posix()] = (path.read_bytes(), bool(path.stat().st_mode & 0o111))
    if actual != payload:
        raise RuntimeError(f'Published payload changed: {target}')
    if require_read_only and any(path.stat().st_mode & 0o222 for path in (target, *[p for p in target.rglob('*') if p.is_dir()])):
        raise RuntimeError(f'Published repository directory is writable: {target}')
    # Generated repositories do not depend on remote promises or included config.
    # Inspect only local keys before object queries; all Git transports are also
    # disabled in git_environment, including for configurations being rejected.
    keys = git(target, 'config', '--local', '--no-includes', '--name-only', '--list').lower().splitlines()
    if any(key in ('extensions.partialclone', 'extensions.worktreeconfig', 'include.path')
           or key.startswith('includeif.')
           or (key.startswith('remote.') and key.rsplit('.', 1)[-1] in ('promisor', 'partialclonefilter'))
           for key in keys):
        raise RuntimeError('Published Git objects must be self-contained')
    # Native clones consume committed Git objects, not merely worktree files.
    # Compare committed blob IDs/modes, then validate the actual stored objects.
    algorithm = git(target, 'rev-parse', '--show-object-format')
    if algorithm not in ('sha1', 'sha256'):
        raise RuntimeError('Unsupported publication Git object format')
    tree = {}
    for entry in git(target, 'ls-tree', '-r', '-z', 'HEAD').split('\0'):
        if not entry:
            continue
        metadata, name = entry.split('\t', 1)
        mode, kind, identifier = metadata.split(' ')
        if kind != 'blob' or mode not in ('100644', '100755'):
            raise RuntimeError('Unexpected publication Git object type')
        tree[name] = (identifier, mode == '100755')
    expected_tree = {name: (hashlib.new(algorithm, b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest(), executable)
                     for name, (data, executable) in payload.items()}
    if tree != expected_tree:
        raise RuntimeError('Publication committed bytes/modes differ from captured payload')
    git(target, 'fsck', '--full', '--strict', '--no-dangling')
    # fsck permits missing objects in partial clones. Independently require every
    # committed payload blob to be present locally, with the expected type/size.
    blobs = [(identifier, len(payload[name][0]))
             for name, (identifier, executable) in sorted(expected_tree.items())]
    actual_blobs = git(target, 'cat-file', '--batch-check',
                       input_text=''.join(identifier + '\n' for identifier, size in blobs))
    if actual_blobs != '\n'.join(f'{identifier} blob {size}' for identifier, size in blobs):
        raise RuntimeError('Publication Git blobs are missing or differ from captured payload')

    return target


def default_base():
    config = Path(os.environ.get('CLAUDE_CONFIG_DIR', str(Path.home() / '.claude'))).expanduser().absolute()
    return config.parent / (config.name + '-hibye-publications')


def publication_path(name, payload, base=None):
    if not name or any(char not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for char in name):
        raise ValueError('Unsafe publication plugin name')
    return unlinked(base or default_base()) / name / digest(payload)


def seal_publication(target):
    for path in sorted(target.rglob('*'), key=lambda p: len(p.parts), reverse=True) + [target]:
        mode = stat.S_IMODE(path.stat().st_mode)
        if mode & 0o222:
            path.chmod(mode & ~0o222)


def reuse_publication(target, payload):
    # Older publishers renamed before sealing. Repair permissions only after
    # worktree bytes, executable modes and the original Git objects all match.
    verify_publication(target, payload, require_read_only=False)
    seal_publication(target)
    return verify_publication(target, payload)


def remove_staging(temporary):
    if not temporary.exists():
        return
    # Sealed staging still belongs to this invocation. POSIX unlink needs write
    # permission on directories, including nested Git directories, not files.
    for path in (temporary, *temporary.rglob('*')):
        if path.is_dir() and not path.is_symlink():
            path.chmod(stat.S_IMODE(path.stat().st_mode) | 0o700)
    shutil.rmtree(temporary)


def publish(name, payload, base=None):
    target = publication_path(name, payload, base)
    if target.exists():
        return reuse_publication(target, payload)
    unlinked(target.parent)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.publishing-', dir=target.parent))
    try:
        for name, (data, executable) in payload.items():
            path = temporary / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o755 if executable else 0o644)
        git(temporary, 'init', '--quiet')
        git(temporary, 'add', '--all')
        git(temporary, 'commit', '--quiet', '-m', 'Immutable plugin publication')
        verify_publication(temporary, payload, require_read_only=False)
        seal_publication(temporary)
        verify_publication(temporary, payload)
        # The final name becomes visible only after sealing and verification.
        try:
            os.rename(temporary, target)
        except OSError as error:
            # macOS can report EACCES for replacing a read-only winner rather
            # than EEXIST/ENOTEMPTY. An existing, fully verified target is still
            # the requested result; other permission/rename errors propagate.
            collision = error.errno in (errno.EEXIST, errno.ENOTEMPTY)
            collision |= error.errno in (errno.EACCES, errno.EPERM) and target.exists()
            if not collision:
                raise
            return reuse_publication(target, payload)
        return verify_publication(target, payload)
    finally:
        pending_error = sys.exception()
        try:
            remove_staging(temporary)
        except OSError as cleanup_error:
            if pending_error is None:
                raise
            pending_error.add_note(f'Publication staging cleanup failed: {cleanup_error}')
