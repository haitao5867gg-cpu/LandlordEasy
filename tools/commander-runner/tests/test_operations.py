import contextlib
import importlib.util
import io
import json
import os
import signal
import stat
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

HERE = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


runner = load("org003_runner", HERE / "commander_runner.py")
helper = load("org003_operations", HERE / "rehearsal_operations.py")
JOB_ID = "123e4567-e89b-12d3-a456-426614174111"


class OperationTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.repo = root / "repo"
        self.worktrees = root / "worktrees"
        self.state = root / "state"
        self.runtime = root / "runtime"
        self.repo.mkdir()
        self.worktrees.mkdir()
        self.python = Path(sys.executable).resolve()
        self.docker = root / "docker"
        self.docker.write_text("fixture")
        os.chmod(self.docker, 0o700)
        self.definition = runner.OperationDefinition(
            argv=(str(self.python), str(self.runtime / "rehearsal_operations.py"),
                  "--docker", str(self.docker)),
            mode="read_only", allowed_target_shas=frozenset({runner.OPS001_TARGET_SHA}),
            max_timeout_seconds=120, max_output_bytes=8192,
            require_clean_worktree=True, description="Read-only isolated MySQL probe",
        )
        self.config = runner.Config(
            repository="owner/repo", queue_issue=42, commander_login="commander",
            executor_login="executor", runner_id="runner-001", canonical_repo=self.repo,
            worktree_root=self.worktrees, state_dir=self.state,
            origin_url="https://example.invalid/owner/repo.git", runtime_dir=self.runtime,
            operational_executables={"gh": str(self.python), "git": str(self.python),
                                     "python": str(self.python)},
            enabled_providers=frozenset(runner.WORKERS),
            enabled_profiles=frozenset(runner.PROFILES),
            enabled_quality_gates=frozenset({"none"}), quality_gates={"none": ()},
            executable_paths={worker: str(self.python) for worker in runner.WORKERS},
            enabled_operations=frozenset({"ops001_mysql_probe"}),
            operation_definitions={"ops001_mysql_probe": self.definition},
        )

    def tearDown(self):
        self.tmp.cleanup()

    def data(self, **changes):
        value = {
            "schema": runner.OPERATION_SCHEMA, "job_id": JOB_ID,
            "repository": "owner/repo", "queue_issue": 42,
            "target_sha": runner.OPS001_TARGET_SHA,
            "worktree_id": runner.derive_worktree_id(JOB_ID), "runner_id": "runner-001",
            "operation_id": "ops001_mysql_probe", "timeout_seconds": 60,
            "output_limit_bytes": 4096, "expected_evidence": "bounded probe evidence",
            "human_approval_ref": "commander-approval-21",
        }
        value.update(changes)
        return value

    def comment(self, **changes):
        return "COMMANDER_OPERATION_V1\n```json\n" + json.dumps(self.data(**changes)) + "\n```"

    def config_data(self):
        return {
            "repository": "owner/repo", "queue_issue": 42,
            "commander_login": "commander", "executor_login": "executor",
            "runner_id": "runner-001", "canonical_repo": str(self.repo),
            "worktree_root": str(self.worktrees), "state_dir": str(self.state),
            "runtime_dir": str(self.runtime), "origin_url": "https://example.invalid/repo.git",
            "poll_seconds": 60, "lease_seconds": 180, "provider_failover": False,
            "operational_executables": {"gh": str(self.python), "git": str(self.python),
                                        "python": str(self.python)},
            "enabled_providers": [], "enabled_profiles": ["repo_read"],
            "enabled_quality_gates": ["none"], "quality_gates": {"none": []},
            "executable_paths": {worker: str(self.python) for worker in runner.WORKERS},
            "enabled_operations": ["ops001_mysql_probe"],
            "operation_definitions": {
                "ops001_mysql_probe": {
                    "argv": [str(self.python), str(self.runtime / "rehearsal_operations.py"),
                             "--docker", str(self.docker)],
                    "mode": "read_only", "allowed_target_shas": [runner.OPS001_TARGET_SHA],
                    "max_timeout_seconds": 120, "max_output_bytes": 8192,
                    "require_clean_worktree": True,
                    "description": "Read-only isolated MySQL probe",
                }
            },
        }

    def write_config(self, data):
        path = Path(self.tmp.name) / f"config-{uuid.uuid4()}.json"
        path.write_text(json.dumps(data))
        os.chmod(path, 0o600)
        return path


