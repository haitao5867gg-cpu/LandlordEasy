# Local Commander Runner (ORG-002)

This is the V1 development-only executor for a single Commander queue Issue. It uses Python's standard library only. It accepts one exact `COMMANDER_JOB_V1` fenced JSON comment from the configured Commander account, creates a SHA-pinned isolated worktree, invokes exactly one CLI with a fixed adapter, and posts bounded redacted lifecycle output. It has no production, database, provider, remote-shell, inbound-listener, or automatic activation capability.

## Local configuration

Copy `config.example.json` to a local owner-readable `config.json`, replace every placeholder with enrolled values, and set mode `0600`. Path values accept absolute paths, `~`, or `${HOME}` and are expanded from the current user's home at runtime; no username is embedded in code. The configuration is deliberately not in version control. The canonical checkout and dedicated worktree root must be separate real directories (not symlinks). The configured origin must exactly equal the checkout's `origin` URL.

The config fixes the repository, queue Issue, Commander login, immutable runner ID, absolute model executable locations, state directory, polling/lease limits, and whether cross-provider failover is explicitly enabled. Absolute executable paths are mandatory because LaunchAgent PATH resolution is intentionally not trusted. The runner never reads `.env`, keychains, credential files, SSH configuration, or shell history; CLI authentication remains the enrolled CLI's responsibility.

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

`doctor` fails closed unless all configured CLI executables exist and their local help text contains every safety-critical adapter flag. `install` validates first and never loads the LaunchAgent. The installed plist has `RunAtLoad=true`, but remains inert until a later explicit `start` bootstrap. `start` and `stop` use direct `launchctl` argv calls only after a human has installed and reviewed the generated user LaunchAgent. `uninstall --confirm` removes only the runner's own label after unloading it. The committed plist is a template only and is never loaded by tests or installation without confirmation.

## Job envelope and profiles

A job comment must contain no prose beyond this exact envelope:

````text
COMMANDER_JOB_V1
```json
{"schema":"COMMANDER_JOB_V1", "...":"all required schema fields"}
```
````

The parser rejects unknown/missing fields, wrong author/repository/Issue/runner, non-UUID ID, moving or malformed SHA, non-derived worktree ID, unsupported models/profiles, invalid numeric limits, duplicate jobs, and edited claimed comments. It accepts only models routed in ORG-001. Job input never becomes a shell command or raw CLI flag.

Kiro is pinned to `gpt-5.6-luna`, `gpt-5.6-terra`, or exceptional `gpt-5.6-sol`; `auto` is rejected. Its headless adapter always supplies non-empty positional input and exact `--trust-tools`. Copilot disables built-in MCP, URL access, remote export/control, updates, and unexpected prompts. Claude uses print/no-session mode, an empty strict MCP configuration, remote control off, and an explicit tool set.

`repo_read` grants read tools only. `repo_write_test` grants repository file writes but no commit/push. `repo_delivery` is the sole profile that may use the runner's fixed Git sequence: clean SHA-pinned worktree, UUID-derived branch, `git add --all`, `git diff --cached --check`, fixed commit message, and explicit same-name branch push. It cannot target main/dev, force-push, rebase, delete branches, tag, or merge.

## Safety and operations

The state database is owner-only SQLite and atomically binds comment ID, job ID, and comment hash before work begins. A process lock and single-node expiring lease fail closed. Failed/dirty worktrees are retained; worker jobs are never automatically retried. Raw bounded output stays in the local state directory; result comments pass redaction and high-risk secret detection. Results never intentionally include file bodies or inherited environment values.

Internally each accepted job records `queued`, `claimed`, `running`, then exactly one of `succeeded`, `failed`, or `blocked`. A restart converts ambiguous `claimed`/`running` work to `blocked` instead of replaying it. Provider output is accepted only after normalization to validated `status`, `summary`, and `evidence` fields. When `provider_failover` is explicitly enabled in owner-only local configuration, failover is allowed only for definitive availability failures (auth, quota/rate limit, unsupported model, or missing executable); runtime, timeout, output overflow, permission, and malformed-output results never trigger duplicate execution. When disabled, only the job's requested worker/model is attempted.

Quota records are local observations, not invented balances. Kiro and Copilot use monthly reset keys beginning on day 1. Claude uses Saturday weekly keys plus five-hour window buckets. A provider's own definitive quota error can trigger configured failover; no unknown balance is treated as zero. `doctor` reports provider executable/flag-contract health and `null` when a balance is unavailable. `outbound_policy=NO_INBOUND_LISTENER_IMPLEMENTED` describes the runner architecture and is not presented as a firewall audit.

Run offline tests with `python3 -m unittest discover -s tests -v` from this directory. They use temporary directories and fixture/mocked clients only; no live GitHub, LaunchAgent, model CLI, or repository command is executed.
