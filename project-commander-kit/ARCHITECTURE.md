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
                  COMMANDER_PLAN_V1 (PR B)      │
                  COMMANDER_ACK_V1              │
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
   │  9  (PR B) plan edge lookup → next derived step, or plan record    │
   │ 10  (PR B) CURRENT_USER_STATUS rewrite; USER_ACTION_REQUIRED;      │
   │     owner notification (iMessage) from the notify outbox           │
   └────────────────────────────────────────────────────────────────────┘
                     │ terminal comment (authoritative)
                     ▼
        Evidence Issue (or the Queue Issue when no split is configured)
                   ──────► COMMANDER reads state back from GitHub
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

## Delivery boundaries: PR A / PR B / PR C

The remaining framework work is split so each PR can be accepted and rolled
back on its own. **PR A never touches GitHub control-plane topology**; it is
Runner-internal and needs no new Issue or PR to exist first.

| | Scope | Depends on |
|---|---|---|
| **PR A** (this branch) | Runner correctness and simplification: claim-wedge fix, policy-driven failover, LaunchAgent consistency, high-water cursor with lost-state guard, response nonce, tail-scoped availability classification, artifact retention, queue-consumption health, `COMMANDER_VERDICT_V1` *defined but not consumed*, transactional install, single-source kit | nothing |
| **PR B** (this branch) | `COMMANDER_PLAN_V1` deterministic follow-up chains (no LLM; forward-only edge tables on `ok` / stop class / `verdict.*`); Queue Issue / Evidence Issue split (`evidence_issue`); `CURRENT_USER_STATUS` pinned comment + `USER_ACTION_REQUIRED_V1` + `COMMANDER_ACK_V1`; Runner-side owner notification through Messages.app (`notify_outbox`, default off); wake code and tables untouched — wake writes stop **only after** a real plan canary passes, by config | the Evidence Issue exists (LandlordEasy: #29) |
| **PR C** | operation `version` + per-error-code retry policy; CI-side reduced-guard MySQL variant; kit finalization; migration guide executed | PR B |

Migration order is fixed: **A → B → C**. The live Runner is upgraded only
after PR A (see `MIGRATION_FROM_LANDLORDEASY.md`), and `relink-launchagent`
must precede the first transactional upgrade on a host that still runs the
flat layout.

Roles as decided by the owner (2026-09-10): the front-door Commander
(ChatGPT, GitHub connector) is the only creator of intent; Claude is the
heterogeneous independent reviewer whose `COMMANDER_VERDICT_V1` is a
required input, never final authority; the Runner is mechanical
follow-through. Two notification layers: the Runner's own push (seconds,
minimal payload) and, optionally, a Commander-side scheduled read of
`CURRENT_USER_STATUS`. Nothing is designed as if a chat assistant could
inject into an existing conversation.

Standing architecture decisions recorded by the Commander (2026-09-10): only
the front-door Commander creates intent or authorization; background
Commanders never dispatch; no comment-based leases — if a second writer ever
exists it uses git-ref create as the server-side CAS; historical tables and
records are never deleted.

## What deliberately does not exist

- No inbound listener. The Runner polls; nothing can call into it.
- No provider-supplied argv, env, path, URL, or command. Operations run a
  fixed, owner-configured argv; the job selects an ID, never a command.
- No push to `main`/`dev`/protected branches. `repo_delivery` pushes only a
  UUID-derived branch.
- No production, SSH, real database, payment, or deployment path of any kind.
