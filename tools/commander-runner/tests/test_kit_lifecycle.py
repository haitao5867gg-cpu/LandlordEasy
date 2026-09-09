"""Lifecycle tests for the kit's install / upgrade / rollback tool.

These run the real `pck.py` against a throwaway runtime directory.  Nothing
here contacts GitHub, a provider, or the network.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
CANDIDATES = (
    HERE.parents[0] / "scripts/pck.py",                       # inside the kit
    HERE.parents[1] / "project-commander-kit/scripts/pck.py",  # source repo
)
PCK = next((path for path in CANDIDATES if path.is_file()), None)


@unittest.skipIf(PCK is None, "pck.py not present in this layout")
class KitLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.runtime = root / "runtime"
        for name in ("repo", "worktrees"):
            (root / name).mkdir()
        example = json.loads(
            (PCK.parents[1] / "config/config.example.json").read_text())
        example.update({
            "repository": "acme/widget", "queue_issue": 1,
            "commander_login": "acme-commander", "executor_login": "acme-executor",
            "runner_id": "acme-runner-01",
            "canonical_repo": str(root / "repo"),
            "worktree_root": str(root / "worktrees"),
            "state_dir": str(root / "state"), "runtime_dir": str(self.runtime),
            "operational_executables": {"gh": "/usr/bin/true", "git": "/usr/bin/git",
                                        "python": sys.executable},
            "executable_paths": {"kiro": "/usr/bin/true", "copilot": "/usr/bin/true",
                                 "claude": "/usr/bin/true"},
            "quality_gates": {"none": []}, "enabled_quality_gates": ["none"],
        })
        self.config = root / "config.json"
        self.config.write_text(json.dumps(example))
        self.config.chmod(0o600)

    def tearDown(self):
        self.tmp.cleanup()

    def pck(self, *args):
        # Signal that we are already inside the kit's own suite, so the script
        # does not re-launch it and recurse into this very test.
        environment = dict(os.environ, PCK_IN_SELFTEST="1")
        result = subprocess.run([sys.executable, str(PCK), *args, "--config", str(self.config)],
                                capture_output=True, text=True, env=environment, timeout=120)
        return result, (json.loads(result.stdout) if result.stdout.strip().startswith("{") else {})

    def entrypoint(self):
        return self.runtime / "commander_runner.py"

    def test_install_upgrade_rollback_round_trip_preserves_the_old_runtime(self):
        result, report = self.pck("install")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.entrypoint().is_file())

        # Mark the installed copy so we can prove rollback restores THIS content.
        marker = "# drift-marker\n"
        with self.entrypoint().open("a") as handle:
            handle.write(marker)

        result, report = self.pck("upgrade")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(marker, self.entrypoint().read_text())
        self.assertTrue(report["backups"])

        result, report = self.pck("rollback")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(marker, self.entrypoint().read_text())

    def test_backups_are_never_overwritten_within_the_same_second(self):
        """Regression: a same-second collision let rollback destroy the backup
        it was about to restore, losing the previous runtime entirely."""
        self.pck("install")
        with self.entrypoint().open("a") as handle:
            handle.write("# drift-marker\n")
        self.pck("upgrade")
        before = {path.name for path in self.runtime.glob("*.bak")}
        self.pck("rollback")
        after = {path.name for path in self.runtime.glob("*.bak")}
        # Nothing may disappear, and rollback must add its own safety copy.
        self.assertTrue(before <= after, f"backups lost: {before - after}")
        self.assertGreater(len(after), len(before))

    def test_install_refuses_to_clobber_an_existing_runtime(self):
        self.pck("install")
        result, _ = self.pck("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("upgrade", result.stderr.lower() + result.stdout.lower())

    def test_rollback_without_any_backup_fails_loudly(self):
        self.pck("install")
        result, _ = self.pck("rollback")
        self.assertNotEqual(result.returncode, 0)

    def test_world_readable_config_is_refused(self):
        self.config.chmod(0o644)
        result, _ = self.pck("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("600", result.stderr + result.stdout)


if __name__ == "__main__":
    unittest.main()
