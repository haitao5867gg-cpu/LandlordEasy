# Local Commander Runner (ORG-002)

This is the V1 development-only executor for a single Commander queue Issue. It uses Python's standard library only. It accepts exact `COMMANDER_JOB_V1` development jobs and exact `COMMANDER_OPERATION_V1` owner-registered local rehearsal operations from the configured Commander identity. Both paths use SHA-pinned isolated worktrees and bounded redacted lifecycle output through a separate Executor identity. The operation path is not a general shell and never invokes or fails over to an AI provider. It has no Production, remote-shell, inbound-listener, or automatic activation capability.

## Local configuration

Copy `config.example.json` to a local owner-readable `config.json`, replace every placeholder with enrolled values, and set mode `0600`. Path values accept absolute paths, `~`, or `${HOME}` and are expanded from the current user's home at runtime; no username is embedded in code. The configuration is deliberately not in version control. The canonical checkout and dedicated worktree root must be separate real directories (not symlinks). The configured origin must exactly equal the checkout's `origin` URL.

The config fixes the repository, queue Issue, optional wake Pull Request, separate Commander and Executor GitHub logins, immutable runner ID, stable runtime directory, absolute provider and operational (`gh`, `git`, `python`) executable locations, state directory, polling/lease limits, and whether cross-provider failover is explicitly enabled. Both logins use strict GitHub-name validation and must differ. `commander_login` authorizes job comments only; `executor_login` must match the local `gh` identity used to read the fixed Issue, post lifecycle results and wake notices, and perform controlled delivery pushes. Neither identity is included in status, logs, or public lifecycle bodies. Absolute executable paths are mandatory because LaunchAgent PATH resolution is intentionally not trusted. The runner never reads `.env`, keychains, credential files, SSH configuration, or shell history; CLI authentication remains the enrolled CLI's responsibility.

`wake_pull_request` defaults to `null`. When an owner explicitly sets it to a distinct positive Pull Request number, every successfully posted terminal Issue lifecycle record is followed by a minimal `COMMANDER_WAKE_V1` PR conversation comment containing only the job UUID, authoritative terminal Issue/comment IDs, terminal state and runner ID. The wake is a notification hint, never job evidence or authority; Commander must reconstruct state from the referenced Issue record. A SQLite outbox retains a failed wake and blocks new claims until the wake is delivered, without replaying the completed worker or operation. Delivery is intentionally at-least-once: a process loss after GitHub accepts the comment but before the local delivered marker may produce a duplicate notification with the same immutable identity, which Commander must deduplicate. The Runner cannot read or modify the wake PR, choose it from a job, post arbitrary wake text, or use it as a queue.

Provider subprocesses receive a fixed environment allowlist. `USER` is resolved from the current POSIX user record with `pwd.getpwuid(os.getuid())`, never inherited from the parent environment; an unavailable, empty, or malformed record fails closed. `LOGNAME`, `SSH_AUTH_SOCK`, arbitrary `CLAUDE_`/`ANTHROPIC_` variables, and the full shell environment are not forwarded.

`enabled_providers`, `enabled_profiles`, and `enabled_quality_gates` are explicit owner-only activation switches. The first activation configuration enables only `repo_read`; write and delivery remain implemented but disabled until Phase 2 approval. Disabled providers do not block `doctor`, so a provider that fails later workspace-sentinel validation can be turned off independently.

`delivery_path_allowlists` is an optional owner-only mapping from quality-gate ID to exact repository-relative POSIX file paths. It defaults to empty. It accepts no absolute paths, traversal, glob, regex, duplicate or control-character paths. A `repo_delivery` job is rejected unless its enabled gate has a non-empty allowlist, and every staged addition, modification or deletion must be an exact member both before and after the quality gate. Job text and provider output cannot expand this boundary.

`enabled_operations` and `operation_definitions` are owner-only activation controls for ORG-003. The implementation recognizes only `ops001_mysql_probe`. Its definition fixes the absolute Python/helper/Docker argv, `read_only` mode, the single approved rehearsal SHA, timeout/output maxima, clean-worktree postcondition and bounded public description. A queue comment cannot supply a command, argv, environment, path, provider, model, prompt, URL, quality gate or failover instruction. The dedicated helper is installed and hashed alongside the Runner; a missing, partial or mismatched runtime fails `doctor`.

