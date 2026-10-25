#!/usr/bin/env python3
"""Publish immutable plugins, install through native CLIs, and verify effective sources."""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MARKETPLACE = 'hibye-plugins'
HARNESS = ('state-ledger', 'project-context', 'spec-plan', 'agent-results')
_spec = importlib.util.spec_from_file_location('hibye_plugin_publication', Path(__file__).with_name('plugin_publication.py'))
publication = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(publication)
_spec = importlib.util.spec_from_file_location('hibye_plugin_sync_transaction', Path(__file__).with_name('plugin_sync_transaction.py'))
transaction = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(transaction)


def read_json(path):
    return json.loads(path.read_text())


def command(*args, cwd=None):
    result = subprocess.run(args, cwd=cwd or ROOT, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed: {result.stderr or result.stdout}')
    return result.stdout


def tree_hashes(root):
    payload = publication.capture_payload(root)
    return {name: hashlib.sha256(data).hexdigest() for name, (data, _) in payload.items()}


def manifests(name, snapshots=None):
    def load(path):
        if snapshots is None:
            return read_json(path)
        if path not in snapshots:
            snapshots[path] = path.read_bytes()
        return json.loads(snapshots[path])
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', name):
        raise ValueError('Unsafe plugin name')
    source = ROOT / 'plugins' / name
    data = {host: load(source / f'.{host}-plugin/plugin.json') for host in ('codex', 'claude')}
    versions = {value.get('version') for value in data.values()}
    if len(versions) != 1 or any(value.get('name') != name for value in data.values()):
        raise RuntimeError(f'Plugin manifest name/version mismatch: {name}')
    version = next(iter(versions))
    if not isinstance(version, str) or not re.fullmatch(r'[0-9A-Za-z][0-9A-Za-z._+-]*', version):
        raise RuntimeError('Unsafe plugin version')
    muse_manifest = source / '.muse-plugin/plugin.json'
    if muse_manifest.exists():
        muse = load(muse_manifest)
        if muse.get('name') != name or muse.get('version') != version:
            raise RuntimeError(f'Muse manifest name/version mismatch: {name}')
    for family in ('.agents/plugins', '.claude-plugin'):
        marketplace = load(ROOT / family / 'marketplace.json')
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


def claude_home():
    return Path(os.environ.get('CLAUDE_CONFIG_DIR', str(Path.home() / '.claude'))).expanduser().absolute()


def record_key(record):
    return record['scope'], record.get('projectPath')


def claude_records(name):
    plugin_id = f'{name}@{MARKETPLACE}'
    listed = json.loads(command('claude', 'plugin', 'list', '--json'))
    listed = [item for item in listed if item.get('id') == plugin_id]
    registry_path = claude_home() / 'plugins/installed_plugins.json'
    records = read_json(registry_path).get('plugins', {}).get(plugin_id, []) if registry_path.exists() else listed
    normalized = []
    for record in records:
        scope = record.get('scope')
        project = record.get('projectPath') if scope != 'user' else None
        if scope not in ('user', 'project', 'local') or (scope != 'user' and not project):
            raise RuntimeError(f'Unsupported Claude installation scope for {name}')
        matches = [item for item in listed if item.get('scope') == scope and
                   (not item.get('projectPath') or item.get('projectPath') == project)]
        matches = [item for item in matches if item.get('installPath') == record.get('installPath') and item.get('version') == record.get('version')]
        if not matches:
            raise RuntimeError(f'Claude registry/list disagree: {name} scope={scope} project={project}')
        states = {item.get('enabled') for item in matches}
        if len(states) != 1 or not all(isinstance(item.get('enabled'), bool) for item in matches):
            raise RuntimeError(f'Ambiguous Claude activation: {name} scope={scope} project={project}')
        normalized.append({'scope': scope, 'projectPath': project,
            'version': record['version'], 'cache': Path(record['installPath']),
            'active': next(iter(states)), 'git_commit': record.get('gitCommitSha'),
            'read_from_folder': next((item.get('readFromFolder') for item in matches if item.get('readFromFolder')), None)})
    keys = [record_key(record) for record in normalized]
    if len(set(keys)) != len(keys):
        raise RuntimeError(f'Duplicate Claude scope/project registration: {name}')
    return normalized


def codex_record(name):
    plugin_id = f'{name}@{MARKETPLACE}'
    payload = json.loads(command('codex', 'plugin', 'list', '--marketplace', MARKETPLACE, '--json'))
    records = [item for item in payload['installed'] if item.get('pluginId') == plugin_id]
    if len(records) > 1:
        raise RuntimeError(f'Expected one Codex installation: {plugin_id}')
    if not records:
        return None
    item = records[0]
    cache = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'plugins/cache' / MARKETPLACE / name / item['version']
    if item.get('installPath') and Path(item['installPath']).absolute() != cache.absolute():
        raise RuntimeError(f'Codex selected a non-native source path: {name}')
    return {'version': item['version'], 'active': item.get('enabled') is True,
            'cache': cache, 'scope': 'user', 'projectPath': None}


def require_native_cache(host, name, record):
    if host == 'claude' and record.get('read_from_folder'):
        raise RuntimeError(f'Claude/{name} selects in-place readFromFolder execution: {record["read_from_folder"]}')
    base = claude_home() if host == 'claude' else Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
    expected_parent = (base / 'plugins/cache' / MARKETPLACE / name).absolute()
    cache = record['cache'].absolute()
    if cache.parent != expected_parent or cache.name in ('current', 'skills'):
        raise RuntimeError(f'{host}/{name} executes outside the native snapshot cache: {cache}')
    publication.unlinked(cache)


def inspect_host(host, name):
    if host == 'codex':
        item = codex_record(name)
        if item is None:
            raise RuntimeError(f'Codex plugin is not installed: {name}')
        require_native_cache(host, name, item)
        return item
    if host == 'claude':
        records = claude_records(name)
        users = [item for item in records if item['scope'] == 'user']
        if len(users) != 1:
            raise RuntimeError(f'Expected one Claude user installation: {name}')
        for record in records:
            require_native_cache(host, name, record)
        return {**users[0], 'scopes': records}
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
    if read_json(Path(cache) / '.codex-plugin/plugin.json') != expected_manifest:
        raise RuntimeError('Snapshot manifest mismatch')


def catalog_root():
    return publication.unlinked(publication.default_base() / 'marketplaces' / MARKETPLACE)


def catalog_path():
    return catalog_root() / '.claude-plugin/marketplace.json'


def publication_for(name):
    source, _, _ = manifests(name)
    payload = publication.capture_payload(source)
    return publication.publication_path(name, payload), payload


def verify_claude_catalog(names):
    path = publication.unlinked(catalog_path())
    registry = read_json(claude_home() / 'plugins/known_marketplaces.json')
    selected = registry.get(MARKETPLACE, {}).get('source', {})
    if selected.get('source') != 'directory' or Path(selected.get('path', '')).absolute() != catalog_root().absolute():
        raise RuntimeError('Claude marketplace must select the dedicated canonical publication catalog root')
    catalog = read_json(path)
    portable = read_json(ROOT / '.claude-plugin/marketplace.json')
    if catalog.get('name') != MARKETPLACE:
        raise RuntimeError('Snapshot catalog name mismatch')
    for name in names:
        target, payload = publication_for(name)
        publication.verify_publication(target, payload)
        expected = copy.deepcopy(next(item for item in portable['plugins'] if item['name'] == name))
        expected['source'] = {'source': 'url', 'url': target.as_uri()}
        actual = [item for item in catalog['plugins'] if item.get('name') == name]
        if actual != [expected]:
            raise RuntimeError(f'Claude catalog selects a different plugin source: {name}')
    return catalog


def check_plugin(name, hosts, expected=None, allow_inactive=False):
    source, version, data = manifests(name)
    expected = tree_hashes(source) if expected is None else expected
    for host in hosts:
        if host == 'claude':
            verify_claude_catalog([name])
        installed = inspect_host(host, name)
        records = installed.get('scopes', [installed])
        for record in records:
            if record['version'] != version or (not record['active'] and not allow_inactive):
                raise RuntimeError(f'{host}/{name} scope={record.get("scope")} project={record.get("projectPath")} version or activation mismatch')
            verify_snapshot(record['cache'], data['codex'], expected)
            if host == 'claude':
                target, _ = publication_for(name)
                if record.get('git_commit') != publication.git(target, 'rev-parse', 'HEAD'):
                    raise RuntimeError(f'Claude scope={record["scope"]} project={record.get("projectPath")} is not bound to the published Git commit: {name}')
        print(f'OK {host}/{name}: {version}, {len(expected)} payload files, {len(records)} scope(s)')
    if tree_hashes(source) != expected:
        raise RuntimeError('Source changed during verification; rerun with stable inputs')


def manifest_journal():
    return ROOT / '.plugin-sync-manifests.json'


def alias_journal():
    return catalog_root() / '.source-alias-transaction.json'


def refresh_build_versions(names):
    marker = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')
    updates, versions, before = {}, {}, {}

    def load(path):
        if path not in before:
            before[path] = path.read_bytes()
        return json.loads(before[path])

    path = ROOT / '.claude-plugin/marketplace.json'
    marketplace = load(path)
    for name in names:
        # Every CAS baseline is the exact byte sequence parsed into these dicts.
        source, version, data = manifests(name, before)
        version = version.split('+', 1)[0] + '+build.' + marker
        versions[name] = version
        for host, manifest in data.items():
            updates[source / f'.{host}-plugin/plugin.json'] = {**manifest, 'version': version}
        muse = source / '.muse-plugin/plugin.json'
        if muse.exists():
            updates[muse] = {**load(muse), 'version': version}
        next(entry for entry in marketplace['plugins'] if entry['name'] == name)['version'] = version
    updates[path] = marketplace
    codex_path = ROOT / '.agents/plugins/marketplace.json'
    codex_marketplace = load(codex_path)
    codex_changed = False
    for entry in codex_marketplace['plugins']:
        if entry.get('name') in versions and 'version' in entry:
            entry['version'] = versions[entry['name']]
            codex_changed = True
    if codex_changed:
        updates[codex_path] = codex_marketplace
    # Include read-only dependencies as guards so a coupled edit cannot slip
    # through merely because this marketplace omits explicit version fields.
    entries = [transaction.file_entry(ROOT, path, original,
               (json.dumps(updates[path], ensure_ascii=False, indent=2) + '\n').encode()
               if path in updates else original) for path, original in before.items()]
    transaction.commit(ROOT, manifest_journal(), entries)
    for name in names:
        manifests(name)
    return versions


def same_version_drift(name, hosts):
    source, version, _ = manifests(name)
    wanted = tree_hashes(source)
    for host in hosts:
        records = claude_records(name) if host == 'claude' else [codex_record(name)] if host == 'codex' else []
        for record in records:
            if record and record['version'] == version:
                try:
                    if tree_hashes(record['cache']) != wanted:
                        return True
                    if host == 'claude':
                        # Equal bytes do not prove native execution: an old
                        # same-version cache can still reference the development
                        # Git HEAD or be shadowed by readFromFolder execution.
                        target, payload = publication_for(name)
                        if record.get('read_from_folder') or not target.exists():
                            return True
                        publication.verify_publication(target, payload)
                        if record.get('git_commit') != publication.git(target, 'rev-parse', 'HEAD'):
                            return True
                except (OSError, RuntimeError):
                    # A linked/missing same-version cache must not be overwritten.
                    return True
    return False


def relative_catalog_source(entry):
    source = entry.get('source')
    if isinstance(source, dict):
        source = source.get('path') if source.get('source') == 'local' else None
    if not isinstance(source, str) or not source.startswith('./'):
        return None
    parts = Path(source[2:]).parts
    if not parts or any(part in ('..', '.git', '.claude-plugin') for part in parts):
        raise RuntimeError('Unsafe relative catalog entry: ' + entry['name'])
    return Path(*parts)


def prepare_source_aliases(catalog):
    root = catalog_root()
    ledger = root / '.owned-source-links.json'
    publication.unlinked(ledger)
    before = ledger.read_bytes() if ledger.exists() else None
    old = json.loads(before) if before is not None else {}
    wanted = {}
    for entry in catalog['plugins']:
        relative = relative_catalog_source(entry)
        if relative is None:
            continue
        source = (ROOT / relative).absolute()
        if not source.is_dir():
            raise RuntimeError('Unselected development source missing: ' + entry['name'])
        wanted[relative.as_posix()] = str(source)
    # Preflight every owned alias before changing any links. Never replace files
    # or user-modified aliases, and never delete an original source directory.
    states = {}
    for relative, source in {**old, **wanted}.items():
        alias = root / relative
        publication.unlinked(alias.parent)
        states[relative] = transaction.link_state(alias)
        if states[relative] is not None:
            expected = old.get(relative, wanted.get(relative))
            if states[relative] != expected:
                raise RuntimeError('Generated source alias changed concurrently: ' + str(alias))
        elif alias.exists():
            raise RuntimeError('Refusing to replace a non-link catalog entry: ' + str(alias))
    entries = [transaction.link_entry(root, root / relative,
               states[relative], wanted.get(relative)) for relative in dict.fromkeys([*old, *wanted])]
    text = (json.dumps(wanted, indent=2) + '\n').encode()
    entries.append(transaction.file_entry(root, ledger, before, text))
    transaction.commit(root, alias_journal(), entries)


def prepare_claude_catalog(names):
    path = publication.unlinked(catalog_path())
    portable = read_json(ROOT / '.claude-plugin/marketplace.json')
    before = path.read_bytes() if path.exists() else None
    existing = json.loads(before) if before is not None else portable
    if existing.get('name') != MARKETPLACE:
        raise RuntimeError('Existing local snapshot catalog belongs to another marketplace')
    # Current portable metadata owns ordinary unselected development entries.
    # Previously published, unselected snapshots keep their immutable source and
    # version rather than silently reverting to in-place execution.
    by_name = {item['name']: item for item in existing['plugins']}
    catalog = copy.deepcopy(portable)
    for index, item in enumerate(catalog['plugins']):
        prior = by_name.get(item['name'], {})
        prior_source = prior.get('source')
        prefix = (publication.default_base() / item['name']).absolute().as_uri() + '/'
        if item['name'] not in names and isinstance(prior_source, dict) and prior_source.get('source') == 'url' and prior_source.get('url', '').startswith(prefix):
            catalog['plugins'][index]['source'] = copy.deepcopy(prior_source)
            if 'version' in prior:
                catalog['plugins'][index]['version'] = prior['version']
    for name in names:
        source, _, _ = manifests(name)
        payload = publication.capture_payload(source)
        target = publication.publish(name, payload)
        entry = next(item for item in catalog['plugins'] if item['name'] == name)
        entry['source'] = {'source': 'url', 'url': target.as_uri()}
        if publication.capture_payload(source) != payload:
            raise RuntimeError('Source changed while publishing: ' + name)
    prepare_source_aliases(catalog)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
    if before != text.encode():
        if (path.read_bytes() if path.exists() else None) != before:
            raise RuntimeError('Snapshot catalog changed concurrently')
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
            temporary.write(text.encode())
            candidate = Path(temporary.name)
        try:
            candidate.chmod(0o644)
            os.replace(candidate, path)
        finally:
            candidate.unlink(missing_ok=True)
    try:
        command('claude', 'plugin', 'marketplace', 'add', str(catalog_root()), '--json')
        # Re-add alone does not invalidate the native marketplace listing cache.
        command('claude', 'plugin', 'marketplace', 'update', MARKETPLACE, '--json')
    except RuntimeError as error:
        raise RuntimeError('claude marketplace source switch/listing refresh: ' + str(error)) from error
    verify_claude_catalog(names)


def scope_settings(record):
    if record['scope'] == 'user':
        return claude_home() / 'settings.json'
    return Path(record['projectPath']) / '.claude' / ('settings.local.json' if record['scope'] == 'local' else 'settings.json')


def activation_value(name, record):
    path = scope_settings(record)
    settings = read_json(path) if path.exists() else {}
    plugins = settings.get('enabledPlugins', {})
    key = f'{name}@{MARKETPLACE}'
    return (key in plugins, plugins.get(key))


def validate_scope_locations(records):
    for record in records:
        if record['scope'] != 'user' and not Path(record['projectPath']).is_dir():
            raise RuntimeError(f'Claude scope={record["scope"]} project={record["projectPath"]} is unavailable; existing registration was preserved')


def sync_plugin(name, hosts, catalog_prepared=False, preserve_activation=False):
    source, _, _ = manifests(name)
    expected = tree_hashes(source)
    for host in hosts:
        plugin_id = f'{name}@{MARKETPLACE}'
        try:
            if host == 'codex':
                prior = codex_record(name) if preserve_activation else None
                if prior is not None and not prior['active']:
                    raise RuntimeError('Codex plugin is disabled; this CLI cannot preserve disabled activation during add')
                command('codex', 'plugin', 'add', plugin_id, '--json')
                if prior is not None:
                    after = codex_record(name)
                    if after is None or after['active'] != prior['active']:
                        raise RuntimeError('native update changed the existing Codex activation state')
            elif host == 'claude':
                previous = claude_records(name)
                validate_scope_locations(previous)
                activations = {record_key(record): activation_value(name, record) for record in previous}
                if not catalog_prepared:
                    prepare_claude_catalog([name])
                targets = previous if any(record['scope'] == 'user' for record in previous) else [
                    {'scope': 'user', 'projectPath': None}, *previous]
                for record in targets:
                    scope, project = record_key(record)
                    context = f'claude/{name} scope={scope} project={project}'
                    try:
                        exists = record_key(record) in activations
                        args = ['claude', 'plugin', 'update' if exists else 'install', plugin_id, '--scope', scope]
                        if exists:
                            args += ['--json', '-y']
                        else:
                            args += ['--json']
                        command(*args, **({'cwd': Path(project)} if project else {}))
                        current = next((item for item in claude_records(name) if record_key(item) == record_key(record)), None)
                        if current is None:
                            raise RuntimeError('native CLI removed or failed to update the existing registration')
                        if exists and current['active'] != record['active']:
                            raise RuntimeError('native update changed the existing Claude activation state')
                        require_native_cache('claude', name, current)
                        verify_snapshot(current['cache'], read_json(source / '.codex-plugin/plugin.json'), expected)
                        if record_key(record) in activations and activation_value(name, record) != activations[record_key(record)]:
                            raise RuntimeError('native update changed the existing activation setting')
                    except (OSError, ValueError, RuntimeError) as error:
                        raise RuntimeError(context + ': ' + str(error)) from error
            else:
                command('muse', 'plugins', 'install', str(source), '--scope', 'user')
            if preserve_activation:
                check_plugin(name, [host], expected, allow_inactive=True)
            else:
                check_plugin(name, [host], expected)
        except (OSError, ValueError, RuntimeError) as error:
            raise RuntimeError(f'{host}/{name}: {error}') from error


def selection(args):
    if args.harness:
        if args.plugin or args.host or args.build_marker:
            raise ValueError('--harness cannot be combined with --plugin, --host or --build-marker')
        return list(HARNESS), ['codex', 'claude']
    if not args.plugin or not args.host:
        raise ValueError('Specify --harness or both --plugin and --host')
    return list(dict.fromkeys(args.plugin)), list(dict.fromkeys(args.host))


def preflight_native(names, hosts):
    # Read-only rejection precedes even updater lock-file creation. Repeat the
    # check under the locks in run_sync before any new transaction is prepared.
    for name in names:
        if 'codex' in hosts:
            record = codex_record(name)
            if record is not None and not record['active']:
                raise RuntimeError(f'codex/{name} is disabled; current native add has no supported disabled-preserving update. No files, catalogs or installations were changed')
        if 'claude' in hosts:
            validate_scope_locations(claude_records(name))


def run_sync(args, names, hosts):
    captured = {}
    for name in names:
        source, version, _ = manifests(name)
        captured[name] = tree_hashes(source)
        if 'codex' in hosts and not args.check:
            record = codex_record(name)
            if record is not None and not record['active']:
                raise RuntimeError(f'codex/{name} is disabled; current native add has no supported disabled-preserving update. No files, catalogs or installations were changed')
        if 'claude' in hosts:
            validate_scope_locations(claude_records(name))
        print(f'SOURCE {name}: {version}, {len(captured[name])} files; hosts={",".join(hosts)}')
    if args.preview:
        return 0
    if args.check:
        for name in names:
            check_plugin(name, hosts, allow_inactive=args.harness)
        print('All selected installed sources and scopes match.')
        return 0
    changed = names if args.build_marker else [name for name in names if args.harness and same_version_drift(name, hosts)]
    # No source mutation occurred before all input and scope preflights passed.
    for name in names:
        if tree_hashes(ROOT / 'plugins' / name) != captured[name]:
            raise RuntimeError('Source changed during preflight: ' + name)
    if changed:
        print(json.dumps({'build_versions': refresh_build_versions(changed)}))
    if 'claude' in hosts:
        prepare_claude_catalog(names)
    for name in names:
        sync_plugin(name, hosts, catalog_prepared='claude' in hosts, preserve_activation=args.harness)
    print('All selected installations verified. Start a new session to load them.')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness', action='store_true', help='update state-ledger/project-context/spec-plan/agent-results for Codex and Claude together')
    parser.add_argument('--plugin', action='append')
    parser.add_argument('--host', action='append', choices=('codex', 'claude', 'muse'))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='read-only effective source, scope and installed snapshot verification')
    mode.add_argument('--preview', action='store_true', help='source/scope preflight only; no publication, version, catalog or native writes')
    parser.add_argument('--build-marker', action='store_true', help='explicitly bump selected source versions before native sync')
    args = parser.parse_args()
    try:
        if args.build_marker and (args.check or args.preview):
            raise ValueError('--build-marker cannot be combined with read-only modes')
        names, hosts = selection(args)
        for executable in [*hosts, *(['git'] if 'claude' in hosts else [])]:
            if not shutil.which(executable):
                raise RuntimeError('Missing native CLI: ' + executable)
        if args.preview or args.check:
            return run_sync(args, names, hosts)
        preflight_native(names, hosts)
        # A source checkout can be shared by different native homes, and distinct
        # source clones can share a catalog. Always lock source, then base.
        lock_paths = [ROOT / '.plugin-sync.lock']
        if 'claude' in hosts:
            lock_paths.append(publication.default_base() / '.sync-plugins.lock')
        with transaction.locks(*lock_paths):
            transaction.recover(ROOT, manifest_journal())
            if 'claude' in hosts:
                transaction.recover(catalog_root(), alias_journal())
            return run_sync(args, names, hosts)
    except (OSError, ValueError, KeyError, StopIteration, RuntimeError) as error:
        print(f'NOT SYNCHRONIZED: {error}\nPartial update possible; no success is claimed. Existing scopes/publications were not deleted. Resolve the named host/scope error and rerun.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
