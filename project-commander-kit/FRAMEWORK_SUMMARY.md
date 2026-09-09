# Framework summary

A complete, standalone account of this control plane. It assumes no chat
history. If you have only this file and the code, you can rebuild the reasoning.

## 1. What it is

A bounded job-execution system that lets an AI agent do real engineering work on
a repository unattended.

- **Control plane:** one GitHub Issue. Comments are jobs; comments are terminal
  records. Immutable, timestamped, attributable.
- **Execution plane:** one local Python program (`commander_runner.py`, no
  third-party dependencies) polling that Issue.
- **Authority plane:** one owner-edited local JSON config, mode 0600. This is
  the *only* source of authority. A GitHub comment selects from what is enabled;
  it can never widen it.

## 2. Identities

| Role | Identity | Does | Cannot |
|---|---|---|---|
| Owner | human | sets config, authorizes risk | — |
| Commander | GitHub account A | posts jobs | execute anything |
| Executor | GitHub account B | runs the runner, posts terminals | post jobs (ignored by construction) |

The two logins must differ; startup fails otherwise. No token is shared. A
single compromised credential cannot both issue and perform work.

## 3. Lifecycle

```
Commander comment → filter (author + runner_id + repo + queue) → parse
   ├─ invalid & addressed here → claim → REJECTED terminal (reason + stop class)
   ├─ invalid & addressed elsewhere → skip untouched
   └─ valid → claim (SQLite, exactly-once per job UUID)
        → git worktree at exact SHA (verified; drift fails closed)
        → execute: provider argv (shell=False) or fixed operation argv
        → PERSIST RAW BYTES
        → parse → artifact (full) + bounded Issue excerpt + sha256
        → queue terminal in outbox → post → optional advisory wake
```

## 4. Message schemas

`COMMANDER_JOB_V1` (provider work) and `COMMANDER_OPERATION_V1` (controlled
local operation): one fenced JSON object after a schema marker, nothing else.
Full field tables in `PROTOCOLS.md`.

Provider response contract:
`{"status": "ok"|"blocked", "summary": str, "evidence": [str], "usage": str?}`
— summary ≤ 20 000, evidence ≤ 200 items of ≤ 4 000 chars. Tolerant about
packaging (bare, fenced, embedded in prose, or a Claude JSON envelope), strict
about content.

Terminal states: `CLAIMED`, `COMPLETED`, `FAILED`, `TIMED_OUT`, `REJECTED`.

## 5. Stop classes

| Class | Response |
|---|---|
| `SAFETY_STOP` | fail closed, preserve scene, never retry |
| `HUMAN_APPROVAL_REQUIRED` | stop and report; never self-authorize |
| `PROTOCOL_FAILURE` | recover locally, free; never re-invoke the model |
| `TRANSIENT_FAILURE` | bounded retry with backoff, and/or fail over |
| `CODE_FAILURE` | report; a retry cannot make failing tests pass |

Fail-closed set: credential exposure, production/real-DB/payment/real-user
contact, destructive operations, permission denial, unconfirmable identity or
SHA, dirty worktree before failover, business-invariant failure.

Explicitly *not* safety events: wrong CLI flag, unresolved path, unparseable
answer, wrong test selector, rate limit.

## 6. Durability

- Raw provider bytes → `raw-output/<job>.attempt-N.log`, written **before**
  parsing. This is the core recovery guarantee.
- `renormalize --job <uuid>` re-parses locally, reports `provider_calls: 0`.
- Full reports → `artifacts/<job>/attempt-N.md`; the Issue carries a bounded
  excerpt plus the artifact sha256.
- Terminal intent is committed to SQLite before any GitHub post. A failed post
  redelivers; the job never re-runs.
- Wake notices: at-least-once, deduplicated by job UUID, **no authority**.
- Attempts: one row per try, keyed by `uuid5(job_id, ordinal)`. The job UUID is
  never reused as an execution identity.

## 7. Quota policy

Free capacity first, always. Exhaustion is recorded against the provider's reset
key and expires with the window. When every free window is spent the runner
refuses to run — unless the owner set both `paid_overflow_authorized: true` and
a non-empty `paid_overflow_providers`, in which case that provider goes last.

## 8. Safety mechanisms

- **No shell.** Explicit argv, `shell=False`, new session, filtered environment,
  bounded timeout/output, process-group kill.
- **Endpoint restriction.** Only the queue Issue's comments (and optionally a
  wake PR's comments, POST-only), plus read-only `api user`.
- **Exact-SHA worktrees**, verified after creation; symlink and path-escape
  checks on every worktree path.
- **Delivery:** UUID-derived branch only (never a protected branch); exact-path
  allowlist; mandatory `human_approval_ref`; gate run between two
  stage-and-validate passes with the committed tree compared to the validated
  tree; hooks disabled.
- **Operations:** owner-configured argv only; job supplies just an ID; shell
  interpreters refused; `read_only` mode only; clean worktree required; exact
  SHA or owner-approved branch head, never a protected branch.
- **Secrets:** pattern redaction plus fail-closed verification on every outbound
  string and every local artifact; sensitive-path and file-mode scanning on
  delivery.

## 9. Known defects this fixes (all evidence-backed)

1. Legitimate prompts rejected for containing `;` — the filter guarded a shell
   that does not exist.
2. Invalid jobs skipped silently, with no terminal record. Zero `REJECTED`
   states existed across 37 real claims.
3. A 403.5-second, exit-0, `$0.908` Claude review discarded whole because its
   12 131-character summary exceeded a 2 000-character cap.
4. No re-normalization path: recovery meant re-spending quota.
5. Routing ignored the quota ledger entirely; no paid-overflow gate existed.
6. Every failure collapsed to one `FAILED` bucket with no retry at all.
7. A controlled operation pinned to a SHA that no branch under test pointed at,
   so it could never run and the work fell back to a human.
8. CI covered neither `release/**` PR bases nor `test/**` pushes, so a candidate
   PR had no exact-head CI from either trigger.
9. Output capture truncated at 64 KiB.

## 10. Verification

- `python3 -m unittest discover -s runner/tests` — **146 tests**.
- `python3 runner/tests/canary_end_to_end.py` — **21 checks**, driving the real
  loop against a real git repository and worktree with stub provider and `gh`.
  No network, GitHub, database, or credential.
- Real-data proof: the destroyed review was recovered from its persisted raw log
  with `provider_calls: 0`.

## 11. Deliberate non-features

No inbound listener. No job-supplied command, argv, path, env, or URL. No
protected-branch push, merge, release, or deployment. No production, SSH, real
database, payment, or real-user path. No shared Commander/Executor token — the
recurring temptation, and the one change that would collapse the model.
