"""Framework-level acceptance tests for the hardened control plane.

Each test here maps to a named failure this control plane actually suffered in
production use, not to a hypothetical.  The comments name the incident so a
future reader can tell which behaviours are load-bearing.
"""
import importlib.util
import json
import os
import sys
import tempfile
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


class HardeningTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.repo, self.worktrees = root / "repo", root / "worktrees"
        self.state, self.runtime = root / "state", root / "runtime"
        self.repo.mkdir()
        self.worktrees.mkdir()
        self.config = runner.Config(
            repository="owner/repo", queue_issue=42, commander_login="commander",
            executor_login="executor", runner_id="runner-001",
            canonical_repo=self.repo, worktree_root=self.worktrees, state_dir=self.state,
            origin_url="https://example.invalid/owner/repo.git", runtime_dir=self.runtime,
            operational_executables={"gh": sys.executable, "git": sys.executable,
                                     "python": sys.executable},
            enabled_providers=frozenset(runner.WORKERS),
            enabled_profiles=frozenset(runner.PROFILES),
            enabled_quality_gates=frozenset({"none", "unit"}),
            quality_gates={"none": (), "unit": ((sys.executable, "-c", "print('ok')"),)},
            delivery_path_allowlists={"unit": frozenset({"allowed.txt"})},
            executable_paths={"kiro": sys.executable, "copilot": sys.executable,
                              "claude": sys.executable},
        )

    def tearDown(self):
        self.tmp.cleanup()

    def data(self, **changes):
        value = {
            "schema": runner.SCHEMA, "job_id": JOB_ID, "repository": "owner/repo",
            "queue_issue": 42, "target_sha": SHA,
            "worktree_id": runner.derive_worktree_id(JOB_ID), "runner_id": "runner-001",
            "worker": "kiro", "model": "gpt-5.6-luna", "profile": "repo_read",
            "assigned": "ORG-002", "prompt": "Read the assigned specification.",
            "timeout_seconds": 30, "output_limit_bytes": 1024,
            "expected_evidence": "summary", "quality_gate": "none",
        }
        value.update(changes)
        return value

    def comment(self, **changes):
        return "COMMANDER_JOB_V1\n```json\n" + json.dumps(self.data(**changes)) + "\n```"

    def job(self, **changes):
        return runner.Job.from_comment(self.comment(**changes), self.config)

    def queue(self, body, author="commander", comment_id=1):
        """A GitHubClient stand-in that serves one queue comment and records posts."""
        posts = []
        outer = self

        class FixtureClient:
            def __init__(self, config):
                self.config = config

            def verify_login(self):
                pass

            def comments(self, page):
                if page != 1:
                    return []
                return [{"id": comment_id, "user": {"login": author}, "body": body}]

            def comment(self, cid, page):
                return {"id": comment_id, "user": {"login": author}, "body": body}

            def find_comment(self, cid, max_page):
                return self.comment(cid, 1)

            def post(self, body):
                posts.append(runner.ensure_safe_post(body))
                return str(1000 + len(posts))

            def post_wake(self, body):
                posts.append("WAKE:" + body)
                return str(2000 + len(posts))

        FixtureClient.outer = outer
        return FixtureClient, posts


# --- D1 / D2: rejection is explicit, punctuation is not a rejection reason ----

