#!/usr/bin/env python3
"""Refresh the three user installations, then verify their versions and skill bytes."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins/spec-plan"
CODEX_HOME_PATH = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
PLUGIN_ID = "spec-plan@hibye-plugins"


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def command(*args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"{args[0]} {args[1]} failed: {result.stderr or result.stdout}")
    return result.stdout


def tree_hashes(root):
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError(f"Expected a snapshot directory: {root}")
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise RuntimeError(f"Snapshot contains a source link: {path}")
        if path.is_file():
            result[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def verify_cache(cache, expected):
    # The version directory itself must not be a source link either.
    if cache.is_symlink() or not cache.is_dir():
        raise RuntimeError(f"Expected installed snapshot: {cache}")
    if tree_hashes(cache / "skills") != expected:
        raise RuntimeError(f"Skill contents differ from source: {cache}")


def check():
    expected = tree_hashes(PLUGIN / "skills")
    if "spec-plan/SKILL.md" not in expected:
        raise RuntimeError("Canonical spec-plan/SKILL.md is missing")
    codex = json.loads(command("codex", "plugin", "list", "--marketplace", "hibye-plugins", "--json"))
    codex = next(p for p in codex["installed"] if p["pluginId"] == PLUGIN_ID)
    claude = json.loads(command("claude", "plugin", "list", "--json"))
    claude = next(p for p in claude if p["id"] == PLUGIN_ID and p["scope"] == "user")
    muse = json.loads(command("muse", "plugins", "inspect", "spec-plan", "--json"))
    versions = {"codex": codex["version"], "claude": claude["version"], "muse": muse["record"]["version"]}
    wanted = read_json(PLUGIN / ".codex-plugin/plugin.json")["version"]
    if set(versions.values()) != {wanted} or read_json(PLUGIN / ".claude-plugin/plugin.json")["version"] != wanted:
        raise RuntimeError(f"Version mismatch: source={wanted}, installed={versions}")
    if not (codex["enabled"] and claude["enabled"] and muse["valid"] and muse["active"]):
        raise RuntimeError("A host has not activated spec-plan")
    caches = {
        "codex": CODEX_HOME_PATH / "plugins/cache/hibye-plugins/spec-plan" / wanted,
        "claude": Path(claude["installPath"]),
        "muse": Path(muse["record"]["cache_path"]),
    }
    for host, cache in caches.items():
        verify_cache(cache, expected)
        print(f"OK {host}: {wanted}, {len(expected)} matching skill files")
    if tree_hashes(PLUGIN / "skills") != expected:
        raise RuntimeError("Source changed during verification; rerun against stable inputs")
    # Keep the existing CLI and public fixture helpers, but final acceptance now
    # includes every manifest, hook, runtime and referenced configuration file.
    import importlib.util
    helper_path = Path(__file__).with_name("sync-plugins.py")
    helper_spec = importlib.util.spec_from_file_location("hibye_snapshot_sync", helper_path)
    helper = importlib.util.module_from_spec(helper_spec)
    helper_spec.loader.exec_module(helper)
    helper.ROOT = ROOT
    helper.check_plugin("spec-plan", ["codex", "claude", "muse"])


def refresh_manifests():
    marketplace_name = read_json(ROOT / ".agents/plugins/marketplace.json")["name"]
    if marketplace_name != "hibye-plugins":
        raise RuntimeError(f"Unexpected marketplace: {marketplace_name}")
    codex_path = PLUGIN / ".codex-plugin/plugin.json"
    codex_manifest = read_json(codex_path)
    claude_path = PLUGIN / ".claude-plugin/plugin.json"
    claude_manifest = read_json(claude_path)
    marketplace_path = ROOT / ".claude-plugin/marketplace.json"
    marketplace = read_json(marketplace_path)
    entry = next(p for p in marketplace["plugins"] if p["name"] == "spec-plan")
    # A fresh build marker makes native installs refresh their snapshots, even
    # when the semantic version is unchanged. No bundled helper is required.
    base_version = codex_manifest["version"].split("+", 1)[0]
    marker = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    version = f"{base_version}+codex.{marker}"
    codex_manifest["version"] = claude_manifest["version"] = version
    entry["version"] = version
    write_json(codex_path, codex_manifest)
    write_json(claude_path, claude_manifest)
    write_json(marketplace_path, marketplace)
    return version


def sync():
    for executable in ("codex", "claude", "muse"):
        if not shutil.which(executable):
            raise RuntimeError(f"Missing CLI: {executable}")
    print(f"Build version: {refresh_manifests()}")
    for args in [
        ("codex", "plugin", "add", PLUGIN_ID, "--json"),
        ("claude", "plugin", "update", PLUGIN_ID, "--scope", "user", "--json", "-y"),
        ("muse", "plugins", "update", "spec-plan", "--json"),
    ]:
        command(*args)
        print(f"Updated {args[0]}")
    check()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Read-only version/content/snapshot verification")
    args = parser.parse_args()
    try:
        check() if args.check else sync()
    except (OSError, ValueError, KeyError, StopIteration, RuntimeError) as error:
        print(f"NOT SYNCHRONIZED: {error}\nSome hosts may have updated; resolve the error and rerun.", file=sys.stderr)
        return 1
    print("All three installations match. Use a new session to load them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
