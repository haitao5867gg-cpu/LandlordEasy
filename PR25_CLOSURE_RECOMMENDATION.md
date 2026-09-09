# PR #25 — one-time closure recommendation

**PR:** [#25](https://github.com/haitao5867gg-cpu/LandlordEasy/pull/25) — `test/rel001-mysql-integration` → `release/v1-rehearsal-candidate`
**Exact head assessed:** `2ba3f3d4ea4cd22c33becca47b0fe460bbad9107`
**Base:** `104de1521cf194c9dc76ccca52741f05a75f1180` (verified merge-base)
**Diff:** 18 files, +1977 / −19

**Recommendation: do not merge yet.** Not because the evidence is thin — it is
unusually good — but because an independently verified P0 correctness defect
sits in a file this PR already modifies.

Nothing here was merged, deployed, or pushed to any protected branch.

---

## 1. Is more repetition needed? No.

The five additional repeat runs are **not materially required**. Dropping them
is a real saving, not a shortcut.

The retained failure that blocked the earlier checkpoint was two concurrent
transfers both claiming one vacant room. The fix converts that decision into a
single atomic `UPDATE … WHERE status = 'VACANT'`. MySQL guarantees at most one
such statement can affect the row regardless of interleaving, so correctness
here is **structural, not probabilistic**. One clean pass demonstrates it;
repetition adds no information about that invariant.

The only place repetition has genuine marginal value is the wall-clock timing
assertions in `rel001-concurrency.mysql-integration.spec.ts` (a 700 ms hold,
`elapsed >= holdMs - 50`, and a constructed deadlock). Those are load-sensitive
and could flake under CI contention. That is optional hardening, unrelated to
the room-claim fix, and not a release blocker.

Also relevant: the earlier five-repeat wrapper failed *before it executed any
test*, leaving the database empty. That is a harness defect, not evidence about
the fix in either direction, and should not be read as inconclusive.

## 2. The blocker: an independently verified P0

I verified this by reading the code directly, not by trusting the review.

**`apps/server/src/leases/leases.service.ts`, `endLeaseInTransaction` (~L688–699).**

```ts
await this.lockRow(db, 'leases', id);                 // SELECT ... FOR UPDATE
const lease = await db.lease.findUnique({ where: { id } });   // plain read
if (lease.status !== 'ACTIVE') throw new BadRequestException('租约已结束');
```

Under InnoDB REPEATABLE READ, every plain read in a transaction serves from the
snapshot fixed by that transaction's **first** plain read. In
`approveTerminationRequest` that first plain read is the request row
(`tx.leaseTerminationRequest.findUnique`), which happens *before* the leases row
is locked. So the guard above can still observe `ACTIVE` from the stale snapshot
even though the row lock is now held, and the subsequent `db.lease.update` runs
unconditionally.

This is the **same bug class** the room-claim fix in this very PR corrects —
left unfixed one function away.

**It is reachable.** `createTerminationRequest` (~L794) dedupes only PENDING
*termination* requests; `createTransferRequest` (~L946) only PENDING *transfer*
requests. Neither checks the other. One lease can therefore carry a PENDING
termination **and** a PENDING transfer simultaneously. They are different rows,
so they take different locks, and both approvals reach `endLeaseInTransaction`.
Result: duplicate deposit/bill records and inconsistent room state — a direct
violation of REL-001's "duplicate/concurrent approval must produce one result".

Two concurrent approvals of the *same* request id are correctly protected by the
request-row lock plus status check. The cross-type path is not.

### Minimal remediation (owner's call — I have not implemented it)

Per the standing constraint, I did not modify business logic. The fix mirrors
what this PR already does for rooms:

```ts
const claimed = await db.lease.updateMany({
  where: { id, status: 'ACTIVE' },
  data: { status: 'ENDED', endedAt, endReason },
});
if (claimed.count !== 1) throw new BadRequestException('租约已结束');
// keep findUnique only for immutable fields (deposit, roomId) needed for refunds
```

Supporting changes:

- **P1-A** — reject creating a termination request while a transfer request is
  PENDING on the same lease, and vice versa. Defense in depth; does not by
  itself close the P0.
- **P1-B** — add a two-connection real-MySQL test that creates both request
  types on one fixture lease, approves them concurrently, and asserts exactly
  one terminal outcome with no duplicate deposit/bill/room writes. The absence
  of this test is why 11/11 passed without surfacing the defect.

## 3. The CI gap — closed

`gh api …/commits/2ba3f3d…/check-runs` returns **zero** runs. The exact head has
never had CI, from either trigger:

- `pull_request.branches` listed only `main` and `dev`; this PR's base is
  `release/v1-rehearsal-candidate`, so no `pull_request` run fired.
- `push.branches` omitted `test/**`, so no `push` run fired either.

Fixed on this branch by adding `release/**` to `pull_request.branches` and
`test/**` plus `infra/**` to `push.branches`. The workflow remains
`permissions: contents: read` with no deploy step, no environment and no
secrets, so this adds coverage without creating any deployment path.

**This takes effect only once the workflow change is on the base branch.**
Merging this framework branch into `release/v1-rehearsal-candidate` — or
cherry-picking the workflow commit there — is what makes PR #25's next push
produce an exact-head run.

## 4. Reviewed clean

The recovered review examined and cleared: the room atomic-claim fix in
`createInTransaction` (correctly closes the retained two-active-leases failure
for both `create()` and the transfer path); `approveTransferRequest`'s
idempotency and post-commit-only QR/PDF/WeiQian/messaging ordering;
`launchContractSigningTaskInternal`'s claim-before-provider-call and sticky
LAUNCHING-on-ambiguous-failure design; and `persistLaunchedSigningTask`'s
bounded local-write retry.

The MySQL harness was checked for injection and safety: table names are
validated against `^[A-Za-z0-9_]+$` before raw SQL interpolation, Docker calls
use `execFileSync` with argv arrays (no shell), and no credential is logged.

Guard binding is sound: `REL001_MYSQL_INTEGRATION_CANDIDATE_SHA` must be exactly
one lowercase 40-hex string equal to `git rev-parse HEAD`, with 7/7 unit tests
covering missing/malformed/uppercase/wrong-SHA and staged/unstaged rejection.

Two residual gaps worth recording:

- The clean-worktree check covers tracked content only and never enumerates
  untracked files — a documented limit on the "exact head" guarantee.
- `assertDockerIsolationGuard`'s hardcoded identity constants (project
  `landlordeasy_ops001`, port 33317, `mysql:8.0` digest) do not match
  `e2e/docker-compose.yml`'s tracked defaults, so the guard's strength is real
  but not reproducible from the committed compose file alone.

## 5. Minimum evidence to reach mergeable

1. Apply the P0 fix, plus P1-A and P1-B.
2. Update `REL001_MYSQL_INTEGRATION_CANDIDATE_SHA` to the new head — the guard
   fails closed until you do, which is intended.
3. On that new head: server `tsc --noEmit`; full server Jest; the full
   `test:mysql-integration` suite including the new cross-type test; guard unit
   tests.
4. Land the CI workflow change on the base branch and confirm a green run on the
   exact new head.
5. Re-review the changed `leases.service.ts` hunks only.

Because `leases.service.ts` changes, **no prior MySQL evidence carries over** —
the guard's exact-SHA binding makes stale reuse structurally impossible. That is
the guard working, not a gap. Re-run everything once, cleanly; do not re-run the
old suite five times first.

## 6. Scope note

I did not modify any business logic, did not merge, did not deploy, and did not
touch production, a real database, or any provider. The full recovered review is
committed at
[`review/recovered/PR25-closure-review-2ba3f3d.md`](review/recovered/PR25-closure-review-2ba3f3d.md).
