import importlib.util
import json
import os
import plistlib
import sys
import tempfile
import types
import unittest
import uuid
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("commander_runner", HERE / "commander_runner.py")
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
spec.loader.exec_module(runner)

SHA = "a" * 40
JOB_ID = "123e4567-e89b-12d3-a456-426614174000"

class RunnerTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.repo, self.worktrees, self.state = root / "repo", root / "worktrees", root / "state"
        self.repo.mkdir(); self.worktrees.mkdir()
        self.config = runner.Config("owner/repo", 42, "commander", "runner-001", self.repo,
                                    self.worktrees, self.state, "https://example.invalid/owner/repo.git")
    def tearDown(self): self.tmp.cleanup()
    def data(self, **changes):
        value = {
            "schema": runner.SCHEMA, "job_id": JOB_ID, "repository": "owner/repo", "queue_issue": 42,
            "target_sha": SHA, "worktree_id": runner.derive_worktree_id(JOB_ID), "runner_id": "runner-001",
            "worker": "kiro", "model": "gpt-5.6-luna", "profile": "repo_read", "assigned": "ORG-002",
            "prompt": "Read the assigned specification.", "timeout_seconds": 30, "output_limit_bytes": 1024,
            "expected_evidence": "summary",
        }
        value.update(changes); return value
    def comment(self, **changes):
        return "COMMANDER_JOB_V1\n```json\n" + json.dumps(self.data(**changes)) + "\n```"

class SchemaTests(RunnerTestCase):
    def test_valid_job_and_derived_worktree(self):
        job = runner.Job.from_comment(self.comment(), self.config)
        self.assertEqual(job.job_id, JOB_ID)
        self.assertEqual(job.worktree_id, "job-" + JOB_ID)
    def test_rejects_unknown_missing_and_malformed_envelope(self):
        with self.assertRaises(runner.ValidationError):
            runner.Job.from_comment(self.comment(unexpected=True), self.config)
        value = self.data(); del value["prompt"]
        with self.assertRaises(runner.ValidationError):
            runner.Job.from_comment("COMMANDER_JOB_V1\n```json\n" + json.dumps(value) + "\n```", self.config)
        with self.assertRaises(runner.ValidationError):
            runner.Job.from_comment("prose\n" + self.comment(), self.config)
    def test_rejects_trust_boundary_and_allowlist_failures(self):
        for changes in (
            {"repository": "other/repo"}, {"queue_issue": 43}, {"runner_id": "other-runner"},
            {"target_sha": "main"}, {"worktree_id": "../../x"}, {"worker": "kiro", "model": "unknown"},
            {"profile": "production"}, {"timeout_seconds": 0}, {"output_limit_bytes": runner.MAX_OUTPUT_BYTES + 1},
        ):
            with self.subTest(changes=changes), self.assertRaises(runner.ValidationError):
                runner.Job.from_comment(self.comment(**changes), self.config)

class SecurityTests(RunnerTestCase):
    def test_shell_fragments_are_rejected(self):
        payload = "$(touch bad); ; rm -rf / | `whoami`"
        with self.assertRaises(runner.ValidationError):
            runner.Job.from_comment(self.comment(prompt=payload), self.config)
    def test_adapter_snapshots_have_no_dangerous_tools(self):
        for worker, model in (("kiro", "gpt-5.6-luna"), ("copilot", "claude-sonnet-5"), ("claude", "claude-sonnet-5")):
            job = runner.Job.from_comment(self.comment(worker=worker, model=model), self.config)
            text = " ".join(runner.adapter_argv(job, {})).lower()
            with self.subTest(worker=worker):
                self.assertNotIn("--allow-all", text); self.assertNotIn("--yolo", text)
                self.assertIn("--model", text)
        read_text = " ".join(runner.adapter_argv(runner.Job.from_comment(self.comment(), self.config), {}))
        self.assertIn("--no-interactive", read_text)
        self.assertIn("--trust-tools=fs_read", read_text); self.assertNotIn("fs_read,fs_write", read_text)
        self.assertNotIn("--model auto", read_text)
    def test_path_environment_and_redaction_controls(self):
        with self.assertRaises(runner.ValidationError): runner.checked_child(self.worktrees, "../../escape", True)
        link = self.worktrees / "job-abc"
        try:
            link.symlink_to(self.repo, target_is_directory=True)
            with self.assertRaises(runner.ValidationError): runner.checked_child(self.worktrees, "job-abc", True)
        finally:
            if link.exists() or link.is_symlink(): link.unlink()
        env = runner.safe_environment({"PATH": "/bin", "TOKEN": "secret", "HOME": "/safe"})
        self.assertEqual(env, {"PATH": "/bin", "HOME": "/safe"})
        safe = runner.ensure_safe_post("token=verysecretvalue ghp_abcdefghijklmnopqrstuv")
        self.assertNotIn("verysecretvalue", safe); self.assertNotIn("ghp_", safe)
    def test_output_cap_is_enforced_without_shell(self):
        result = runner.execute([sys.executable, "-c", "print('x'*10000)"], timeout=10, cap=100)
        self.assertTrue(result.overflow); self.assertLessEqual(len(result.output.encode()), 100)