class RejectionTests(HardeningTestCase):
    def test_invalid_job_addressed_to_this_runner_produces_explicit_rejected(self):
        """Incident: a job failed validation and the runner said nothing.

        The Commander could not distinguish 'not polled yet' from 'refused',
        so it re-posted by hand.  A refusal must now be a terminal record.
        """
        bad = self.comment(profile="nonsense_profile")
        client, posts = self.queue(bad)
        with mock.patch.object(runner, "GitHubClient", client):
            self.assertEqual(runner.run_once(self.config), f"REJECTED {JOB_ID}")
        terminal = [p for p in posts if "REJECTED" in p]
        self.assertEqual(len(terminal), 1)
        self.assertIn(f"job={JOB_ID}", terminal[0])
        self.assertIn("stop_class=PROTOCOL_FAILURE", terminal[0])
        self.assertIn("reason=", terminal[0])

    def test_rejected_job_is_terminal_and_never_reprocessed(self):
        bad = self.comment(worker="not-a-worker")
        client, posts = self.queue(bad)
        with mock.patch.object(runner, "GitHubClient", client):
            self.assertEqual(runner.run_once(self.config), f"REJECTED {JOB_ID}")
            # A second poll of the same comment must not re-reject or re-run it.
            self.assertEqual(runner.run_once(self.config), "NO_JOB")
        self.assertEqual(len([p for p in posts if "REJECTED" in p]), 1)

    def test_job_for_another_runner_is_skipped_not_rejected(self):
        """A runner must never claim or terminate another runner's work."""
        other = self.comment(runner_id="runner-999")
        client, posts = self.queue(other)
        with mock.patch.object(runner, "GitHubClient", client):
            self.assertEqual(runner.run_once(self.config), "NO_JOB")
        self.assertEqual(posts, [])

    def test_unidentifiable_comment_is_skipped_not_rejected(self):
        for body in ("hello world",
                     "COMMANDER_JOB_V1\n```json\n{\"job_id\": \"not-a-uuid\"}\n```",
                     "COMMANDER_JOB_V1\n```json\n{not json}\n```"):
            with self.subTest(body=body[:30]):
                client, posts = self.queue(body)
                with mock.patch.object(runner, "GitHubClient", client):
                    self.assertEqual(runner.run_once(self.config), "NO_JOB")
                self.assertEqual(posts, [])

    def test_semicolons_and_punctuation_do_not_reject_a_legitimate_prompt(self):
        """Incident: a valid review prompt was refused for containing ';'."""
        prompt = ("Audit PR #25; check leases.service.ts (lines 688-699) & report. "
                  "Return `{\"status\":\"ok\"}` | nothing else. cost < $1")
        job = self.job(prompt=prompt)
        self.assertEqual(job.prompt, prompt)

    def test_control_characters_are_still_rejected(self):
        for bad in ("a\x00b", "a\x1bb", "a\x07b"):
            with self.subTest(bad=bad), self.assertRaises(runner.ValidationError):
                self.job(prompt=bad)


# --- D3 / D4: long output survives, and recovery costs no quota --------------

