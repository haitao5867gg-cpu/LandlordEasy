import importlib.util
import json
import os
import plistlib
import shutil
import sqlite3
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
        self.repo, self.worktrees, self.state, self.runtime = (root / "repo", root / "worktrees",
                                                               root / "state", root / "runtime")
        self.repo.mkdir(); self.worktrees.mkdir()
        self.config = runner.Config(
            repository="owner/repo", queue_issue=42, commander_login="commander",
            executor_login="executor", runner_id="runner-001",
            canonical_repo=self.repo, worktree_root=self.worktrees, state_dir=self.state,
            origin_url="https://example.invalid/owner/repo.git", runtime_dir=self.runtime,
            operational_executables={"gh": sys.executable, "git": sys.executable, "python": sys.executable},
            enabled_providers=frozenset(runner.WORKERS), enabled_profiles=frozenset(runner.PROFILES),
            enabled_quality_gates=frozenset({"none", "unit"}),
            quality_gates={"none": (), "unit": ((sys.executable, "-c", "print('ok')"),)},
            delivery_path_allowlists={"unit": frozenset({"allowed.txt"})},
            executable_paths={"kiro": sys.executable, "copilot": sys.executable, "claude": sys.executable},
        )
    def tearDown(self): self.tmp.cleanup()
    def data(self, **changes):
        value = {
            "schema": runner.SCHEMA, "job_id": JOB_ID, "repository": "owner/repo", "queue_issue": 42,
            "target_sha": SHA, "worktree_id": runner.derive_worktree_id(JOB_ID), "runner_id": "runner-001",
            "worker": "kiro", "model": "gpt-5.6-luna", "profile": "repo_read", "assigned": "ORG-002",
            "prompt": "Read the assigned specification.", "timeout_seconds": 30, "output_limit_bytes": 1024,
            "expected_evidence": "summary", "quality_gate": "none",
        }
        value.update(changes); return value
    def comment(self, **changes):
        return "COMMANDER_JOB_V1\n```json\n" + json.dumps(self.data(**changes)) + "\n```"
    def config_data(self):
        return {
            "repository": "owner/repo", "queue_issue": 42, "commander_login": "commander",
            "executor_login": "executor",
            "runner_id": "runner-001", "canonical_repo": str(self.repo),
            "worktree_root": str(self.worktrees), "state_dir": str(self.state),
            "origin_url": "https://example.invalid/owner/repo.git", "runtime_dir": str(self.runtime),
            "operational_executables": {"gh": sys.executable, "git": sys.executable, "python": sys.executable},
            "enabled_providers": ["kiro"], "enabled_profiles": ["repo_read"],
            "enabled_quality_gates": ["none"], "quality_gates": {"none": []},
            "poll_seconds": 60, "lease_seconds": 180, "provider_failover": True,
            "executable_paths": {"kiro": sys.executable, "copilot": sys.executable, "claude": sys.executable},
        }
    def write_config(self, data=None, mode=0o600):
        path = Path(self.tmp.name) / f"config-{uuid.uuid4()}.json"
        path.write_text(json.dumps(self.config_data() if data is None else data))
        os.chmod(path, mode)
        return path