class OperationSchemaTests(OperationTestCase):
    def test_valid_operation_is_exact_and_bounded(self):
        job = runner.OperationJob.from_comment(self.comment(), self.config)
        self.assertEqual(job.operation_id, "ops001_mysql_probe")
        self.assertEqual(job.target_sha, runner.OPS001_TARGET_SHA)

    def test_every_forbidden_or_unknown_job_field_is_rejected(self):
        for field, value in {
            "worker": "kiro", "model": "gpt-5.6-luna", "prompt": "read",
            "quality_gate": "none", "command": "true", "argv": ["true"],
            "environment": {}, "path": "AGENTS.md", "url": "https://example.invalid",
            "failover": True, "arguments": ["extra"],
        }.items():
            with self.subTest(field=field), self.assertRaises(runner.ValidationError):
                runner.OperationJob.from_comment(self.comment(**{field: value}), self.config)
        payload = json.dumps(self.data()).replace(
            '"operation_id": "ops001_mysql_probe"',
            '"operation_id": "ops001_mysql_probe", "operation_id": "ops001_mysql_probe"')
        with self.assertRaises(runner.ValidationError):
            runner.OperationJob.from_comment(
                "COMMANDER_OPERATION_V1\n```json\n" + payload + "\n```", self.config)

    def test_missing_malformed_identity_and_shell_audit_text_are_rejected(self):
        for changes in (
            {"repository": "other/repo"}, {"queue_issue": 41}, {"runner_id": "other"},
            {"target_sha": "main"}, {"worktree_id": "job-wrong"},
            {"timeout_seconds": 121}, {"output_limit_bytes": 8193},
            {"expected_evidence": "$(unsafe)"}, {"human_approval_ref": "  "},
        ):
            with self.subTest(changes=changes), self.assertRaises(runner.ValidationError):
                runner.OperationJob.from_comment(self.comment(**changes), self.config)
        value = self.data()
        del value["human_approval_ref"]
        malformed = "COMMANDER_OPERATION_V1\n```json\n" + json.dumps(value) + "\n```"
        with self.assertRaises(runner.ValidationError):
            runner.OperationJob.from_comment(malformed, self.config)

    def test_unknown_disabled_and_sha_mismatch_are_rejected(self):
        with self.assertRaises(runner.ValidationError):
            runner.OperationJob.from_comment(self.comment(operation_id="unknown"), self.config)
        disabled = runner.dataclasses.replace(self.config, enabled_operations=frozenset())
        with self.assertRaises(runner.ValidationError):
            runner.OperationJob.from_comment(self.comment(), disabled)
        with self.assertRaises(runner.ValidationError):
            runner.OperationJob.from_comment(self.comment(target_sha="b" * 40), self.config)

    def test_registry_rejects_arbitrary_argv_modes_and_targets(self):
        mutations = []
        arbitrary = self.config_data()
        arbitrary["operation_definitions"]["ops001_mysql_probe"]["argv"][0] = "/bin/sh"
        mutations.append(arbitrary)
        relative = self.config_data()
        relative["operation_definitions"]["ops001_mysql_probe"]["argv"][3] = "docker"
        mutations.append(relative)
        mode = self.config_data()
        mode["operation_definitions"]["ops001_mysql_probe"]["mode"] = "synthetic_mutation"
        mutations.append(mode)
        sha = self.config_data()
        sha["operation_definitions"]["ops001_mysql_probe"]["allowed_target_shas"] = ["b" * 40]
        mutations.append(sha)
        dirty = self.config_data()
        dirty["operation_definitions"]["ops001_mysql_probe"]["require_clean_worktree"] = False
        mutations.append(dirty)
        for data in mutations:
            with self.subTest(data=data), self.assertRaises(runner.ValidationError):
                runner.Config.load(self.write_config(data))
        raw = json.dumps(self.config_data()).replace(
            '"operation_definitions": {',
            '"operation_definitions": {}, "operation_definitions": {', 1)
        path = Path(self.tmp.name) / "duplicate-operation-config.json"
        path.write_text(raw)
        os.chmod(path, 0o600)
        with self.assertRaises(runner.ValidationError):
            runner.Config.load(path)

    def test_old_config_defaults_to_no_operations(self):
        data = self.config_data()
        del data["enabled_operations"]
        del data["operation_definitions"]
        loaded = runner.Config.load(self.write_config(data))
        self.assertEqual(loaded.enabled_operations, frozenset())
        self.assertEqual(loaded.operation_definitions, {})


