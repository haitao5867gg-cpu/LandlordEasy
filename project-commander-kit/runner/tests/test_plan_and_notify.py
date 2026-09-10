"""PR B acceptance tests: evidence split, owner notification, user status, plans.

Every test here is offline: the "GitHub client" is a fixture that records what
would have been posted, and the iMessage channel is a captured argv.
"""
import importlib.util
import json
import sys
import tempfile
import time
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
PLAN_ID = "9b2c1d7e-4f5a-4b6c-8d7e-0f1a2b3c4d5e"


class PRBTestCase(unittest.TestCase):
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
                                     "python": sys.executable, "osascript": sys.executable},
            enabled_providers=frozenset(runner.WORKERS),
            enabled_profiles=frozenset(runner.PROFILES),
            enabled_quality_gates=frozenset({"none"}),
            quality_gates={"none": ()},
            executable_paths={"kiro": sys.executable, "copilot": sys.executable,
                              "claude": sys.executable},
            evidence_issue=29,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def job_data(self, job_id=JOB_ID, **changes):
        value = {
            "schema": runner.SCHEMA, "job_id": job_id, "repository": "owner/repo",
            "queue_issue": 42, "target_sha": SHA,
            "worktree_id": runner.derive_worktree_id(job_id), "runner_id": "runner-001",
            "worker": "claude", "model": "claude-sonnet-5", "profile": "repo_read",
            "assigned": "ORG-002", "prompt": "Read the assigned specification.",
            "timeout_seconds": 30, "output_limit_bytes": 1024,
            "expected_evidence": "summary", "quality_gate": "none",
        }
        value.update(changes)
        return value

    def job(self, **changes):
        body = "COMMANDER_JOB_V1\n```json\n" + json.dumps(self.job_data(**changes)) + "\n```"
        return runner.Job.from_comment(body, self.config)

    def step(self, step_id, on, **changes):
        value = {"id": step_id, "kind": "job", "target": {"sha": SHA}, "on": on,
                 "worker": "claude", "model": "claude-sonnet-5", "profile": "repo_read",
                 "prompt": "Review {resolved_sha}.", "quality_gate": "none",
                 "timeout_seconds": 30, "output_limit_bytes": 1024,
                 "expected_evidence": "summary"}
        value.update(changes)
        return value

    def plan_body(self, steps, plan_id=PLAN_ID, **changes):
        data = {"schema": runner.PLAN_SCHEMA, "plan_id": plan_id, "repository": "owner/repo",
                "queue_issue": 42, "runner_id": "runner-001",
                "authorization_ref": "owner approval 2026-09-10", "max_steps": 4,
                "steps": steps}
        data.update(changes)
        return "COMMANDER_PLAN_V1\n```json\n" + json.dumps(data) + "\n```"

    def client(self, comments):
        """Records posts per issue; supports patch and single-comment lookup."""
        posts = {"terminal": [], "queue": [], "patched": []}
        outer = self

        class FixtureClient:
            def __init__(self, config):
                self.config = config
                self.gone = set()

            def verify_login(self):
                pass

            def comments(self, page, since=None, issue=None):
                return comments if page == 1 and issue is None else []

            def comment(self, cid, page=0, issue=None):
                if str(cid) in self.gone:
                    raise runner.RunnerError("gone")
                for c in comments:
                    if str(c["id"]) == str(cid):
                        return c
                return {"id": cid, "user": {"login": "executor"}, "body": "status"}

            def find_comment(self, cid, max_page=0):
                return self.comment(cid)

            def post(self, body):
                posts["terminal"].append(runner.ensure_safe_post(body))
                return str(1000 + len(posts["terminal"]))

            def post_queue(self, body):
                posts["queue"].append(body)
                return str(3000 + len(posts["queue"]))

            def patch_comment(self, cid, body):
                if str(cid) in self.gone:
                    raise runner.RunnerError("gone")
                posts["patched"].append((cid, body))

            def post_wake(self, body):
                raise AssertionError("no wake in these tests")

        FixtureClient.outer = outer
        return FixtureClient, posts

    def stub_provider(self, verdict=None, status="ok"):
        """A provider whose output is a contract-shaped envelope echoing the nonce."""
        def fake(job, config, worktree, *args, **kwargs):
            raise AssertionError("unused")
        return fake


def ok_output(nonce, verdict=None):
    inner = {"status": "ok", "summary": "done", "evidence": ["checked"], "nonce": nonce}
    if verdict:
        inner["verdict"] = {"verdict": verdict, "p0": 0, "p1": 0, "code_changed": False,
                            "exact_sha_verified": SHA, "recommended_transition": "stop"}
    return json.dumps({"type": "result", "subtype": "success", "is_error": False,
                       "result": "```json\n" + json.dumps(inner) + "\n```"})