class StateTests(RunnerTestCase):
    def test_atomic_claim_edit_binding_and_crash_recovery(self):
        state = runner.State(self.state)
        self.assertTrue(state.claim("1", JOB_ID, "hash-a"))
        self.assertFalse(state.claim("1", JOB_ID, "hash-a"))
        with self.assertRaises(runner.ValidationError): state.claim("1", JOB_ID, "hash-b")
        state.close()
        restarted = runner.State(self.state)
        self.assertFalse(restarted.claim("1", JOB_ID, "hash-a"))
        with self.assertRaises(runner.ValidationError): restarted.claim("2", JOB_ID, "hash-a")
        restarted.close()
    def test_explicit_states_and_restart_recovery(self):
        state = runner.State(self.state)
        self.assertTrue(state.claim("1", JOB_ID, "hash-a"))
        self.assertEqual(state.summary()["jobs"], {"claimed": 1})
        self.assertEqual(state.recover_incomplete(), 1)
        self.assertEqual(state.summary()["jobs"], {"blocked": 1})
        with self.assertRaises(runner.ValidationError): state.set_status("1", "running")
        state.close()
    def test_single_node_lease_and_process_lock(self):
        state = runner.State(self.state)
        self.assertTrue(state.acquire_lease("runner-001", 60))
        self.assertFalse(state.acquire_lease("runner-002", 60)); state.close()
        with runner.ProcessLock(self.state):
            with self.assertRaises(runner.RunnerError):
                with runner.ProcessLock(self.state): pass

class GitHubAndLaunchAgentTests(RunnerTestCase):
    def test_github_client_cannot_escape_queue_issue(self):
        client = runner.GitHubClient(self.config)
        with self.assertRaises(runner.ValidationError): client._api("POST", "repos/owner/repo/issues/99/comments", {"body": "x"})
    def test_wrong_author_fixture_is_ignored_without_execution(self):
        class FixtureClient:
            def __init__(self, config): pass
            def verify_login(self): pass
            def comments(self): return [{"id": 1, "user": {"login": "attacker"}, "body": self.outer.comment()}]
            def post(self, body): raise AssertionError("no post")
        FixtureClient.outer = self
        with mock.patch.object(runner, "GitHubClient", FixtureClient):
            self.assertEqual(runner.run_once(self.config), "NO_JOB")
    def test_launchagent_rendering_is_inert_and_bounded_to_fixture(self):
        rendered = runner.make_launchagent({"Label": "com.landlordeasy.commander-runner", "KeepAlive": True},
                                           "/fixture/python", "/fixture/runner.py", "/fixture/config.json", "/fixture/state")
        data = plistlib.loads(rendered)
        self.assertTrue(data["RunAtLoad"])
        self.assertEqual(data["ProgramArguments"][:2], ["/fixture/python", "/fixture/runner.py"])
        self.assertIn("/fixture/state", data["StandardOutPath"])

    def test_install_stop_uninstall_use_temporary_home_fixture(self):
        config_path = Path(self.tmp.name) / "config.json"
        config_path.write_text(json.dumps({
            "repository": "owner/repo", "queue_issue": 42, "commander_login": "commander", "runner_id": "runner-001",
            "canonical_repo": str(self.repo), "worktree_root": str(self.worktrees), "state_dir": str(self.state),
            "origin_url": "https://example.invalid/owner/repo.git", "poll_seconds": 60, "lease_seconds": 180,
            "provider_failover": True,
            "executable_paths": {"kiro": sys.executable, "copilot": sys.executable, "claude": sys.executable},
        }))
        os.chmod(config_path, 0o600)
        fixture_home = Path(self.tmp.name) / "home"; fixture_home.mkdir()
        args = types.SimpleNamespace(config=str(config_path), confirm=True)
        with mock.patch.object(runner.Path, "home", return_value=fixture_home), \
             mock.patch.object(runner, "doctor", return_value={"ok": True}):
            self.assertEqual(runner.command_install(args), 0)
            launchagent = fixture_home / "Library/LaunchAgents/com.landlordeasy.commander-runner.plist"
            self.assertTrue(launchagent.exists())
            with mock.patch.object(runner, "run_launchctl") as launchctl:
                self.assertEqual(runner.command_stop(), 0)
                self.assertEqual(runner.command_uninstall(args), 0)
                self.assertGreaterEqual(launchctl.call_count, 2)
            self.assertFalse(launchagent.exists())

