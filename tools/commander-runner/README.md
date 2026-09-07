# Local Commander Runner (ORG-002)

This is the V1 development-only executor for a single Commander queue Issue. It uses Python's standard library only. It accepts one exact `COMMANDER_JOB_V1` fenced JSON comment from the configured Commander identity, creates a SHA-pinned isolated worktree, invokes exactly one CLI with a fixed adapter, and posts bounded redacted lifecycle output through a separate Executor identity. It has no production, database, provider, remote-shell, inbound-listener, or automatic activation capability.

## Local configuration

Copy `config.example.json` to a local owner-readable `config.json`, replace every placeholder with enrolled values, and set mode `0600`. Path values accept absolute paths, `~`, or `${HOME}` and are expanded from the current user's home at runtime; no username is embedded in code. The configuration is deliberately not in version control. The canonical checkout and dedicated worktree root must be separate real directories (not symlinks). The configured origin must exactly equal the checkout's `origin` URL.

The config fixes the repository, queue Issue, separate Commander and Executor GitHub logins, immutable runner ID, stable runtime directory, absolute provider and operational (`gh`, `git`, `python`) executable locations, state directory, polling/lease limits, and whether cross-provider failover is explicitly enabled. Both logins use strict GitHub-name validation and must differ. `commander_login` authorizes job comments only; `executor_login` must match the local `gh` identity used to read the fixed Issue, post lifecycle results, and perform controlled delivery pushes. Neither identity is included in status, logs, or public lifecycle bodies. Absolute executable paths are mandatory because LaunchAgent PATH resolution is intentionally not trusted. The runner never reads `.env`, keychains, credential files, SSH configuration, or shell history; CLI authentication remains the enrolled CLI's responsibility.

Provider subprocesses receive a fixed environment allowlist. `USER` is resolved from the current POSIX user record with `pwd.getpwuid(os.getuid())`, never inherited from the parent environment; an unavailable, empty, or malformed record fails closed. `LOGNAME`, `SSH_AUTH_SOCK`, arbitrary `CLAUDE_`/`ANTHROPIC_` variables, and the full shell environment are not forwarded.

`enabled_providers`, `enabled_profiles`, and `enabled_quality_gates` are explicit owner-only activation switches. The first activation configuration enables only `repo_read`; write and delivery remain implemented but disabled until Phase 2 approval. Disabled providers do not block `doctor`, so a provider that fails later workspace-sentinel validation can be turned off independently.

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

Kiro is pinned to `gpt-5.6-luna`, `gpt-5.6-terra`, or exceptional `gpt-5.6-sol`; `auto` is rejected. Its headless adapter always supplies non-empty positional input and exact `--trust-tools`. Copilot disables built-in MCP, URL access, remote export/control, updates, and unexpected prompts. Claude uses print/no-session mode, an empty strict MCP configuration, remote control off, and an explicit tool set.

`repo_read` grants read tools only and requires the `none` quality gate. Write and delivery profiles require an enabled non-`none` gate. Gate commands are validated direct argv arrays with absolute executables; shell programs and job-provided arguments are forbidden. The Runner—not the AI output—executes every selected gate with bounded output and timeout.

`repo_delivery` is the sole profile that may commit/push. It stages with `git add --all`, checks the complete bounded `git diff --cached --binary`, validates staged file modes, rejects symlinks, submodules, special modes, sensitive paths, simulated secret patterns and device-specific paths, runs the quality gate, then repeats final staging and validation before the fixed commit and same-name non-force push. Any failure leaves the worktree intact for audit and prevents commit/push.

## Safety and operations

The state database is owner-only SQLite and atomically binds comment ID, job ID, and comment hash before work begins. A process lock and single-node expiring lease fail closed. Failed/dirty worktrees are retained; worker jobs are never automatically retried. Raw bounded output stays in the local state directory; result comments pass redaction and high-risk secret detection. Results never intentionally include file bodies or inherited environment values.

Internally each accepted job records `queued`, `claimed`, `running`, then exactly one of `succeeded`, `failed`, or `blocked`. A restart converts ambiguous `claimed`/`running` work to `blocked` instead of replaying it. Provider output is accepted only after normalization to validated `status`, `summary`, and `evidence` fields. When configured, `repo_read` can fail over after definitive availability failures. Write/delivery failover additionally requires a completely clean tracked, staged, and untracked worktree; any partial write immediately blocks without starting another provider. Runtime, timeout, output overflow, permission, dirty-worktree and malformed-output results never trigger duplicate execution.

The queue reader stores a bounded page cursor in local state. Each poll reads at most 20 comments and 2 MB from the fixed Issue endpoint, advances incrementally through full historical pages, and revisits the current tail page for new work. It never performs an unbounded pagination read; an oversized page fails closed instead of exhausting memory.

Quota records are local observations, not invented balances. Kiro and Copilot use monthly reset keys beginning on day 1. Claude uses Saturday weekly keys plus five-hour window buckets. A provider's own definitive quota error can trigger configured failover; no unknown balance is treated as zero. `doctor` reports provider executable/flag-contract health and `null` when a balance is unavailable. `outbound_policy=NO_INBOUND_LISTENER_IMPLEMENTED` describes the runner architecture and is not presented as a firewall audit.

Run offline tests with `python3 -m unittest discover -s tests -v` from this directory. They use temporary directories and fixture/mocked clients only; no live GitHub, LaunchAgent, model CLI, or repository command is executed.
