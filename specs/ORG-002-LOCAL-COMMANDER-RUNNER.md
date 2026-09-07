# ORG-002 — Local Commander Runner

Priority: control-plane enablement. Status: READY FOR IMPLEMENTATION. Owner: Commander. Acceptance: Commander + Haitao activation.

## Objective

Remove Haitao from ordinary Commander-to-worker message relay. A dedicated always-on Mac mini worker node polls one GitHub Issue for structured Commander jobs, invokes the accepted Kiro/Copilot/Claude CLIs under predefined least-privilege profiles, and posts sanitized results back to that Issue.

Haitao may direct the cloud Commander from a phone or MacBook; neither device is an execution dependency. This runner supports development execution only. LandlordEasy production remains fully hosted on Tencent Cloud and never depends on the Mac mini.

## Architecture

- Queue: one dedicated GitHub Issue in `haitao5867gg-cpu/LandlordEasy`.
- Dispatcher identity: the configured Commander GitHub login creates structured `COMMANDER_JOB_V1` comments and is the only accepted job author.
- Executor: Python 3 standard-library runner under `tools/commander-runner/`.
- Executor identity: a distinct configured GitHub login authenticated by the Mac mini `gh` CLI reads the fixed Issue, posts lifecycle comments and performs only controlled delivery pushes. It is never treated as a job author.
- Executor node: the dedicated Mac mini M4, identified by a configured immutable runner ID; MacBook execution is disabled after migration.
- Scheduler: user-level macOS LaunchAgent on the Mac mini, disabled until Haitao performs final activation.
- State: local, gitignored replay-protection database under an application-specific state directory.
- Results: bounded sanitized summary posted as an Issue comment; full raw stdout/stderr stays local with restricted permissions and retention.
- Poll interval: 60 seconds while the Mac mini is online. Offline jobs remain queued.
- Connectivity: outbound-only GitHub and official model-service traffic; no inbound port, public SSH, VPN or remote shell is required.

## Mac mini enrollment

Enrollment is a separate one-time human-assisted phase after implementation review.

- Create or select a dedicated standard macOS user for the runner; do not use an administrator session for unattended execution.
- Clone the repository normally on the Mac mini and configure its canonical path in a local, owner-readable config file. No username or home path is hard-coded in repository code.
- Install and authenticate `git`, `gh`, Python 3, Kiro CLI, Copilot CLI and Claude Code directly on the Mac mini. Never copy credential stores, keychains or token files from the MacBook.
- Run the same bounded ORG-001 smoke tests on the Mac mini before activation.
- Docker is optional for the runner itself and is enrolled separately for isolated test jobs. Production credentials are never copied to the Mac mini.
- Configure normal macOS power/restart behavior only through explicit Haitao action. The installer must not change sleep, FileVault, login, firewall or administrator settings.
- Only one runner ID may be active for this queue. The MacBook remains a Commander client and emergency manual workstation, not a polling executor.

## Job schema

A job comment contains exactly one fenced JSON object with:

- schema version and globally unique job ID;
- repository and queue Issue number;
- exact target ref/SHA and derived isolated worktree ID;
- worker: `kiro`, `copilot` or `claude`;
- model from the runner's allowlist;
- permission profile from the fixed profiles below;
- assigned Spec/Issue and prompt;
- timeout, output limit and expected evidence;
- mandatory bounded human-approval reference for `repo_delivery`; other profiles reject it.

For `repo_delivery`, the human-approval reference is mandatory, bounded to 512 characters, treated only as audit text and never interpreted as a command, path or permission.

Reject unknown fields, duplicate IDs, malformed JSON, moving refs where an exact SHA is required, unsupported models/profiles, unexpected authors and all shell fragments supplied as job data.

## Fixed permission profiles

### `repo_read`

- Read only inside the resolved isolated worktree.
- No shell, write, Web, MCP, remote control, subagents, server, DB or provider access.
- Suitable for review, planning and bootstrap.

### `repo_write_test`

- Read/write only inside one derived isolated worktree.
- May run repository-local build/typecheck/test commands through a fixed allowlist.
- No arbitrary shell from the job payload; no access outside the worktree except runner-owned temp/result directories.
- No Web/MCP/remote control/server/DB/provider access.
- Commit/push are not included.

### `repo_delivery`

- Adds fixed Git status/diff/check, commit and explicit same-name branch push operations.
- No force push, rebase, branch deletion, tags, PR merge or main/dev direct writes.
- Requires exact base SHA and clean-state checks.
- Requires a non-empty owner-controlled exact-path allowlist for the selected quality gate. All staged additions, modifications and deletions must match it both before and after the gate; jobs, prompts and provider output cannot expand it.
- Disables commit hooks and verifies the committed tree exactly matches the final validated staged tree before push.

No production, SSH, real database, deployment, payment, OAuth, WeiQian or user-notification profile exists in V1. Such actions remain manual, separately authorized Human Actions.

## Worker adapters

Adapters build subprocess argument arrays directly; never use a shell.

- Kiro: explicit non-interactive mode, pinned model and exact trusted tool list.
- Copilot: explicit available/allowed/denied tools, built-in MCP disabled, URLs denied and allow-all suppressed.
- Claude: print mode, no session persistence, inline `remoteControlAtStartup=false`, explicit allowed/disallowed tools, no MCP/subagent/Web.
- Each adapter enforces a timeout, output cap, exit-code capture and process-group termination.
- The job cannot supply raw CLI flags.
- Provider subprocesses receive only the fixed safe-environment allowlist. The runner derives `USER` from `pwd.getpwuid(os.getuid()).pw_name`, never from inherited environment data, and fails closed if that user record is unavailable or invalid. It does not forward `LOGNAME`, `SSH_AUTH_SOCK`, arbitrary `CLAUDE_`/`ANTHROPIC_` variables or a complete shell environment.

