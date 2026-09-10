> **STALE — superseded.** This report describes the first hardening round
> (suite 151, five stop classes, flat runtime layout). The current state of
> PR A — 241 tests, eight classes / four policies, transactional versioned
> install, high-water cursor, nonce, verdict schema, audit findings P0-1
> through P2-8 — is in `FRAMEWORK_HANDOFF_TO_CHATGPT.md`. Kept unchanged as a
> historical record.

# Framework final report

**Branch:** `infra/commander-kit-hardening`, based on `origin/infra/pr-event-wake-bridge` @ `b81833de`
**Identity:** operated as **Executor** (`haitao5867`). Not switched. Commander is `haitao5867gg-cpu`.
**Scope kept:** no production, no real database, no provider/payment/WeChat contact, no business-rule change, no force-push, no merge, no deploy, no deletion of any existing worktree, backup, or diagnostic state.

---

## 1. What was actually wrong

Nine root causes, each confirmed against code or live state — not inferred.

| # | Root cause | How it was confirmed | Class |
|---|---|---|---|
| 1 | `SHELL_FRAGMENT_RE` included `;` and was applied to `prompt`/`assigned`/`expected_evidence`. Providers run via `Popen(argv, shell=False)`, so **no shell exists** — the filter protected nothing and rejected ordinary prose and JSON. | code read | framework |
| 2 | Validation failures hit `except ValidationError: continue`. The job was skipped in silence: no claim, no terminal, no trace. | code read + **0 REJECTED across 37 real claims** in the live state DB | framework |
| 3 | `normalize_provider_output` capped `summary` at 2 000 chars. | reproduced the failure against live code with the real log | framework |
| 4 | Raw output was persisted only *after* normalization, only for the final attempt, with **no re-normalization path** — recovery meant re-spending quota. | code read | framework |
| 5 | `route_candidates` used a static order and never consulted `QuotaLedger`; `provider_failover: false` in production. | code read + live config | scheduling |
| 6 | Every `RunnerError` collapsed to `FAILED/blocked`; **no retry existed at all**, and safety stops were indistinguishable from a wrong CLI flag. | code read | framework |
| 7 | `ops001_mysql_probe` pinned to `104de15…`, which is not the head of any branch under test. The controlled MySQL operation could **never** run against PR #25's head, so the work fell back to a human. Any fix changes the SHA, invalidating the pin — a self-reference deadlock. | live config vs PR #25 head | framework + scheduling |
| 8 | CI `pull_request.branches` covered only `main`/`dev`; `push.branches` omitted `test/**`. | **`check-runs` on `2ba3f3d…` returns zero runs** | framework |
| 9 | `MAX_OUTPUT_BYTES = 65_536` truncated long runs. | a raw log of **exactly** 65536 bytes | framework |

### The flagship incident

Job `3abae900`: Claude ran **403.5 s**, exited 0, reported `subtype: "success"`,
cost **$0.908**, and returned schema-valid JSON with a **12 131-character**
summary and 10 evidence items. The validator's cap was 2 000. **The entire
result was discarded**, and the only offered recovery was to run it again.

That single event contains causes 1, 3, 4, 6 and 9 at once, and it is the reason
this work exists.

## 2. What was built

All in `tools/commander-runner/commander_runner.py` unless noted.

**Rejection is now a state.** `envelope_for_rejection()` + `rejection_lifecycle()`.
A job addressed to *this* runner that fails validation is claimed and gets an
explicit `REJECTED` terminal carrying the reason and stop class. A job addressed
to another runner, or too malformed to identify, is still skipped untouched — a
runner must never claim or terminate another's work.

**Job text validates for its real sink.** `validate_job_text()` rejects control
characters and enforces length; punctuation is allowed. `SHELL_FRAGMENT_RE` is
retained for owner config (operation argv and descriptions), where a shell-looking
fragment really does signal a misconfiguration.

**Nothing is lost.** Raw bytes are persisted **before** parsing, per attempt.
`renormalize` re-parses locally with `provider_calls: 0`. `store_artifact()`
keeps the full report on disk; the Issue gets a bounded excerpt plus a sha256.
Bounds raised to match reality: summary 20 000, evidence item 4 000, items 200,
capture 1 MiB.

**Failures are graded.** `SAFETY_STOP` / `HUMAN_APPROVAL_REQUIRED` /
`PROTOCOL_FAILURE` / `TRANSIENT_FAILURE` / `CODE_FAILURE`, with an exhaustive
category mapping. Bounded retry with capped exponential backoff for transient
classes; **protocol failures never consume a second provider call** — the bytes
are already on disk. Every attempt is recorded with a derived `attempt_id`; the
job UUID is never reused as an execution identity.

**Quota is respected.** Exhaustion is tracked against each provider's reset key
and expires with the window. Free capacity is always spent first; authorized
paid overflow (`paid_overflow_providers` + `paid_overflow_authorized`) is used
only when every free window is spent.

**The SHA deadlock is gone.** Operations may bind to an owner-approved *branch*;
the runner resolves its head from origin at run time and records the resolved
SHA in the terminal record. `main`/`dev`/`master`/`HEAD` are refused and branch
names cannot escape into another ref.

**CI covers the exact head.** `release/**` added to `pull_request.branches`;
`test/**` and `infra/**` added to `push.branches`. The workflow stays
`contents: read` with no deploy step, so this adds coverage and no deployment
path. The offline suite, the canary, and the kit suite now all run in CI.