class OperationExecutionTests(OperationTestCase):
    def test_commander_operation_is_accepted_and_executor_copy_is_ignored(self):
        outer = self
        class CommanderClient:
            def __init__(self, config): pass
            def verify_login(self): pass
            def comments(self, page):
                return [{"id": 71, "user": {"login": "COMMANDER"}, "body": outer.comment()}]
            def post(self, body): raise AssertionError("dry-run must not post")
        with mock.patch.object(runner, "GitHubClient", CommanderClient), \
             mock.patch.object(runner, "verify_target") as verify:
            self.assertEqual(runner.run_once(self.config, dry_run=True), f"VALIDATED {JOB_ID}")
        verify.assert_called_once()

        class ExecutorClient(CommanderClient):
            def comments(self, page):
                return [{"id": 72, "user": {"login": "executor"}, "body": outer.comment()}]
        with mock.patch.object(runner, "GitHubClient", ExecutorClient), \
             mock.patch.object(runner, "verify_target") as verify:
            self.assertEqual(runner.run_once(self.config, dry_run=True), "NO_JOB")
        verify.assert_not_called()

    def test_operation_uses_fixed_argv_once_and_never_provider_adapter(self):
        job = runner.OperationJob.from_comment(self.comment(), self.config)
        result = runner.Result(0, '{"status":"ok","summary":"passed","evidence":["safe"]}',
                               False, False, 0.1)
        with mock.patch.object(runner, "worktree_is_clean", return_value=True), \
             mock.patch.object(runner, "execute", return_value=result) as execute, \
             mock.patch.object(runner, "adapter_argv") as adapter:
            attempt = runner.execute_operation(job, self.config, self.repo)
        self.assertIsNone(attempt.error_category)
        self.assertEqual(execute.call_count, 1)
        self.assertEqual(tuple(execute.call_args.args[0]), self.definition.argv)
        adapter.assert_not_called()

    def test_timeout_overflow_bad_output_and_dirty_postcondition_block_without_retry(self):
        job = runner.OperationJob.from_comment(self.comment(), self.config)
        cases = (
            (runner.Result(-15, "", True, False, 1), "TIMEOUT", [True]),
            (runner.Result(-15, "", False, True, 1), "OUTPUT_LIMIT", [True]),
            (runner.Result(0, "not json", False, False, 1), "OUTPUT_VALIDATION", [True]),
            (runner.Result(0, '{"status":"ok","summary":"ok","evidence":[]}', False, False, 1),
             "WORKTREE_DIRTY", [True, False]),
        )
        for result, expected, clean in cases:
            with self.subTest(expected=expected), \
                 mock.patch.object(runner, "worktree_is_clean", side_effect=clean), \
                 mock.patch.object(runner, "execute", return_value=result) as execute:
                attempt = runner.execute_operation(job, self.config, self.repo)
            self.assertEqual(attempt.error_category, expected)
            self.assertEqual(execute.call_count, 1)

    def test_operation_environment_is_minimal(self):
        source = {
            "HOME": "/safe", "PATH": "/bin", "LANG": "C", "USER": "forged",
            "HTTP_PROXY": "unsafe", "DOCKER_HOST": "unsafe", "SSH_AUTH_SOCK": "unsafe",
            "AWS_ACCESS_KEY_ID": "unsafe", "CLAUDE_CONFIG_DIR": "unsafe",
            "ANTHROPIC_API_KEY": "unsafe", "XDG_CONFIG_HOME": "/unsafe",
        }
        record = type("Record", (), {"pw_name": "trusted_user"})()
        with mock.patch.object(runner.os, "getuid", return_value=501), \
             mock.patch.object(runner.pwd, "getpwuid", return_value=record):
            env = runner.operation_environment(source)
        self.assertEqual(env, {"HOME": "/safe", "PATH": "/bin", "LANG": "C",
                               "USER": "trusted_user"})

    def test_normalized_operation_output_is_exact_and_redacted(self):
        value = runner.normalize_operation_output(
            '{"status":"ok","summary":"safe","evidence":["bounded"]}')
        self.assertEqual(value.status, "ok")
        for text in ("note\n{\"status\":\"ok\",\"summary\":\"x\",\"evidence\":[]}",
                     '{"status":"ok","summary":"x","evidence":[],"extra":1}'):
            with self.assertRaises(runner.ValidationError):
                runner.normalize_operation_output(text)
        redacted = runner.normalize_operation_output(
            '{"status":"ok","summary":"host 192.0.2.1","evidence":["safe"]}')
        self.assertNotIn("192.0.2.1", redacted.summary)

    def test_claim_replay_edit_and_crash_recovery_apply_to_operation_ids(self):
        job = runner.OperationJob.from_comment(self.comment(), self.config)
        recovery = runner.lifecycle(
            job, "FAILED", "runner stop condition: ambiguous execution recovered after restart")
        state = runner.State(self.state)
        try:
            digest = runner.comment_hash(self.comment())
            self.assertTrue(state.claim("9001", JOB_ID, digest, recovery))
            self.assertFalse(state.claim("9001", JOB_ID, digest))
            with self.assertRaises(runner.ValidationError):
                state.claim("9001", JOB_ID, "0" * 64)
            self.assertEqual(runner.recover_incomplete_jobs(object(), state, self.config), 1)
            self.assertEqual(state.summary()["jobs"].get("claimed"), 1)
            class TerminalClient:
                config = self.config
                @staticmethod
                def post(body): return "9101"
            self.assertTrue(runner.drain_terminal_outbox(TerminalClient(), state, self.config))
            self.assertEqual(state.summary()["jobs"].get("blocked"), 1)
        finally:
            state.close()

    def test_runtime_install_hashes_both_files_and_refuses_partial_or_overwrite(self):
        source_dir = Path(self.tmp.name) / "source"
        source_dir.mkdir()
        source = source_dir / "commander_runner.py"
        helper_file = source_dir / "rehearsal_operations.py"
        source.write_text("runner")
        helper_file.write_text("helper")
        target, _ = runner.install_stable_runtime(self.config, source)
        manifest = json.loads((self.runtime / "runtime-manifest.json").read_text())
        self.assertEqual(set(manifest["files"]), {"commander_runner.py", "rehearsal_operations.py"})
        self.assertTrue(target.exists())
        self.assertTrue(runner.runtime_manifest_health(self.config))
        with self.assertRaises(runner.RunnerError):
            runner.install_stable_runtime(self.config, source)

    def test_runtime_install_missing_helper_leaves_no_partial_runtime(self):
        source_dir = Path(self.tmp.name) / "incomplete-source"
        source_dir.mkdir()
        source = source_dir / "commander_runner.py"
        source.write_text("runner")
        runtime = Path(self.tmp.name) / "fresh-runtime"
        config = runner.dataclasses.replace(self.config, runtime_dir=runtime)
        with self.assertRaises(runner.RunnerError):
            runner.install_stable_runtime(config, source)
        self.assertFalse(runtime.exists())
        self.assertEqual(list(runtime.parent.glob(f".{runtime.name}.*")), [])