class EvidenceSplitTests(PRBTestCase):
    def test_terminal_issue_is_the_evidence_issue_when_configured(self):
        self.assertEqual(self.config.terminal_issue, 29)
        single = runner.dataclasses.replace(self.config, evidence_issue=None)
        self.assertEqual(single.terminal_issue, 42)

    def test_api_allowlist_admits_evidence_and_the_named_patch_only(self):
        client = runner.GitHubClient(self.config)
        seen = []

        def fake_execute(argv, **kwargs):
            seen.append(argv)
            return runner.Result(0, '{"id": 7}', False, False, 0.0)
        with mock.patch.object(runner, "execute", side_effect=fake_execute):
            client._api("GET", "repos/owner/repo/issues/29")
            client._api("POST", "repos/owner/repo/issues/29/comments", {"body": "x"})
            client._api("GET", f"repos/owner/repo/issues/29/comments?per_page={runner.QUEUE_PAGE_SIZE}&page=1")
            client._api("PATCH", "repos/owner/repo/issues/comments/555", {"body": "x"}, patch_comment="555")
            with self.assertRaises(runner.ValidationError):
                client._api("PATCH", "repos/owner/repo/issues/comments/556", {"body": "x"}, patch_comment="555")
            with self.assertRaises(runner.ValidationError):
                client._api("PATCH", "repos/owner/repo/issues/comments/555", {"body": "x"})
            with self.assertRaises(runner.ValidationError):
                client._api("DELETE", "repos/owner/repo/issues/comments/555")
            with self.assertRaises(runner.ValidationError):
                client._api("POST", "repos/owner/repo/issues/30/comments", {"body": "x"})
            with self.assertRaises(runner.ValidationError):
                client._api("GET", "repos/owner/repo/issues/30")
        self.assertEqual(len(seen), 4)

    def test_executor_records_are_posted_to_the_evidence_issue(self):
        client = runner.GitHubClient(self.config)
        endpoints = []

        def fake_execute(argv, **kwargs):
            endpoints.append(argv[4])
            return runner.Result(0, '{"id": 7}', False, False, 0.0)
        with mock.patch.object(runner, "execute", side_effect=fake_execute):
            client.post("COMMANDER_RUNNER_V1 COMPLETED\njob=x")
            client.post_queue("noise")
        self.assertEqual(endpoints, ["repos/owner/repo/issues/29/comments",
                                     "repos/owner/repo/issues/42/comments"])

    def test_config_rejects_evidence_issue_equal_to_queue_or_wake(self):
        for bad in ({"evidence_issue": 17}, {"evidence_issue": 22, "wake_pull_request": 22}):
            with self.subTest(bad=bad):
                self.assertFalse(self._loads(bad))

    def _loads(self, extra):
        example = json.loads((HERE / "config.example.json").read_text())
        example.update(extra)
        path = Path(self.tmp.name) / "config.json"
        path.write_text(json.dumps(example))
        path.chmod(0o600)
        try:
            runner.Config.load(path)
            return True
        except runner.ValidationError:
            return False

    def test_a_pre_split_pending_record_still_lands_on_the_queue_issue(self):
        # A terminal queued under the single-issue layout names issue 42; after
        # evidence_issue=29 is configured it must still be delivered there.
        single = runner.dataclasses.replace(self.config, evidence_issue=None)
        state = runner.State(self.state)
        try:
            state.claim("1", JOB_ID, "h" * 64)
            state.set_status("1", "running")
            state.queue_terminal("1", JOB_ID, "COMMANDER_RUNNER_V1 COMPLETED\njob=" + JOB_ID,
                                 "succeeded", "COMPLETED", single)
            Client, posts = self.client([])
            self.assertTrue(runner.drain_terminal_outbox(Client(self.config), state, self.config))
        finally:
            state.close()
        self.assertEqual(len(posts["queue"]), 1)
        self.assertEqual(posts["terminal"], [])

    def test_terminal_history_scan_covers_the_evidence_issue(self):
        terminal = {"id": 9, "user": {"login": "executor"},
                    "body": "COMMANDER_RUNNER_V1 COMPLETED\njob=" + JOB_ID + "\nx"}

        class Client:
            def __init__(self, config): self.config = config
            def comments(self, page, since=None, issue=None):
                if issue == 29 and page == 1: return [terminal]
                return []
        self.assertTrue(runner.queue_has_terminal_history(Client(self.config), self.config))
        single = runner.dataclasses.replace(self.config, evidence_issue=None)
        self.assertFalse(runner.queue_has_terminal_history(Client(single), single))


