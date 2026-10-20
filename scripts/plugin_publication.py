"""Write-once, content-addressed Git publications for native Claude installation."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile


def unlinked(path):
    path = Path(path)
    if any(item.is_symlink() for item in (path, *path.parents)):
        raise RuntimeError(f'Payload contains a source link; an unlinked directory is required: {path}')
    return path


def capture_payload(source):
    source = unlinked(source)
    if not source.is_dir():
        raise RuntimeError(f'Payload directory missing: {source}')
    result = {}
    for path in sorted(source.rglob('*')):
        unlinked(path)
        relative = path.relative_to(source).as_posix()
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
               GIT_OPTIONAL_LOCKS='0', GIT_AUTHOR_NAME='hibye snapshot publisher',
               GIT_AUTHOR_EMAIL='snapshot@localhost', GIT_COMMITTER_NAME='hibye snapshot publisher',
               GIT_COMMITTER_EMAIL='snapshot@localhost', GIT_AUTHOR_DATE='2000-01-01T00:00:00Z',
               GIT_COMMITTER_DATE='2000-01-01T00:00:00Z')
    return env


def git(directory, *args):
    env = git_environment()
    result = subprocess.run(['git', '-c', 'core.hooksPath=' + os.devnull,
        '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-C', str(directory), *args],
        env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Publication Git operation failed: ' + ' '.join(args[:2]))
    return result.stdout.strip()


def verify_publication(target, payload, require_read_only=True):
    target = unlinked(target)
    if not target.is_dir() or not (target / '.git').is_dir():
        raise RuntimeError(f'Invalid published Git repository: {target}')
    actual = {}
    for path in sorted(target.rglob('*')):
        unlinked(path)
        relative = path.relative_to(target)
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
    # Native clones consume committed Git objects, not merely worktree files.
    # Compare blob IDs and executable modes with two read-only Git queries.
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

    return target


def default_base():
    config = Path(os.environ.get('CLAUDE_CONFIG_DIR', str(Path.home() / '.claude'))).expanduser().absolute()
    return config.parent / (config.name + '-hibye-publications')


def publication_path(name, payload, base=None):
    if not name or any(char not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for char in name):
        raise ValueError('Unsafe publication plugin name')
    return unlinked(base or default_base()) / name / digest(payload)


def publish(name, payload, base=None):
    target = publication_path(name, payload, base)
    if target.exists():
        return verify_publication(target, payload)
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
        # Same-filesystem rename publishes only a complete Git repository.
        try:
            os.rename(temporary, target)
        except FileExistsError:
            return verify_publication(target, payload)
        for path in sorted(target.rglob('*'), key=lambda p: len(p.parts), reverse=True):
            path.chmod(stat.S_IMODE(path.stat().st_mode) & ~0o222)
        target.chmod(stat.S_IMODE(target.stat().st_mode) & ~0o222)
        return verify_publication(target, payload)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