## Commands

All examples are manual Mac-mini enrollment actions. They are **not** run by this implementation delivery.

```text
python3 commander_runner.py --config /absolute/local/config.json doctor
python3 commander_runner.py --config /absolute/local/config.json health
python3 commander_runner.py --config /absolute/local/config.json install
python3 commander_runner.py --config /absolute/local/config.json install --confirm
python3 commander_runner.py --config /absolute/local/config.json run-once --dry-run
python3 commander_runner.py --config /absolute/local/config.json run-once
python3 commander_runner.py --config /absolute/local/config.json heartbeat
python3 commander_runner.py --config /absolute/local/config.json status
python3 commander_runner.py --config /absolute/local/config.json start
python3 commander_runner.py --config /absolute/local/config.json stop
python3 commander_runner.py --config /absolute/local/config.json uninstall --confirm
```

`doctor` fails closed unless all operational executables and enabled provider/gate executables exist, are executable, and expose the expected local interface. `install --confirm` copies the validated runner into the configured owner-only stable runtime directory, records its SHA-256 in an owner-only manifest, refuses to overwrite an existing runtime, and points the plist at that stable copy rather than a Git worktree. Installation never loads the LaunchAgent. The installed plist has `RunAtLoad=true`, but remains inert until a later explicit `start` bootstrap. `start` and `stop` use direct `/bin/launchctl` argv calls only after a human has installed and reviewed the generated user LaunchAgent.

## Job envelope and profiles

A job comment must contain no prose beyond this exact envelope:

````text
COMMANDER_JOB_V1
```json
{"schema":"COMMANDER_JOB_V1", "...":"all required schema fields"}
```
````

The parser rejects unknown/missing fields, wrong Commander author/repository/Issue/runner, non-UUID ID, moving or malformed SHA, non-derived worktree ID, disabled/unsupported models, providers, profiles or quality gates, invalid numeric limits, duplicate jobs, and edited claimed comments. Executor-authored lifecycle comments cannot be jobs because the two configured identities must differ and only the Commander author is accepted. A job supplies only a predefined `quality_gate` ID; command arrays exist solely in owner-only local configuration. A job-provided command, argument list, or shell fragment is rejected as an unknown/unsafe field.

Kiro is pinned to `gpt-5.6-luna`, `gpt-5.6-terra`, or exceptional `gpt-5.6-sol`; `auto` is rejected. Its headless adapter always supplies non-empty positional input and exact `--trust-tools`. A fail-closed provider/profile capability matrix allows Kiro and Claude to serve all three development profiles, but limits Copilot to `repo_read`: Copilot CLI 1.0.83 read-only behavior is accepted, while headless write behavior was not accepted, so its existing write adapter code remains capability-disabled. Parsing and failover both enforce this matrix, and write work can never fail over to Copilot. A future Copilot CLI upgrade requires a new isolated write canary before this capability may be expanded. Copilot also disables built-in MCP, URL access, remote export/control, updates, and unexpected prompts. Claude uses print/no-session mode, an empty strict MCP configuration, remote control off, and identical explicit `--tools` and `--allowedTools` sets: read-only profiles receive `Read,Glob,Grep`, while write profiles add only `Edit,Write`. It never uses bypass permission modes.

`repo_read` grants read tools only and requires the `none` quality gate. Write and delivery profiles require an enabled non-`none` gate. Gate commands are validated direct argv arrays with absolute executables; shell programs and job-provided arguments are forbidden. The Runner—not the AI output—executes every selected gate with bounded output and timeout.

`repo_delivery` is the sole profile that may commit/push and requires a bounded non-empty `human_approval_ref` audit value. That value is never interpreted as a command, path or permission. Delivery stages with `git add --all`, checks the complete bounded `git diff --cached --binary`, validates every path against the gate-specific owner allowlist and validates staged file modes, rejects symlinks, submodules, special modes, sensitive paths, simulated secret patterns and device-specific paths, runs the quality gate, then repeats final staging and all validation. Commit hooks are disabled; the Runner records the validated Git tree and requires the committed `HEAD` tree to match it exactly before the same-name non-force push. Any failure leaves the worktree intact for audit and prevents push.

## Safety and operations

