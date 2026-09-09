# REL-001 real-MySQL integration harness (test-only)

This directory and the `*.mysql-integration.spec.ts` files under
`src/leases/__mysql-integration__/` and `src/maintenance/__mysql-integration__/`
are test-only. Nothing here is imported by production code, and nothing here
has been executed as part of writing it — see the pending evidence checkpoint
in `specs/REL-001.md`.

## What this proves that the existing mocked unit tests cannot

The existing `leases.service.spec.ts` / `maintenance.service.spec.ts` suites
mock `PrismaService`, so they prove the service calls the right methods in the
right order but cannot prove real MySQL rollback, real row-lock waiting, or a
real deadlock. This harness runs the same service classes against a real,
isolated MySQL database with real `Prisma.$transaction` interactive
transactions, real `SELECT ... FOR UPDATE` locks, and real separate
connections.

## Fail-closed opt-in (see `guard.ts`)

The files self-skip during the ordinary full Jest run, but the focused
`test:mysql-integration` entry point fails closed before Jest executes unless
**all** of the following hold:

- `REL001_MYSQL_INTEGRATION=1`
- `DATABASE_URL` points at `127.0.0.1:33317`, database `landlord_easy_e2e`
  (host/port/database are checked; the URL value itself and any credential
  are never logged anywhere in this harness)
- `REL001_MYSQL_INTEGRATION_CANDIDATE_SHA` equals the fixed reviewed candidate
  `104de1521cf194c9dc76ccca52741f05a75f1180`, and `git rev-parse HEAD` equals
  that same SHA
- `REL001_DOCKER_EXECUTABLE` is an explicit absolute executable path; the
  guard independently verifies the exact Compose project/service/container,
  healthy state, loopback-only binding, accepted image digest, tmpfs storage,
  one project network and zero project volumes
- every application table is empty before fixture creation, so every row in
  the run is synthetic and attributable to that run

Example (never commit real values; illustrative only):

```
REL001_MYSQL_INTEGRATION=1 \
DATABASE_URL="mysql://<user>:<password>@127.0.0.1:33317/landlord_easy_e2e" \
REL001_MYSQL_INTEGRATION_CANDIDATE_SHA=104de1521cf194c9dc76ccca52741f05a75f1180 \
REL001_DOCKER_EXECUTABLE="<absolute-path-to-docker>" \
pnpm --filter server run test:mysql-integration
```

`landlord_easy_e2e` must be a disposable, isolated MySQL database/instance —
never a production or shared development database. This harness never runs
`TRUNCATE`, disables foreign-key checks, drops schema, or issues broad
unscoped deletes; see `fixtures.ts`.

## How each requirement is implemented

- **Real interactive transactions, no mocking**: `mutation-counting-client.ts`
  wraps a real `PrismaClient` bound to the guarded `DATABASE_URL`. It proxies
  only `$transaction`, wrapping the interactive callback's `tx` so every
  mutation method (`create`/`update`/`updateMany`/`upsert`/`delete*`) is
  `await`-ed for real, counted only after it truly succeeded, and can then be
  made to throw immediately after a selected Nth mutation. Everything else
  (`$queryRaw` row locks, reads, `$connect`/`$disconnect`) passes straight
  through untouched.
- **Discover-then-inject**: each write-path suite first runs the service
  once with no injected failure (discovery pass) to learn the real number of
  mutations the current code performs, then iterates failure injection at
  every one of those positions (1..N) against a freshly recreated fixture,
  asserting the persisted snapshot after the rejected call exactly equals the
  snapshot captured before it ran (`snapshot.ts` normalizes `Decimal`/`Date`
  for stable `toStrictEqual`). This makes the matrix self-updating: it never
  hard-codes "how many writes REL-001 should have," so it keeps proving
  all-or-nothing behavior even as the implementation evolves.
- **Collision-resistant synthetic fixtures, narrow cleanup, retain state on
  failure**: `fixtures.ts` embeds a random run tag into every
  unique-constrained field. Every fixture's `cleanup()` deletes only rows
  scoped to the exact IDs it created, in FK-safe order (deposit records/bill
  items/bills/signing tasks/requests, then leases, then rooms, then
  building/property/tenant/landlord). Every test calls `cleanup()` as its
  last line, after all assertions — if an assertion throws, cleanup is never
  reached and the fixture rows stay in `landlord_easy_e2e` for inspection.
- **Deterministic fakes for external collaborators**: `fakes.ts` provides
  `jest.fn()`-wrapped, pure implementations of the WeChat QR/customer-service/
  notify interfaces, WeiQian e-sign client, and contract PDF generator. No
  network call is ever made; call counts remain assertable (e.g. no duplicate
  provider launch on an idempotent retry).
- **Real row-lock waiting / deterministic deadlock**:
  `rel001-concurrency.mysql-integration.spec.ts` uses two independent
  `PrismaClient` connections. One test holds a `FOR UPDATE` lock on one
  connection and measures that a second connection's service call provably
  waits at least as long as the lock is held. Another test has two
  connections acquire two room locks in reverse order to produce a real,
  isolated MySQL deadlock (not simulated), asserts exactly one side is
  aborted with a deadlock error, and then recovers the aborted side with a
  small bounded manual retry loop defined only in the test file — no
  production code changes.

## Running

```
pnpm --filter server run test:mysql-integration
```

This runs only files matching `mysql-integration.spec.ts` via the default
Jest config, with `--runInBand` (interactive transactions and real row locks
are order-sensitive; do not parallelize). Without the exact opt-in and guard
values above, the focused command exits nonzero instead of silently passing.

`pnpm --filter server test` (the default suite used by CI) also matches these
files by Jest's `testRegex`, but they self-skip via `describeMysqlIntegration`
whenever the guard fails, so CI stays green without Docker/MySQL/network
access.
