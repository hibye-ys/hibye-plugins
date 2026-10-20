#!/usr/bin/env python3
"""Install selected plugins through native CLIs; verify complete immutable payloads."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MARKETPLACE = 'hibye-plugins'


def read_json(path):
    return json.loads(path.read_text())


def command(*args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed: {result.stderr or result.stdout}')
    return result.stdout


def tree_hashes(root):
    root = Path(root)
    # Reject a linked root, ancestor, or any payload member, even an in-tree link.
    if any(path.is_symlink() for path in (root, *root.parents)) or not root.is_dir():
        raise RuntimeError(f'Expected an unlinked snapshot directory: {root}')
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise RuntimeError(f'Payload contains a source link: {path}')
        if path.is_file():
            result[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def manifests(name):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', name):
        raise ValueError('Unsafe plugin name')
    source = ROOT / 'plugins' / name
    data = {host: read_json(source / f'.{host}-plugin/plugin.json') for host in ('codex', 'claude')}
    versions = {value.get('version') for value in data.values()}
    if len(versions) != 1 or any(value.get('name') != name for value in data.values()):
        raise RuntimeError(f'Plugin manifest name/version mismatch: {name}')
    version = next(iter(versions))
    if not isinstance(version, str) or not re.fullmatch(r'[0-9A-Za-z][0-9A-Za-z._+-]*', version):
        raise RuntimeError('Unsafe plugin version')
    muse_manifest = source / '.muse-plugin/plugin.json'
    if muse_manifest.exists():
        muse = read_json(muse_manifest)
        if muse.get('name') != name or muse.get('version') != version:
            raise RuntimeError(f'Muse manifest name/version mismatch: {name}')
    for family in ('.agents/plugins', '.claude-plugin'):
        marketplace = read_json(ROOT / family / 'marketplace.json')
        if marketplace.get('name') != MARKETPLACE:
            raise RuntimeError('Unexpected marketplace name')
        entries = [entry for entry in marketplace['plugins'] if entry.get('name') == name]
        if len(entries) != 1:
            raise RuntimeError(f'Marketplace entry missing or duplicate: {name}')
        entry = entries[0]
        location = entry.get('source')
        location = location.get('path') if isinstance(location, dict) else location
        if location != f'./plugins/{name}' or entry.get('version', version) != version:
            raise RuntimeError(f'Marketplace path/version mismatch: {name}')
    return source, version, data


def inspect_host(host, name):
    plugin_id = f'{name}@{MARKETPLACE}'
    if host == 'codex':
        payload = json.loads(command('codex', 'plugin', 'list', '--marketplace', MARKETPLACE, '--json'))
        records = [item for item in payload['installed'] if item.get('pluginId') == plugin_id]
        if len(records) != 1:
            raise RuntimeError(f'Expected one Codex installation: {plugin_id}')
        item = records[0]
        cache = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'plugins/cache' / MARKETPLACE / name / item['version']
        return {'version': item['version'], 'active': item.get('enabled') is True, 'cache': cache}
    if host == 'claude':
        records = json.loads(command('claude', 'plugin', 'list', '--json'))
        matches = [item for item in records if item.get('id') == plugin_id and item.get('scope') == 'user']
        if len(matches) != 1:
            raise RuntimeError(f'Expected one Claude user installation: {plugin_id}')
        item = matches[0]
        return {'version': item['version'], 'active': item.get('enabled') is True, 'cache': Path(item['installPath'])}
    if host == 'muse':
        payload = json.loads(command('muse', 'plugins', 'inspect', name, '--json'))
        record = payload['record']
        return {'version': record['version'], 'active': payload.get('valid') is True and payload.get('active') is True, 'cache': Path(record['cache_path'])}
    raise ValueError('Unsupported native host: ' + host)


def verify_snapshot(cache, expected_manifest, expected_hashes):
    actual = tree_hashes(cache)
    if actual != expected_hashes:
        missing = sorted(set(expected_hashes) - set(actual))
        extra = sorted(set(actual) - set(expected_hashes))
        changed = sorted(key for key in actual.keys() & expected_hashes.keys() if actual[key] != expected_hashes[key])
        raise RuntimeError(f'Payload drift: {cache}; missing={missing}, extra={extra}, changed={changed}')
    # Content hashes include both manifests and every hook/runtime/reference file.
    if read_json(Path(cache) / '.codex-plugin/plugin.json') != expected_manifest:
        raise RuntimeError('Snapshot manifest mismatch')


def check_plugin(name, hosts, expected=None):
    source, version, data = manifests(name)
    expected = tree_hashes(source) if expected is None else expected
    for host in hosts:
        installed = inspect_host(host, name)
        if installed['version'] != version or not installed['active']:
            raise RuntimeError(f'{host}/{name} version or activation mismatch: {installed}')
        verify_snapshot(installed['cache'], data['codex'], expected)
        print(f'OK {host}/{name}: {version}, {len(expected)} complete payload files')
    if tree_hashes(source) != expected:
        raise RuntimeError('Source changed during verification; rerun with stable inputs')


def refresh_build_versions(names):
    """Explicit release step only. One build marker updates all manifest copies."""
    marker = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')
    updates = {}
    versions = {}
    marketplace_path = ROOT / '.claude-plugin/marketplace.json'
    marketplace = read_json(marketplace_path)
    for name in names:
        source, version, data = manifests(name)
        version = version.split('+', 1)[0] + '+build.' + marker
        versions[name] = version
        for host, manifest in data.items():
            updates[source / f'.{host}-plugin/plugin.json'] = {**manifest, 'version': version}
        muse = source / '.muse-plugin/plugin.json'
        if muse.exists():
            updates[muse] = {**read_json(muse), 'version': version}
        next(entry for entry in marketplace['plugins'] if entry['name'] == name)['version'] = version
    updates[marketplace_path] = marketplace
    # Preflight every parse first; rollback bytes if a write fails.
    previous = {path: path.read_bytes() for path in updates}
    try:
        for path, value in updates.items():
            path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    except BaseException:
        for path, value in previous.items():
            path.write_bytes(value)
        raise
    return versions


def sync_plugin(name, hosts):
    source, _, _ = manifests(name)
    expected = tree_hashes(source)
    for host in hosts:
        plugin_id = f'{name}@{MARKETPLACE}'
        if host == 'codex':
            command('codex', 'plugin', 'add', plugin_id, '--json')
        elif host == 'claude':
            records = json.loads(command('claude', 'plugin', 'list', '--json'))
            present = any(item.get('id') == plugin_id and item.get('scope') == 'user' for item in records)
            if present:
                command('claude', 'plugin', 'update', plugin_id, '--scope', 'user', '--json', '-y')
            else:
                command('claude', 'plugin', 'install', plugin_id, '--scope', 'user')
        else:
            # Install is native and supports an explicit local source for Muse.
            command('muse', 'plugins', 'install', str(source), '--scope', 'user')
        check_plugin(name, [host], expected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plugin', action='append', required=True)
    parser.add_argument('--host', action='append', choices=('codex', 'claude', 'muse'), required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='read-only installed payload and activation verification')
    mode.add_argument('--preview', action='store_true', help='validate source and list native actions; no writes')
    parser.add_argument('--build-marker', action='store_true', help='explicitly bump selected source build versions before native sync')
    args = parser.parse_args()
    try:
        if args.build_marker and (args.check or args.preview):
            raise ValueError('--build-marker cannot be combined with read-only modes')
        names, hosts = list(dict.fromkeys(args.plugin)), list(dict.fromkeys(args.host))
        for host in hosts:
            if not shutil.which(host):
                raise RuntimeError('Missing native CLI: ' + host)
        # Validate every selected payload before the first host mutation.
        for name in names:
            source, version, _ = manifests(name)
            expected = tree_hashes(source)
            print(f'SOURCE {name}: {version}, {len(expected)} files; hosts={",".join(hosts)}')
        if args.preview:
            return 0
        if args.build_marker:
            print(json.dumps(refresh_build_versions(names)))
        for name in names:
            check_plugin(name, hosts) if args.check else sync_plugin(name, hosts)
        print('All selected installations verified. Start a new session to load them.')
        return 0
    except (OSError, ValueError, KeyError, StopIteration, RuntimeError) as error:
        print(f'NOT SYNCHRONIZED: {error}\nSome hosts may have updated. Resolve the error and rerun; no cache links were replaced.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