class OutputRecoveryTests(HardeningTestCase):
    def claude_envelope(self, summary, evidence=("e1",)):
        inner = json.dumps({"status": "ok", "summary": summary, "evidence": list(evidence)})
        return json.dumps({"type": "result", "subtype": "success", "is_error": False,
                           "total_cost_usd": 0.9081394,
                           "result": f"Delivering now.\n\n```json\n{inner}\n```"})

    def test_long_claude_report_is_no_longer_discarded(self):
        """Incident: a 403s, exit-0, $0.91 Claude review with a 12131-char
        summary was dropped whole because the cap was 2000 characters."""
        summary = "F" * 12131
        output = runner.normalize_provider_output(self.claude_envelope(summary))
        self.assertEqual(output.status, "ok")
        self.assertEqual(len(output.summary), 12131)
        self.assertEqual(output.usage, "cost_usd=0.9081394")

    def test_summary_beyond_the_new_bound_is_still_refused(self):
        with self.assertRaises(runner.ValidationError):
            runner.normalize_provider_output(
                self.claude_envelope("F" * (runner.MAX_SUMMARY_CHARS + 1)))

    def test_raw_output_is_persisted_before_parsing_and_recovers_for_free(self):
        """The recovery guarantee: bytes hit disk before we try to parse them."""
        payload = self.claude_envelope("S" * 9000, evidence=["alpha", "beta"])
        runner.store_raw_output(self.state, JOB_ID, payload, ordinal=1)
        recovered = runner.renormalize_job(self.state, JOB_ID)
        self.assertEqual(recovered["provider_calls"], 0)
        self.assertEqual(recovered["status"], "ok")
        self.assertEqual(recovered["summary_chars"], 9000)
        self.assertEqual(recovered["evidence_items"], 2)
        self.assertTrue(Path(recovered["artifact"]).is_file())
        self.assertRegex(recovered["artifact_sha256"], r"^[0-9a-f]{64}$")

    def test_renormalize_prefers_the_latest_recoverable_attempt(self):
        runner.store_raw_output(self.state, JOB_ID, "unparseable garbage", ordinal=1)
        runner.store_raw_output(self.state, JOB_ID, self.claude_envelope("later"), ordinal=2)
        recovered = runner.renormalize_job(self.state, JOB_ID)
        self.assertEqual(recovered["recovered_from"], f"{JOB_ID}.attempt-2.log")

    def test_legacy_single_file_raw_output_is_still_recoverable(self):
        directory = self.state / "raw-output"
        directory.mkdir(mode=0o700, parents=True)
        (directory / f"{JOB_ID}.log").write_text(self.claude_envelope("legacy"))
        self.assertEqual(runner.renormalize_job(self.state, JOB_ID)["status"], "ok")

    def test_renormalize_reports_failure_without_inventing_a_result(self):
        runner.store_raw_output(self.state, JOB_ID, "not a report at all", ordinal=1)
        with self.assertRaises(runner.RunnerError):
            runner.renormalize_job(self.state, JOB_ID)

    def test_output_validation_terminal_tells_the_operator_how_to_recover(self):
        job = self.job()
        result = runner.Result(0, "prose with no JSON contract at all", False, False, 12.0)
        attempt = runner.ProviderAttempt("kiro", "gpt-5.6-luna", result, None, "OUTPUT_VALIDATION")
        with mock.patch.object(runner, "execute_with_failover",
                               return_value=(attempt, [attempt])), \
             mock.patch.object(runner, "prepare_worktree", return_value=self.worktrees):
            client, posts = self.queue(self.comment())
            with mock.patch.object(runner, "GitHubClient", client):
                self.assertEqual(runner.run_once(self.config), f"FAILED {JOB_ID}")
        terminal = [p for p in posts if "FAILED" in p][-1]
        self.assertIn("stop_class=PROTOCOL_FAILURE", terminal)
        self.assertIn("renormalize", terminal)

    def test_artifact_holds_the_full_report_while_the_issue_stays_bounded(self):
        output = runner.NormalizedOutput("ok", "L" * 15000, ("evidence one",), "cost_usd=0.9")
        path, digest = runner.store_artifact(self.state, JOB_ID, 1, output)
        body = path.read_text()
        self.assertIn("L" * 15000, body)
        self.assertIn(runner.attempt_id_for(JOB_ID, 1), body)
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
        self.assertLessEqual(len(runner.redact(body, runner.MAX_ISSUE_EVIDENCE_CHARS)),
                             runner.MAX_ISSUE_EVIDENCE_CHARS)
        self.assertRegex(digest, r"^[0-9a-f]{64}$")


# --- D5 / D6 / D7: crash, GitHub failure, and duplicate suppression ----------