class ProbeHelperTests(OperationTestCase):
    def fixture(self, **changes):
        values = {
            "version": "28.3.3",
            "ids": "abc123",
            "running": True, "health": "healthy", "project": helper.PROJECT,
            "service": helper.SERVICE,
            "image": helper.IMAGE, "image_id": helper.IMAGE_ID,
            "ports": {"3306/tcp": [{"HostIp": "127.0.0.1", "HostPort": "33317"}],
                      "33060/tcp": None},
            "mounts": [{"Type": "tmpfs", "Destination": "/var/lib/mysql"}],
            "tmpfs": {"/var/lib/mysql": ""},
            "sql": "8.0.43\nlandlord_easy_e2e\n22",
        }
        values.update(changes)
        return [values["version"], values["ids"], json.dumps(values["running"]),
                json.dumps(values["health"]),
                json.dumps(values["project"]), json.dumps(values["service"]),
                json.dumps(values["image"]), json.dumps(values["image_id"]),
                json.dumps(values["ports"]), json.dumps(values["mounts"]),
                json.dumps(values["tmpfs"]), values["sql"]]

    def test_exact_probe_success_and_constructed_commands_are_read_only(self):
        calls = []
        values = iter(self.fixture())
        def fake_run(argv, failure_category):
            calls.append(tuple(argv))
            return next(values)
        with mock.patch.object(helper, "trusted_local_docker_host",
                               return_value="unix:///trusted/docker.sock"), \
             mock.patch.object(helper, "_run", side_effect=fake_run):
            result = helper.probe(str(self.docker))
        self.assertEqual(result["status"], "ok")
        self.assertTrue(all(call[1:3] == ("--host", "unix:///trusted/docker.sock")
                            for call in calls))
        self.assertTrue(all(call[3] in {"version", "ps", "inspect", "exec"}
                            for call in calls))
        self.assertEqual(sum(call[3] == "exec" for call in calls), 1)
        self.assertIn("SELECT VERSION()", calls[-1][-1])
        flattened = " ".join(value for call in calls for value in call)
        for forbidden_route in ("--context", "DOCKER_HOST", "DOCKER_CONTEXT", "tcp://", "ssh://"):
            self.assertNotIn(forbidden_route, flattened)
        for forbidden in ("run", "start", "stop", "restart", "rm", "pull", "build", "prune"):
            self.assertNotIn(forbidden, {call[3] for call in calls})

    def test_trusted_posix_home_socket_and_inherited_home_is_ignored(self):
        root = Path(self.tmp.name)
        trusted_home = root / "trusted-home"
        socket_path = trusted_home / ".docker" / "run" / "docker.sock"
        socket_path.parent.mkdir(parents=True)
        os.chmod(trusted_home / ".docker", 0o700)
        os.chmod(trusted_home / ".docker" / "run", 0o700)
        socket_path.write_text("metadata fixture")
        record = type("Record", (), {"pw_dir": str(trusted_home)})()
        metadata = SimpleNamespace(st_mode=stat.S_IFSOCK, st_uid=os.geteuid())
        real_lstat = os.lstat

        def selective_lstat(path):
            if Path(path).name == "docker.sock":
                return metadata
            return real_lstat(path)

        with mock.patch.dict(os.environ, {"HOME": str(root / "forged-home")}), \
             mock.patch.object(helper.pwd, "getpwuid", return_value=record), \
             mock.patch.object(helper.os, "lstat", side_effect=selective_lstat):
            host = helper.trusted_local_docker_host()
        self.assertEqual(host, "unix://" + str(socket_path.resolve()))

    def test_untrusted_socket_shapes_fail_closed(self):
        root = Path(self.tmp.name)
        cases = []

        missing_home = root / "missing-case"
        missing_home.mkdir()
        cases.append((missing_home, None, None))

        file_home = root / "file-case"
        file_socket = file_home / ".docker" / "run" / "docker.sock"
        file_socket.parent.mkdir(parents=True)
        file_socket.write_text("not a socket")
        cases.append((file_home, None, None))

        target_home = root / "symlink-target"
        target_socket = target_home / ".docker" / "run" / "actual.sock"
        target_socket.parent.mkdir(parents=True)
        target_socket.write_text("metadata fixture")
        symlink_home = root / "symlink-case"
        symlink_socket = symlink_home / ".docker" / "run" / "docker.sock"
        symlink_socket.parent.mkdir(parents=True)
        symlink_socket.symlink_to(target_socket)
        cases.append((symlink_home, None, None))

        wrong_owner_home = root / "owner-case"
        wrong_owner_socket = wrong_owner_home / ".docker" / "run" / "docker.sock"
        wrong_owner_socket.parent.mkdir(parents=True)
        wrong_owner_socket.write_text("metadata fixture")
        wrong_owner_metadata = SimpleNamespace(
            st_mode=stat.S_IFSOCK, st_uid=os.geteuid() + 1)
        cases.append((wrong_owner_home, None, wrong_owner_metadata))

        outside = root / "outside"
        outside_socket = outside / "run" / "docker.sock"
        outside_socket.parent.mkdir(parents=True)
        outside_socket.write_text("metadata fixture")
        escape_home = root / "escape-case"
        escape_home.mkdir()
        (escape_home / ".docker").symlink_to(outside)
        escape_metadata = SimpleNamespace(st_mode=stat.S_IFSOCK, st_uid=os.geteuid())
        cases.append((escape_home, None, escape_metadata))

        real_lstat = os.lstat
        for home, effective_uid, metadata in cases:
            record = type("Record", (), {"pw_dir": str(home)})()
            uid_patch = (mock.patch.object(helper.os, "geteuid", return_value=effective_uid)
                         if effective_uid is not None else mock.patch.object(
                             helper.os, "geteuid", wraps=helper.os.geteuid))
            socket_path = home / ".docker" / "run" / "docker.sock"

            def selective_lstat(path, *, expected=socket_path, fake=metadata):
                if fake is not None and Path(path) == expected:
                    return fake
                return real_lstat(path)

            lstat_patch = (mock.patch.object(
                               helper.os, "lstat", side_effect=selective_lstat)
                           if metadata is not None else mock.patch.object(
                               helper.os, "lstat", wraps=os.lstat))
            with self.subTest(home=home.name), \
                 mock.patch.object(helper.pwd, "getpwuid", return_value=record), \
                 uid_patch, lstat_patch, self.assertRaisesRegex(
                     helper.ProbeError, "docker_socket_invalid"):
                helper.trusted_local_docker_host()

    def test_group_or_world_writable_socket_directory_fails_closed(self):
        root = Path(self.tmp.name)
        trusted_home = root / "trusted-home-permissions"
        socket_path = trusted_home / ".docker" / "run" / "docker.sock"
        socket_path.parent.mkdir(parents=True)
        socket_path.write_text("metadata fixture")
        record = type("Record", (), {"pw_dir": str(trusted_home)})()
        socket_metadata = SimpleNamespace(st_mode=stat.S_IFSOCK | 0o600,
                                          st_uid=os.geteuid())
        real_lstat = os.lstat
        for unsafe_mode in (0o770, 0o707):
            os.chmod(socket_path.parent, unsafe_mode)
            def selective_lstat(path):
                if Path(path) == socket_path:
                    return socket_metadata
                return real_lstat(path)
            with self.subTest(mode=oct(unsafe_mode)), \
                 mock.patch.object(helper.pwd, "getpwuid", return_value=record), \
                 mock.patch.object(helper.os, "lstat", side_effect=selective_lstat), \
                 self.assertRaisesRegex(helper.ProbeError, "docker_socket_invalid"):
                helper.trusted_local_docker_host()

    def test_every_identity_binding_storage_and_database_mismatch_blocks(self):
        cases = (
            {"ids": ""}, {"ids": "a\nb"},
            {"health": "starting"}, {"running": False}, {"project": "wrong"},
            {"service": "wrong"},
            {"image": "mysql:latest"}, {"image_id": "sha256:" + "0" * 64},
            {"ports": {}},
            {"ports": {"3306/tcp": [{"HostIp": "0.0.0.0", "HostPort": "33317"}]}},
            {"ports": {"3306/tcp": [{"HostIp": "127.0.0.1", "HostPort": "33318"}]}},
            {"ports": {"3306/tcp": [{"HostIp": "127.0.0.1", "HostPort": "33317"}],
                       "33060/tcp": [{"HostIp": "127.0.0.1", "HostPort": "33360"}]}},
            {"mounts": "malformed"},
            {"mounts": [{"Type": "tmpfs", "Destination": "/unexpected"}]},
            {"mounts": [{"Type": "volume", "Destination": "/var/lib/mysql"}]},
            {"mounts": [{"Type": "tmpfs", "Destination": "/var/lib/mysql"},
                        {"Type": "bind", "Destination": "/extra"}]},
            {"tmpfs": {}}, {"sql": "5.7.44\nlandlord_easy_e2e\n22"},
            {"sql": "8.0.43\nwrong\n22"}, {"sql": "8.0.43\nlandlord_easy_e2e\n21"},
        )
        for changes in cases:
            with self.subTest(changes=changes), \
                 mock.patch.object(helper, "trusted_local_docker_host",
                                   return_value="unix:///trusted/docker.sock"), \
                 mock.patch.object(helper, "_docker", side_effect=self.fixture(**changes)), \
                 self.assertRaises(helper.ProbeError):
                helper.probe(str(self.docker))

    def test_empty_mounts_with_exact_tmpfs_succeeds(self):
        with mock.patch.object(helper, "trusted_local_docker_host",
                               return_value="unix:///trusted/docker.sock"), \
             mock.patch.object(helper, "_docker", side_effect=self.fixture(mounts=[])):
            self.assertEqual(helper.probe(str(self.docker))["status"], "ok")

    def test_stage_specific_errors_are_sanitized(self):
        host = "unix:///trusted/docker.sock"
        for command, category in {
            "version": "docker_version_failed", "ps": "docker_ps_failed",
            "inspect": "docker_inspect_failed", "exec": "docker_exec_failed",
        }.items():
            with self.subTest(command=command), mock.patch.object(
                    helper, "_run", side_effect=helper.ProbeError(category)):
                with self.assertRaisesRegex(helper.ProbeError, f"^{category}$"):
                    helper._docker(str(self.docker), host, command)

        for command, category in {
            "version": "docker_version_failed", "ps": "docker_ps_failed",
            "inspect": "docker_inspect_failed", "exec": "docker_exec_failed",
        }.items():
            with self.subTest(contract=command), mock.patch.object(
                    helper, "_run", return_value="") as execute:
                helper._docker(str(self.docker), host, command)
            self.assertEqual(execute.call_args.args[1], category)

    def test_raw_child_details_do_not_escape_helper_output(self):
        output = io.StringIO()
        with mock.patch.object(helper, "probe", side_effect=helper.ProbeError(
                "docker_ps_failed")), contextlib.redirect_stdout(output):
            self.assertEqual(helper.main(["--docker", str(self.docker)]), 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result["evidence"], ["category=docker_ps_failed"])
        serialized = json.dumps(result)
        for forbidden in ("unix://", "docker.sock", "permission denied", str(self.tmp.name)):
            self.assertNotIn(forbidden, serialized)

    def test_mutation_subcommands_are_rejected_before_execution(self):
        for command in ("run", "start", "stop", "restart", "rm", "pull", "build", "prune"):
            with self.subTest(command=command), mock.patch.object(helper, "_run") as execute, \
                 self.assertRaises(helper.ProbeError):
                helper._docker(str(self.docker), "unix:///trusted/docker.sock", command)
            execute.assert_not_called()

    def test_helper_run_enforces_timeout_and_output_overflow(self):
        with mock.patch.object(helper, "COMMAND_CAP", 32):
            with self.assertRaisesRegex(helper.ProbeError, "docker_output_overflow"):
                helper._run((str(self.python), "-c", "print('x' * 4096)"),
                            "docker_version_failed")

        with mock.patch.object(helper, "COMMAND_TIMEOUT", 0.2):
            with self.assertRaisesRegex(helper.ProbeError, "docker_command_timeout"):
                helper._run((str(self.python), "-c", "import time; time.sleep(30)"),
                            "docker_version_failed")

    def test_runner_timeout_kills_sigterm_resistant_operation_descendant(self):
        pid_file = Path(self.tmp.name) / "child.pid"
        ready_file = Path(self.tmp.name) / "child.ready"
        child_code = (
            "import pathlib,signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); "
            f"pathlib.Path({str(ready_file)!r}).write_text('ready'); time.sleep(30)"
        )
        parent_code = (
            "import pathlib,subprocess,sys,time; "
            f"p=subprocess.Popen([sys.executable,'-c',{child_code!r}]); "
            f"pathlib.Path({str(pid_file)!r}).write_text(str(p.pid)); "
            f"r=pathlib.Path({str(ready_file)!r}); "
            "[(time.sleep(0.01)) for _ in range(100) if not r.exists()]; time.sleep(30)"
        )
        result = runner.execute((str(self.python), "-c", parent_code), timeout=1, cap=8192)
        self.assertTrue(result.timed_out)
        self.assertTrue(pid_file.exists())
        child_pid = int(pid_file.read_text())
        stopped = False
        for _ in range(40):
            try:
                os.kill(child_pid, 0)
            except ProcessLookupError:
                stopped = True
                break
            time.sleep(0.05)
        if not stopped:
            # A terminated orphan can remain briefly as a zombie; signal 0 alone
            # cannot distinguish that state on every test host.
            try:
                os.kill(child_pid, signal.SIGKILL)
            except ProcessLookupError:
                stopped = True
        self.assertTrue(stopped, "child process from timed-out group remained alive")


if __name__ == "__main__":
    unittest.main()
