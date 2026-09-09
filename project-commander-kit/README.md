# project-commander-kit

A portable control plane for letting an AI agent do real engineering work on a
repository, unattended, without giving it a remote shell and without you acting
as a message bus.

A GitHub Issue is the queue. A local runner is the only thing that executes.
Every decision is reconstructible from immutable GitHub records plus files in
the repository — never from chat history.

## What is in here

```
project-commander-kit/
├── README.md                     ← you are here
├── ARCHITECTURE.md               data flow, identities, trust boundaries
├── SECURITY_MODEL.md             what is fail-closed and what is not
├── FAILURE_AND_RETRY_POLICY.md   the five stop classes; retry and quota rules
├── PROTOCOLS.md                  message schemas and invariants
├── NEW_PROJECT_BOOTSTRAP.md      adopt this in a fresh repository
├── MIGRATION_FROM_LANDLORDEASY.md  moving off the original deployment
├── FRAMEWORK_SUMMARY.md          complete standalone summary (no chat context)
├── ONBOARDING_PROMPT.md          single-file prompt to hand a new project's AI
├── runner/                       commander_runner.py + helper + full test suite
├── scripts/pck.py                doctor / install / upgrade / rollback
├── config/                       JSON schema + neutral example config
└── templates/.github/            queue Issue template, PR template, CI workflow
```

## Quick start

```bash
python3 project-commander-kit/scripts/pck.py doctor
```

Then follow `NEW_PROJECT_BOOTSTRAP.md`. The short version:

1. Create **two** GitHub accounts — Commander and Executor. They must differ.
2. Open the queue Issue from the template. Note its number.
3. Copy `config/config.example.json`, fill in absolute paths, `chmod 600` it.
4. `pck.py doctor --config <path>` until it reports `"ok": true`.
5. `pck.py install --config <path>`, then start the runner.
6. Post one `repo_read` canary job and confirm a terminal record comes back.

Start with `enabled_profiles: ["repo_read"]`. Widen only after a canary passes.

## The properties that matter

**Nothing is lost.** Raw provider bytes are persisted *before* parsing. A parse
failure can never destroy a completed run; `renormalize` recovers it locally
with zero provider calls.

**Nothing is silent.** A job addressed to this runner that fails validation gets
an explicit `REJECTED` terminal with a reason and a stop class. Silence used to
be indistinguishable from "not polled yet", which is what forced manual relay.

**Nothing runs twice.** One job UUID → at most one terminal record, forever.
Retries create new derived `attempt_id`s and keep the full audit chain.

**Failures are graded.** Only credential exposure, production contact,
destructive operations, permission denial, and unconfirmable identity/SHA fail
closed. A wrong flag, a bad path, an unparseable answer, or a rate limit is
ordinary engineering: diagnose, retry within budget, report.

**Free quota first.** Providers with an exhausted window drop out of rotation.
Paid capacity is used only when every free window is spent *and* the owner has
explicitly authorized it.

## Verification

```bash
python3 -m unittest discover -s project-commander-kit/runner/tests   # 146 tests
python3 project-commander-kit/runner/tests/canary_end_to_end.py      # 21 checks
```

The canary drives the real `run_once` loop against a real git repository and a
real isolated worktree, with stub provider and `gh` binaries. It touches no
network, no GitHub, no database, and no credential.

## What this is not

Not a remote shell. Not a deployment tool. Not a production-access mechanism.
There is no inbound listener, no job-supplied command or path, and no code path
that pushes a protected branch, merges a PR, or contacts a production system.

## Requirements

macOS or Linux · Python 3.9+ · `git` · `gh` (authenticated as the Executor) ·
at least one provider CLI. The launchd integration is macOS-specific; on Linux
use a systemd user unit invoking `commander_runner.py --config <path> serve`.