class NotifyOutboxTests(PRBTestCase):
    def _complete(self, state, body, job_id=JOB_ID, comment_id="1"):
        state.claim(comment_id, job_id, "h" * 64)
        state.set_status(comment_id, "running")
        state.queue_terminal(comment_id, job_id, body, "blocked" if "FAILED" in body else "succeeded",
                             "FAILED" if "FAILED" in body else "COMPLETED", self.config)
        state.complete_terminal(job_id, "777")

    def test_a_completed_terminal_queues_one_minimal_notification(self):
        state = runner.State(self.state)
        try:
            self._complete(state, "COMMANDER_RUNNER_V1 COMPLETED\njob=" + JOB_ID
                           + "\nevidence=SECRET_EVIDENCE stop_class=NONE")
            pending = state.pending_notifications()
            self.assertEqual(len(pending), 1)
            key, kind, message, attempts = pending[0]
            self.assertEqual((key, kind, attempts), (f"job:{JOB_ID}", "job", 0))
            self.assertNotIn("SECRET_EVIDENCE", message)
            self.assertIn("COMPLETED", message)
            self.assertIn("issues/29#issuecomment-777", message)
            self.assertLessEqual(len(message), runner.NOTIFY_MAX_MESSAGE_CHARS)
            self.assertEqual(state.metadata_value("status_dirty"), "1")
        finally:
            state.close()

    def test_a_fail_closed_terminal_opens_a_user_action_instead_of_a_job_notice(self):
        state = runner.State(self.state)
        try:
            self._complete(state, "COMMANDER_RUNNER_V1 FAILED\njob=" + JOB_ID
                           + "\nevidence=stop_class=HUMAN_APPROVAL_REQUIRED; policy=FAIL_CLOSED")
            keys = [row[0] for row in state.pending_notifications()]
            decision = runner.decision_id_for(JOB_ID)
            self.assertEqual(keys, [f"action:{decision}"])
            actions = state.pending_user_actions()
            self.assertEqual(len(actions), 1)
            self.assertIn("USER_ACTION_REQUIRED_V1", actions[0][1])
            self.assertIn(f"decision={decision}", actions[0][1])
            self.assertIn("COMMANDER_ACK_V1", actions[0][1])
            self.assertEqual(len(state.open_user_actions()), 1)
        finally:
            state.close()

    def test_disabled_channel_settles_rows_without_sending(self):
        state = runner.State(self.state)
        try:
            state.enqueue_notification("test:1", "test", "hello")
            with mock.patch.object(runner, "send_imessage", side_effect=AssertionError("must not send")):
                self.assertTrue(runner.drain_notify_outbox(state, self.config))
            self.assertEqual(state.pending_notifications(), ())
            row = state.db.execute("SELECT outcome FROM notify_outbox WHERE key='test:1'").fetchone()
            self.assertEqual(row[0], "disabled")
        finally:
            state.close()

    def test_failed_sends_retry_then_give_up_after_the_bound(self):
        config = runner.dataclasses.replace(self.config, notify_channel="imessage",
                                            notify_recipient="+8613800000000", notify_enabled=True)
        state = runner.State(self.state)
        try:
            state.enqueue_notification("test:1", "test", "hello")
            with mock.patch.object(runner, "send_imessage", side_effect=runner.RunnerError("down")):
                for _ in range(runner.NOTIFY_MAX_ATTEMPTS - 1):
                    self.assertFalse(runner.drain_notify_outbox(state, config))
                    self.assertEqual(len(state.pending_notifications()), 1)
                self.assertFalse(runner.drain_notify_outbox(state, config))
            self.assertEqual(state.pending_notifications(), ())
            row = state.db.execute("SELECT outcome, attempts FROM notify_outbox WHERE key='test:1'").fetchone()
            self.assertEqual(row[0], "gave_up")
            self.assertEqual(row[1], runner.NOTIFY_MAX_ATTEMPTS)
        finally:
            state.close()

    def test_successful_send_settles_as_sent(self):
        config = runner.dataclasses.replace(self.config, notify_channel="imessage",
                                            notify_recipient="+8613800000000", notify_enabled=True)
        state = runner.State(self.state)
        try:
            state.enqueue_notification("test:1", "test", "hello")
            with mock.patch.object(runner, "send_imessage") as send:
                self.assertTrue(runner.drain_notify_outbox(state, config))
            send.assert_called_once()
            row = state.db.execute("SELECT outcome FROM notify_outbox WHERE key='test:1'").fetchone()
            self.assertEqual(row[0], "sent")
        finally:
            state.close()

    def test_imessage_argv_is_the_fixed_script_plus_recipient_and_text(self):
        config = runner.dataclasses.replace(self.config, notify_channel="imessage",
                                            notify_recipient="+8613800000000", notify_enabled=True)
        seen = []

        def fake_execute(argv, **kwargs):
            seen.append(argv)
            return runner.Result(0, "", False, False, 0.0)
        with mock.patch.object(runner, "execute", side_effect=fake_execute):
            runner.send_imessage(config, "[Commander] COMPLETED 123e4567 link")
        argv = seen[0]
        self.assertEqual(argv[0], sys.executable)
        script_lines = [argv[i + 1] for i, part in enumerate(argv) if part == "-e"]
        self.assertEqual(tuple(script_lines), runner.IMESSAGE_SCRIPT)
        self.assertEqual(argv[-2:], ["+8613800000000", "[Commander] COMPLETED 123e4567 link"])
        self.assertTrue(all("+8613800000000" not in line for line in script_lines))

    def test_imessage_refuses_option_shaped_text_and_bad_recipients(self):
        config = runner.dataclasses.replace(self.config, notify_channel="imessage",
                                            notify_recipient="+8613800000000", notify_enabled=True)
        with mock.patch.object(runner, "execute", side_effect=AssertionError("must not run")):
            with self.assertRaises(runner.ValidationError):
                runner.send_imessage(config, "-e something")
            bad = runner.dataclasses.replace(config, notify_recipient="not a handle; rm -rf")
            with self.assertRaises(runner.ValidationError):
                runner.send_imessage(bad, "hello")

    def test_notify_config_requires_channel_recipient_and_osascript(self):
        example = json.loads((HERE / "config.example.json").read_text())
        path = Path(self.tmp.name) / "config.json"

        def loads(extra):
            data = dict(example); data.update(extra)
            path.write_text(json.dumps(data)); path.chmod(0o600)
            try:
                runner.Config.load(path); return True
            except runner.ValidationError:
                return False
        self.assertFalse(loads({"notify_enabled": True}))
        self.assertFalse(loads({"notify_channel": "imessage"}))  # no osascript executable
        ops = dict(example["operational_executables"]); ops["osascript"] = "/usr/bin/osascript"
        self.assertFalse(loads({"notify_channel": "imessage", "operational_executables": ops,
                                "notify_recipient": "hello world"}))
        self.assertTrue(loads({"notify_channel": "imessage", "operational_executables": ops,
                               "notify_recipient": "+8613800000000", "notify_enabled": True}))
        self.assertTrue(loads({"notify_channel": "imessage", "operational_executables": ops,
                               "notify_recipient": "someone@example.com"}))