class DurabilityTests(HardeningTestCase):
    def test_attempt_ids_are_derived_stable_and_distinct_from_the_job_uuid(self):
        first = runner.attempt_id_for(JOB_ID, 1)
        second = runner.attempt_id_for(JOB_ID, 2)
        self.assertNotEqual(first, JOB_ID)
        self.assertNotEqual(first, second)
        self.assertEqual(first, runner.attempt_id_for(JOB_ID, 1))
        for bad in (0, -1, runner.MAX_ATTEMPTS_CEILING + 1, True):
            with self.subTest(bad=bad), self.assertRaises(runner.ValidationError):
                runner.attempt_id_for(JOB_ID, bad)

    def test_attempt_rows_are_appended_and_deduplicated(self):
        state = runner.State(self.state)
        try:
            state.record_attempt(JOB_ID, 1, "kiro", "gpt-5.6-luna", "QUOTA", "TRANSIENT_FAILURE")
            state.record_attempt(JOB_ID, 1, "kiro", "gpt-5.6-luna", "QUOTA", "TRANSIENT_FAILURE")
            state.record_attempt(JOB_ID, 2, "claude", "claude-sonnet-5", None, None)
            rows = state.attempts_for(JOB_ID)
            self.assertEqual([row[1] for row in rows], [1, 2])
            self.assertEqual(rows[0][5], "TRANSIENT_FAILURE")
        finally:
            state.close()

    def test_attempt_rows_reject_unknown_taxonomy_values(self):
        state = runner.State(self.state)
        try:
            with self.assertRaises(runner.ValidationError):
                state.record_attempt(JOB_ID, 1, "kiro", "m", "NOT_A_CATEGORY", None)
            with self.assertRaises(runner.ValidationError):
                state.record_attempt(JOB_ID, 1, "kiro", "m", None, "NOT_A_STOP_CLASS")
        finally:
            state.close()

    def test_duplicate_job_uuid_is_refused(self):
        state = runner.State(self.state)
        try:
            self.assertTrue(state.claim("1", JOB_ID, "h" * 64))
            with self.assertRaises(runner.ValidationError):
                state.claim("2", JOB_ID, "h" * 64)
        finally:
            state.close()

    def test_github_write_failure_leaves_the_terminal_queued_for_redelivery(self):
        """Incident class: a terminal post fails; the job must not be re-run."""
        state = runner.State(self.state)
        try:
            state.claim("7", JOB_ID, "h" * 64)
            state.set_status("7", "running")
            state.queue_terminal("7", JOB_ID, "COMMANDER_RUNNER_V1 COMPLETED\njob=x",
                                 "succeeded", "COMPLETED", self.config)
            self.assertEqual(len(state.pending_terminals()), 1)

            class FailingClient:
                config = self.config

                def post(self, body):
                    raise runner.RunnerError("GitHub unavailable")

            self.assertFalse(runner.drain_terminal_outbox(FailingClient(), state, self.config))
            self.assertEqual(len(state.pending_terminals()), 1)

            class WorkingClient:
                config = self.config

                def post(self, body):
                    return "999"

            self.assertTrue(runner.drain_terminal_outbox(WorkingClient(), state, self.config))
            self.assertEqual(state.pending_terminals(), ())
        finally:
            state.close()

    def test_wake_is_delivered_once_even_if_drained_repeatedly(self):
        state = runner.State(self.state)
        try:
            wake_config = runner.dataclasses.replace(self.config, wake_pull_request=22)
            state.enqueue_wake(JOB_ID, "555", "COMPLETED", wake_config)
            # An identical re-enqueue (duplicate webhook / repeated drain) is inert.
            state.enqueue_wake(JOB_ID, "555", "COMPLETED", wake_config)
            self.assertEqual(len(state.pending_wakes()), 1)
            sent = []

            class WakeClient:
                config = wake_config

                def post_wake(self, body):
                    sent.append(body)
                    return "1"

            self.assertTrue(runner.drain_wake_outbox(WakeClient(), state, wake_config))
            self.assertTrue(runner.drain_wake_outbox(WakeClient(), state, wake_config))
            self.assertEqual(len(sent), 1)
            self.assertEqual(state.pending_wakes(), ())
        finally:
            state.close()

    def test_conflicting_wake_identity_for_one_job_is_refused(self):
        state = runner.State(self.state)
        try:
            wake_config = runner.dataclasses.replace(self.config, wake_pull_request=22)
            state.enqueue_wake(JOB_ID, "555", "COMPLETED", wake_config)
            with self.assertRaises(runner.ValidationError):
                state.enqueue_wake(JOB_ID, "556", "FAILED", wake_config)
        finally:
            state.close()


# --- D9: SHA drift and branch binding ---------------------------------------