class ProviderAndQuotaTests(RunnerTestCase):
    def test_normalizes_plain_fenced_and_claude_wrapped_json(self):
        payload = {"status": "ok", "summary": "done", "evidence": ["tests passed"]}
        for text in (json.dumps(payload), "note\n```json\n" + json.dumps(payload) + "\n```",
                     json.dumps({"result": json.dumps(payload)})):
            with self.subTest(text=text):
                value = runner.normalize_provider_output(text)
                self.assertEqual(value.status, "ok"); self.assertEqual(value.evidence, ("tests passed",))
        with self.assertRaises(runner.ValidationError):
            runner.normalize_provider_output('{"status":"ok","summary":"missing evidence"}')

    def test_error_classification_and_safe_failover(self):
        result = runner.Result(1, "authentication required", False, False, 0.1)
        self.assertEqual(runner.classify_provider_error(result), "AUTH")
        self.assertIn("AUTH", runner.SAFE_FAILOVER_CATEGORIES)
        self.assertNotIn("TIMEOUT", runner.SAFE_FAILOVER_CATEGORIES)
        job = runner.Job.from_comment(self.comment(), self.config)
        calls = []
        def fake_execute(argv, **kwargs):
            calls.append(argv[0])
            if len(calls) == 1: return result
            return runner.Result(0, '{"status":"ok","summary":"done","evidence":[]}', False, False, 0.1)
        config = runner.dataclasses.replace(self.config, provider_failover=True)
        with mock.patch.object(runner, "execute", side_effect=fake_execute):
            attempt, attempts = runner.execute_with_failover(job, config, self.repo)
        self.assertEqual(attempt.worker, "copilot"); self.assertEqual(len(attempts), 2)

    def test_runtime_and_timeout_do_not_repeat_ambiguous_work(self):
        job = runner.Job.from_comment(self.comment(), self.config)
        for result in (runner.Result(1, "ordinary failure", False, False, 0.1),
                       runner.Result(-15, "", True, False, 1.0)):
            with self.subTest(result=result), mock.patch.object(runner, "execute", return_value=result) as execute:
                attempt, attempts = runner.execute_with_failover(job, self.config, self.repo)
                self.assertEqual(len(attempts), 1); self.assertEqual(execute.call_count, 1)
                self.assertIn(attempt.error_category, {"RUNTIME", "TIMEOUT"})

    def test_quota_windows_and_unknown_balance(self):
        jan = runner.dt.datetime(2026, 1, 31, 23, tzinfo=runner.dt.timezone.utc)
        feb = runner.dt.datetime(2026, 2, 1, 0, tzinfo=runner.dt.timezone.utc)
        self.assertNotEqual(runner.QuotaLedger.reset_key("kiro", jan), runner.QuotaLedger.reset_key("kiro", feb))
        self.assertTrue(runner.QuotaLedger.reset_key("claude", feb).startswith("weekly:"))
        ledger = runner.QuotaLedger(self.state)
        self.assertIsNone(ledger.balance("kiro"))

    def test_all_kiro_models_and_default_copilot_route_are_supported(self):
        for model in ("gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"):
            job = runner.Job.from_comment(self.comment(model=model), self.config)
            self.assertIn(model, runner.adapter_argv(job, {}))
        copilot = runner.Job.from_comment(self.comment(worker="copilot", model="default"), self.config)
        argv = runner.adapter_argv(copilot, {})
        self.assertNotIn("--model", argv)
        self.assertIn("--disable-builtin-mcps", argv)
        self.assertIn("--no-remote", argv)

    def test_structured_output_failure_never_fails_over(self):
        job = runner.Job.from_comment(self.comment(), self.config)
        bad = runner.Result(0, "unstructured prose", False, False, 0.1)
        with mock.patch.object(runner, "execute", return_value=bad) as execute:
            attempt, attempts = runner.execute_with_failover(job, self.config, self.repo)
        self.assertEqual(attempt.error_category, "OUTPUT_VALIDATION")
        self.assertEqual(len(attempts), 1); self.assertEqual(execute.call_count, 1)

    def test_redaction_removes_identity_paths_ip_and_email(self):
        text = str(Path.home()) + "/private 192.0.2.1 person@example.test"
        cleaned = runner.redact(text)
        self.assertNotIn(str(Path.home()), cleaned)
        self.assertNotIn("192.0.2.1", cleaned); self.assertNotIn("person@example.test", cleaned)

    def test_delivery_snapshot_rejects_sensitive_paths_secrets_and_device_paths(self):
        cases = (("?? .env", "safe"), (" M src/app.py", "token=verysecretvalue"),
                 (" M src/app.py", "+ path=/Users/example/private"))
        for changes, diff in cases:
            with self.subTest(changes=changes, diff=diff), self.assertRaises(runner.RunnerError):
                runner.validate_delivery_snapshot(changes, diff)

    def test_provider_health_verifies_required_cli_contracts(self):
        config = runner.dataclasses.replace(self.config, executable_paths={
            "kiro": sys.executable, "copilot": sys.executable, "claude": sys.executable})
        combined = " ".join(flag for flags in runner.PROVIDER_REQUIRED_FLAGS.values() for flag in flags)
        good = runner.Result(0, combined, False, False, 0.1)
        with mock.patch.object(runner, "execute", return_value=good):
            health = runner.provider_health(config)
        self.assertTrue(all(item["interface_ok"] for item in health.values()))

    def test_comments_flattens_paginated_queue_results(self):
        client = runner.GitHubClient(self.config)
        pages = [[{"id": 1}], [{"id": 2}]]
        with mock.patch.object(client, "_api", return_value=pages) as api:
            self.assertEqual([item["id"] for item in client.comments()], [1, 2])
        self.assertTrue(api.call_args.kwargs["paginate"])

if __name__ == "__main__":
    unittest.main()