class UserStatusTests(PRBTestCase):
    def test_status_is_posted_once_then_patched_in_place(self):
        Client, posts = self.client([])
        client = Client(self.config)
        state = runner.State(self.state)
        try:
            self.assertTrue(runner.refresh_user_status(client, state, self.config))
            first_id = state.metadata_value("status_comment_id")
            self.assertEqual(len(posts["terminal"]), 1)
            self.assertTrue(posts["terminal"][0].startswith("CURRENT_USER_STATUS\n"))
            # Nothing changed and the heartbeat is fresh: no write at all.
            self.assertFalse(runner.refresh_user_status(client, state, self.config))
            state.set_metadata("status_dirty", "1")
            self.assertTrue(runner.refresh_user_status(client, state, self.config))
            self.assertEqual(len(posts["terminal"]), 1)
            self.assertEqual(posts["patched"][0][0], first_id)
            self.assertIn("open_action_required=[]", posts["patched"][0][1])
            self.assertIn("heartbeat_interval_seconds=", posts["patched"][0][1])
        finally:
            state.close()

    def test_a_stale_heartbeat_rewrites_even_when_idle(self):
        Client, posts = self.client([])
        client = Client(self.config)
        state = runner.State(self.state)
        try:
            runner.refresh_user_status(client, state, self.config)
            state.set_metadata("status_refreshed_at",
                               str(int(time.time()) - runner.STATUS_HEARTBEAT_SECONDS - 1))
            self.assertTrue(runner.refresh_user_status(client, state, self.config))
            self.assertEqual(len(posts["patched"]), 1)
        finally:
            state.close()

    def test_patch_failure_only_reposts_when_the_comment_is_gone(self):
        Client, posts = self.client([])
        client = Client(self.config)
        state = runner.State(self.state)
        try:
            runner.refresh_user_status(client, state, self.config)
            first_id = state.metadata_value("status_comment_id")
            with mock.patch.object(client, "patch_comment", side_effect=runner.RunnerError("flaky")):
                self.assertFalse(runner.refresh_user_status(client, state, self.config, force=True))
            self.assertEqual(len(posts["terminal"]), 1)   # still exists: no duplicate
            client.gone.add(first_id)
            self.assertTrue(runner.refresh_user_status(client, state, self.config, force=True))
            self.assertEqual(len(posts["terminal"]), 2)
            self.assertNotEqual(state.metadata_value("status_comment_id"), first_id)
        finally:
            state.close()

    def test_without_an_evidence_issue_no_status_comment_exists(self):
        single = runner.dataclasses.replace(self.config, evidence_issue=None)
        Client, posts = self.client([])
        state = runner.State(self.state)
        try:
            self.assertFalse(runner.refresh_user_status(Client(single), state, single, force=True))
        finally:
            state.close()
        self.assertEqual(posts["terminal"], [])

    def test_commander_ack_resolves_the_open_decision_and_posts_nothing(self):
        decision = runner.decision_id_for(JOB_ID)
        state = runner.State(self.state)
        try:
            state.db.execute(
                "INSERT INTO user_actions(decision_id,job_id,stop_class,body,created_at,posted_comment_id) "
                "VALUES (?,?,?,?,?,?)", (decision, JOB_ID, "SAFETY_STOP", "x", 1, "5"))
        finally:
            state.close()
        Client, posts = self.client([{"id": 8, "user": {"login": "commander"},
                                      "body": f"COMMANDER_ACK_V1\ndecision={decision}"}])
        with mock.patch.object(runner, "GitHubClient", Client):
            self.assertEqual(runner.run_once(self.config), "NO_JOB")
        state = runner.State(self.state)
        try:
            self.assertEqual(state.open_user_actions(), ())
            self.assertEqual(state.comment_high_water(), 8)
        finally:
            state.close()
        self.assertFalse(any("ACK" in p for p in posts["terminal"]))


