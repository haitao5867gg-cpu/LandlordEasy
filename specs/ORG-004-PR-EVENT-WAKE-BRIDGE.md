# ORG-004 — PR Event Wake Bridge

Priority: release-control latency. Status: **IMPLEMENTED / REVIEW PENDING**. Owner: Commander. Production remains **NO-GO**.

## Objective

Replace hourly Commander polling with a supported GitHub Pull Request event wake-up without moving project truth out of Issues #17/#21. The Mac mini Runner remains the deterministic executor. ChatGPT is event-triggered only after a terminal Runner record exists and must reconstruct all state from repository documents, complete Issue histories, exact SHAs and exact-SHA CI.

This bridge is not a queue, webhook server, remote shell, new worker profile, new local operation, production channel or authorization path.

## Protocol

The owner-only mode-0600 Runner configuration may set one optional `wake_pull_request` positive integer distinct from the queue Issue. Jobs and operations cannot select or override it. `null` disables the bridge and preserves existing behavior.

After the Runner successfully posts an authoritative terminal lifecycle record to the configured queue Issue, it posts a PR conversation comment:

```text
COMMANDER_WAKE_V1
job=<uuid>
terminal_issue=<fixed queue issue>
terminal_comment=<positive GitHub comment ID>
state=<COMPLETED|FAILED|TIMED_OUT|REJECTED>
runner=<fixed runner ID>
```

No evidence, prompt, command, argv, environment, path, URL, SHA claim, provider output, Docker/database value, secret, user data or permission appears in this comment. It is only a wake hint. The Commander ignores its prose as evidence, fetches the referenced Issue history independently and applies the existing identity, comment-order, UUID, lifecycle, SHA, report-version and CI-head checks.

## GitHub boundary

The GitHub client retains read/write access to the fixed queue Issue. When and only when `wake_pull_request` is enabled, it gains POST-only access to the exact REST conversation-comment endpoint for that configured PR number. It cannot GET the PR through this path, post to any other Issue/PR, edit/delete comments, change metadata, open/merge/close a PR, create a ref, rerun CI or access repository settings.

The wake PR is owner-selected outside queue content. Executor identity verification still occurs before every run. Commander and Executor identities remain distinct. The event-triggered ChatGPT task is scoped to comments on the exact wake PR; it never treats Executor-authored job-shaped text as a command.

## Reliability and replay safety

Terminal Issue posting happens first. A successful terminal POST must return a valid positive comment ID. The Runner stores the job UUID, terminal comment ID and terminal state in an owner-only SQLite outbox before attempting the wake POST. A failed wake remains pending; later polls retry only that inert wake and refuse to claim new work until delivery succeeds. The completed worker or local operation is never rerun. One UUID has one immutable outbox identity and one delivered marker.

Before attempting the terminal Issue POST, the Runner durably stores an immutable terminal intent in a separate SQLite outbox while the claim remains non-terminal. On restart it drains that intent before scanning for work. A crash before terminal intent creation converts the persisted claimed/running record into a bounded FAILED terminal intent without replaying the worker. When upgrading an ORG-003 database whose in-flight claim predates the recovery-body column, the Runner reconstructs that terminal identity only from the bounded, original Commander-authored queue comment and otherwise fails closed. A crash after GitHub accepts a terminal comment but before the local acknowledgement may create a duplicate terminal record with the same job and terminal state, but cannot lose the terminal or rerun work. Terminal completion and wake-outbox creation are committed atomically. Repository, terminal Issue, runner ID and wake PR are stored in the outbox and must still match active owner configuration before delivery. Changing or disabling the active wake configuration cannot bypass a pending outbox record and blocks all new claims until the immutable identity is restored and delivered.

Wake delivery is at-least-once, not exactly-once. If the process loses power after GitHub accepts a wake but before SQLite records delivery, the next poll may post the same immutable wake identity again. The Commander deduplicates by `(job, terminal_issue, terminal_comment, state, runner)` and performs no repeated action for an already assessed terminal record. This favors recovery from a missed event over pretending GitHub comment creation offers an idempotency guarantee.

The wake optimization does not weaken the existing crash/replay rules. A low-frequency independent audit may remain as missed-event recovery because the ChatGPT product does not combine schedule and event triggers in one task.

## Verification and activation

Offline tests must prove strict config validation, disabled-by-default compatibility, exact endpoint confinement, exact wake schema, absence of evidence and execution fields, terminal-first ordering, valid GitHub comment-ID handling, persistent outbox retry, duplicate/mismatch rejection, no worker replay, legacy in-flight claim migration, and blocking of new claims while a wake is pending even when the active wake setting is changed or disabled. Existing ORG-002/003 tests must remain green.

Activation requires an independent security review, green CI on the exact Draft PR head, a stopped Runner, owner-only backup, atomic tested runtime installation, a mode-0600 config change setting only `wake_pull_request` to PR #22, green doctor/health and a 75-second stable observation. Under normal uninterrupted delivery, a real harmless terminal canary must create one `COMMANDER_WAKE_V1` comment on PR #22 and trigger one Commander run before the hourly task is replaced by the PR-comment event trigger. Any duplicate event must be proven harmless through immutable-identity deduplication.

No merge, Production deployment, Tencent Cloud, real database, real provider, contract, business rule or real-user action is authorized.