Model routing follows `specs/ORG-001-AI-CLI-ONBOARDING.md`.

## GitHub trust boundary

- Hard-code the repository and queue Issue.
- Require separate, strictly validated `commander_login` and `executor_login` values and reject enrollment when they identify the same GitHub login.
- Accept jobs only from `commander_login`; verify the local `gh api user` identity against `executor_login` before reading or acting on the queue.
- Ignore all Executor-authored lifecycle comments as non-jobs. Never include either login in logs, status, or public lifecycle output.
- Require the exact `COMMANDER_JOB_V1` marker and schema.
- Require the configured runner ID and acquire a queue lease before claiming work; a second host must fail closed.
- Record comment ID + job ID before execution using an atomic claim so restarts cannot replay work.
- Post lifecycle states: CLAIMED, COMPLETED, FAILED, REJECTED or TIMED_OUT.
- Do not execute edited comments; bind the claim to a content hash.
- GitHub writes are limited to comments on the queue Issue. No Issue edits, labels, PR actions, releases, workflows or repository settings.

## Secret and output handling

- Never read `.env`, credentials, keychains, SSH configuration or shell history.
- Do not include the full inherited environment in logs.
- Raw CLI output is stored locally with owner-only permissions, capped size and short retention.
- Before GitHub posting, redact common credential/token/URL/connection-string patterns and reject the post if high-risk patterns remain.
- Result comments include only job identity, worker/model/profile, exit state, duration, usage when visible, tested SHA, clean/diff summary and bounded sanitized evidence.
- Never post source-file bodies, tenant/landlord data or contract filenames.

## Worktree rules

- Canonical repository and runner worktree root are explicit absolute paths in the Mac mini's local configuration; repository code must not hard-code a macOS username.
- The worktree root is a dedicated sibling directory controlled by the runner and distinct from any MacBook path.
- Resolve and validate real paths; reject symlinks or paths outside the exact roots.
- Fetch only the configured origin.
- New jobs start from an exact SHA and a clean isolated worktree.
- Concurrent jobs never share a worktree. Serialize files with known collision risk.
- Do not delete a dirty/failed worktree automatically.

## Operational controls

Provide commands/scripts for:

- `install`: validate prerequisites and install, but do not enable without explicit confirmation;
- `doctor`: read-only checks for gh/git/CLI auth, paths and configuration;
- `run-once --dry-run`: fetch and validate without executing;
- `run-once`: claim and execute one job;
- `start` / `stop`: load or unload the user LaunchAgent;
- `status`: show sanitized local state and runner-ID/lease health;
- `heartbeat`: renew the single-node lease without executing a job;
- `uninstall`: unload and remove only runner-owned files after confirmation.

Use an exclusive process lock. Apply bounded exponential backoff for GitHub/model-service failures. Never retry a worker task automatically after an ambiguous exit; report and await a new job.

## Required tests

1. Unit tests: strict schema, unknown fields, author/repository/Issue mismatch, duplicate/replay, edited-comment hash, model/profile allowlists and numeric bounds.
2. Security tests: shell metacharacters remain inert, argv construction, path traversal/symlink rejection, environment filtering, redaction and output cap.
3. State tests: atomic claim, crash recovery, concurrent runner lock and no replay after restart.
4. Adapter snapshot tests for all three CLIs proving dangerous flags/tools are absent.
5. GitHub client tests use fixtures only; no live writes.
6. Install/uninstall and LaunchAgent rendering tests use a temporary home-equivalent fixture, never the real user LaunchAgents directory.
7. Existing repository CI remains green.

## Activation acceptance

After implementation PR review:

1. Haitao signs into the dedicated Mac mini user and performs one explicit installation/activation.
2. Run `doctor` with no secret output, proving the configured canonical path, runner ID, outbound-only boundary and single-node lease.
3. Commander posts one harmless `repo_read` canary job for Kiro Luna.
4. Runner automatically claims it, invokes Kiro, and posts the sanitized result.
5. Stop/start the runner and prove the job is not replayed.
6. Commander posts a second harmless job routed to a different CLI and verifies autonomous round-trip.
7. Confirm quota reporting, clean worktrees, stop/uninstall behavior and no unexpected network or permission requests.
8. From the MacBook or phone, create no local execution dependency: close the MacBook-side worker session and prove the Mac mini alone claims the next canary.

Only then mark ORG-002 ACCEPTED and resume OPS-001 through the queue.

## Stop conditions

Stop without broadening permissions on unexpected macOS approval, unknown GitHub author, malformed/edited job, dirty or mismatched worktree, unavailable authentication, unsupported model, permission escalation, unexpected network destination, secret-risk detection, output overflow, timeout or repository mutation outside the assigned profile.

## Non-goals

- Production hosting or a production dependency.
- A general-purpose remote shell.
- Running arbitrary Issue text.
- Automatic production deployment or provider access.
- Bypassing subscription limits, account controls or human approvals.
- Providing a production uptime guarantee; queued development work resumes after any Mac mini outage.