class PlanParsingTests(PRBTestCase):
    def test_a_well_formed_two_step_plan_parses_and_derives_real_jobs(self):
        plan = runner.Plan.from_comment(self.plan_body([
            self.step("s1", {"ok": "s2", "*": "stop"}),
            self.step("s2", {"*": "stop"}, target={"from_step": "s1"}),
        ]), self.config)
        self.assertEqual([s.step_id for s in plan.steps], ["s1", "s2"])
        job, body = runner.derive_step_job(PLAN_ID, "owner/repo", 42, "runner-001",
                                           plan.steps[1], self.config, SHA)
        self.assertEqual(job.job_id, runner.step_job_id(PLAN_ID, "s2"))
        self.assertEqual(job.prompt, f"Review {SHA}.")
        self.assertEqual(job.assigned, f"plan:{PLAN_ID}:s2")

    def test_edges_may_only_point_forward_or_stop(self):
        for on in ({"*": "s1"}, {"*": "stop", "ok": "s0"}, {"*": "stop", "ok": "nowhere"}):
            with self.subTest(on=on), self.assertRaises(runner.ValidationError):
                runner.Plan.from_comment(self.plan_body([self.step("s1", on)]), self.config)

    def test_unknown_edge_keys_and_missing_default_are_rejected(self):
        with self.assertRaises(runner.ValidationError):
            runner.Plan.from_comment(self.plan_body([self.step("s1", {"ok": "stop"})]), self.config)
        with self.assertRaises(runner.ValidationError):
            runner.Plan.from_comment(
                self.plan_body([self.step("s1", {"*": "stop", "looks_fine": "stop"})]), self.config)

    def test_step_budget_and_identity_are_enforced(self):
        too_many = [self.step(f"s{i}", {"*": "stop"}) for i in range(1, 12)]
        with self.assertRaises(runner.ValidationError):
            runner.Plan.from_comment(self.plan_body(too_many, max_steps=11), self.config)
        with self.assertRaises(runner.ValidationError):
            runner.Plan.from_comment(self.plan_body([self.step("s1", {"*": "stop"})],
                                                    runner_id="other"), self.config)
        with self.assertRaises(runner.ValidationError):
            runner.Plan.from_comment(self.plan_body([self.step("s1", {"*": "stop"}),
                                                     self.step("s1", {"*": "stop"})]), self.config)

    def test_a_malformed_step_is_rejected_at_parse_time_with_the_job_rule(self):
        with self.assertRaises(runner.ValidationError) as ctx:
            runner.Plan.from_comment(self.plan_body([self.step("s1", {"*": "stop"}, profile="bogus")]),
                                     self.config)
        self.assertIn("profile", str(ctx.exception))

    def test_from_step_must_name_an_earlier_step(self):
        with self.assertRaises(runner.ValidationError):
            runner.Plan.from_comment(self.plan_body([
                self.step("s1", {"*": "stop"}, target={"from_step": "s2"}),
                self.step("s2", {"*": "stop"})]), self.config)

    def test_a_malformed_plan_addressed_here_is_rejected_not_skipped(self):
        body = self.plan_body([self.step("s1", {"ok": "stop"})])
        envelope = runner.envelope_for_rejection(body, self.config)
        self.assertIsNotNone(envelope)
        self.assertEqual((envelope.job_id, envelope.schema), (PLAN_ID, runner.PLAN_SCHEMA))
        Client, posts = self.client([{"id": 3, "user": {"login": "commander"}, "body": body}])
        with mock.patch.object(runner, "GitHubClient", Client):
            self.assertEqual(runner.run_once(self.config), f"REJECTED {PLAN_ID}")
        self.assertTrue(any("REJECTED" in p and PLAN_ID in p for p in posts["terminal"]))