class SchemaTests(RunnerTestCase):
    def test_example_starts_read_only(self):
        example = json.loads((HERE / "config.example.json").read_text())
        self.assertEqual(example["enabled_profiles"], ["repo_read"])
        self.assertEqual(example["enabled_quality_gates"], ["none"])
        self.assertEqual(example["enabled_operations"], [])
        self.assertIsNone(example["wake_pull_request"])
        self.assertEqual(set(example["operation_definitions"]), {"ops001_mysql_probe"})
        self.assertEqual(example["delivery_path_allowlists"]["org002_python"], [
            "AGENTS.md", "project-brain/CURRENT_STATE.md", "project-brain/RELEASE_PLAN.md",
            "project-brain/RISKS.md", "specs/ORG-002-LOCAL-COMMANDER-RUNNER.md"])
        self.assertNotEqual(example["commander_login"], example["executor_login"])
        runner.validate_github_login(example["commander_login"], "commander_login")
        runner.validate_github_login(example["executor_login"], "executor_login")

    def test_wake_pull_request_is_optional_owner_only_and_distinct(self):
        old = self.config_data()
        self.assertIsNone(runner.Config.load(self.write_config(old)).wake_pull_request)
        enabled = self.config_data(); enabled["wake_pull_request"] = 22
        self.assertEqual(runner.Config.load(self.write_config(enabled)).wake_pull_request, 22)
        for invalid in (True, 0, -1, 42, 1_000_000_001, "22"):
            with self.subTest(invalid=invalid):
                data = self.config_data(); data["wake_pull_request"] = invalid
                with self.assertRaises(runner.ValidationError):
                    runner.Config.load(self.write_config(data))
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
            {"quality_gate": "unknown"}, {"command": ["python", "-m", "test"]},
        ):
            with self.subTest(changes=changes), self.assertRaises(runner.ValidationError):
                runner.Job.from_comment(self.comment(**changes), self.config)
    def test_explicit_provider_profile_and_gate_enablement(self):
        read_only = runner.dataclasses.replace(
            self.config, enabled_providers=frozenset({"kiro"}),
            enabled_profiles=frozenset({"repo_read"}), enabled_quality_gates=frozenset({"none"}))
        for changes in ({"worker": "copilot", "model": "default"},
                        {"profile": "repo_write_test", "quality_gate": "unit"},
                        {"quality_gate": "unit"}):
            with self.subTest(changes=changes), self.assertRaises(runner.ValidationError):
                runner.Job.from_comment(self.comment(**changes), read_only)
        with self.assertRaises(runner.ValidationError):
            runner.validate_quality_gates({"bad": [["/bin/sh", "-c", "echo injected"]], "none": []})

    def test_provider_profile_capability_matrix_all_combinations(self):
        expected = {
            "kiro": {"repo_read", "repo_write_test", "repo_delivery"},
            "copilot": {"repo_read"},
            "claude": {"repo_read", "repo_write_test", "repo_delivery"},
        }
        self.assertEqual(
            {worker: set(profiles) for worker, profiles in runner.PROVIDER_PROFILE_CAPABILITIES.items()},
            expected,
        )
        models = {"kiro": "gpt-5.6-luna", "copilot": "default", "claude": "claude-sonnet-5"}
        for worker in sorted(runner.WORKERS):
            for profile in sorted(runner.PROFILES):
                changes = {
                    "worker": worker,
                    "model": models[worker],
                    "profile": profile,
                    "quality_gate": "none" if profile == "repo_read" else "unit",
                }
                if profile == "repo_delivery":
                    changes["human_approval_ref"] = "approval-17"
                with self.subTest(worker=worker, profile=profile):
                    if profile in expected[worker]:
                        job = runner.Job.from_comment(self.comment(**changes), self.config)
                        self.assertEqual((job.worker, job.profile), (worker, profile))
                    else:
                        with self.assertRaises(runner.ValidationError):
                            runner.Job.from_comment(self.comment(**changes), self.config)

    def test_config_load_rejects_insecure_mode_missing_and_unknown_fields(self):
        with self.assertRaises(runner.ValidationError):
            runner.Config.load(self.write_config(mode=0o644))
        for mutation in ("missing", "unknown"):
            data = self.config_data()
            if mutation == "missing": del data["runtime_dir"]
            else: data["unexpected"] = True
            with self.subTest(mutation=mutation), self.assertRaises(runner.ValidationError):
                runner.Config.load(self.write_config(data))

    def test_config_load_rejects_relative_executables_and_commands_for_none_gate(self):
        cases = []
        provider = self.config_data(); provider["executable_paths"]["kiro"] = "kiro-cli"; cases.append(provider)
        operational = self.config_data(); operational["operational_executables"]["git"] = "git"; cases.append(operational)
        none_gate = self.config_data(); none_gate["quality_gates"]["none"] = [[sys.executable, "--version"]]; cases.append(none_gate)
        for data in cases:
            with self.subTest(data=data), self.assertRaises(runner.ValidationError):
                runner.Config.load(self.write_config(data))

    def test_config_load_rejects_invalid_scalar_and_executable_map_contracts(self):
        cases = []
        invalid_issue = self.config_data(); invalid_issue["queue_issue"] = 0; cases.append(invalid_issue)
        invalid_runner = self.config_data(); invalid_runner["runner_id"] = "bad runner"; cases.append(invalid_runner)
        invalid_failover = self.config_data(); invalid_failover["provider_failover"] = "yes"; cases.append(invalid_failover)
        invalid_operational = self.config_data(); del invalid_operational["operational_executables"]["gh"]; cases.append(invalid_operational)
        for data in cases:
            with self.subTest(data=data), self.assertRaises(runner.ValidationError):
                runner.Config.load(self.write_config(data))

    def test_config_requires_distinct_strict_commander_and_executor_logins(self):
        valid = runner.Config.load(self.write_config())
        self.assertEqual(valid.commander_login, "commander")
        self.assertEqual(valid.executor_login, "executor")
        cases = []
        for field in ("commander_login", "executor_login"):
            missing = self.config_data(); del missing[field]; cases.append(missing)
        same = self.config_data(); same["executor_login"] = "COMMANDER"; cases.append(same)
        for field in ("commander_login", "executor_login"):
            for invalid in ("", "-leading", "trailing-", "double--hyphen", "under_score", "a" * 40):
                data = self.config_data(); data[field] = invalid; cases.append(data)
        for data in cases:
            with self.subTest(data=data), self.assertRaises(runner.ValidationError):
                runner.Config.load(self.write_config(data))

    def test_delivery_approval_reference_is_bounded_text_without_shell_fragments(self):
        delivery_config = runner.dataclasses.replace(
            self.config, enabled_profiles=frozenset({"repo_delivery"}),
            enabled_quality_gates=frozenset({"unit"}))
        valid = runner.Job.from_comment(
            self.comment(profile="repo_delivery", quality_gate="unit", human_approval_ref="  approval-17  "),
            delivery_config)
        self.assertEqual(valid.human_approval_ref, "approval-17")
        # Ordinary punctuation is legitimate audit text and must round-trip.
        punctuated = runner.Job.from_comment(
            self.comment(profile="repo_delivery", quality_gate="unit",
                         human_approval_ref="approval-17; owner-confirmed (issue #21)"),
            delivery_config)
        self.assertEqual(punctuated.human_approval_ref,
                         "approval-17; owner-confirmed (issue #21)")
        for value in (None, "", "   ", {"unexpected": True}, "x" * 513, "approval\x00ref",
                      "approval\nsecond line"):
            with self.subTest(value=value), self.assertRaises(runner.ValidationError):
                runner.Job.from_comment(
                    self.comment(profile="repo_delivery", quality_gate="unit", human_approval_ref=value),
                    delivery_config)
        with self.assertRaises(runner.ValidationError):
            runner.Job.from_comment(self.comment(profile="repo_delivery", quality_gate="unit"), delivery_config)
        for profile in ("repo_read", "repo_write_test"):
            quality_gate = "none" if profile == "repo_read" else "unit"
            with self.subTest(profile=profile), self.assertRaises(runner.ValidationError):
                runner.Job.from_comment(
                    self.comment(profile=profile, quality_gate=quality_gate,
                                 human_approval_ref="approval-17"), self.config)

    def test_delivery_requires_nonempty_owner_path_allowlist(self):
        config = runner.dataclasses.replace(
            self.config, enabled_profiles=frozenset({"repo_delivery"}),
            enabled_quality_gates=frozenset({"unit"}), delivery_path_allowlists={})
        with self.assertRaises(runner.ValidationError):
            runner.Job.from_comment(self.comment(profile="repo_delivery", quality_gate="unit",
                                                  human_approval_ref="approval-17"), config)
        write_config = runner.dataclasses.replace(config, enabled_profiles=frozenset({"repo_write_test"}))
        self.assertEqual(runner.Job.from_comment(
            self.comment(profile="repo_write_test", quality_gate="unit"), write_config).profile,
            "repo_write_test")

    def test_delivery_path_allowlist_config_validation_and_optional_default(self):
        self.assertEqual(runner.Config.load(self.write_config()).delivery_path_allowlists, {})
        valid = self.config_data()
        valid["quality_gates"]["unit"] = [[sys.executable, "--version"]]
        valid["delivery_path_allowlists"] = {"unit": ["AGENTS.md", "project-brain/RISKS.md"]}
        loaded = runner.Config.load(self.write_config(valid))
        self.assertEqual(loaded.delivery_path_allowlists["unit"],
                         frozenset({"AGENTS.md", "project-brain/RISKS.md"}))
        invalid_paths = ("", "/absolute", ".", "..", "../escape", "a/../b", "a/./b",
                         "a//b", "trailing/", "a\\b",
                         "duplicate", "bad\x00path", "bad\npath", "*.md", "file[0].md")
        for path in invalid_paths:
            data = json.loads(json.dumps(valid))
            data["delivery_path_allowlists"] = {"unit": [path, path] if path == "duplicate" else [path]}
            with self.subTest(path=repr(path)), self.assertRaises(runner.ValidationError):
                runner.Config.load(self.write_config(data))
        undefined = json.loads(json.dumps(valid))
        undefined["delivery_path_allowlists"] = {"missing": ["AGENTS.md"]}
        with self.assertRaises(runner.ValidationError):
            runner.Config.load(self.write_config(undefined))

    def test_control_plane_five_file_delivery_passes_static_job_validation(self):
        paths = frozenset({
            "AGENTS.md", "project-brain/CURRENT_STATE.md", "project-brain/RELEASE_PLAN.md",
            "project-brain/RISKS.md", "specs/ORG-002-LOCAL-COMMANDER-RUNNER.md"})
        config = runner.dataclasses.replace(
            self.config, enabled_profiles=frozenset({"repo_delivery"}),
            enabled_quality_gates=frozenset({"unit"}),
            delivery_path_allowlists={"unit": paths})
        job = runner.Job.from_comment(
            self.comment(profile="repo_delivery", quality_gate="unit",
                         human_approval_ref="commander-approval-17"), config)
        self.assertEqual(job.profile, "repo_delivery")
        self.assertEqual(config.delivery_path_allowlists[job.quality_gate], paths)