class TargetBindingTests(HardeningTestCase):
    def operation_config(self, **changes):
        fields = {
            "argv": (sys.executable, str(self.runtime / "rehearsal_operations.py"),
                     "--docker", "/usr/local/bin/docker"),
            "mode": "read_only", "allowed_target_shas": frozenset({SHA}),
            "max_timeout_seconds": 120, "max_output_bytes": 16384,
            "require_clean_worktree": True, "description": "probe",
        }
        fields.update(changes)
        definition = runner.OperationDefinition(**fields)
        return runner.dataclasses.replace(
            self.config, enabled_operations=frozenset({"ops001_mysql_probe"}),
            operation_definitions={"ops001_mysql_probe": definition})

    def test_exact_sha_allowlist_still_authorizes_without_touching_git(self):
        config = self.operation_config()
        job = runner.OperationJob(
            job_id=JOB_ID, repository="owner/repo", queue_issue=42, target_sha=SHA,
            worktree_id=runner.derive_worktree_id(JOB_ID), runner_id="runner-001",
            operation_id="ops001_mysql_probe", timeout_seconds=60, output_limit_bytes=1024,
            expected_evidence="rows=0", human_approval_ref="issue-21")
        with mock.patch.object(runner, "git_checked") as git:
            self.assertEqual(runner.resolve_operation_binding(config, job),
                             "exact_sha_allowlist")
        git.assert_not_called()

    def test_branch_binding_accepts_only_the_current_head(self):
        """Removes the pin/edit/pin loop without widening the approval."""
        config = self.operation_config(
            allowed_target_shas=frozenset(),
            allowed_target_branches=frozenset({"test/rel001-mysql-integration"}))
        head = "b" * 40
        job = runner.OperationJob(
            job_id=JOB_ID, repository="owner/repo", queue_issue=42, target_sha=head,
            worktree_id=runner.derive_worktree_id(JOB_ID), runner_id="runner-001",
            operation_id="ops001_mysql_probe", timeout_seconds=60, output_limit_bytes=1024,
            expected_evidence="rows=0", human_approval_ref="issue-21")
        with mock.patch.object(runner, "git_checked", side_effect=["", head]):
            self.assertEqual(runner.resolve_operation_binding(config, job),
                             "branch_head:test/rel001-mysql-integration")
        # A SHA that is no longer the head fails closed: drift is never accepted.
        drifted = runner.dataclasses.replace(job, target_sha="c" * 40)
        with mock.patch.object(runner, "git_checked", side_effect=["", head]), \
             self.assertRaises(runner.ValidationError):
            runner.resolve_operation_binding(config, drifted)

    def test_protected_branches_may_not_be_bound(self):
        for branch in ("main", "dev", "master", "HEAD"):
            with self.subTest(branch=branch), self.assertRaises(runner.ValidationError):
                runner.validate_operation_branches([branch])

    def test_branch_names_that_could_escape_a_ref_are_refused(self):
        for branch in ("../evil", "a..b", "-x", "feat/*", "a b", "x.lock", ""):
            with self.subTest(branch=branch), self.assertRaises(runner.ValidationError):
                runner.validate_operation_branches([branch])

    def test_operation_without_any_sha_or_branch_is_refused(self):
        with self.assertRaises(runner.ValidationError):
            runner.resolve_operation_binding(
                self.operation_config(allowed_target_shas=frozenset()),
                runner.OperationJob(
                    job_id=JOB_ID, repository="owner/repo", queue_issue=42, target_sha=SHA,
                    worktree_id=runner.derive_worktree_id(JOB_ID), runner_id="runner-001",
                    operation_id="ops001_mysql_probe", timeout_seconds=60,
                    output_limit_bytes=1024, expected_evidence="rows=0",
                    human_approval_ref="issue-21"))


# --- D11 / D12: quota-aware routing and authorized paid overflow -------------