class PlanExecutionTests(PRBTestCase):
    """Drives run_once with a fake provider so real claim/terminal machinery is exercised."""

    def _provider(self, outcomes):
        """outcomes: dict step_id -> ('ok', verdict) | ('fail', category)."""
        def fake(job, config, worktree, *args, **kwargs):
            kind, value = outcomes[job.assigned.rsplit(":", 1)[1]]
            nonce = runner.attempt_id_for(job.job_id, 1)
            if kind == "ok":
                output = runner.normalize_provider_output(ok_output(nonce, value), nonce)
                attempt = runner.ProviderAttempt(job.worker, job.model,
                                                 runner.Result(0, "", False, False, 0.1), output, None)
            else:
                attempt = runner.ProviderAttempt(job.worker, job.model,
                                                 runner.Result(1, "boom", False, False, 0.1), None, value)
            return attempt, [attempt]
        return fake

    def _run(self, comments, outcomes):
        Client, posts = self.client(comments)
        with mock.patch.object(runner, "GitHubClient", Client), \
             mock.patch.object(runner, "prepare_worktree", return_value=self.worktrees), \
             mock.patch.object(runner, "execute_with_failover", side_effect=self._provider(outcomes)):
            return runner.run_once(self.config), posts

    def test_a_two_step_plan_runs_unattended_and_reports_once(self):
        body = self.plan_body([
            self.step("s1", {"ok": "s2", "*": "stop"}),
            self.step("s2", {"verdict.accept": "stop", "*": "stop"}, target={"from_step": "s1"}),
        ])
        outcome, posts = self._run([{"id": 5, "user": {"login": "commander"}, "body": body}],
                                   {"s1": ("ok", None), "s2": ("ok", "accept")})
        self.assertEqual(outcome, f"PLAN_COMPLETED {PLAN_ID}")
        terminals = [p for p in posts["terminal"] if "COMPLETED" in p and "CLAIMED" not in p]
        self.assertEqual(len(terminals), 3)   # s1, s2, and the plan itself
        plan_terminal = [p for p in terminals if p.startswith("COMMANDER_PLAN_RUNNER_V1")]
        self.assertEqual(len(plan_terminal), 1)
        self.assertIn("steps=s1:ok,s2:verdict.accept", plan_terminal[0])
        self.assertIn("USER_UPDATE_V1", plan_terminal[0])
        self.assertIn("result=completed", plan_terminal[0])
        self.assertEqual(posts["queue"], [])
        state = runner.State(self.state)
        try:
            keys = [row[0] for row in state.pending_notifications()]
            self.assertEqual(keys, [f"job:{PLAN_ID}"])   # one notice for the plan, none per step
            self.assertEqual(state.plan_summary(), {"completed": 1})
        finally:
            state.close()

    def test_a_code_failure_follows_its_edge_to_stop(self):
        body = self.plan_body([
            self.step("s1", {"ok": "s2", "CODE_FAILURE": "stop", "*": "s2"}),
            self.step("s2", {"*": "stop"}),
        ])
        outcome, posts = self._run([{"id": 5, "user": {"login": "commander"}, "body": body}],
                                   {"s1": ("fail", "RUNTIME"), "s2": ("ok", None)})
        self.assertEqual(outcome, f"PLAN_FAILED {PLAN_ID}")
        plan_terminal = [p for p in posts["terminal"] if p.startswith("COMMANDER_PLAN_RUNNER_V1 FAILED")]
        self.assertEqual(len(plan_terminal), 1)
        self.assertIn("steps=s1:CODE_FAILURE", plan_terminal[0])
        self.assertIn("result=stopped", plan_terminal[0])
        self.assertFalse(any("plan:" in p and "s2" in p and "COMPLETED" in p for p in posts["terminal"]))

    def test_a_fail_closed_class_ignores_the_edge_table(self):
        body = self.plan_body([
            self.step("s1", {"*": "s2", "SAFETY_STOP": "s2"}),
            self.step("s2", {"*": "stop"}),
        ])
        outcome, posts = self._run([{"id": 5, "user": {"login": "commander"}, "body": body}],
                                   {"s1": ("fail", "PERMISSION"), "s2": ("ok", None)})
        self.assertEqual(outcome, f"PLAN_FAILED {PLAN_ID}")
        plan_terminal = [p for p in posts["terminal"] if p.startswith("COMMANDER_PLAN_RUNNER_V1 FAILED")]
        self.assertIn("action_required=true", plan_terminal[0])
        actions = [p for p in posts["terminal"] if p.startswith("USER_ACTION_REQUIRED_V1")]
        self.assertEqual(len(actions), 1)
        self.assertIn(f"plan={PLAN_ID}", actions[0])
        state = runner.State(self.state)
        try:
            self.assertEqual(len(state.open_user_actions()), 1)
            self.assertEqual(state.plan_summary(), {"action_required": 1})
        finally:
            state.close()

    def test_a_replayed_plan_comment_does_not_run_again(self):
        body = self.plan_body([self.step("s1", {"*": "stop"})])
        comments = [{"id": 5, "user": {"login": "commander"}, "body": body}]
        self._run(comments, {"s1": ("ok", None)})
        outcome, posts = self._run(comments, {"s1": ("ok", None)})
        self.assertEqual(outcome, "NO_JOB")
        self.assertEqual(posts["terminal"], [])

    def test_a_crash_between_steps_resumes_from_the_next_step(self):
        body = self.plan_body([
            self.step("s1", {"ok": "s2", "*": "stop"}),
            self.step("s2", {"*": "stop"}),
        ])
        comments = [{"id": 5, "user": {"login": "commander"}, "body": body}]
        # Simulate the crash: s1 completes, then the process dies before s2 is
        # touched.  We reproduce that state by stopping the executor after s1.
        calls = []

        def crash_after_first(job, config, worktree, *args, **kwargs):
            calls.append(job.assigned)
            if len(calls) == 1:
                nonce = runner.attempt_id_for(job.job_id, 1)
                output = runner.normalize_provider_output(ok_output(nonce), nonce)
                attempt = runner.ProviderAttempt(job.worker, job.model,
                                                 runner.Result(0, "", False, False, 0.1), output, None)
                return attempt, [attempt]
            raise KeyboardInterrupt  # process death mid-step-2
        Client, posts = self.client(comments)
        with mock.patch.object(runner, "GitHubClient", Client), \
             mock.patch.object(runner, "prepare_worktree", return_value=self.worktrees), \
             mock.patch.object(runner, "execute_with_failover", side_effect=crash_after_first):
            with self.assertRaises(KeyboardInterrupt):
                runner.run_once(self.config)
        # Restart: s2's claim is incomplete -> honest FAILED for s2; s1 is NOT re-run;
        # the plan follows s2's `*` edge to stop.
        outcome, posts2 = self._run(comments, {"s1": ("ok", None), "s2": ("ok", None)})
        self.assertEqual(outcome, f"PLAN_FAILED {PLAN_ID}")
        self.assertEqual(calls, [f"plan:{PLAN_ID}:s1", f"plan:{PLAN_ID}:s2"])
        plan_terminal = [p for p in posts2["terminal"] if p.startswith("COMMANDER_PLAN_RUNNER_V1")]
        self.assertIn("steps=s1:ok,s2:UNCLASSIFIED_FAILURE", plan_terminal[0])

    def test_the_plan_terminal_is_recognised_by_history_rebuild(self):
        body = self.plan_body([self.step("s1", {"*": "stop"})])
        comments = [{"id": 5, "user": {"login": "commander"}, "body": body}]
        _, posts = self._run(comments, {"s1": ("ok", None)})
        plan_terminal = [p for p in posts["terminal"] if p.startswith("COMMANDER_PLAN_RUNNER_V1 COMPLETED")]
        record = {"id": 9, "user": {"login": "executor"}, "body": plan_terminal[0]}
        self.assertEqual(runner.executor_terminal(record, self.config), ("COMPLETED", PLAN_ID))
        self.assertEqual(runner.commander_job_identity(comments[0], self.config), PLAN_ID)