**Portable kit.** `project-commander-kit/` — runner + full suite, doctor /
install / upgrade / rollback tooling, config JSON schema and neutral example,
GitHub Issue/PR/CI templates, a single-file onboarding prompt, and a standalone
framework summary that depends on no chat history.

## 3. A bug found by actually running things

`pck.py`'s backup timestamps have one-second resolution. An `upgrade`
immediately followed by a `rollback` landed in the same second, so the
rollback's own safety copy **overwrote the very backup it was about to restore**
— silently losing the previous runtime. Found by running the real lifecycle
rather than reasoning about it. Fixed with a collision guard and covered by
`test_backups_are_never_overwritten_within_the_same_second`.

## 4. Verification

| Check | Result |
|---|---|
| Offline suite (repo) | **151/151 pass** (was 101) |
| Offline suite (kit) | **151/151 pass** |
| End-to-end canary | **21/21 checks pass** |
| `pck.py doctor` | `ok: true` |
| install → upgrade → rollback | round trip restores the prior runtime; **all 6 backups retained** |
| Recovery of the destroyed PR #25 review | `status: ok`, `summary_chars: 12131`, `evidence_items: 10`, `usage: cost_usd=0.9081394`, **`provider_calls: 0`** |
| CI on PR #25 exact head | **0 runs** — gap confirmed, then closed |
| CI on this branch's exact head `3d6d275f` | **both runs green, all 14 steps** |

The trigger fix is proven, not just argued: this branch produced **two** green
runs on its exact head — a `pull_request` run against `dev`, and a `push` run on
`infra/commander-kit-hardening` that exists *only* because `infra/**` was added
to `push.branches`. Both passed every step, including the three new ones (offline
suite, end-to-end canary, portable kit suite), the full server Jest suite, and
both H5 typecheck/builds.

Backward compatibility was verified directly: the **live production config loads
unchanged** under the new runner, taking safe defaults (`max_attempts: 3`,
`paid_overflow_authorized: false`, no paid providers). The `renormalize` CLI was
also exercised end to end against the real lost log, reporting
`provider_calls: 0`.

Three pre-existing tests asserted the *defective* behaviour (that `;` must be
rejected). They were rewritten to assert the corrected contract, with comments
naming the incident.

The canary drives the real `run_once` loop against a real git repository and a
real isolated worktree with stub provider and `gh` binaries. It covers the happy
path, oversized-report preservation, exactly-once replay suppression, explicit
`REJECTED`, foreign-runner and executor-authored comments being left untouched,
SHA drift failing closed, protocol-failure classification with a recovery hint,
credential absence across the whole state directory, and the attempt chain not
reusing the job UUID. No network, GitHub, Docker, database or credential.

## 5. Root causes I did *not* fully close

Stated plainly rather than papered over.

- **Live runner not upgraded.** The running launchd process still executes the
  old runtime from `~/.local/lib/`. Upgrading it changes production automation
  behaviour on your machine and is your call — `pck.py upgrade` (reversible via
  `rollback`) is ready.
- **Webhook signature verification.** The wake bridge is outbound-only; there is
  no inbound listener in this repository (`doctor` reports
  `NO_INBOUND_LISTENER_IMPLEMENTED`). Duplicate-event dedup, terminal dedup,
  failure recovery and the persistent outbox are implemented and tested. HMAC
  verification is specified in the docs but has no code to attach to until a
  listener exists — I did not invent one.
- **Controlled real-MySQL operation.** The *mechanism* is generalized (branch
  binding, so the operation can follow the branch under test). Registering a
  MySQL integration operation and running it against real Docker was **not**
  done: it needs Docker on your host and an owner decision, and my brief
  excluded touching real databases.
- **Eliminating web relay entirely.** Reduced, not removed. Terminal records now
  carry stop class, attempt id and artifact digest, so far less back-and-forth is
  needed. But the Commander must still author job comments from its own account,
  and that is deliberate: the only way to remove it is a shared token, which
  would destroy the identity separation the whole model rests on.

## 6. Still requires your approval

1. **Upgrade the live runner** to this runtime and restart it.
2. **Replace the `ops001_mysql_probe` SHA pin** with `allowed_target_branches`.
3. **Fix `wake_pull_request`** — it points at PR #22, which is merged.
4. **Enable paid overflow**, if you want it. Off by default; a cost decision.
5. **Land the CI workflow change on `release/v1-rehearsal-candidate`** so PR #25
   can get exact-head CI.
6. **Apply the P0 lease fix** in PR #25 — business logic, explicitly outside my
   scope.
7. **Merge anything.** Nothing was merged. This branch is a Draft PR.

## 7. Deliverables

| Item | Location |
|---|---|
| Fix branch | `infra/commander-kit-hardening` |
| Hardened runner | `tools/commander-runner/commander_runner.py` |
| Acceptance suite | `tools/commander-runner/tests/test_framework_hardening.py` |
| Lifecycle tests | `tools/commander-runner/tests/test_kit_lifecycle.py` |
| End-to-end canary | `tools/commander-runner/tests/canary_end_to_end.py` |
| Portable kit | `project-commander-kit/` |
| Onboarding prompt | `project-commander-kit/ONBOARDING_PROMPT.md` |
| Memory-free summary | `project-commander-kit/FRAMEWORK_SUMMARY.md` |
| PR #25 closure | `PR25_CLOSURE_RECOMMENDATION.md` |
| Recovered review | `review/recovered/PR25-closure-review-2ba3f3d.md` |
| Running progress log | `FRAMEWORK_PROGRESS.md` |