class QuotaRoutingTests(HardeningTestCase):
    def test_exhausted_provider_is_skipped_in_favour_of_free_capacity(self):
        ledger = runner.QuotaLedger(self.state)
        ledger.mark_exhausted("kiro")
        order = runner.route_candidates(self.job(), True, frozenset(runner.WORKERS), ledger)
        self.assertNotIn("kiro", [worker for worker, _ in order])
        self.assertTrue(order)

    def test_exhaustion_expires_with_the_quota_window(self):
        ledger = runner.QuotaLedger(self.state)
        ledger.mark_exhausted("kiro")
        self.assertTrue(ledger.is_exhausted("kiro"))
        ledger.data["kiro"]["reset_key"] = "monthly:1970-01-01"
        self.assertFalse(ledger.is_exhausted("kiro"))

    def test_all_free_quota_exhausted_blocks_when_paid_overflow_is_unauthorized(self):
        ledger = runner.QuotaLedger(self.state)
        for worker in runner.WORKERS:
            ledger.mark_exhausted(worker)
        self.assertEqual(
            runner.route_candidates(self.job(), True, frozenset(runner.WORKERS), ledger), [])

    def test_paid_overflow_is_used_only_after_every_free_window_is_spent(self):
        ledger = runner.QuotaLedger(self.state)
        # With free capacity remaining, paid overflow must NOT be selected.
        ledger.mark_exhausted("kiro")
        order = runner.route_candidates(
            self.job(), True, frozenset(runner.WORKERS), ledger,
            paid_overflow=frozenset({"kiro"}), paid_overflow_authorized=True)
        self.assertNotIn("kiro", [worker for worker, _ in order])
        # Once everything free is spent, authorized paid capacity takes over.
        for worker in runner.WORKERS:
            ledger.mark_exhausted(worker)
        order = runner.route_candidates(
            self.job(), True, frozenset(runner.WORKERS), ledger,
            paid_overflow=frozenset({"kiro"}), paid_overflow_authorized=True)
        self.assertEqual([worker for worker, _ in order], ["kiro"])

    def test_paid_overflow_config_requires_an_explicit_provider_list(self):
        with self.assertRaises(runner.ValidationError):
            runner.validate_enabled(["nope"], runner.WORKERS, "paid_overflow_providers")

    def test_no_authorized_capacity_raises_instead_of_running_anything(self):
        ledger_path = self.state / "quota.json"
        ledger_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        ledger = runner.QuotaLedger(self.state)
        for worker in runner.WORKERS:
            ledger.mark_exhausted(worker)
        with mock.patch.object(runner, "execute") as execute, \
             self.assertRaises(runner.RunnerError):
            runner.execute_with_failover(self.job(), self.config, self.worktrees)
        execute.assert_not_called()


# --- Stop-condition taxonomy and bounded retry ------------------------------

class StopConditionTests(HardeningTestCase):
    def test_every_error_category_maps_to_a_known_stop_class(self):
        for category in runner.ERROR_CATEGORIES:
            self.assertIn(runner.stop_class_for(category), runner.STOP_CLASSES)
        self.assertIsNone(runner.stop_class_for(None))

    def test_safety_categories_are_never_retryable(self):
        for category in ("PERMISSION", "WORKTREE_DIRTY"):
            with self.subTest(category=category):
                self.assertEqual(runner.stop_class_for(category), "SAFETY_STOP")
                self.assertNotIn("SAFETY_STOP", runner.RETRYABLE_STOP_CLASSES)

    def test_engineering_failures_are_separated_from_safety_failures(self):
        self.assertEqual(runner.stop_class_for("TIMEOUT"), "TRANSIENT_FAILURE")
        self.assertEqual(runner.stop_class_for("OUTPUT_VALIDATION"), "PROTOCOL_FAILURE")
        self.assertEqual(runner.stop_class_for("RUNTIME"), "CODE_FAILURE")
        self.assertIn("TRANSIENT_FAILURE", runner.RETRYABLE_STOP_CLASSES)
        self.assertIn("PROTOCOL_FAILURE", runner.RETRYABLE_STOP_CLASSES)

    def test_backoff_grows_and_stays_bounded(self):
        delays = [runner.retry_backoff_seconds(n) for n in range(1, 6)]
        self.assertEqual(delays, sorted(delays))
        self.assertLessEqual(max(delays), runner.RETRY_BACKOFF_CAP_SECONDS)

    def test_transient_failure_retries_within_budget_then_stops(self):
        """A transient provider failure fails over; it does not loop forever."""
        config = runner.dataclasses.replace(
            self.config, provider_failover=True, max_attempts=2)
        unavailable = runner.Result(1, "rate limit exceeded", False, False, 0.1)
        slept = []
        with mock.patch.object(runner, "execute", return_value=unavailable), \
             mock.patch.object(runner, "worktree_is_clean", return_value=True):
            final, attempts = runner.execute_with_failover(
                self.job(), config, self.worktrees, sleeper=slept.append)
        self.assertEqual(len(attempts), 2)
        self.assertEqual(final.error_category, "RATE_LIMIT")
        self.assertEqual(len(slept), 1)

    def test_protocol_failure_does_not_spend_a_second_provider_call(self):
        """A parse bug must never cost quota: recover locally instead."""
        config = runner.dataclasses.replace(
            self.config, provider_failover=True, max_attempts=3)
        unparseable = runner.Result(0, "I finished the review, here it is in prose.",
                                    False, False, 400.0)
        with mock.patch.object(runner, "execute", return_value=unparseable) as execute:
            final, attempts = runner.execute_with_failover(
                self.job(), config, self.worktrees, sleeper=lambda _: None)
        self.assertEqual(execute.call_count, 1)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(final.error_category, "OUTPUT_VALIDATION")
        # The bytes survived, so the operator can recover for free.
        self.assertTrue(runner.raw_output_paths(self.state, JOB_ID))