class BlockedOperationClassificationTests(PRBTestCase):
    """Live plan canary 2026-09-10: ops001 reported category=container_identity_mismatch
    but the terminal said stop_class=NONE and the plan degraded to UNCLASSIFIED_FAILURE."""

    def test_blocked_categories_map_onto_the_stop_taxonomy(self):
        blocked = runner.NormalizedOutput("blocked", "OPS-001 probe blocked",
                                          ("category=container_identity_mismatch",))
        self.assertEqual(runner.operation_block_stop_class(blocked), "ENVIRONMENT_FAILURE")
        safety = runner.NormalizedOutput("blocked", "x", ("category=mutation_command_rejected",))
        self.assertEqual(runner.operation_block_stop_class(safety), "SAFETY_STOP")
        unknown = runner.NormalizedOutput("blocked", "x", ("category=never_heard_of_it",))
        self.assertEqual(runner.operation_block_stop_class(unknown), "UNCLASSIFIED_FAILURE")
        ok = runner.NormalizedOutput("ok", "fine", ())
        self.assertIsNone(runner.operation_block_stop_class(ok))
        self.assertTrue(set(runner.OPERATION_BLOCK_STOP_CLASS.values()) <= runner.STOP_CLASSES)

    def test_a_blocked_operation_terminal_carries_the_mapped_class(self):
        definition = runner.OperationDefinition(
            argv=(sys.executable, "-c", "print('x')"), mode="read_only",
            allowed_target_shas=frozenset({SHA}), max_timeout_seconds=60,
            max_output_bytes=4096, require_clean_worktree=False, description="probe")
        config = runner.dataclasses.replace(
            self.config, enabled_operations=frozenset({"ops001_mysql_probe"}),
            operation_definitions={"ops001_mysql_probe": definition})
        data = {"schema": runner.OPERATION_SCHEMA, "job_id": JOB_ID, "repository": "owner/repo",
                "queue_issue": 42, "target_sha": SHA, "worktree_id": runner.derive_worktree_id(JOB_ID),
                "runner_id": "runner-001", "operation_id": "ops001_mysql_probe",
                "timeout_seconds": 30, "output_limit_bytes": 4096,
                "expected_evidence": "probe", "human_approval_ref": "owner"}
        body = "COMMANDER_OPERATION_V1\n```json\n" + json.dumps(data) + "\n```"
        blocked = runner.OperationAttempt(
            runner.Result(0, "{}", False, False, 1.0),
            runner.NormalizedOutput("blocked", "OPS-001 probe blocked",
                                    ("category=container_identity_mismatch",)), None)
        Client, posts = self.client([{"id": 5, "user": {"login": "commander"}, "body": body}])
        with mock.patch.object(runner, "GitHubClient", Client), \
             mock.patch.object(runner, "prepare_worktree", return_value=self.worktrees), \
             mock.patch.object(runner, "execute_operation", return_value=blocked):
            outcome = runner.run_once(config)
        self.assertEqual(outcome, f"FAILED {JOB_ID}")
        terminal = [p for p in posts["terminal"] if p.startswith("COMMANDER_OPERATION_RUNNER_V1 FAILED")]
        self.assertEqual(len(terminal), 1)
        self.assertIn("stop_class=ENVIRONMENT_FAILURE", terminal[0])
        self.assertIn("policy=BOUNDED_RETRY", terminal[0])
        self.assertNotIn("stop_class=NONE", terminal[0])
        state = runner.State(self.state)
        try:
            self.assertEqual(state.latest_attempt(JOB_ID)[5], "ENVIRONMENT_FAILURE")
        finally:
            state.close()