class SecurityTests(RunnerTestCase):
    def test_shell_punctuation_in_prompt_is_accepted_verbatim(self):
        """Prompts are one inert argv element; no shell ever sees them.

        Rejecting `;`, `|` or backticks here blocked legitimate review prompts
        (JSON contracts, SQL, prose) while protecting nothing, because
        `execute()` uses `subprocess.Popen(argv, shell=False)`.
        """
        payload = ('Review this: SELECT a; SELECT b | filter && done. '
                   'Return `{"status": "ok"}` exactly.')
        job = runner.Job.from_comment(self.comment(prompt=payload), self.config)
        self.assertEqual(job.prompt, payload)
        # The prompt reaches the provider as exactly one argv element.
        argv = runner.adapter_argv(job, self.config.executable_paths)
        self.assertEqual(sum(1 for part in argv if payload in part), 1)

    def test_control_characters_in_prompt_are_rejected(self):
        for payload in ("bad\x00null", "bad\x07bell", "bad\x1bescape"):
            with self.subTest(payload=payload), self.assertRaises(runner.ValidationError):
                runner.Job.from_comment(self.comment(prompt=payload), self.config)
    def test_adapter_snapshots_have_no_dangerous_tools(self):
        for worker, model in (("kiro", "gpt-5.6-luna"), ("copilot", "claude-sonnet-5"), ("claude", "claude-sonnet-5")):
            job = runner.Job.from_comment(self.comment(worker=worker, model=model), self.config)
            text = " ".join(runner.adapter_argv(job, self.config.executable_paths)).lower()
            with self.subTest(worker=worker):
                self.assertNotIn("--allow-all", text); self.assertNotIn("--yolo", text)
                self.assertIn("--model", text)
        read_text = " ".join(runner.adapter_argv(runner.Job.from_comment(self.comment(), self.config),
                                                  self.config.executable_paths))
        self.assertIn("--no-interactive", read_text)
        self.assertIn("--trust-tools=fs_read", read_text); self.assertNotIn("fs_read,fs_write", read_text)
        self.assertNotIn("--model auto", read_text)

    def test_claude_tools_and_explicit_allowed_tools_match_each_profile(self):
        cases = (
            ("repo_read", "none", None, {"Read", "Glob", "Grep"}),
            ("repo_write_test", "unit", None, {"Read", "Glob", "Grep", "Edit", "Write"}),
            ("repo_delivery", "unit", "approval-17", {"Read", "Glob", "Grep", "Edit", "Write"}),
        )
        for profile, gate, approval, expected in cases:
            changes = {"worker": "claude", "model": "claude-sonnet-5",
                       "profile": profile, "quality_gate": gate}
            if approval is not None:
                changes["human_approval_ref"] = approval
            job = runner.Job.from_comment(self.comment(**changes), self.config)
            argv = runner.adapter_argv(job, self.config.executable_paths)
            def value(flag): return argv[argv.index(flag) + 1]
            visible = set(value("--tools").split(","))
            allowed = set(value("--allowedTools").split(","))
            with self.subTest(profile=profile):
                self.assertEqual(visible, expected); self.assertEqual(allowed, expected)
                self.assertEqual(visible, allowed)
                self.assertEqual(value("--permission-mode"), "dontAsk")
                self.assertEqual(value("--permission-prompts"), "none")
                self.assertIn("--no-session-persistence", argv)
                self.assertIn("--strict-mcp-config", argv)
                self.assertEqual(json.loads(value("--mcp-config")), {"mcpServers": {}})
                self.assertEqual(json.loads(value("--settings"))["remoteControlAtStartup"], False)
                self.assertEqual(set(value("--disallowedTools").split(",")),
                                 {"Bash", "WebFetch", "WebSearch", "Task", "TaskOutput"})
                self.assertNotIn("Bash", allowed)
                self.assertNotIn("--dangerously-skip-permissions", argv)
                self.assertNotIn("--bypassPermissions", argv)
        self.assertEqual(
            {"Read", "Glob", "Grep", "Edit", "Write"} - {"Read", "Glob", "Grep"},
            {"Edit", "Write"})
        self.assertIn("--allowedTools", runner.PROVIDER_REQUIRED_FLAGS["claude"])
    def test_path_environment_and_redaction_controls(self):
        with self.assertRaises(runner.ValidationError): runner.checked_child(self.worktrees, "../../escape", True)
        link = self.worktrees / "job-abc"
        try:
            link.symlink_to(self.repo, target_is_directory=True)
            with self.assertRaises(runner.ValidationError): runner.checked_child(self.worktrees, "job-abc", True)
        finally:
            if link.exists() or link.is_symlink(): link.unlink()
        source = {"PATH": "/bin", "TOKEN": "sec" + "ret", "HOME": "/safe",
                  "USER": "forged", "LOGNAME": "forged", "SSH_AUTH_SOCK": "/unsafe/socket"}
        record = types.SimpleNamespace(pw_name="trusted_user")
        with mock.patch.object(runner.os, "getuid", return_value=501), \
             mock.patch.object(runner.pwd, "getpwuid", return_value=record) as getpwuid:
            env = runner.safe_environment(source)
        getpwuid.assert_called_once_with(501)
        self.assertEqual(env, {"PATH": "/bin", "HOME": "/safe", "USER": "trusted_user"})
        self.assertNotIn("LOGNAME", env); self.assertNotIn("SSH_AUTH_SOCK", env)
        simulated_value = "token=" + "verysecretvalue"
        simulated_classic_token = "ghp_" + "abcdefghijklmnopqrstuv"
        safe = runner.ensure_safe_post(simulated_value + " " + simulated_classic_token)
        self.assertNotIn("verysecretvalue", safe); self.assertNotIn("ghp_", safe)
        cloud_key = "AKIA" + "A" * 16
        private_key = "-----BEGIN " + "PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----"
        cleaned = runner.redact(cloud_key + " " + private_key)
        self.assertNotIn(cloud_key, cleaned); self.assertNotIn("PRIVATE KEY", cleaned)

    def test_safe_environment_fails_closed_for_unavailable_or_invalid_user_record(self):
        failures = (KeyError(501), OSError("fixture"), types.SimpleNamespace(pw_name=""),
                    types.SimpleNamespace(pw_name="bad user"), types.SimpleNamespace(pw_name="-bad"),
                    types.SimpleNamespace(pw_name="x" * 256))
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                effect = failure if isinstance(failure, BaseException) else None
                returned = failure if effect is None else None
                with mock.patch.object(runner.os, "getuid", return_value=501), \
                     mock.patch.object(runner.pwd, "getpwuid", side_effect=effect,
                                       return_value=returned), \
                     self.assertRaises(runner.RunnerError):
                    runner.safe_environment({"HOME": "/safe", "USER": "forged"})

    def test_all_provider_adapters_receive_the_same_restricted_environment(self):
        source = {"HOME": "/safe", "PATH": "/bin", "LANG": "C", "USER": "forged",
                  "LOGNAME": "forged", "SSH_AUTH_SOCK": "/unsafe/socket",
                  "CLAUDE_CONFIG_DIR": "/unsafe", "ANTHROPIC_API_KEY": "fixture"}
        expected = {"HOME": "/safe", "PATH": "/bin", "LANG": "C", "USER": "trusted_user"}
        models = {"kiro": "gpt-5.6-luna", "copilot": "default", "claude": "claude-sonnet-5"}
        captured = {}
        def fake_execute(argv, **kwargs):
            captured[Path(argv[0]).name + str(len(captured))] = kwargs["env"]
            return runner.Result(0, '{"status":"ok","summary":"done","evidence":[]}',
                                 False, False, 0.1)
        record = types.SimpleNamespace(pw_name="trusted_user")
        with mock.patch.object(runner.os, "environ", source), \
             mock.patch.object(runner.os, "getuid", return_value=501), \
             mock.patch.object(runner.pwd, "getpwuid", return_value=record), \
             mock.patch.object(runner, "execute", side_effect=fake_execute):
            for worker, model in models.items():
                job = runner.Job.from_comment(self.comment(worker=worker, model=model), self.config)
                attempt, attempts = runner.execute_with_failover(
                    job, runner.dataclasses.replace(self.config, provider_failover=False), self.repo)
                self.assertIsNotNone(attempt.output); self.assertEqual(len(attempts), 1)
        self.assertEqual(len(captured), 3)
        for environment in captured.values(): self.assertEqual(environment, expected)

    def test_terminal_lifecycle_falls_back_to_fixed_safe_evidence(self):
        job = runner.Job.from_comment(self.comment(), self.config)
        class FixtureClient:
            def __init__(self): self.bodies = []
            def post(self, body):
                self.bodies.append(body)
                if len(self.bodies) == 1: raise runner.UnsafeOutputError("fixture rejection")
        client = FixtureClient()
        runner.post_terminal_lifecycle(client, job, "FAILED", "unsafe fixture evidence")
        self.assertEqual(len(client.bodies), 2)
        self.assertIn("evidence withheld: high-risk pattern detected", client.bodies[1])
        self.assertNotIn("unsafe fixture evidence", client.bodies[1])
    def test_output_cap_is_enforced_without_shell(self):
        result = runner.execute([sys.executable, "-c", "print('x'*10000)"], timeout=10, cap=100)
        self.assertTrue(result.overflow); self.assertLessEqual(len(result.output.encode()), 100)

