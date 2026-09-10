# Security model

## Threat model

Assume the Commander agent may be wrong, confused, or prompt-injected by
repository content it reads. Assume a provider CLI may emit hostile text.
Assume a queue comment may be edited after it is read.

The design goal is that none of those can widen what the Runner is able to do.
**Authority comes from owner-edited local config, never from a GitHub comment.**
A comment can only select from what the owner already enabled.

## Trust boundaries

| Boundary | Enforcement |
|---|---|
| Owner config → Runner | `Config.load` refuses group/world-readable config (`st_mode & 0o077`); every path must be absolute; unknown or missing fields are fatal |
| Commander → Runner | only comments authored by `commander_login` on the fixed queue Issue are read; Executor-authored job-shaped comments are ignored by construction |
| Runner → GitHub | `GitHubClient._api` allows exactly: GET the queue Issue and its comments, POST a comment to the queue Issue, POST a comment to the optional wake PR, plus read-only `api user`. Everything else raises |
| Runner → filesystem | worktrees are created under a configured root; `checked_child` rejects symlinks and any path whose resolved parent is not the root |
| Runner → subprocess | explicit argv, `shell=False`, `start_new_session=True`, filtered environment, bounded timeout and output, process-group kill on timeout/overflow |
| Job → execution | a job selects an ID from an owner-configured registry; it never supplies a command, argument, path, URL, or environment variable |

## Identity separation

`commander_login` and `executor_login` must be different GitHub accounts;
`Config.load` refuses to start otherwise. `verify_login()` confirms at every
tick that the Runner's own token belongs to the Executor.

**The kit never merges the two tokens.** The recurring temptation — "give the
Runner the Commander's token so it can update Issues directly" — would destroy
the property that no single credential can both issue and perform work. If
day-to-day relay is painful, the answer is the wake bridge and richer terminal
records, not a shared token.

## What is fail-closed

Immediate stop, no retry, no cleanup, scene preserved:

- credential or private-key material detected in output (`HIGH_RISK_RE` after
  redaction)
- any production, real-database, real-provider, payment, or real-user contact
- destructive operations (force-push, volume prune, schema drop, mass delete)
- permission denied, or a tool refusing an operation
- identity that cannot be confirmed: wrong login, edited comment, SHA mismatch,
  worktree not matching the requested commit
- a write job whose worktree is dirty when failover would otherwise occur
- business-invariant failures in a controlled operation

## What is explicitly *not* a security event

A wrong CLI flag. A path that did not resolve. An unparseable model answer. A
test selector that matched nothing. A rate limit. Treating these as safety stops
is what forced constant human intervention; see `FAILURE_AND_RETRY_POLICY.md`.

## Secret hygiene

Two layers, applied to everything that leaves the process:

1. **Redaction** (`redact`): home directory, `/Users/<name>`, IPv4 addresses,
   e-mail addresses, private-key blocks, `ghp_`/`github_pat_`/`xox*`/`sk-`/`AKIA`
   tokens, `password|token|secret|api_key = …`, and database URLs.
2. **Fail-closed verification** (`ensure_safe_post`): if high-risk material
   survives redaction, the post is refused rather than sanitized-and-hoped.

Applied to Issue comments, wake notices, terminal bodies, recovery bodies, and
local artifacts (`ensure_safe_post_unbounded` — same contract, no length clamp).

Delivery adds a third layer: staged content is scanned for sensitive paths
(`.env`, anything matching `credential|secret|token|keychain|id_rsa|id_ed25519`),
non-regular file modes (symlinks, submodules, gitlinks), unscannable binaries,
and device-specific paths — before any commit or push.

`SecretHygieneTests` asserts that none of a representative secret corpus reaches
an Issue comment or a local artifact, and the end-to-end canary greps the whole
state directory afterwards.

## Delivery constraints

`repo_delivery` is the only write-to-GitHub path, and it is deliberately narrow:

- the branch name is **derived from the job UUID**, so it can never be `main`,
  `dev`, or an infra branch
- an exact-path allowlist per quality gate; a path outside it aborts the delivery
- a mandatory bounded `human_approval_ref` on every delivery job
- the quality gate runs **between two stage-and-validate passes**, and the
  committed tree must equal the validated tree (`write-tree` compared to
  `HEAD^{tree}`) — a gate cannot smuggle in extra content
- commit runs with `core.hooksPath=/dev/null`, so repository hooks cannot execute

## Controlled operations

Operations exist so approved, bounded local work (for example a read-only probe
of an isolated test database) can run without a human relaying commands. They
are constrained hard:

- the argv is **entirely owner-configured** and must match a fixed helper
  contract; the job supplies only an `operation_id`
- shell interpreters and `env` wrappers are rejected in config validation
- two modes exist: `read_only` (the OPS-001 probe) and `isolated_test`
  (`rel001_mysql_suite`). **`isolated_test` writes**: it brings up a
  loopback-only, tmpfs-backed, zero-volume MySQL container from the
  repository's compose file, applies the Prisma schema, runs the suite, and
  tears the container down. The database is synthetic and disposable, is
  asserted empty before and after, and is bound to an exact compose project,
  container name and image digest. This *is* a real-database path — an
  isolated one. Earlier text said only `read_only` existed and that no
  database path existed; both were false once `isolated_test` landed.
- a clean worktree is required before and after
- a reduced environment (no Docker routing or provider variables)
- authorization is an exact SHA allowlist **or** the current head of an
  owner-approved branch — never a wildcard, and never a protected branch

### On branch binding

Pinning an operation to a literal SHA created a deadlock: any commit that fixed
the code changed the head, which invalidated the pin, which required an owner
config edit before the fix could be tested. Branch binding resolves the head at
run time from `refs/remotes/origin/<branch>` and records the **resolved SHA** in
the terminal record. The owner still authorizes exactly one branch; the audit
trail still names one exact commit. `main`, `dev`, `master` and `HEAD` are
refused outright, and branch names are validated tightly enough that they cannot
escape into a different ref.

## Residual risks

- **Local host compromise.** The Runner holds an Executor token and can push
  UUID-derived branches. Host compromise is out of scope; mitigate with disk
  encryption and a least-privilege token.
- **A malicious Commander account** can dispatch any job the owner has enabled.
  It still cannot exceed the enabled profiles, gates, allowlists, or operations.
- **Provider CLI compromise** could write inside the worktree. Delivery scanning
  and the two-pass tree comparison bound the impact; nothing is pushed to a
  protected branch.
- **Redaction is pattern-based** and cannot recognise a novel secret format.
  Delivery path allowlists and the sensitive-path scan are the backstop.
