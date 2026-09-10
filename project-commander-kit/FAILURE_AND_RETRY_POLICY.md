# Failure and retry policy

The governing rule: **a safety failure and an engineering failure are not the
same event and must not produce the same response.**

Treating every failure as a safety stop is what turned this control plane into a
manual relay. A missing flag, an unparseable answer, or a rate limit would halt
the whole stage and wait for a human, so the human became the retry mechanism.
Treating every failure as retryable is the opposite mistake and is how automation
walks into production.

## The stop classes

| Class | Meaning | Response |
|---|---|---|
| `SAFETY_STOP` | A boundary was touched: permission denied, worktree dirty after a write, identity/SHA unconfirmable, credential exposure, production contact. | **Fail closed immediately.** No retry, no failover, no cleanup. Preserve the scene. |
| `HUMAN_APPROVAL_REQUIRED` | The action is legitimate but outside standing authorization. | Stop and report. Never self-authorize. |
| `INVOCATION_FAILURE` | **We** called the tool wrong: bad flag, unknown subcommand, selector matching nothing. | Report precisely. Never retried, and never attributed to the code under test. |
| `ENVIRONMENT_FAILURE` | The host could not supply something: missing binary, unresolved path, daemon not up, a local write that failed. | Bounded retry — these clear on their own. |
| `PROTOCOL_FAILURE` | The provider did the work; we could not parse it. | **Recover locally, free.** Never re-invoke the model for a parse bug. |
| `TRANSIENT_FAILURE` | Availability, not correctness: rate limit, quota, auth blip, timeout. | Bounded retry with exponential backoff, and/or fail over to another provider. |
| `CODE_FAILURE` | The work genuinely failed, with positive evidence: assertions, a red suite, type errors. | Report it. Do not retry — a retry cannot make failing tests pass. |
| `UNCLASSIFIED_FAILURE` | A nonzero exit we could not explain. | Say so. Guessing "your code is broken" is the misclassification this taxonomy exists to prevent. |

## The four policies (what the runner DOES)

The eight classes above are diagnostic — whose fault it was. Scheduling
consults only the policy, and `RETRYABLE_STOP_CLASSES` is derived from it. The
two axes used to be one enum while a separate hard-coded list quietly decided
failover (it did not even include TIMEOUT), so the documented classes were
decorative.

| Policy | Classes | Behaviour |
|---|---|---|
| `FAIL_CLOSED` | `SAFETY_STOP`, `HUMAN_APPROVAL_REQUIRED` | stop immediately, preserve the scene, never retry or fail over |
| `LOCAL_RECOVERY` | `PROTOCOL_FAILURE` | re-parse persisted raw bytes; **never** re-invoke the model |
| `BOUNDED_RETRY` | `TRANSIENT_FAILURE`, `ENVIRONMENT_FAILURE` | capped exponential backoff and/or failover within `max_attempts`; write-capable jobs only if the worktree is provably clean |
| `REPORT_AND_STOP` | `INVOCATION_FAILURE`, `CODE_FAILURE`, `UNCLASSIFIED_FAILURE` | record honestly and stop; a retry cannot change the outcome |

Availability classes (`AUTH`, `RATE_LIMIT`, `QUOTA`, `MODEL`, `PERMISSION`)
are diagnosed from a tool's **last three non-empty lines**, not its whole
output: a review that discusses "quota" in its body must not mark a provider
exhausted for its whole reset window.

Quality-gate failures use the same taxonomy: gate output is persisted to
`<job>.gate-N.log` before it is judged, and the terminal record carries the
category, policy, step and the tool's last words. A wrong flag in a gate
command is `INVOCATION_FAILURE`, not a defect in the code under test.

## Mapping

```
PERMISSION, WORKTREE_DIRTY            -> SAFETY_STOP           (never retried)
INVOCATION                            -> INVOCATION_FAILURE    (never retried)
ENVIRONMENT, PERSISTENCE, UNAVAILABLE -> ENVIRONMENT_FAILURE   (bounded retry)
AUTH, RATE_LIMIT, QUOTA, MODEL,
TIMEOUT                               -> TRANSIENT_FAILURE     (retry / failover)
OUTPUT_VALIDATION, OUTPUT_LIMIT       -> PROTOCOL_FAILURE      (recover locally)
RUNTIME                               -> CODE_FAILURE          (report)
UNKNOWN                               -> UNCLASSIFIED_FAILURE  (say so; do not guess)
```