class BranchPrefixBindingTests(PRBTestCase):
    """Dispatching rel001 from the front door needs bindings that survive new branches."""

    def _definition(self, branches):
        return runner.OperationDefinition(
            argv=(sys.executable, "-c", "print('x')", "--docker", "/usr/bin/docker"),
            mode="isolated_test", allowed_target_shas=frozenset(),
            max_timeout_seconds=60, max_output_bytes=4096, require_clean_worktree=True,
            description="suite", allowed_target_branches=frozenset(branches))

    def test_prefix_patterns_are_accepted_and_protected_ones_refused(self):
        self.assertEqual(runner.validate_operation_branches(["fix/*", "job-*", "feat/x"]),
                         frozenset({"fix/*", "job-*", "feat/x"}))
        for bad in (["*"], ["dev*"], ["release/*"], ["main"], ["fix/*/x"], ["d*"]):
            with self.subTest(bad=bad), self.assertRaises(runner.ValidationError):
                runner.validate_operation_branches(bad)

    def test_branch_is_bound_never_covers_protected_branches(self):
        allowed = frozenset({"fix/*", "feat/x"})
        self.assertTrue(runner.branch_is_bound("fix/rel001-cross-type-approval", allowed))
        self.assertTrue(runner.branch_is_bound("feat/x", allowed))
        self.assertFalse(runner.branch_is_bound("feat/y", allowed))
        self.assertFalse(runner.branch_is_bound("dev", frozenset({"d*"})))
        self.assertFalse(runner.branch_is_bound("release/v1", frozenset({"rel*"})))

    def test_prefix_binding_resolves_through_ls_remote_and_pins_the_exact_head(self):
        config = runner.dataclasses.replace(
            self.config, enabled_operations=frozenset({"rel001_mysql_suite"}),
            operation_definitions={"rel001_mysql_suite": self._definition({"fix/*"})})
        head = "b" * 40
        job = runner.OperationJob(
            job_id=JOB_ID, repository="owner/repo", queue_issue=42, target_sha=head,
            worktree_id=runner.derive_worktree_id(JOB_ID), runner_id="runner-001",
            operation_id="rel001_mysql_suite", timeout_seconds=60, output_limit_bytes=1024,
            expected_evidence="suite", human_approval_ref="owner")
        listing = f"{'a' * 40}\trefs/heads/fix/other\n{head}\trefs/heads/fix/rel001\n"
        calls = []

        def fake_git(argv, cwd, **kwargs):
            calls.append(argv[0])
            return listing
        with mock.patch.object(runner, "git_checked", side_effect=fake_git):
            self.assertEqual(runner.resolve_operation_binding(config, job), "branch_head:fix/rel001")
        self.assertEqual(calls, ["ls-remote"])
        drifted = runner.dataclasses.replace(job, target_sha="c" * 40)
        with mock.patch.object(runner, "git_checked", side_effect=fake_git), \
             self.assertRaises(runner.ValidationError):
            runner.resolve_operation_binding(config, drifted)

    def test_isolated_test_receives_the_authorized_sha_as_candidate(self):
        config = runner.dataclasses.replace(
            self.config, enabled_operations=frozenset({"rel001_mysql_suite"}),
            operation_definitions={"rel001_mysql_suite": self._definition({"fix/*"})})
        job = runner.OperationJob(
            job_id=JOB_ID, repository="owner/repo", queue_issue=42, target_sha=SHA,
            worktree_id=runner.derive_worktree_id(JOB_ID), runner_id="runner-001",
            operation_id="rel001_mysql_suite", timeout_seconds=60, output_limit_bytes=1024,
            expected_evidence="suite", human_approval_ref="owner")
        seen = []

        def fake_execute(argv, **kwargs):
            seen.append(list(argv))
            return runner.Result(0, json.dumps({"status": "ok", "summary": "fine", "evidence": []}),
                                 False, False, 0.1)
        with mock.patch.object(runner, "worktree_is_clean", return_value=True), \
             mock.patch.object(runner, "execute", side_effect=fake_execute):
            attempt = runner.execute_operation(job, config, self.worktrees)
        self.assertIsNone(attempt.error_category)
        self.assertEqual(seen[0][-2:], ["--candidate-sha", SHA])

if __name__ == "__main__":
    unittest.main()
