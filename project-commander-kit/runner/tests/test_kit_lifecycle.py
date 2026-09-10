"""Lifecycle tests for the kit's transactional install / upgrade / rollback tool.

These run the real `pck.py` against a throwaway runtime directory.  Nothing
here contacts GitHub, a provider, or the network.
"""
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parents[1]
CANDIDATES = (
    HERE.parents[0] / "scripts/pck.py",                        # inside the kit
    HERE.parents[1] / "project-commander-kit/scripts/pck.py",  # source repo
)
PCK = next((path for path in CANDIDATES if path.is_file()), None)


@unittest.skipIf(PCK is None, "pck.py not present in this layout")
class KitLifecycleTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.runtime = root / "runtime"
        for name in ("repo", "worktrees"):
            (root / name).mkdir()
        self.example = json.loads(
            (PCK.parents[1] / "config/config.example.json").read_text())
        self.example.update({
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
        self.write_config(self.example)

    def tearDown(self):
        self.tmp.cleanup()

    def write_config(self, value, mode=0o600):
        self.config.write_text(value if isinstance(value, str) else json.dumps(value))
        self.config.chmod(mode)

    def pck(self, *args, with_config=True):
        # Signal that we are already inside the kit's own suite, so the script
        # does not re-launch it and recurse into this very test.
        environment = dict(os.environ, PCK_IN_SELFTEST="1")
        argv = [sys.executable, str(PCK), *args]
        if with_config:
            argv += ["--config", str(self.config)]
        result = subprocess.run(argv, capture_output=True, text=True,
                                env=environment, timeout=300)
        payload = json.loads(result.stdout) if result.stdout.strip().startswith("{") else {}
        return result, payload

    def current(self):
        return self.runtime / "current"

    def entrypoint(self):
        return self.current() / "commander_runner.py"

    def versions(self):
        directory = self.runtime / "versions"
        if not directory.is_dir():
            return []
        return sorted(path.name for path in directory.iterdir()
                      if path.is_dir() and not path.name.startswith("."))


class TransactionalInstallTests(KitLifecycleTestCase):
    def test_install_creates_a_version_directory_and_a_current_pointer(self):
        result, report = self.pck("install")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.current().is_symlink())
        self.assertTrue(self.entrypoint().is_file())
        self.assertEqual(len(self.versions()), 1)
        self.assertIsNone(report["previous"])
        self.assertIn("source_commit", report)
        self.assertRegex(report["installed_at"], r"^\d{4}-\d{2}-\d{2}T")

    def test_manifest_records_provenance_and_matches_the_installed_bytes(self):
        self.pck("install")
        manifest = json.loads((self.current() / "runtime-manifest.json").read_text())
        self.assertEqual(manifest["schema_version"], 3)
        self.assertIn("source_commit", manifest)
        self.assertIn("installed_at", manifest)
        for name, expected in manifest["files"].items():
            actual = hashlib.sha256((self.current() / name).read_bytes()).hexdigest()
            self.assertEqual(actual, expected, name)

    def test_upgrade_switches_the_pointer_and_keeps_the_previous_version_intact(self):
        self.pck("install")
        first = self.current().resolve()
        first_bytes = (first / "commander_runner.py").read_bytes()

        result, report = self.pck("upgrade")
        self.assertEqual(result.returncode, 0, result.stderr)
        second = self.current().resolve()
        self.assertNotEqual(first, second)
        self.assertEqual(report["previous"], str(first))
        # The previous version directory is left exactly as it was: upgrade
        # writes a new directory and moves the pointer, it never edits in place.
        self.assertEqual((first / "commander_runner.py").read_bytes(), first_bytes)
        self.assertEqual(len(self.versions()), 2)

    def test_rollback_repoints_to_the_previous_version_and_deletes_nothing(self):
        self.pck("install")
        first = self.current().resolve()
        self.pck("upgrade")
        second = self.current().resolve()
        self.assertNotEqual(first, second)

        result, report = self.pck("rollback")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.current().resolve(), first)
        self.assertEqual(report["previous"], str(second))
        # Rollback repoints; it never removes. Both versions stay on disk so a
        # roll-forward is still possible.
        self.assertEqual(len(self.versions()), 2)
        self.assertTrue((second / "commander_runner.py").is_file())

    def test_rollback_to_a_tampered_version_is_refused(self):
        """Integrity is verified after the swap, not assumed from the label."""
        self.pck("install")
        first = self.current().resolve()
        self.pck("upgrade")
        target = first / "commander_runner.py"
        target.chmod(0o700)
        with target.open("a") as handle:
            handle.write("# tampered\n")
        result, _ = self.pck("rollback")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("manifest digest", result.stderr)

    def test_a_failed_stage_leaves_the_running_version_active(self):
        """The point of staging: a broken source cannot take the host down."""
        self.pck("install")
        live = self.current().resolve()
        live_bytes = (live / "commander_runner.py").read_bytes()

        spec = importlib.util.spec_from_file_location("pck_under_test", PCK)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        broken = Path(self.tmp.name) / "broken-source"
        broken.mkdir()
        # Only one of the two required runtime files exists.
        (broken / "commander_runner.py").write_text("print('x')\n")
        module.SOURCE = broken
        os.environ["PCK_IN_SELFTEST"] = "1"
        with self.assertRaises(module.DoctorFailure):
            module.install_transactional(json.loads(self.config.read_text()))

        self.assertEqual(self.current().resolve(), live)
        self.assertEqual((live / "commander_runner.py").read_bytes(), live_bytes)
        leftovers = [path.name for path in (self.runtime / "versions").iterdir()
                     if path.name.startswith(".staging")]
        self.assertEqual(leftovers, [])

    def test_install_refuses_to_clobber_an_active_runtime(self):
        self.pck("install")
        result, _ = self.pck("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("upgrade", (result.stderr + result.stdout).lower())

    def test_rollback_without_an_earlier_version_fails_loudly(self):
        self.pck("install")
        result, _ = self.pck("rollback")
        self.assertNotEqual(result.returncode, 0)


class InstallerTestsWhatItShips(KitLifecycleTestCase):
    def test_pck_runs_the_suite_of_the_tree_it_installs_from(self):
        """P1-6: the gate must exercise the bytes that will be installed."""
        text = PCK.read_text()
        self.assertIn('str(SOURCE / "tests")', text)
        self.assertNotIn('str(KIT / "runner" / "tests")', text)


class AuditFollowupTests(KitLifecycleTestCase):
    def test_install_refuses_when_the_kit_copy_has_drifted(self):
        """P1-6(a): the gate must be the tree being installed, in sync."""
        kit_copy = PCK.parents[1] / "runner" / "commander_runner.py"
        original = kit_copy.read_bytes()
        try:
            with kit_copy.open("ab") as handle:
                handle.write(b"\n# drift\n")
            result, _ = self.pck("install")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("drift", result.stderr.lower())
        finally:
            kit_copy.write_bytes(original)

    def test_a_dangling_pointer_from_a_crashed_swap_is_swept(self):
        """P2-7: a `.current.<pid>` temporary left between symlink and rename."""
        self.pck("install")
        stray = self.runtime / ".current.999.1"
        os.symlink(self.runtime / "versions", stray)
        self.pck("upgrade")
        self.assertFalse(stray.exists() or stray.is_symlink())

    def test_prune_never_removes_a_young_version_or_the_launchd_target(self):
        spec = importlib.util.spec_from_file_location("pck_under_test", PCK)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        config = json.loads(self.config.read_text())
        versions = self.runtime / "versions"
        for name in ("v01", "v02", "v03"):
            (versions / name).mkdir(parents=True)
            (versions / name / "commander_runner.py").write_text("#")
        os.symlink(versions / "v03", self.runtime / "current")
        # v01 is old enough to prune; v02 is old too but launchd runs from it.
        ancient = 30 * 24 * 3600
        for name in ("v01", "v02"):
            os.utime(versions / name, (ancient, ancient))
        with mock.patch.object(module, "launchd_target", return_value=(versions / "v02").resolve()):
            removed = module.prune_versions(config, keep=1)
        self.assertEqual(removed, ["v01"])
        self.assertTrue((versions / "v02").is_dir())

    def test_sync_list_is_derived_so_a_new_source_file_is_not_silently_skipped(self):
        """P1-6(c): a hand-kept SYNCED tuple made new files opt-in."""
        sync = PCK.parent / "sync_from_source.py"
        source_dir = PCK.parents[2] / "tools" / "commander-runner"
        probe = source_dir / "zz_probe_new_file.py"
        try:
            probe.write_text("# probe\n")
            result = subprocess.run([sys.executable, str(sync), "--check"],
                                    capture_output=True, text=True, timeout=60)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("zz_probe_new_file.py", result.stderr)
        finally:
            probe.unlink(missing_ok=True)


class DoctorNegativeTests(KitLifecycleTestCase):
    """`doctor` must never report ok:true on a config it could not use.

    Every case here previously slipped through: the report was flattened and
    any value that was not literally `False` counted as a passing check, so a
    diagnostic string such as "invalid: ..." read as success.
    """

    def assert_doctor_fails(self, needle):
        result, report = self.pck("doctor")
        self.assertNotEqual(result.returncode, 0, f"doctor passed; report={report}")
        self.assertFalse(report.get("ok", True))
        joined = " ".join(report.get("failures", [])).lower()
        self.assertIn(needle, joined, joined)

    def test_corrupted_json_fails(self):
        self.write_config("{ this is not json")
        self.assert_doctor_fails("not valid json")

    def test_world_readable_config_fails(self):
        self.write_config(self.example, mode=0o644)
        self.assert_doctor_fails("accessible")

    def test_group_readable_config_fails(self):
        self.write_config(self.example, mode=0o640)
        self.assert_doctor_fails("accessible")

    def test_missing_required_fields_fail(self):
        for field in ("repository", "runner_id", "runtime_dir", "quality_gates",
                      "commander_login", "executor_login"):
            with self.subTest(field=field):
                broken = dict(self.example)
                broken.pop(field)
                self.write_config(broken)
                self.assert_doctor_fails("missing required fields")

    def test_empty_critical_field_fails(self):
        broken = dict(self.example)
        broken["runner_id"] = "   "
        self.write_config(broken)
        self.assert_doctor_fails("non-empty")

    def test_identical_commander_and_executor_logins_fail(self):
        broken = dict(self.example)
        broken["executor_login"] = broken["commander_login"]
        self.write_config(broken)
        self.assert_doctor_fails("different github accounts")

    def test_config_that_is_not_an_object_fails(self):
        self.write_config("[1, 2, 3]")
        self.assert_doctor_fails("json object")

    def test_missing_config_file_fails(self):
        self.config.unlink()
        self.assert_doctor_fails("not found")

    def test_tampered_installed_runtime_fails(self):
        self.pck("install")
        target = self.current().resolve() / "commander_runner.py"
        target.chmod(0o700)
        with target.open("a") as handle:
            handle.write("# tampered\n")
        self.assert_doctor_fails("does not match its manifest digest")

    def test_healthy_kit_without_a_config_still_reports_ok(self):
        """The negative cases must not have made doctor unconditionally fail."""
        result, report = self.pck("doctor", with_config=False)
        self.assertEqual(result.returncode, 0, report)
        self.assertTrue(report["ok"])
        self.assertEqual(report["failures"], [])


if __name__ == "__main__":
    unittest.main()