# --- D14: nothing sensitive escapes -----------------------------------------

class SecretHygieneTests(HardeningTestCase):
    SECRETS = (
        "ghp_" + "A" * 36,
        "github_pat_" + "B" * 30,
        "AKIA" + "C" * 16,
        "sk-" + "d" * 32,
        "password: hunter2hunter2",
        "mysql://user:pw@10.0.0.5:3306/db",
        "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    )

    def test_secrets_never_survive_into_an_issue_comment(self):
        for secret in self.SECRETS:
            with self.subTest(secret=secret[:16]):
                try:
                    cleaned = runner.ensure_safe_post(f"evidence: {secret} tail")
                except runner.UnsafeOutputError:
                    continue  # fail-closed is an acceptable outcome
                self.assertNotIn(secret, cleaned)

    def test_secrets_never_survive_into_a_local_artifact(self):
        for secret in self.SECRETS:
            with self.subTest(secret=secret[:16]):
                output = runner.NormalizedOutput("ok", f"report {secret} end", ("e",), None)
                try:
                    path, _ = runner.store_artifact(self.state, JOB_ID, 1, output)
                except runner.UnsafeOutputError:
                    continue
                self.assertNotIn(secret, path.read_text())

    def test_host_identity_is_scrubbed_from_published_evidence(self):
        cleaned = runner.redact("failed at /Users/haitao/secret/path and 192.168.1.44")
        self.assertNotIn("haitao", cleaned)
        self.assertIn("[REDACTED_IP]", cleaned)

    def test_artifacts_and_raw_output_are_owner_only(self):
        runner.store_raw_output(self.state, JOB_ID, "content", ordinal=1)
        raw = runner.raw_output_paths(self.state, JOB_ID)[0]
        self.assertEqual(os.stat(raw).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(raw.parent).st_mode & 0o777, 0o700)


# --- D10: CI actually covers the exact head ---------------------------------

class WorkflowTriggerTests(unittest.TestCase):
    WORKFLOW = HERE.parents[1] / ".github/workflows/ci-quality-gate.yml"

    def text(self):
        return self.WORKFLOW.read_text()

    def test_release_bases_and_test_branches_are_covered(self):
        """PR #25 (test/** head -> release/** base) had no CI from either trigger."""
        body = self.text()
        head, _, _ = body.partition("jobs:")
        self.assertIn("'release/**'", head)
        self.assertIn("'test/**'", head)

    def test_workflow_grants_no_write_access_and_has_no_deploy_step(self):
        self.assertIn("permissions:\n  contents: read", self.text())
        # Scan the executable half only: the header comment legitimately uses
        # the word "deploy" to explain why none is present.
        _, _, steps = self.text().lower().partition("jobs:")
        self.assertTrue(steps)
        for forbidden in ("packages: write", "contents: write", "id-token:", "environment:",
                          "ssh ", "scp ", "pm2 ", "rsync", "deploy"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, steps)


if __name__ == "__main__":
    unittest.main()
