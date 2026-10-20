"""Small regression tests: manifest refresh, snapshot isolation, drift, and failure."""

from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("sync_spec_plan", HERE / "sync-spec-plan.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class SnapshotTests(unittest.TestCase):
    def test_manifest_refresh_preserves_other_fields_and_replaces_build_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plugin = root / "plugins/spec-plan"
            fixtures = {
                root / ".agents/plugins/marketplace.json": {"name": "hibye-plugins"},
                plugin / ".codex-plugin/plugin.json": {"name": "spec-plan", "version": "1.1.2+codex.old", "skills": "./skills/"},
                plugin / ".claude-plugin/plugin.json": {"name": "spec-plan", "version": "1.1.1", "author": {"name": "fixture"}},
                root / ".claude-plugin/marketplace.json": {"plugins": [
                    {"name": "other", "version": "9.0.0"},
                    {"name": "spec-plan", "version": "1.1.1", "source": "./plugins/spec-plan"},
                ]},
            }
            for path, value in fixtures.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                sync.write_json(path, value)
            with patch.object(sync, "ROOT", root), patch.object(sync, "PLUGIN", plugin), \
                 patch.object(sync, "datetime") as clock:
                clock.now.side_effect = [datetime(2026, 10, 2, 1, 2, 3, microsecond=n, tzinfo=timezone.utc) for n in (1, 2)]
                versions = [sync.refresh_manifests(), sync.refresh_manifests()]
                self.assertNotEqual(*versions)
                self.assertEqual(versions[-1], "1.1.2+codex.20261002010203000002")
                for path, original in fixtures.items():
                    expected = json.loads(json.dumps(original))
                    if path.parent.name in (".codex-plugin", ".claude-plugin") and path.name == "plugin.json":
                        expected["version"] = versions[-1]
                    elif path == root / ".claude-plugin/marketplace.json":
                        expected["plugins"][1]["version"] = versions[-1]
                    self.assertEqual(sync.read_json(path), expected)

    def test_link_hook_preserves_spec_plan_and_other_plugins_behavior(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            shutil.copyfile(HERE / "link-cache.sh", root / "scripts/link-cache.sh")
            cache_home = root / "cache-home"
            for name in ("spec-plan", "other"):
                plugin = root / "plugins" / name
                (plugin / "skills").mkdir(parents=True)
                for family in ("claude", "codex"):
                    manifest = plugin / f".{family}-plugin/plugin.json"
                    manifest.parent.mkdir()
                    manifest.write_text(json.dumps({"name": name, "version": "1.0.0"}, indent=2))
                    installed = cache_home / f".{family}/plugins/cache/hibye-plugins" / name / "1.0.0"
                    installed.mkdir(parents=True)
                    (installed / "sentinel").write_text("installed snapshot")
            env = {**os.environ, "HIBYE_PLUGIN_CACHE_HOME": str(cache_home)}
            for args in ([], ["--codex-dev-links"]):
                subprocess.run(["bash", str(root / "scripts/link-cache.sh"), *args],
                               env=env, check=True, capture_output=True, text=True)
                for family in ("claude", "codex"):
                    cache = cache_home / f".{family}/plugins/cache/hibye-plugins/spec-plan"
                    self.assertFalse((cache / "1.0.0").is_symlink())
                    self.assertEqual((cache / "1.0.0/sentinel").read_text(), "installed snapshot")
                    self.assertFalse((cache / "current").exists())
                    self.assertFalse((cache / "skills").exists())
                other = cache_home / ".claude/plugins/cache/hibye-plugins/other"
                self.assertEqual((other / "1.0.0").resolve(), (root / "plugins/other").resolve())
                self.assertEqual((other / "skills").resolve(), (root / "plugins/other/skills").resolve())
            self.assertTrue((cache_home / ".codex/plugins/cache/hibye-plugins/other/1.0.0/skills").is_symlink())

    def test_verification_rejects_drift_and_live_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            skill = root / "cache/skills/spec-plan/SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text("original")
            expected = sync.tree_hashes(root / "cache/skills")
            sync.verify_cache(root / "cache", expected)
            skill.write_text("different")
            with self.assertRaisesRegex(RuntimeError, "differ"):
                sync.verify_cache(root / "cache", expected)
            (root / "linked-cache").symlink_to(root / "cache", target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "snapshot"):
                sync.verify_cache(root / "linked-cache", expected)
            (skill.parent / "linked.md").symlink_to(skill)
            with self.assertRaisesRegex(RuntimeError, "source link"):
                sync.tree_hashes(root / "cache/skills")

    def test_failed_host_stops_before_next_host_and_success_check(self):
        calls = []
        def fake_command(*args):
            calls.append(args)
            if args[0] == "claude":
                raise RuntimeError("fixture update failure")
            return "{}"
        with patch.object(sync.shutil, "which", return_value="/fixture/cli"), \
             patch.object(sync, "command", side_effect=fake_command), \
             patch.object(sync, "refresh_manifests", return_value="1.1.2+codex.fixture"), \
             patch.object(sync, "check") as check:
            with self.assertRaisesRegex(RuntimeError, "fixture update failure"):
                sync.sync()
            self.assertTrue(any(args[0] == "codex" for args in calls))
            self.assertFalse(any(args[0] == "muse" for args in calls))
            check.assert_not_called()


if __name__ == "__main__":
    unittest.main()