class StateTests(RunnerTestCase):
    def legacy_state(self, body, job_id=JOB_ID, content_hash=None):
        state_dir = Path(self.tmp.name) / f"legacy-{uuid.uuid4()}"
        state_dir.mkdir()
        database = sqlite3.connect(state_dir / "state.sqlite3")
        database.executescript("""
        CREATE TABLE claims (
          comment_id TEXT PRIMARY KEY, job_id TEXT UNIQUE NOT NULL, content_hash TEXT NOT NULL,
          status TEXT NOT NULL, claimed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id TEXT NOT NULL,
          status TEXT NOT NULL, created_at INTEGER NOT NULL);
        """)
        database.execute(
            "INSERT INTO claims VALUES (?, ?, ?, 'running', 1, 1)",
            ("1", job_id, content_hash if content_hash is not None else runner.comment_hash(body)),
        )
        database.commit()
        database.close()
        return runner.State(state_dir)

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
    def test_incomplete_claim_cannot_be_locally_terminalized_without_public_intent(self):
        state = runner.State(self.state)
        self.assertTrue(state.claim("1", JOB_ID, "hash-a"))
        self.assertEqual(state.summary()["jobs"], {"claimed": 1})
        self.assertFalse(hasattr(state, "recover_incomplete"))
        self.assertEqual(state.summary()["jobs"], {"claimed": 1})
        state.close()
    def test_single_node_lease_and_process_lock(self):
        state = runner.State(self.state)
        self.assertTrue(state.acquire_lease("runner-001", 60))
        self.assertFalse(state.acquire_lease("runner-002", 60)); state.close()
        with runner.ProcessLock(self.state):
            with self.assertRaises(runner.RunnerError):
                with runner.ProcessLock(self.state): pass

    def test_wake_outbox_is_persistent_idempotent_and_identity_bound(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        state = runner.State(self.state)
        state.enqueue_wake(JOB_ID, "1234", "COMPLETED", config)
        state.enqueue_wake(JOB_ID, "1234", "COMPLETED", config)
        expected = ((JOB_ID, "1234", "COMPLETED", "owner/repo", 42,
                     "runner-001", 22),)
        self.assertEqual(state.pending_wakes(), expected)
        with self.assertRaises(runner.ValidationError):
            state.enqueue_wake(JOB_ID, "1235", "COMPLETED", config)
        state.close()
        restarted = runner.State(self.state)
        self.assertEqual(restarted.pending_wakes(), expected)
        restarted.mark_wake_delivered(JOB_ID)
        self.assertEqual(restarted.pending_wakes(), ())
        with self.assertRaises(runner.ValidationError):
            restarted.mark_wake_delivered(JOB_ID)
        restarted.close()

    def test_wake_outbox_rejects_malformed_records_and_limits(self):
        state = runner.State(self.state)
        for values in (("bad", "123", "COMPLETED"), (JOB_ID, "0", "COMPLETED"),
                       (JOB_ID, "123", "RUNNING")):
            with self.subTest(values=values), self.assertRaises(runner.ValidationError):
                state.enqueue_wake(*values, self.config)
        for limit in (0, True, 101):
            with self.subTest(limit=limit), self.assertRaises(runner.ValidationError):
                state.pending_wakes(limit)
        state.close()

    def test_terminal_intent_survives_post_failure_and_restart(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        job = runner.Job.from_comment(self.comment(), config)
        recovery = runner.lifecycle(
            job, "FAILED", "runner stop condition: ambiguous execution recovered after restart")
        state = runner.State(self.state)
        state.claim("1", JOB_ID, "hash", recovery)
        state.set_status("1", "running")
        class FailingClient:
            def __init__(self): self.config = config
            def post(self, body): raise runner.RunnerError("fixture")
        self.assertFalse(runner.post_terminal_lifecycle(
            FailingClient(), job, "COMPLETED", "bounded", state, "1", "succeeded"))
        self.assertEqual(state.summary()["jobs"], {"running": 1})
        self.assertEqual(len(state.pending_terminals()), 1)
        state.close()

        restarted = runner.State(self.state)
        self.assertEqual(runner.recover_incomplete_jobs(object(), restarted, config), 1)
        events = []
        class RecoveryClient:
            def __init__(self): self.config = config
            def post(self, body): events.append(("terminal", body)); return "7001"
            def post_wake(self, body): events.append(("wake", body)); return "7002"
        self.assertTrue(runner.drain_terminal_outbox(RecoveryClient(), restarted, config))
        self.assertEqual([kind for kind, _ in events], ["terminal", "wake"])
        self.assertEqual(restarted.summary()["jobs"], {"succeeded": 1})
        restarted.close()

    def test_crashed_running_claim_gets_public_terminal_without_worker_replay(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        job = runner.Job.from_comment(self.comment(), config)
        recovery = runner.lifecycle(
            job, "FAILED", "runner stop condition: ambiguous execution recovered after restart")
        state = runner.State(self.state)
        state.claim("1", JOB_ID, "hash", recovery)
        state.set_status("1", "running")
        state.close()

        restarted = runner.State(self.state)
        self.assertEqual(runner.recover_incomplete_jobs(object(), restarted, config), 1)
        events = []
        class RecoveryClient:
            def __init__(self): self.config = config
            def post(self, body): events.append(body); return "8001"
            def post_wake(self, body): events.append(body); return "8002"
        self.assertTrue(runner.drain_terminal_outbox(RecoveryClient(), restarted, config))
        self.assertIn("COMMANDER_RUNNER_V1 FAILED", events[0])
        self.assertIn("ambiguous execution recovered after restart", events[0])
        self.assertEqual(restarted.summary()["jobs"], {"blocked": 1})
        restarted.close()

    def test_legacy_migration_accepts_worker_and_operation_envelopes(self):
        definition = runner.OperationDefinition(
            argv=(sys.executable, str(self.runtime / "rehearsal_operations.py"),
                  "--docker", str(self.runtime / "docker")),
            mode="read_only", allowed_target_shas=frozenset({runner.OPS001_TARGET_SHA}),
            max_timeout_seconds=120, max_output_bytes=8192,
            require_clean_worktree=True, description="fixture operation",
        )
        operation_config = runner.dataclasses.replace(
            self.config, enabled_operations=frozenset({"ops001_mysql_probe"}),
            operation_definitions={"ops001_mysql_probe": definition})
        operation_data = {
            "schema": runner.OPERATION_SCHEMA, "job_id": JOB_ID,
            "repository": "owner/repo", "queue_issue": 42,
            "target_sha": runner.OPS001_TARGET_SHA,
            "worktree_id": runner.derive_worktree_id(JOB_ID), "runner_id": "runner-001",
            "operation_id": "ops001_mysql_probe", "timeout_seconds": 60,
            "output_limit_bytes": 4096, "expected_evidence": "bounded evidence",
            "human_approval_ref": "commander-approval",
        }
        operation = "COMMANDER_OPERATION_V1\n```json\n" + json.dumps(operation_data) + "\n```"
        for body, config in ((self.comment(), self.config), (operation, operation_config)):
            state = self.legacy_state(body)
            class Client:
                @staticmethod
                def find_comment(comment_id, max_page):
                    return {"id": 1, "user": {"login": "commander"}, "body": body}
            with self.subTest(schema=body.splitlines()[0]):
                self.assertEqual(runner.recover_incomplete_jobs(Client(), state, config), 1)
                self.assertEqual(len(state.pending_terminals()), 1)
                self.assertEqual(state.summary()["jobs"], {"running": 1})
            state.close()

    def test_legacy_migration_rejects_wrong_author_malformed_edit_and_job_mismatch(self):
        original = self.comment()
        other_job = "123e4567-e89b-12d3-a456-426614174099"
        cases = (
            (original, runner.comment_hash(original), JOB_ID, "attacker"),
            ("COMMANDER_JOB_V1\n```json\n{}\n```", None, JOB_ID, "commander"),
            (self.comment(prompt="edited"), runner.comment_hash(original), JOB_ID, "commander"),
            (original, runner.comment_hash(original), other_job, "commander"),
        )
        for fetched_body, stored_hash, stored_job, author in cases:
            state = self.legacy_state(
                fetched_body, job_id=stored_job,
                content_hash=(runner.comment_hash(fetched_body)
                              if stored_hash is None else stored_hash))
            class Client:
                @staticmethod
                def find_comment(comment_id, max_page):
                    return {"id": 1, "user": {"login": author}, "body": fetched_body}
            with self.subTest(author=author, job=stored_job,
                              malformed=fetched_body != original), \
                 self.assertRaises(runner.RunnerError):
                runner.recover_incomplete_jobs(Client(), state, self.config)
            self.assertEqual(state.summary()["jobs"], {"running": 1})
            self.assertEqual(state.pending_terminals(), ())
            state.close()

    def test_complete_terminal_failure_rolls_back_all_three_state_changes(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        job = runner.Job.from_comment(self.comment(), config)
        recovery = runner.lifecycle(
            job, "FAILED", "runner stop condition: ambiguous execution recovered after restart")
        state = runner.State(self.state)
        state.claim("1", JOB_ID, runner.comment_hash(self.comment()), recovery)
        state.set_status("1", "running")
        state.queue_terminal("1", JOB_ID, recovery, "blocked", "FAILED", config)
        history_before = state.db.execute("SELECT count(*) FROM history").fetchone()[0]
        original_enqueue = state._enqueue_wake_tx
        def fail_after_wake_insert(*args):
            original_enqueue(*args)
            raise RuntimeError("injected transaction failure")
        with mock.patch.object(state, "_enqueue_wake_tx", side_effect=fail_after_wake_insert), \
             self.assertRaises(RuntimeError):
            state.complete_terminal(JOB_ID, "9001")
        self.assertEqual(state.summary()["jobs"], {"running": 1})
        self.assertEqual(state.db.execute("SELECT count(*) FROM history").fetchone()[0],
                         history_before)
        self.assertEqual(state.pending_wakes(), ())
        self.assertEqual(len(state.pending_terminals()), 1)
        state.close()

    def test_pending_terminal_identity_mismatch_blocks_before_post(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        job = runner.Job.from_comment(self.comment(), config)
        recovery = runner.lifecycle(
            job, "FAILED", "runner stop condition: ambiguous execution recovered after restart")
        state = runner.State(self.state)
        state.claim("1", JOB_ID, runner.comment_hash(self.comment()), recovery)
        state.set_status("1", "running")
        state.queue_terminal("1", JOB_ID, recovery, "blocked", "FAILED", config)
        changes = (
            {"repository": "other/repo"}, {"queue_issue": 43},
            {"runner_id": "other-runner"}, {"wake_pull_request": 23},
            {"wake_pull_request": None},
        )
        for fields in changes:
            changed = runner.dataclasses.replace(config, **fields)
            class Client:
                @staticmethod
                def post(body): raise AssertionError("identity mismatch must block before POST")
            with self.subTest(fields=fields), self.assertRaises(runner.RunnerError):
                runner.drain_terminal_outbox(Client(), state, changed)
        self.assertEqual(state.summary()["jobs"], {"running": 1})
        self.assertEqual(len(state.pending_terminals()), 1)
        state.close()

class GitHubAndLaunchAgentTests(RunnerTestCase):
    def test_github_client_cannot_escape_queue_issue(self):
        client = runner.GitHubClient(self.config)
        with self.assertRaises(runner.ValidationError): client._api("POST", "repos/owner/repo/issues/99/comments", {"body": "x"})

    def test_wake_client_is_post_only_and_confined_to_exact_pr(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        client = runner.GitHubClient(config)
        response = runner.Result(0, '{"id":9876}', False, False, 0.1)
        with mock.patch.object(runner, "execute", return_value=response) as execute:
            self.assertEqual(client.post_wake("COMMANDER_WAKE_V1"), "9876")
        argv = execute.call_args.args[0]
        self.assertIn("repos/owner/repo/issues/22/comments", argv)
        with self.assertRaises(runner.ValidationError):
            client._api("GET", "repos/owner/repo/issues/22/comments")
        with self.assertRaises(runner.ValidationError):
            client._api("POST", "repos/owner/repo/issues/23/comments", {"body": "x"})

    def test_comment_posts_require_a_positive_response_id(self):
        client = runner.GitHubClient(self.config)
        for output in ('{}', '{"id":0}', '{"id":true}', '{"id":"9"}'):
            with self.subTest(output=output), mock.patch.object(
                    runner, "execute", return_value=runner.Result(
                        0, output, False, False, 0.1)), self.assertRaises(runner.RunnerError):
                client.post("safe")
    def test_wrong_author_fixture_is_ignored_without_execution(self):
        class FixtureClient:
            def __init__(self, config): pass
            def verify_login(self): pass
            def comments(self, page): return [{"id": 1, "user": {"login": "attacker"}, "body": self.outer.comment()}]
            def post(self, body): raise AssertionError("no post")
        FixtureClient.outer = self
        with mock.patch.object(runner, "GitHubClient", FixtureClient):
            self.assertEqual(runner.run_once(self.config), "NO_JOB")
    def test_executor_authored_job_shaped_comment_is_ignored(self):
        class FixtureClient:
            def __init__(self, config): pass
            def verify_login(self): pass
            def comments(self, page):
                return [{"id": 1, "user": {"login": "executor"}, "body": self.outer.comment()}]
            def post(self, body): raise AssertionError("executor lifecycle comment must not execute")
        FixtureClient.outer = self
        with mock.patch.object(runner, "GitHubClient", FixtureClient), \
             mock.patch.object(runner, "verify_target") as verify_target:
            self.assertEqual(runner.run_once(self.config), "NO_JOB")
        verify_target.assert_not_called()

    def test_commander_authored_job_is_accepted(self):
        class FixtureClient:
            def __init__(self, config): pass
            def verify_login(self): pass
            def comments(self, page):
                return [{"id": 1, "user": {"login": "COMMANDER"}, "body": self.outer.comment()}]
            def post(self, body): raise AssertionError("dry-run must not post")
        FixtureClient.outer = self
        with mock.patch.object(runner, "GitHubClient", FixtureClient), \
             mock.patch.object(runner, "verify_target") as verify_target:
            self.assertEqual(runner.run_once(self.config, dry_run=True), f"VALIDATED {JOB_ID}")
        verify_target.assert_called_once()

    def test_github_client_verifies_executor_identity_only(self):
        client = runner.GitHubClient(self.config)
        success = runner.Result(0, json.dumps({"login": "EXECUTOR"}), False, False, 0.1)
        with mock.patch.object(runner, "execute", return_value=success):
            client.verify_login()
        wrong = runner.Result(0, json.dumps({"login": "commander"}), False, False, 0.1)
        with mock.patch.object(runner, "execute", return_value=wrong), \
             self.assertRaises(runner.RunnerError):
            client.verify_login()

    def test_lifecycle_output_contains_no_github_login_identity(self):
        job = runner.Job.from_comment(self.comment(), self.config)
        body = runner.lifecycle(job, "CLAIMED")
        self.assertNotIn(self.config.commander_login, body)
        self.assertNotIn(self.config.executor_login, body)

    def test_terminal_record_precedes_minimal_wake_and_marks_outbox_delivered(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        job = runner.Job.from_comment(self.comment(), config)
        state = runner.State(self.state)
        state.claim("1", JOB_ID, "hash", runner.lifecycle(
            job, "FAILED", "runner stop condition: ambiguous execution recovered after restart"))
        state.set_status("1", "running")
        events = []
        class FixtureClient:
            def __init__(self): self.config = config
            def post(self, body): events.append(("terminal", body)); return "7001"
            def post_wake(self, body): events.append(("wake", body)); return "7002"
        self.assertTrue(runner.post_terminal_lifecycle(
            FixtureClient(), job, "COMPLETED", "bounded evidence", state, "1", "succeeded"))
        self.assertEqual([kind for kind, _ in events], ["terminal", "wake"])
        wake = events[1][1]
        self.assertEqual(wake, (
            f"COMMANDER_WAKE_V1\njob={JOB_ID}\nterminal_issue=42\n"
            "terminal_comment=7001\nstate=COMPLETED\nrunner=runner-001"))
        for forbidden in ("\nevidence=", "\nprompt=", "\ncommand=", "\nargv=",
                          "\nprovider=", "\nsha=", "\npath="):
            self.assertNotIn(forbidden, wake.lower())
        self.assertEqual(state.pending_wakes(), ())
        state.close()

    def test_failed_wake_is_retried_without_reposting_terminal(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        job = runner.Job.from_comment(self.comment(), config)
        state = runner.State(self.state)
        state.claim("1", JOB_ID, "hash", runner.lifecycle(
            job, "FAILED", "runner stop condition: ambiguous execution recovered after restart"))
        state.set_status("1", "running")
        class FailingClient:
            def __init__(self): self.config = config; self.terminals = 0; self.wakes = 0
            def post(self, body): self.terminals += 1; return "8001"
            def post_wake(self, body): self.wakes += 1; raise runner.RunnerError("fixture")
        first = FailingClient()
        self.assertFalse(runner.post_terminal_lifecycle(
            first, job, "FAILED", "bounded", state, "1", "blocked"))
        self.assertEqual(first.terminals, 1)
        self.assertEqual(first.wakes, 1)
        self.assertEqual(state.pending_wakes(), (
            (JOB_ID, "8001", "FAILED", "owner/repo", 42, "runner-001", 22),))
        class RecoveryClient:
            def __init__(self): self.config = config; self.wakes = 0
            def post_wake(self, body): self.wakes += 1; return "8002"
        recovery = RecoveryClient()
        self.assertTrue(runner.drain_wake_outbox(recovery, state))
        self.assertEqual(recovery.wakes, 1)
        self.assertEqual(state.pending_wakes(), ())
        self.assertTrue(runner.drain_wake_outbox(recovery, state))
        self.assertEqual(recovery.wakes, 1)
        state.close()

    def test_pending_wake_blocks_new_claims(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        state = runner.State(self.state)
        state.enqueue_wake(JOB_ID, "9001", "FAILED", config)
        state.close()
        class FixtureClient:
            def __init__(self, supplied): self.config = supplied
            def verify_login(self): pass
            def post_wake(self, body): raise runner.RunnerError("fixture")
            def comments(self, page): raise AssertionError("must not scan or claim while wake is pending")
        with mock.patch.object(runner, "GitHubClient", FixtureClient):
            self.assertEqual(runner.run_once(config), "WAKE_PENDING")

    def test_pending_wake_identity_cannot_follow_changed_config(self):
        config = runner.dataclasses.replace(self.config, wake_pull_request=22)
        state = runner.State(self.state)
        state.enqueue_wake(JOB_ID, "9001", "FAILED", config)
        for wake_pull_request in (23, None):
            changed = runner.dataclasses.replace(config, wake_pull_request=wake_pull_request)
            class FixtureClient:
                def __init__(self): self.config = changed
                def post_wake(self, body): raise AssertionError("mismatch must block before POST")
            with self.subTest(wake_pull_request=wake_pull_request), self.assertRaises(runner.RunnerError):
                runner.drain_wake_outbox(FixtureClient(), state, changed)
        state.close()

    def test_disabled_wake_config_with_pending_record_blocks_queue_scan(self):
        enabled = runner.dataclasses.replace(self.config, wake_pull_request=22)
        state = runner.State(self.state)
        state.enqueue_wake(JOB_ID, "9001", "FAILED", enabled)
        state.close()
        disabled = runner.dataclasses.replace(enabled, wake_pull_request=None)
        class FixtureClient:
            def __init__(self, supplied): self.config = supplied
            def verify_login(self): pass
            def post_wake(self, body): raise AssertionError("mismatch must block before POST")
            def comments(self, page): raise AssertionError("must not scan while wake identity differs")
        with mock.patch.object(runner, "GitHubClient", FixtureClient), self.assertRaises(runner.RunnerError):
            runner.run_once(disabled)

    def test_legacy_inflight_claim_is_reconstructed_and_gets_public_terminal(self):
        self.state.mkdir()
        database = sqlite3.connect(self.state / "state.sqlite3")
        database.executescript("""
        CREATE TABLE claims (
          comment_id TEXT PRIMARY KEY, job_id TEXT UNIQUE NOT NULL, content_hash TEXT NOT NULL,
          status TEXT NOT NULL, claimed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id TEXT NOT NULL,
          status TEXT NOT NULL, created_at INTEGER NOT NULL);
        """)
        body = self.comment()
        database.execute(
            "INSERT INTO claims VALUES (?, ?, ?, 'running', 1, 1)",
            ("1", JOB_ID, runner.comment_hash(body)),
        )
        database.commit()
        database.close()
        events = []
        class FixtureClient:
            outer = None
            def __init__(self, supplied): self.config = supplied
            def verify_login(self): pass
            def comments(self, page):
                return [{"id": 1, "user": {"login": "commander"}, "body": self.outer.comment()}]
            def find_comment(self, comment_id, max_page):
                return self.comments(1)[0]
            def post(self, terminal): events.append(terminal); return "9101"
        FixtureClient.outer = self
        with mock.patch.object(runner, "GitHubClient", FixtureClient), \
             mock.patch.object(runner, "verify_target") as verify_target:
            self.assertEqual(runner.run_once(self.config), "NO_JOB")
        verify_target.assert_not_called()
        self.assertEqual(len(events), 1)
        self.assertIn("COMMANDER_RUNNER_V1 FAILED", events[0])
        self.assertIn("ambiguous execution recovered after restart", events[0])
        recovered = runner.State(self.state)
        self.assertEqual(recovered.summary()["jobs"], {"blocked": 1})
        self.assertEqual(recovered.pending_terminals(), ())
        recovered.close()
    def test_incremental_cursor_finds_latest_job_after_large_history(self):
        class FixtureClient:
            outer = None
            def __init__(self, config): pass
            def verify_login(self): pass
            def comments(self, page):
                if page < 51:
                    return [{"id": page * 100 + index, "user": {"login": "observer"}, "body": "history"}
                            for index in range(runner.QUEUE_PAGE_SIZE)]
                return [{"id": 999999, "user": {"login": "commander"}, "body": self.outer.comment()}]
            def post(self, body): raise AssertionError("dry-run must not post")
        FixtureClient.outer = self
        with mock.patch.object(runner, "GitHubClient", FixtureClient), \
             mock.patch.object(runner, "verify_target"):
            for _ in range(50):
                self.assertEqual(runner.run_once(self.config, dry_run=True), "QUEUE_CURSOR_ADVANCED")
            self.assertTrue(runner.run_once(self.config, dry_run=True).startswith("VALIDATED "))
        state = runner.State(self.state)
        self.assertEqual(state.queue_page(), 51); state.close()
    def test_launchagent_rendering_is_inert_and_bounded_to_fixture(self):
        rendered = runner.make_launchagent({"Label": "com.landlordeasy.commander-runner", "KeepAlive": True},
                                           "/fixture/python", "/fixture/runner.py", "/fixture/config.json", "/fixture/state")
        data = plistlib.loads(rendered)
        self.assertTrue(data["RunAtLoad"])
        self.assertEqual(data["ProgramArguments"][:2], ["/fixture/python", "/fixture/runner.py"])
        self.assertIn("/fixture/state", data["StandardOutPath"])

    def test_install_stop_uninstall_use_temporary_home_fixture(self):
        config_path = self.write_config()
        fixture_home = Path(self.tmp.name) / "home"; fixture_home.mkdir()
        args = types.SimpleNamespace(config=str(config_path), confirm=True)
        with mock.patch.object(runner.Path, "home", return_value=fixture_home), \
             mock.patch.object(runner, "doctor", return_value={"ok": True}):
            self.assertEqual(runner.command_install(args), 0)
            launchagent = fixture_home / "Library/LaunchAgents/com.landlordeasy.commander-runner.plist"
            self.assertTrue(launchagent.exists())
            runtime_script = self.runtime / "commander_runner.py"
            manifest = json.loads((self.runtime / "runtime-manifest.json").read_text())
            plist = plistlib.loads(launchagent.read_bytes())
            self.assertTrue(runtime_script.exists())
            self.assertEqual(plist["ProgramArguments"][1], str(runtime_script))
            self.assertEqual(manifest["schema_version"], runner.RUNTIME_MANIFEST_SCHEMA)
            self.assertEqual(manifest["entrypoint"], "commander_runner.py")
            # Provenance fields must always be present, even when the source
            # commit cannot be resolved (then it is explicitly null, not absent).
            self.assertIn("source_commit", manifest)
            self.assertIn("installed_at", manifest)
            self.assertRegex(manifest["installed_at"], r"^\d{4}-\d{2}-\d{2}T")
            self.assertEqual(
                manifest["files"]["commander_runner.py"],
                runner.hashlib.sha256(runtime_script.read_bytes()).hexdigest())
            helper = self.runtime / "rehearsal_operations.py"
            self.assertTrue(helper.exists())
            self.assertEqual(
                manifest["files"]["rehearsal_operations.py"],
                runner.hashlib.sha256(helper.read_bytes()).hexdigest())
            with self.assertRaises(runner.RunnerError):
                runner.install_stable_runtime(self.config, HERE / "commander_runner.py")
            with mock.patch.object(runner, "run_launchctl") as launchctl:
                self.assertEqual(runner.command_stop(), 0)
                self.assertEqual(runner.command_uninstall(args), 0)
                self.assertGreaterEqual(launchctl.call_count, 2)
            self.assertFalse(launchagent.exists())

    def test_stable_runtime_must_be_outside_repository_and_worktree_roots(self):
        config = runner.dataclasses.replace(self.config, runtime_dir=self.repo / "installed")
        self.assertFalse(runner.stable_runtime_is_isolated(config))
        with self.assertRaises(runner.RunnerError):
            runner.install_stable_runtime(config, HERE / "commander_runner.py")

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

    def test_write_failover_never_selects_copilot(self):
        auth = runner.Result(1, "authentication required", False, False, 0.1)
        success = runner.Result(
            0, '{"status":"ok","summary":"done","evidence":[]}', False, False, 0.1)
        config = runner.dataclasses.replace(self.config, provider_failover=True)
        for profile in ("repo_write_test", "repo_delivery"):
            changes = {"profile": profile, "quality_gate": "unit"}
            if profile == "repo_delivery":
                changes["human_approval_ref"] = "approval-17"
            job = runner.Job.from_comment(self.comment(**changes), config)
            candidates = runner.route_candidates(job, True, config.enabled_providers)
            self.assertEqual([worker for worker, _ in candidates], ["kiro", "claude"])
            calls = []

            def fake_execute(argv, **kwargs):
                calls.append(Path(argv[0]).name)
                return auth if len(calls) == 1 else success

            with self.subTest(profile=profile), \
                 mock.patch.object(runner, "execute", side_effect=fake_execute), \
                 mock.patch.object(runner, "worktree_is_clean", return_value=True):
                attempt, attempts = runner.execute_with_failover(job, config, self.repo)
            self.assertEqual(attempt.worker, "claude")
            self.assertEqual([item.worker for item in attempts], ["kiro", "claude"])
            with self.assertRaises(runner.ValidationError):
                runner.with_provider(job, "copilot", "default")

    def test_runtime_and_timeout_do_not_repeat_ambiguous_work(self):
        job = runner.Job.from_comment(self.comment(), self.config)
        for result in (runner.Result(1, "ordinary failure", False, False, 0.1),
                       runner.Result(-15, "", True, False, 1.0)):
            with self.subTest(result=result), mock.patch.object(runner, "execute", return_value=result) as execute:
                attempt, attempts = runner.execute_with_failover(job, self.config, self.repo)
                self.assertEqual(len(attempts), 1); self.assertEqual(execute.call_count, 1)
                self.assertIn(attempt.error_category, {"UNKNOWN", "TIMEOUT"})

    def test_bare_nonzero_exit_is_not_reported_as_a_code_failure(self):
        """A nonzero exit alone is not evidence that the code under test broke.

        Calling it CODE_FAILURE is what sent engineering problems to a human as
        if they were product defects.
        """
        job = runner.Job.from_comment(self.comment(), self.config)
        opaque = runner.Result(1, "ordinary failure", False, False, 0.1)
        with mock.patch.object(runner, "execute", return_value=opaque):
            attempt, _ = runner.execute_with_failover(job, self.config, self.repo)
        self.assertEqual(attempt.error_category, "UNKNOWN")
        self.assertEqual(runner.stop_class_for(attempt.error_category), "UNCLASSIFIED_FAILURE")

    def test_positive_evidence_is_required_to_call_something_a_code_failure(self):
        job = runner.Job.from_comment(self.comment(), self.config)
        red = runner.Result(1, "Tests: 3 failed, 1 passed\nAssertionError: expected 2", False, False, 5.0)
        with mock.patch.object(runner, "execute", return_value=red):
            attempt, _ = runner.execute_with_failover(job, self.config, self.repo)
        self.assertEqual(attempt.error_category, "RUNTIME")
        self.assertEqual(runner.stop_class_for(attempt.error_category), "CODE_FAILURE")

    def test_dirty_write_worktree_prevents_safe_error_failover(self):
        job = runner.Job.from_comment(self.comment(profile="repo_write_test", quality_gate="unit"), self.config)
        auth = runner.Result(1, "authentication required", False, False, 0.1)
        config = runner.dataclasses.replace(self.config, provider_failover=True)
        with mock.patch.object(runner, "execute", return_value=auth) as execute, \
             mock.patch.object(runner, "worktree_is_clean", return_value=False):
            attempt, attempts = runner.execute_with_failover(job, config, self.repo)
        self.assertEqual(attempt.error_category, "WORKTREE_DIRTY")
        self.assertEqual(len(attempts), 1); self.assertEqual(execute.call_count, 1)

    def test_quality_gate_success_failure_timeout_and_overflow(self):
        job = runner.Job.from_comment(self.comment(profile="repo_write_test", quality_gate="unit"), self.config)
        cases = (
            (runner.Result(0, "ok", False, False, 0.1), None),
            (runner.Result(1, "failed", False, False, 0.1), runner.RunnerError),
            (runner.Result(-15, "", True, False, 30.0), runner.RunnerError),
            (runner.Result(-15, "", False, True, 0.1), runner.RunnerError),
        )
        for result, error in cases:
            with self.subTest(result=result), mock.patch.object(runner, "execute", return_value=result) as execute:
                if error:
                    with self.assertRaises(error): runner.run_quality_gate(self.config, job, self.repo)
                else:
                    self.assertEqual(len(runner.run_quality_gate(self.config, job, self.repo)), 1)
                argv = execute.call_args.args[0]
                self.assertIsInstance(argv, tuple); self.assertNotIn("sh", Path(argv[0]).name)

    def test_delivery_runs_gate_between_two_staged_snapshot_checks(self):
        job = runner.Job.from_comment(
            self.comment(profile="repo_delivery", quality_gate="unit", human_approval_ref="approval-17"),
            self.config)
        events = []
        with mock.patch.object(runner, "stage_and_validate",
                               side_effect=lambda *args, **kwargs: events.append("stage") or ()) as stage, \
             mock.patch.object(runner, "run_quality_gate", side_effect=lambda *args: events.append("gate") or ()), \
             mock.patch.object(runner, "git_checked",
                               side_effect=["c" * 40, "", "c" * 40, "", "b" * 40]) as git:
            self.assertEqual(runner.deliver_worktree(self.config, job, self.repo), "b" * 40)
        self.assertEqual(events, ["stage", "gate", "stage"])
        self.assertEqual([call.kwargs["delivery_gate"] for call in stage.call_args_list], ["unit", "unit"])
        self.assertEqual(git.call_args_list[0].args[0], ["write-tree"])
        self.assertEqual(git.call_args_list[1].args[0][:3],
                         ["-c", "core.hooksPath=/dev/null", "commit"])
        self.assertEqual(git.call_args_list[2].args[0], ["rev-parse", "HEAD^{tree}"])
        self.assertEqual(git.call_args_list[3].args[0],
                         ["push", "origin", f"{job.worktree_id}:{job.worktree_id}"])

    def test_committed_tree_mismatch_blocks_push(self):
        job = runner.Job.from_comment(
            self.comment(profile="repo_delivery", quality_gate="unit", human_approval_ref="approval-17"),
            self.config)
        with mock.patch.object(runner, "stage_and_validate", return_value=()), \
             mock.patch.object(runner, "run_quality_gate", return_value=()), \
             mock.patch.object(runner, "git_checked",
                               side_effect=["a" * 40, "", "b" * 40]) as git, \
             self.assertRaises(runner.RunnerError):
            runner.deliver_worktree(self.config, job, self.repo)
        self.assertFalse(any(call.args[0][0] == "push" for call in git.call_args_list))

    def test_delivery_allowlist_checks_add_modify_and_delete_paths_exactly(self):
        allowed = frozenset({"new.md", "changed.md", "deleted.md"})
        entries = (("000000", "100644", "new.md"), ("100644", "100644", "changed.md"),
                   ("100644", "000000", "deleted.md"))
        runner.validate_delivery_snapshot(entries, "safe", allowed)
        for entry in entries:
            out_of_scope = (entry[0], entry[1], "outside.md")
            with self.subTest(entry=entry), self.assertRaises(runner.RunnerError):
                runner.validate_delivery_snapshot((out_of_scope,), "safe", allowed)

    def test_quality_gate_toctou_extra_file_blocks_commit_and_push(self):
        git = shutil.which("git")
        self.assertIsNotNone(git)
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            self.assertEqual(runner.execute([git, "init", "--quiet"], timeout=10, cap=8192,
                                            cwd=repo).returncode, 0)
            allowed = repo / "allowed.txt"
            allowed.write_text("baseline\n")
            self.assertEqual(runner.execute([git, "add", "--all"], timeout=10, cap=8192,
                                            cwd=repo).returncode, 0)
            self.assertEqual(runner.execute(
                [git, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "baseline"], timeout=10, cap=8192,
                cwd=repo).returncode, 0)
            allowed.write_text("approved change\n")
            config = runner.dataclasses.replace(
                self.config, operational_executables={**self.config.operational_executables, "git": git},
                delivery_path_allowlists={"unit": frozenset({"allowed.txt"})})
            job = runner.Job.from_comment(
                self.comment(profile="repo_delivery", quality_gate="unit",
                             human_approval_ref="approval-17"), config)
            def gate_side_effect(*args):
                (repo / "outside.txt").write_text("late change\n")
                return ()
            with mock.patch.object(runner, "run_quality_gate", side_effect=gate_side_effect), \
                 self.assertRaises(runner.RunnerError):
                runner.deliver_worktree(config, job, repo)
            count = runner.execute([git, "rev-list", "--count", "HEAD"], timeout=10, cap=8192,
                                   cwd=repo)
            self.assertEqual(count.output.strip(), "1")

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
            self.assertIn(model, runner.adapter_argv(job, self.config.executable_paths))
        copilot = runner.Job.from_comment(self.comment(worker="copilot", model="default"), self.config)
        argv = runner.adapter_argv(copilot, self.config.executable_paths)
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
        cases = ((("000000", "100644", ".env"),), "safe"), \
                ((("100644", "100644", "src/app.py"),), "token=" + "verysecretvalue"), \
                ((("100644", "100644", "src/app.py"),), "+ path=/" + "Users/example/private"), \
                ((("000000", "120000", "link"),), "safe"), \
                ((("000000", "160000", "submodule"),), "safe")
        for entries, diff in cases:
            with self.subTest(entries=entries, diff=diff), self.assertRaises(runner.RunnerError):
                runner.validate_delivery_snapshot(entries, diff)

    def test_new_staged_files_with_secret_or_device_path_are_rejected(self):
        git = shutil.which("git")
        self.assertIsNotNone(git)
        for filename, content in (("new.txt", "token=" + "verysecretvalue\n"),
                                  ("device.txt", "path=/" + "Users/example/private\n"),
                                  (".env", "harmless=true\n")):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as directory:
                repo = Path(directory)
                init = runner.execute([git, "init", "--quiet"], timeout=10, cap=8192, cwd=repo)
                self.assertEqual(init.returncode, 0)
                (repo / filename).write_text(content)
                config = runner.dataclasses.replace(
                    self.config, operational_executables={**self.config.operational_executables, "git": git})
                with self.assertRaises(runner.RunnerError): runner.stage_and_validate(config, repo)

    def test_deleting_sensitive_content_scans_the_final_snapshot_not_removed_lines(self):
        git = shutil.which("git")
        self.assertIsNotNone(git)
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            self.assertEqual(runner.execute([git, "init", "--quiet"], timeout=10, cap=8192,
                                            cwd=repo).returncode, 0)
            target = repo / "fixture.txt"
            target.write_text("token=" + "verysecretvalue\n")
            self.assertEqual(runner.execute([git, "add", "--all"], timeout=10, cap=8192,
                                            cwd=repo).returncode, 0)
            runner.execute([git, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
                            "commit", "--quiet", "-m", "fixture"], timeout=10, cap=8192, cwd=repo)
            target.write_text("safe replacement\n")
            config = runner.dataclasses.replace(
                self.config, operational_executables={**self.config.operational_executables, "git": git})
            self.assertEqual(len(runner.stage_and_validate(config, repo)), 1)

    def test_staged_binary_file_is_rejected(self):
        git = shutil.which("git")
        self.assertIsNotNone(git)
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            self.assertEqual(runner.execute([git, "init", "--quiet"], timeout=10, cap=8192,
                                            cwd=repo).returncode, 0)
            (repo / "binary.dat").write_bytes(bytes((0, 255, 0, 254)))
            config = runner.dataclasses.replace(
                self.config, operational_executables={**self.config.operational_executables, "git": git})
            with self.assertRaises(runner.RunnerError):
                runner.stage_and_validate(config, repo)

    def test_pure_staged_deletion_skips_absent_index_content(self):
        git = shutil.which("git")
        self.assertIsNotNone(git)
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            self.assertEqual(runner.execute([git, "init", "--quiet"], timeout=10, cap=8192,
                                            cwd=repo).returncode, 0)
            target = repo / "safe.txt"
            target.write_text("safe fixture\n")
            self.assertEqual(runner.execute([git, "add", "--all"], timeout=10, cap=8192,
                                            cwd=repo).returncode, 0)
            committed = runner.execute(
                [git, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "fixture"], timeout=10, cap=8192, cwd=repo)
            self.assertEqual(committed.returncode, 0)
            target.unlink()
            config = runner.dataclasses.replace(
                self.config, operational_executables={**self.config.operational_executables, "git": git})
            entries = runner.stage_and_validate(config, repo)
            self.assertEqual(entries, (("100644", "000000", "safe.txt"),))

    def test_worktree_clean_check_includes_all_change_classes(self):
        with mock.patch.object(runner, "git_checked", return_value="") as checked:
            self.assertTrue(runner.worktree_is_clean(self.config, self.repo))
        self.assertIn("--untracked-files=all", checked.call_args.args[0])

    def test_provider_health_verifies_required_cli_contracts(self):
        config = runner.dataclasses.replace(self.config, executable_paths={
            "kiro": sys.executable, "copilot": sys.executable, "claude": sys.executable})
        combined = " ".join(flag for flags in runner.PROVIDER_REQUIRED_FLAGS.values() for flag in flags)
        good = runner.Result(0, combined, False, False, 0.1)
        with mock.patch.object(runner, "execute", return_value=good):
            health = runner.provider_health(config)
        self.assertTrue(all(item["interface_ok"] for item in health.values()))

    def test_operational_executable_health_is_independent_of_path(self):
        outputs = ("gh version 1", "git version 2", "Python 3")
        with mock.patch.object(runner, "execute", side_effect=[
                runner.Result(0, output, False, False, 0.1) for output in outputs]):
            health = runner.operational_health(self.config)
        self.assertTrue(all(item["available"] and item["interface_ok"] for item in health.values()))

    def test_disabled_provider_does_not_block_doctor(self):
        providers = {
            "kiro": {"enabled": True, "available": True, "interface_ok": True},
            "copilot": {"enabled": False, "available": False, "interface_ok": None},
            "claude": {"enabled": False, "available": False, "interface_ok": None},
        }
        operational = {name: {"available": True, "interface_ok": True} for name in ("gh", "git", "python")}
        config = runner.dataclasses.replace(self.config, enabled_providers=frozenset({"kiro"}),
                                            enabled_quality_gates=frozenset({"none"}))
        with mock.patch.object(runner, "provider_health", return_value=providers), \
             mock.patch.object(runner, "operational_health", return_value=operational), \
             mock.patch.object(runner, "quality_gate_health", return_value={"none": True}):
            self.assertTrue(runner.doctor(config)["ok"])

    def test_comments_uses_one_bounded_incremental_page(self):
        client = runner.GitHubClient(self.config)
        page = [{"id": 1001}, {"id": 1002}]
        with mock.patch.object(client, "_api", return_value=page) as api:
            self.assertEqual([item["id"] for item in client.comments(51)], [1001, 1002])
        self.assertIn("page=51", api.call_args.args[1])
        self.assertEqual(api.call_args.kwargs["cap"], runner.MAX_QUEUE_PAGE_BYTES)

if __name__ == "__main__":
    unittest.main()