The state database is owner-only SQLite and atomically binds comment ID, job ID, and comment hash before work begins. A process lock and single-node expiring lease fail closed. Failed/dirty worktrees are retained; worker jobs are never automatically retried. Raw bounded output stays in the local state directory; result comments pass redaction and high-risk secret detection. Results never intentionally include file bodies or inherited environment values. Terminal intent is durably queued before the terminal Issue POST, and a restart drains terminal and wake outboxes before scanning new work. Ambiguous claimed/running work is terminalized as FAILED without replay. An in-flight claim migrated from an ORG-003 database is reconstructed only from its original bounded Commander-authored queue comment. Terminal completion and immutable wake identity creation are one SQLite transaction. A pending wake cannot be bypassed by changing or disabling the wake configuration. If the optional wake bridge is enabled, the authoritative terminal lifecycle is always written to the queue Issue first. The separate wake comment contains no evidence, prompt, command, path, environment, provider output, database value or production authorization.

## Bounded local operation envelope

An operation comment contains only the exact `COMMANDER_OPERATION_V1` fenced JSON schema documented in `specs/ORG-003-BOUNDED-LOCAL-OPERATIONS.md`. It includes identity/routing fields, the derived worktree ID, an enabled `operation_id`, bounded timeout/output requests, expected-evidence audit text and a human-approval reference. Unknown fields and job-controlled execution parameters are rejected.

The initial `ops001_mysql_probe` helper filters only the fixed Docker Compose project/service, requires one healthy container with the approved image identity, exact loopback binding, tmpfs database storage and no Docker volumes, then runs only fixed read-only SQL for MySQL version, current synthetic database and application-table count. Docker routing is pinned to the current POSIX user's verified local Unix socket: the home directory comes from the user record rather than inherited environment, and the socket must be a non-symlink Unix socket owned by the effective user and contained by that trusted home. The helper never uses a mutable Docker context, inherited Docker routing, or TCP/SSH endpoints. It accepts Docker Desktop's empty `Mounts` representation only when `HostConfig.Tmpfs` contains exactly `/var/lib/mysql`; bind, volume, extra mount, or extra tmpfs state fails closed. It neither enumerates unrelated resources nor constructs Docker/database mutation commands. Guard failures return stage-specific normalized, non-sensitive evidence and are never retried automatically.

Internally each accepted job records `queued`, `claimed`, `running`, then exactly one of `succeeded`, `failed`, or `blocked`. A restart converts ambiguous `claimed`/`running` work to `blocked` instead of replaying it. Provider output is accepted only after normalization to validated `status`, `summary`, and `evidence` fields. When configured, `repo_read` can fail over after definitive availability failures. Write/delivery failover additionally requires a completely clean tracked, staged, and untracked worktree; any partial write immediately blocks without starting another provider. Runtime, timeout, output overflow, permission, dirty-worktree and malformed-output results never trigger duplicate execution.

The queue reader stores a bounded page cursor in local state. Each poll reads at most 20 comments and 2 MB from the fixed Issue endpoint, advances incrementally through full historical pages, and revisits the current tail page for new work. It never performs an unbounded pagination read; an oversized page fails closed instead of exhausting memory. Legacy in-flight migration refetches the exact Commander comment and requires its body hash to equal the immutable claim hash before parsing either a worker job or local operation. Edited, malformed, wrong-author, comment-ID, or job-ID mismatches remain non-terminal locally and fail closed rather than replaying work or inventing a public terminal identity.

Crash recovery never changes an in-flight claim to a local-only terminal state. Claim terminalization, terminal-outbox completion, and optional wake insertion share one SQLite transaction; failure of any step rolls back all three. The repository CI quality gate runs the complete standard-library Commander Runner offline suite before the application build and test stages.

Quota records are local observations, not invented balances. Kiro and Copilot use monthly reset keys beginning on day 1. Claude uses Saturday weekly keys plus five-hour window buckets. A provider's own definitive quota error can trigger configured failover; no unknown balance is treated as zero. `doctor` reports provider executable/flag-contract health and `null` when a balance is unavailable. `outbound_policy=NO_INBOUND_LISTENER_IMPLEMENTED` describes the runner architecture and is not presented as a firewall audit.

Run offline tests with `python3 -m unittest discover -s tests -v` from this directory. They use temporary directories and fixture/mocked clients only; no live GitHub, LaunchAgent, model CLI, or repository command is executed.