`INVOCATION` covers our own mistakes in calling a tool: a bad flag, an unknown
subcommand, a test selector that matched nothing, a module that could not be
resolved. Re-running the same argv reproduces it exactly, so it is never
retried — and, critically, it is never reported as a failure of the code under
test. `UNKNOWN` exists so that a nonzero exit with no positive evidence is
reported as unclassified rather than guessed at; calling it a code failure is
what sent engineering problems to a human as if they were product defects.

Defined in `ERROR_CATEGORY_STOP_CLASS`; asserted exhaustively by
`StopConditionTests.test_every_error_category_maps_to_a_known_stop_class`.

## Retry rules

1. **Bounded.** `max_attempts` (default 3, hard ceiling 5). No unbounded loop
   exists anywhere in the runner.
2. **Backoff.** `min(60, 2**ordinal)` seconds. No sleep happens after the final
   permitted attempt, because it would only delay the terminal record.
3. **New attempt identity.** Every try gets `attempt_id_for(job_id, ordinal)` —
   a UUID5 derived from the job UUID and the ordinal. The job UUID stays
   exactly-once for terminal purposes; the attempt chain stays complete. A retry
   **never** reuses the job UUID as its execution identity.
4. **Write jobs verify the worktree before failing over.** Failing over after a
   provider may have written files would run a second provider over a dirty
   tree. If the tree is not clean, the outcome is downgraded to `WORKTREE_DIRTY`
   — a `SAFETY_STOP`.
5. **Protocol failures do not consume a second attempt.** This is deliberate and
   is the highest-value rule in the file.

## Why PROTOCOL_FAILURE is special

The incident that motivated this kit:

> A review job ran for **403.5 seconds**, exited 0, reported
> `subtype: "success"`, and cost **$0.908**. It returned schema-valid JSON with
> a 12 131-character summary. The validator's summary cap was 2 000 characters.
> The entire result was discarded. The only recovery offered was to run it again.

Two independent defects: a cap far below what real analysis produces, and no
persistence of what the provider actually said.

Both are now closed:

- Raw bytes are written to `raw-output/<job>.attempt-N.log` **before** parsing.
- `renormalize --job <uuid>` re-parses them locally, writes the full artifact,
  and reports `provider_calls: 0`.
- Bounds raised to match reality: summary 20 000, evidence item 4 000, items
  200, capture 1 MiB.
- Long reports go to a local artifact; the Issue carries a bounded excerpt plus
  the artifact `sha256`.

Verified against the real log from that incident: recovered `status: ok`,
`summary_chars: 12131`, `evidence_items: 10`, `usage: cost_usd=0.9081394`,
`provider_calls: 0`.

## Rejection is a terminal state

Previously, a job that failed validation hit `except ValidationError: continue`
and vanished. The Commander could not distinguish "not polled yet" from
"refused", so it re-posted by hand. Silence is now impossible:

- A comment **addressed to this runner** (matching `runner_id`, `repository`,
  `queue_issue`, with a parseable job UUID) that fails validation is claimed and
  gets an explicit `REJECTED` terminal carrying the reason and stop class.
- A comment addressed to **another** runner, or too malformed to identify, is
  skipped untouched — a runner must never claim or terminate another's work.

## Quota policy

Free capacity is spent before paid capacity, always.

1. Providers with a known-exhausted current window drop out of rotation.
   Exhaustion is recorded against the provider's reset key and expires by itself
   when the window rolls over.
2. If any free-quota provider remains, it is used.
3. If **every** free window is exhausted, the runner refuses to run — unless the
   owner has set both `paid_overflow_authorized: true` and a non-empty
   `paid_overflow_providers`, in which case that provider is used last.
4. Paid overflow is never selected while free capacity exists. This is asserted
   directly by `test_paid_overflow_is_used_only_after_every_free_window_is_spent`.

## Engineering failures that must never stop a stage

These were real stop conditions and are explicitly *not* safety events: a wrong
CLI flag, a path that did not resolve, a parent-process check, a test selector
that matched nothing, a transient registry hiccup, an unparseable answer.
Diagnose, fix, retry within budget, and report — do not escalate to a human and
do not halt the run.
