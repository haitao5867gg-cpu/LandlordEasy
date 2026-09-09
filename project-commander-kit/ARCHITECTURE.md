# Architecture

## The problem this solves

You want an AI agent to do real engineering work on a repository while you are
asleep, without granting it a general-purpose remote shell and without you
acting as a message bus between a planning agent and a local machine.

The naive versions both fail. A chat agent with no local execution makes you
copy commands by hand. A local agent with broad permissions is a remote shell
with extra steps.

This kit is the middle: a **narrow, auditable job queue** where a GitHub Issue
is the control plane, a local runner is the only thing that executes, and every
decision is reconstructible from immutable GitHub records plus repository files.

## Roles and identities

Three parties, two of them GitHub accounts that **must be different logins**.

| Role | Identity | Can do | Cannot do |
|---|---|---|---|
| **Owner** | a human | authorize risk, approve production, set config | — |
| **Commander** | GitHub account A | post job comments to the queue Issue; read everything | run anything locally; the runner ignores its own posts |
| **Executor** | GitHub account B | run the Runner; post terminal records | post jobs — jobs authored by the Executor are ignored by construction |

The split is not decoration. The Runner only executes comments authored by the
Commander login, and it authenticates to GitHub as the Executor login. A single
compromised token therefore cannot both *issue* work and *perform* it. The kit
never shares a token between the two, and `Config.load` refuses to start when
the two logins are equal.

## Data flow

```
        ┌────────────────────────────────────────────────────────────────┐
        │ OWNER                                                          │
        │  · edits local config (providers, profiles, gates, operations) │
        │  · authorizes paid overflow / controlled operations            │
        └───────────────────────────┬────────────────────────────────────┘
                                    │ owner-only, file mode 0600
                                    ▼
  COMMANDER ──── COMMANDER_JOB_V1 ──────────────┐
  (GitHub acct A) COMMANDER_OPERATION_V1        │
                                                ▼
                                    ┌──────────────────────────┐
                                    │  Queue Issue (fixed #)   │  ← the only
                                    │  immutable comment log   │    control plane
                                    └───────────┬──────────────┘
                                                │ poll (GET, paged)
                                                ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ RUNNER  (local, launchd, authenticated as Executor acct B)         │
   │                                                                    │
   │  1  filter: author == Commander, addressed to this runner_id       │
   │  2  parse  → valid ─────────────┐        invalid ──→ REJECTED      │
   │  3  claim  (SQLite, atomic, exactly-once per job UUID)             │
   │  4  worktree: git worktree at the EXACT target SHA, detached       │
   │  5  execute: provider argv (no shell) OR fixed operation argv      │
   │  6  PERSIST RAW BYTES ────────────────────────► raw-output/*.log   │
   │  7  parse → artifact (full report, local) + bounded Issue excerpt  │
   │  8  queue terminal in outbox → post → optional wake                │
   └────────────────────────────────────────────────────────────────────┘
                     │ terminal comment (authoritative)
                     ▼
        Queue Issue ──────► COMMANDER reads state back from GitHub
                     │
                     └─ optional wake comment on a PR ─► nudges Commander
                        (a hint only; carries NO authority)
```

## Why each boundary exists

**The queue Issue is the only endpoint.** `GitHubClient._api` refuses any
endpoint that is not the configured Issue's comments (or the optional wake PR's
comments, POST-only). There is no code path to edit labels, close issues, push
to protected branches, change settings, or create releases. Widening the blast
radius requires editing the Runner, not editing a comment.

**No shell, ever.** Every subprocess is an explicit argv array through
`subprocess.Popen(argv, shell=False)`. This is what makes it safe to accept
ordinary punctuation in prompts: there is no metacharacter interpretation to
exploit. (Filtering `;` out of prompts was tried, protected nothing, and
silently rejected legitimate work — see `FAILURE_AND_RETRY_POLICY.md`.)

**Exact-SHA worktrees.** A job names a 40-hex SHA. The Runner fetches that
object, creates a fresh detached worktree at it, and verifies `rev-parse HEAD`
matches. A moving ref can never be substituted for a reviewed commit. Drift
fails closed.

**Raw-before-parse.** Provider bytes are written to disk *before* any
structured parsing. This is the single most valuable property in the system: a
parse bug can no longer destroy an expensive completed run. Recovery is
`renormalize`, which costs nothing.

**Outbox durability.** Terminal records are committed to SQLite *before* the
GitHub post. If the post fails, or the process dies, the next tick redelivers
the same record rather than re-running the job. Wake notices work the same way
and are keyed by job UUID, so duplicate delivery is idempotent.

**Wake is a hint, not authority.** A wake comment tells the Commander "go read
the Issue." It never carries a decision. Anything that would change behaviour
must be reconstructible from the Issue itself.

## State

`state.sqlite3` (mode 0600) holds:

| Table | Purpose |
|---|---|
| `claims` | one row per queue comment; enforces exactly-once via `job_id UNIQUE` |
| `history` | append-only status transitions |
| `attempts` | one row per execution try, keyed by a **derived** `attempt_id` — a retry never reuses the job UUID as its execution identity |
| `terminal_outbox` | terminal record committed before posting |
| `wake_outbox` | wake notice, delivered at-least-once, deduplicated by job UUID |
| `lease` | single-runner mutual exclusion |
| `metadata` | bounded queue-page cursor |

Alongside it: `raw-output/<job>.attempt-N.log` (0600) and
`artifacts/<job>/attempt-N.md` (0600).

## What deliberately does not exist

- No inbound listener. The Runner polls; nothing can call into it.
- No provider-supplied argv, env, path, URL, or command. Operations run a
  fixed, owner-configured argv; the job selects an ID, never a command.
- No push to `main`/`dev`/protected branches. `repo_delivery` pushes only a
  UUID-derived branch.
- No production, SSH, real database, payment, or deployment path of any kind.
