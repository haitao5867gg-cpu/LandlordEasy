#!/usr/bin/env python3
"""Offline end-to-end canary for the Commander Runner.

Exercises the real `run_once` loop against a real git repository, a real
isolated worktree, a stub provider CLI and a stub `gh`.  Nothing here touches
the network, GitHub, Docker, a database, production, or any real credential:
the "GitHub API" is a local Python script that reads and appends to a JSON file.

Run:  python3 tools/commander-runner/tests/canary_end_to_end.py
Exit: 0 on success, 1 on failure.  Prints one JSON report.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("commander_runner", HERE / "commander_runner.py")
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
spec.loader.exec_module(runner)

GIT = "/usr/bin/git"
COMMANDER = "canary-commander"
EXECUTOR = "canary-executor"
RUNNER_ID = "canary-runner-01"

# A stub provider that returns a contract-shaped report whose summary is far
# larger than the old 2000-character limit, wrapped in a Claude-style envelope.
PROVIDER = '''#!/usr/bin/env python3
import json, re, sys
# A real provider reads the nonce from the prompt and echoes it; so does this stub.
prompt = " ".join(sys.argv[1:])
match = re.search(r"nonce must be exactly the string ([0-9a-f-]{36})", prompt)
summary = "CANARY " * 2000
inner = json.dumps({"status": "ok", "summary": summary,
                    "evidence": ["read spec", "checked head"],
                    "nonce": match.group(1) if match else "missing"})
print(json.dumps({"type": "result", "subtype": "success", "is_error": False,
                  "total_cost_usd": 0.42,
                  "result": "Done.\\n\\n```json\\n" + inner + "\\n```"}))
'''

# A stub provider that emits prose only: a PROTOCOL_FAILURE, recoverable
# locally because the raw bytes are persisted before parsing.
PROSE_PROVIDER = '''#!/usr/bin/env python3
print("I reviewed everything and it all looks fine, but in prose.")
'''

# A stub `gh` implementing exactly the two calls the runner makes.  The store
# path is baked in at generation time rather than passed through the
# environment, because `safe_environment()` correctly strips unknown variables.
GH = '''#!/usr/bin/env python3
import json, os, re, sys
store = "__STORE__"
argv = sys.argv[1:]
if argv[:2] == ["api", "user"]:
    print(json.dumps({"login": "%s"})); raise SystemExit(0)
method = argv[argv.index("--method") + 1]
endpoint = argv[argv.index("--method") + 2]
state = json.load(open(store))
if method == "GET":
    if endpoint.endswith("/issues/43"):
        print(json.dumps({"number": 43, "state": "open"})); raise SystemExit(0)
    if "/issues/comments/" in endpoint:
        # single-comment lookup; posted comments belong to the issue they were posted on
        wanted = endpoint.rsplit("/", 1)[1]
        for c in state["comments"]:
            if str(c["id"]) == wanted:
                c = dict(c); c.setdefault("issue_url", "https://api.github.com/repos/canary/repo/issues/42")
                print(json.dumps(c)); raise SystemExit(0)
        for index, p in enumerate(state["posts"]):
            if str(9000 + index + 1) == wanted and p["endpoint"].endswith("/comments"):
                issue = p["endpoint"].rsplit("/", 2)[1]
                print(json.dumps({"id": int(wanted), "user": {"login": "%s"}, "body": p["body"],
                                  "issue_url": "https://api.github.com/repos/canary/repo/issues/" + issue}))
                raise SystemExit(0)
        print("{}"); raise SystemExit(1)
    if "/issues/43/comments" in endpoint:
        print("[]"); raise SystemExit(0)
    page = 1
    m = re.search(r"[?&]page=(\d+)", endpoint)
    if m:
        page = int(m.group(1))
    print(json.dumps(state["comments"] if page == 1 else []))
    raise SystemExit(0)
body = ""
for index, part in enumerate(argv):
    if part == "-f" and argv[index + 1].startswith("body="):
        body = argv[index + 1][5:]
state["posts"].append({"endpoint": endpoint, "body": body})
new_id = 9000 + len(state["posts"])
json.dump(state, open(store, "w"))
print(json.dumps({"id": new_id}))
''' % (EXECUTOR, EXECUTOR)


OSASCRIPT = '''#!/usr/bin/env python3
import json, sys
argv = sys.argv[1:]
if argv[:2] == ["-e", "return 1"]:
    print("1"); raise SystemExit(0)
with open("__SENT__", "a") as handle:
    handle.write(json.dumps(argv) + "\\n")
'''


def write_exec(path: Path, content: str) -> Path:
    path.write_text(content)
    os.chmod(path, 0o700)
    return path


def git(*args: str, cwd: Path) -> str:
    result = subprocess.run([GIT, *args], cwd=cwd, capture_output=True, text=True,
                            env={"HOME": str(cwd), "PATH": "/usr/bin:/bin",
                                 "GIT_AUTHOR_NAME": "canary", "GIT_AUTHOR_EMAIL": "c@example.invalid",
                                 "GIT_COMMITTER_NAME": "canary",
                                 "GIT_COMMITTER_EMAIL": "c@example.invalid"})
    if result.returncode:
        raise SystemExit(f"git {' '.join(args)} failed: {result.stderr}")
    return result.stdout.strip()


def build_repo(root: Path) -> tuple[Path, str]:
    origin = root / "origin.git"
    work = root / "seed"
    work.mkdir()
    git("init", "-q", "-b", "main", ".", cwd=work)
    (work / "README.md").write_text("canary\n")
    git("add", "-A", cwd=work)
    git("commit", "-q", "-m", "seed", cwd=work)
    git("clone", "-q", "--bare", str(work), str(origin), cwd=root)
    canonical = root / "canonical"
    git("clone", "-q", str(origin), str(canonical), cwd=root)
    return canonical, git("rev-parse", "HEAD", cwd=canonical)


def make_config(root: Path, canonical: Path, gh: Path, provider: Path,
                store: Path, **overrides) -> runner.Config:
    values = dict(
        repository="canary/repo", queue_issue=42, commander_login=COMMANDER,
        executor_login=EXECUTOR, runner_id=RUNNER_ID, canonical_repo=canonical,
        worktree_root=root / "worktrees", state_dir=root / "state",
        origin_url=git("remote", "get-url", "origin", cwd=canonical),
        runtime_dir=root / "runtime",
        operational_executables={"gh": str(gh), "git": GIT, "python": sys.executable},
        enabled_providers=frozenset({"claude"}), enabled_profiles=frozenset({"repo_read"}),
        enabled_quality_gates=frozenset({"none"}), quality_gates={"none": ()},
        executable_paths={"kiro": str(provider), "copilot": str(provider),
                          "claude": str(provider)},
    )
    values.update(overrides)
    return runner.Config(**values)


def job_comment(job_id: str, sha: str, **changes) -> str:
    data = {
        "schema": runner.SCHEMA, "job_id": job_id, "repository": "canary/repo",
        "queue_issue": 42, "target_sha": sha,
        "worktree_id": runner.derive_worktree_id(job_id), "runner_id": RUNNER_ID,
        "worker": "claude", "model": "claude-sonnet-5", "profile": "repo_read",
        "assigned": "CANARY-1",
        # Deliberately punctuation-heavy: this exact shape used to be rejected.
        "prompt": 'Audit head; report findings & return `{"status":"ok"}` | nothing else.',
        "timeout_seconds": 120, "output_limit_bytes": 65536,
        "expected_evidence": "summary; evidence", "quality_gate": "none",
    }
    data.update(changes)
    return "COMMANDER_JOB_V1\n```json\n" + json.dumps(data) + "\n```"


def run(config: runner.Config, store: Path, comments: list[dict]) -> tuple[str, list[dict]]:
    store.write_text(json.dumps({"comments": comments, "posts": []}))
    outcome = runner.run_once(config)
    return outcome, json.loads(store.read_text())["posts"]


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        canonical, sha = build_repo(root)
        (root / "worktrees").mkdir()
        bin_dir = root / "bin"
        bin_dir.mkdir()
        store = root / "store.json"
        gh = write_exec(bin_dir / "gh", GH.replace("__STORE__", str(store)))
        provider = write_exec(bin_dir / "provider", PROVIDER)
        prose = write_exec(bin_dir / "prose", PROSE_PROVIDER)

        # 1. Happy path: punctuation-heavy prompt, oversized report, real worktree.
        config = make_config(root, canonical, gh, provider, store)
        job_id = str(uuid.uuid4())
        outcome, posts = run(config, store,
                             [{"id": 1, "user": {"login": COMMANDER},
                               "body": job_comment(job_id, sha)}])
        check("happy_path_completes", outcome == f"COMPLETED {job_id}", outcome)
        terminal = [p["body"] for p in posts if "COMPLETED" in p["body"]]
        check("terminal_posted", len(terminal) == 1, f"{len(terminal)} terminal posts")
        check("attempt_id_recorded", bool(terminal) and "attempt_id=" in terminal[0])
        check("artifact_referenced", bool(terminal) and "artifact_sha256=" in terminal[0])
        artifacts = list((root / "state" / "artifacts" / job_id).glob("*.md"))
        check("artifact_written", len(artifacts) == 1, str(artifacts))
        if artifacts:
            body = artifacts[0].read_text()
            check("full_report_survived", body.count("CANARY") >= 2000,
                  f"{body.count('CANARY')} occurrences")
        check("worktree_isolated_and_kept",
              (root / "worktrees" / runner.derive_worktree_id(job_id)).is_dir())

        # 2. Exactly-once: replaying the same comment must not re-run the job.
        outcome2, posts2 = run(config, store,
                               [{"id": 1, "user": {"login": COMMANDER},
                                 "body": job_comment(job_id, sha)}])
        check("no_replay_of_terminal_job", outcome2 == "NO_JOB", outcome2)
        check("no_duplicate_post", posts2 == [], str(posts2))

        # 3. Invalid job addressed to this runner -> explicit REJECTED.
        bad_id = str(uuid.uuid4())
        outcome3, posts3 = run(config, store,
                               [{"id": 2, "user": {"login": COMMANDER},
                                 "body": job_comment(bad_id, sha, profile="bogus_profile")}])
        check("invalid_job_rejected", outcome3 == f"REJECTED {bad_id}", outcome3)
        rejected = [p["body"] for p in posts3 if "REJECTED" in p["body"]]
        check("rejection_has_reason_and_class",
              bool(rejected) and "stop_class=" in rejected[0] and "reason=" in rejected[0])

        # 4. Another runner's job is untouched.
        outcome4, posts4 = run(config, store,
                               [{"id": 3, "user": {"login": COMMANDER},
                                 "body": job_comment(str(uuid.uuid4()), sha,
                                                     runner_id="someone-else")}])
        check("foreign_runner_job_untouched", outcome4 == "NO_JOB" and posts4 == [], outcome4)

        # 5. Executor-authored job-shaped comment must never execute.
        outcome5, posts5 = run(config, store,
                               [{"id": 4, "user": {"login": EXECUTOR},
                                 "body": job_comment(str(uuid.uuid4()), sha)}])
        check("executor_authored_job_ignored", outcome5 == "NO_JOB" and posts5 == [], outcome5)

        # 6. SHA drift fails closed.
        outcome6, _ = run(config, store,
                          [{"id": 5, "user": {"login": COMMANDER},
                            "body": job_comment(str(uuid.uuid4()), "b" * 40)}])
        check("sha_drift_fails_closed", outcome6.startswith("FAILED"), outcome6)

        # 7. PROTOCOL_FAILURE is recoverable locally with no provider call.
        prose_config = make_config(
            root, canonical, gh, prose, store,
            executable_paths={"kiro": str(prose), "copilot": str(prose), "claude": str(prose)})
        prose_id = str(uuid.uuid4())
        outcome7, posts7 = run(prose_config, store,
                               [{"id": 6, "user": {"login": COMMANDER},
                                 "body": job_comment(prose_id, sha)}])
        check("unparseable_output_is_protocol_failure", outcome7 == f"FAILED {prose_id}", outcome7)
        failed = [p["body"] for p in posts7 if "FAILED" in p["body"]]
        check("protocol_failure_classified",
              bool(failed) and "stop_class=PROTOCOL_FAILURE" in failed[0])
        check("recovery_hint_published", bool(failed) and "renormalize" in failed[0])
        check("raw_output_persisted", bool(runner.raw_output_paths(root / "state", prose_id)))

        # 8. Credentials never reach the queue, the artifact or the raw store.
        leaked = []
        for path in (root / "state").rglob("*"):
            if path.is_file():
                try:
                    text = path.read_text(errors="replace")
                except OSError:
                    continue
                if "ghp_" in text or "BEGIN RSA PRIVATE KEY" in text:
                    leaked.append(path.name)
        check("no_credentials_in_state", not leaked, str(leaked))

        # 9. Attempt audit chain exists and does not reuse the job UUID.
        state = runner.State(root / "state")
        try:
            rows = state.attempts_for(job_id)
            check("attempt_chain_recorded", len(rows) >= 1, str(rows))
            check("attempt_id_differs_from_job_uuid",
                  all(row[0] != job_id for row in rows))
        finally:
            state.close()

        # 10. PR B: evidence split, plan chain, status comment, owner notification.
        sent = root / "sent.jsonl"
        osascript = write_exec(bin_dir / "osascript", OSASCRIPT.replace("__SENT__", str(sent)))
        prb_root = root / "prb"
        prb_root.mkdir()
        (prb_root / "worktrees").mkdir()
        prb_config = make_config(
            prb_root, canonical, gh, provider, store,
            evidence_issue=43, notify_channel="imessage", notify_recipient="+10000000000",
            notify_enabled=True,
            operational_executables={"gh": str(gh), "git": GIT, "python": sys.executable,
                                     "osascript": str(osascript)})
        plan_id = str(uuid.uuid4())
        step = {"kind": "job", "worker": "claude", "model": "claude-sonnet-5",
                "profile": "repo_read", "quality_gate": "none",
                "prompt": "Review {resolved_sha}; return the contract.",
                "timeout_seconds": 120, "output_limit_bytes": 65536,
                "expected_evidence": "summary; evidence"}
        plan = {"schema": runner.PLAN_SCHEMA, "plan_id": plan_id, "repository": "canary/repo",
                "queue_issue": 42, "runner_id": RUNNER_ID, "authorization_ref": "canary owner",
                "max_steps": 3,
                "steps": [dict(step, id="s1", target={"sha": sha}, on={"ok": "s2", "*": "stop"}),
                          dict(step, id="s2", target={"from_step": "s1"}, on={"*": "stop"})]}
        plan_body = "COMMANDER_PLAN_V1\n```json\n" + json.dumps(plan) + "\n```"
        outcome10, posts10 = run(prb_config, store,
                                 [{"id": 7, "user": {"login": COMMANDER}, "body": plan_body}])
        check("plan_completes_unattended", outcome10 == f"PLAN_COMPLETED {plan_id}", outcome10)
        evidence_posts = [p for p in posts10 if p["endpoint"].endswith("/issues/43/comments")]
        queue_posts = [p for p in posts10 if p["endpoint"].endswith("/issues/42/comments")]
        check("all_executor_records_on_evidence_issue", queue_posts == [] and len(evidence_posts) >= 4,
              f"{len(evidence_posts)} evidence, {len(queue_posts)} queue")
        plan_records = [p["body"] for p in evidence_posts
                        if p["body"].startswith("COMMANDER_PLAN_RUNNER_V1 COMPLETED")]
        check("plan_record_is_single_and_summarizes_steps",
              len(plan_records) == 1 and "steps=s1:ok,s2:ok" in plan_records[0]
              and "USER_UPDATE_V1" in plan_records[0])
        step_terminals = [p["body"] for p in evidence_posts
                          if p["body"].startswith("COMMANDER_RUNNER_V1 COMPLETED")]
        check("each_step_has_its_own_terminal", len(step_terminals) == 2, str(len(step_terminals)))
        check("second_step_pinned_to_first_steps_sha",
              all(f"sha={sha}" in body for body in step_terminals))
        status_posts = [p for p in evidence_posts if p["body"].startswith("CURRENT_USER_STATUS")]
        status_patches = [p for p in posts10 if "/issues/comments/" in p["endpoint"]
                          and p["body"].startswith("CURRENT_USER_STATUS")]
        check("status_comment_created_once", len(status_posts) == 1, str(len(status_posts)))
        # Second tick: the plan record was completed last tick, so the status is
        # dirty and must be PATCHed (not re-posted); the notification drains.
        outcome11, posts11 = run(prb_config, store, [])
        check("second_tick_idle", outcome11 == "NO_JOB", outcome11)
        patches11 = [p for p in posts11 if "/issues/comments/" in p["endpoint"]]
        reposts11 = [p for p in posts11 if p["body"].startswith("CURRENT_USER_STATUS")
                     and p["endpoint"].endswith("/comments")]
        check("status_is_patched_in_place_not_reposted", len(patches11) == 1 and reposts11 == [],
              f"{len(patches11)} patches, {len(reposts11)} reposts")
        lines = sent.read_text().splitlines() if sent.exists() else []
        check("one_owner_notification_for_the_whole_plan", len(lines) == 1, str(len(lines)))
        if lines:
            argv = json.loads(lines[0])
            check("notification_argv_is_recipient_then_text",
                  argv[-2] == "+10000000000" and argv[-1].startswith("[Commander] COMPLETED"))
            check("notification_carries_no_evidence",
                  "CANARY" not in argv[-1] and "issues/43#issuecomment-" in argv[-1], argv[-1])
            check("script_is_the_shipped_constant",
                  tuple(argv[i + 1] for i, a in enumerate(argv) if a == "-e") == runner.IMESSAGE_SCRIPT)
        # 12. A replayed plan comment does nothing.
        outcome12, posts12 = run(prb_config, store,
                                 [{"id": 7, "user": {"login": COMMANDER}, "body": plan_body}])
        check("plan_not_replayed", outcome12 == "NO_JOB" and not any(
            p["endpoint"].endswith("/comments") and "PLAN" in p["body"] for p in posts12), outcome12)

    ok = all(item["ok"] for item in checks)
    print(json.dumps({"canary": "commander-runner-e2e", "ok": ok,
                      "passed": sum(1 for c in checks if c["ok"]), "total": len(checks),
                      "checks": checks}, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
