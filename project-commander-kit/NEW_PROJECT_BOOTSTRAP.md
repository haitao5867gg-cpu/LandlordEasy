# Bootstrapping a new project

Target: a first `repo_read` job completes end to end and its terminal record
appears on the queue Issue, with no human relaying anything.

Budget roughly an hour, most of it waiting on account setup.

## 0. Prerequisites

- A GitHub repository you control.
- A machine that stays awake (a Mac mini, a small VM, anything persistent).
- Python 3.9+, `git`, `gh`, and at least one provider CLI installed.

## 1. Two GitHub identities

Create or designate **two distinct accounts**:

- **Commander** — dispatches jobs. Never runs anything.
- **Executor** — the runner authenticates as this. Never dispatches jobs.

Both need push access to the repository (not to protected branches).

> Do not skip this and do not merge them later. The whole safety argument rests
> on no single credential being able to both *issue* and *perform* work.
> `Config.load` refuses to start if the two logins match.

On the runner host, authenticate `gh` **as the Executor**:

```bash
gh auth login
gh api user --jq .login   # must print the Executor login
```

## 2. Copy the kit in

```bash
cp -r project-commander-kit /path/to/your-repo/
cp project-commander-kit/templates/.github/workflows/ci-quality-gate.yml \
   /path/to/your-repo/.github/workflows/
cp project-commander-kit/templates/.github/pull_request_template.md \
   /path/to/your-repo/.github/
```

Edit the workflow so its steps run *your* project's checks. Keep
`permissions: contents: read` and add no deploy step.

Make sure the trigger list covers the branches you will actually test — include
your candidate branch prefixes under `push.branches` and every base you open PRs
against under `pull_request.branches`. Missing this is the most common reason a
candidate ends up with no CI at all.

## 3. Create the queue Issue

Open a new Issue from `templates/.github/ISSUE_TEMPLATE/commander-job-queue.md`,
from the **Commander** account. Note its number. Do not close it.

Recommended: open a second, plainly titled Issue ("Commander evidence log —
do not close") and put its number in `evidence_issue`. The queue then holds
only intent and stays fast to scan; every runner record goes to the evidence
Issue, including the pinned `CURRENT_USER_STATUS` the Commander reads first.

## 4. Write the local config

```bash
mkdir -p ~/.config/yourproject
cp project-commander-kit/config/config.example.json ~/.config/yourproject/config.json
chmod 600 ~/.config/yourproject/config.json
$EDITOR ~/.config/yourproject/config.json
```

Every path must be **absolute** (`~` and `${HOME}` are expanded). Get executable
paths with `command -v git gh python3 claude`.

Start deliberately small:

```json
"enabled_providers": ["claude"],
"enabled_profiles": ["repo_read"],
"enabled_quality_gates": ["none"],
"enabled_operations": [],
"wake_pull_request": null,
"provider_failover": false
```

`runtime_dir` must be **outside** `canonical_repo` and `worktree_root` — the
runner refuses to install into a directory a job could write to.

## 5. Prepare the working directories

```bash
git clone https://github.com/YOUR-ORG/YOUR-REPO.git ~/YourProject
mkdir -p ~/YourProject-runner-worktrees
```

## 6. Doctor until green

```bash
python3 project-commander-kit/scripts/pck.py doctor --config ~/.config/yourproject/config.json
```

Fix everything until `"ok": true`. Common causes: a relative path, config not
`chmod 600`, a provider CLI not authenticated, `runtime_dir` inside the repo.

## 7. Install and start

```bash
python3 project-commander-kit/scripts/pck.py install --config ~/.config/yourproject/config.json
```

macOS:

```bash
python3 ~/.local/lib/yourproject-commander/commander_runner.py \
  --config ~/.config/yourproject/config.json install --confirm
python3 ~/.local/lib/yourproject-commander/commander_runner.py \
  --config ~/.config/yourproject/config.json start
```

Linux: create a systemd **user** unit running `… --config <path> serve`.

Before automating, run one tick by hand:

```bash
python3 ~/.local/lib/yourproject-commander/commander_runner.py \
  --config ~/.config/yourproject/config.json run-once --dry-run
```

## 8. The canary job

From the **Commander** account, comment on the queue Issue. Generate a UUID
(`python3 -c "import uuid; print(uuid.uuid4())"`) and use the current head SHA.

````
COMMANDER_JOB_V1
```json
{
  "schema": "COMMANDER_JOB_V1",
  "job_id": "PASTE-UUID",
  "repository": "YOUR-ORG/YOUR-REPO",
  "queue_issue": 1,
  "target_sha": "PASTE-40-HEX-SHA",
  "worktree_id": "job-PASTE-UUID",
  "runner_id": "yourproject-runner-01",
  "worker": "claude",
  "model": "claude-sonnet-5",
  "profile": "repo_read",
  "assigned": "BOOTSTRAP-1",
  "prompt": "Read README.md and report the project name; return the JSON contract only.",
  "timeout_seconds": 300,
  "output_limit_bytes": 65536,
  "expected_evidence": "project name from README",
  "quality_gate": "none"
}
```
````

Within one poll interval you should see `CLAIMED`, then `COMPLETED`.

**Acceptance:** a terminal record with `attempt_id`, `stop_class=NONE`, and a
plausible summary — and the same comment does **not** run again on the next tick.

## 9. Widen, one step at a time

Only after the canary passes, and re-running the canary after each step:

1. `repo_write_test` + a real quality gate.
2. `repo_delivery` + a **non-empty exact-path** `delivery_path_allowlists` entry.
   Delivery jobs also require a `human_approval_ref`.
3. `wake_pull_request` for advisory nudges.
4. Controlled operations, if you have bounded local work worth automating.
5. `provider_failover`, then quota-aware routing.

Enable paid overflow (`paid_overflow_authorized`) only as a deliberate cost
decision.

## 10. Operating it

```bash
pck.py doctor --config <path>                          # health
commander_runner.py --config <path> status             # queue and lease state
commander_runner.py --config <path> renormalize --job <uuid>   # free recovery
commander_runner.py --config <path> notify-test --confirm     # one test iMessage
pck.py upgrade  --config <path>                        # backs up first
pck.py rollback --config <path>                        # restore previous
```

Restart the runner after an upgrade or rollback.

## Failure triage

| Symptom | Cause |
|---|---|
| Nothing happens at all | comment authored by the wrong account, or `runner_id` mismatch — both are skipped by design |
| `REJECTED` | validation failed; the `reason=` field says exactly what |
| `FAILED … stop_class=PROTOCOL_FAILURE` | the provider answered but we could not parse it. Run `renormalize` — it costs nothing |
| `FAILED … stop_class=SAFETY_STOP` | a real boundary was hit. Investigate; do not retry blindly |
| `FAILED … runner stop condition: …` | environment problem — usually a wrong absolute path |
| `WAKE_PENDING` | GitHub write failed; the outbox will redeliver. The job will not re-run |
